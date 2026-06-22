/**
 * W.3 — AITitleGenerationService + TitleGenerationClient read prompts from ServicePromptService.
 *
 * After migration:
 *   - AITitleGenerationService.createTitleGenerationPrompt() reads from DB key 'title_gen.ai_service'
 *   - TitleGenerationClient.generateMultipleTitles() reads from DB key 'title_gen.client'
 *   - Both fall back to DEFAULT_SERVICE_PROMPTS defaults when DB unavailable
 *
 * Sprint W — 2026-05-19
 */
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SERVICE_PROMPTS } from '../prompt/ServicePromptService.js';

describe('W.3 — Title generation service-prompt migration', () => {
  it('DEFAULT_SERVICE_PROMPTS contains title_gen.ai_service key', () => {
    const entry = DEFAULT_SERVICE_PROMPTS['title_gen.ai_service'];
    expect(entry).toBeDefined();
    expect(entry.body).toContain('title generator');
    expect(entry.body).toContain('Return ONLY the title');
  });

  it('DEFAULT_SERVICE_PROMPTS contains title_gen.client key', () => {
    const entry = DEFAULT_SERVICE_PROMPTS['title_gen.client'];
    expect(entry).toBeDefined();
    expect(entry.body).toContain('title');
    expect(entry.body.length).toBeGreaterThan(10);
  });

  it('AITitleGenerationService exposes getTitleGenerationPrompt(servicePromptSvc) method', async () => {
    const { AITitleGenerationService } = await import('../AITitleGenerationService.js');
    const dbPrompt = '[W3-DB] title ai service prompt';
    const fakeSvcPromptSvc = { getPrompt: vi.fn(async () => dbPrompt) };

    const fakeLogger = { child: () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }) };
    const svc = new AITitleGenerationService(fakeLogger as any, {});
    expect(typeof (svc as any).getTitleGenerationPrompt).toBe('function');
    const result = await (svc as any).getTitleGenerationPrompt(fakeSvcPromptSvc);
    expect(result).toBe(dbPrompt);
    expect(fakeSvcPromptSvc.getPrompt).toHaveBeenCalledWith('title_gen.ai_service');
  });

  it('AITitleGenerationService.getTitleGenerationPrompt falls back to DEFAULT when no svc', async () => {
    const { AITitleGenerationService } = await import('../AITitleGenerationService.js');
    const fakeLogger = { child: () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }) };
    const svc = new AITitleGenerationService(fakeLogger as any, {});
    const result = await (svc as any).getTitleGenerationPrompt(undefined);
    expect(result).toContain('title generator');
  });

  it('TitleGenerationClient exposes getMultipleTitlesPrompt(servicePromptSvc) method', async () => {
    const { TitleGenerationClient } = await import('../TitleGenerationClient.js');
    const dbPrompt = '[W3-DB] title client prompt';
    const fakeSvcPromptSvc = { getPrompt: vi.fn(async () => dbPrompt) };

    const fakeLogger = { child: () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }) };
    const client = new TitleGenerationClient(fakeLogger as any, {});
    expect(typeof (client as any).getMultipleTitlesPrompt).toBe('function');
    const result = await (client as any).getMultipleTitlesPrompt(fakeSvcPromptSvc);
    expect(result).toBe(dbPrompt);
    expect(fakeSvcPromptSvc.getPrompt).toHaveBeenCalledWith('title_gen.client');
  });
});
