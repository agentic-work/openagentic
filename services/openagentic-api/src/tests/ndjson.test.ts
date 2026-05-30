import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import {
  ndjsonHeaders,
  writeNDJSON,
  writeNDJSONError,
  startNDJSONStream,
  NDJSON_KEEPALIVE_MS,
  createSSEToNDJSONTranslator,
} from '../infra/ndjson.js';

// Minimal fake reply — records writes + lets us simulate socket errors.
type FakeReply = FastifyReply & {
  __writes: Array<string | Buffer>;
  __writeThrows: boolean;
  __headers?: Record<string, string>;
  __flushCalled: boolean;
  __socket: {
    setNoDelay: ReturnType<typeof vi.fn>;
    uncork: ReturnType<typeof vi.fn>;
  };
};

function makeReply(): FakeReply {
  const writes: Array<string | Buffer> = [];
  const socket = {
    setNoDelay: vi.fn(),
    uncork: vi.fn(),
  };
  const reply = {
    raw: {
      write(chunk: string | Buffer): boolean {
        if ((reply as FakeReply).__writeThrows) throw new Error('socket closed');
        writes.push(chunk);
        return true;
      },
      writeHead(_status: number, headers: Record<string, string>) {
        (reply as FakeReply).__headers = headers;
      },
      flushHeaders() {
        (reply as FakeReply).__flushCalled = true;
      },
      socket,
    },
    __writes: writes,
    __writeThrows: false,
    __flushCalled: false,
    __socket: socket,
  } as unknown as FakeReply;
  return reply;
}

describe('ndjsonHeaders()', () => {
  test('returns Content-Type application/x-ndjson', () => {
    const h = ndjsonHeaders();
    expect(h['Content-Type']).toBe('application/x-ndjson');
  });

  test('disables every proxy / browser buffering we know of', () => {
    const h = ndjsonHeaders();
    expect(h['X-Accel-Buffering']).toBe('no');
    expect(h['Cache-Control']).toContain('no-cache');
    expect(h['Cache-Control']).toContain('no-store');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Transfer-Encoding']).toBe('chunked');
    expect(h['Pragma']).toBe('no-cache');
    expect(h['Expires']).toBe('0');
  });

  test('allows CORS for any origin (internal streams behind auth)', () => {
    const h = ndjsonHeaders();
    expect(h['Access-Control-Allow-Origin']).toBe('*');
    expect(h['Connection']).toBe('keep-alive');
  });
});

describe('writeNDJSON()', () => {
  test('emits one JSON object per call with trailing newline', () => {
    const r = makeReply();
    const ok = writeNDJSON(r, 'stream_start', { sessionId: 'abc' });
    expect(ok).toBe(true);
    expect(r.__writes).toHaveLength(1);
    expect(r.__writes[0]).toBe('{"sessionId":"abc","type":"stream_start"}\n');
  });

  test('type field always present', () => {
    const r = makeReply();
    writeNDJSON(r, 'ping');
    const line = r.__writes[0] as string;
    const parsed = JSON.parse(line.trimEnd());
    expect(parsed.type).toBe('ping');
    expect(Object.keys(parsed)).toEqual(['type']);
  });

  test('explicit type parameter wins over payload.type', () => {
    const r = makeReply();
    writeNDJSON(r, 'canonical_name', { type: 'payload_wrong_name', foo: 'bar' });
    const parsed = JSON.parse((r.__writes[0] as string).trimEnd());
    expect(parsed.type).toBe('canonical_name');
    expect(parsed.foo).toBe('bar');
  });

  test('handles omitted payload cleanly', () => {
    const r = makeReply();
    writeNDJSON(r, 'done');
    expect(r.__writes[0]).toBe('{"type":"done"}\n');
  });

  test('spreads arbitrary payload fields onto the envelope', () => {
    const r = makeReply();
    writeNDJSON(r, 'tool_progress', { toolId: 't1', pct: 42, nested: { a: 1 } });
    const parsed = JSON.parse((r.__writes[0] as string).trimEnd());
    expect(parsed).toEqual({
      type: 'tool_progress',
      toolId: 't1',
      pct: 42,
      nested: { a: 1 },
    });
  });

  test('returns false when socket write throws (no exception propagates)', () => {
    const r = makeReply();
    r.__writeThrows = true;
    expect(() => writeNDJSON(r, 'x')).not.toThrow();
    expect(writeNDJSON(r, 'x')).toBe(false);
  });
});

