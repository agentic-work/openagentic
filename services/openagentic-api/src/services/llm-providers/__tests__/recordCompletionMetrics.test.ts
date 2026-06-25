/**
 * recordCompletionMetrics — pure helper that maps a CompletionResponse
 * into LLMRequestMetrics + calls llmMetricsService.logRequest.
 *
 * The seam ProviderManager.executeCompletion delegates to AFTER a
 * successful provider.createCompletion, so non-streaming chat traffic
 * (Ollama, Anthropic, Bedrock, Vertex, etc.) all populate gen_ai_*
 * Prom metrics + LLMRequestLog the same way the Azure-direct chat
 * path now does (commit edb4bf9c).
 *
 * 5 tests:
 *  1. extracts usage + model + finish_reason from CompletionResponse
 *  2. derives totalDurationMs from startedAt → now
 *  3. forwards Anthropic-shaped cached/reasoning fields when present
 *  4. error path — calls logRequest with status='error' + classified errorClass
 *  5. tolerates missing usage gracefully (still records duration)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { logRequestMock } = vi.hoisted(() => ({
  logRequestMock: vi.fn(async () => 'log-id'),
}));

vi.mock('../../LLMMetricsService.js', () => ({
  llmMetricsService: { logRequest: logRequestMock },
}));

import {
  recordCompletionMetrics,
  classifyCompletionError,
} from '../recordCompletionMetrics.js';

beforeEach(() => {
  logRequestMock.mockClear();
});

describe('recordCompletionMetrics — success path', () => {
  it('maps usage + model + finish_reason into logRequest args', async () => {
    const startedAt = new Date(Date.now() - 1500); // 1.5s ago
    await recordCompletionMetrics({
      response: {
        id: 'resp-1',
        object: 'chat.completion',
        created: Date.now() / 1000,
        model: 'gpt-oss:20b',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello there, nice to meet' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
      } as any,
      providerName: 'ollama-hal',
      providerType: 'ollama',
      startedAt,
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      streaming: false,
    });

    expect(logRequestMock).toHaveBeenCalledTimes(1);
    const args = logRequestMock.mock.calls[0][0] as any;
    expect(args.providerType).toBe('ollama');
    expect(args.providerName).toBe('ollama-hal');
    expect(args.model).toBe('gpt-oss:20b');
    expect(args.requestType).toBe('chat');
    expect(args.streaming).toBe(false);
    expect(args.promptTokens).toBe(30);
    expect(args.completionTokens).toBe(8);
    expect(args.totalTokens).toBe(38);
    expect(args.finishReason).toBe('stop');
    expect(args.status).toBe('success');
    expect(args.userId).toBe('u1');
    // Duration should be ~1500ms; allow 200ms drift for test timing
    expect(args.totalDurationMs).toBeGreaterThanOrEqual(1400);
    expect(args.totalDurationMs).toBeLessThanOrEqual(2000);
  });

  it('forwards Anthropic-shaped cached + reasoning fields when present', async () => {
    const startedAt = new Date();
    await recordCompletionMetrics({
      response: {
        id: 'resp-2',
        object: 'chat.completion',
        created: Date.now() / 1000,
        model: 'claude-sonnet-4',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '...' },
          finish_reason: 'end_turn',
        }],
        usage: {
          prompt_tokens: 800,
          completion_tokens: 200,
          total_tokens: 1000,
          // Anthropic-on-Bedrock SDK normalizes cache_read into cached_tokens
          // and reasoning into completion_tokens_details.reasoning_tokens.
          cached_tokens: 600,
          completion_tokens_details: { reasoning_tokens: 50 },
        } as any,
      } as any,
      providerName: 'anthropic-prod',
      providerType: 'anthropic',
      startedAt,
    });

    const args = logRequestMock.mock.calls[0][0] as any;
    expect(args.cachedTokens).toBe(600);
    expect(args.reasoningTokens).toBe(50);
    expect(args.finishReason).toBe('end_turn');
  });
});

describe('recordCompletionMetrics — error path', () => {
  it('records status=error + classified errorClass when called from a catch block', async () => {
    const startedAt = new Date();
    await recordCompletionMetrics({
      providerName: 'azure-openai-prod',
      providerType: 'azure-openai',
      model: 'gpt-4o',
      startedAt,
      error: new Error('Request timed out'),
    });

    expect(logRequestMock).toHaveBeenCalledTimes(1);
    const args = logRequestMock.mock.calls[0][0] as any;
    expect(args.status).toBe('error');
    expect(args.errorClass).toBe('timeout');
    expect(args.providerType).toBe('azure-openai');
    expect(args.model).toBe('gpt-4o');
    // No usage on error — completionTokens/promptTokens absent
    expect(args.completionTokens).toBeUndefined();
  });

  it('tolerates missing usage gracefully on success path (still emits duration)', async () => {
    const startedAt = new Date();
    await recordCompletionMetrics({
      response: {
        id: 'resp-no-usage',
        object: 'chat.completion',
        created: Date.now() / 1000,
        model: 'gpt-oss:20b',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
        // usage absent (some providers omit it on streaming or non-final chunks)
      } as any,
      providerName: 'ollama-hal',
      providerType: 'ollama',
      startedAt,
    });

    expect(logRequestMock).toHaveBeenCalledTimes(1);
    const args = logRequestMock.mock.calls[0][0] as any;
    expect(args.status).toBe('success');
    expect(args.model).toBe('gpt-oss:20b');
    expect(args.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(args.promptTokens).toBeUndefined();
    expect(args.completionTokens).toBeUndefined();
  });
});

describe('classifyCompletionError', () => {
  it('classifies common error shapes', () => {
    expect(classifyCompletionError(new Error('Request timed out'))).toBe('timeout');
    expect(classifyCompletionError(new Error('429 Too Many Requests'))).toBe('rate_limit');
    expect(classifyCompletionError(new Error('rate limit exceeded'))).toBe('rate_limit');
    expect(classifyCompletionError({ status: 429 } as any)).toBe('rate_limit');
    expect(classifyCompletionError({ status: 500 } as any)).toBe('server_error');
    expect(classifyCompletionError({ status: 401 } as any)).toBe('client_error');
    expect(classifyCompletionError(new Error('ECONNREFUSED'))).toBe('network');
    expect(classifyCompletionError(new Error('something weird'))).toBe('unknown');
  });
});
