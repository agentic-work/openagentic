/**
 * StreamRingBuffer — Phase I durable-stream primitive (task #154).
 *
 * Redis-backed ring buffer keyed by `(sessionId, turnId)`. Every NDJSON
 * frame emitted on `POST /api/chat/stream` is dual-written into a
 * bounded list so a disconnected client can reconnect to
 * `GET /api/chat/stream/:sessionId/tail?turnId=…&after=<seq>` and pull
 * the missed frames.
 *
 * Storage
 * -------
 *   Key    `stream:ring:<sessionId>:<turnId>`
 *   Type   Redis LIST (via RPUSH → LTRIM → EXPIRE)
 *   Value  raw NDJSON line — the exact serialized payload, no wrapping.
 *          Callers pass pre-serialized text (what went on the wire) so
 *          the tail endpoint can re-emit it byte-identical.
 *   TTL    5 minutes by default, refreshed on every append.
 *   Bound  5000 frames by default (LTRIM -N -1 keeps the latest N).
 *
 * Both bounds are env-configurable:
 *   STREAM_RING_BUFFER_SIZE   (default 5000)
 *   STREAM_RING_BUFFER_TTL_S  (default 300)
 *
 * Design notes
 * ------------
 *   - Fire-and-forget: any failure (Redis down, network blip, timeout)
 *     is logged and swallowed. The ring buffer is a resumability aid,
 *     NOT a hot-path dependency. The live stream must never stall on
 *     a buffer write.
 *   - One list per (sessionId, turnId). A fresh turn == fresh list ==
 *     fresh TTL. If the user starts a new turn the previous list
 *     simply ages out — no explicit cleanup required in the hot path.
 *   - `readAfter` filters by the `_seq` metadata that `EventSequencer`
 *     stamps on every frame. Frames without `_seq` (very early in the
 *     stream, e.g. pings that pre-date the sequencer) are included
 *     iff the caller passed `after <= 0` — i.e. "give me everything".
 *   - `clear` is exposed for completeness / tests; in production the
 *     TTL does the cleanup.
 *
 * Why borrow ElectricSQL's model? Because we're already 80% there —
 * `EventSequencer` stamps `_seq / _runId / _ts / _agentId` on every
 * frame (see `infra/event-sequencer.ts`). All we needed was a server-
 * side replay buffer keyed by that same tuple and a small HTTP endpoint
 * that reads from it. The client (see `useChatStream.ts`) already has
 * `_seq` on every event, so dedupe on resume is trivial.
 */

import type { Logger } from 'pino';
import { getRedisClient, type UnifiedRedisClient } from '../utils/redis-client.js';

// ---------------------------------------------------------------------------
// Defaults + env knobs
// ---------------------------------------------------------------------------

/** Ring buffer max length, trimmed on every append. */
export const DEFAULT_RING_BUFFER_SIZE = 5000;

/** Ring buffer TTL in seconds, refreshed on every append. */
export const DEFAULT_RING_BUFFER_TTL_SECONDS = 300;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RingFrame {
  /** The raw NDJSON line (no trailing newline). */
  line: string;
  /** Parsed sequence number if present; undefined if unparseable or missing. */
  seq?: number;
}

export interface StreamRingBufferOptions {
  maxSize?: number;
  ttlSeconds?: number;
  /** Injection seam for tests — defaults to the shared unified client. */
  redis?: UnifiedRedisClient;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// StreamRingBuffer
// ---------------------------------------------------------------------------

export class StreamRingBuffer {
  private readonly redis: UnifiedRedisClient;
  private readonly maxSize: number;
  private readonly ttlSeconds: number;
  private readonly logger?: Logger;

  constructor(options: StreamRingBufferOptions = {}) {
    this.redis = options.redis ?? getRedisClient();
    this.maxSize = options.maxSize ?? envInt('STREAM_RING_BUFFER_SIZE', DEFAULT_RING_BUFFER_SIZE);
    this.ttlSeconds = options.ttlSeconds ?? envInt('STREAM_RING_BUFFER_TTL_S', DEFAULT_RING_BUFFER_TTL_SECONDS);
    this.logger = options.logger;
  }

  /** Redis key for a given (sessionId, turnId) pair. */
  static keyFor(sessionId: string, turnId: string): string {
    return `stream:ring:${sessionId}:${turnId}`;
  }

  /** Max size + TTL accessors (for tests / diagnostics). */
  get bufferSize(): number {
    return this.maxSize;
  }
  get ttl(): number {
    return this.ttlSeconds;
  }

