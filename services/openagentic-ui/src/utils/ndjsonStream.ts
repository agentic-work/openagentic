/**
 * Shared NDJSON streaming parser for browser `fetch()` responses.
 *
 * Every streaming endpoint in the platform (chat, flows, admin, agents,
 * background-jobs, MCP logs, test-harness, provisioning) returns
 * `application/x-ndjson`: one typed JSON object per line.
 *
 *     {"type": "stream_start", ...}\n
 *     {"type": "content_block_delta", ...}\n
 *     {"type": "done", ...}\n
 *
 * Clients split on `\n`, JSON.parse each complete line, and switch on
 * `.type`. The incomplete tail (no trailing `\n` yet) is held over to
 * the next chunk.
 *
 * History: v0.6.5 task #91 added Accept-header NDJSON negotiation;
 * v0.6.6 BLOCKER-004 removed SSE from chat entirely because the
 * translator dropped `.type` in per-call writes and the UI silently
 * discarded every delta. This util is the canonical home for NDJSON
 * stream parsing so every consumer uses the same tested loop.
 */

/**
 * Typed NDJSON event envelope. Every server emit is `{type, ...}`.
 * Consumers narrow the `type` field with a switch statement; any
 * additional fields are accessible on the union value.
 */
export interface NDJSONEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Error thrown when the HTTP response status isn't 2xx. Carries the
 * original status / statusText / body preview so callers can surface
 * meaningful errors to the user without re-fetching.
 */
export class NDJSONHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`NDJSON stream failed: ${status} ${statusText}`);
    this.name = 'NDJSONHttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * Parse an NDJSON fetch response into an async iterable of typed events.
 *
 * Usage:
 *
 *     const resp = await fetch('/api/chat/stream', {
 *       method: 'POST',
 *       headers: { 'Accept': 'application/x-ndjson', ... },
 *       body: JSON.stringify(payload),
 *     });
 *     for await (const ev of parseNDJSONStream(resp)) {
 *       switch (ev.type) { ... }
 *     }
 *
 * Behaviour:
 * - Throws `NDJSONHttpError` if `!response.ok` (reads up to 2KB of body
 *   for the error message; doesn't drain the whole stream on error).
 * - Throws if `response.body` is null (unusual; only Firefox older than
 *   modern support levels + some opaque responses).
 * - Skips blank lines (robust to keepalive stutters and proxy artifacts).
 * - Skips malformed lines silently rather than killing the stream —
 *   a single bad line shouldn't abort a long turn. Callers can set
 *   `options.onParseError` to observe these if needed.
 * - Preserves partial-line tails across chunk boundaries so events
 *   split mid-JSON by TCP fragmentation arrive intact.
 * - Releases the reader lock when the generator is returned / thrown
 *   into, so `break` in `for await` cleanly cancels the stream.
 */
export async function* parseNDJSONStream<T extends NDJSONEvent = NDJSONEvent>(
  response: Response,
  options?: {
    onParseError?: (err: unknown, rawLine: string) => void;
  },
): AsyncIterable<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new NDJSONHttpError(response.status, response.statusText, body.slice(0, 2048));
  }
  if (!response.body) {
    throw new Error('parseNDJSONStream: response.body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush any trailing line that lacks a newline — rare but valid.
        const tail = buffer.trim();
        if (tail) {
          try {
            yield JSON.parse(tail) as T;
          } catch (err) {
            options?.onParseError?.(err, tail);
          }
        }
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split on newline. The last element is the incomplete tail; keep
      // it in `buffer` for the next chunk.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as T;
        } catch (err) {
          options?.onParseError?.(err, line);
          // intentionally continue — one bad line shouldn't kill the stream
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released (e.g. stream cancelled) — ignore.
    }
  }
}
