/**
 * Regression for the admin "Test provider" 400 with codex/pro/o-pro models:
 *
 *   azure-ai-foundry-prod: AIF API error: 400 Bad Request -
 *   { "error": { "message": "The requested operation is unsupport[ed]" } }
 *
 * Root cause: streamCompletion() correctly branches via shouldUseResponsesApi()
 * and routes to /openai/v1/responses?api-version=preview for the codex/pro/o-pro
 * deployments. nonStreamCompletion() did NOT have that branch — it always hit
 * /openai/deployments/<dep>/chat/completions, which Azure rejects for those
 * models. The admin "Test provider" button calls createCompletion({ stream:false }),
 * so the test always 400'd for those deployments.
 *
 * Fix: add nonStreamResponsesApi() and branch in nonStreamCompletion() the
 * same way streamCompletion() does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { AzureAIFoundryProvider } from '../AzureAIFoundryProvider.js';

const silentLogger = pino({ level: 'silent' });

describe('AzureAIFoundryProvider — non-stream Responses API branching', () => {
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

  it('non-stream test of gpt-5-pro routes to /openai/v1/responses, not /chat/completions', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'resp_test',
          model: 'gpt-5-pro',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'hello world' }],
            },
          ],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const provider = new AzureAIFoundryProvider(silentLogger, {
      endpointUrl: 'https://example.cognitiveservices.azure.com',
      apiKey: 'test-key',
      model: 'gpt-5-pro',
    });

    const result = await provider.createCompletion({
      model: 'gpt-5-pro',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
      stream: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callUrl = fetchMock.mock.calls[0][0] as string;
    expect(callUrl).toContain('/openai/v1/responses');
    expect(callUrl).toContain('api-version=preview');
    expect(callUrl).not.toContain('/chat/completions');

    // Returned shape must be the OpenAI-style CompletionResponse so callers
    // (admin /llm-providers/:name/test) don't need to branch.
    expect((result as any).choices?.[0]?.message?.content).toBe('hello world');
    expect((result as any).usage?.prompt_tokens).toBe(4);
    expect((result as any).usage?.completion_tokens).toBe(2);
  });

  it('non-stream of gpt-5-codex (matches *-codex pattern) also routes to Responses API', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'resp_codex',
          model: 'gpt-5-codex',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'def fn(): pass' }],
            },
          ],
          usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
        }),
        { status: 200 }
      )
    );

    const provider = new AzureAIFoundryProvider(silentLogger, {
      endpointUrl: 'https://example.cognitiveservices.azure.com',
      apiKey: 'test-key',
      model: 'gpt-5-codex',
    });

    const result = await provider.createCompletion({
      model: 'gpt-5-codex',
      messages: [{ role: 'user', content: 'write a fn' }],
      stream: false,
    });

    const callUrl = fetchMock.mock.calls[0][0] as string;
    expect(callUrl).toContain('/openai/v1/responses');
    expect((result as any).choices?.[0]?.message?.content).toBe('def fn(): pass');
  });

  it('non-stream of plain gpt-4o still uses /chat/completions (no regression)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'cmpl_test',
          model: 'gpt-4o',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        }),
        { status: 200 }
      )
    );

    const provider = new AzureAIFoundryProvider(silentLogger, {
      endpointUrl: 'https://example.cognitiveservices.azure.com',
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    await provider.createCompletion({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });

    const callUrl = fetchMock.mock.calls[0][0] as string;
    expect(callUrl).toContain('/chat/completions');
    expect(callUrl).not.toContain('/openai/v1/responses');
  });

  it('non-stream Responses API translates function_call output items into tool_calls', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'resp_tool',
          model: 'gpt-5-pro',
          output: [
            {
              type: 'function_call',
              call_id: 'call_abc',
              name: 'get_weather',
              arguments: '{"city":"Austin"}',
            },
          ],
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        }),
        { status: 200 }
      )
    );

    const provider = new AzureAIFoundryProvider(silentLogger, {
      endpointUrl: 'https://example.cognitiveservices.azure.com',
      apiKey: 'test-key',
      model: 'gpt-5-pro',
    });

    const result = await provider.createCompletion({
      model: 'gpt-5-pro',
      messages: [{ role: 'user', content: 'weather?' }],
      tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
      stream: false,
    });

    const choice = (result as any).choices?.[0];
    expect(choice?.finish_reason).toBe('tool_calls');
    expect(choice?.message?.tool_calls?.[0]).toMatchObject({
      id: 'call_abc',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"Austin"}' },
    });
  });
});
