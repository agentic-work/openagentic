/**
 * RED → GREEN: AIF Responses API STREAMING path must retry on transient 5xx
 * (502 / 503 / 504), not surface them to the caller as a one-shot failure.
 *
 * Live failure 2026-05-11 (capstone "show me my Azure subs and rgs"):
 *   After the #763 no-progress guard fired, the forced synthesis turn dispatched
 *   to AIF Responses API with tool_choice='none'. Azure's eastus2 gateway
 *   returned 503 "upstream connect error or disconnect/reset before headers"
 *   on the very first attempt. The chatmode surfaced that to the user as
 *   REQUEST_TIMEOUT "The request took too long. Please try again." with
 *   ZERO retries — even though `fetchWithRetry` is already wired on the
 *   non-streaming Responses API path (line 2997) and the legacy Chat
 *   Completions path (line 2091) in the same file.
 *
 * The fix: route the streaming Responses API fetch through `fetchWithRetry`
 * exactly like its sibling paths. `fetchWithRetry` already handles 429 + 5xx
 * with exponential backoff + Retry-After header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { AzureAIFoundryProvider } from '../AzureAIFoundryProvider.js';

const silentLogger = pino({ level: 'silent' });

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

function transientFailure(status: number, body = 'upstream connect error'): Response {
  return new Response(body, {
    status,
    statusText: status === 503 ? 'Service Unavailable' : `HTTP ${status}`,
  });
}

describe('AzureAIFoundryProvider.streamResponsesApi — retry on 5xx', () => {
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

  it('retries the streaming Responses API call when Azure returns 503 then succeeds', async () => {
    // Two transient 503s (the gateway flakiness pattern observed in the
    // 2026-05-11 capstone capture), then a normal SSE stream.
    const successEvents = [
      { type: 'response.created', response: { id: 'resp_retry_ok', model: 'gpt-5.4' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message' },
      },
      { type: 'response.output_text.delta', output_index: 0, delta: 'Recovered.' },
      { type: 'response.output_item.done', output_index: 0 },
      {
        type: 'response.completed',
        response: {
          id: 'resp_retry_ok',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Recovered.' }],
            },
          ],
          usage: { input_tokens: 20, output_tokens: 5 },
        },
      },
    ];

    fetchMock
      .mockResolvedValueOnce(transientFailure(503))
      .mockResolvedValueOnce(transientFailure(503))
      .mockResolvedValueOnce(sseResponse(successEvents));

    const provider = new AzureAIFoundryProvider(silentLogger, {
      endpointUrl: 'https://example.cognitiveservices.azure.com',
      apiKey: 'test-key',
      model: 'gpt-5.4',
    });

    const result = await provider.createCompletion({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'after-guard synthesis' }],
      max_tokens: 16,
      stream: true,
    });

    const yielded: any[] = [];
    for await (const evt of result as AsyncGenerator<any>) {
      yielded.push(evt);
    }

    // Critical assertions: 3 fetch attempts (2 retries) and the stream
    // produced canonical events ending with a normal message_stop.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const messageStop = yielded.find((e) => e?.type === 'message_stop');
    expect(messageStop, 'streaming did not complete after retry').toBeDefined();
  }, 15_000);

  it('surfaces the 503 only after retries are exhausted', async () => {
    // 4 consecutive 503s — exceeds default maxRetries (3).
    fetchMock
      .mockResolvedValueOnce(transientFailure(503))
      .mockResolvedValueOnce(transientFailure(503))
      .mockResolvedValueOnce(transientFailure(503))
      .mockResolvedValueOnce(transientFailure(503));

    const provider = new AzureAIFoundryProvider(silentLogger, {
      endpointUrl: 'https://example.cognitiveservices.azure.com',
      apiKey: 'test-key',
      model: 'gpt-5.4',
    });

    const result = await provider.createCompletion({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'persistent 503' }],
      max_tokens: 16,
      stream: true,
    });

    // Drain MUST throw the upstream error eventually.
    let thrown: unknown = null;
    try {
      for await (const _evt of result as AsyncGenerator<any>) {
        // drain
      }
    } catch (err) {
      thrown = err;
    }

    expect(thrown, 'no error surfaced after retries exhausted').toBeTruthy();
    expect(String((thrown as Error).message)).toMatch(/503|upstream|AIF Responses/i);
    // fetchWithRetry default = 3 retries → 4 total attempts.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 30_000);
});
