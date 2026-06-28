/**
 * HITL.2 — stream.handler HITL approval bridge.
 *
 * When openagentic-proxy emits an `mcp_approval_required` event through the
 * AgentEventStore (via /api/chat/agent-event), stream.handler must
 * re-emit it as a TOP-LEVEL NDJSON frame of type 'mcp_approval_required'
 * (NOT as an 'agent_progress' wrapper). This lets useChatStream.ts:4165
 * case 'mcp_approval_required' handle it inline — that case is only reached
 * when the frame type IS 'mcp_approval_required' at the top level.
 *
 * The frame MUST carry:
 *   - type: 'mcp_approval_required'
 *   - data.requestId       (for Redis pub/sub correlation)
 *   - data.toolName        (for UI label)
 *   - data.parentToolUseId (for inline positioning at the sub-agent tool card)
 *   - data.riskLevel
 *   - data.reason
 *   - data.timeoutMs
 *   - data.source: 'openagentic-proxy'
 *
 * RED: fails because the existing AgentEventStore subscription in
 * stream.handler wraps ALL events as 'agent_progress' — no special-casing
 * for HITL events.
 *
 * GREEN: passes once the bridge detects mcp_approval_required / hitl_approval /
 * mcp_approval_resolved events and emits them at the top level.
 *
 * Uses the same test harness as stream.handler.agentProgress.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ──── same stub set as stream.handler.agentProgress.test.ts ────

vi.mock('../../../../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async () => ({ id: 'session-hitl-bridge' })),
      update: vi.fn(async () => ({})),
    },
    chatMessage: {
      findMany: vi.fn(async () => []),
    },
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
  getStreamRingBuffer: vi.fn(() => ({
    append: vi.fn(async () => {}),
  })),
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
  AITitleGenerationService: class { async generateTitle() { return 'Test Title'; } },
}));
vi.mock('../../../../services/TitleGenerationClient.js', () => ({
  TitleGenerationClient: class {},
}));

// ──── imports ─────────────────────────────────────────────────────────────

import { streamHandler, type ChatStreamHandlerDeps } from '../stream.handler.js';
import { getAgentEventStore } from '../../../../services/AgentEventStore.js';

// ──── helpers (from agentProgress test) ──────────────────────────────────

function makeFakeRaw(): any {
  const ee = new EventEmitter() as any;
  ee.writeHead = vi.fn();
  ee.write = vi.fn(() => true);
  ee.end = vi.fn();
  ee.flushHeaders = vi.fn();
  ee.socket = { setNoDelay: vi.fn(), uncork: vi.fn() };
  return ee;
}

function makeFakeReply(): any {
  const raw = makeFakeRaw();
  return { raw, sent: false, code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
}

function makeFakeRequest(sessionId: string): any {
  const reqRaw = new EventEmitter() as any;
  return {
    raw: reqRaw,
    user: { id: 'user-hitl-bridge', isAdmin: true },
    body: { message: 'create a resource group', sessionId },
    headers: {},
  };
}

function makeLogger(): any {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), child: vi.fn().mockReturnThis() };
}

function collectWrittenFrames(raw: any): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (const call of raw.write.mock.calls) {
    const arg = call[0];
    if (typeof arg !== 'string') continue;
    for (const line of arg.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* ignore */ }
    }
  }
  return out;
}

function makeV2DepsWithHook(hook?: () => void | Promise<void>): ChatStreamHandlerDeps {
  return {
    v2Deps: {
      providerManager: {
        createCompletion: vi.fn(async () => {
          if (hook) await hook();
          return { choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] };
        }),
      } as any,
      listAgents: vi.fn().mockResolvedValue([]),
      runSubagent: vi.fn().mockResolvedValue({ ok: true, output: 'done', turns: 1, tokens: 100, durationMs: 50, toolsUsed: [] }),
      executeMcpTool: vi.fn().mockResolvedValue({ ok: true, output: '[]' }),
      executeBrowserSandbox: vi.fn().mockResolvedValue({ ok: true, output: 'js done' }),
    },
    listMcpTools: vi.fn().mockResolvedValue([]),
    pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
  };
}

// ──── tests ───────────────────────────────────────────────────────────────

