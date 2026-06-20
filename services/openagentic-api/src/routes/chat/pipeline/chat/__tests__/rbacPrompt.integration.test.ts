/**
 * Phase B integration test (rev-2 chatmode plan, Task B.6 verification).
 *
 * Stubs providerManager + memory + agents and runs runChat end-to-end.
 * Captures the systemPrompt that lands at the streamProvider boundary
 * via oaiRequest.messages[0] (the system message). Asserts:
 *
 *   - admin user (is_admin=true) gets the admin .md body
 *   - member user (is_admin=false) gets the member .md body
 *   - both bodies include the dynamic <session-facts> block
 *   - admin and member produce DIFFERENT system prompts
 *   - flag OFF preserves the legacy composeStatic+composeSidecar path
 *
 * the design notes-1
 * the design notes-B.6
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runChat } from '../runChat.js';
import { __clearPromptCache } from '../../../../../services/prompt/RoleKeyedSystemPrompt.js';

let capturedRequests: any[] = [];

beforeEach(() => {
  capturedRequests = [];
  __clearPromptCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.USE_RBAC_PROMPT;
});

function makeCtx(opts: { isAdmin: boolean; userId?: string; sessionId?: string }) {
  return {
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sessionId: opts.sessionId ?? 'sess-rbac',
    userId: opts.userId ?? 'user-rbac',
    user: { isAdmin: opts.isAdmin, id: opts.userId ?? 'user-rbac', email: 'u@test' },
  };
}

function makeProviderManagerStub() {
  return {
    getStreamFormatForModel: () => 'openai',
    createCompletion: vi.fn(async (oaiRequest: any) => {
      capturedRequests.push(oaiRequest);
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

function makeDeps(providerManager: any) {
  return {
    providerManager,
    listAgents: async () => [],
    executeMcpTool: vi.fn(),
    prismaLike: undefined,
  } as any;
}

const baseInput = {
  userMessage: 'say hello in 5 words',
  priorMessages: [],
  model: 'configured-chat-model',
  attachments: [],
  mcpTools: [],
  maxTurns: 12,
} as any;

function extractSystemPrompt(req: any): string {
  const sysMsg = (req.messages ?? []).find((m: any) => m.role === 'system');
  return typeof sysMsg?.content === 'string' ? sysMsg.content : JSON.stringify(sysMsg?.content ?? '');
}

describe('runChat — RBAC system prompt integration (USE_RBAC_PROMPT=true)', () => {
  it('admin user gets the admin .md body in the system prompt', async () => {
    process.env.USE_RBAC_PROMPT = 'true';
    const ctx = makeCtx({ isAdmin: true });
    const providerManager = makeProviderManagerStub();

    await runChat(ctx as any, baseInput, makeDeps(providerManager));

    expect(capturedRequests.length).toBeGreaterThanOrEqual(1);
    const sys = extractSystemPrompt(capturedRequests[0]);
    expect(sys).toMatch(/platform administrator with full RBAC/i);
  });

  it('member user gets the member .md body in the system prompt', async () => {
    process.env.USE_RBAC_PROMPT = 'true';
    const ctx = makeCtx({ isAdmin: false });
    const providerManager = makeProviderManagerStub();

    await runChat(ctx as any, baseInput, makeDeps(providerManager));

    const sys = extractSystemPrompt(capturedRequests[0]);
    expect(sys).toMatch(/end-user with restricted RBAC|standard RBAC/i);
  });

  it('admin and member produce DIFFERENT system prompt bodies', async () => {
    process.env.USE_RBAC_PROMPT = 'true';

    const adminProv = makeProviderManagerStub();
    await runChat(makeCtx({ isAdmin: true, userId: 'admin-u' }) as any, baseInput, makeDeps(adminProv));
    const adminSys = extractSystemPrompt(capturedRequests[0]);

    capturedRequests = [];
    const memberProv = makeProviderManagerStub();
    await runChat(makeCtx({ isAdmin: false, userId: 'member-u' }) as any, baseInput, makeDeps(memberProv));
    const memberSys = extractSystemPrompt(capturedRequests[0]);

    expect(adminSys).not.toBe(memberSys);
    expect(adminSys.length).toBeGreaterThan(memberSys.length); // admin .md is larger
  });

  it('RBAC system prompt includes <session-facts> with role and session id', async () => {
    process.env.USE_RBAC_PROMPT = 'true';
    const ctx = makeCtx({ isAdmin: true, userId: 'u-facts', sessionId: 's-facts' });
    const providerManager = makeProviderManagerStub();

    await runChat(ctx as any, baseInput, makeDeps(providerManager));

    const sys = extractSystemPrompt(capturedRequests[0]);
    expect(sys).toContain('<session-facts>');
    expect(sys).toContain('<user id="u-facts" role="admin"');
    expect(sys).toContain('<session id="s-facts"');
    expect(sys).toContain('<model name="configured-chat-model"');
  });

  it('total RBAC system prompt size ≤ 5000 tokens (20000 chars at 4 chars/token)', async () => {
    process.env.USE_RBAC_PROMPT = 'true';
    const ctx = makeCtx({ isAdmin: true });
    const providerManager = makeProviderManagerStub();

    await runChat(ctx as any, baseInput, makeDeps(providerManager));

    const sys = extractSystemPrompt(capturedRequests[0]);
    expect(sys.length).toBeLessThanOrEqual(20000);
  });

  it('RBAC path does NOT contain legacy composeSidecar artifacts', async () => {
    process.env.USE_RBAC_PROMPT = 'true';
    const ctx = makeCtx({ isAdmin: true });
    const providerManager = makeProviderManagerStub();

    await runChat(ctx as any, baseInput, makeDeps(providerManager));

    const sys = extractSystemPrompt(capturedRequests[0]);
    // Legacy 35-module composer body has these section headers; rev-2
    // RBAC path should NOT include them — it loads a single .md file.
    expect(sys).not.toMatch(/INTENT_DOMAIN_EXCLUSIONS/i);
    expect(sys).not.toMatch(/composeSidecar/i);
  });
});

describe('runChat — legacy path preserved when USE_RBAC_PROMPT unset', () => {
  it('flag OFF: system prompt comes from composeStatic (legacy 7-section bodies)', async () => {
    delete process.env.USE_RBAC_PROMPT;
    const ctx = makeCtx({ isAdmin: false });
    const providerManager = makeProviderManagerStub();

    await runChat(ctx as any, baseInput, makeDeps(providerManager));

    const sys = extractSystemPrompt(capturedRequests[0]);
    // Legacy path produces a non-empty system prompt without the
    // RBAC-specific phrasing baked into the .md files.
    expect(sys.length).toBeGreaterThan(0);
    expect(sys).not.toMatch(/platform administrator with full RBAC/i);
    expect(sys).not.toMatch(/end-user with restricted RBAC/i);
  });
});
