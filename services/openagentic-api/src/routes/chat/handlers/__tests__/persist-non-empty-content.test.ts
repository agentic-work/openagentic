/**
 * Sev-0: persist-non-empty-content
 *
 * Two bugs this file pins:
 *
 * Bug A — Scope enforcement path skips persistAssistantMessage.
 *   When a non-admin user sends an off-topic message, the handler streams
 *   the warning text and calls reply.raw.end() without ever calling
 *   persistAssistantMessage. On session reload the assistant row is missing,
 *   so the warning bubble never reappears.
 *
 *   Fix: scope violation / lockout paths call persistAssistantMessage before
 *   reply.raw.end() with role='assistant', the warning text as content, and
 *   a single text ContentBlock so chat_messages.content_blocks is populated.
 *
 * Bug B — loadSessionMessages (UI) omits content_blocks from addMessage call.
 *   (Tested separately in useChatSessions.test.ts on the UI side; this file
 *   covers the API contract: persistAssistantMessage is called with a
 *   non-empty contentBlocks array so the DB row is written correctly.)
 *
 * Tests:
 *   Test A1 — normal 3-frame stream → persistAssistantMessage called with
 *             non-empty contentBlocks containing the joined text.
 *   Test A2 — scope violation path → persistAssistantMessage called with
 *             warning text in contentBlocks[0].content.
 *   Test A3 — account-lock path → persistAssistantMessage called with
 *             lockout text in contentBlocks[0].content.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── module stubs ──────────────────────────────────────────────────────────────

vi.mock('../../../../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async () => ({ id: 'session-persist-test' })),
      update: vi.fn(async () => ({})),
    },
    chatMessage: {
      findMany: vi.fn(async () => []),
    },
    fileAttachment: {
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock('../../../../services/BlobStorageService.js', () => ({
  BlobStorageService: class {
    constructor() { /* no-op */ }
    async init() { /* no-op */ }
    async getBase64() { return null; }
  },
}));

vi.mock('../../../../services/ScopeEnforcementService.js', () => ({
  isUserLocked: vi.fn(async () => false),
  analyzeMessageScope: vi.fn(() => ({ isInScope: true, confidence: 0, reason: '' })),
  recordScopeViolation: vi.fn(async () => ({
    warningCount: 1,
    isLocked: false,
    message: '⚠️ **Off-topic request detected.** Warning 1 of 3.',
  })),
}));

vi.mock('../../../../services/model-routing/RegistryModelGuard.js', () => ({
  resolveRequestedModel: vi.fn(async () => ({ kind: 'smart-router' })),
}));

vi.mock('../../../../services/StreamRingBuffer.js', () => ({
  getStreamRingBuffer: vi.fn(() => ({ append: vi.fn(async () => {}) })),
}));

vi.mock('../stream-tail.registry.js', () => ({
  registerActiveTurn: vi.fn(),
  unregisterActiveTurn: vi.fn(),
  publishFrame: vi.fn(),
}));

vi.mock('../../../../metrics/index.js', () => ({
  trackChatMessage: vi.fn(),
  chatResponseTime: { observe: vi.fn() },
}));

vi.mock('../../../../services/AITitleGenerationService.js', () => ({
  AITitleGenerationService: class { async generateTitle() { return 'Title'; } },
}));
vi.mock('../../../../services/TitleGenerationClient.js', () => ({
  TitleGenerationClient: class {},
}));

import {
  isUserLocked,
  analyzeMessageScope,
  recordScopeViolation,
} from '../../../../services/ScopeEnforcementService.js';
import { streamHandler, type ChatStreamHandlerDeps } from '../stream.handler.js';
import * as runChatModule from '../../pipeline/chat/runChat.js';

// ── test doubles ──────────────────────────────────────────────────────────────

interface FakeRaw extends EventEmitter {
  writeHead: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  flushHeaders: ReturnType<typeof vi.fn>;
  socket: { setNoDelay: ReturnType<typeof vi.fn>; uncork: ReturnType<typeof vi.fn> };
  headersSent: boolean;
}

