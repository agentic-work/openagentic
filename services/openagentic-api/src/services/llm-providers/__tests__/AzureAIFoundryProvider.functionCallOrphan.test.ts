/**
 * Sev-0 #774 — AIF Responses API drops orphan function_call_output items
 * across multi-turn tool flows. Live capture 2026-05-12:
 *
 *   gpt-5.4 dispatched azure_list_subscriptions 4×, tool_results came back
 *   each time, but the model said "I don't have any Azure tool results in
 *   the visible conversation state to synthesize from."
 *
 * Root cause traced to AzureAIFoundryProvider.buildResponsesApiBody:
 *   convertAnthropicMessagesToOpenAI folds tool_use blocks into
 *   `msg.tool_calls[]` on the assistant message (OpenAI Chat shape).
 *   buildResponsesApiBody then iterates msg.content but never reads
 *   msg.tool_calls → function_call items never emitted → next-turn
 *   function_call_output entries have no matching function_call →
 *   orphan filter (line ~2497) drops them all → model receives empty
 *   tool result history.
 *
 * Fix: in buildResponsesApiBody, when an assistant message carries
 * `tool_calls[]`, replay them as `function_call` input items.
 *
 * This test pins the wire-shape contract by inspecting the body sent
 * to fetch(). No live network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureAIFoundryProvider } from '../AzureAIFoundryProvider.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(function (this: any) { return this; }),
} as any;

// Minimal Response that pretends to be a streaming `response.completed` event
// followed by `data: [DONE]` — enough to let the provider exit cleanly.
function fakeSse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('AzureAIFoundryProvider — Sev-0 #774 function_call orphan fix', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

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

  it('replays assistant.tool_calls[] as function_call items in input[] so function_call_output entries pair correctly', async () => {
    // Stub the Responses API call to return an empty completed event.
    fetchMock.mockResolvedValue(
      fakeSse(
        'event: response.completed\ndata: {"response":{"output":[],"usage":{"input_tokens":10,"output_tokens":0}}}\n\ndata: [DONE]\n\n',
      ),
    );

    const provider = new AzureAIFoundryProvider(silentLogger, {
      apiKey: 'test',
      endpoint: 'https://fake.aif.example/openai/v1',
      deployment: 'gpt-5.4',
    } as any);

    // Anthropic-shape messages: prior turn's assistant tool_use + tool_result,
    // current user prompt. This is what chatLoop pushes after a tool round.
    const messages = [
      { role: 'user', content: 'list azure subs' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_abc123', name: 'azure_list_subscriptions', input: {} },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_abc123',
            text: '{"subscriptions":[{"id":"s1","name":"prod"}]}',
          },
        ],
      },
      { role: 'user', content: 'and now show resource groups' },
    ];

    // The Responses API path is selected per the model deployment heuristic.
    // We call createCompletion and drain the generator; what matters is what
    // ended up on the wire body.
    const gen = await provider.createCompletion({
      model: 'gpt-5.4',
      messages: messages as any,
      stream: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _evt of gen as AsyncGenerator<any>) {
      /* drain */
    }

    // Find the /v1/responses POST call.
    const responsesCall = fetchMock.mock.calls.find((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as any)?.url || '';
      return /\/v1\/responses\b|\/responses\?/.test(url);
    });
    expect(responsesCall, 'Responses API POST must have been called').toBeDefined();
    const body = JSON.parse((responsesCall![1] as RequestInit).body as string);
    expect(Array.isArray(body.input), 'request body must carry input[]').toBe(true);

    // The fix: function_call entry with call_id 'call_abc123' must be in input[]
    // so the function_call_output that follows can pair against it.
    const functionCallItem = body.input.find(
      (i: any) => i?.type === 'function_call' && i?.call_id === 'call_abc123',
    );
    expect(
      functionCallItem,
      'assistant.tool_calls[0] must be replayed as function_call item with matching call_id',
    ).toBeDefined();
    expect(functionCallItem.name).toBe('azure_list_subscriptions');

    // And the function_call_output for the same call_id must NOT have been
    // dropped by the orphan guard (which would log the warn).
    const functionCallOutput = body.input.find(
      (i: any) => i?.type === 'function_call_output' && i?.call_id === 'call_abc123',
    );
    expect(
      functionCallOutput,
      'function_call_output must survive orphan-filter when paired with function_call',
    ).toBeDefined();
  });
});
