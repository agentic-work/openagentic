/**
 * Wire-in B — stream.handler re-emits AgentEventStore events as
 * `agent_progress` NDJSON frames (feature #84).
 *
 * Contract: once the NDJSON stream is live on /api/chat/stream, the
 * handler subscribes to `getAgentEventStore()` keyed on the current
 * turn identifier. Every AgentProgressEvent published under that key
 * (by SubagentOrchestrator / openagentic-proxy via publishAgentEvent) must
 * appear on the wire as:
 *
 *   {"type":"agent_progress", turnId, agentId, event, payload, …}\n
 *
 * On client disconnect (reply.raw 'close') the subscription must be
 * removed so late publishers don't leak writes to a dead socket.
 *
 * We exercise the REAL `streamHandler` with the heavy-weight deps
 * stubbed via `vi.mock`: prisma (session ownership check), scope
 * enforcement, registry guard, ring buffer, stream-tail registry,
 * and metrics. The pipeline itself is a stub whose `process()`
 * publishes synthetic agent events via `publishAgentEvent()`. This
 * keeps the test scoped to the subscribe/re-emit wire while still
 * driving the real handler code path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ------- dynamic-import stubs (match the handler's runtime require paths)
vi.mock('../../../../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async () => ({ id: 'session-wireB' })),
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

// Title-generation chains (dynamically imported AFTER pipeline completes)
vi.mock('../../../../services/AITitleGenerationService.js', () => ({
  AITitleGenerationService: class { async generateTitle() { return 'Test Title'; } },
}));
vi.mock('../../../../services/TitleGenerationClient.js', () => ({
  TitleGenerationClient: class {},
}));

import { streamHandler, type ChatStreamHandlerDeps } from '../stream.handler.js';
import {
  getAgentEventStore,
  type AgentEventStore,
} from '../../../../services/AgentEventStore.js';
import { publishAgentEvent } from '../../../../services/subagentEventPublish.js';
import { publishFrame } from '../stream-tail.registry.js';

/**
 * Build a V2-deps double that lets a test trigger arbitrary side effects
 * during the chat turn. The test passes a `hook(streamCtx)` callback that
 * fires inside the providerManager.createCompletion mock — that's the
 * point at which the V2 loop is "in flight" and the AgentEventStore
 * subscription on the parent turnId is live.
 *
 * Returning an empty assistant message ends the turn cleanly (stop_reason
 * === 'end_turn') so the handler proceeds to its lifecycle finalization.
 */
