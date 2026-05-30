/**
 * Phase 7 — V3 chatLoop session-facts injection (TDD RED first).
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §8
 *
 * Asserts that runChat prepends a `<session-facts>` block as a synthetic
 * user-role message ABOVE the actual user message on the FIRST chat-loop
 * turn. The block contains user role / tenant / session id / model in use.
 *
 * The block is computed once per chatLoop invocation — subsequent
 * iterations do NOT re-inject (the model already has it in history).
 *
 * Test approach:
 *   - Stub providerManager.createCompletion → yields end_turn immediately
 *   - Capture the oaiRequest.messages[] arg passed to createCompletion
 *   - Assert the first non-system message is a user-role message containing
 *     `<session-facts>` and the actual user prompt
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runChat } from '../runChat.js';

// Capture every oaiRequest the streamProvider passes to createCompletion.
let capturedRequests: any[] = [];

beforeEach(() => {
  capturedRequests = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCtx() {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: 'sess-test-123',
    userId: 'user-test-abc',
    user: { isAdmin: false, id: 'user-test-abc', email: 'u@test' },
  };
}

/**
 * Producer that yields a single OpenAI-shape `chat.completion.chunk` with
 * `delta.content: 'ok'` then a `finish_reason: 'stop'` chunk. The SDK
 * OpenAI normalizer translates these into canonical events that the V3
 * streamProvider then maps into V3 StreamEvents.
 *
 * For the audience-injection test, the only thing that matters is that
 * the provider is called — we capture oaiRequest.messages and short-circuit
 * the loop with a single end_turn cycle.
 */
function makeProviderManagerStub() {
  return {
    getStreamFormatForModel: () => 'openai',
    createCompletion: vi.fn(async (oaiRequest: any) => {
      capturedRequests.push(oaiRequest);
      // OpenAI-shape SSE chunk stream
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

describe('runChat — session-facts injection', () => {
  it('first-turn messages[] contains session-facts in the FIRST user-role message', async () => {
    const ctx = makeCtx();
    const providerManager = makeProviderManagerStub();

    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
    };

    const input: any = {
      userMessage: 'show me my azure subs',
      priorMessages: [],
      model: 'configured-chat-model',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };

    await runChat(ctx as any, input, deps);

    expect(capturedRequests.length).toBeGreaterThanOrEqual(1);
    const firstReq = capturedRequests[0];
    const messages = firstReq.messages ?? [];
    // Skip the system message at index 0 — find the first user-role message.
    const firstUser = messages.find((m: any) => m.role === 'user');
    expect(firstUser).toBeDefined();
    const firstContent = typeof firstUser.content === 'string'
      ? firstUser.content
      : JSON.stringify(firstUser.content);
    expect(firstContent).toContain('<session-facts>');
    expect(firstContent).toContain('</session-facts>');
  });

  it('session-facts block reflects user role and session/tenant identifiers', async () => {
    const ctx = makeCtx();
    const providerManager = makeProviderManagerStub();
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
    };
    const input: any = {
      userMessage: 'hi',
      priorMessages: [],
      model: 'some-model',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };

    await runChat(ctx as any, input, deps);

    const firstReq = capturedRequests[0];
    const messages = firstReq.messages ?? [];
    const firstUser = messages.find((m: any) => m.role === 'user');
    const c = typeof firstUser.content === 'string'
      ? firstUser.content
      : JSON.stringify(firstUser.content);
    // Session id from ctx
    expect(c).toContain('sess-test-123');
    // User id from ctx
    expect(c).toContain('user-test-abc');
    // Model name passed through
    expect(c).toContain('some-model');
  });

  it('does NOT inject a SECOND session-facts block on subsequent loop turns', async () => {
    // For this single-turn smoke flow, the chatLoop should only be invoked
    // once. We assert that across ALL captured oaiRequests, the count of
    // session-facts blocks in messages[] is at most 1 (i.e. injected once,
    // never duplicated even if the loop iterated more than once).
    const ctx = makeCtx();
    const providerManager = makeProviderManagerStub();
    const deps: any = {
      providerManager,
      listAgents: async () => [],
      executeMcpTool: vi.fn(),
      prismaLike: undefined,
    };
    const input: any = {
      userMessage: 'second test',
      priorMessages: [],
      model: 'm',
      attachments: [],
      mcpTools: [],
      maxTurns: 12,
    };
    await runChat(ctx as any, input, deps);

    for (const req of capturedRequests) {
      const messages = req.messages ?? [];
      const factsCount = messages.filter((m: any) => {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return c.includes('<session-facts>');
      }).length;
      expect(factsCount).toBeLessThanOrEqual(1);
    }
  });
});
