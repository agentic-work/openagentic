/**
 * Sev-0 #927 (2026-05-17) — sub-agent dispatch in chat mode crashes with
 * "Cannot read properties of undefined (reading 'length')" when the parent
 * model dispatches a `cloud_operations` sub-agent.
 *
 * Live observation on `0.7.1-87b85a9b` capstone drive (turnId
 * 67b11415-62e0-454e-8836-31ffbde089a3): the cloud-operations sub-agent
 * errored at 4.6s with a length-on-undefined TypeError. The model recovered
 * honestly with "the sub-agent hit an internal schema-validation error on
 * the structured output. Let me re-run it without the output schema
 * constraint" — but the actual crash was unrelated to the output schema:
 * OpenAgenticProxyClient sent a body WITHOUT `userGroups`, the openagentic-proxy
 * execute-sync handler's internal-caller-with-userId branch kept the body
 * as-is (skipping the body.userGroups = user.groups override since the body
 * already carried a real userId), the orchestrator passed `request.userGroups
 * = undefined` into RunContext, and AgentRunner.buildAuthHeaders did
 * `ctx.userGroups.length` (NOT optional-chained) — TypeError.
 *
 * Fix layers (defense-in-depth):
 *   1. api side — OpenAgenticProxyClient ALWAYS sends `userGroups: []` +
 *      `authMethod: 'internal'` so the proxy never sees an under-shaped body.
 *   2. openagentic-proxy side — AgentRunner.buildAuthHeaders defensively reads
 *      `ctx.userGroups?.length ?? 0` so any future caller that omits the
 *      field doesn't crash mid-tool-loop. (Out-of-scope for this api test;
 *      pinned by a separate openagentic-proxy test.)
 *
 * This test file covers layer 1 — the api side contract that locks in the
 * shape OpenAgenticProxyClient sends to the proxy.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAgenticProxyClient } from '../OpenAgenticProxyClient.js';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeClient(fetchImpl: any) {
  return new OpenAgenticProxyClient({
    baseUrl: 'http://openagentic-proxy:3300',
    internalKey: 'real-prod-key-XXXXX',
    logger: makeLogger(),
    fetchImpl,
  });
}

function okResultsResponse(): any {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      executionId: 'e',
      status: 'completed',
      results: [
        {
          agentId: 'a1',
          role: 'cloud_operations',
          status: 'success',
          output: 'sub-agent done',
          metrics: { costCents: 0, durationMs: 100, inputTokens: 0, outputTokens: 0 },
          toolCallsExecuted: [],
        },
      ],
    }),
  };
}

describe('#927 — OpenAgenticProxyClient body shape locks in safe defaults', () => {
  // The body the api sends to openagentic-proxy MUST be self-sufficient on the
  // identity fields that downstream RunContext consumes — even though the
  // proxy's execute-sync handler will overwrite them when the caller is
  // anonymous, the internal-caller-with-userId path SKIPS that overwrite
  // (see services/openagentic-proxy/src/routes/execute.ts:68-74). Without these
  // defaults, RunContext.userGroups is undefined and AgentRunner crashes
  // on `.length` access mid-tool-loop.

  it('RED — body MUST include userGroups: [] so downstream RunContext.userGroups is never undefined', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResultsResponse());
    const client = makeClient(fetchImpl);

    await client.executeAgent({
      userId: 'user-1',
      sessionId: 'session-1',
      parentToolUseId: 'tool-use-abc',
      agentName: 'cloud_operations',
      task: 'audit IAM drift across accounts',
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.userGroups, 'userGroups must be present so RunContext.userGroups is an array, not undefined').toBeDefined();
    expect(Array.isArray(body.userGroups)).toBe(true);
  });

  it('RED — body MUST include authMethod so RunContext.authMethod is a string, not undefined', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResultsResponse());
    const client = makeClient(fetchImpl);

    await client.executeAgent({
      userId: 'user-1',
      sessionId: 'session-1',
      parentToolUseId: 'tool-use-abc',
      agentName: 'cloud_operations',
      task: 'audit IAM drift across accounts',
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.authMethod, 'authMethod must be present so RunContext.authMethod is a string, not undefined').toBeDefined();
    expect(typeof body.authMethod).toBe('string');
  });

  it('RED — body MUST include isAdmin so RunContext.isAdmin is a boolean, not undefined', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResultsResponse());
    const client = makeClient(fetchImpl);

    await client.executeAgent({
      userId: 'user-1',
      sessionId: 'session-1',
      parentToolUseId: 'tool-use-abc',
      agentName: 'cloud_operations',
      task: 'audit IAM drift across accounts',
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.isAdmin, 'isAdmin must be present so RunContext.isAdmin is a boolean, not undefined').toBeDefined();
    expect(typeof body.isAdmin).toBe('boolean');
  });

  it('reproduces the Sev-0 crash signature when buildAuthHeaders-shaped logic reads ctx.userGroups.length', () => {
    // Inline reproduction of the EXACT crash shape:
    //   services/openagentic-proxy/src/services/AgentRunner.ts:999
    //   if (ctx.userGroups.length) headers['X-User-Groups'] = ctx.userGroups.join(',');
    //
    // Pre-fix shape (openagentic-proxy raw access) — crashes with the live error
    // message verbatim:
    const ctxWithUndefinedGroups = {
      userId: 'u', authMethod: 'internal', isAdmin: false,
      userGroups: undefined as unknown as string[],
    };
    const rawAccess = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx: any = ctxWithUndefinedGroups;
      // Mirrors AgentRunner.buildAuthHeaders:999 line-for-line.
      if (ctx.userGroups.length) {
        ctx.userGroups.join(',');
      }
    };
    expect(rawAccess).toThrow(/Cannot read properties of undefined.*length/);

    // Post-fix shape — defensive optional-chain. Same input, no throw:
    const safeAccess = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx: any = ctxWithUndefinedGroups;
      // The fix replaces `ctx.userGroups.length` with `(ctx.userGroups?.length ?? 0)`.
      if ((ctx.userGroups?.length ?? 0) > 0) {
        ctx.userGroups.join(',');
      }
    };
    expect(safeAccess).not.toThrow();
  });
});
