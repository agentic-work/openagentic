import { describe, it, expect } from 'vitest';
import { extractOllamaBaseUrl } from '../extractOllamaBaseUrl.js';

describe('extractOllamaBaseUrl', () => {
  it('reads provider_config.baseUrl first', () => {
    const p = { provider_config: { baseUrl: 'http://pc.example:11434' }, auth_config: { baseUrl: 'http://ac.example:11434' } };
    expect(extractOllamaBaseUrl(p)).toBe('http://pc.example:11434');
  });
  it('falls through to auth_config.baseUrl when provider_config absent', () => {
    const p = { provider_config: {}, auth_config: { baseUrl: 'http://ac.example:11434' } };
    expect(extractOllamaBaseUrl(p)).toBe('http://ac.example:11434');
  });
  it('falls through to auth_config.endpoint when no baseUrl', () => {
    const p = { provider_config: {}, auth_config: { endpoint: 'http://endpoint.example:11434' } };
    expect(extractOllamaBaseUrl(p)).toBe('http://endpoint.example:11434');
  });
  it('throws when all sources are empty', () => {
    expect(() => extractOllamaBaseUrl({ provider_config: {}, auth_config: {} })).toThrow(/no Ollama base URL/i);
  });
  it('reads provider_config.host as a third option', () => {
    const p = { provider_config: { host: 'http://host.example:11434' }, auth_config: {} };
    expect(extractOllamaBaseUrl(p)).toBe('http://host.example:11434');
  });
  it('does NOT contain a localhost literal fallback', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(new URL('../extractOllamaBaseUrl.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/localhost:11434/);
    expect(src).not.toMatch(/['"`]http:\/\/ollama:11434['"`]/);
  });
});