describe('writeNDJSONError()', () => {
  test('emits type=error with code + message + timestamp', () => {
    const r = makeReply();
    writeNDJSONError(r, 'RATE_LIMIT_EXCEEDED', 'Too many requests');
    const parsed = JSON.parse((r.__writes[0] as string).trimEnd());
    expect(parsed.type).toBe('error');
    expect(parsed.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(parsed.message).toBe('Too many requests');
    expect(typeof parsed.timestamp).toBe('string');
    expect(Date.parse(parsed.timestamp)).toBeGreaterThan(0);
  });

  test('merges extra fields onto envelope', () => {
    const r = makeReply();
    writeNDJSONError(r, 'MCP_TIMEOUT', 'MCP call timed out', {
      stage: 'mcp',
      recommendations: ['Retry', 'Check proxy'],
    });
    const parsed = JSON.parse((r.__writes[0] as string).trimEnd());
    expect(parsed.stage).toBe('mcp');
    expect(parsed.recommendations).toEqual(['Retry', 'Check proxy']);
  });
});

describe('startNDJSONStream()', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('writes NDJSON headers + flushes + disables Nagle', () => {
    const r = makeReply();
    startNDJSONStream(r, { disableKeepalive: true });
    expect(r.__headers?.['Content-Type']).toBe('application/x-ndjson');
    expect(r.__flushCalled).toBe(true);
    expect(r.__socket.setNoDelay).toHaveBeenCalledWith(true);
    expect(r.__socket.uncork).toHaveBeenCalled();
  });

  test('arms keepalive at NDJSON_KEEPALIVE_MS by default', () => {
    const r = makeReply();
    const stream = startNDJSONStream(r);
    expect(r.__writes).toHaveLength(0);
    vi.advanceTimersByTime(NDJSON_KEEPALIVE_MS);
    expect(r.__writes).toHaveLength(1);
    const parsed = JSON.parse((r.__writes[0] as string).trimEnd());
    expect(parsed.type).toBe('ping');
    expect(typeof parsed.timestamp).toBe('string');
    stream.stop();
  });

  test('honours custom keepaliveMs', () => {
    const r = makeReply();
    const stream = startNDJSONStream(r, { keepaliveMs: 500 });
    vi.advanceTimersByTime(1500);
    expect(r.__writes.length).toBeGreaterThanOrEqual(3);
    stream.stop();
  });

  test('disableKeepalive: true → no ping events', () => {
    const r = makeReply();
    const stream = startNDJSONStream(r, { disableKeepalive: true });
    vi.advanceTimersByTime(30_000);
    expect(r.__writes).toHaveLength(0);
    stream.stop();
  });

  test('stop() clears the keepalive timer and is idempotent', () => {
    const r = makeReply();
    const stream = startNDJSONStream(r, { keepaliveMs: 100 });
    vi.advanceTimersByTime(150);
    expect(r.__writes).toHaveLength(1);
    stream.stop();
    vi.advanceTimersByTime(500);
    expect(r.__writes).toHaveLength(1); // no new pings after stop
    expect(() => stream.stop()).not.toThrow();
  });

  test('write() delegates to writeNDJSON', () => {
    const r = makeReply();
    const stream = startNDJSONStream(r, { disableKeepalive: true });
    stream.write('tool_start', { toolId: 'a' });
    expect(r.__writes[0]).toBe('{"toolId":"a","type":"tool_start"}\n');
  });

  test('error() emits a standard error envelope', () => {
    const r = makeReply();
    const stream = startNDJSONStream(r, { disableKeepalive: true });
    stream.error('PROVIDER_TIMEOUT', 'LLM call timed out', { provider: 'ollama' });
    const parsed = JSON.parse((r.__writes[0] as string).trimEnd());
    expect(parsed.type).toBe('error');
    expect(parsed.code).toBe('PROVIDER_TIMEOUT');
    expect(parsed.provider).toBe('ollama');
  });

  test('gracefully handles a reply without socket (e.g. in tests)', () => {
    const r = makeReply();
    // Simulate a socket-less reply (nullable case)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r.raw as any).socket = null;
    expect(() => startNDJSONStream(r, { disableKeepalive: true })).not.toThrow();
  });

  test('gracefully handles a reply without flushHeaders', () => {
    const r = makeReply();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r.raw as any).flushHeaders = undefined;
    expect(() => startNDJSONStream(r, { disableKeepalive: true })).not.toThrow();
  });
});

