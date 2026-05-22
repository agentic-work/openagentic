/**
 * Pins that TaskAnalysisService delegates its default-model pick to
 * ModelConfigurationService.getDefaultChatModel() (Registry SoT) and
 * NEVER falls through to process.env.DEFAULT_MODEL / DEFAULT_CHAT_MODEL.
 * Part of the 2026-04-23 "kill env-var fallbacks in chat path" fix.
 *
 * Uses vi.spyOn on the real singleton instead of vi.mock on the whole
 * module so we do NOT replace the module in Node's cache. The prior
 * vi.mock approach leaked a partial stub (lacking `refresh()`) into
 * neighbouring test files that run in the same bun-test worker and
 * expect the full ModelConfigurationService API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { TaskAnalysisService } from '../TaskAnalysisService.js';

describe('TaskAnalysisService.getDefaultModel — Registry-role delegation', () => {
  let svc: TaskAnalysisService;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const fakeLogger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    svc = new TaskAnalysisService(fakeLogger);
    spy = vi.spyOn(ModelConfigurationService, 'getDefaultChatModel');
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('returns whatever ModelConfigurationService.getDefaultChatModel resolves with', async () => {
    spy.mockResolvedValueOnce('us.anthropic.claude-sonnet-4-6');

    const picked = await (svc as any).getDefaultModel();

    expect(picked).toBe('us.anthropic.claude-sonnet-4-6');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('does NOT fall back to process.env.DEFAULT_MODEL when getDefaultChatModel throws', async () => {
    process.env.DEFAULT_MODEL = 'should-never-be-used:latest';
    spy.mockRejectedValueOnce(new Error('Registry empty'));
    try {
      await expect((svc as any).getDefaultModel()).rejects.toThrow(/Registry empty|No chat model/);
    } finally {
      delete process.env.DEFAULT_MODEL;
    }
  });

  it('does NOT fall back to process.env.DEFAULT_CHAT_MODEL either', async () => {
    process.env.DEFAULT_CHAT_MODEL = 'ollama/gpt-oss:20b';
    spy.mockRejectedValueOnce(new Error('Registry empty'));
    try {
      await expect((svc as any).getDefaultModel()).rejects.toThrow(/Registry empty|No chat model/);
    } finally {
      delete process.env.DEFAULT_CHAT_MODEL;
    }
  });
});
