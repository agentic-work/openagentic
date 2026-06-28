/**
 * RED-first TDD: isValidTitle must accept standard real-world LLM outputs.
 *
 * Bug: live pod log:
 *   {"err":{"message":"Generated title failed validation"},"msg":"AI title generation failed"}
 * Fires on every first-message turn — LLM call is wasted, smart-extract fallback runs.
 *
 * Root cause: the validation rejects titles containing colons, hyphens, brackets,
 * apostrophes, and other common punctuation that LLMs naturally produce.
 * Also: cleanGeneratedTitle does not strip markdown bold (**) markers, so a
 * model that wraps output in ** produces a title that fails the bracket check or
 * the special-char check.
 *
 * Fix: loosen isValidTitle to accept typical punctuation (: - ' , / .) and
 *      update cleanGeneratedTitle to strip markdown markers (**text** → text).
 * Preserve: max 100 chars, min 3 chars, no control chars, not only digits.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getServiceModel: vi.fn().mockResolvedValue(null),
    getDefaultChatModel: vi.fn().mockResolvedValue('test-model'),
  },
}));

import { AITitleGenerationService } from '../AITitleGenerationService.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => silentLogger,
} as any;

// Access private method via type cast
function isValidTitle(svc: AITitleGenerationService, title: string): boolean {
  return (svc as any).isValidTitle(title);
}

function cleanGeneratedTitle(svc: AITitleGenerationService, title: string): string {
  return (svc as any).cleanGeneratedTitle(title);
}

describe('AITitleGenerationService — isValidTitle accepts real-world LLM outputs', () => {
  const svc = new AITitleGenerationService(silentLogger as any, { useLLM: true });

  // These SHOULD pass — real-world LLM title outputs
  const validTitles = [
    'Debugging Fastify plugin: a step-by-step guide',
    'Why is my code so slow?',
    'Explain async/await',
    "Python's DataFrame Filtering",
    'React/Vue component migration',
    'Fix auth error — token expired',
    'Database schema: users & roles',
    'Deploy to k8s with Helm',
    'Quick SQL query optimization',
    '¿Cómo funciona async/await?',
    'Setting up CI/CD pipeline',
    'Résumé formatting tips',
  ];

  for (const title of validTitles) {
    it(`accepts: ${JSON.stringify(title)}`, () => {
      expect(isValidTitle(svc, title)).toBe(true);
    });
  }

  // These SHOULD still fail
  it('rejects empty string', () => {
    expect(isValidTitle(svc, '')).toBe(false);
  });

  it('rejects too-short title (< 3 chars)', () => {
    expect(isValidTitle(svc, 'Hi')).toBe(false);
  });

  it('rejects obvious AI preamble "Sure, here is..."', () => {
    expect(isValidTitle(svc, 'Sure, here is your title')).toBe(false);
  });

  it('rejects title that is only digits', () => {
    expect(isValidTitle(svc, '12345')).toBe(false);
  });

  it('rejects bare "conversation" (exact match)', () => {
    expect(isValidTitle(svc, 'conversation')).toBe(false);
  });
});

describe('AITitleGenerationService — cleanGeneratedTitle strips markdown markers', () => {
  const svc = new AITitleGenerationService(silentLogger as any, { useLLM: true });

  it('strips markdown bold markers (**text**)', () => {
    const cleaned = cleanGeneratedTitle(svc, '**Debugging Fastify Plugin**');
    expect(cleaned).toBe('Debugging Fastify Plugin');
    expect(isValidTitle(svc, cleaned)).toBe(true);
  });

  it('strips markdown italic markers (*text*)', () => {
    const cleaned = cleanGeneratedTitle(svc, '*Fix Authentication Error*');
    expect(cleaned).toBe('Fix Authentication Error');
    expect(isValidTitle(svc, cleaned)).toBe(true);
  });
});
