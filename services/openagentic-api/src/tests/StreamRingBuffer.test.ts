/**
 * StreamRingBuffer — unit tests (task #154).
 *
 * Covers:
 *   1. append → readAfter round-trip preserves bytes.
 *   2. `after` cursor filters frames whose _seq <= cursor.
 *   3. `after=0` returns the full retained buffer (including frames
 *      without `_seq`, which only flow when the caller opts in).
 *   4. LTRIM semantics — buffer is capped to `maxSize`; oldest frames
 *      drop off when we exceed the cap.
 *   5. TTL — `expire` is called on every append so a still-running
 *      turn refreshes its key.
 *   6. Redis failure is swallowed (no throw from append/readAfter).
 *   7. Tests the extractSeq() helper's fast-path + JSON-parse fallback.
 *
 * Strategy — inject a stub `UnifiedRedisClient` implementation so the
 * tests don't require a live Redis. The stub records every command
 * invocation so we can assert on LTRIM / EXPIRE calls too.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  StreamRingBuffer,
  DEFAULT_RING_BUFFER_SIZE,
  DEFAULT_RING_BUFFER_TTL_SECONDS,
  extractSeq,
} from '../services/StreamRingBuffer.js';
import type { UnifiedRedisClient } from '../utils/redis-client.js';

// ---------------------------------------------------------------------------
// Stub Redis client — just enough surface area to drive StreamRingBuffer.
// Every command returns a settled Promise; internal state is a Map of
// key → list of strings so LRANGE / LTRIM work against the same store.
// ---------------------------------------------------------------------------

interface StubCalls {
  rPush: Array<{ key: string; value: string }>;
  lTrim: Array<{ key: string; start: number; stop: number }>;
  expire: Array<{ key: string; seconds: number }>;
  lRange: Array<{ key: string; start: number; stop: number }>;
  del: Array<{ key: string }>;
}

function makeStubRedis(opts?: { failAfter?: number; failMode?: 'throw' | 'return-false' }) {
  const store = new Map<string, string[]>();
  const calls: StubCalls = { rPush: [], lTrim: [], expire: [], lRange: [], del: [] };
  let opCount = 0;

  const maybeFail = () => {
    opCount += 1;
    if (opts?.failAfter !== undefined && opCount > opts.failAfter) {
      if (opts.failMode === 'throw') throw new Error('simulated Redis failure');
      return false;
    }
    return null;
  };

  const stub = {
    async rPush(key: string, value: string): Promise<number> {
      const r = maybeFail();
      if (r === false) return 0;
      calls.rPush.push({ key, value });
      const list = store.get(key) ?? [];
      list.push(value);
      store.set(key, list);
      return list.length;
    },
    async lRange(key: string, start: number, stop: number): Promise<string[]> {
      const r = maybeFail();
      if (r === false) return [];
      calls.lRange.push({ key, start, stop });
      const list = store.get(key) ?? [];
      // Redis LRANGE semantics: inclusive stop; negative indices count from end.
      const n = list.length;
      const s = start < 0 ? Math.max(0, n + start) : Math.min(n, start);
      const e = stop < 0 ? Math.min(n, n + stop + 1) : Math.min(n, stop + 1);
      return list.slice(s, e);
    },
    async lTrim(key: string, start: number, stop: number): Promise<boolean> {
      const r = maybeFail();
      if (r === false) return false;
      calls.lTrim.push({ key, start, stop });
      const list = store.get(key) ?? [];
      const n = list.length;
      const s = start < 0 ? Math.max(0, n + start) : Math.min(n, start);
      const e = stop < 0 ? Math.min(n, n + stop + 1) : Math.min(n, stop + 1);
      store.set(key, list.slice(s, e));
      return true;
    },
    async expire(key: string, seconds: number): Promise<boolean> {
      const r = maybeFail();
      if (r === false) return false;
      calls.expire.push({ key, seconds });
      return true;
    },
    async exists(key: string): Promise<boolean> {
      return store.has(key);
    },
    async del(key: string): Promise<boolean> {
      calls.del.push({ key });
      return store.delete(key);
    },
    async lLen(key: string): Promise<number> {
      return (store.get(key) ?? []).length;
    },
  } as unknown as UnifiedRedisClient;

  return { stub, calls, store };
}

// ---------------------------------------------------------------------------
// Helpers — build NDJSON-shaped frames for the buffer to store.
// ---------------------------------------------------------------------------

function frame(seq: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ _seq: seq, _runId: 'r1', _ts: 1, ...extra });
}

// ---------------------------------------------------------------------------
// extractSeq
// ---------------------------------------------------------------------------

describe('extractSeq', () => {
  test('picks up _seq from a standard NDJSON frame (fast path)', () => {
    expect(extractSeq('{"_seq": 42, "_runId": "a", "type": "stream"}')).toBe(42);
    expect(extractSeq('{"_seq":1,"type":"ping"}')).toBe(1);
  });

  test('tolerates whitespace + key ordering', () => {
    expect(extractSeq('{"content":"x","_seq"   :  7}')).toBe(7);
  });

  test('returns undefined when _seq is missing', () => {
    expect(extractSeq('{"type":"ping"}')).toBeUndefined();
  });

  test('returns undefined for unparseable lines', () => {
    expect(extractSeq('not json')).toBeUndefined();
    expect(extractSeq('{invalid}')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// StreamRingBuffer — core behaviour
// ---------------------------------------------------------------------------

describe('StreamRingBuffer', () => {
  let stub: ReturnType<typeof makeStubRedis>['stub'];
  let calls: StubCalls;
  let store: Map<string, string[]>;
  let buf: StreamRingBuffer;

  beforeEach(() => {
    const s = makeStubRedis();
    stub = s.stub;
    calls = s.calls;
    store = s.store;
    buf = new StreamRingBuffer({ redis: stub, maxSize: 100, ttlSeconds: 60 });
  });

  test('exposes configurable bufferSize + ttl', () => {
    expect(buf.bufferSize).toBe(100);
    expect(buf.ttl).toBe(60);
  });

  test('default constructor uses env/default values', () => {
    const noOpts = new StreamRingBuffer({ redis: stub });
    expect(noOpts.bufferSize).toBe(DEFAULT_RING_BUFFER_SIZE);
    expect(noOpts.ttl).toBe(DEFAULT_RING_BUFFER_TTL_SECONDS);
  });

  test('keyFor returns the canonical pattern', () => {
    expect(StreamRingBuffer.keyFor('s1', 't1')).toBe('stream:ring:s1:t1');
  });

  test('append → readAfter round-trip preserves bytes verbatim', async () => {
    const ok = await buf.append('s1', 't1', frame(1, { type: 'stream_start' }));
    await buf.append('s1', 't1', frame(2, { type: 'stream', content: 'hi' }));
    await buf.append('s1', 't1', frame(3, { type: 'done' }));
    expect(ok).toBe(true);

    const frames = await buf.readAfter('s1', 't1', 0);
    expect(frames).toHaveLength(3);
    expect(frames[0].seq).toBe(1);
    expect(frames[1].seq).toBe(2);
    expect(frames[2].seq).toBe(3);
    // The line bytes are the exact input (no trailing \n).
    expect(frames[0].line).toBe(frame(1, { type: 'stream_start' }));
  });

  test('append strips a trailing newline defensively', async () => {
    await buf.append('s1', 't1', frame(1) + '\n');
    const frames = await buf.readAfter('s1', 't1', 0);
    expect(frames[0].line.endsWith('\n')).toBe(false);
  });

  test('readAfter filters by _seq > cursor', async () => {
    for (let i = 1; i <= 5; i++) await buf.append('s1', 't1', frame(i));
    const after2 = await buf.readAfter('s1', 't1', 2);
    expect(after2.map(f => f.seq)).toEqual([3, 4, 5]);
    const after10 = await buf.readAfter('s1', 't1', 10);
    expect(after10).toHaveLength(0);
  });

  test('readAfter with cursor=0 returns the full retained buffer, including frames missing _seq', async () => {
    await buf.append('s1', 't1', JSON.stringify({ type: 'legacy_no_seq' }));
    await buf.append('s1', 't1', frame(1));
    const all = await buf.readAfter('s1', 't1', 0);
    expect(all).toHaveLength(2);
    expect(all[0].seq).toBeUndefined();
    expect(all[1].seq).toBe(1);
  });

  test('readAfter with cursor > 0 drops frames missing _seq metadata', async () => {
    await buf.append('s1', 't1', JSON.stringify({ type: 'legacy_no_seq' }));
    await buf.append('s1', 't1', frame(5));
    const tail = await buf.readAfter('s1', 't1', 3);
    expect(tail).toHaveLength(1);
    expect(tail[0].seq).toBe(5);
  });

  test('every append calls LTRIM -maxSize -1 to cap the ring', async () => {
    await buf.append('s1', 't1', frame(1));
    await buf.append('s1', 't1', frame(2));
    // Stub receives the unprefixed key; the real UnifiedRedisClient
    // applies the `openagentic:` prefix internally.
    expect(calls.lTrim).toEqual([
      { key: 'stream:ring:s1:t1', start: -100, stop: -1 },
      { key: 'stream:ring:s1:t1', start: -100, stop: -1 },
    ]);
  });

  test('LTRIM physically drops the oldest frames when the cap is exceeded', async () => {
    const small = new StreamRingBuffer({ redis: stub, maxSize: 3, ttlSeconds: 60 });
    for (let i = 1; i <= 5; i++) {
      await small.append('s1', 't1', frame(i));
    }
    const retained = await small.readAfter('s1', 't1', 0);
    // Only the latest 3 survive after the LTRIM loop.
    expect(retained.map(f => f.seq)).toEqual([3, 4, 5]);
  });

  test('every append refreshes TTL via EXPIRE', async () => {
    await buf.append('s1', 't1', frame(1));
    expect(calls.expire).toHaveLength(1);
    expect(calls.expire[0]).toEqual({ key: 'stream:ring:s1:t1', seconds: 60 });
    await buf.append('s1', 't1', frame(2));
    expect(calls.expire).toHaveLength(2);
  });

  test('clear() deletes the key', async () => {
    await buf.append('s1', 't1', frame(1));
    expect(await buf.exists('s1', 't1')).toBe(true);
    await buf.clear('s1', 't1');
    expect(await buf.exists('s1', 't1')).toBe(false);
    expect(calls.del).toHaveLength(1);
  });

  test('size() returns the current length', async () => {
    await buf.append('s1', 't1', frame(1));
    await buf.append('s1', 't1', frame(2));
    expect(await buf.size('s1', 't1')).toBe(2);
  });

  test('bad inputs short-circuit without calling Redis', async () => {
    expect(await buf.append('', 't', 'x')).toBe(false);
    expect(await buf.append('s', '', 'x')).toBe(false);
    expect(await buf.append('s', 't', '')).toBe(false);
    expect(await buf.readAfter('', 't', 0)).toEqual([]);
    expect(await buf.readAfter('s', '', 0)).toEqual([]);
    expect(calls.rPush).toHaveLength(0);
  });

  test('append returns false and swallows when Redis throws', async () => {
    const failing = makeStubRedis({ failAfter: 0, failMode: 'throw' });
    const spy = vi.fn();
    const b = new StreamRingBuffer({
      redis: failing.stub,
      maxSize: 10,
      ttlSeconds: 60,
      logger: { warn: spy } as any,
    });
    const ok = await b.append('s', 't', frame(1));
    expect(ok).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  test('readAfter returns [] and swallows when Redis throws', async () => {
    const failing = makeStubRedis({ failAfter: 0, failMode: 'throw' });
    const spy = vi.fn();
    const b = new StreamRingBuffer({
      redis: failing.stub,
      maxSize: 10,
      ttlSeconds: 60,
      logger: { warn: spy } as any,
    });
    const out = await b.readAfter('s', 't', 0);
    expect(out).toEqual([]);
    expect(spy).toHaveBeenCalled();
  });

  test('different (sessionId, turnId) pairs are isolated', async () => {
    await buf.append('s1', 't1', frame(1));
    await buf.append('s1', 't2', frame(2));
    await buf.append('s2', 't1', frame(3));
    expect((await buf.readAfter('s1', 't1', 0)).map(f => f.seq)).toEqual([1]);
    expect((await buf.readAfter('s1', 't2', 0)).map(f => f.seq)).toEqual([2]);
    expect((await buf.readAfter('s2', 't1', 0)).map(f => f.seq)).toEqual([3]);
  });
});
