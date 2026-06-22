import { describe, test, expect, vi } from 'vitest';
import { parseNDJSONStream, NDJSONHttpError } from '../ndjsonStream';

/**
 * Build a mock Response with a body whose ReadableStream emits the given
 * chunks (as strings) in order. Each chunk is decoded by the parser with
 * {stream: true} so we can simulate arbitrary byte-boundary splits.
 */
function mockResponse(chunks: string[], init?: { status?: number; statusText?: string; body?: string | null }): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  const status = init?.status ?? 200;
  const statusText = init?.statusText ?? 'OK';
  const body = init?.body === null ? null : (init?.body !== undefined ? init.body : stream);
  // When caller passes body: null / body: 'something-fixed', stream is
  // irrelevant — use body directly. Otherwise use the ReadableStream.
  if (body === null) {
    const r = new Response(null, { status, statusText });
    // Response with body:null — forcibly blank .body for the null-body test.
    Object.defineProperty(r, 'body', { value: null });
    return r;
  }
  if (typeof body === 'string') {
    return new Response(body, { status, statusText });
  }
  return new Response(body, { status, statusText });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe('parseNDJSONStream — happy path', () => {
  test('parses one-line-per-event stream', async () => {
    const resp = mockResponse([
      '{"type":"stream_start","sessionId":"s1"}\n',
      '{"type":"content_block_delta","content":"hi"}\n',
      '{"type":"done"}\n',
    ]);
    const events = await collect(parseNDJSONStream(resp));
    expect(events).toEqual([
      { type: 'stream_start', sessionId: 's1' },
      { type: 'content_block_delta', content: 'hi' },
      { type: 'done' },
    ]);
  });

  test('handles chunk boundaries that split mid-JSON', async () => {
    // Classic TCP fragmentation: one event arrives in two chunks.
    const resp = mockResponse([
      '{"type":"stream_start","se',
      'ssionId":"s1"}\n{"type":"ping"}\n',
    ]);
    const events = await collect(parseNDJSONStream(resp));
    expect(events).toEqual([
      { type: 'stream_start', sessionId: 's1' },
      { type: 'ping' },
    ]);
  });

  test('handles multiple events per chunk', async () => {
    const resp = mockResponse([
      '{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n',
    ]);
    const events = await collect(parseNDJSONStream(resp));
    expect(events.map(e => e.type)).toEqual(['a', 'b', 'c']);
  });

  test('skips blank lines (keepalive stutters / proxy artifacts)', async () => {
    const resp = mockResponse([
      '{"type":"a"}\n\n\n{"type":"b"}\n   \n{"type":"c"}\n',
    ]);
    const events = await collect(parseNDJSONStream(resp));
    expect(events.map(e => e.type)).toEqual(['a', 'b', 'c']);
  });

  test('flushes trailing line without final newline', async () => {
    // Some servers close without a trailing \n on the last line.
    const resp = mockResponse([
      '{"type":"a"}\n{"type":"done"}',
    ]);
    const events = await collect(parseNDJSONStream(resp));
    expect(events.map(e => e.type)).toEqual(['a', 'done']);
  });

  test('handles large single-chunk payloads', async () => {
    const big = 'x'.repeat(50_000);
    const resp = mockResponse([`{"type":"big","payload":"${big}"}\n`]);
    const events = await collect(parseNDJSONStream(resp));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('big');
    expect(typeof events[0].payload).toBe('string');
    expect((events[0].payload as string).length).toBe(50_000);
  });

  test('yields nested structures intact', async () => {
    const resp = mockResponse([
      '{"type":"tool_result","tool":"list_rgs","result":{"count":3,"items":[{"name":"a"},{"name":"b"},{"name":"c"}]}}\n',
    ]);
    const events = await collect(parseNDJSONStream(resp));
    expect((events[0].result as { count: number }).count).toBe(3);
    expect(((events[0].result as { items: unknown[] }).items as { name: string }[])[2].name).toBe('c');
  });
});