function makeV2DepsWithHook(hook?: () => void | Promise<void>): ChatStreamHandlerDeps {
  return {
    v2Deps: {
      providerManager: {
        createCompletion: vi.fn(async () => {
          if (hook) await hook();
          return {
            choices: [
              { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
            ],
          };
        }),
      } as any,
      listAgents: vi.fn().mockResolvedValue([]),
      runSubagent: vi.fn().mockResolvedValue({
        ok: true, output: 'sub done', turns: 1, tokens: 100, durationMs: 50, toolsUsed: [],
      }),
      executeMcpTool: vi.fn().mockResolvedValue({ ok: true, output: '[]' }),
      executeBrowserSandbox: vi.fn().mockResolvedValue({ ok: true, output: 'js done' }),
    },
    listMcpTools: vi.fn().mockResolvedValue([]),
    pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
  };
}

// ---- test doubles for Fastify reply + request

interface FakeSocket {
  setNoDelay: () => void;
  uncork: () => void;
}
interface FakeRaw extends EventEmitter {
  writeHead: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  flushHeaders: ReturnType<typeof vi.fn>;
  socket: FakeSocket;
}

function makeFakeRaw(): FakeRaw {
  const ee = new EventEmitter() as any;
  ee.writeHead = vi.fn();
  ee.write = vi.fn(() => true);
  ee.end = vi.fn();
  ee.flushHeaders = vi.fn();
  ee.socket = {
    setNoDelay: vi.fn(),
    uncork: vi.fn(),
  };
  return ee as FakeRaw;
}

function makeFakeReply() {
  const raw = makeFakeRaw();
  return {
    raw,
    sent: false,
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as any;
}

function makeFakeRequest(sessionId: string) {
  const reqRaw = new EventEmitter() as any;
  return {
    raw: reqRaw,
    user: { id: 'user-wireB', isAdmin: true },
    body: {
      message: 'hello',
      sessionId,
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
 * Parse the NDJSON lines actually written to reply.raw.write.
 * Filters out keepalive pings and non-string writes.
 */
function collectWrittenFrames(raw: FakeRaw): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (const call of raw.write.mock.calls) {
    const arg = call[0];
    if (typeof arg !== 'string') continue;
    for (const line of arg.split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* ignore non-JSON */
      }
    }
  }
  return out;
}

describe('stream.handler → agent_progress re-emission (Wire-in B)', () => {
  let store: AgentEventStore;

  beforeEach(() => {
    store = getAgentEventStore();
    store.__clear();
  });

  afterEach(() => {
    store.__clear();
    vi.clearAllMocks();
  });

  it('subscribes on turn-open and re-emits published agent events as agent_progress frames', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-wireB-1');
    const logger = makeLogger();

    // Capture the turnId assigned by the handler when it sends its
    // `stream_start` frame — that's the parent-turn identifier the
    // AgentEventStore is keyed on, and the id SubagentOrchestrator
    // stamps onto every publishAgentEvent() call.
    let capturedTurnId: string | undefined;

    // Chat-pipeline deps: hook fires inside providerManager.createCompletion.
    // At that point the AgentEventStore subscription is already live (the
    // handler subscribes right after writing stream_start and BEFORE invoking
    // runChat). Publish a synthetic agent event under the captured turnId —
    // the subscription should re-emit it.
    const deps = makeV2DepsWithHook(async () => {
      const frames = collectWrittenFrames(reply.raw);
      const start = frames.find((f) => f.type === 'stream_start');
      capturedTurnId = start?.turnId as string | undefined;
      expect(capturedTurnId, 'handler must have emitted stream_start with turnId').toBeTruthy();

      publishAgentEvent(store, {
        turnId: capturedTurnId!,
        agentId: 'agent-wireB-1',
        agentRole: 'research',
        event: 'agent_start',
        payload: { task: 'scan' },
      });
      await Promise.resolve();
    });

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    // Verify: at least one agent_progress frame with our agent id.
    const frames = collectWrittenFrames(reply.raw);
    const agentProgress = frames.filter((f) => f.type === 'agent_progress');
    expect(agentProgress.length).toBeGreaterThanOrEqual(1);
    const first = agentProgress[0] as any;
    expect(first.agentId).toBe('agent-wireB-1');
    expect(first.event).toBe('agent_start');
    expect(first.turnId).toBe(capturedTurnId);
  });

  it('unsubscribes when the reply stream closes', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-wireB-2');
    const logger = makeLogger();

    let saw_alive_write = false;
    let saw_postclose_write = false;

    const deps = makeV2DepsWithHook(async () => {
      const frames = collectWrittenFrames(reply.raw);
      const start = frames.find((f) => f.type === 'stream_start');
      const capturedTurnId = start?.turnId as string | undefined;
      expect(capturedTurnId).toBeTruthy();

      // ── Invariant 1: pre-close publish IS re-emitted ──
      publishAgentEvent(store, {
        turnId: capturedTurnId!,
        agentId: 'agent-wireB-alive',
        event: 'agent_start',
        payload: {},
      });
      await Promise.resolve();
      const preCloseFrames = collectWrittenFrames(reply.raw);
      saw_alive_write = preCloseFrames.some(
        (f) => f.type === 'agent_progress' && f.agentId === 'agent-wireB-alive',
      );

      // ── Simulate disconnect ──
      reply.raw.emit('close');
      reply.raw.write.mockClear();

      // ── Invariant 2: post-close publish is DROPPED ──
      publishAgentEvent(store, {
        turnId: capturedTurnId!,
        agentId: 'agent-wireB-post-close',
        event: 'tool_executing',
        payload: {},
      });
      await Promise.resolve();
      const postCloseFrames = collectWrittenFrames(reply.raw);
      saw_postclose_write = postCloseFrames.some(
        (f) => f.type === 'agent_progress' && f.agentId === 'agent-wireB-post-close',
      );
    });

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    expect(saw_alive_write, 'pre-close publish MUST be re-emitted (proves subscription is live)').toBe(true);
    expect(saw_postclose_write, 'post-close publish MUST be dropped (proves unsubscribe fires on close)').toBe(false);
  });

  it('routes agent_progress through the sequencer + durable sink (gap-detect + replay)', async () => {
    // Every OTHER frame in the handler (ttft, stream, generic events)
    // flows through `writeNDJSONDurable(reply, type, sequencer.wrap(data),
    // durableSink)`. `agent_progress` must match: the client gap-detector
    // relies on `_seq`/`_runId`/`_ts`, and ring-buffer replay via
    // `/api/chat/stream/:s/tail?after=<seq>` relies on the durable sink
    // being fed every live frame. This spec pins both invariants.
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-wireB-3');
    const logger = makeLogger();

    const deps = makeV2DepsWithHook(async () => {
      const frames = collectWrittenFrames(reply.raw);
      const start = frames.find((f) => f.type === 'stream_start');
      const capturedTurnId = start?.turnId as string | undefined;
      expect(capturedTurnId).toBeTruthy();

      publishAgentEvent(store, {
        turnId: capturedTurnId!,
        agentId: 'agent-wireB-seq',
        agentRole: 'research',
        event: 'agent_start',
        payload: { task: 'seq-check' },
      });
      await Promise.resolve();
    });

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    // ── Invariant 1: the on-wire frame is sequencer-wrapped ──
    const written = collectWrittenFrames(reply.raw);
    const progress = written.find(
      (f) => f.type === 'agent_progress' && f.agentId === 'agent-wireB-seq',
    );
    expect(progress, 'agent_progress frame must reach the wire').toBeTruthy();
    expect(
      typeof progress!._seq,
      'agent_progress must carry _seq (gap-detector field)',
    ).toBe('number');
    expect(
      typeof progress!._runId,
      'agent_progress must carry _runId (run correlation)',
    ).toBe('string');
    expect(
      typeof progress!._ts,
      'agent_progress must carry _ts (wall-clock for replay ordering)',
    ).toBe('number');

    // ── Invariant 2: the durable sink persisted the same wrapped envelope ──
    // `publishFrame` is invoked from inside the durableSink closure for
    // every frame, so it's a faithful proxy for "sink fired". The ring
    // buffer path is symmetric; asserting one is enough to prove the
    // writeNDJSONDurable path was taken.
    const publishFrameMock = publishFrame as unknown as ReturnType<typeof vi.fn>;
    const sinkCallForAgentProgress = publishFrameMock.mock.calls.find((call) => {
      const line = call[2];
      return typeof line === 'string' && line.includes('"type":"agent_progress"')
        && line.includes('"agentId":"agent-wireB-seq"');
    });
    expect(
      sinkCallForAgentProgress,
      'durable sink (publishFrame) must receive the agent_progress line for ring-buffer replay',
    ).toBeTruthy();
    // Sink must receive the SAME wrapped envelope the wire received.
    const sinkLine = sinkCallForAgentProgress![2] as string;
    const sinkPayload = JSON.parse(sinkLine);
    expect(sinkPayload._seq).toBe(progress!._seq);
    expect(sinkPayload._runId).toBe(progress!._runId);
    expect(sinkPayload._ts).toBe(progress!._ts);
  });
});
