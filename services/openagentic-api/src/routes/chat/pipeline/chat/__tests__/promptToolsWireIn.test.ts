/**
 * Elegant prompt-composition Task 5 — RED then GREEN.
 *
 * When the chat pipeline composes the system prompt at runChat.ts:~565,
 * it MUST pass the SAME tool array it's about to send to the provider
 * into `getSystemPromptForRole(role, ctx, deps).deps.tools`.
 *
 * Pre-fix: deps.tools is undefined → the dynamic <tool-catalog> block in
 * the system prompt renders empty + the static discovery-flow bullets
 * lose their tool-name anchors.
 *
 * Post-fix: deps.tools === the same `tools` array passed to
 * `provider.createCompletion({ tools })`, so the in-prompt catalog +
 * discovery anchors reflect what the model actually has on this turn.
 *
 * Tasks in the chain so far: 10eb7851 (registry primitive),
 * a27c3d3a (static-section pack), 66d6c306 (dynamic tool-catalog),
 * 5b8444b6 (composer rewire + .md trim). This is Task 5 — wire-in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Spy on the prompt composer. The mock implementation returns a sentinel
// string so the chatLoop receives something concrete (the loop never
// inspects the prompt text — only forwards it to the provider).
vi.mock('../../../../../services/prompt/getSystemPromptForRole.js', () => ({
  getSystemPromptForRole: vi.fn(async () => '<mocked-system-prompt>'),
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY: '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__',
}));

import { getSystemPromptForRole } from '../../../../../services/prompt/getSystemPromptForRole.js';
import { runChat } from '../runChat.js';
import { buildChatV2Deps } from '../../../../../services/buildChatV2Deps.js';

function makeCtx(sessionId = 'sess-task5') {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId,
    userId: 'user-task5',
    user: { isAdmin: false, id: 'user-task5', email: 'u@test' },
  };
}

/**
 * Streaming provider that immediately ends the turn (no tool calls).
 * The composed-prompt assertion fires before chatLoop ever streams, so
 * the simplest provider is one that yields end_turn on the first call.
 */
function makeImmediateEndProvider() {
  return {
    getStreamFormatForModel: () => 'openai',
    createCompletion: vi.fn(async () => {
      async function* gen() {
        yield {
          id: 'cmpl-1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' } }],
        };
        yield {
          id: 'cmpl-1',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        };
      }
      return gen();
    }),
  };
}

describe('chat pipeline — getSystemPromptForRole receives live tools array (Task 5)', () => {
  beforeEach(() => {
    (getSystemPromptForRole as any).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes deps.tools into getSystemPromptForRole — the SAME array the loop sends to the provider', async () => {
    const providerManager = makeImmediateEndProvider();
    const deps = buildChatV2Deps({
      providerManager: providerManager as any,
      executeMcpTool: vi.fn(async () => ({ ok: true, output: '[]' })),
    });

    const ctx = makeCtx('sess-task5-wireIn');
    const input: any = {
      userMessage: 'hello',
      priorMessages: [],
      model: 'configured-chat-model',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };

    await runChat(ctx as any, input, deps as any);

    // 1. getSystemPromptForRole was called at all.
    const calls = (getSystemPromptForRole as any).mock.calls as Array<
      [string, any, any]
    >;
    expect(calls.length).toBeGreaterThan(0);

    // 2. The third arg (deps) carries a tools field that's defined +
    //    non-empty. Pre-fix this assertion fails because deps.tools is
    //    undefined at the call site.
    const lastDeps = calls[calls.length - 1]?.[2];
    expect(lastDeps).toBeDefined();
    expect(lastDeps?.tools).toBeDefined();
    expect(Array.isArray(lastDeps.tools)).toBe(true);
    expect((lastDeps.tools as any[]).length).toBeGreaterThan(0);

    // 3. The tools array contains the meta-9 primitives — meta-only at
    //    turn 1 per the discovery-mode contract. tool_search is one of
    //    the canonical meta names (used as an anchor).
    const toolNames = (lastDeps.tools as any[]).map(
      (t) => t?.function?.name ?? t?.name,
    );
    expect(toolNames).toContain('tool_search');
    expect(toolNames).toContain('agent_search');

    // 4. The SAME contents the provider received. chatLoop spreads the
    //    input tools into a fresh local array (chatLoop.ts:91) so we can't
    //    assert reference identity end-to-end — but the names must match
    //    exactly so the in-prompt catalog reflects the live tool set.
    const providerCalls = (providerManager.createCompletion as any).mock.calls;
    expect(providerCalls.length).toBeGreaterThan(0);
    const providerReq = providerCalls[0]?.[0];
    expect(providerReq?.tools).toBeDefined();
    const providerToolNames = (providerReq.tools as any[]).map(
      (t) => t?.function?.name ?? t?.name,
    );
    expect(providerToolNames).toEqual(toolNames);
  });
});
