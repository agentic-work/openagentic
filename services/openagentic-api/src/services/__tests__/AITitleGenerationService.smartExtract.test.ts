/**
 * #318 — smartExtractTitle must produce sensible titles, not garbage like
 * "Can Send to the Cto" for the prompt "Can you send to the CTO?"
 *
 * Two bugs in AITitleGenerationService:
 * 1. extractKeyPhrases (line 229) Questions pattern captures the leading
 *    question word ("can/what/how/why") via match[0], leaking it into the
 *    title head. Should capture only the meaningful phrase (group 2).
 * 2. capitalizePhrase (line 337-338) detects all-uppercase tokens via
 *    `word.toUpperCase() === word` but then forces them through
 *    `charAt(0).toUpperCase() + slice(1).toLowerCase()` — destroying
 *    acronyms ("CTO" → "Cto", "API" → "Api", "SQL" → "Sql").
 *
 * Both bugs fire on the smart-extraction fallback path (when LLM title
 * generation is unavailable or returns invalid output).
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

function smartExtractTitle(svc: AITitleGenerationService, content: string): string {
  return (svc as any).smartExtractTitle(content);
}

function capitalizePhrase(svc: AITitleGenerationService, phrase: string): string {
  return (svc as any).capitalizePhrase(phrase);
}

describe('#318 — smartExtractTitle bug fixes', () => {
  // Use LLM=false so we exercise the smartExtract path deterministically.
  const svc = new AITitleGenerationService(silentLogger as any, { useLLM: false });

  it('does not put question-starter words ("can"/"what"/"how") at the head of the title', async () => {
    const t = smartExtractTitle(svc, 'Can you send to the CTO?');
    // Old buggy output: "Can Send to the Cto"
    expect(t.toLowerCase()).not.toMatch(/^can\b/i);
    expect(t.toLowerCase()).not.toMatch(/^how\b/i);
    expect(t.toLowerCase()).not.toMatch(/^what\b/i);
  });

  it('preserves all-uppercase acronyms verbatim (CTO/API/SQL/AWS)', () => {
    expect(capitalizePhrase(svc, 'send to the CTO')).toContain('CTO');
    expect(capitalizePhrase(svc, 'fix the API endpoint')).toContain('API');
    expect(capitalizePhrase(svc, 'optimize SQL query')).toContain('SQL');
    expect(capitalizePhrase(svc, 'deploy to AWS')).toContain('AWS');
    // Mixed-case words still title-cased
    expect(capitalizePhrase(svc, 'fix the api endpoint')).toBe('Fix the Api Endpoint');
  });

  it('produces a sensible title for the original "Can you send to the CTO?" prompt', () => {
    const t = smartExtractTitle(svc, 'Can you send to the CTO?');
    // Acronym preserved; question-starter dropped.
    expect(t).toContain('CTO');
    expect(t.toLowerCase().startsWith('can')).toBe(false);
  });
});
