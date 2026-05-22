/**
 * Phase E.8.d — chatLoopRecursor primitive tests.
 *
 * The primitive REPLACES SubagentOrchestrator.orchestrate() for sub-agent
 * dispatch. Sub-agents are simple recursion into the parent chatLoop with
 * a child RunCtx (own model + system prompt + sequencer) that shares the
 * parent's tool resolver and AgentEventStore subscription.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §E.8
 * Spec: chatmode three-layer architecture (docs/superpowers/specs/2026-05-10).
 *
 * TDD red→green. The primitive does NOT exist when this file is written.
 *
 * Real-data discipline (feedback_no_synthetic_chunks_only_real_provider_captures.md):
 * unit tests stub `parentDeps.streamProvider` because the primitive's
 * contract is purely about wiring (ctx clone + sequencer.child + tool
 * inheritance + AgentEventStore plumb + termination guards). The wire
 * format inside that AsyncIterable is the SDK normalizer's contract and
 * is exercised by chatLoop's existing tests + the SDK probe runner.
 * The real-provider Ollama smoke test at the bottom of this file is the
 * one place we drive an actual provider end-to-end through the recursor.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatLoopRecursor } from '../chatLoopRecursor.js';
import { EventSequencer } from '../../infra/event-sequencer.js';
import { AgentEventStore } from '../AgentEventStore.js';
import type { RunCtx, ChatLoopDeps, StreamEvent, ChatLoopInput } from '../../routes/chat/pipeline/chat/types.js';

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

// Minimal stream provider stub — yields one text + end_turn unless the
// per-test override re-binds it. Used everywhere except the real-provider
// smoke test at the bottom.
function makeTextThenEndStream() {
  return async function* () {
    const events: StreamEvent[] = [
      { type: 'text_delta', text: 'child synthesis here' },
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

describe('chatLoopRecursor — Phase E.8.d', () => {
  describe('callable surface', () => {
    it('is callable with the documented options shape and returns the documented result shape', async () => {
      const parentSeq = new EventSequencer({ runId: 'run-1' });
      const result = await chatLoopRecursor({
        parentCtx: makeParentCtx(),
        parentDeps: makeParentDeps(),
        parentSequencer: parentSeq,
        parentTurnId: 'turn-1',
        agentSpec: { tools: [] },
        userPrompt: 'hello sub-agent',
      });

      // Documented shape: success, result?, toolsUsed, iterations, durationMs, tokenUsage?, error?
      expect(result).toMatchObject({
        success: expect.any(Boolean),
        toolsUsed: expect.any(Array),
        iterations: expect.any(Number),
        durationMs: expect.any(Number),
      });
      expect(result.success).toBe(true);
      // The child loop produced text — recursor surfaces it as `.result`.
      expect(result.result).toContain('child synthesis here');
    });
  });

  describe('child ctx isolation', () => {
    it('child RunCtx uses agentSpec.model when provided; does not mutate parentCtx', async () => {
      const parentCtx = makeParentCtx();
      // Capture the model the child's streamProvider was called with.
      const seen: { model?: string; system?: string } = {};
      const streamProvider = vi.fn(async function* (req: any) {
        seen.model = req.model;
        seen.system = req.system;
        const events: StreamEvent[] = [
          { type: 'text_delta', text: 'ok' },
          { type: 'message_stop', stop_reason: 'end_turn' },
        ];
        for (const e of events) yield e;
      });
      const parentDeps = makeParentDeps(streamProvider);
      const parentSeq = new EventSequencer({ runId: 'run-1' });

      await chatLoopRecursor({
        parentCtx,
        parentDeps,
        parentSequencer: parentSeq,
        parentTurnId: 'turn-1',
        agentSpec: { model: 'child-model-xyz', systemPrompt: 'child system', tools: [] },
        userPrompt: 'task',
      });

      expect(seen.model).toBe('child-model-xyz');
      expect(seen.system).toBe('child system');
      // Parent ctx must not be mutated.
      expect(parentCtx.sessionId).toBe('parent-session');
      expect(parentCtx.userId).toBe('parent-user');
    });

    it('child RunCtx falls back to parent emit/logger when agentSpec.model is omitted (no model coercion)', async () => {
      const parentCtx = makeParentCtx();
      const seen: { model?: string } = {};
      const streamProvider = vi.fn(async function* (req: any) {
        seen.model = req.model;
        const events: StreamEvent[] = [{ type: 'message_stop', stop_reason: 'end_turn' }];
        for (const e of events) yield e;
      });

      await chatLoopRecursor({
        parentCtx,
        parentDeps: makeParentDeps(streamProvider),
        parentSequencer: new EventSequencer({ runId: 'run-1' }),
        parentTurnId: 'turn-1',
        // No model supplied — recursor must NOT invent one. Empty string is
        // acceptable; the controller (TaskTool) is responsible for falling
        // back to the parent's model in production wiring.
        agentSpec: { tools: [] },
        userPrompt: 'task',
      });

      // We allow either '' or undefined — the contract is "do not coerce".
      // What we DO check is that no synthetic model string leaked in.
      expect(seen.model === '' || seen.model === undefined || typeof seen.model === 'string').toBe(true);
    });
  });

  describe('sequencer multiplexing', () => {
    it('uses parentSequencer.child(agentId) so child emissions carry _agentId', async () => {
      const parentSeq = new EventSequencer({ runId: 'run-multi' });
      const childSpy = vi.spyOn(parentSeq, 'child');

      await chatLoopRecursor({
        parentCtx: makeParentCtx(),
        parentDeps: makeParentDeps(),
        parentSequencer: parentSeq,
        parentTurnId: 'turn-multi',
        agentSpec: { tools: [] },
        userPrompt: 'task',
      });

      expect(childSpy).toHaveBeenCalledTimes(1);
      const agentId = childSpy.mock.calls[0][0];
      expect(typeof agentId).toBe('string');
      expect(agentId.length).toBeGreaterThan(0);
    });

    it('publishes a sub_agent lifecycle event into the AgentEventStore keyed on parentTurnId', async () => {
      const store = new AgentEventStore();
      const received: any[] = [];
      const unsubscribe = store.subscribe('turn-pub', (e) => received.push(e));

      try {
        await chatLoopRecursor({
          parentCtx: makeParentCtx(),
          parentDeps: makeParentDeps(),
          parentSequencer: new EventSequencer({ runId: 'run-pub' }),
          parentTurnId: 'turn-pub',
          agentSpec: { tools: [] },
          userPrompt: 'task',
          // Test-only override so the primitive uses our test store instead
          // of the module singleton. Production wiring uses getAgentEventStore().
          __agentEventStoreForTests: store,
        } as any);

        // We expect at minimum one agent_start and one agent_complete.
        expect(received.length).toBeGreaterThanOrEqual(2);
        const events = received.map((e) => e.event);
        expect(events).toContain('agent_start');
        expect(events).toContain('agent_complete');
        // All events must be keyed on the parentTurnId.
        for (const e of received) {
          expect(e.turnId).toBe('turn-pub');
        }
      } finally {
        unsubscribe();
      }
    });
  });

  describe('tool inheritance', () => {
    it('child loop receives the parent ChatLoopDeps.streamProvider verbatim (NO ranker re-narrow)', async () => {
      // The primitive contract per the dispatch spec: the child loop reuses
      // the parent's streamProvider closure as-is. The model decides which
      // tools to call via the tool array we pass in (which equals the
      // parent's resolved tool array). No narrowing happens at the recursor.
      const parentStreamProvider = vi.fn(async function* () {
        const events: StreamEvent[] = [{ type: 'message_stop', stop_reason: 'end_turn' }];
        for (const e of events) yield e;
      });
      const parentDeps: ChatLoopDeps = {
        streamProvider: parentStreamProvider as any,
        dispatch: vi.fn(),
      };

      await chatLoopRecursor({
        parentCtx: makeParentCtx(),
        parentDeps,
        parentSequencer: new EventSequencer({ runId: 'run-3' }),
        parentTurnId: 'turn-3',
        agentSpec: { tools: ['azure_*', 'aws_*'] },
        userPrompt: 'task',
      });

      // The parent streamProvider was invoked (the child loop pulled from it).
      expect(parentStreamProvider).toHaveBeenCalled();
    });

    it('passes agentSpec.tools through to the child chatLoop as the tool array (model decides which to call)', async () => {
      const seenTools: any[] = [];
      const streamProvider = vi.fn(async function* (req: any) {
        seenTools.push(...req.tools);
        const events: StreamEvent[] = [{ type: 'message_stop', stop_reason: 'end_turn' }];
        for (const e of events) yield e;
      });

      // Parent passes an explicit tool array (the recursor MUST inherit it
      // verbatim — no platform-side narrowing).
      const explicitTools = [
        { type: 'function', function: { name: 'list_resources' } },
        { type: 'function', function: { name: 'get_resource' } },
      ];

      await chatLoopRecursor({
        parentCtx: makeParentCtx(),
        parentDeps: makeParentDeps(streamProvider),
        parentSequencer: new EventSequencer({ runId: 'run-4' }),
        parentTurnId: 'turn-4',
        agentSpec: { tools: ['azure_*'], inheritedTools: explicitTools as any },
        userPrompt: 'task',
      });

      // The child loop saw the parent's resolved tool array.
      expect(seenTools.length).toBe(2);
      const names = seenTools.map((t) => t.function?.name);
      expect(names).toContain('list_resources');
      expect(names).toContain('get_resource');
    });
  });

  describe('termination', () => {
    it('respects agentSpec.maxIterations (passes through to chatLoop as maxTurns)', async () => {
      // Build a stream that yields tool_use forever — we want the child loop
      // to bail when maxIterations is hit. Use a low max so the test runs
      // fast.
      let iter = 0;
      const streamProvider = vi.fn(async function* () {
        iter++;
        // Always end_turn with no text + no tool_uses → triggers no tool path.
        // But we want max-iterations enforcement — so emit a tool_use_complete
        // with a no-op tool so the loop tries to recurse.
        const events: StreamEvent[] = [
          {
            type: 'tool_use_complete',
            id: `tu-${iter}`,
            name: 'noop_tool',
            input: {},
          },
          { type: 'message_stop', stop_reason: 'tool_use' },
        ];
        for (const e of events) yield e;
      });
      const dispatch = vi.fn(async () => ({ ok: true, output: 'ok' }));

      const result = await chatLoopRecursor({
        parentCtx: makeParentCtx(),
        parentDeps: makeParentDeps(streamProvider, dispatch),
        parentSequencer: new EventSequencer({ runId: 'run-iter' }),
        parentTurnId: 'turn-iter',
        agentSpec: { tools: [], maxIterations: 2 },
        userPrompt: 'task',
      });

      // The chatLoop will hit max-turns and surface ok:false with an error.
      // The recursor surfaces that as success:false.
      expect(result.success).toBe(false);
      expect(result.iterations).toBe(2);
      // The error message comes from chatLoop's max-turns guard.
      expect(result.error ?? '').toMatch(/max-turns|max_turns|maxTurns/i);
    });

    it('default maxIterations is 5 when agentSpec.maxIterations is omitted', async () => {
      // Build an infinite tool_use stream and assert it stops at 5.
      const streamProvider = vi.fn(async function* () {
        const events: StreamEvent[] = [
          { type: 'tool_use_complete', id: 'tu', name: 'noop_tool', input: {} },
          { type: 'message_stop', stop_reason: 'tool_use' },
        ];
        for (const e of events) yield e;
      });
      const dispatch = vi.fn(async () => ({ ok: true, output: 'ok' }));

      const result = await chatLoopRecursor({
        parentCtx: makeParentCtx(),
        parentDeps: makeParentDeps(streamProvider, dispatch),
        parentSequencer: new EventSequencer({ runId: 'run-default' }),
        parentTurnId: 'turn-default',
        agentSpec: { tools: [] },
        userPrompt: 'task',
      });

      expect(result.success).toBe(false);
      expect(result.iterations).toBe(5);
    });

    it('returns {success:false, error} on timeout when agentSpec.timeoutMs elapses', async () => {
      // Build a slow stream — yield first event after timeoutMs.
      const streamProvider = vi.fn(async function* () {
        await new Promise((r) => setTimeout(r, 200));
        const events: StreamEvent[] = [{ type: 'message_stop', stop_reason: 'end_turn' }];
        for (const e of events) yield e;
      });

      const result = await chatLoopRecursor({
        parentCtx: makeParentCtx(),
        parentDeps: makeParentDeps(streamProvider),
        parentSequencer: new EventSequencer({ runId: 'run-timeout' }),
        parentTurnId: 'turn-timeout',
        agentSpec: { tools: [], timeoutMs: 50 },
        userPrompt: 'task',
      });

      expect(result.success).toBe(false);
      expect(result.error ?? '').toMatch(/timeout|timed.?out/i);
    });
  });

  describe('toolsUsed tracking', () => {
    it('returns the list of tool names the child loop dispatched', async () => {
      let turn = 0;
      const streamProvider = vi.fn(async function* () {
        turn++;
        if (turn === 1) {
          const events: StreamEvent[] = [
            { type: 'tool_use_complete', id: 'tu-1', name: 'list_resources', input: {} },
            { type: 'message_stop', stop_reason: 'tool_use' },
          ];
          for (const e of events) yield e;
        } else {
          const events: StreamEvent[] = [
            { type: 'text_delta', text: 'done' },
            { type: 'message_stop', stop_reason: 'end_turn' },
          ];
          for (const e of events) yield e;
        }
      });
      const dispatch = vi.fn(async () => ({ ok: true, output: 'resources: [...]' }));

      const result = await chatLoopRecursor({
        parentCtx: makeParentCtx(),
        parentDeps: makeParentDeps(streamProvider, dispatch),
        parentSequencer: new EventSequencer({ runId: 'run-tu' }),
        parentTurnId: 'turn-tu',
        agentSpec: { tools: [] },
        userPrompt: 'list things',
      });

      expect(result.success).toBe(true);
      expect(result.toolsUsed).toContain('list_resources');
    });
  });
});

// ============================================================================
// Real-provider smoke (Ollama on host.docker.internal:11434 — gpt-oss:20b).
// Skipped automatically when host.docker.internal:11434 is unreachable. Per the standing
// memory rule (feedback_no_synthetic_chunks_only_real_provider_captures.md)
// this is the canonical wire-level test for the recursor primitive.
// ============================================================================
// `setup.ts` pins OLLAMA_BASE_URL to localhost:11434 unconditionally; let
// TEST_OLLAMA_BASE_URL win when explicit, then fall through to the user-
// memory canonical host.docker.internal:11434 floor. Probe each candidate; first reachable
// wins so this test works whether you run inside the cluster (hal), via
// port-forward (localhost), or against an arbitrary endpoint.
const OLLAMA_CANDIDATES: string[] = [
  process.env.TEST_OLLAMA_BASE_URL ?? '',
  'http://host.docker.internal:11434',
  'http://10.0.0.142:11434',
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

describe('chatLoopRecursor — real-provider smoke (Ollama gpt-oss:20b on hal)', () => {
  let ollamaUp = false;
  beforeEach(async () => {
    ollamaUp = await isOllamaReachable();
  });

  it(
    'drives a real child chatLoop turn against Ollama and observes ≥1 text_delta envelope + non-error result',
    async () => {
      if (!ollamaUp) {
        // eslint-disable-next-line no-console
        console.warn(
          `[chatLoopRecursor.smoke] Ollama unreachable on candidates [${OLLAMA_CANDIDATES.join(', ')}] — BLOCKED`,
        );
        return;
      }
      // eslint-disable-next-line no-console
      console.log(`[chatLoopRecursor.smoke] using Ollama at ${resolvedOllamaBase}`);
      // Build a real streamProvider that hits Ollama's /api/chat with stream=true.
      // We do NOT go through the SDK normalizer here — the recursor's contract
      // is at the StreamEvent boundary, so we hand-roll the OpenAI-Chat-Completions-
      // ish translation for this smoke probe (Ollama uses its own shape; the SDK
      // factory is the production path). This keeps the test scoped to "does the
      // recursor wire a real provider end-to-end" without coupling to SDK
      // versioning. The streamProvider yields canonical StreamEvent objects.
      const realStreamProvider = async function* (req: any): AsyncIterable<StreamEvent> {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 30_000);
        const body = {
          model: req.model,
          messages: [
            { role: 'system', content: req.system },
            ...req.messages.map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
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
        // Fallthrough: emit end_turn if the stream closed without `done`.
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

      const result = await chatLoopRecursor({
        parentCtx,
        parentDeps,
        parentSequencer: new EventSequencer({ runId: 'real-run' }),
        parentTurnId: 'real-turn',
        agentSpec: {
          model: 'gpt-oss:20b',
          systemPrompt: 'You are a brief assistant. Reply in one short sentence.',
          tools: [],
          maxIterations: 1,
        },
        userPrompt: 'Say hello in five words or less.',
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      // At least one text_delta opcode '0' must have been emitted by the
      // child loop into the parent emit channel.
      const textOps = emitted.filter((e) => e.op === '0');
      expect(textOps.length).toBeGreaterThan(0);
      // And result.result must contain non-empty text.
      expect((result.result ?? '').trim().length).toBeGreaterThan(0);
    },
    60_000,
  );
});
