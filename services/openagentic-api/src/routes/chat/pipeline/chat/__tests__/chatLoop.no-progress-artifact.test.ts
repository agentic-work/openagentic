/**
 * Bug B — no-progress guard threshold too loose for artifact tools (2026-05-24).
 *
 * Live failure: model emitted 4 separate compose_visual artifacts with the
 * SAME content (fabricated cost table). Today NO_PROGRESS_THRESHOLD = 3 for
 * ALL tools — model can call the same artifact tool with same args up to 2
 * times before the guard fires on the 3rd. For artifact tools, duplicate
 * emission is NEVER useful.
 *
 * Fix: per-tool threshold. Artifact tools (compose_visual, compose_app,
 * render_artifact, generate_image) → threshold 1 (fires on the 2nd identical
 * call). Other tools → 3 (preserved).
 *
 * Test pattern follows chatLoop.noProgressGuard.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';
import type { RunChatDeps } from '../types.js';

function makeStreamProvider(
  script: Array<{
    toolUses?: Array<{ id: string; name: string; input: unknown }>;
    text?: string;
    stop_reason: 'tool_use' | 'end_turn';
  }>,
) {
  let turn = 0;
  return () => {
    const entry = script[turn] ?? {
      text: 'final answer',
      stop_reason: 'end_turn' as const,
    };
    turn += 1;
    return (async function* () {
      if (entry.text) {
        yield { type: 'text_delta' as const, text: entry.text };
      }
      for (const t of entry.toolUses ?? []) {
        yield { type: 'tool_use_start' as const, id: t.id, name: t.name };
        yield {
          type: 'tool_use_delta' as const,
          id: t.id,
          name: t.name,
          inputDelta: JSON.stringify(t.input),
        };
        yield {
          type: 'tool_use_complete' as const,
          id: t.id,
          name: t.name,
          input: t.input,
        };
      }
      yield {
        type: 'message_stop' as const,
        stop_reason: entry.stop_reason,
      } as any;
    })();
  };
}

function makeCtx() {
  const emitted: Array<{ frame: string; payload: unknown }> = [];
  return {
    emit: vi.fn((frame: string, payload: unknown) => {
      emitted.push({ frame, payload });
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    sessionId: 'sess-test',
    userId: 'user-test',
    user: { id: 'user-test' },
    emitted,
  };
}

function makeDeps(streamProvider: any): RunChatDeps {
  return {
    streamProvider,
    dispatch: vi.fn(async (_ctx: any, call: { name: string; input: unknown }) => ({
      ok: true,
      output: `stub:${call.name}`,
    })),
    executeMcpTool: vi.fn(async () => ({ ok: true, output: '[]' })),
    executeComposeVisual: vi.fn(),
    executeComposeApp: vi.fn(),
    executeRenderArtifact: vi.fn(),
    executeTask: vi.fn(),
    executeRequestClarification: vi.fn(),
    executeBrowserSandbox: vi.fn(),
    executeMemorize: vi.fn(),
    listSubagentTypes: vi.fn(async () => []),
    runSubagent: vi.fn(),
  } as any;
}

describe('chatLoop no-progress guard — artifact-tool threshold (Bug B, 2026-05-24)', () => {
  it('fires on the 2nd identical compose_visual call (threshold = 1)', async () => {
    // Two consecutive compose_visual calls with identical args. Pre-fix,
    // threshold is 3 so the guard does NOT fire on the 2nd. Post-fix,
    // artifact-tool threshold is 1, so guard fires AT THE END of turn 2.
    const visualArgs = {
      template: 'sankey',
      data: { nodes: [{ id: 'a' }], links: [] },
    };
    const stream = makeStreamProvider([
      // turn 1
      {
        toolUses: [{ id: 'v1', name: 'compose_visual', input: visualArgs }],
        stop_reason: 'tool_use',
      },
      // turn 2 — GUARD FIRES at end of this turn (count = 2 hits threshold 1+1)
      {
        toolUses: [{ id: 'v2', name: 'compose_visual', input: visualArgs }],
        stop_reason: 'tool_use',
      },
      // turn 3 — forced synthesis
      { text: 'I already rendered that chart.', stop_reason: 'end_turn' },
    ]);

    const ctx = makeCtx();
    const deps = makeDeps(stream);

    const result = await chatLoop(
      ctx as any,
      {
        systemPrompt: 'be helpful',
        userMessage: 'render a chart',
        priorMessages: [],
        tools: [{ function: { name: 'compose_visual' } }],
        model: 'test-model',
        maxTurns: 10,
        concurrencySafeNames: new Set(['compose_visual']),
        maxConcurrency: 5,
      } as any,
      deps,
    );

    expect(result.ok).toBe(true);

    // Guard MUST have fired — assert via the structured warn log line.
    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length).toBe(1);
    expect(String(warnCalls[0][1])).toContain('compose_visual');
    // Count at trigger is 2 (the 2nd call), not 3.
    expect((warnCalls[0][0] as any).count).toBe(2);
  });

  it('non-artifact tool still uses threshold 3 (regression guard)', async () => {
    // 2 identical azure_list_subscriptions calls — MUST NOT trip the guard.
    // (Only artifact tools have the tighter threshold; other tools keep 3.)
    const stream = makeStreamProvider([
      {
        toolUses: [{ id: 't1', name: 'azure_list_subscriptions', input: {} }],
        stop_reason: 'tool_use',
      },
      {
        toolUses: [{ id: 't2', name: 'azure_list_subscriptions', input: {} }],
        stop_reason: 'tool_use',
      },
      { text: 'final', stop_reason: 'end_turn' },
    ]);

    const ctx = makeCtx();
    const result = await chatLoop(
      ctx as any,
      {
        systemPrompt: '',
        userMessage: 'list subs',
        priorMessages: [],
        tools: [{ function: { name: 'azure_list_subscriptions' } }],
        model: 'test-model',
        maxTurns: 10,
        concurrencySafeNames: new Set(['azure_list_subscriptions']),
        maxConcurrency: 5,
      } as any,
      makeDeps(stream),
    );

    expect(result.ok).toBe(true);
    const warnCalls = (ctx.logger.warn as any).mock.calls.filter((c: any[]) =>
      String(c[1] ?? '').includes('no-progress guard'),
    );
    expect(warnCalls.length).toBe(0);
  });
});