describe('stream.handler → HITL approval bridge (HITL.2)', () => {
  let store: ReturnType<typeof getAgentEventStore>;

  beforeEach(() => {
    store = getAgentEventStore();
    store.__clear();
  });

  afterEach(() => {
    store.__clear();
    vi.clearAllMocks();
  });

  // ── Core contract: mcp_approval_required emitted as TOP-LEVEL frame ──────

  it('re-emits mcp_approval_required as a top-level NDJSON frame (NOT agent_progress)', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-hitl-1');
    const logger = makeLogger();

    const hitlPayload = {
      requestId: 'req-hitl-001',
      toolName: 'azure_create_resource_group',
      arguments: { name: 'rg-prod', location: 'eastus' },
      riskLevel: 'high',
      reason: 'Creates a new Azure resource group in production subscription',
      timeoutMs: 300_000,
      parentToolUseId: 'toolu_abc123456',
      source: 'openagentic-proxy',
      timestamp: Date.now(),
    };

    const deps = makeV2DepsWithHook(async () => {
      const frames = collectWrittenFrames(reply.raw);
      const start = frames.find((f) => f.type === 'stream_start');
      const capturedTurnId = start?.turnId as string | undefined;
      expect(capturedTurnId, 'stream_start must have emitted turnId').toBeTruthy();

      store.publish({
        turnId: capturedTurnId!,
        agentId: 'agent-sub-hitl',
        event: 'mcp_approval_required',
        payload: hitlPayload,
        timestamp: Date.now(),
      });
      await Promise.resolve();
    });

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    const frames = collectWrittenFrames(reply.raw);

    // ── RED assertion: top-level mcp_approval_required frame must exist ──
    const hitlFrame = frames.find((f) => f.type === 'mcp_approval_required');
    expect(hitlFrame, 'mcp_approval_required must arrive as a top-level NDJSON frame').toBeTruthy();

    // ── Must NOT be wrapped as agent_progress ──
    const agentProgressFrames = frames.filter((f) => f.type === 'agent_progress');
    const hitlViaProgress = agentProgressFrames.find((f) => f.event === 'mcp_approval_required');
    expect(hitlViaProgress, 'mcp_approval_required must NOT be wrapped in agent_progress').toBeUndefined();
  });

  it('top-level mcp_approval_required frame contains required data fields', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-hitl-2');
    const logger = makeLogger();

    const expectedPayload = {
      requestId: 'req-hitl-002',
      toolName: 'k8s_apply_manifest',
      arguments: { manifest: '...' },
      riskLevel: 'high' as const,
      reason: 'Modifies production k8s cluster',
      timeoutMs: 300_000,
      parentToolUseId: 'toolu_xyz987654',
      source: 'openagentic-proxy',
      timestamp: Date.now(),
    };

    const deps = makeV2DepsWithHook(async () => {
      const frames = collectWrittenFrames(reply.raw);
      const start = frames.find((f) => f.type === 'stream_start');
      const capturedTurnId = start?.turnId as string | undefined;

      store.publish({
        turnId: capturedTurnId!,
        agentId: 'agent-sub-k8s',
        event: 'mcp_approval_required',
        payload: expectedPayload,
        timestamp: Date.now(),
      });
      await Promise.resolve();
    });

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    const frames = collectWrittenFrames(reply.raw);
    const hitlFrame = frames.find((f) => f.type === 'mcp_approval_required');
    expect(hitlFrame, 'mcp_approval_required frame must exist').toBeTruthy();

    // The frame's `data` object must carry all required fields.
    // The UI side (useChatStream.ts:4168) reads from `safeData` where
    // safeData IS the parsed NDJSON line — so top-level fields or a `data`
    // sub-object depending on how the bridge emits. Check both patterns.
    const d = hitlFrame!.data ?? hitlFrame!;
    expect(d.requestId, 'requestId must be present').toBe('req-hitl-002');
    expect(d.toolName, 'toolName must be present').toBe('k8s_apply_manifest');
    expect(d.parentToolUseId, 'parentToolUseId must be present (inline positioning)').toBe('toolu_xyz987654');
    expect(d.riskLevel, 'riskLevel must be present').toBe('high');
    expect(d.reason, 'reason must be present').toBeTruthy();
    expect(d.timeoutMs, 'timeoutMs must be present').toBe(300_000);
    expect(d.source, 'source must be present').toBe('openagentic-proxy');
  });

  it('re-emits mcp_approval_resolved as a top-level NDJSON frame', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-hitl-3');
    const logger = makeLogger();

    const deps = makeV2DepsWithHook(async () => {
      const frames = collectWrittenFrames(reply.raw);
      const start = frames.find((f) => f.type === 'stream_start');
      const capturedTurnId = start?.turnId as string | undefined;

      store.publish({
        turnId: capturedTurnId!,
        agentId: 'agent-sub-hitl',
        event: 'mcp_approval_resolved',
        payload: { requestId: 'req-resolved-001', decision: 'approved', approvedBy: 'admin@example.com' },
        timestamp: Date.now(),
      });
      await Promise.resolve();
    });

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    const frames = collectWrittenFrames(reply.raw);
    const resolvedFrame = frames.find((f) => f.type === 'mcp_approval_resolved');
    expect(resolvedFrame, 'mcp_approval_resolved must arrive as top-level NDJSON frame').toBeTruthy();

    const d = resolvedFrame!.data ?? resolvedFrame!;
    expect(d.requestId).toBe('req-resolved-001');
    expect(d.decision).toBe('approved');
  });

  it('non-HITL agent events continue to arrive as agent_progress (regression guard)', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-hitl-4');
    const logger = makeLogger();

    const deps = makeV2DepsWithHook(async () => {
      const frames = collectWrittenFrames(reply.raw);
      const start = frames.find((f) => f.type === 'stream_start');
      const capturedTurnId = start?.turnId as string | undefined;

      // Regular agent_start event — must still arrive as agent_progress
      store.publish({
        turnId: capturedTurnId!,
        agentId: 'agent-sub-regular',
        event: 'agent_start',
        payload: { task: 'list resources', role: 'research' },
        timestamp: Date.now(),
      });
      await Promise.resolve();
    });

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    const frames = collectWrittenFrames(reply.raw);
    const agentProgress = frames.filter((f) => f.type === 'agent_progress' && f.agentId === 'agent-sub-regular');
    expect(agentProgress.length, 'agent_start must still arrive as agent_progress').toBeGreaterThanOrEqual(1);
    expect(agentProgress[0].event).toBe('agent_start');
  });
});
