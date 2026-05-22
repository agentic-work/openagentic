/**
 * Scope Enforcement integration tests for stream.handler.ts
 *
 * [scope-rewire] Diagnostic finding (2026-05-19):
 *   GAP (b+d) — Two compound bugs prevented enforcement from firing:
 *
 *   1. Confidence threshold too high (line 642 before fix: `>= 0.7`).
 *      Single-keyword off-topic prompts reach confidence=0.6 (0.5+0.1),
 *      which falls below the gate. "recipe for chocolate cake" (recipe=1
 *      prohibited keyword, 0 allowed) → confidence=0.6 → NOT blocked.
 *      "write me a poem" (poem=1 prohibited, 0 allowed) → 0.6 → NOT blocked.
 *      "what's the meaning of life" → no keywords → lenient default
 *      isInScope:true → NOT blocked at all.
 *      FIX: lower threshold to >= 0.5 so any off-topic signal with zero
 *      allowed-keyword counterbalance blocks.
 *
 *   2. Wrong response shape (lines 655-672 before fix). On violation, the
 *      handler called `reply.code(400/403).send({error:{...}})`, a non-
 *      streaming JSON response. The UI's `!response.ok` branch at
 *      useChatStream.ts:2472 caught this as a generic
 *      "HTTP error! status: 400" and threw — the warning message from
 *      ScopeEnforcementService was never shown to the user.
 *      FIX: write 200 NDJSON headers, emit the warning as a `stream` text
 *      frame + `stream_complete`, then end. Hard locks (4th violation or
 *      already-locked) still get 403 pre-headers since the UI has explicit
 *      handling for those (session expiry / retry paths are different from
 *      "see warning in chat bubble").
 *
 * AC coverage:
 *   Test 1 — non-admin off-topic: warning streamed, model NOT invoked, violation recorded
 *   Test 2 — 4th violation: account auto-locks, locked message streamed
 *   Test 3 — admin bypass: recordViolation never called, model proceeds
 *   Test 4 — non-admin on-topic: no violation, model proceeds
 *   Test 5 — pre-locked user: immediate NDJSON rejection, model NOT invoked
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── all dynamic-import stubs must be declared before any real import ──

vi.mock('../../../../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async () => ({ id: 'session-scope-test' })),
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

// ScopeEnforcementService — controlled per test via mockImplementation
vi.mock('../../../../services/ScopeEnforcementService.js', () => ({
  isUserLocked: vi.fn(async () => false),
  analyzeMessageScope: vi.fn(() => ({ isInScope: true, confidence: 0, reason: '' })),
  recordScopeViolation: vi.fn(async () => ({ warningCount: 1, isLocked: false, message: '⚠️ **Off-topic request detected.** Warning 1 of 3.' })),
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

// Import the mocked service functions so we can set up per-test behaviour
import {
  isUserLocked,
  analyzeMessageScope,
  recordScopeViolation,
} from '../../../../services/ScopeEnforcementService.js';

import { streamHandler, type ChatStreamHandlerDeps } from '../stream.handler.js';

// ── test doubles ─────────────────────────────────────────────────────────────

const runChatMock = vi.fn(async () => {});

/** Minimal V2 deps that capture whether runChat was called */
function makePassthroughDeps(): ChatStreamHandlerDeps {
  return {
    v2Deps: {
      providerManager: {
        createCompletion: vi.fn(async () => ({
          choices: [
            { index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' },
          ],
        })),
      } as any,
      listAgents: vi.fn().mockResolvedValue([]),
      runSubagent: vi.fn().mockResolvedValue({ ok: true, output: 'done', turns: 1, tokens: 10, durationMs: 10, toolsUsed: [] }),
      executeMcpTool: vi.fn().mockResolvedValue({ ok: true, output: '[]' }),
      executeBrowserSandbox: vi.fn().mockResolvedValue({ ok: true, output: 'js done' }),
    },
    listMcpTools: vi.fn().mockResolvedValue([]),
    pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
  };
}

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
    user: { id: 'user-scope-test', isAdmin: opts.isAdmin ?? false },
    body: {
      message: opts.message,
      sessionId: opts.sessionId ?? 'session-scope-1',
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

/**
 * Parse all NDJSON lines written to reply.raw.write into typed objects.
 * Filters out keepalive pings and incomplete lines.
 */
function collectWrittenFrames(raw: FakeRaw): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const call of raw.write.mock.calls) {
    const arg = call[0];
    if (typeof arg !== 'string') continue;
    for (const line of arg.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // ignore non-JSON lines
      }
    }
  }
  return out;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('stream.handler — scope enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runChatMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: off-topic message from non-admin ──────────────────────────────

  it('Test 1: non-admin off-topic prompt → warning streamed, model NOT invoked, violation recorded', async () => {
    // classifier says off-topic
    vi.mocked(analyzeMessageScope).mockReturnValue({ isInScope: false, confidence: 0.6, reason: 'Prohibited: recipe' });
    vi.mocked(isUserLocked).mockResolvedValue(false);
    vi.mocked(recordScopeViolation).mockResolvedValue({
      isLocked: false,
      warningCount: 1,
      shouldBlock: false,
      message: '⚠️ **Off-topic request detected.** I\'m designed to help with cloud and infrastructure topics only. Please rephrase your question to focus on technical/work-related matters. *This is warning 1 of 3.*',
    });

    const deps = makePassthroughDeps();
    const handler = streamHandler(deps, makeLogger());
    const reply = makeFakeReply();
    const req = makeFakeRequest({ message: 'recipe for chocolate cake', isAdmin: false });

    await handler(req, reply as any);

    // violation must be recorded
    expect(recordScopeViolation).toHaveBeenCalledOnce();
    expect(recordScopeViolation).toHaveBeenCalledWith('user-scope-test', expect.stringContaining('recipe'));

    // response MUST be a 200 NDJSON stream (not a 4xx error)
    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/x-ndjson' }));

    // warning message must appear in stream frames
    const frames = collectWrittenFrames(reply.raw);
    const streamFrames = frames.filter(f => f.type === 'stream' || f.type === 'content_delta');
    const warningFrame = streamFrames.find(f =>
      typeof f.content === 'string' && f.content.includes('Off-topic') ||
      typeof (f as any).data?.content === 'string' && (f as any).data.content.includes('Off-topic')
    );
    expect(warningFrame, 'warning message should appear in stream as text frame').toBeDefined();

    // stream must end with stream_complete
    const completeFrame = frames.find(f => f.type === 'stream_complete');
    expect(completeFrame, 'stream_complete must be emitted').toBeDefined();

    // model must NOT be invoked
    expect(deps.pickModel).not.toHaveBeenCalled();
    expect((deps.v2Deps.providerManager as any).createCompletion).not.toHaveBeenCalled();
  });

  // ── Test 2: 4th violation → account locks, lockout message streamed ───────

  it('Test 2: 4th violation → account auto-locks, lockout message streamed, subsequent requests rejected', async () => {
    vi.mocked(analyzeMessageScope).mockReturnValue({ isInScope: false, confidence: 0.6, reason: 'Prohibited: story' });
    vi.mocked(isUserLocked).mockResolvedValue(false);
    vi.mocked(recordScopeViolation).mockResolvedValue({
      isLocked: true,
      warningCount: 4,
      shouldBlock: true,
      message: '🔒 **ACCOUNT LOCKED** — Your account has been locked due to repeated policy violations. Please contact your administrator to restore access.',
    });

    const deps = makePassthroughDeps();
    const handler = streamHandler(deps, makeLogger());
    const reply = makeFakeReply();
    const req = makeFakeRequest({ message: 'tell me a story', isAdmin: false });

    await handler(req, reply as any);

    // violation must still be recorded (the service handles the lock internally)
    expect(recordScopeViolation).toHaveBeenCalledOnce();

    // response must be a stream (200 NDJSON), not a 403 JSON error
    // The lockout message goes in the stream so the UI renders it in the chat bubble
    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/x-ndjson' }));

    const frames = collectWrittenFrames(reply.raw);

    // lockout message must appear in stream
    const streamFrames = frames.filter(f => f.type === 'stream' || f.type === 'content_delta');
    const lockFrame = streamFrames.find(f =>
      typeof f.content === 'string' && f.content.includes('ACCOUNT LOCKED') ||
      typeof (f as any).data?.content === 'string' && (f as any).data.content.includes('ACCOUNT LOCKED')
    );
    expect(lockFrame, 'lockout message should appear in stream').toBeDefined();

    // stream_complete must follow
    const completeFrame = frames.find(f => f.type === 'stream_complete');
    expect(completeFrame, 'stream_complete must be emitted after lockout').toBeDefined();

    // model must NOT be invoked
    expect(deps.pickModel).not.toHaveBeenCalled();

    // ── subsequent request: user is now locked ────────────────────────────
    vi.mocked(isUserLocked).mockResolvedValue(true);
    vi.mocked(recordScopeViolation).mockResolvedValue({
      isLocked: true,
      warningCount: 4,
      shouldBlock: true,
      message: '🔒 **ACCOUNT LOCKED** — Your account has been locked due to repeated policy violations. Please contact your administrator to restore access.',
    });

    const reply2 = makeFakeReply();
    const req2 = makeFakeRequest({ message: 'show me my azure VMs', isAdmin: false });
    await handler(req2, reply2 as any);

    // locked check fires — must NOT proceed to model
    expect(deps.v2Deps.providerManager.createCompletion).not.toHaveBeenCalled();
    // No new violation should be recorded — lock check short-circuits before classifier
    expect(recordScopeViolation).toHaveBeenCalledTimes(1); // only the first call above

    // Locked response must be in the stream, not a 403
    expect(reply2.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/x-ndjson' }));
    const frames2 = collectWrittenFrames(reply2.raw);
    const lockFrames2 = frames2.filter(f => f.type === 'stream' || f.type === 'content_delta');
    const lockedMsg = lockFrames2.find(f =>
      typeof f.content === 'string' && (f.content.includes('locked') || f.content.includes('LOCKED')) ||
      typeof (f as any).data?.content === 'string' && ((f as any).data.content.includes('locked') || (f as any).data.content.includes('LOCKED'))
    );
    expect(lockedMsg, 'locked-account message should appear in stream on subsequent request').toBeDefined();
  });

  // ── Test 3: admin user bypasses scope enforcement entirely ────────────────

  it('Test 3: admin user submits off-topic message → enforcement bypassed, model proceeds', async () => {
    vi.mocked(analyzeMessageScope).mockReturnValue({ isInScope: false, confidence: 0.9, reason: 'Prohibited: recipe, cook' });
    vi.mocked(isUserLocked).mockResolvedValue(false);

    const deps = makePassthroughDeps();
    const handler = streamHandler(deps, makeLogger());
    const reply = makeFakeReply();
    const req = makeFakeRequest({ message: 'recipe for chocolate cake', isAdmin: true });

    await handler(req, reply as any);

    // recordViolation must NEVER be called for admins
    expect(recordScopeViolation).not.toHaveBeenCalled();

    // analyzeMessageScope might be called (the check reads isAdmin first);
    // either way, the STREAM must proceed to the model (pickModel called)
    expect(deps.pickModel).toHaveBeenCalled();
  });

  // ── Test 4: non-admin on-topic message → no violation, model proceeds ─────

  it('Test 4: non-admin on-topic message → no violation recorded, model proceeds normally', async () => {
    vi.mocked(analyzeMessageScope).mockReturnValue({ isInScope: true, confidence: 0.85, reason: 'Work-related keywords: azure, vm' });
    vi.mocked(isUserLocked).mockResolvedValue(false);

    const deps = makePassthroughDeps();
    const handler = streamHandler(deps, makeLogger());
    const reply = makeFakeReply();
    const req = makeFakeRequest({ message: 'show me my Azure VMs', isAdmin: false });

    await handler(req, reply as any);

    // no violation should be recorded
    expect(recordScopeViolation).not.toHaveBeenCalled();

    // model must be invoked (stream should proceed)
    expect(deps.pickModel).toHaveBeenCalled();
  });

  // ── Test 5: pre-locked user → immediate NDJSON rejection, model NOT invoked

  it('Test 5: pre-locked user → immediate NDJSON rejection before model, no new violation', async () => {
    vi.mocked(isUserLocked).mockResolvedValue(true);

    const deps = makePassthroughDeps();
    const handler = streamHandler(deps, makeLogger());
    const reply = makeFakeReply();
    // on-topic message — the topic doesn't matter; lock check fires first
    const req = makeFakeRequest({ message: 'show me my Azure VMs', isAdmin: false });

    await handler(req, reply as any);

    // isUserLocked must have been checked
    expect(isUserLocked).toHaveBeenCalledWith('user-scope-test');

    // recordViolation must NOT be called — already locked
    expect(recordScopeViolation).not.toHaveBeenCalled();

    // model must NOT be invoked
    expect(deps.pickModel).not.toHaveBeenCalled();
    expect((deps.v2Deps.providerManager as any).createCompletion).not.toHaveBeenCalled();

    // Response must be a 200 NDJSON stream with locked message, NOT a 403 JSON error
    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/x-ndjson' }));
    const frames = collectWrittenFrames(reply.raw);
    const streamFrames = frames.filter(f => f.type === 'stream' || f.type === 'content_delta');
    const lockedMsg = streamFrames.find(f =>
      typeof f.content === 'string' && (f.content.includes('locked') || f.content.includes('LOCKED') || f.content.includes('policy')) ||
      typeof (f as any).data?.content === 'string' && ((f as any).data.content.includes('locked') || (f as any).data.content.includes('LOCKED'))
    );
    expect(lockedMsg, 'locked-account message must be in NDJSON stream, not a 403 error').toBeDefined();
    const completeFrame = frames.find(f => f.type === 'stream_complete');
    expect(completeFrame, 'stream_complete must follow locked-account message').toBeDefined();
  });
});

