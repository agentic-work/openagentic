/**
 * #650 U2 — AWSBedrockProvider.discoverModelDetails contract test.
 *
 * Stubs the @aws-sdk/client-bedrock GetFoundationModelCommand response
 * and the BedrockPricingFetcher so the test runs offline. The real SDK
 * wrappers are integration-tested separately via env-gated suites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { AWSBedrockProvider } from '../../AWSBedrockProvider.js';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const getFoundationFixture = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'bedrock-claude-sonnet-4-6-getfoundationmodel.json'), 'utf8'),
);

describe('AWSBedrockProvider.discoverModelDetails (#650)', () => {
  let provider: AWSBedrockProvider;

  beforeEach(() => {
    provider = new AWSBedrockProvider(pino({ level: 'silent' }));
    // Stub the Bedrock SDK client's send() to return the fixture for
    // GetFoundationModelCommand. The provider implementation is the SUT.
    (provider as any).bedrockClient = {
      send: vi.fn().mockResolvedValue(getFoundationFixture),
    };
    (provider as any).initialized = true;
    (provider as any).config = { region: 'us-east-1' };
    // Inject a stub pricing fetcher so the test runs offline.
    (provider as any).injectedPricingFetcher = {
      fetch: vi.fn().mockResolvedValue({
        source: 'bedrock-pricing-sdk',
        fetchedAt: '2026-05-06T13:00:00.000Z',
        inputTokenUsd: 3.0,
        outputTokenUsd: 15.0,
        cacheReadUsd: 0.3,
        cacheWriteUsd: 3.75,
      }),
    };
  });

  it('returns ModelDiscoveryRecord with identity from GetFoundationModel', async () => {
    const r = await provider.discoverModelDetails!(
      'anthropic.claude-sonnet-4-6-v1:0',
      'us-east-1',
    );
    expect(r).not.toBeNull();
    expect(r!.modelId).toBe('anthropic.claude-sonnet-4-6-v1:0');
    expect(r!.providerType).toBe('aws-bedrock');
    expect(r!.displayName).toBe('Claude Sonnet 4.6');
    expect(r!.family).toBe('claude-sonnet-4');
  });

  it('derives capabilities from inputModalities + responseStreamingSupported + family table', async () => {
    const r = await provider.discoverModelDetails!(
      'anthropic.claude-sonnet-4-6-v1:0',
      'us-east-1',
    );
    expect(r!.capabilities).toEqual({
      chat: true,
      vision: true, // IMAGE in inputModalities
      tools: true, // anthropic family — table-driven
      thinking: true, // anthropic family — table-driven
      embeddings: false,
      imageGeneration: false,
      streaming: true, // responseStreamingSupported
      nativeToolCalling: true, // anthropic family
    });
  });

  it('populates contextWindow + maxOutputTokens + thinkingBudget from BedrockCapabilityInference table', async () => {
    const r = await provider.discoverModelDetails!(
      'anthropic.claude-sonnet-4-6-v1:0',
      'us-east-1',
    );
    expect(r!.contextWindow).toBe(200000);
    expect(r!.maxOutputTokens).toBe(64000);
    expect(r!.thinkingBudget).toBe(10000);
  });

  it('returns USD pricing from BedrockPricingFetcher with region label', async () => {
    const r = await provider.discoverModelDetails!(
      'anthropic.claude-sonnet-4-6-v1:0',
      'us-east-1',
    );
    expect(r!.pricing.inputTokenUsd).toBe(3.0);
    expect(r!.pricing.outputTokenUsd).toBe(15.0);
    expect(r!.pricing.cacheReadUsd).toBe(0.3);
    expect(r!.pricing.cacheWriteUsd).toBe(3.75);
    expect(r!.pricing.source).toBe('bedrock-pricing-sdk');
    expect(r!.pricing.region).toBe('us-east-1');
    expect(r!.pricing.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws on SDK error (does not silently return null)', async () => {
    ((provider as any).bedrockClient.send as any).mockRejectedValueOnce(new Error('Bedrock 403'));
    await expect(
      provider.discoverModelDetails!('anthropic.claude-sonnet-4-6-v1:0', 'us-east-1'),
    ).rejects.toThrow();
  });
});
