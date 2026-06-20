/**
 * Phase E.8.e — makeRunSubagentViaRecursor tests.
 *
 * Wires TaskTool's `deps.runSubagent` to dispatch via `chatLoopRecursor`
 * instead of the legacy `SubagentOrchestrator.orchestrate()`. This factory
 * is the strangler-mode replacement for `makeRunSubagent` from
 * buildChatV2Deps; the chat path uses it when buildChatV2Deps is invoked
 * with `useRecursor: true`.
 *
 * See the design notes for the three-layer architecture.
 *
 * TDD red→green. The factory does NOT exist when this file is written.
 *
 * Real-data discipline (feedback_no_synthetic_chunks_only_real_provider_captures.md):
 * unit tests stub `parentDeps.streamProvider` because the factory's
 * contract is purely about wiring (spec.prompt → userPrompt, agent
 * lookup → systemPrompt + tools, parentCtx + parentDeps + parentSequencer
 * + parentTurnId forwarded unchanged). The real-provider Ollama smoke
 * test at the bottom of this file is the one place we drive a sub-agent
 * dispatch end-to-end against a real LLM via TaskTool → recursor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeRunSubagentViaRecursor,
  makeRunSubagentViaRecursorPerCall,
  RECURSOR_CTX_SLOTS,
} from '../makeRunSubagentViaRecursor.js';
import { executeTask } from '../TaskTool.js';
import { EventSequencer } from '../../infra/event-sequencer.js';
import { AgentEventStore } from '../AgentEventStore.js';
import type {
  RunCtx,
  ChatLoopDeps,
  StreamEvent,
} from '../../routes/chat/pipeline/chat/types.js';
import type { BuiltInAgentRegistryEntry } from '../BuiltInAgentRegistry.js';
import type { SubagentSpec, AgentRegistryEntry } from '../TaskTool.js';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeParentCtx(overrides: Partial<RunCtx> = {}): RunCtx {
  return {
    emit: vi.fn(),
    logger: makeLogger(),
    sessionId: 'parent-session',
    userId: 'parent-user',
    ...overrides,
  };
}

function makeTextThenEndStream() {
  return async function* () {
    const events: StreamEvent[] = [
      { type: 'text_delta', text: 'sub synthesis here' },
      { type: 'message_stop', stop_reason: 'end_turn' },
    ];
    for (const e of events) yield e;
  };
}

function makeParentDeps(streamProvider?: any, dispatch?: any): ChatLoopDeps {
  return {
    streamProvider: streamProvider ?? (makeTextThenEndStream() as any),
    dispatch: dispatch ?? vi.fn(async () => ({ ok: true, output: '' })),
  };
}

function makeAgent(
  partial: Partial<BuiltInAgentRegistryEntry> & { agent_type: string },
): BuiltInAgentRegistryEntry {
  return {
    agent_type: partial.agent_type,
    display_name: partial.display_name ?? 'Test Agent',
    description: partial.description ?? 'test description',
    tools: partial.tools ?? [],
    body: partial.body ?? 'You are a test sub-agent.',
  };
}

describe('makeRunSubagentViaRecursor — Phase E.8.e (unit)', () => {
  describe('callable surface', () => {
    it('returns a runSubagent function that yields the SubagentRunResult shape', async () => {
      const parentCtx = makeParentCtx({ turnId: 'turn-1' } as any);
      const parentDeps = makeParentDeps();
      const parentSequencer = new EventSequencer({ runId: 'run-1' });
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-1',
        getAgents,
      });

      const spec: SubagentSpec = {
        role: 'general-purpose',
        prompt: 'hello sub-agent',
        description: 'short label',
      };

      const result = await runSubagent(spec, parentCtx);

      expect(result).toMatchObject({
        ok: expect.any(Boolean),
        turns: expect.any(Number),
        tokens: expect.any(Number),
        durationMs: expect.any(Number),
        toolsUsed: expect.any(Array),
      });
      expect(result.ok).toBe(true);
      expect(result.output ?? '').toContain('sub synthesis here');
    });
  });

  describe('spec.prompt → userPrompt wiring', () => {
    it('passes spec.prompt verbatim to the child chatLoop as the user message', async () => {
      let seenUserMessage = '';
      const streamProvider = vi.fn(async function* (req: any) {
        const userMsg = (req.messages ?? []).find((m: any) => m.role === 'user');
        seenUserMessage =
          typeof userMsg?.content === 'string'
            ? userMsg.content
            : JSON.stringify(userMsg?.content ?? '');
        const events: StreamEvent[] = [
          { type: 'text_delta', text: 'ok' },
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });

      const parentCtx = makeParentCtx();
      const parentDeps = makeParentDeps(streamProvider);
      const parentSequencer = new EventSequencer({ runId: 'run-prompt' });
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-prompt',
        getAgents,
      });

      const verbatim = 'Audit IAM drift across all accounts and return diffs.';
      await runSubagent(
        {
          role: 'general-purpose',
          prompt: verbatim,
          description: 'iam drift',
        },
        parentCtx,
      );

      expect(seenUserMessage).toBe(verbatim);
    });
  });

  describe('agent-registry lookup → systemPrompt + tools', () => {
    it('resolves spec.role through the registry; child loop gets agentSpec.systemPrompt + tools', async () => {
      let seenSystem = '';
      const streamProvider = vi.fn(async function* (req: any) {
        seenSystem = req.system ?? '';
        const events: StreamEvent[] = [
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });

      const parentCtx = makeParentCtx();
      const parentDeps = makeParentDeps(streamProvider);
      const parentSequencer = new EventSequencer({ runId: 'run-sys' });
      const customBody = 'You are a SPECIALIZED reconnaissance agent.';
      const getAgents = () => [
        makeAgent({
          agent_type: 'cloud-operations',
          body: customBody,
          tools: ['azure_*', 'aws_*'],
        }),
        makeAgent({ agent_type: 'general-purpose', body: 'general' }),
      ];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-sys',
        getAgents,
      });

      await runSubagent(
        {
          role: 'cloud-operations',
          prompt: 'list things',
          description: 'list',
        },
        parentCtx,
      );

      expect(seenSystem).toBe(customBody);
    });

    it('returns {ok:false, error: /unknown agent/i} when spec.role is not in the registry', async () => {
      const parentCtx = makeParentCtx();
      const parentDeps = makeParentDeps();
      const parentSequencer = new EventSequencer({ runId: 'run-bad' });
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-bad',
        getAgents,
      });

      const result = await runSubagent(
        {
          role: 'completely-fake-agent',
          prompt: 'noop',
          description: 'noop',
        },
        parentCtx,
      );

      expect(result.ok).toBe(false);
      expect(result.error ?? '').toMatch(/unknown agent/i);
      expect(result.turns).toBe(0);
      expect(result.toolsUsed).toEqual([]);
    });

    it('agent_type lookup tries `_`→`-` substitution for legacy slug forms', async () => {
      // The legacy chat path tolerates both `cloud_operations` and
      // `cloud-operations` slug forms. The factory must keep that for
      // back-compat (the model is trained on legacy prompts that use
      // either form).
      let seenSystem = '';
      const streamProvider = vi.fn(async function* (req: any) {
        seenSystem = req.system ?? '';
        const events: StreamEvent[] = [
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });

      const parentCtx = makeParentCtx();
      const parentDeps = makeParentDeps(streamProvider);
      const parentSequencer = new EventSequencer({ runId: 'run-alt' });
      const getAgents = () => [
        makeAgent({
          agent_type: 'cloud-operations',
          body: 'cloud-ops body',
        }),
      ];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-alt',
        getAgents,
      });

      const result = await runSubagent(
        {
          role: 'cloud_operations', // underscored — legacy form
          prompt: 'task',
          description: 'task',
        },
        parentCtx,
      );

      expect(result.ok).toBe(true);
      expect(seenSystem).toBe('cloud-ops body');
    });
  });

  describe('parentCtx + parentDeps + parentSequencer + parentTurnId forwarding', () => {
    it('the child chatLoop sees the parent streamProvider verbatim', async () => {
      const parentStreamProvider = vi.fn(async function* () {
        const events: StreamEvent[] = [
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });

      const parentCtx = makeParentCtx();
      const parentDeps: ChatLoopDeps = {
        streamProvider: parentStreamProvider as any,
        dispatch: vi.fn(async () => ({ ok: true, output: '' })),
      };
      const parentSequencer = new EventSequencer({ runId: 'run-fwd' });
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-fwd',
        getAgents,
      });

      await runSubagent(
        {
          role: 'general-purpose',
          prompt: 'task',
          description: 'task',
        },
        parentCtx,
      );

      expect(parentStreamProvider).toHaveBeenCalled();
    });

    it('publishes agent_start + agent_complete keyed on parentTurnId', async () => {
      const store = new AgentEventStore();
      const received: any[] = [];
      const unsubscribe = store.subscribe('turn-pub', (e) => received.push(e));

      try {
        const parentCtx = makeParentCtx();
        const parentDeps = makeParentDeps();
        const parentSequencer = new EventSequencer({ runId: 'run-pub' });
        const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

        const runSubagent = makeRunSubagentViaRecursor({
          parentCtx,
          parentDeps,
          parentSequencer,
          parentTurnId: 'turn-pub',
          getAgents,
          // Test-only: override the AgentEventStore singleton so we capture
          // publishes without leaking through the module-global. Mirrors
          // the test-only escape hatch on chatLoopRecursor itself.
          __agentEventStoreForTests: store,
        });

        const result = await runSubagent(
          {
            role: 'general-purpose',
            prompt: 'task',
            description: 'task',
          },
          parentCtx,
        );

        expect(result.ok).toBe(true);
        // ≥2 events (start + complete) — both keyed on the parentTurnId.
        expect(received.length).toBeGreaterThanOrEqual(2);
        for (const e of received) {
          expect(e.turnId).toBe('turn-pub');
        }
        const types = received.map((e) => e.event);
        expect(types).toContain('agent_start');
        expect(types).toContain('agent_complete');
      } finally {
        unsubscribe();
      }
    });
  });

  describe('spec.model + timeout passthrough', () => {
    it('spec.model overrides agent default in the child chatLoop request', async () => {
      let seenModel: string | undefined;
      const streamProvider = vi.fn(async function* (req: any) {
        seenModel = req.model;
        const events: StreamEvent[] = [
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });

      const parentCtx = makeParentCtx();
      const parentDeps = makeParentDeps(streamProvider);
      const parentSequencer = new EventSequencer({ runId: 'run-mod' });
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-mod',
        getAgents,
      });

      await runSubagent(
        {
          role: 'general-purpose',
          prompt: 'task',
          description: 'task',
          model: 'override-model-id',
        },
        parentCtx,
      );

      expect(seenModel).toBe('override-model-id');
    });

    it('chatLoopRecursor timeout propagates through to a {ok:false, error: /timeout/i} result', async () => {
      // Slow stream — yields nothing within the budget.
      const streamProvider = vi.fn(async function* () {
        await new Promise((r) => setTimeout(r, 200));
        const events: StreamEvent[] = [
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });

      const parentCtx = makeParentCtx();
      const parentDeps = makeParentDeps(streamProvider);
      const parentSequencer = new EventSequencer({ runId: 'run-to' });
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-to',
        getAgents,
        defaultTimeoutMs: 50,
      });

      const result = await runSubagent(
        {
          role: 'general-purpose',
          prompt: 'task',
          description: 'task',
        },
        parentCtx,
      );

      expect(result.ok).toBe(false);
      expect(result.error ?? '').toMatch(/timeout|timed.?out/i);
    });
  });

  describe('per-call variant (plugin-init wiring path)', () => {
    it('extracts parentDeps/parentSequencer/parentTurnId from parentCtx slots and dispatches', async () => {
      const streamProvider = vi.fn(async function* () {
        const events: StreamEvent[] = [
          { type: 'text_delta', text: 'per-call ok' },
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });

      const parentDeps = makeParentDeps(streamProvider);
      const parentSequencer = new EventSequencer({ runId: 'run-pc' });
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

      const runSubagent = makeRunSubagentViaRecursorPerCall({ getAgents });

      // Caller stamps the per-turn handles onto the ctx before dispatching.
      const parentCtx: any = {
        ...makeParentCtx(),
        [RECURSOR_CTX_SLOTS.parentDeps]: parentDeps,
        [RECURSOR_CTX_SLOTS.parentSequencer]: parentSequencer,
        [RECURSOR_CTX_SLOTS.parentTurnId]: 'turn-pc',
      };

      const result = await runSubagent(
        {
          role: 'general-purpose',
          prompt: 'task',
          description: 'task',
        },
        parentCtx,
      );

      expect(result.ok).toBe(true);
      expect(result.output ?? '').toContain('per-call ok');
    });

    it('returns {ok:false, error: /not wired/i} when parentCtx is undefined', async () => {
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];
      const runSubagent = makeRunSubagentViaRecursorPerCall({ getAgents });

      const result = await runSubagent(
        {
          role: 'general-purpose',
          prompt: 'task',
          description: 'task',
        },
        undefined,
      );

      expect(result.ok).toBe(false);
      expect(result.error ?? '').toMatch(/not wired/i);
    });

    it('returns a structured error listing missing slots when parentCtx is incomplete', async () => {
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];
      const runSubagent = makeRunSubagentViaRecursorPerCall({ getAgents });

      // Caller stamped one slot but forgot the others — should surface a
      // structured error rather than crash the turn.
      const parentCtx: any = {
        ...makeParentCtx(),
        [RECURSOR_CTX_SLOTS.parentTurnId]: 'turn-bad',
      };

      const result = await runSubagent(
        {
          role: 'general-purpose',
          prompt: 'task',
          description: 'task',
        },
        parentCtx,
      );

      expect(result.ok).toBe(false);
      expect(result.error ?? '').toMatch(/parentDeps/);
      expect(result.error ?? '').toMatch(/parentSequencer/);
    });
  });

  describe('TaskTool → makeRunSubagentViaRecursor integration', () => {
    it('TaskTool.executeTask calls deps.runSubagent and surfaces the child loop result', async () => {
      const streamProvider = vi.fn(async function* () {
        const events: StreamEvent[] = [
          { type: 'text_delta', text: 'integration ok' },
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });

      const parentCtx = makeParentCtx({
        sessionId: 'parent-session-int',
        userId: 'parent-user-int',
      });
      const parentDeps = makeParentDeps(streamProvider);
      const parentSequencer = new EventSequencer({ runId: 'run-int' });
      const getAgents = () => [makeAgent({ agent_type: 'general-purpose' })];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'turn-int',
        getAgents,
      });

      // Adapter from BuiltInAgentRegistryEntry → AgentRegistryEntry shape
      // TaskTool's listSubagentTypes consumes. The factory does not need
      // this; the chat plugin's deps factory does.
      const agentRegistryEntries: AgentRegistryEntry[] = getAgents().map(
        (a) => ({
          agent_type: a.agent_type,
          display_name: a.display_name,
          description: a.description,
        }),
      );

      const result = await executeTask(
        {
          emit: vi.fn(),
          logger: makeLogger(),
          sessionId: 'parent-session-int',
          userId: 'parent-user-int',
        } as any,
        {
          description: 'short label',
          prompt: 'do the thing',
          subagent_type: 'general-purpose',
        },
        {
          listSubagentTypes: async () => agentRegistryEntries,
          runSubagent,
        },
      );

      expect(result.ok).toBe(true);
      expect(result.output ?? '').toContain('integration ok');
      expect(result.stats?.turns).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============================================================================
// Real-provider smoke (Ollama on gpu-node:11434 — gpt-oss:20b).
// Skipped automatically when gpu-node:11434 is unreachable. Per
// feedback_real_provider_testing_regime_chatmode_pivot.md, this is the
// MANDATORY wire-level test for Phase E.8.e — TaskTool → recursor → real
// provider end-to-end. Pattern reused verbatim from chatLoopRecursor.test.ts.
// ============================================================================
const OLLAMA_CANDIDATES: string[] = [
  process.env.TEST_OLLAMA_BASE_URL ?? '',
  'http://gpu-node:11434',
  'http://192.0.2.10:11434',
  process.env.OLLAMA_BASE_URL ?? '',
].filter(Boolean);

let resolvedOllamaBase = '';

async function probeOllama(base: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function isOllamaReachable(): Promise<boolean> {
  for (const base of OLLAMA_CANDIDATES) {
    if (await probeOllama(base)) {
      resolvedOllamaBase = base;
      return true;
    }
  }
  return false;
}

describe('makeRunSubagentViaRecursor — real-provider smoke (Ollama gpt-oss:20b on the GPU node)', () => {
  let ollamaUp = false;
  beforeEach(async () => {
    ollamaUp = await isOllamaReachable();
  });

  it(
    'TaskTool → makeRunSubagentViaRecursor → chatLoopRecursor → real Ollama: ≥1 text_delta envelope reaches parent emit',
    async () => {
      if (!ollamaUp) {
        // eslint-disable-next-line no-console
        console.warn(
          `[makeRunSubagentViaRecursor.smoke] Ollama unreachable on candidates [${OLLAMA_CANDIDATES.join(
            ', ',
          )}] — BLOCKED`,
        );
        return;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[makeRunSubagentViaRecursor.smoke] using Ollama at ${resolvedOllamaBase}`,
      );

      // Hand-roll the streamProvider to drive Ollama's /api/chat with
      // stream=true and translate to canonical StreamEvent shapes. Same
      // pattern as chatLoopRecursor.test.ts:452-512 — keeps the smoke scoped
      // to "does the wire run end-to-end" without coupling to SDK
      // versioning. The recursor's contract is at the StreamEvent
      // boundary; this is the canonical wire test for it.
      const realStreamProvider = async function* (
        req: any,
      ): AsyncIterable<StreamEvent> {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 25_000);
        const body = {
          model: req.model,
          messages: [
            { role: 'system', content: req.system ?? '' },
            ...req.messages.map((m: any) => ({
              role: m.role,
              content:
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
            })),
          ],
          stream: true,
        };
        const res = await fetch(`${resolvedOllamaBase}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          clearTimeout(t);
          throw new Error(`ollama HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              const s = line.trim();
              if (!s) continue;
              try {
                const chunk = JSON.parse(s);
                const text = chunk?.message?.content;
                if (typeof text === 'string' && text.length > 0) {
                  yield { type: 'text_delta', text };
                }
                if (chunk.done) {
                  yield { type: 'message_stop', stop_reason: 'end_turn' };
                  clearTimeout(t);
                  return;
                }
              } catch {
                /* skip malformed line */
              }
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            /* ignore */
          }
          clearTimeout(t);
        }
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      };

      const emitted: Array<{ op: string; payload: any }> = [];
      const parentCtx: RunCtx = {
        emit: (op, payload) => emitted.push({ op, payload }),
        logger: makeLogger(),
        sessionId: 'real-session',
        userId: 'real-user',
      };
      const parentDeps: ChatLoopDeps = {
        streamProvider: realStreamProvider as any,
        dispatch: vi.fn(),
      };
      const parentSequencer = new EventSequencer({ runId: 'real-run' });

      const getAgents = () => [
        makeAgent({
          agent_type: 'general-purpose',
          body: 'You are a brief assistant. Reply in one short sentence.',
        }),
      ];

      const runSubagent = makeRunSubagentViaRecursor({
        parentCtx,
        parentDeps,
        parentSequencer,
        parentTurnId: 'real-turn',
        getAgents,
        defaultMaxIterations: 1,
      });

      const taskCtxEmits: Array<{ op: string; payload: any }> = [];
      const result = await executeTask(
        {
          emit: (op, payload) => taskCtxEmits.push({ op, payload }),
          logger: makeLogger(),
          sessionId: 'real-session',
          userId: 'real-user',
        } as any,
        {
          description: 'real smoke',
          prompt: 'Say hello in five words or less.',
          subagent_type: 'general-purpose',
          model: 'gpt-oss:20b',
        },
        {
          listSubagentTypes: async () => [
            {
              agent_type: 'general-purpose',
              display_name: 'General Purpose',
              description: 'general',
            },
          ],
          runSubagent,
        },
      );

      const textOps = emitted.filter((e) => e.op === '0');
      // eslint-disable-next-line no-console
      console.log(
        `[makeRunSubagentViaRecursor.smoke] result: ok=${result.ok}, textDeltas=${textOps.length}, output=${(result.output ?? '').slice(0, 80)}`,
      );

      expect(result.ok).toBe(true);
      expect(textOps.length).toBeGreaterThan(0);
      // toolsUsed is an array (may be empty — that's fine for "hello").
      expect(Array.isArray(result.stats?.toolsUsed)).toBe(true);
    },
    30_000,
  );
});
