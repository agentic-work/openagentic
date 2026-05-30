/**
 * userJwt wire integration test (chatmode-rip Phase C.6).
 *
 * Verifies that `runChat` plumbs the user's Azure AD ACCESS token from
 * the loose `ctx.user` surface onto the typed `ctx.userJwt` field via
 * `extractUserJwt`. The synth dispatcher (Phase C.5) and any future
 * OBO-aware tool reads `ctx.userJwt` instead of sniffing the user
 * object — this test pins the wire so a refactor never silently drops
 * the field.
 *
 * Sibling test `extractUserJwt.test.ts` covers the extractor in
 * isolation. This file covers the **integration**: stream.handler builds
 * ctx with `ctx.user.accessToken`, runChat runs, `ctx.userJwt` is set
 * before chatLoop dispatches any tool.
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md §Phase C.6
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runChat } from '../runChat.js';
import * as extractUserJwtModule from '../extractUserJwt.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeProviderManagerStub() {
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

function makeBaseDeps() {
  return {
    providerManager: makeProviderManagerStub(),
    listAgents: async () => [],
    executeMcpTool: vi.fn(),
    executeBrowserSandbox: vi.fn(),
    runSubagent: vi.fn(),
    prismaLike: undefined,
    // Stub ContextManagementService to avoid Prisma bootstrap. Returns
    // 0% usage so the pre-loop compaction path no-ops.
    contextMgmt: {
      getContextUsage: vi.fn().mockResolvedValue({
        sessionId: 's',
        currentTokens: 0,
        maxTokens: 100000,
        usagePercentage: 0,
        messagesCount: 0,
        needsCompaction: false,
        compactionLevel: 'none' as const,
      }),
      compactContext: vi.fn(),
    },
  };
}

function makeInput() {
  return {
    userMessage: 'hi',
    priorMessages: [],
    model: 'configured-chat-model',
    attachments: [],
    mcpTools: [],
    maxTurns: 12,
  };
}

describe('userJwt wire (chatmode-rip Phase C.6 integration)', () => {
  it('case 1: surfaces ctx.user.accessToken onto ctx.userJwt before chatLoop runs', async () => {
    // stream.handler.ts:1313-1322 constructs ctx.user with accessToken pulled
    // from the user's stored Azure tokens (deps.getAzureTokenInfo). After
    // runChat returns, ctx.userJwt MUST equal that accessToken — that's
    // what SynthOBODispatcher reads to call CredentialBroker.brokerFor.
    const ctx: any = {
      emit: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 'sess-jwt-1',
      userId: 'user-jwt-1',
      user: {
        id: 'user-jwt-1',
        email: 'admin@example.onmicrosoft.com',
        accessToken: 'eyJaccess.token.payload',
        idToken: 'eyJid.token.payload',
        authMethod: 'azure-ad',
      },
    };

    await runChat(ctx, makeInput() as any, makeBaseDeps() as any);

    expect(ctx.userJwt).toBe('eyJaccess.token.payload');
  });

  it('case 2: leaves ctx.userJwt undefined when ctx.user has no accessToken', async () => {
    // Anonymous / non-Azure / unauthenticated paths land here. The pipeline
    // must not throw and must not invent an empty-string JWT — downstream
    // synth dispatcher checks `typeof ctx.userJwt !== 'string' || length===0`
    // and refuses with a clean "user not signed in" error.
    const ctx: any = {
      emit: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 'sess-jwt-2',
      userId: 'user-jwt-2',
      user: { id: 'user-jwt-2', email: 'a@b.c' },
    };

    await runChat(ctx, makeInput() as any, makeBaseDeps() as any);

    expect(ctx.userJwt).toBeUndefined();
  });

  it('case 3: uses extractUserJwt() (not an inline accessor) — pins the contract', async () => {
    // If someone refactors to `ctx.userJwt = ctx.user?.accessToken` inline,
    // the typing relaxation reopens the idToken-as-userJwt failure mode
    // extractUserJwt's negative case prevents. Spy on the exported helper
    // to lock the contract.
    const spy = vi.spyOn(extractUserJwtModule, 'extractUserJwt');

    const ctx: any = {
      emit: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 'sess-jwt-3',
      userId: 'user-jwt-3',
      user: { accessToken: 'access.live' },
    };

    await runChat(ctx, makeInput() as any, makeBaseDeps() as any);

    expect(spy).toHaveBeenCalled();
    // The helper received ctx.user (not ctx, not undefined).
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'access.live' }));
  });
});
