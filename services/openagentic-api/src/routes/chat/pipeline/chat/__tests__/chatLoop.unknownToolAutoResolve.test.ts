/**
 * #47 (2026-06-01) — auto-resolve unknown MCP tool calls.
 *
 * PROBLEM: OSS chat runs V2 discovery-mode — the model is offered only meta
 * tools (Task, compose_visual, render_artifact, request_clarification,
 * browser_sandbox_exec, memorize) + tool_search. The real MCP tools resolve
 * mid-turn via a discoveryHook WHEN the model calls tool_search. Weak local
 * models (gpt-oss:20b) skip that handshake and emit the target MCP tool name
 * directly (e.g. web_search). The #850 unknown-tool short-circuit then DROPS
 * the call (toolCallCount:0) and the model loops until it gives up — so NO
 * MCP tool ever executes on a weak local model.
 *
 * FIX: when the model emits a tool call whose name is NOT in the offered set,
 * look it up by EXACT name in the indexed MCP catalog (deps.resolveMcpToolByExactName,
 * same collection tool_search resolves against). On a hit, inject the def via
 * acceptDiscovered (so the offered set + next turn contain it, identical to a
 * tool_search discovery) and FALL THROUGH to the normal dispatch — which routes
 * to deps.executeMcpTool, the audited+gated seam. On a miss / throw / missing
 * resolver, keep the existing synthetic-error self-correction (#850).
 *
 * Mirrors the chatLoop.toolSearchDiscovery.test.ts harness.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

function makeCtx() {
  const emitted: Array<{ op: string; payload: any }> = [];
  return {
    ctx: {
      emit: (op: string, payload: any) => emitted.push({ op, payload }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's',
      userId: 'u',
    } as any,
    emitted,
  };
}

// Offer ONLY meta tools so `web_search` (and friends) are "unknown".
const META_ONLY_TOOLS = [
  { type: 'function', function: { name: 'tool_search', description: 'search' } },
  { type: 'function', function: { name: 'memorize', description: 'remember' } },
];

// Provider that emits ONE direct tool call (name/input) on turn 1, then
// end_turn on turn 2. Captures the tools the model sees on turn 2.
function makeDirectCallProvider(
  toolName: string,
  toolInput: unknown,
  onTurn2?: (tools: any[]) => void,
) {
  let call = 0;
  return function streamProvider(req: any) {
    call++;
    if (call === 2 && onTurn2) onTurn2([...(req.tools ?? [])]);
    if (call === 1) {
      return (async function* () {
        yield {
          type: 'tool_use_complete',
          id: 'tc1',
          name: toolName,
          input: toolInput,
        };
        yield { type: 'message_stop', stop_reason: 'tool_use' };
      })();
    }
    return (async function* () {
      yield { type: 'text_delta', text: 'done' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    })();
  };
}

describe('chatLoop — #47 auto-resolve unknown MCP tool calls', () => {
  it('resolves + dispatches a direct MCP call not in the offered set', async () => {
    const { ctx } = makeCtx();
    const streamProvider = makeDirectCallProvider('web_search', { query: 'x' });

    const dispatch = vi.fn(async () => ({ ok: true, output: 'results' }));
    const resolveMcpToolByExactName = vi.fn(async (_name: string) => ({
      type: 'function' as const,
      function: {
        name: 'web_search',
        description: 'web',
        parameters: {},
        server_name: 'web',
      },
      serverId: 'web',
      originalToolName: 'web_search',
    }));

    await chatLoop(
      ctx,
      {
        userMessage: 'search the web for x',
        priorMessages: [],
        systemPrompt: 's',
        tools: [...META_ONLY_TOOLS],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: dispatch as any,
        resolveMcpToolByExactName: resolveMcpToolByExactName as any,
      },
    );

    // The catalog was consulted with the EXACT name the model emitted.
    expect(resolveMcpToolByExactName).toHaveBeenCalledTimes(1);
    expect(resolveMcpToolByExactName).toHaveBeenCalledWith('web_search');

    // The resolved call was dispatched exactly once with the model's input —
    // this dispatch lands on deps.executeMcpTool (the audited+gated seam).
    const webSearchDispatches = dispatch.mock.calls.filter(
      (c: any[]) => c[1]?.name === 'web_search',
    );
    expect(webSearchDispatches).toHaveLength(1);
    expect(webSearchDispatches[0][1].input).toEqual({ query: 'x' });
  });

  it('injects the resolved def into the next turn`s tools array', async () => {
    const { ctx } = makeCtx();
    let toolsSeenByTurn2: any[] = [];
    const streamProvider = makeDirectCallProvider('web_search', { query: 'x' }, (t) => {
      toolsSeenByTurn2 = t;
    });

    const dispatch = vi.fn(async () => ({ ok: true, output: 'results' }));
    const resolveMcpToolByExactName = vi.fn(async () => ({
      type: 'function' as const,
      function: { name: 'web_search', description: 'web', parameters: {}, server_name: 'web' },
      serverId: 'web',
    }));

    await chatLoop(
      ctx,
      {
        userMessage: 'search the web for x',
        priorMessages: [],
        systemPrompt: 's',
        tools: [...META_ONLY_TOOLS],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: dispatch as any,
        resolveMcpToolByExactName: resolveMcpToolByExactName as any,
      },
    );

    const names = toolsSeenByTurn2.map((t: any) => t.function?.name).sort();
    expect(names).toContain('tool_search');
    expect(names).toContain('web_search');
  });

  it('catalog miss → synthetic error, dispatch NOT called', async () => {
    const { ctx, emitted } = makeCtx();
    const streamProvider = makeDirectCallProvider('totally_fake', { foo: 1 });

    const dispatch = vi.fn(async () => ({ ok: true, output: 'x' }));
    const resolveMcpToolByExactName = vi.fn(async () => null);

    await chatLoop(
      ctx,
      {
        userMessage: 'call a fake tool',
        priorMessages: [],
        systemPrompt: 's',
        tools: [...META_ONLY_TOOLS],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: dispatch as any,
        resolveMcpToolByExactName: resolveMcpToolByExactName as any,
      },
    );

    // The fake tool was never dispatched.
    const fakeDispatches = dispatch.mock.calls.filter(
      (c: any[]) => c[1]?.name === 'totally_fake',
    );
    expect(fakeDispatches).toHaveLength(0);

    // A synthetic is_error tool_result naming the unknown tool was emitted.
    const errResults = emitted.filter(
      (e) =>
        e.op === 'tool_result' &&
        e.payload?.is_error === true &&
        String(e.payload?.content ?? '').includes('totally_fake'),
    );
    expect(errResults.length).toBeGreaterThanOrEqual(1);
  });

  it('resolver throws → treated as a miss, loop does not crash', async () => {
    const { ctx, emitted } = makeCtx();
    const streamProvider = makeDirectCallProvider('web_search', { query: 'x' });

    const dispatch = vi.fn(async () => ({ ok: true, output: 'x' }));
    const resolveMcpToolByExactName = vi.fn(async () => {
      throw new Error('ToolSemanticCacheService not initialized');
    });

    // Must NOT throw.
    await expect(
      chatLoop(
        ctx,
        {
          userMessage: 'search the web for x',
          priorMessages: [],
          systemPrompt: 's',
          tools: [...META_ONLY_TOOLS],
          model: 'gpt-oss:20b',
          maxTurns: 5,
        },
        {
          streamProvider: streamProvider as any,
          dispatch: dispatch as any,
          resolveMcpToolByExactName: resolveMcpToolByExactName as any,
        },
      ),
    ).resolves.toBeDefined();

    // Treated as a miss: not dispatched, synthetic error emitted instead.
    const webSearchDispatches = dispatch.mock.calls.filter(
      (c: any[]) => c[1]?.name === 'web_search',
    );
    expect(webSearchDispatches).toHaveLength(0);
    const errResults = emitted.filter(
      (e) => e.op === 'tool_result' && e.payload?.is_error === true,
    );
    expect(errResults.length).toBeGreaterThanOrEqual(1);
  });

  it('no resolver dep (undefined) → unchanged #850 behavior', async () => {
    const { ctx, emitted } = makeCtx();
    const streamProvider = makeDirectCallProvider('web_search', { query: 'x' });

    const dispatch = vi.fn(async () => ({ ok: true, output: 'x' }));

    await chatLoop(
      ctx,
      {
        userMessage: 'search the web for x',
        priorMessages: [],
        systemPrompt: 's',
        tools: [...META_ONLY_TOOLS],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: dispatch as any,
        // resolveMcpToolByExactName intentionally omitted.
      },
    );

    const webSearchDispatches = dispatch.mock.calls.filter(
      (c: any[]) => c[1]?.name === 'web_search',
    );
    expect(webSearchDispatches).toHaveLength(0);
    const errResults = emitted.filter(
      (e) => e.op === 'tool_result' && e.payload?.is_error === true,
    );
    expect(errResults.length).toBeGreaterThanOrEqual(1);
  });

  it('exact-name only — resolver returning a different name is ignored', async () => {
    const { ctx, emitted } = makeCtx();
    const streamProvider = makeDirectCallProvider('web_search', { query: 'x' });

    const dispatch = vi.fn(async () => ({ ok: true, output: 'x' }));
    // Resolver hands back a NEAR tool whose name != the requested name.
    const resolveMcpToolByExactName = vi.fn(async () => ({
      type: 'function' as const,
      function: { name: 'web_search_v2', description: 'near', parameters: {}, server_name: 'web' },
      serverId: 'web',
    }));

    await chatLoop(
      ctx,
      {
        userMessage: 'search the web for x',
        priorMessages: [],
        systemPrompt: 's',
        tools: [...META_ONLY_TOOLS],
        model: 'gpt-oss:20b',
        maxTurns: 5,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: dispatch as any,
        resolveMcpToolByExactName: resolveMcpToolByExactName as any,
      },
    );

    // Never substitute a near tool: neither name is dispatched.
    expect(
      dispatch.mock.calls.filter(
        (c: any[]) => c[1]?.name === 'web_search' || c[1]?.name === 'web_search_v2',
      ),
    ).toHaveLength(0);
    const errResults = emitted.filter(
      (e) => e.op === 'tool_result' && e.payload?.is_error === true,
    );
    expect(errResults.length).toBeGreaterThanOrEqual(1);
  });

  it('REGRESSION — tool_search discovery path unchanged, no double-dispatch, resolver NOT called', async () => {
    const { ctx } = makeCtx();
    let call = 0;

    // turn 1: model calls tool_search; turn 2: model calls the discovered
    // web_search; turn 3: end_turn.
    function streamProvider(_req: any) {
      call++;
      if (call === 1) {
        return (async function* () {
          yield { type: 'tool_use_complete', id: 'ts1', name: 'tool_search', input: { query: 'web' } };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      if (call === 2) {
        return (async function* () {
          yield { type: 'tool_use_complete', id: 'ws1', name: 'web_search', input: { query: 'x' } };
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta', text: 'done' };
        yield { type: 'message_stop', stop_reason: 'end_turn' };
      })();
    }

    const dispatch = vi.fn(async (_ctx: any, c: any) => {
      if (c.name === 'tool_search') {
        return {
          ok: true,
          output: { matches: 1 },
          discoveredTools: [
            { type: 'function', function: { name: 'web_search', description: 'web', server_name: 'web' } },
          ],
        };
      }
      return { ok: true, output: 'results' };
    });
    const resolveMcpToolByExactName = vi.fn();

    await chatLoop(
      ctx,
      {
        userMessage: 'search the web for x',
        priorMessages: [],
        systemPrompt: 's',
        tools: [{ type: 'function', function: { name: 'tool_search', description: 'search' } }],
        model: 'gpt-oss:20b',
        maxTurns: 6,
      },
      {
        streamProvider: streamProvider as any,
        dispatch: dispatch as any,
        resolveMcpToolByExactName: resolveMcpToolByExactName as any,
      },
    );

    // web_search dispatched exactly once (via the normal known path).
    const webSearchDispatches = dispatch.mock.calls.filter(
      (c: any[]) => c[1]?.name === 'web_search',
    );
    expect(webSearchDispatches).toHaveLength(1);
    // It was already in the offered set via discovery — the unknown branch
    // (and therefore the resolver) never ran.
    expect(resolveMcpToolByExactName).not.toHaveBeenCalled();
  });
});
