/**
 * W.4 — CodeModeSessionService reads compaction system prompt from ServicePromptService DB.
 *
 * After migration: the hardcoded inline system string
 * ('You are a helpful assistant that summarizes coding conversations concisely.')
 * is replaced with a DB read via key 'codemode.summary_prompt'.
 *
 * Sprint W — 2026-05-19
 */
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SERVICE_PROMPTS } from '../prompt/ServicePromptService.js';

describe('W.4 — CodeModeSessionService service-prompt migration', () => {
  it('DEFAULT_SERVICE_PROMPTS contains codemode.summary_prompt key', () => {
    const entry = DEFAULT_SERVICE_PROMPTS['codemode.summary_prompt'];
    expect(entry).toBeDefined();
    expect(entry.body.length).toBeGreaterThan(10);
    expect(entry.body.toLowerCase()).toContain('summar');
  });

  it('CodeModeSessionService exposes getSummarySystemPrompt(servicePromptSvc) method', async () => {
    // Dynamic import to avoid module-level side effects
    const { CodeModeSessionService } = await import('../CodeModeSessionService.js');
    const dbPrompt = '[W4-DB] codemode summary system prompt';
    const fakeSvcPromptSvc = { getPrompt: vi.fn(async () => dbPrompt) };

    // Create minimal mock deps
    const fakeLogger = { child: () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }), warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    const svc = new (CodeModeSessionService as any)(fakeLogger, null, null);

    expect(typeof (svc as any).getSummarySystemPrompt).toBe('function');
    const result = await (svc as any).getSummarySystemPrompt(fakeSvcPromptSvc);
    expect(result).toBe(dbPrompt);
    expect(fakeSvcPromptSvc.getPrompt).toHaveBeenCalledWith('codemode.summary_prompt');
  });

  it('getSummarySystemPrompt falls back to DEFAULT when no svc provided', async () => {
    const { CodeModeSessionService } = await import('../CodeModeSessionService.js');
    const fakeLogger = { child: () => ({ warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }), warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    const svc = new (CodeModeSessionService as any)(fakeLogger, null, null);

    const result = await (svc as any).getSummarySystemPrompt(undefined);
    expect(result).toContain('summar');
  });
});
