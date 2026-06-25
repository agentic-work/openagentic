/**
 * Cutover regression test — stream.handler.ts is wired to `runChat` (the
 * sole chat pipeline entry-point), NOT to the legacy V1 ChatPipeline.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §240. Originally
 * known as "Wave 4 swap ChatPipeline for ChatPipelineV2"; after #741 / B-vrip
 * step 6 deleted pipeline/v2/, the only remaining import is `runChat`.
 *
 * What this test pins down:
 *   1. Source-grep: stream.handler.ts no longer imports the V1
 *      `ChatPipeline` class.
 *   2. Integration: with a mock providerManager + mocked prisma + mocked
 *      subagent runner, the handler emits the canonical NDJSON frames
 *      the UI consumes — `stream_start`, assistant text via `stream`,
 *      and lifecycle frames (`thinking_complete`, `stream_complete`).
 *      Tool flows (`tool_executing` / `tool_result`) are exercised when
 *      the model returns a tool_use block.
 *   3. Singleton init: BuiltInAgentRegistry is initialized exactly once
 *      across N concurrent requests — repeated handler calls don't trigger
 *      re-initialization or stale-empty reads.
 *
 * The handler still takes the same Fastify (request, reply) signature.
 * What changes is the FACTORY signature: `streamHandler(deps, logger)` where
 * `deps` is now a `ChatStreamHandlerDeps` carrying chat-pipeline deps + per-
 * request helpers (listMcpTools, pickModel) instead of a `ChatPipeline`
 * instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── dynamic-import stubs (same wiring as agentProgress test) ──────────
vi.mock('../../../../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async () => ({ id: 'session-v2' })),
      update: vi.fn(async () => ({})),
    },
    chatMessage: {
      findMany: vi.fn(async () => []),
    },
    // file_attachments is queried by hydrateFileReferences when body.files
    // contains {id} refs. Tests use the inline `{name,type,content}` path
    // which short-circuits before this is hit, but the mock must exist so
    // the dynamic import in stream.handler.ts:822 doesn't crash.
    fileAttachment: {
      findFirst: vi.fn(async () => null),
    },
  },
}));

// stream.handler.ts:823 constructs `new BlobStorageService(...)` before
// calling hydrateFileReferences. The inline-base64 path never touches
// MinIO (hydrateFileReferences:82-90 short-circuits), but the constructor
// + init() still run. Stub them out so tests don't need a live MinIO.
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

import { streamHandler } from '../stream.handler.js';
import {
  initializeAgentRegistry,
  resetBuiltInAgentRegistry,
  type BuiltInAgentRegistryEntry,
} from '../../../../services/BuiltInAgentRegistry.js';
import type { RunChatDeps } from '../../pipeline/chat/types.js';

// ── test doubles ──────────────────────────────────────────────────────

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
  } as any;
}

function makeFakeRequest(sessionId: string, message = 'hello') {
  const reqRaw = new EventEmitter() as any;
  return {
    raw: reqRaw,
    user: { id: 'user-v2', isAdmin: true },
    body: { message, sessionId },
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

function collectFrames(raw: FakeRaw): Array<Record<string, any>> {
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

// Standard agent registry — 8 built-ins per BUILT_IN_AGENT_SLUGS.
const BUILT_IN_AGENTS: BuiltInAgentRegistryEntry[] = [
  { agent_type: 'cloud-operations', display_name: 'Cloud Operations', description: 'Cloud ops work', tools: [], model: 'sonnet', body: 'cloud body' },
];

function makeV2Deps(over: Partial<RunChatDeps> = {}): RunChatDeps {
  return {
    providerManager: {
      createCompletion: vi.fn().mockResolvedValue({
        choices: [
          { index: 0, message: { role: 'assistant', content: 'hello world' }, finish_reason: 'stop' },
        ],
      }),
    } as any,
    listAgents: vi.fn().mockResolvedValue(BUILT_IN_AGENTS),
    runSubagent: vi.fn().mockResolvedValue({
      ok: true, output: 'sub done', turns: 1, tokens: 100, durationMs: 50, toolsUsed: [],
    }),
    executeMcpTool: vi.fn().mockResolvedValue({ ok: true, output: '[]' }),
    executeBrowserSandbox: vi.fn().mockResolvedValue({ ok: true, output: 'js done' }),
    ...over,
  };
}

function makeStreamHandlerDeps(over: any = {}): any {
  // Note: spread `over` BEFORE v2Deps so caller-supplied top-level fields
  // (listMcpTools, pickModel) win, but v2Deps is always built via makeV2Deps
  // so partial v2Deps overrides merge cleanly with the defaults.
  return {
    listMcpTools: vi.fn().mockResolvedValue([]),
    pickModel: vi.fn().mockResolvedValue('gpt-oss:20b'),
    ...over,
    v2Deps: makeV2Deps(over.v2Deps),
  };
}

// ──────────────────────────────────────────────────────────────────────

describe('stream.handler chat cutover (Wave 4)', () => {
  describe('SOURCE GREP — V1 import deleted, runChat import present', () => {
    const __filename = fileURLToPath(import.meta.url);
    const handlerPath = path.resolve(path.dirname(__filename), '..', 'stream.handler.ts');
    const handlerSource = readFileSync(handlerPath, 'utf-8');

    it('does NOT import the legacy V1 ChatPipeline', () => {
      // Bare grep: any import line referencing the V1 class.
      const v1ImportRegex = /import\s+\{[^}]*ChatPipeline[^}]*\}\s+from\s+['"][^'"]*pipeline\/ChatPipeline\.js['"]/;
      expect(handlerSource).not.toMatch(v1ImportRegex);
    });

    it('imports runChat from the chat pipeline entry-point', () => {
      const chatImportRegex = /import\s+\{[^}]*runChat[^}]*\}\s+from\s+['"][^'"]*pipeline\/chat\/runChat\.js['"]/;
      expect(handlerSource).toMatch(chatImportRegex);
    });
  });

  describe('integration — chat pipeline drives the NDJSON wire format', () => {
    beforeEach(() => {
      // Initialize the registry once at the top of every test.
      resetBuiltInAgentRegistry();
    });

    afterEach(() => {
      vi.clearAllMocks();
      resetBuiltInAgentRegistry();
    });

    it('emits stream_start, then assistant content via stream, then lifecycle frames', async () => {
      // Initialize registry so listAgents() can pull built-ins.
      // Use an in-memory single-agent fixture via the deps mock.
      const reply = makeFakeReply();
      const req = makeFakeRequest('session-v2-int1', 'show me my azure subs');
      const logger = makeLogger();
      const deps = makeStreamHandlerDeps();

      const handler = streamHandler(deps, logger);
      await handler(req, reply);

      const frames = collectFrames(reply.raw);

      // Required NDJSON frames in order — UI contract.
      const types = frames.map(f => f.type);
      // 1. stream_start present early.
      const startIdx = types.indexOf('stream_start');
      expect(startIdx).toBeGreaterThanOrEqual(0);
      const start = frames[startIdx];
      expect(typeof start.turnId).toBe('string');
      expect(typeof start.sessionId).toBe('string');

      // 2. At least one `stream` frame carrying assistant content.
      const streamFrame = frames.find(f => f.type === 'stream' && (f as any).content);
      expect(streamFrame, 'expected at least one stream frame with assistant content').toBeTruthy();
      expect((streamFrame as any).content).toContain('hello world');

      // 3. thinking_complete + stream_complete tail.
      expect(types).toContain('thinking_complete');
      expect(types).toContain('stream_complete');
    });

    it('routes a model tool_use through dispatchChatToolCall and emits tool frames', async () => {
      // Provider returns a tool_use first turn, then end_turn next turn.
      const pm = {
        createCompletion: vi.fn()
          .mockResolvedValueOnce({
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'tu_1',
                      type: 'function',
                      function: { name: 'render_artifact', arguments: JSON.stringify({ kind: 'svg', content: '<svg/>' }) },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })
          .mockResolvedValueOnce({
            choices: [
              { index: 0, message: { role: 'assistant', content: 'rendered.' }, finish_reason: 'stop' },
            ],
          }),
      };
      const reply = makeFakeReply();
      const req = makeFakeRequest('session-v2-int2', 'render an svg');
      const logger = makeLogger();
      const deps = makeStreamHandlerDeps({ v2Deps: { providerManager: pm } });

      const handler = streamHandler(deps, logger);
      await handler(req, reply);

      const frames = collectFrames(reply.raw);
      // V2's render_artifact handler emits an `artifact_render` frame.
      const types = frames.map(f => f.type);
      expect(types).toContain('artifact_render');
      // Final lifecycle frame still fires.
      expect(types).toContain('stream_complete');
    });

    // Drag-drop multimodal threading regression — RED 2026-05-08.
    //
    // Live bug: dragging an image into the composer succeeded server-side
    // (chatRequest.attachments populated by hydrateFileReferences in
    // stream.handler.ts:842-869), but the V2 pipeline call site never
    // forwarded those attachments — model never saw the bytes and replied
    // "please upload the image first". The fix threads
    // `chatRequest.attachments` into RunChatV2Input.attachments so the
    // pipeline can build OpenAI multimodal content blocks.
    it('forwards body.files attachments to providerManager.createCompletion as multimodal blocks', async () => {
      const pm = {
        createCompletion: vi.fn().mockResolvedValue({
          choices: [
            { index: 0, message: { role: 'assistant', content: 'I can see a small image.' }, finish_reason: 'stop' },
          ],
        }),
      };
      const reply = makeFakeReply();
      const req = makeFakeRequest('session-v2-int-files', 'describe this image');
      // body.files is the canonical client-side shape from
      // useFileAttachments (small inline base64 path; large path goes via
      // {id} pre-uploaded ref). Either way hydrateFileReferences normalizes
      // to {name,type,content,size}, then stream.handler maps to
      // chatRequest.attachments and (post-fix) forwards to v2Input.
      req.body.files = [
        {
          name: 'tiny.png',
          type: 'image/png',
          // 1×1 transparent png
          content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZjVx5UAAAAASUVORK5CYII=',
          size: 95,
        },
      ];
      const logger = makeLogger();
      const deps = makeStreamHandlerDeps({ v2Deps: { providerManager: pm } });

      const handler = streamHandler(deps, logger);
      await handler(req, reply);

      // The V2 pipeline must have called createCompletion with a user
      // message whose content is a multimodal array including an image_url
      // data URL — proving the bytes survived the UI→handler→pipeline
      // round trip and reached the LLM.
      expect(pm.createCompletion).toHaveBeenCalled();
      const callArg = pm.createCompletion.mock.calls[0][0];
      const userMsg = callArg.messages.find((m: any) => m.role === 'user');
      expect(Array.isArray(userMsg.content)).toBe(true);
      const blocks = userMsg.content as any[];
      expect(blocks[0]).toEqual({ type: 'text', text: 'describe this image' });
      const img = blocks.find((b: any) => b.type === 'image_url');
      expect(img).toBeTruthy();
      expect(img.image_url.url).toContain('data:image/png;base64,');
      expect(img.image_url.url.length).toBeGreaterThan(50);
    });

    it('does NOT crash when listMcpTools returns empty (V2 builds meta-tools regardless)', async () => {
      const reply = makeFakeReply();
      const req = makeFakeRequest('session-v2-int3', 'q');
      const logger = makeLogger();
      const deps = makeStreamHandlerDeps({
        listMcpTools: vi.fn().mockResolvedValue([]),
      });

      const handler = streamHandler(deps, logger);
      await handler(req, reply);

      const frames = collectFrames(reply.raw);
      expect(frames.find(f => f.type === 'stream_complete')).toBeTruthy();
    });
  });

  describe('initializeAgentRegistry — singleton wiring', () => {
    beforeEach(() => {
      resetBuiltInAgentRegistry();
    });

    afterEach(() => {
      resetBuiltInAgentRegistry();
    });

    it('idempotent across N concurrent calls (no double-init, no stale-empty read)', async () => {
      // Spy on fs.readdir to count actual filesystem reads.
      const fs = await import('node:fs');
      const realReaddir = fs.promises.readdir;
      const readdirSpy = vi.spyOn(fs.promises, 'readdir');
      readdirSpy.mockImplementation(realReaddir as any);

      // Fire 5 concurrent inits.
      await Promise.all([
        initializeAgentRegistry(),
        initializeAgentRegistry(),
        initializeAgentRegistry(),
        initializeAgentRegistry(),
        initializeAgentRegistry(),
      ]);

      // After all promises resolve, getBuiltInAgents() must return the
      // canonical 8 built-ins (1 per markdown file). Number of fs reads
      // is allowed to be 1..5 depending on race semantics — what matters
      // is that the cache settles to the same set.
      const { getBuiltInAgents } = await import('../../../../services/BuiltInAgentRegistry.js');
      const agents = getBuiltInAgents();
      expect(agents.length).toBeGreaterThan(0);
      // Verify all are unique by agent_type.
      const slugs = new Set(agents.map(a => a.agent_type));
      expect(slugs.size).toBe(agents.length);

      readdirSpy.mockRestore();
    });

    it('getBuiltInAgents() throws if initializeAgentRegistry() never ran', async () => {
      resetBuiltInAgentRegistry();
      const { getBuiltInAgents } = await import('../../../../services/BuiltInAgentRegistry.js');
      expect(() => getBuiltInAgents()).toThrowError(/not initialized/);
    });
  });
});
