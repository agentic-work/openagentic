/**
 * stream-tail integration test (task #154).
 *
 * Wires a minimal Fastify instance + the durable-stream route + a
 * stubbed StreamRingBuffer and exercises the resume protocol:
 *
 *   1. "Live turn" path — register active turn, publish frames via
 *      the registry, assert the tail response forwards them.
 *   2. "Replay-then-exhaust" path — frames in the ring buffer + turn
 *      already finalized → tail emits replayed frames + final
 *      resume_exhausted + closes.
 *   3. "No session" path — 403 when the session isn't owned.
 *   4. "TurnId missing" path — 400.
 *   5. Dedupe — frames whose _seq <= after are never emitted.
 *
 * Strategy: use `fastify.inject()` so there's no actual socket and we
 * can capture the raw chunked response body. The route writes to
 * `reply.raw.write`; inject captures all writes into `payload`.
 *
 * Also includes an interrupt-and-resume scenario that simulates the
 * full UC: turn writes seq 1-5 → client reconnects to /tail with
 * after=3 → gets back seq 4 & 5 (ordered) + resume_exhausted.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  StreamRingBuffer,
  setStreamRingBufferForTests,
  resetStreamRingBufferForTests,
} from '../services/StreamRingBuffer.js';
import type { UnifiedRedisClient } from '../utils/redis-client.js';
import { registerStreamTailRoute } from '../routes/chat/stream-tail.route.js';
import {
  registerActiveTurn,
  publishFrame,
  unregisterActiveTurn,
  resetTailRegistryForTests,
} from '../routes/chat/handlers/stream-tail.registry.js';

// ---------------------------------------------------------------------------
// Stub Prisma for the ownership check.
// ---------------------------------------------------------------------------
vi.mock('../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findFirst: vi.fn(async ({ where }: any) => {
        // Allow session IDs prefixed with "owned-" for user "user-1".
        if (where.id?.startsWith('owned-') && where.user_id === 'user-1') {
          return { id: where.id };
        }
        return null;
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Stub Redis — same shape as the StreamRingBuffer unit tests.
// ---------------------------------------------------------------------------
function makeStubRedis() {
  const store = new Map<string, string[]>();
  const stub = {
    async rPush(key: string, value: string): Promise<number> {
      const list = store.get(key) ?? [];
      list.push(value);
      store.set(key, list);
      return list.length;
    },
    async lRange(key: string, start: number, stop: number): Promise<string[]> {
      const list = store.get(key) ?? [];
      const n = list.length;
      const s = start < 0 ? Math.max(0, n + start) : Math.min(n, start);
      const e = stop < 0 ? Math.min(n, n + stop + 1) : Math.min(n, stop + 1);
      return list.slice(s, e);
    },
    async lTrim(key: string, start: number, stop: number): Promise<boolean> {
      const list = store.get(key) ?? [];
      const n = list.length;
      const s = start < 0 ? Math.max(0, n + start) : Math.min(n, start);
      const e = stop < 0 ? Math.min(n, n + stop + 1) : Math.min(n, stop + 1);
      store.set(key, list.slice(s, e));
      return true;
    },
    async expire() { return true; },
    async exists(key: string) { return store.has(key); },
    async del(key: string) { return store.delete(key); },
    async lLen(key: string) { return (store.get(key) ?? []).length; },
  } as unknown as UnifiedRedisClient;
  return { stub, store };
}

// ---------------------------------------------------------------------------
// Frame helpers.
// ---------------------------------------------------------------------------
function frame(seq: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ _seq: seq, _runId: 't1', _ts: Date.now(), ...extra });
}

function parseLines(body: string): any[] {
  return body
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Test rig.
// ---------------------------------------------------------------------------
describe('stream-tail integration', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let redis: ReturnType<typeof makeStubRedis>['stub'];
  let store: ReturnType<typeof makeStubRedis>['store'];

  beforeEach(async () => {
    resetTailRegistryForTests();
    resetStreamRingBufferForTests();

    const rig = makeStubRedis();
    redis = rig.stub;
    store = rig.store;

    // Install the stubbed buffer as the module-scope singleton so the
    // route picks it up.
    setStreamRingBufferForTests(new StreamRingBuffer({
      redis,
      maxSize: 100,
      ttlSeconds: 60,
    }));

    app = Fastify({ logger: false });

    // Cheap auth stub — pulls the userId from an `x-user-id` header.
    const authMiddleware = async (req: any, _reply: any) => {
      req.user = { id: req.headers['x-user-id'] || null };
    };

    // Route is registered under /api/chat prefix to match production.
    await app.register(async (scope) => {
      registerStreamTailRoute(scope, { authMiddleware, logger: app.log });
    }, { prefix: '/api/chat' });

    // Bind to a random port. `fastify.inject()` doesn't play well with
    // routes that write directly to `reply.raw` (it waits for the full
    // Fastify reply lifecycle which we've hijacked) — a real server
    // with `fetch()` is the simplest workaround and still fast (~30ms).
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  async function getTail(
    sessionId: string,
    turnId: string,
    after: number,
    userId: string | null,
  ): Promise<Response> {
    const qs = `turnId=${encodeURIComponent(turnId)}&after=${after}`;
    const headers: Record<string, string> = { Accept: 'application/x-ndjson' };
    if (userId) headers['x-user-id'] = userId;
    return fetch(`${baseUrl}/api/chat/stream/${encodeURIComponent(sessionId)}/tail?${qs}`, {
      method: 'GET',
      headers,
    });
  }

  async function readAllNDJSON(resp: Response): Promise<any[]> {
    const text = await resp.text();
    return parseLines(text);
  }

  test('returns 401 when unauthenticated', async () => {
    const resp = await getTail('any', 't1', 0, null);
    expect(resp.status).toBe(401);
  });

  test('returns 400 when turnId is missing', async () => {
    const resp = await fetch(`${baseUrl}/api/chat/stream/owned-s1/tail`, {
      method: 'GET',
      headers: { 'x-user-id': 'user-1' },
    });
    expect(resp.status).toBe(400);
  });

  test('returns 403 when session is not owned by caller', async () => {
    const resp = await getTail('foreign-s1', 't1', 0, 'user-1');
    expect(resp.status).toBe(403);
  });

  test('replays ring-buffer frames then emits resume_exhausted when turn is finalized', async () => {
    // Prime the already-installed buffer (via beforeEach) with 5 frames.
    // Turn NOT registered, so isTurnActive=false → tail emits
    // resume_exhausted after replay.
    const buf = new StreamRingBuffer({ redis, maxSize: 100, ttlSeconds: 60 });
    setStreamRingBufferForTests(buf);
    for (let i = 1; i <= 5; i++) {
      await buf.append('owned-s1', 't1', frame(i, { type: 'stream', content: `chunk${i}` }));
    }
    const preview = await buf.readAfter('owned-s1', 't1', 0);
    expect(preview).toHaveLength(5);

    const resp = await getTail('owned-s1', 't1', 0, 'user-1');
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toBe('application/x-ndjson');

    const lines = await readAllNDJSON(resp);
    // 5 replayed + 1 resume_exhausted
    expect(lines).toHaveLength(6);
    expect(lines.slice(0, 5).map(f => f._seq)).toEqual([1, 2, 3, 4, 5]);
    expect(lines[5].type).toBe('resume_exhausted');
    expect(lines[5].replayed).toBe(5);
    expect(lines[5].lastSeq).toBe(5);
  });

  test('respects `after` cursor — frames with _seq <= after are filtered', async () => {
    const buf = new StreamRingBuffer({ redis, maxSize: 100, ttlSeconds: 60 });
    setStreamRingBufferForTests(buf);
    for (let i = 1; i <= 5; i++) {
      await buf.append('owned-s1', 't1', frame(i, { type: 'stream' }));
    }

    const resp = await getTail('owned-s1', 't1', 3, 'user-1');
    const lines = await readAllNDJSON(resp);
    // Only seq 4 + 5 + resume_exhausted.
    expect(lines.map(f => f._seq ?? f.type)).toEqual([4, 5, 'resume_exhausted']);
    expect(lines[2].replayed).toBe(2);
  });

  test('returns an empty-tail-with-exhausted when buffer is empty + turn finalized', async () => {
    const resp = await getTail('owned-s1', 't-empty', 0, 'user-1');
    const lines = await readAllNDJSON(resp);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('resume_exhausted');
    expect(lines[0].replayed).toBe(0);
  });

  test('interrupt-and-resume: kill mid-stream, /tail replays missed frames', async () => {
    // Simulate the full UC:
    //   1. Main stream writes 5 frames to the ring buffer, client sees seq 1-3.
    //   2. Main stream keeps writing (seq 4, 5) but client has disconnected.
    //   3. Client calls /tail with after=3 → should receive seq 4 + 5.
    //   4. Turn finalizes → resume_exhausted.

    const buf = new StreamRingBuffer({ redis, maxSize: 100, ttlSeconds: 60 });
    setStreamRingBufferForTests(buf);

    // Register turn (simulating live stream).
    registerActiveTurn('owned-s1', 't1');

    // Write 5 frames into the ring buffer.
    for (let i = 1; i <= 5; i++) {
      await buf.append('owned-s1', 't1', frame(i, { type: 'stream', content: `c${i}` }));
    }

    // Client detects a drop, reconnects to /tail with after=3.
    const pending = getTail('owned-s1', 't1', 3, 'user-1');

    // Give the handler a tick to emit the initial replay frames +
    // attach the live-turn listener, then finalize the turn.
    await new Promise(r => setTimeout(r, 40));
    unregisterActiveTurn('owned-s1', 't1');

    const resp = await pending;
    expect(resp.status).toBe(200);

    const lines = await readAllNDJSON(resp);
    const seqs = lines.map(f => f._seq ?? f.type);
    expect(seqs[0]).toBe(4);
    expect(seqs[1]).toBe(5);
    expect(lines[lines.length - 1].type).toBe('resume_exhausted');
    expect(lines[lines.length - 1].reason).toBe('turn_completed');
  });

  test('dedupe: live fan-out doesnt re-emit a frame already replayed from buffer', async () => {
    // If a frame with _seq=X is in the ring buffer AND later published
    // via the live registry, the tail response should emit it only once.
    const buf = new StreamRingBuffer({ redis, maxSize: 100, ttlSeconds: 60 });
    setStreamRingBufferForTests(buf);
    registerActiveTurn('owned-s1', 't1');
    await buf.append('owned-s1', 't1', frame(1, { type: 'stream' }));
    await buf.append('owned-s1', 't1', frame(2, { type: 'stream' }));

    const pending = getTail('owned-s1', 't1', 0, 'user-1');

    await new Promise(r => setTimeout(r, 40));
    // Now publish _seq=2 again via the registry (simulating a late fan-out
    // of a frame the buffer already persisted) — this MUST be dropped.
    publishFrame('owned-s1', 't1', frame(2, { type: 'stream' }));
    // Plus a genuinely new frame.
    publishFrame('owned-s1', 't1', frame(3, { type: 'stream' }));
    await new Promise(r => setTimeout(r, 20));
    unregisterActiveTurn('owned-s1', 't1');

    const resp = await pending;
    const lines = await readAllNDJSON(resp);
    const seqs = lines.filter(l => typeof l._seq === 'number').map(l => l._seq);
    expect(seqs).toEqual([1, 2, 3]); // no duplicate 2
  });
});
