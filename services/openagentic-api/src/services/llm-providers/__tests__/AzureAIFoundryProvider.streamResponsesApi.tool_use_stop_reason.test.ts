/**
 * RED → GREEN: AIF Responses API streaming must emit `stop_reason='tool_use'`
 * (not `'end_turn'`) when the model's output contains a `function_call` item.
 *
 * Smoking gun: 2026-05-10 Playwright wire capture against chat-dev gpt-5.4 —
 * model emitted a `tool_search` call (16 frames of opcode "2" in wire NDJSON)
 * but the canonical event stream yielded `message_delta:{stop_reason:'end_turn'}`.
 * chatLoop sees `end_turn` and exits the turn WITHOUT dispatching the tool,
 * leaving the user with zero assistant text and zero tool_result.
 *
 * Root cause: AzureAIFoundryProvider.streamResponsesApi:2779-2784 detects
 * function_call presence via `r.output` inspection on `response.completed`.
 * AIF's `response.completed` event does NOT reliably populate `r.output` with
 * the full function_call items. The fix: track function_call presence DURING
 * streaming (set a flag when `response.output_item.added` arrives with
 * `itemType === 'function_call'`) and use that flag for stop_reason mapping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { AzureAIFoundryProvider } from '../AzureAIFoundryProvider.js';

const silentLogger = pino({ level: 'silent' });

/**
 * Build a fetch Response whose body is a streamed sequence of SSE `data:` lines.
 * Mimics how AIF Responses API sends events.
 */
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('AzureAIFoundryProvider.streamResponsesApi — tool_use stop_reason', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    // @ts-expect-error stand-in for global fetch in test env
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('emits message_delta with stop_reason="tool_use" when the model emits a function_call item, even if response.completed has empty r.output', async () => {
    // Synthetic SSE matching the AIF Responses API contract observed in live
    // captures: function_call item appears via output_item.added + arguments
    // deltas + output_item.done, and the terminal response.completed event
    // has an EMPTY `output` array. This is the live bug condition — without
    // tracking function_call presence during streaming, the provider falls
    // back to `finishReason='completed'` → mapStopReason('') → 'end_turn'.
    const events = [
      { type: 'response.created', response: { id: 'resp_test', model: 'gpt-5.4' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          call_id: 'call_test_tool_search',
          name: 'tool_search',
        },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        delta: '{"query":"azure list",',
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        delta: '"k":8}',
      },
      { type: 'response.output_item.done', output_index: 0 },
      {
        type: 'response.completed',
        response: {
          id: 'resp_test',
          status: 'completed',
          // CRITICAL: empty output array — this is the bug condition.
          // The current 2779-2784 check inspects r.output and finds no
          // function_call items, so it maps stop_reason → 'end_turn'.
          output: [],
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      },
    ];

    fetchMock.mockResolvedValueOnce(sseResponse(events));

    const provider = new AzureAIFoundryProvider(silentLogger, {
      endpointUrl: 'https://example.cognitiveservices.azure.com',
      apiKey: 'test-key',
      model: 'gpt-5.4',
    });

    const result = await provider.createCompletion({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'list my Azure subscriptions' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'tool_search',
            description: 'Discover MCP tools by semantic query',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                k: { type: 'number' },
              },
            },
          },
        },
      ],
      max_tokens: 256,
      stream: true,
    });

    // createCompletion with stream:true returns an AsyncGenerator. Drain it.
    const yielded: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      yielded.push(evt);
    }

    // The canonical event stream MUST include a message_delta with
    // stop_reason='tool_use' so chatLoop dispatches the function_call.
    const messageDelta = yielded.find(
      (e) => e?.type === 'message_delta' && e?.delta?.stop_reason !== undefined,
    );
    expect(messageDelta, 'no message_delta event emitted').toBeDefined();
    expect(messageDelta.delta.stop_reason).toBe('tool_use');
  });

  it('still emits stop_reason="end_turn" for a plain text response with no function_call', async () => {
    // Sanity / regression: when there's NO function_call item, stop_reason
    // must remain 'end_turn'. This guards against the fix being too eager
    // (e.g. always returning 'tool_use').
    const events = [
      { type: 'response.created', response: { id: 'resp_plain', model: 'gpt-5.4' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message' },
      },
      { type: 'response.output_text.delta', output_index: 0, delta: 'Hello world' },
      { type: 'response.output_item.done', output_index: 0 },
      {
        type: 'response.completed',
        response: {
          id: 'resp_plain',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Hello world' }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      },
    ];

    fetchMock.mockResolvedValueOnce(sseResponse(events));

    const provider = new AzureAIFoundryProvider(silentLogger, {
      endpointUrl: 'https://example.cognitiveservices.azure.com',
      apiKey: 'test-key',
      model: 'gpt-5.4',
    });

    const result = await provider.createCompletion({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'say hello' }],
      max_tokens: 16,
      stream: true,
    });

    const yielded: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      yielded.push(evt);
    }

    const messageDelta = yielded.find(
      (e) => e?.type === 'message_delta' && e?.delta?.stop_reason !== undefined,
    );
    expect(messageDelta).toBeDefined();
    expect(messageDelta.delta.stop_reason).toBe('end_turn');
  });
});
