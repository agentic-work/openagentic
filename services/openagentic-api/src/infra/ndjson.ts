/**
 * Shared NDJSON streaming primitives for Fastify handlers.
 *
 * Every stream endpoint in the platform (chat, flows, admin, sub-agents,
 * background jobs) writes one typed JSON object per line:
 *
 *     {"type": "<eventName>", ...payload}\n
 *
 * Clients split on `\n`, `JSON.parse` each complete line, switch on
 * `type`. No SSE `event:` / `data:` state machine, no `\n\n` delimiter.
 *
 * Context: v0.6.5 introduced Accept-header NDJSON negotiation; v0.6.6
 * (BLOCKER-004) ripped SSE out of chat entirely because the translator
 * dropped the `.type` field in per-call write chunks and the UI silently
 * dropped every delta. This module is the canonical home for NDJSON
 * emission so that mistake can't recur anywhere else.
 *
 * Callers should use `ndjsonHeaders()` at `reply.raw.writeHead` time,
 * then `writeNDJSON(reply, type, payload)` for every event.
 *
 * NB: `/v1/chat/completions` (OpenAI/Anthropic-SDK-compatible endpoint)
 * deliberately stays on SSE — that's a public API contract. This module
 * is for internal streams only.
 */

import type { FastifyReply } from 'fastify';

/**
 * Response headers for an NDJSON stream. Disables proxy buffering at every
 * level we've seen cause real-world delays (nginx `X-Accel-Buffering`,
 * browser MIME sniffing, HTTP/1.0 caches). Chunked transfer is required
 * because we stream an unknown content length.
 */
export function ndjsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, X-Requested-With',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
    'Transfer-Encoding': 'chunked',
    'Pragma': 'no-cache',
    'Expires': '0',
  };
}

/**
 * Emit one NDJSON event.
 *
 * Convention: the envelope always carries `type` (the event name). All
 * other keys from `payload` are spread onto the same object. If `payload`
 * happens to carry its own `type`, the explicit `type` parameter wins
 * so the client always sees the canonical event name.
 *
 * Returns the underlying socket's back-pressure signal (true = flushed,
 * false = buffered) so callers can propagate it to async generators if
 * they want to honour back-pressure.
 *
 * If the write throws (e.g. socket already closed), returns false rather
 * than propagating — the pipeline abort controller is the right mechanism
 * to react to disconnects, not a raw exception from every emit site.
 */
export function writeNDJSON(
  reply: FastifyReply,
  type: string,
  payload?: Record<string, unknown>,
): boolean {
  try {
    const obj = payload ? { ...payload, type } : { type };
    // Spread-then-override order guarantees `type` wins even if payload
    // carries a conflicting `type` field (rare but observed in some
    // provider events that already self-describe).
    const line = JSON.stringify(obj) + '\n';
    return reply.raw.write(line);
  } catch {
    return false;
  }
}

/**
 * Emit a standard error envelope. Use for any server-side failure that
 * the client should surface to the user. `code` is a machine-readable
 * string (e.g. `RATE_LIMIT_EXCEEDED`), `message` is human-readable, and
 * `extra` lets callers attach stage, recommendations, recovery hints
 * without having to reassemble the `type: 'error'` envelope themselves.
 */
export function writeNDJSONError(
  reply: FastifyReply,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): boolean {
  return writeNDJSON(reply, 'error', {
    code,
    message,
    timestamp: new Date().toISOString(),
    ...(extra ?? {}),
  });
}

/**
 * Keepalive interval. Exported so tests can assert on it and so callers
 * can choose to skip it (some streams are short-lived).
 */
export const NDJSON_KEEPALIVE_MS = 3_000;

/**
 * Start an NDJSON stream: write headers, flush them, disable Nagle on
 * the socket for immediate chunk delivery, and arm a keepalive timer.
 *
 * Returns a small handle:
 *   - `write(type, payload)` — emit a typed event
 *   - `error(code, message, extra?)` — emit a standard error envelope
 *   - `stop()` — clear the keepalive timer (safe to call repeatedly)
 *
 * The caller still owns `reply.raw.end()` — we don't call it here
 * because some endpoints want to write more after `stop()` (e.g. final
 * `done` event before closing the connection).
 */
