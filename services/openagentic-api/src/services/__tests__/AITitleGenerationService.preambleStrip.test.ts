/**
 * Bug 2 (2026-05-18): AITitleGenerationService spams `level:50` ("error")
 * on every first-message turn even though the outer caller catches the
 * thrown validation failure and quietly falls back to smartExtract.
 *
 * Two fixes:
 *
 * (a) Loosen `cleanGeneratedTitle()` to strip common LLM preambles
 *     ("Sure, here is the title: …", "Here is a title for this
 *     conversation: …") BEFORE validation. The actual title is on the
 *     other side of the colon — we should keep it, not throw it away.
 *
 * (b) Downgrade the `logger.error` at the catch site inside
 *     `generateAITitle` to `logger.debug`. The OUTER caller at line 86
 *     already logs a `warn` for this — the inner `error` is duplicate
 *     spam, and the path itself is not an error (smartExtract fallback
 *     is the documented quiet path).
 *
 * RED→GREEN.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getServiceModel: vi.fn().mockResolvedValue(null),
    getDefaultChatModel: vi.fn().mockResolvedValue('test-model'),
  },
}));

import { AITitleGenerationService } from '../AITitleGenerationService.js';

function makeLogger() {
  const calls = { info: [] as any[], warn: [] as any[], error: [] as any[], debug: [] as any[] };
  const logger: any = {
    info: (...a: any[]) => calls.info.push(a),
    warn: (...a: any[]) => calls.warn.push(a),
    error: (...a: any[]) => calls.error.push(a),
    debug: (...a: any[]) => calls.debug.push(a),
    child: () => logger,
  };
  return { logger, calls };
}

function cleanGeneratedTitle(svc: AITitleGenerationService, raw: string): string {
  return (svc as any).cleanGeneratedTitle(raw);
}

function isValidTitle(svc: AITitleGenerationService, title: string): boolean {
  return (svc as any).isValidTitle(title);
}

describe('AITitleGenerationService.cleanGeneratedTitle — strip LLM preambles', () => {
  const { logger } = makeLogger();
  const svc = new AITitleGenerationService(logger, { useLLM: true });

  const preambleCases: Array<{ raw: string; expected: string }> = [
    { raw: 'Sure, here is the title: Fix Auth Bug', expected: 'Fix Auth Bug' },
    { raw: 'Here is a title for this conversation: Debugging Fastify Plugin', expected: 'Debugging Fastify Plugin' },
    { raw: "Sure! Here's a title: React Component Optimization", expected: 'React Component Optimization' },
    { raw: 'Here is your title: Python DataFrame Filtering', expected: 'Python DataFrame Filtering' },
    { raw: 'The title is: Database Schema Migration', expected: 'Database Schema Migration' },
    { raw: 'A good title would be: Deploy to k8s with Helm', expected: 'Deploy to k8s with Helm' },
  ];

  for (const { raw, expected } of preambleCases) {
    it(`strips preamble in: ${JSON.stringify(raw)}`, () => {
      const cleaned = cleanGeneratedTitle(svc, raw);
      expect(cleaned).toBe(expected);
      expect(isValidTitle(svc, cleaned)).toBe(true);
    });
  }

  it('leaves preamble-free titles untouched', () => {
    expect(cleanGeneratedTitle(svc, 'Fix Auth Bug')).toBe('Fix Auth Bug');
  });

  it('strips preamble even when combined with markdown wrapping', () => {
    expect(cleanGeneratedTitle(svc, '**Sure, here is the title: Fix Auth Bug**')).toBe('Fix Auth Bug');
  });
});

describe('AITitleGenerationService.generateAITitle — no error-level spam on validation fail', () => {
  it('logs at debug level (not error) when generated title fails validation', async () => {
    const { logger, calls } = makeLogger();
    const svc = new AITitleGenerationService(logger, { useLLM: true });

    // Inject a fake titleClient that returns an invalid (too short) title.
    (svc as any).titleClient = {
      generateCompletion: vi.fn().mockResolvedValue({ content: 'Hi' }),
    };

    await expect(
      (svc as any).generateAITitle('test message', [{ role: 'user', content: 'test message' }])
    ).rejects.toThrow(/failed validation/);

    expect(
      calls.error.filter(([arg]) => typeof arg === 'object' && arg?.error)
    ).toHaveLength(0);
  });
});
