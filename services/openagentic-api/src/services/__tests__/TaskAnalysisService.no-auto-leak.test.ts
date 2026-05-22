/**
 * Pin: TaskAnalysisService MUST NEVER return suggestedModel='auto' to downstream
 * callers. The 'auto' sentinel was being passed through to ProviderManager,
 * which rejected it with `Model "auto" is not available — no enabled provider
 * serves it`, breaking every workflow LLM node.
 *
 * Smart Router resolution must happen INSIDE TaskAnalysisService, not at some
 * mythical downstream stage that doesn't exist. For simple prompts, fall back
 * to the registered default chat model just like the moderate/complex branches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { TaskAnalysisService } from '../TaskAnalysisService.js';

describe('TaskAnalysisService — never leak "auto" sentinel', () => {
  let svc: TaskAnalysisService;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const fakeLogger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    svc = new TaskAnalysisService(fakeLogger);
    spy = vi.spyOn(ModelConfigurationService, 'getDefaultChatModel');
    spy.mockResolvedValue('claude-sonnet-4-6');
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('simple prompt without explicit model → suggestedModel is a real model id, NOT "auto"', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'Say hello in 1 sentence.' }],
      hasImages: false,
    });
    expect(result.suggestedModel).toBeDefined();
    expect(result.suggestedModel).not.toBe('auto');
    expect(result.suggestedModel).not.toBe('model-router');
  });

  it('moderate prompt → suggestedModel is a real model id', async () => {
    const result = await svc.analyzeTask({
      messages: [
        { role: 'user', content: 'Analyze the architectural tradeoffs between microservices and a monolith for our use case, considering deployment, observability, and team topology.' },
      ],
      hasImages: false,
    });
    expect(result.suggestedModel).not.toBe('auto');
    expect(result.suggestedModel).not.toBe('model-router');
  });

  it('explicit requestedModel passes through unchanged (not "auto")', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'hi' }],
      hasImages: false,
      requestedModel: 'claude-opus-4',
    });
    expect(result.suggestedModel).toBe('claude-opus-4');
  });

  it('requestedModel="auto" must not pass through — should resolve to a real id', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'hi' }],
      hasImages: false,
      requestedModel: 'auto',
    });
    expect(result.suggestedModel).not.toBe('auto');
  });

  it('requestedModel="model-router" must not pass through — should resolve to a real id', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'hi' }],
      hasImages: false,
      requestedModel: 'model-router',
    });
    expect(result.suggestedModel).not.toBe('model-router');
    expect(result.suggestedModel).not.toBe('auto');
  });
});
