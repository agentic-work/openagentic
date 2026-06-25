/**
 * Wave 5 — stream.handler persistence + prior-message wiring.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §272-302.
 *
 * V1's `ChatPipeline` loaded prior conversation messages, persisted the
 * incoming user message, and persisted the final assistant message. After
 * Wave 4 the cutover lost those three behaviors. Wave 5 reintroduces them
 * through `ChatStreamHandlerDeps.{loadPriorMessages, persistUserMessage,
 * persistAssistantMessage}` so the handler can call them without re-importing
 * ChatStorageService.
 *
 * Verified contracts:
 *   1. When the handler is given `loadPriorMessages`, it fetches and passes
 *      the result to `runChat` (the pipeline entry accepts a
 *      `priorMessages` input field — wired Wave 3).
 *   2. The handler calls `persistUserMessage` BEFORE invoking `runChat`.
 *   3. The handler calls `persistAssistantMessage` AFTER `runChat`
 *      emits `assistant_message_stop`.
 *   4. A 2-message session: turn 2 sees turn-1's prior messages in the
 *      pipeline input.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../../../../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async () => ({ id: 'session-w5' })),
      findUnique: vi.fn(async () => ({ id: 'session-w5', metadata: {} })),
      update: vi.fn(async () => ({})),
    },
    chatMessage: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('../../../../services/ScopeEnforcementService.js', () => ({
  isUserLocked: vi.fn(async () => false),
  analyzeMessageScope: vi.fn(() => ({ isInScope: true, confidence: 0, reason: '' })),
  recordScopeViolation: vi.fn(async () => ({ warningCount: 0, isLocked: false, message: '' })),
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
  AITitleGenerationService: class { async generateTitle() { return 'Test'; } },
}));
vi.mock('../../../../services/TitleGenerationClient.js', () => ({
  TitleGenerationClient: class {},
}));

import { streamHandler } from '../stream.handler.js';
import {
  resetBuiltInAgentRegistry,
  type BuiltInAgentRegistryEntry,
} from '../../../../services/BuiltInAgentRegistry.js';
import * as runChatModule from '../../pipeline/chat/runChat.js';

interface FakeRaw extends EventEmitter {
  writeHead: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  flushHeaders: ReturnType<typeof vi.fn>;
  socket: { setNoDelay: () => void; uncork: () => void };
}

function makeFakeRaw(): FakeRaw {
  const ee = new EventEmitter() as any;
  ee.writeHead = vi.fn();
  ee.write = vi.fn(() => true);
  ee.end = vi.fn();
  ee.flushHeaders = vi.fn();
  ee.socket = { setNoDelay: vi.fn(), uncork: vi.fn() };
  return ee as FakeRaw;
}

function makeFakeReply() {
  const raw = makeFakeRaw();
  return {
    raw, sent: false,
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as any;
}

function makeFakeRequest(sessionId: string, message = 'hello') {
  const reqRaw = new EventEmitter() as any;
  return {
    raw: reqRaw,
    user: { id: 'user-w5', isAdmin: true },
    body: { message, sessionId },
    headers: {},
  } as any;
}

function makeLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

const BUILT_INS: BuiltInAgentRegistryEntry[] = [
  { agent_type: 'cloud-operations', display_name: 'Cloud Ops', description: 'cloud', tools: [], model: 'sonnet', body: 'b' },
];

function makeV2Deps(over: any = {}): any {
  return {
    providerManager: {
      createCompletion: vi.fn().mockResolvedValue({
        choices: [{ index: 0, message: { role: 'assistant', content: 'final answer' }, finish_reason: 'stop' }],
      }),
    },
    listAgents: vi.fn().mockResolvedValue(BUILT_INS),
    runSubagent: vi.fn(),
    executeMcpTool: vi.fn(),
    executeBrowserSandbox: vi.fn(),
    ...over,
  };
}

describe('Wave 5 — stream.handler persistence + prior messages', () => {
  beforeEach(() => { resetBuiltInAgentRegistry(); });
  afterEach(() => { vi.clearAllMocks(); resetBuiltInAgentRegistry(); });

  it('calls loadPriorMessages and forwards the result into runChat', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-w5-prior', 'turn 2');
    const logger = makeLogger();

    const priorMessages = [
      { role: 'user' as const, content: 'turn 1' },
      { role: 'assistant' as const, content: 'turn 1 response' },
    ];

    const loadPriorMessages = vi.fn().mockResolvedValue(priorMessages);
    const runChatSpy = vi.spyOn(runChatModule, 'runChat')
      .mockResolvedValue({ ok: true, turns: 1, toolUses: [] });

    const deps = {
      v2Deps: makeV2Deps(),
      listMcpTools: vi.fn().mockResolvedValue([]),
      pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
      loadPriorMessages,
    };

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    expect(loadPriorMessages).toHaveBeenCalledWith('session-w5-prior', 'user-w5');
    expect(runChatSpy).toHaveBeenCalledTimes(1);
    const v2Input = runChatSpy.mock.calls[0][1];
    expect(v2Input.priorMessages).toEqual(priorMessages);

    runChatSpy.mockRestore();
  });

  it('persists user message BEFORE invoking the V2 pipeline', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-w5-user', 'show me my azure subs');
    const logger = makeLogger();

    const callOrder: string[] = [];
    const persistUserMessage = vi.fn(async () => { callOrder.push('persist'); });
    const runChatSpy = vi.spyOn(runChatModule, 'runChat')
      .mockImplementation(async () => {
        callOrder.push('v2');
        return { ok: true, turns: 1, toolUses: [] };
      });

    const deps = {
      v2Deps: makeV2Deps(),
      listMcpTools: vi.fn().mockResolvedValue([]),
      pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
      persistUserMessage,
    };

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    expect(persistUserMessage).toHaveBeenCalledWith(
      'session-w5-user',
      'show me my azure subs',
      expect.objectContaining({ userId: 'user-w5' }),
    );
    expect(callOrder).toEqual(['persist', 'v2']);

    runChatSpy.mockRestore();
  });

  it('persists assistant message AFTER the V2 pipeline completes', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-w5-asst', 'q');
    const logger = makeLogger();

    const callOrder: string[] = [];
    const persistAssistantMessage = vi.fn(async () => { callOrder.push('persist'); });
    const runChatSpy = vi.spyOn(runChatModule, 'runChat')
      .mockImplementation(async (ctx: any) => {
        callOrder.push('v2');
        // Simulate V2 emitting assistant content + stop frame.
        ctx.emit('assistant_message_delta', { text: 'hello world' });
        ctx.emit('assistant_message_stop', { reason: 'end_turn' });
        return { ok: true, turns: 1, toolUses: [] };
      });

    const deps = {
      v2Deps: makeV2Deps(),
      listMcpTools: vi.fn().mockResolvedValue([]),
      pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
      persistAssistantMessage,
    };

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    expect(persistAssistantMessage).toHaveBeenCalledTimes(1);
    const args = persistAssistantMessage.mock.calls[0];
    expect(args[0]).toBe('session-w5-asst');
    // Assistant content equals the joined deltas.
    expect(typeof args[1]).toBe('string');
    expect(args[1]).toContain('hello world');
    expect(args[2]).toMatchObject({ userId: 'user-w5', model: 'gpt-oss:20b' });
    expect(callOrder).toEqual(['v2', 'persist']);

    runChatSpy.mockRestore();
  });

  // Persistence Sev-1: inline render frames (visual_render / app_render /
  // streaming_table / inline_widget / sub_agent_complete) emitted during
  // the V2 turn must be accumulated and forwarded to persistAssistantMessage
  // as `visualizations`. Without this they exist only as NDJSON frames and
  // vanish on session reload.
  it('persistAssistantMessage receives accumulated inline visualization frames', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-vis', 'q');
    const logger = makeLogger();

    const persistAssistantMessage = vi.fn(async () => {});
    const visualPayload = { template: 'kpi_grid', kind: 'kpi_grid' };
    const appPayload = { artifactId: 'app-1', html: '<html></html>' };
    const tablePayload = { artifactId: 'tbl-1', rows: [['a', 1]] };

    const runChatSpy = vi.spyOn(runChatModule, 'runChat')
      .mockImplementation(async (ctx: any) => {
        ctx.emit('assistant_message_delta', { text: 'rendering inline' });
        ctx.emit('visual_render', visualPayload);
        ctx.emit('app_render', appPayload);
        ctx.emit('streaming_table', tablePayload);
        // A non-persistable frame must NOT make it into visualizations[]
        ctx.emit('thinking_delta', { text: 'noise' });
        ctx.emit('assistant_message_stop', { reason: 'end_turn' });
        return { ok: true, turns: 1, toolUses: [] };
      });

    const deps = {
      v2Deps: makeV2Deps(),
      listMcpTools: vi.fn().mockResolvedValue([]),
      pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
      persistAssistantMessage,
    };

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    expect(persistAssistantMessage).toHaveBeenCalledTimes(1);
    const opts = persistAssistantMessage.mock.calls[0][2];
    expect(Array.isArray(opts.visualizations)).toBe(true);
    expect(opts.visualizations).toEqual([
      { type: 'visual_render', data: visualPayload },
      { type: 'app_render', data: appPayload },
      { type: 'streaming_table', data: tablePayload },
    ]);

    runChatSpy.mockRestore();
  });

  // When no inline frames fire, visualizations must be undefined (not an
  // empty array) — keeps the persisted column null for boring text turns.
  it('persistAssistantMessage omits visualizations when no inline frames fired', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-novis', 'q');
    const logger = makeLogger();

    const persistAssistantMessage = vi.fn(async () => {});
    const runChatSpy = vi.spyOn(runChatModule, 'runChat')
      .mockImplementation(async (ctx: any) => {
        ctx.emit('assistant_message_delta', { text: 'plain prose' });
        ctx.emit('assistant_message_stop', { reason: 'end_turn' });
        return { ok: true, turns: 1, toolUses: [] };
      });

    const deps = {
      v2Deps: makeV2Deps(),
      listMcpTools: vi.fn().mockResolvedValue([]),
      pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
      persistAssistantMessage,
    };

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    const opts = persistAssistantMessage.mock.calls[0][2];
    expect(opts.visualizations).toBeUndefined();

    runChatSpy.mockRestore();
  });
});
