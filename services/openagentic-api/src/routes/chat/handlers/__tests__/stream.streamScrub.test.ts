/**
 * Sev-0 (2026-05-21) — stream-emit-path scrub for leaked
 * `compose_visual` / `compose_app` tool_use JSON args.
 *
 * Persistence-time scrub (commits `ab42fe9b` + `374e968a`) closes the
 * reload-time bug — post-reload bodies are clean. BUT the live streaming
 * bubble still shows raw JSON for several seconds because text_delta
 * frames hit the wire BEFORE persistence runs.
 *
 * This test pins the stream-emit-path fix. When a turn dispatches
 * `compose_visual` / `compose_app`, subsequent text_delta frames are
 * buffered, scrubbed via `stripArtifactJsonLeak`, then emitted at the
 * end-of-turn boundary. The user never sees the raw JSON in the live
 * bubble.
 *
 * Wire shape under test (gpt-oss live shape):
 *   tool_use(compose_visual)
 *   → text_delta("Sankey diagram of X")
 *   → text_delta("\n\nJSON\n{")
 *   → text_delta(' "template":"sankey", ... }')
 *   → text_delta("\n\nSummary\nThe role trusts...")
 *   → assistant_message_stop
 *
 * Assertion: the FINAL emitted text (concatenated `stream` frame
 * `content` field values) has NO `JSON\n{...}` block.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../../../../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async () => ({ id: 'session-scrub' })),
      findUnique: vi.fn(async () => ({ id: 'session-scrub', metadata: {} })),
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
    user: { id: 'user-scrub', isAdmin: true },
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

/**
 * Capture all `stream` frames written to the NDJSON raw socket. Each
 * frame is one line of JSON ending in `\n`. We collect only `type:'stream'`
 * frames and concatenate their `content` field to reconstruct what the UI
 * bubble would render.
 */
function collectStreamContent(raw: FakeRaw): string {
  const calls = (raw.write as any).mock.calls as Array<[string]>;
  const lines: string[] = [];
  for (const [chunk] of calls) {
    if (typeof chunk !== 'string') continue;
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        if (obj && obj.type === 'stream' && typeof obj.content === 'string') {
          lines.push(obj.content);
        }
      } catch {
        // not JSON — skip
      }
    }
  }
  return lines.join('');
}

describe('Sev-0 — stream emit-path scrubs compose_visual / compose_app JSON leak', () => {
  beforeEach(() => { resetBuiltInAgentRegistry(); });
  afterEach(() => { vi.clearAllMocks(); resetBuiltInAgentRegistry(); });

  it('strips leaked artifact JSON from the LIVE stream when compose_visual was dispatched', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-scrub-live', 'render sankey');
    const logger = makeLogger();

    const runChatSpy = vi.spyOn(runChatModule, 'runChat')
      .mockImplementation(async (ctx: any) => {
        // 1. tool_use dispatched — iframe mounts, but model echoes JSON.
        ctx.emit('tool_executing', {
          name: 'compose_visual',
          tool_use_id: 'tu_compose_1',
          input: { template: 'sankey' },
        });
        // 2. Streamed prose chunks — leak shape interleaved.
        ctx.emit('assistant_message_delta', { text: 'Sankey diagram of cross-account trust' });
        ctx.emit('assistant_message_delta', { text: '\n\nJSON\n{' });
        ctx.emit('assistant_message_delta', {
          text: '\n  "template":"sankey",\n  "title":"OpenAgenticOBORole Trust Flow",\n  "data":{ "flows":[ {"from":"a","to":"b","value":1} ] },\n  "group_id":"openagentic-obo-trust"\n}',
        });
        ctx.emit('assistant_message_delta', { text: '\n\nSummary\nThe role trusts the Azure AD tenant.' });
        ctx.emit('assistant_message_stop', { reason: 'end_turn' });
        return { ok: true, turns: 1, toolUses: [] };
      });

    const deps = {
      v2Deps: makeV2Deps(),
      listMcpTools: vi.fn().mockResolvedValue([]),
      pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
      persistAssistantMessage: vi.fn(async () => {}),
    };

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    const liveText = collectStreamContent(reply.raw);

    // The canonical leak markers must NOT appear in any live `stream`
    // frame. (Persistence-time scrub already covers the saved row; this
    // gate is for what the user SEES in the bubble while streaming.)
    expect(liveText).not.toContain('"template":"sankey"');
    expect(liveText).not.toContain('"group_id":"openagentic-obo-trust"');
    expect(liveText).not.toMatch(/^JSON\s*$/m);
    // But the legitimate prose must still be there.
    expect(liveText).toContain('Sankey diagram of cross-account trust');
    expect(liveText).toContain('Summary');
    expect(liveText).toContain('The role trusts the Azure AD tenant.');

    runChatSpy.mockRestore();
  });

  it('does NOT scrub plain JSON in a turn that never dispatched a compose_* tool', async () => {
    const reply = makeFakeReply();
    const req = makeFakeRequest('session-scrub-plain', 'show me a config example');
    const logger = makeLogger();

    const runChatSpy = vi.spyOn(runChatModule, 'runChat')
      .mockImplementation(async (ctx: any) => {
        // No compose_* tool — pure prose turn with a conversational JSON
        // example. The scrubber MUST be inactive here.
        ctx.emit('assistant_message_delta', { text: 'Here is the config:\n\n```json\n{' });
        ctx.emit('assistant_message_delta', { text: '\n  "template":"sankey",\n  "data": {}\n}\n```\n' });
        ctx.emit('assistant_message_delta', { text: '\nThat is what to use.' });
        ctx.emit('assistant_message_stop', { reason: 'end_turn' });
        return { ok: true, turns: 1, toolUses: [] };
      });

    const deps = {
      v2Deps: makeV2Deps(),
      listMcpTools: vi.fn().mockResolvedValue([]),
      pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
      persistAssistantMessage: vi.fn(async () => {}),
    };

    const handler = streamHandler(deps, logger);
    await handler(req, reply);

    const liveText = collectStreamContent(reply.raw);

    // No compose_* was dispatched — the legitimate JSON in the prose
    // example must survive.
    expect(liveText).toContain('"template":"sankey"');
    expect(liveText).toContain('That is what to use.');

    runChatSpy.mockRestore();
  });
});
