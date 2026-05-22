/**
 * Sev-0: gpt-oss:20b empty bubble after tool_results (Bug A).
 *
 * Live capture 2026-05-11 (validation probe, kubernetes ground-truth):
 *   - chatLoop no-progress guard fired at turn 4 (3× identical k8s_list_pods)
 *   - guard forced nextTurnToolChoice='none' for the synthesis turn
 *   - synthesis turn dispatched to gpt-oss:20b on host.docker.internal:11434
 *   - Ollama returned: done=true, eval_count=12156, hasContent=false,
 *     tool_calls=['synth']
 *   - stream closed without ever emitting a text_delta
 *   - UI: empty bubble
 *
 * Two contracts pinned by this file:
 *
 *   (1) `tool_choice='none'` on the request MUST result in the `tools`
 *       array being OMITTED from the Ollama /api/chat wire payload.
 *       Ollama's native /api/chat protocol does not support an
 *       OpenAI-style `tool_choice='none'` directive; the only way to
 *       forbid tool calls on a turn is to not offer tools at all.
 *
 *   (2) When the model returns done=true with non-empty `tool_calls`
 *       and no content, the provider stream MUST emit at least one
 *       canonical event that carries the tool_call (so chatLoop can
 *       dispatch it on the next turn) — never close silently.
 *
 * No real network: globalThis.fetch is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../OllamaProvider.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(function (this: any) { return this; }),
} as any;

// helper: build a fake Ollama /api/chat NDJSON Response body.
function ndjsonResponse(rows: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const row of rows) {
        controller.enqueue(encoder.encode(JSON.stringify(row) + '\n'));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

// helper: a /api/tags Response that reports the model as present so
// ensureModelExists doesn't trip.
function tagsResponse(model: string): Response {
  return new Response(JSON.stringify({ models: [{ name: model }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OllamaProvider — synthesis-after-tools (Bug A)', () => {
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

  it("omits the tools array on the wire when tool_choice='none'", async () => {
    // First fetch: /api/tags (ensureModelExists)
    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    // Second fetch: /api/chat — return a minimal stream that yields content
    // then done=true with no tool_calls.
    fetchMock.mockResolvedValueOnce(
      ndjsonResponse([
        { model: MODEL, message: { role: 'assistant', content: 'final answer' }, done: false },
        { model: MODEL, done: true, prompt_eval_count: 5, eval_count: 10 },
      ]),
    );

    const provider = new OllamaProvider(silentLogger, {
      baseUrl: 'http://host.docker.internal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: [{ role: 'user', content: 'synth time' }],
      tools: [
        {
          type: 'function',
          function: { name: 't', description: 'd', parameters: { type: 'object', properties: {} } },
        },
      ] as any,
      tool_choice: 'none' as any,
      stream: true,
    });

    // drain generator
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _evt of result as AsyncGenerator<any>) {
      /* noop */
    }

    // Find the /api/chat call (second fetch in this test).
    const chatCall = fetchMock.mock.calls.find((c) =>
      typeof c[0] === 'string' && (c[0] as string).endsWith('/api/chat'),
    );
    expect(chatCall, '/api/chat must have been called').toBeDefined();

    const body = JSON.parse((chatCall![1] as RequestInit).body as string);
    expect(
      body.tools,
      "tools array must be omitted on synthesis turn (tool_choice='none')",
    ).toBeUndefined();
  });

  it('emits at least one canonical event carrying the tool_call before the stream closes, even when done arrives with tool_calls only and no content', async () => {
    fetchMock.mockResolvedValueOnce(tagsResponse(MODEL));
    // Mimic the live capture: done=true with tool_calls=['synth'] and no
    // message content.
    fetchMock.mockResolvedValueOnce(
      ndjsonResponse([
        {
          model: MODEL,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'synth', arguments: {} } }],
          },
          done: true,
          prompt_eval_count: 100,
          eval_count: 12156,
        },
      ]),
    );

    const provider = new OllamaProvider(silentLogger, {
      baseUrl: 'http://host.docker.internal:11434',
      healthCheckModel: MODEL,
    });

    const result = await provider.createCompletion({
      model: MODEL,
      messages: [{ role: 'user', content: 'after tools' }],
      tools: [
        {
          type: 'function',
          function: { name: 'synth', description: 'synth tool', parameters: { type: 'object', properties: {} } },
        },
      ] as any,
      stream: true,
    });

    const events: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      events.push(evt);
    }

    // #770 — The stream MUST yield CANONICAL Anthropic-shape SDK events
    // (content_block_start { type:'tool_use' } + content_block_stop +
    // message_delta { stop_reason:'tool_use' }). OpenAI Chat-Completions
    // chunk shape (choices[].delta.tool_calls) is the OLD broken behavior:
    // downstream streamProvider's translateOpenAIFinishChunk reads
    // finish_reason but drops delta.tool_calls, so chatLoop's
    // contentBlocks.filter(type==='tool_use') ends up empty → no dispatch →
    // model loops the same tool_search until max-turns. Live capture
    // 2026-05-11 (kubernetes ground-truth probe) showed 18 identical
    // tool_search emissions, /api/internal/tool-search never hit.
    const toolUseStart = events.find(
      (e) =>
        e?.type === 'content_block_start' &&
        e?.content_block?.type === 'tool_use',
    );
    expect(
      toolUseStart,
      "must emit canonical content_block_start { type:'tool_use' } — otherwise streamProvider drops the tool_call and chatLoop sees no toolBlocks",
    ).toBeDefined();
    expect(toolUseStart.content_block.name).toBe('synth');
    expect(typeof toolUseStart.content_block.id).toBe('string');

    const toolUseStop = events.find(
      (e) =>
        e?.type === 'content_block_stop' &&
        e?.index === toolUseStart.index,
    );
    expect(toolUseStop, 'tool_use block must be closed').toBeDefined();

    const messageDelta = events.find(
      (e) =>
        e?.type === 'message_delta' &&
        e?.delta?.stop_reason === 'tool_use',
    );
    expect(
      messageDelta,
      "must emit canonical message_delta { stop_reason:'tool_use' } so chatLoop's stopReason reaches the dispatch branch",
    ).toBeDefined();

    // Negative assertion: must NOT emit the broken OpenAI Chat-Completions
    // shape that streamProvider's translateOpenAIFinishChunk drops on the
    // floor. Keep this guard so a future refactor doesn't silently regress
    // back to the smoking-gun behavior.
    const openAiShape = events.find(
      (e) =>
        Array.isArray(e?.choices) &&
        e.choices.some(
          (c: any) =>
            Array.isArray(c?.delta?.tool_calls) && c.delta.tool_calls.length > 0,
        ),
    );
    expect(
      openAiShape,
      'must NOT emit OpenAI Chat-Completions shape for tool_calls — that shape gets dropped by streamProvider',
    ).toBeUndefined();
  });
});