function makeFakeRaw(): FakeRaw {
  const ee = new EventEmitter() as any;
  ee.headersSent = false;
  ee.writeHead = vi.fn(() => { ee.headersSent = true; });
  ee.write = vi.fn(() => true);
  ee.end = vi.fn();
  ee.flushHeaders = vi.fn();
  ee.socket = { setNoDelay: vi.fn(), uncork: vi.fn() };
  return ee as FakeRaw;
}

function makeFakeReply() {
  const raw = makeFakeRaw();
  return {
    raw,
    sent: false,
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
}

function makeFakeRequest(opts: {
  message: string;
  sessionId?: string;
  isAdmin?: boolean;
}) {
  const reqRaw = new EventEmitter() as any;
  return {
    raw: reqRaw,
    user: { id: 'user-persist-test', isAdmin: opts.isAdmin ?? false },
    body: {
      message: opts.message,
      sessionId: opts.sessionId ?? 'session-persist-1',
    },
    headers: {},
  } as any;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

function makeBaseDeps(over: Partial<ChatStreamHandlerDeps> = {}): ChatStreamHandlerDeps {
  return {
    v2Deps: {
      providerManager: {
        createCompletion: vi.fn(async () => ({
          choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }],
        })),
      } as any,
      listAgents: vi.fn().mockResolvedValue([]),
      runSubagent: vi.fn().mockResolvedValue({ ok: true, output: 'done', turns: 1, tokens: 10, durationMs: 10, toolsUsed: [] }),
      executeMcpTool: vi.fn().mockResolvedValue({ ok: true, output: '[]' }),
      executeBrowserSandbox: vi.fn().mockResolvedValue({ ok: true, output: 'done' }),
    },
    listMcpTools: vi.fn().mockResolvedValue([]),
    pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
    ...over,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('persist-non-empty-content — Sev-0 Bug A: scope enforcement must persist assistant message', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllMocks(); });

  // ── Test A1: normal stream → persistAssistantMessage called with non-empty content_blocks ──

  it('Test A1: normal stream with 3 text deltas → persistAssistantMessage called with non-empty contentBlocks', async () => {
    // Set up runChat mock to emit 3 assistant_message_delta frames
    const runChatSpy = vi.spyOn(runChatModule, 'runChat').mockImplementation(async (ctx, input, deps) => {
      ctx.emit('assistant_message_delta', { text: 'Hello ' });
      ctx.emit('assistant_message_delta', { text: 'from ' });
      ctx.emit('assistant_message_delta', { text: 'the model.' });
      ctx.emit('assistant_message_stop', {});
      return { ok: true, turns: 1, toolUses: [] };
    });

    const persistAssistantMessage = vi.fn().mockResolvedValue(undefined);
    const deps = makeBaseDeps({ persistAssistantMessage });
    const handler = streamHandler(deps, makeLogger());
    const reply = makeFakeReply();
    // Admin user — scope enforcement bypassed; tests the normal V2 persist path
    const req = makeFakeRequest({ message: 'show me my VMs', isAdmin: true });

    await handler(req, reply as any);

    runChatSpy.mockRestore();

    // persistAssistantMessage must be called
    expect(persistAssistantMessage, 'persistAssistantMessage must be called for normal stream').toHaveBeenCalledOnce();

    const [sessionId, content, opts] = persistAssistantMessage.mock.calls[0];
    expect(sessionId).toBe('session-persist-1');

    // content must be the joined deltas
    expect(content, 'content must be non-empty (accumulated text deltas)').toBeTruthy();
    expect(content).toContain('Hello');

    // contentBlocks must be non-empty with at least one text block
    expect(opts.contentBlocks, 'contentBlocks must be present').toBeDefined();
    expect(Array.isArray(opts.contentBlocks)).toBe(true);
    expect(opts.contentBlocks!.length, 'contentBlocks must have at least one block').toBeGreaterThan(0);

    const textBlock = opts.contentBlocks!.find((b: any) => b.type === 'text');
    expect(textBlock, 'at least one text-type block must exist').toBeDefined();
    expect(textBlock.content, 'text block content must be non-empty').toBeTruthy();
    expect(textBlock.content).toContain('Hello');
  });

  // ── Test A2: scope violation → persistAssistantMessage called with warning text ──

  it('Test A2: non-admin off-topic prompt → persistAssistantMessage called with warning text in contentBlocks', async () => {
    const WARNING = '⚠️ **Off-topic request detected.** Warning 1 of 3.';

    vi.mocked(analyzeMessageScope).mockReturnValue({ isInScope: false, confidence: 0.6, reason: 'Prohibited: recipe' });
    vi.mocked(isUserLocked).mockResolvedValue(false);
    vi.mocked(recordScopeViolation).mockResolvedValue({
      isLocked: false,
      warningCount: 1,
      shouldBlock: false,
      message: WARNING,
    });

    const persistAssistantMessage = vi.fn().mockResolvedValue(undefined);
    const deps = makeBaseDeps({ persistAssistantMessage });
    const handler = streamHandler(deps, makeLogger());
    const reply = makeFakeReply();
    const req = makeFakeRequest({ message: 'recipe for chocolate cake', isAdmin: false });

    await handler(req, reply as any);

    // CRITICAL: persistAssistantMessage MUST be called even on scope violation
    // (Bug A: the scope path skipped this call, leaving no DB row on reload)
    expect(
      persistAssistantMessage,
      'persistAssistantMessage MUST be called on scope violation so the warning persists to DB and reloads correctly',
    ).toHaveBeenCalledOnce();

    const [sessionId, content, opts] = persistAssistantMessage.mock.calls[0];
    expect(sessionId).toBe('session-persist-1');

    // content must contain the warning text
    expect(content, 'persisted content must contain warning text').toContain('Off-topic');

    // contentBlocks must be non-empty with the warning text in a text block
    expect(opts.contentBlocks, 'contentBlocks must be present for scope violation').toBeDefined();
    expect(Array.isArray(opts.contentBlocks)).toBe(true);
    expect(opts.contentBlocks!.length).toBeGreaterThan(0);

    const textBlock = opts.contentBlocks!.find((b: any) => b.type === 'text');
    expect(textBlock, 'scope violation warning must be in a text ContentBlock').toBeDefined();
    expect(textBlock.content, 'text block must contain warning text').toContain('Off-topic');
  });

  // ── Test A3: account-lock path → persistAssistantMessage called with lockout text ──

  it('Test A3: pre-locked user → persistAssistantMessage called with lockout text in contentBlocks', async () => {
    const LOCKOUT = '🔒 **ACCOUNT LOCKED** — Your account has been locked due to repeated policy violations. Please contact your administrator to restore access.';

    vi.mocked(isUserLocked).mockResolvedValue(true);

    const persistAssistantMessage = vi.fn().mockResolvedValue(undefined);
    const deps = makeBaseDeps({ persistAssistantMessage });
    const handler = streamHandler(deps, makeLogger());
    const reply = makeFakeReply();
    const req = makeFakeRequest({ message: 'show me my azure VMs', isAdmin: false });

    await handler(req, reply as any);

    // CRITICAL: persistAssistantMessage MUST be called for the lockout message
    expect(
      persistAssistantMessage,
      'persistAssistantMessage MUST be called on account-lock so the lockout message persists to DB',
    ).toHaveBeenCalledOnce();

    const [, content, opts] = persistAssistantMessage.mock.calls[0];

    // content must contain the lockout text
    expect(content, 'persisted content must contain lockout text').toContain('LOCKED');

    // contentBlocks must have the lockout text in a text block
    expect(opts.contentBlocks, 'contentBlocks must be present for lockout').toBeDefined();
    expect(Array.isArray(opts.contentBlocks)).toBe(true);
    expect(opts.contentBlocks!.length).toBeGreaterThan(0);

    const textBlock = opts.contentBlocks!.find((b: any) => b.type === 'text');
    expect(textBlock, 'lockout message must be in a text ContentBlock').toBeDefined();
    expect(textBlock.content, 'text block must contain lockout text').toContain('LOCKED');
  });
});
