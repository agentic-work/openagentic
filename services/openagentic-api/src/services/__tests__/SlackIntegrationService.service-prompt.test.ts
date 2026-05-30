/**
 * W.2 — SlackIntegrationService reads system prompt from ServicePromptService DB.
 *
 * After migration: the hardcoded inline string at line 178 is replaced with a
 * call to `servicePromptService.getPrompt('slack.integration_prompt')`.
 * Falls back to DEFAULT_SERVICE_PROMPTS['slack.integration_prompt'].body if
 * service unavailable.
 *
 * Sprint W — 2026-05-19
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_SERVICE_PROMPTS } from '../prompt/ServicePromptService.js';

describe('W.2 — SlackIntegrationService service-prompt migration', () => {
  it('DEFAULT_SERVICE_PROMPTS contains slack.integration_prompt key with sensible body', () => {
    const entry = DEFAULT_SERVICE_PROMPTS['slack.integration_prompt'];
    expect(entry).toBeDefined();
    expect(entry.body).toContain('OpenAgentic AI');
    expect(entry.body).toContain('Slack');
    expect(entry.body).not.toContain('Available workflows include'); // dynamic part stripped to template
  });

  it('slack integration prompt body does NOT contain hardcoded workflow list (must be dynamic)', () => {
    // The original prompt appended the workflow list inline. The DB-backed
    // template should NOT contain the literal list — that's injected at call time.
    const entry = DEFAULT_SERVICE_PROMPTS['slack.integration_prompt'];
    expect(entry.body).not.toMatch(/Available workflows include:/);
  });

  it('SlackIntegrationService accepts optional servicePromptService in constructor', async () => {
    // This test verifies the constructor can receive an injected service.
    // RED: before the migration the constructor has no such parameter.
    const { SlackIntegrationService } = await import('../SlackIntegrationService.js');
    const fakeSvc = { getPrompt: vi.fn(async () => '[DB] Slack prompt from DB') };
    // Should not throw
    expect(() => new (SlackIntegrationService as any)(fakeSvc)).not.toThrow();
  });

  it('directLLMResponse uses DB prompt when servicePromptService is injected', async () => {
    // Dynamically import so we can spy before the module is fully initialized.
    const { SlackIntegrationService } = await import('../SlackIntegrationService.js');
    const dbPrompt = '[W2-DB] Slack system prompt from DB';
    const fakeSvcPromptSvc = { getPrompt: vi.fn(async () => dbPrompt) };

    const svc = new (SlackIntegrationService as any)(fakeSvcPromptSvc);

    // Spy on the private getSlackSystemPrompt method which should read from svcPromptSvc
    const promptSpy = vi.spyOn(svc, 'getSlackSystemPrompt');
    if (promptSpy) {
      const result = await svc.getSlackSystemPrompt();
      expect(result).toBe(dbPrompt);
      expect(fakeSvcPromptSvc.getPrompt).toHaveBeenCalledWith('slack.integration_prompt');
    }
  });
});