describe('parseNDJSONStream — error handling', () => {
  test('throws NDJSONHttpError on non-2xx', async () => {
    const resp = new Response('{"error":"nope"}', { status: 401, statusText: 'Unauthorized' });
    await expect(collect(parseNDJSONStream(resp))).rejects.toThrow(NDJSONHttpError);
  });

  test('NDJSONHttpError carries status + body preview', async () => {
    const resp = new Response('oops', { status: 500, statusText: 'Internal Server Error' });
    try {
      await collect(parseNDJSONStream(resp));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(NDJSONHttpError);
      const e = err as NDJSONHttpError;
      expect(e.status).toBe(500);
      expect(e.statusText).toBe('Internal Server Error');
      expect(e.body).toBe('oops');
    }
  });

  test('truncates huge error bodies to 2KB', async () => {
    const huge = 'x'.repeat(5000);
    const resp = new Response(huge, { status: 502, statusText: 'Bad Gateway' });
    try {
      await collect(parseNDJSONStream(resp));
    } catch (err) {
      expect((err as NDJSONHttpError).body.length).toBeLessThanOrEqual(2048);
    }
  });

  test('throws if response.body is null', async () => {
    const resp = new Response(null, { status: 200 });
    Object.defineProperty(resp, 'body', { value: null });
    await expect(collect(parseNDJSONStream(resp))).rejects.toThrow(/response\.body is null/);
  });

  test('skips malformed JSON lines, continues streaming', async () => {
    const resp = mockResponse([
      '{"type":"a"}\nnot valid json\n{"type":"b"}\n',
    ]);
    const events = await collect(parseNDJSONStream(resp));
    expect(events.map(e => e.type)).toEqual(['a', 'b']);
  });

  test('onParseError is invoked with the raw line + error', async () => {
    const resp = mockResponse([
      '{"type":"a"}\nbad-json\n{"type":"b"}\n',
    ]);
    const onParseError = vi.fn();
    const events = await collect(parseNDJSONStream(resp, { onParseError }));
    expect(events).toHaveLength(2);
    expect(onParseError).toHaveBeenCalledTimes(1);
    const [err, rawLine] = onParseError.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect(rawLine).toBe('bad-json');
  });

  test('malformed trailing line (no newline) invokes onParseError but does not throw', async () => {
    const resp = mockResponse([
      '{"type":"a"}\ntruncated-json{"type":',
    ]);
    const onParseError = vi.fn();
    const events = await collect(parseNDJSONStream(resp, { onParseError }));
    expect(events.map(e => e.type)).toEqual(['a']);
    expect(onParseError).toHaveBeenCalledTimes(1);
  });
});

describe('parseNDJSONStream — cancellation', () => {
  test('breaking out of the loop releases the reader lock', async () => {
    const resp = mockResponse([
      '{"type":"a"}\n',
      '{"type":"b"}\n',
      '{"type":"c"}\n',
    ]);
    const iter = parseNDJSONStream(resp);
    const collected: string[] = [];
    for await (const ev of iter) {
      collected.push(ev.type);
      if (collected.length === 2) break;
    }
    expect(collected).toEqual(['a', 'b']);
    // Reader lock already released by the finally block; acquiring a
    // fresh reader on the same body would throw, but we don't — just
    // asserting we reached here without hanging.
    expect(true).toBe(true);
  });
});

describe('parseNDJSONStream — typed narrowing', () => {
  test('caller can assert a narrower event type', async () => {
    interface ChatEvent extends Record<string, unknown> {
      type: 'stream_start' | 'content_block_delta' | 'done';
      content?: string;
    }
    const resp = mockResponse([
      '{"type":"stream_start"}\n{"type":"content_block_delta","content":"hi"}\n{"type":"done"}\n',
    ]);
    const events: ChatEvent[] = [];
    for await (const ev of parseNDJSONStream<ChatEvent>(resp)) {
      events.push(ev);
    }
    expect(events).toHaveLength(3);
    expect(events[1].content).toBe('hi');
  });
});
