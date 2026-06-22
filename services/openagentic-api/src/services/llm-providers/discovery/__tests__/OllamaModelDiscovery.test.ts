/**
 * #650 U5 — OllamaProvider.discoverModelDetails contract test.
 *
 * Stubs /api/show via injectedFetch so the test runs offline. The fixture
 * follows the Ollama API documented at
 * https://github.com/ollama/ollama/blob/main/docs/api.md.
 *
 * Ollama is local + zero-cost — pricing source is always 'zero-cost-local'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { OllamaProvider } from '../../OllamaProvider.js';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const showFixture = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'ollama-nemotron3-33b-show.json'), 'utf8'),
);

describe('OllamaProvider.discoverModelDetails (#650 U5)', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider(pino({ level: 'silent' }));
    (provider as any).initialized = true;
    (provider as any).baseUrl = 'http://localhost:11434';
    (provider as any).injectedFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => showFixture,
    });
  });

  it('returns ModelDiscoveryRecord with identity from /api/show details', async () => {
    const r = await provider.discoverModelDetails!('nemotron3:33b');
    expect(r!.modelId).toBe('nemotron3:33b');
    expect(r!.providerType).toBe('ollama');
    expect(r!.family).toBe('nemotron3');
  });

  it('reads capabilities directly from /api/show capabilities array', async () => {
    const r = await provider.discoverModelDetails!('nemotron3:33b');
    expect(r!.capabilities).toEqual({
      chat: true, // 'completion' in capabilities
      vision: false,
      tools: true,
      thinking: true,
      embeddings: false,
      imageGeneration: false,
      streaming: true, // Ollama always streams
      nativeToolCalling: true, // 'tools' in capabilities
    });
  });

  it('reads contextWindow from model_info.general.context_length', async () => {
    const r = await provider.discoverModelDetails!('nemotron3:33b');
    expect(r!.contextWindow).toBe(131072);
  });

  it('parses temperature/topP/topK from Modelfile parameters string', async () => {
    const r = await provider.discoverModelDetails!('nemotron3:33b');
    expect(r!.temperature).toBe(0.6);
    expect(r!.topP).toBe(0.95);
    expect(r!.topK).toBe(50);
    expect(r!.maxOutputTokens).toBe(8192); // num_predict
  });

  it('reports zero-cost-local pricing', async () => {
    const r = await provider.discoverModelDetails!('nemotron3:33b');
    expect(r!.pricing.inputTokenUsd).toBe(0);
    expect(r!.pricing.outputTokenUsd).toBe(0);
    expect(r!.pricing.source).toBe('zero-cost-local');
    expect(r!.pricing.region).toBeNull();
  });

  it('throws on non-200 from /api/show', async () => {
    ((provider as any).injectedFetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    await expect(provider.discoverModelDetails!('not-pulled')).rejects.toThrow();
  });
});
