/**
 * V3 sub-agent dispatch integration test (Phase 6, Task 6.2).
 *
 * Verifies that when V3's chatLoop dispatches a `Task` tool call, the
 * runner used by the meta-tool registry is the OpenAgenticProxyClient adapter
 * (NOT the in-api SubagentOrchestrator).
 *
 * The test drives the runChat entry point with stubbed deps and asserts:
 *   - deps.runSubagent (which V2 wires to SubagentOrchestrator) is REPLACED
 *     by an adapter that invokes OpenAgenticProxyClient.executeAgent.
 *   - The adapter receives the parent ctx (userId, sessionId, parentToolUseId,
 *     the user's local bearer) so the proxy can attribute the sub-agent's
 *     downstream MCP calls. OSS is local-auth only — no OBO ID-token forwarding.
 *   - When the proxy fails (network error / non-2xx), the dispatch returns
 *     ok:false to the model channel — the loop never crashes.
 *
 * the design notes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runChat, _resetEnrichedToolsCacheForTests } from '../runChat.js';
import * as OpenAgenticProxyClientModule from '../../../../../services/OpenAgenticProxyClient.js';

// Stub the streamProvider — yield one tool_use_complete for `Task`, then
// end_turn on the next iteration.
const streamProviderModule = await import('../streamProvider.js');

function makeRunCtx(emit: any = vi.fn(), logger: any = makeLogger()) {
  return {
    emit,
    logger,
    userId: 'user-1',
    sessionId: 'session-1',
    user: {
      id: 'user-1',
      email: 'user@example.com',
      accessToken: 'oboToken-XYZ',
      idToken: 'idToken-PQR',
    },
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeStreamProviderStub(toolUseSeen: { value: boolean }) {
  // First turn: emit a Task tool_use; second turn: end_turn with text.
  let turn = 0;
  return () => ({
    [Symbol.asyncIterator]: () => {
      const events: any[] = [];
      if (turn === 0) {
        events.push(
          {
            type: 'tool_use_complete',
            id: 'tool-use-task-1',
            name: 'Task',
            input: { description: 'audit IAM', prompt: 'Audit IAM drift', subagent_type: 'cloud_operations' },
          },
          { type: 'message_stop', stop_reason: 'tool_use' },
        );
      } else {
        events.push(
          { type: 'text_delta', text: 'Sub-agent reported back. Done.' },
          { type: 'message_stop', stop_reason: 'end_turn' },
        );
      }
      turn++;
      let i = 0;
      return {
        async next() {
          if (i < events.length) {
            return { value: events[i++], done: false };
          }
          return { value: undefined, done: true };
        },
      } as any;
    },
  });
}

beforeEach(() => {
  _resetEnrichedToolsCacheForTests();
  vi.restoreAllMocks();
});

describe('V3 Task tool dispatch routes through OpenAgenticProxyClient (Phase 6)', () => {
  it('Task dispatch invokes OpenAgenticProxyClient.executeAgent — NOT the legacy SubagentOrchestrator', async () => {
    const executeAgentSpy = vi.fn().mockResolvedValue({
      ok: true,
      output: 'sub-agent done',
      costCents: 1.0,
      durationMs: 200,
      tokens: 100,
      toolsUsed: [],
    });
    // Patch the OpenAgenticProxyClient class so any instance executeAgent goes here.
    vi.spyOn(OpenAgenticProxyClientModule.OpenAgenticProxyClient.prototype, 'executeAgent').mockImplementation(
      executeAgentSpy as any,
    );

    // Patch makeStreamProvider so chatLoop sees our scripted events.
    const stubStream = makeStreamProviderStub({ value: false });
    vi.spyOn(streamProviderModule, 'makeStreamProvider').mockReturnValue(stubStream as any);

    // The legacy `runSubagent` dep — must NOT be invoked when V3 routes to OpenAgenticProxy.
    const legacyRunSubagent = vi.fn();

    process.env.OPENAGENTIC_PROXY_URL = 'http://openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'real-prod-key-XXXXX';

    const ctx = makeRunCtx();
    const input: any = {
      userMessage: 'Audit IAM drift across all AWS accounts',
      priorMessages: [],
      model: 'whatever-model',
      attachments: [],
      maxTurns: 12,
    };
    const deps: any = {
      providerManager: {} as any,
      executeMcpTool: vi.fn(),
      listAgents: async () => [
        { agent_type: 'cloud_operations', display_name: 'Cloud Ops', description: 'Cloud audit + drift work' },
      ],
      runSubagent: legacyRunSubagent,
      prismaLike: undefined,
    };

    await runChat(ctx as any, input, deps);

    expect(executeAgentSpy).toHaveBeenCalledTimes(1);
    expect(legacyRunSubagent).toHaveBeenCalledTimes(0);
  });

  it('OpenAgenticProxyClient receives parent userId, sessionId, parentToolUseId, agentName, task', async () => {
    const executeAgentSpy = vi.fn().mockResolvedValue({
      ok: true,
      output: 'done',
      costCents: 0,
      durationMs: 1,
      tokens: 0,
      toolsUsed: [],
    });
    vi.spyOn(OpenAgenticProxyClientModule.OpenAgenticProxyClient.prototype, 'executeAgent').mockImplementation(
      executeAgentSpy as any,
    );
    vi.spyOn(streamProviderModule, 'makeStreamProvider').mockReturnValue(
      makeStreamProviderStub({ value: false }) as any,
    );

    process.env.OPENAGENTIC_PROXY_URL = 'http://openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'real-prod-key-XXXXX';

    const ctx = makeRunCtx();
    const input: any = {
      userMessage: 'Audit IAM drift',
      priorMessages: [],
      model: 'whatever-model',
      attachments: [],
      maxTurns: 12,
    };
    const deps: any = {
      providerManager: {} as any,
      executeMcpTool: vi.fn(),
      listAgents: async () => [
        { agent_type: 'cloud_operations', display_name: 'Cloud Ops', description: 'X' },
      ],
      runSubagent: vi.fn(),
      prismaLike: undefined,
    };

    await runChat(ctx as any, input, deps);

    const callArg = executeAgentSpy.mock.calls[0][0];
    expect(callArg.userId).toBe('user-1');
    expect(callArg.sessionId).toBe('session-1');
    expect(callArg.parentToolUseId).toBe('tool-use-task-1');
    expect(callArg.agentName).toBe('cloud_operations');
    expect(callArg.task).toBe('Audit IAM drift');
    // Forward the user's local bearer from parent ctx for identity/audit
    // attribution of the sub-agent's downstream tool calls. OSS is local-auth
    // only — no OBO; userIdToken is no longer part of the request shape.
    expect(callArg.userToken).toBe('oboToken-XYZ');
    expect(callArg.userIdToken).toBeUndefined();
  });

  it('Proxy failure surfaces as Task ok:false (loop does not crash)', async () => {
    const executeAgentSpy = vi.fn().mockResolvedValue({
      ok: false,
      error: 'openagentic-proxy unreachable: ECONNREFUSED',
    });
    vi.spyOn(OpenAgenticProxyClientModule.OpenAgenticProxyClient.prototype, 'executeAgent').mockImplementation(
      executeAgentSpy as any,
    );
    vi.spyOn(streamProviderModule, 'makeStreamProvider').mockReturnValue(
      makeStreamProviderStub({ value: false }) as any,
    );

    process.env.OPENAGENTIC_PROXY_URL = 'http://openagentic-proxy:3300';
    process.env.OPENAGENTIC_PROXY_INTERNAL_KEY = 'real-prod-key-XXXXX';

    const emit = vi.fn();
    const ctx = makeRunCtx(emit);
    const input: any = {
      userMessage: 'Audit IAM drift',
      priorMessages: [],
      model: 'whatever-model',
      attachments: [],
      maxTurns: 12,
    };
    const deps: any = {
      providerManager: {} as any,
      executeMcpTool: vi.fn(),
      listAgents: async () => [
        { agent_type: 'cloud_operations', display_name: 'Cloud Ops', description: 'X' },
      ],
      runSubagent: vi.fn(),
      prismaLike: undefined,
    };

    const result = await runChat(ctx as any, input, deps);

    // Loop should still complete cleanly (synthesis on the failure path).
    expect(result.ok).toBe(true);
    // sub_agent_completed frame carries ok:false + error from proxy
    const subagentCompletedCalls = emit.mock.calls.filter((c: any[]) => c[0] === 'sub_agent_completed');
    expect(subagentCompletedCalls.length).toBe(1);
    expect(subagentCompletedCalls[0][1].ok).toBe(false);
    expect(subagentCompletedCalls[0][1].error).toMatch(/ECONNREFUSED/);
  });
});
