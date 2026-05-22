/**
 * B4 — OllamaProvider graceful handling of malformed JSON in tool_calls.arguments.
 *
 * Pre-B4: When Ollama returned a tool_call with a malformed JSON string in
 * `arguments`, the api would let the bad string flow through to streamProvider's
 * JSON.parse, which caught + fell back to `{ _raw: <bad> }` — dispatch then ran
 * with garbage input, the tool errored opaquely, the loop bubbled up as a 500
 * PIPELINE_ERROR somewhere (most commonly via downstream consumers in
 * services/openagentic-api/src/routes/openagentic.ts:2660 which had an
 * UNGUARDED JSON.parse on `tc.function.arguments`).
 *
 * B4 contract:
 *  (1) The OllamaProvider stream MUST NOT throw when Ollama emits malformed
 *      JSON in tool_calls.arguments — even when arguments is a string that
 *      fails JSON.parse.
 *  (2) The yielded canonical event stream MUST include a tool_use
 *      content_block_start whose `input` is tagged with `__malformed_args=true`
 *      so the downstream chat loop can short-circuit to a synthetic
 *      `tool_result` with `is_error:true` instead of dispatching garbage.
 *  (3) The stream MUST still emit message_delta { stop_reason: 'tool_use' }
 *      so the chat-loop reaches its dispatch branch (where the short-circuit
 *      lives).
 *
 * Real-data fixture: src/lib/agentic-sdk/normalizers/__tests__/fixtures/
 *   ollama-malformed-args-real.ndjson — doctored real capture (verbatim
 *   chunks from host.docker.internal:11434/gpt-oss:20b, except the final chunk's
 *   `arguments` field corrupted from {"location":"Boston"} → the malformed
 *   string '{\"location\":\"Boston' to simulate the small-model defect).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OllamaProvider } from '../OllamaProvider.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(function (this: any) { return this; }),
} as any;

function fixturePath(name: string): string {
  return resolve(
    __dirname,
    '..',
    '..',
    '..',
    'lib',
    'agentic-sdk',
    'normalizers',
    '__tests__',
    'fixtures',
    name,
  );
}

function ndjsonResponseFromFile(filename: string): Response {
  const text = readFileSync(fixturePath(filename), 'utf8');
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Preserve original framing (one JSON per newline).
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

function tagsResponse(model: string): Response {
  return new Response(JSON.stringify({ models: [{ name: model }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OllamaProvider — B4 graceful malformed tool_calls.arguments', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  const MODEL = 'gpt-oss:20b';

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    // @ts-expect-error stub global fetch
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('does NOT throw when Ollama returns a tool_call with malformed JSON arguments', async () => {
    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    fetchMock.mockResolvedValueOnce(ndjsonResponseFromFile('ollama-malformed-args-real.ndjson'));

    const provider = new OllamaProvider(silentLogger, {
      baseUrl: 'http://host.docker.internal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: [{ role: 'user', content: 'weather' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'get weather for a city',
            parameters: { type: 'object', properties: { location: { type: 'string' } } },
          },
        },
      ] as any,
      stream: true,
    });

    // Draining the generator must NOT throw.
    let threw: unknown = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _evt of result as AsyncGenerator<any>) {
        /* noop */
      }
    } catch (e) {
      threw = e;
    }
    expect(threw, 'generator must not throw on malformed args').toBeNull();
  });

  it('emits a canonical tool_use block whose input is flagged __malformed_args=true', async () => {
    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    fetchMock.mockResolvedValueOnce(ndjsonResponseFromFile('ollama-malformed-args-real.ndjson'));

    const provider = new OllamaProvider(silentLogger, {
      baseUrl: 'http://host.docker.internal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: [{ role: 'user', content: 'weather' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'get weather for a city',
            parameters: { type: 'object', properties: { location: { type: 'string' } } },
          },
        },
      ] as any,
      stream: true,
    });

    const events: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      events.push(evt);
    }

    const toolUseStart = events.find(
      (e) =>
        e?.type === 'content_block_start' &&
        e?.content_block?.type === 'tool_use',
    );
    expect(toolUseStart, 'must emit tool_use content_block_start even when args are malformed').toBeDefined();
    expect(toolUseStart.content_block.name).toBe('get_weather');
    expect(
      toolUseStart.content_block.input?.__malformed_args,
      'tool_use.input must be flagged __malformed_args=true so chatLoop can short-circuit',
    ).toBe(true);
  });

  it('still emits message_delta stop_reason=tool_use so the chat loop reaches its dispatch branch', async () => {
    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    fetchMock.mockResolvedValueOnce(ndjsonResponseFromFile('ollama-malformed-args-real.ndjson'));

    const provider = new OllamaProvider(silentLogger, {
      baseUrl: 'http://host.docker.internal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: [{ role: 'user', content: 'weather' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'd',
            parameters: { type: 'object', properties: {} },
          },
        },
      ] as any,
      stream: true,
    });

    const events: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      events.push(evt);
    }

    const messageDelta = events.find(
      (e) => e?.type === 'message_delta' && e?.delta?.stop_reason === 'tool_use',
    );
    expect(
      messageDelta,
      'must emit message_delta stop_reason=tool_use so chatLoop dispatches (and short-circuits to is_error)',
    ).toBeDefined();
  });

  it('logs a warn with the raw malformed args string for operator debugging', async () => {
    const warnSpy = vi.fn();
    const loggerWithWarn = {
      info: vi.fn(),
      warn: warnSpy,
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(function (this: any) { return this; }),
    } as any;

    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    fetchMock.mockResolvedValueOnce(ndjsonResponseFromFile('ollama-malformed-args-real.ndjson'));

    const provider = new OllamaProvider(loggerWithWarn, {
      baseUrl: 'http://host.docker.internal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: [{ role: 'user', content: 'weather' }],
      tools: [
        {
          type: 'function',
          function: { name: 'get_weather', description: 'd', parameters: { type: 'object', properties: {} } },
        },
      ] as any,
      stream: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _evt of result as AsyncGenerator<any>) { /* drain */ }

    const malformedWarn = warnSpy.mock.calls.find((c) => {
      const msg = c[c.length - 1];
      return typeof msg === 'string' && /malformed/i.test(msg);
    });
    expect(
      malformedWarn,
      'must log warn with mention of malformed args for operator debugging',
    ).toBeDefined();
  });
});