  /**
   * Append one raw NDJSON line to the ring. Trims to N, refreshes TTL.
   * Fire-and-forget by contract: never throws. If Redis is down the
   * caller's hot path still runs — we just log and return false.
   *
   * The line MUST be a single JSON object with NO trailing newline. We
   * strip a trailing `\n` defensively so callers who pass the raw wire
   * frame get the same stored shape either way.
   */
  async append(sessionId: string, turnId: string, line: string): Promise<boolean> {
    if (!sessionId || !turnId || !line) return false;
    const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
    const key = StreamRingBuffer.keyFor(sessionId, turnId);
    try {
      await this.redis.rPush(key, normalized);
      // Keep only the most recent `maxSize` frames. LTRIM is O(N) in
      // frames trimmed; with a steady-state push rate N=5000 means at
      // most 5000 moves per trim — and in practice the ring stays at
      // its cap so LTRIM is O(1).
      await this.redis.lTrim(key, -this.maxSize, -1);
      // Refresh TTL on every append so a still-running turn doesn't
      // lose its buffer mid-flight. Callers are expected to invoke
      // `clear()` when a turn finalizes — or rely on TTL aging.
      await this.redis.expire(key, this.ttlSeconds);
      return true;
    } catch (error) {
      this.logger?.warn({ err: error, sessionId, turnId }, 'StreamRingBuffer append failed');
      return false;
    }
  }

  /**
   * Read all frames whose `_seq > after`, in order.
   *
   * Passing `after <= 0` returns the full retained buffer (useful for a
   * "cold" tail when the client lost its seq cursor). Frames without
   * `_seq` metadata flow through only when `after <= 0` — once we're
   * catching up a specific cursor we need the metadata to decide.
   */
  async readAfter(sessionId: string, turnId: string, after: number): Promise<RingFrame[]> {
    if (!sessionId || !turnId) return [];
    const key = StreamRingBuffer.keyFor(sessionId, turnId);
    try {
      const lines = await this.redis.lRange(key, 0, -1);
      const out: RingFrame[] = [];
      for (const raw of lines) {
        if (!raw) continue;
        const seq = extractSeq(raw);
        if (after <= 0) {
          out.push({ line: raw, seq });
          continue;
        }
        if (typeof seq === 'number' && seq > after) {
          out.push({ line: raw, seq });
        }
      }
      return out;
    } catch (error) {
      this.logger?.warn({ err: error, sessionId, turnId, after }, 'StreamRingBuffer readAfter failed');
      return [];
    }
  }

  /** Current number of frames retained for a turn. */
  async size(sessionId: string, turnId: string): Promise<number> {
    if (!sessionId || !turnId) return 0;
    const key = StreamRingBuffer.keyFor(sessionId, turnId);
    try {
      return await this.redis.lLen(key);
    } catch (error) {
      this.logger?.warn({ err: error, sessionId, turnId }, 'StreamRingBuffer size failed');
      return 0;
    }
  }

  /** True iff a turn's buffer exists in Redis. */
  async exists(sessionId: string, turnId: string): Promise<boolean> {
    if (!sessionId || !turnId) return false;
    const key = StreamRingBuffer.keyFor(sessionId, turnId);
    try {
      return await this.redis.exists(key);
    } catch (error) {
      this.logger?.warn({ err: error, sessionId, turnId }, 'StreamRingBuffer exists failed');
      return false;
    }
  }

  /** Delete a turn's buffer. Called on turn finalization beyond TTL. */
  async clear(sessionId: string, turnId: string): Promise<boolean> {
    if (!sessionId || !turnId) return false;
    const key = StreamRingBuffer.keyFor(sessionId, turnId);
    try {
      return await this.redis.del(key);
    } catch (error) {
      this.logger?.warn({ err: error, sessionId, turnId }, 'StreamRingBuffer clear failed');
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Module-scope singleton — avoids every request paying the constructor cost.
// Overridable via `setStreamRingBuffer` for tests.
// ---------------------------------------------------------------------------

let moduleBuffer: StreamRingBuffer | null = null;

export function getStreamRingBuffer(logger?: Logger): StreamRingBuffer {
  if (!moduleBuffer) {
    moduleBuffer = new StreamRingBuffer({ logger });
  }
  return moduleBuffer;
}

/** Test seam — reset the module-scope singleton. */
export function resetStreamRingBufferForTests(): void {
  moduleBuffer = null;
}

/** Test seam — install a specific StreamRingBuffer instance. */
export function setStreamRingBufferForTests(instance: StreamRingBuffer | null): void {
  moduleBuffer = instance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pull `_seq` out of a raw NDJSON line without a full JSON.parse when we
 * can avoid it (hot path — `append` runs per frame). Falls back to a
 * proper parse if the quick regex misses.
 */
export function extractSeq(line: string): number | undefined {
  // Fast path: `_seq` is one of the first metadata keys EventSequencer
  // stamps, so in ~95% of frames it appears in the first ~120 bytes.
  const m = line.match(/"_seq"\s*:\s*(\d+)/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) ? n : undefined;
  }
  // Slow path — full parse in case key ordering changed.
  try {
    const obj = JSON.parse(line);
    const s = obj?._seq;
    return typeof s === 'number' && Number.isFinite(s) ? s : undefined;
  } catch {
    return undefined;
  }
}
