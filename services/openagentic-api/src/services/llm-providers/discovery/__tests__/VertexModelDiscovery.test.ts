/**
 * #650 U3 — GoogleVertexProvider.discoverModelDetails contract test.
 *
 * Stubs the Vertex publishers REST GET via injectedFetch and the
 * VertexPublisherListFetcher via injectedPricingFetcher so the test
 * runs offline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { GoogleVertexProvider } from '../../GoogleVertexProvider.js';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const fixture = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'vertex-gemini-2.5-pro-publishers.json'), 'utf8'),
);

describe('GoogleVertexProvider.discoverModelDetails (#650 U3)', () => {
  let provider: GoogleVertexProvider;

  beforeEach(() => {
    provider = new GoogleVertexProvider(pino({ level: 'silent' }));
    (provider as any).initialized = true;
    (provider as any).config = { projectId: 'p', location: 'us-central1' };
    (provider as any).injectedFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fixture,
    });
    (provider as any).injectedPricingFetcher = {
      fetch: vi.fn().mockResolvedValue({
        source: 'vertex-publisher-list',
        fetchedAt: '2026-05-06T13:00:00.000Z',
        inputTokenUsd: 1.25,
        outputTokenUsd: 10.0,
      }),
    };
  });

  it('returns ModelDiscoveryRecord with limits from publishers REST', async () => {
    const r = await provider.discoverModelDetails!('gemini-2.5-pro', 'us-central1');
    expect(r).not.toBeNull();
    expect(r!.modelId).toBe('gemini-2.5-pro');
    expect(r!.providerType).toBe('google-vertex');
    expect(r!.contextWindow).toBe(1048576);
    expect(r!.maxOutputTokens).toBe(65536);
    expect(r!.family).toBe('gemini-2.5');
    expect(r!.displayName).toBe('Gemini 2.5 Pro');
  });

  it('derives capabilities from supportedGenerationMethods', async () => {
    const r = await provider.discoverModelDetails!('gemini-2.5-pro', 'us-central1');
    expect(r!.capabilities).toEqual({
      chat: true,
      vision: true, // gemini-2.5 family supports image input
      tools: true,
      thinking: true, // gemini-2.5+ supports thinking
      embeddings: false,
      imageGeneration: false,
      streaming: true, // streamGenerateContent in supportedGenerationMethods
      nativeToolCalling: true,
    });
  });

  it('returns USD pricing from VertexPublisherListFetcher with region label', async () => {
    const r = await provider.discoverModelDetails!('gemini-2.5-pro', 'us-central1');
    expect(r!.pricing.inputTokenUsd).toBe(1.25);
    expect(r!.pricing.outputTokenUsd).toBe(10.0);
    expect(r!.pricing.source).toBe('vertex-publisher-list');
    expect(r!.pricing.region).toBe('us-central1');
  });

  it('returns embeddings=true for text-embedding-005', async () => {
    const embFixture = {
      name: 'publishers/google/models/text-embedding-005',
      displayName: 'text-embedding-005',
      supportedGenerationMethods: ['embedContent', 'countTokens'],
      inputTokenLimit: 2048,
      outputTokenLimit: 0,
    };
    ((provider as any).injectedFetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => embFixture,
    });
    const r = await provider.discoverModelDetails!('text-embedding-005', 'us-central1');
    expect(r!.capabilities.embeddings).toBe(true);
    expect(r!.capabilities.chat).toBe(false);
    expect(r!.family).toBe('embedding');
  });

  it('throws on 404 from publishers API', async () => {
    ((provider as any).injectedFetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not Found' }),
    });
    await expect(
      provider.discoverModelDetails!('fake-model', 'us-central1'),
    ).rejects.toThrow();
  });
});
