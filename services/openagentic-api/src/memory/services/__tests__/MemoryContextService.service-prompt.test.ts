/**
 * W.5 — MemoryContextService reads fallback system prompts from ServicePromptService DB.
 *
 * After migration:
 *   - systemPrompt in buildResultFromCache uses DB key 'memory.context_system'
 *   - buildSystemPrompt() uses DB key 'memory.context_build'
 *   Both fall back to DEFAULT_SERVICE_PROMPTS defaults when DB unavailable.
 *
 * Sprint W — 2026-05-19
 */
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SERVICE_PROMPTS } from '../../../services/prompt/ServicePromptService.js';

describe('W.5 — MemoryContextService service-prompt migration', () => {
  it('DEFAULT_SERVICE_PROMPTS contains memory.context_system key', () => {
    const entry = DEFAULT_SERVICE_PROMPTS['memory.context_system'];
    expect(entry).toBeDefined();
    expect(entry.body).toContain('helpful AI assistant');
  });

  it('DEFAULT_SERVICE_PROMPTS contains memory.context_build key', () => {
    const entry = DEFAULT_SERVICE_PROMPTS['memory.context_build'];
    expect(entry).toBeDefined();
    expect(entry.body).toContain('helpful AI assistant');
    expect(entry.body).toContain('conversation history');
  });

  it('memory.context_system and memory.context_build are distinct strings', () => {
    const sys = DEFAULT_SERVICE_PROMPTS['memory.context_system'].body;
    const build = DEFAULT_SERVICE_PROMPTS['memory.context_build'].body;
    expect(sys).not.toBe(build);
  });

  it('MemoryContextService exposes getContextSystemPrompt(servicePromptSvc) method', async () => {
    const { MemoryContextService } = await import('../MemoryContextService.js');
    const dbPrompt = '[W5-DB] memory context system';
    const fakeSvcPromptSvc = { getPrompt: vi.fn(async () => dbPrompt) };

    const fakeLogger = { child: () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }), warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    const svc = new (MemoryContextService as any)(fakeLogger, {});

    expect(typeof (svc as any).getContextSystemPrompt).toBe('function');
    const result = await (svc as any).getContextSystemPrompt(fakeSvcPromptSvc, 'context_system');
    expect(result).toBe(dbPrompt);
    expect(fakeSvcPromptSvc.getPrompt).toHaveBeenCalledWith('memory.context_system');
  });

  it('getContextSystemPrompt falls back to DEFAULT when no svc', async () => {
    const { MemoryContextService } = await import('../MemoryContextService.js');
    const fakeLogger = { child: () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }), warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    const svc = new (MemoryContextService as any)(fakeLogger, {});

    const result = await (svc as any).getContextSystemPrompt(undefined, 'context_system');
    expect(result).toContain('helpful AI assistant');
  });
});
