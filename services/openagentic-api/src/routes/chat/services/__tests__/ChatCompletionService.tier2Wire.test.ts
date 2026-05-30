/**
 * Chat path → LLMMetricsService.logRequest() wire (2026-05-08).
 *
 * The Azure OpenAI direct path in ChatCompletionService records token usage
 * via TokenUsageService but does NOT (yet) write to the rich LLMRequestLog
 * fact table. That's the gap that keeps the dashboard's LLM Performance
 * tab dim. This spec covers the wire-up: when the non-streaming response
 * lands, ChatCompletionService.trackTokenUsageFromResponse must call
 * llmMetricsService.logRequest with provider/model/usage/finish_reason
 * mapped from the Azure OpenAI response shape.
 *
 * The downstream emit (Prom + DB) is already covered by
 * LLMMetricsService.tier1Prom.test.ts — here we verify only the call.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock factories are hoisted to the top of the file; using vi.hoisted()
// lets us share fn references between the factory and the test body.
const { recordUsageMock, logRequestMock } = vi.hoisted(() => ({
  recordUsageMock: vi.fn(async () => undefined),
  logRequestMock: vi.fn(async () => 'log-id'),
}));

vi.mock('../../../../utils/prisma.js', () => ({
  prisma: {
    lLMRequestLog: { create: vi.fn(async ({ data }: any) => ({ id: 'log-id', ...data })) },
  },
}));

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn().mockImplementation(() => ({
    getToken: vi.fn(async () => ({ token: 'fake-token' })),
  })),
}));

vi.mock('../../../../services/TokenUsageService.js', () => ({
  TokenUsageService: vi.fn().mockImplementation(() => ({
    recordUsage: recordUsageMock,
  })),
}));

vi.mock('../../../../services/TaskAnalysisService.js', () => ({
  TaskAnalysisService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../../services/ModelCapabilitiesService.js', () => ({
  ExtendedCapabilitiesService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../../services/DynamicModelSelector.js', () => ({
  DynamicModelSelector: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../../services/IntelligentModelRouter.js', () => ({
  IntelligentModelRouter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../../services/LLMMetricsService.js', () => ({
  llmMetricsService: { logRequest: logRequestMock },
  LLMMetricsService: { getInstance: () => ({ logRequest: logRequestMock }) },
}));

import pino from 'pino';
import { ChatCompletionService } from '../ChatCompletionService.js';

const SILENT = pino({ level: 'silent' });

beforeEach(() => {
  recordUsageMock.mockClear();
  logRequestMock.mockClear();
  // Required env so the constructor takes the happy path.
  process.env.AZURE_OPENAI_ENDPOINT = 'https://stub.example.com/';
  process.env.AZURE_TENANT_ID = 'stub-tenant';
  process.env.AZURE_CLIENT_ID = 'stub-client';
  process.env.AZURE_CLIENT_SECRET = 'stub-secret';
});

function makeAzureResponse(overrides: any = {}) {
  return {
    model: 'gpt-4o',
    choices: [{ finish_reason: 'stop', message: { content: 'hi' } }],
    usage: {
      prompt_tokens: 1500,
      completion_tokens: 250,
      total_tokens: 1750,
      prompt_tokens_details: { cached_tokens: 800 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
    system_fingerprint: 'fp_xyz123',
    service_tier: 'default',
    ...overrides,
  };
}

describe('ChatCompletionService.trackTokenUsageFromResponse → llmMetricsService.logRequest', () => {
  it('calls logRequest with provider/model/tokens mapped from Azure response', async () => {
    const svc = new ChatCompletionService(SILENT) as any;
    const response = makeAzureResponse();
    await svc.trackTokenUsageFromResponse(response, {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
    });

    expect(logRequestMock).toHaveBeenCalledTimes(1);
    const args = logRequestMock.mock.calls[0][0] as any;
    expect(args.providerType).toBe('azure-openai');
    expect(args.model).toBe('gpt-4o');
    expect(args.requestType).toBe('chat');
    expect(args.source).toBe('chat');
    expect(args.streaming).toBe(false);
    expect(args.promptTokens).toBe(1500);
    expect(args.completionTokens).toBe(250);
    expect(args.totalTokens).toBe(1750);
    expect(args.cachedTokens).toBe(800);
    expect(args.userId).toBe('u1');
    expect(args.sessionId).toBe('s1');
    expect(args.messageId).toBe('m1');
    expect(args.finishReason).toBe('stop');
    expect(args.status).toBe('success');
  });

  it('forwards system_fingerprint + service_tier into providerMetadata', async () => {
    const svc = new ChatCompletionService(SILENT) as any;
    await svc.trackTokenUsageFromResponse(makeAzureResponse(), {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
    });
    const args = logRequestMock.mock.calls[0][0] as any;
    expect(args.providerMetadata).toEqual(
      expect.objectContaining({
        system_fingerprint: 'fp_xyz123',
        service_tier: 'default',
      }),
    );
  });

  it('forwards timeToFirstTokenMs when caller supplies it', async () => {
    const svc = new ChatCompletionService(SILENT) as any;
    await svc.trackTokenUsageFromResponse(makeAzureResponse(), {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      timeToFirstTokenMs: 540,
    });
    const args = logRequestMock.mock.calls[0][0] as any;
    expect(args.timeToFirstTokenMs).toBe(540);
  });

  it('still calls TokenUsageService.recordUsage (legacy ledger preserved)', async () => {
    const svc = new ChatCompletionService(SILENT) as any;
    await svc.trackTokenUsageFromResponse(makeAzureResponse(), {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
    });
    expect(recordUsageMock).toHaveBeenCalledTimes(1);
  });

  it('does not call logRequest when response.usage is missing', async () => {
    const svc = new ChatCompletionService(SILENT) as any;
    await svc.trackTokenUsageFromResponse(
      { model: 'gpt-4o', choices: [{ finish_reason: 'stop' }] }, // no usage
      { userId: 'u1', sessionId: 's1', messageId: 'm1' },
    );
    expect(logRequestMock).not.toHaveBeenCalled();
  });
});