// ── Sev-1 2026-05-19: classifier keyword gap ──────────────────────────────────
//
// analyzeMessageScope is a pure synchronous function — test it directly without
// the full handler apparatus. These cases are tested against the REAL
// analyzeMessageScope implementation (not mocked) by importing from the module
// that is NOT mocked in this describe block.
//
// NOTE: The vi.mock('../../../../services/ScopeEnforcementService.js') call at
// the top of this file stubs the module for the describe block above. To get
// the real implementation for unit tests we import the module directly and
// use the un-mocked export. Because vi.mock hoists, we must re-import via a
// dynamic import inside beforeAll or use vi.importActual.

import { analyzeMessageScope as realAnalyzeMessageScope } from '../../../../services/ScopeEnforcementService.js';

describe('ScopeEnforcementService.analyzeMessageScope — keyword gap (Sev-1 2026-05-19)', () => {
  // NOTE: The vi.mock at top of file stubs analyzeMessageScope for the handler
  // integration tests. Here we directly invoke the named export which vitest
  // resolves to the mocked version. We use vi.importActual to get the real one.
  let analyze: typeof realAnalyzeMessageScope;

  beforeAll(async () => {
    const real = await vi.importActual<typeof import('../../../../services/ScopeEnforcementService.js')>(
      '../../../../services/ScopeEnforcementService.js'
    );
    analyze = real.analyzeMessageScope;
  });

  // ── Test 6: philosophy / "meaning of life" → off-topic ───────────────────

  it('Test 6: "What\'s the meaning of life?" → off-topic (philosophy gap)', () => {
    const result = analyze("What's the meaning of life?");
    expect(result.isInScope, `"What's the meaning of life?" should be blocked. Reason: ${result.reason}`).toBe(false);
  });

  // ── Test 7: explicit history question → off-topic ────────────────────────

  it('Test 7: "Tell me about the history of Rome" → off-topic', () => {
    const result = analyze('Tell me about the history of Rome');
    expect(result.isInScope, `History of Rome should be blocked. Reason: ${result.reason}`).toBe(false);
  });

  // ── Test 8: weather → off-topic ──────────────────────────────────────────

  it('Test 8: "What\'s the weather like?" → off-topic', () => {
    const result = analyze("What's the weather like?");
    expect(result.isInScope, `Weather should be blocked. Reason: ${result.reason}`).toBe(false);
  });

  // ── Test 9: on-topic Azure request → NOT blocked ─────────────────────────

  it('Test 9: "Show me my Azure subscriptions" → on-topic (must NOT be blocked)', () => {
    const result = analyze('Show me my Azure subscriptions');
    expect(result.isInScope, `Azure subscriptions should be allowed. Reason: ${result.reason}`).toBe(true);
  });

  // ── Test 10: kubernetes + history → tech wins, on-topic ──────────────────

  it('Test 10: "What\'s the history of kubernetes?" → on-topic (kubernetes wins over history)', () => {
    const result = analyze("What's the history of kubernetes?");
    expect(result.isInScope, `kubernetes history should be allowed (tech context wins). Reason: ${result.reason}`).toBe(true);
  });

  // ── Confidence floor sanity: single prohibited keyword clears >= 0.5 ─────

  it('single prohibited keyword with no allowed keywords scores confidence >= 0.5 (clears the enforcement threshold)', () => {
    // "philosophy" → 1 prohibited, 0 allowed → must reach confidence >= 0.5
    const result = analyze('philosophy');
    // Once the keyword is added, this must be off-topic
    expect(result.isInScope).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });
});
