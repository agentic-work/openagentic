/**
 * TDD audit tests for TaskAnalysisService bug fixes:
 *
 * Bug 1: Simple prompts blindly returned tenant default instead of 'auto'
 *        (preventing SmartModelRouter from ever being consulted).
 * Bug 2: cloudOpsPattern over-matched on bare `function` and `resource`,
 *        causing prompts like "make a function to calculate fibonacci"
 *        to be classified as complex cloud-ops.
 *
 * Red-Green cycle: these tests were written BEFORE the fixes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { TaskAnalysisService } from '../TaskAnalysisService.js';

const MOCK_DEFAULT = 'tenant-default-model-xyz';

describe('TaskAnalysisService — audit (Bug 1 + Bug 2)', () => {
  let svc: TaskAnalysisService;
  let defaultModelSpy: ReturnType<typeof vi.spyOn>;
  let configSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const fakeLogger: any = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    svc = new TaskAnalysisService(fakeLogger);

    defaultModelSpy = vi.spyOn(ModelConfigurationService, 'getDefaultChatModel')
      .mockResolvedValue(MOCK_DEFAULT);

    // Mock getConfig so the service doesn't hit the DB
    configSpy = vi.spyOn(ModelConfigurationService, 'getConfig').mockResolvedValue({
      source: 'test',
      defaultModel: { modelId: MOCK_DEFAULT },
      services: {},
    } as any);
  });

  afterEach(() => {
    defaultModelSpy.mockRestore();
    configSpy.mockRestore();
  });

  // ── Bug 1 tests (updated 2026-04-26: no longer leak the 'auto' sentinel) ──
  // Original behavior returned 'auto' for simple prompts on the assumption a
  // downstream stage resolved it via SmartModelRouter — no such resolver
  // existed, so workflow LLM nodes died with HTTP 500. We now resolve to the
  // Registry default in TaskAnalysisService itself, regardless of complexity.

  it('simple prompt ("what\'s 2+2?") → complexity=simple + concrete default model (NOT "auto")', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: "what's 2+2?" }],
    });

    expect(result.complexity).toBe('simple');
    expect(result.suggestedModel).not.toBe('auto');
    expect(result.suggestedModel).toBe(MOCK_DEFAULT);
  });

  it('greeting ("hello") → complexity=simple + concrete default model (NOT "auto")', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.complexity).toBe('simple');
    expect(result.suggestedModel).not.toBe('auto');
    expect(result.suggestedModel).toBe(MOCK_DEFAULT);
  });

  // ── Bug 2 test — bare `function` must NOT trigger cloudOps ──────────────

  it('classifies "make me a function to calculate fibonacci" as simple (not cloud-ops complex)', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'make me a function to calculate fibonacci' }],
    });

    // Must NOT be complex/expert (cloudOps false-positive)
    expect(result.complexity).toBe('simple');
    expect(result.suggestedModel).not.toBe('auto');
  });

  // ── Bug 2 verification — named FaaS terms STILL trigger cloudOps ────────

  it('classifies "deploy a lambda function to us-east-1" as complex (lambda function still matches)', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'deploy a lambda function to us-east-1' }],
    });

    expect(result.complexity).toBe('complex');
  });

  it('classifies "create a VM in azure" as complex (vm still matches cloudOps)', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'create a VM in azure' }],
    });

    expect(result.complexity).toBe('complex');
  });

  it('classifies "audit my cloud resources across subscriptions" as expert with suggestedAgent=cloud_operations', async () => {
    const result = await svc.analyzeTask({
      messages: [{ role: 'user', content: 'audit my cloud resources across subscriptions' }],
    });

    expect(result.complexity).toBe('expert');
    expect(result.suggestedAgent).toBe('cloud_operations');
  });

  // ── Explicit model pin must be honored verbatim ──────────────────────────

  it('honors an explicit model pin — does NOT return "auto"', async () => {
    const result = await svc.analyzeTask({
      requestedModel: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: "what's 2+2?" }],
    });

    expect(result.suggestedModel).toBe('claude-sonnet-4-6');
  });

  // ── AI Builder source forces the tenant default (not auto) ───────────────

  it('AI Builder source returns suggestedModel=<defaultModelId> (not "auto")', async () => {
    const result = await svc.analyzeTask({
      messages: [],
      metadata: { source: 'ai-builder' },
    });

    // AI Builder must get the concrete premium model, never 'auto'
    expect(result.suggestedModel).toBe(MOCK_DEFAULT);
  });
});