describe('createSSEToNDJSONTranslator()', () => {
  test('translates one SSE block to one NDJSON line', () => {
    const t = createSSEToNDJSONTranslator();
    const out = t.translate('event: node_start\ndata: {"executionId":"e1","nodeId":"n1"}\n\n');
    expect(out).toBe('{"executionId":"e1","nodeId":"n1","type":"node_start"}\n');
  });

  test('translates multiple SSE blocks in one chunk', () => {
    const t = createSSEToNDJSONTranslator();
    const out = t.translate(
      'event: a\ndata: {"x":1}\n\n' +
      'event: b\ndata: {"y":2}\n\n' +
      'event: c\ndata: {"z":3}\n\n',
    );
    const lines = out.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).type).toBe('a');
    expect(JSON.parse(lines[1]).type).toBe('b');
    expect(JSON.parse(lines[2]).type).toBe('c');
  });

  test('holds partial blocks across chunk boundaries', () => {
    const t = createSSEToNDJSONTranslator();
    const out1 = t.translate('event: node_start\ndata: {"id":"n');
    expect(out1).toBe(''); // incomplete block, nothing emitted yet
    const out2 = t.translate('1"}\n\nevent: node_complete\ndata: {"id":"n1"}\n\n');
    const lines = out2.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ id: 'n1', type: 'node_start' });
    expect(JSON.parse(lines[1])).toEqual({ id: 'n1', type: 'node_complete' });
  });

  test('drops SSE comment keepalives', () => {
    const t = createSSEToNDJSONTranslator();
    expect(t.translate(': connected\n\n')).toBe('');
    expect(t.translate(': keepalive\n\n')).toBe('');
    expect(t.translate(': ping 2026-04-18\n\n')).toBe('');
  });

  test('drops blocks without data: line', () => {
    const t = createSSEToNDJSONTranslator();
    expect(t.translate('event: orphan\n\n')).toBe('');
  });

  test('drops blocks with blank data: line', () => {
    const t = createSSEToNDJSONTranslator();
    expect(t.translate('event: empty\ndata: \n\n')).toBe('');
  });

  test('non-JSON data gets wrapped with {type, data}', () => {
    const t = createSSEToNDJSONTranslator();
    const out = t.translate('event: raw\ndata: not-json-at-all\n\n');
    expect(JSON.parse(out.trim())).toEqual({ type: 'raw', data: 'not-json-at-all' });
  });

  test('SSE event: name wins over payload.type', () => {
    const t = createSSEToNDJSONTranslator();
    // Payload carries its own conflicting type — SSE event: name takes precedence.
    const out = t.translate('event: execution_start\ndata: {"type":"different","x":1}\n\n');
    const parsed = JSON.parse(out.trim());
    expect(parsed.type).toBe('execution_start');
    expect(parsed.x).toBe(1);
  });

  test('missing event: preamble — falls back to payload.type if present', () => {
    const t = createSSEToNDJSONTranslator();
    const out = t.translate('data: {"type":"from_payload","a":1}\n\n');
    expect(JSON.parse(out.trim())).toEqual({ type: 'from_payload', a: 1 });
  });

  test('missing event: preamble AND no payload.type → type:"unknown"', () => {
    const t = createSSEToNDJSONTranslator();
    const out = t.translate('data: {"a":1}\n\n');
    expect(JSON.parse(out.trim())).toEqual({ a: 1, type: 'unknown' });
  });

  test('accepts Buffer input too', () => {
    const t = createSSEToNDJSONTranslator();
    const out = t.translate(Buffer.from('event: a\ndata: {"x":1}\n\n', 'utf8'));
    expect(JSON.parse(out.trim())).toEqual({ x: 1, type: 'a' });
  });

  test('flush() emits any trailing block without final \\n\\n', () => {
    const t = createSSEToNDJSONTranslator();
    t.translate('event: trailing\ndata: {"x":1}');
    const flushed = t.flush();
    expect(JSON.parse(flushed.trim())).toEqual({ x: 1, type: 'trailing' });
  });

  test('flush() on empty buffer returns empty string', () => {
    const t = createSSEToNDJSONTranslator();
    expect(t.flush()).toBe('');
  });

  test('translate then flush doubles-up cleanly without re-emitting', () => {
    const t = createSSEToNDJSONTranslator();
    const out = t.translate('event: a\ndata: {"x":1}\n\n');
    expect(JSON.parse(out.trim()).type).toBe('a');
    expect(t.flush()).toBe('');
  });
});
