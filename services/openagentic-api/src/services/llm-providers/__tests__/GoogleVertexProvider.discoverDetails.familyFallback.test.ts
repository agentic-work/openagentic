/**
 * #650 follow-up — GoogleVertexProvider.discoverModelDetails must derive
 * defaults from the family slug when the Vertex Publishers REST GET
 * returns sparse data (gemini-2.5-pro, gemini-3, etc. — REST often
 * omits inputTokenLimit + supportedGenerationMethods).
 *
 * Live evidence (dev environment 2026-05-06): adding gemini-2.5-pro produced
 * capabilities.{chat,tools,streaming,nativeToolCalling}=false +
 * contextWindow=null because the REST data was sparse and the original
 * implementation took it at face value.
 *
 * Contract pinned here:
 *   - When REST returns {inputTokenLimit:undefined, outputTokenLimit:undefined,
 *     supportedGenerationMethods:undefined}, capabilities + limits MUST
 *     populate from the family slug (e.g. gemini-2.5 → 1_048_576/65_536,
 *     chat=true, tools=true, streaming=true, thinking=true, vision=true).
 *   - Same when REST returns supportedGenerationMethods: [] (empty array).
 *   - Family slug (`family` field) reflects the model's family.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../ProviderManager.js', () => ({ ProviderManager: class {} }));
vi.mock('../../../utils/prisma.js', () => ({ prisma: {} }));
vi.mock('../../../utils/logger.js', () => ({
  logger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  loggers: { services: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
}));
vi.mock('../../pricing/VertexPublisherListFetcher.js', () => ({
  VertexPublisherListFetcher: class {
    async fetch() {
      return {
        source: 'vertex-publisher-list',
        fetchedAt: new Date().toISOString(),
        inputTokenUsd: null,
        outputTokenUsd: null,
      };
    }
  },
}));

import { GoogleVertexProvider } from '../GoogleVertexProvider.js';

const minimalConfig = {
  id: 'test-vertex',
  name: 'Test Vertex',
  type: 'google-vertex' as const,
  enabled: true,
  priority: 1,
  credentials: { project: 'test-project', location: 'us-central1' },
  models: [],
  settings: {},
};

function makeProvider(restResponseShape: any): GoogleVertexProvider {
  const provider = new GoogleVertexProvider(minimalConfig, {} as any);
  (provider as any).initialized = true;
  (provider as any).injectedFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => restResponseShape,
  });
  return provider;
}

describe('#650 — Vertex discoverModelDetails family-slug fallback', () => {
  it('populates gemini-2.5-pro caps + limits when REST returns sparse data', async () => {
    const provider = makeProvider({
      // Sparse — what live REST returns for gemini-2.5-pro per #650 evidence.
      name: 'publishers/google/models/gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      version: '1',
    });

    const result = await provider.discoverModelDetails('gemini-2.5-pro');
    expect(result).toBeTruthy();
    expect(result!.family).toBe('gemini-2.5');
    expect(result!.capabilities.chat).toBe(true);
    expect(result!.capabilities.tools).toBe(true);
    expect(result!.capabilities.streaming).toBe(true);
    expect(result!.capabilities.nativeToolCalling).toBe(true);
    expect(result!.capabilities.thinking).toBe(true);
    expect(result!.capabilities.vision).toBe(true);
    expect(result!.contextWindow).toBe(1_048_576);
    expect(result!.maxOutputTokens).toBe(65_536);
    expect(result!.thinkingBudget).toBe(8000);
  });

  it('populates gemini-2.5-pro caps + limits when REST returns empty supportedGenerationMethods', async () => {
    const provider = makeProvider({
      name: 'publishers/google/models/gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      supportedGenerationMethods: [],
      // Note inputTokenLimit / outputTokenLimit deliberately absent.
    });

    const result = await provider.discoverModelDetails('gemini-2.5-pro');
    expect(result!.capabilities.chat).toBe(true);
    expect(result!.capabilities.tools).toBe(true);
    expect(result!.capabilities.streaming).toBe(true);
    expect(result!.capabilities.nativeToolCalling).toBe(true);
    expect(result!.contextWindow).toBe(1_048_576);
    expect(result!.maxOutputTokens).toBe(65_536);
  });

  it('populates gemini-3 caps + limits from family slug', async () => {
    const provider = makeProvider({
      name: 'publishers/google/models/gemini-3-pro',
      displayName: 'Gemini 3 Pro',
    });

    const result = await provider.discoverModelDetails('gemini-3-pro');
    expect(result!.family).toBe('gemini-3');
    expect(result!.capabilities.chat).toBe(true);
    expect(result!.capabilities.thinking).toBe(true);
    expect(result!.contextWindow).toBe(1_048_576);
    expect(result!.maxOutputTokens).toBe(65_536);
  });

  it('uses REST-provided limits when present (not just family fallback)', async () => {
    const provider = makeProvider({
      name: 'publishers/google/models/gemini-1.5-flash',
      displayName: 'Gemini 1.5 Flash',
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 16_384,
      supportedGenerationMethods: ['generateContent', 'streamGenerateContent', 'countTokens'],
    });

    const result = await provider.discoverModelDetails('gemini-1.5-flash');
    expect(result!.contextWindow).toBe(1_000_000);
    expect(result!.maxOutputTokens).toBe(16_384);
    expect(result!.capabilities.streaming).toBe(true);
  });
});