export interface NDJSONStream {
  write(type: string, payload?: Record<string, unknown>): boolean;
  error(code: string, message: string, extra?: Record<string, unknown>): boolean;
  stop(): void;
}

export function startNDJSONStream(
  reply: FastifyReply,
  options?: { keepaliveMs?: number; disableKeepalive?: boolean },
): NDJSONStream {
  reply.raw.writeHead(200, ndjsonHeaders());

  // Disable Nagle's algorithm — small NDJSON lines must go out immediately
  // instead of being coalesced into TCP packets. Also uncork any pending
  // buffered data.
  const socket = reply.raw.socket;
  if (socket) {
    socket.setNoDelay(true);
    if (typeof (socket as { uncork?: () => void }).uncork === 'function') {
      (socket as { uncork: () => void }).uncork();
    }
  }
  if (typeof reply.raw.flushHeaders === 'function') {
    reply.raw.flushHeaders();
  }

  let keepalive: ReturnType<typeof setInterval> | null = null;
  if (!options?.disableKeepalive) {
    const interval = options?.keepaliveMs ?? NDJSON_KEEPALIVE_MS;
    keepalive = setInterval(() => {
      writeNDJSON(reply, 'ping', { timestamp: new Date().toISOString() });
    }, interval);
  }

  return {
    write: (type: string, payload?: Record<string, unknown>) => writeNDJSON(reply, type, payload),
    error: (code: string, message: string, extra?: Record<string, unknown>) =>
      writeNDJSONError(reply, code, message, extra),
    stop: () => {
      if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
    },
  };
}

/**
 * Create a stateful translator that converts SSE byte chunks (`event: X\n
 * data: Y\n\n` blocks, possibly split across TCP packets) into NDJSON
 * lines (`{type:"X", ...Y}\n`).
 *
 * Use case: we want to kill SSE everywhere client-visible, but some
 * downstream microservices (workflow-service, openagentic-proxy) still emit SSE
 * over their own stream boundaries. Rather than block on those deploys,
 * we bridge at the proxy point — incoming SSE bytes become outgoing
 * NDJSON lines with `type` correctly populated from the `event:` preamble.
 *
 * The returned function is call-per-chunk stateful: it buffers partial
 * blocks across chunks and only emits NDJSON for complete `\n\n`-
 * delimited blocks. Call `flush()` at the end of the upstream stream
 * to emit any final block missing a trailing `\n\n`.
 *
 * SSE keepalive lines (those starting with `:` — e.g. `: ping` or
 * `: keepalive`) are dropped; NDJSON has its own keepalive mechanism
 * and these don't carry payload.
 */
export function createSSEToNDJSONTranslator(): {
  translate(chunk: string | Buffer): string;
  flush(): string;
} {
  let buffer = '';

  const parseBlock = (block: string): string => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    // Drop SSE comment-style keepalives — they have no `event:` / `data:` payload.
    if (!trimmed.includes('data:')) return '';
    let eventType: string | null = null;
    let data: string | null = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        // First data: line wins. SSE allows multi-line data but nothing
        // in our stack emits that today.
        data = line.slice(6);
        break;
      }
    }
    if (!data || !data.trim()) return '';
    try {
      const obj = JSON.parse(data);
      // If the payload already has `type`, the SSE event name still wins
      // when present — SSE `event:` is the authoritative source.
      const merged = eventType
        ? { ...obj, type: eventType }
        : ('type' in obj ? obj : { ...obj, type: 'unknown' });
      return JSON.stringify(merged) + '\n';
    } catch {
      return JSON.stringify({ type: eventType || 'raw', data }) + '\n';
    }
  };

  return {
    translate(chunk: string | Buffer): string {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      let out = '';
      for (const block of blocks) {
        out += parseBlock(block);
      }
      return out;
    },
    flush(): string {
      if (!buffer) return '';
      const tail = buffer;
      buffer = '';
      return parseBlock(tail);
    },
  };
}
