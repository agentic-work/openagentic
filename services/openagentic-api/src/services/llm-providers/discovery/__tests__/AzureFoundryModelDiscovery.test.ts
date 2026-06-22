/**
 * #650 U4 — AzureAIFoundryProvider.discoverModelDetails contract test.
 *
 * Stubs ARM listDeployments via injectedListDeployments and the pricing
 * fetcher via injectedPricingFetcher so the test runs offline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { AzureAIFoundryProvider } from '../../AzureAIFoundryProvider.js';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const armDeployment = JSON.parse(
  readFileSync(
    join(FIXTURES_DIR, 'azure-foundry-gpt-5.4-arm-deployment.json'),
    'utf8',
  ),
);

describe('AzureAIFoundryProvider.discoverModelDetails (#650 U4)', () => {
  let provider: AzureAIFoundryProvider;

  beforeEach(() => {
    provider = new AzureAIFoundryProvider(pino({ level: 'silent' }));
    (provider as any).initialized = true;
    (provider as any).useEntraAuth = true;
    (provider as any).injectedListDeployments = vi
      .fn()
      .mockResolvedValue([armDeployment]);
    (provider as any).injectedPricingFetcher = {
      fetch: vi.fn().mockResolvedValue({
        source: 'azure-retail-prices',
        fetchedAt: '2026-05-06T13:00:00.000Z',
        inputTokenUsd: 5.0,
        outputTokenUsd: 15.0,
      }),
    };
  });

  it('returns ModelDiscoveryRecord with identity from ARM deployment', async () => {
    const r = await provider.discoverModelDetails!('gpt-5.4', 'eastus2');
    expect(r).not.toBeNull();
    expect(r!.modelId).toBe('gpt-5.4');
    expect(r!.providerType).toBe('azure-ai-foundry');
    expect(r!.family).toMatch(/gpt/);
  });

  it('derives capabilities + limits from AIF inference helpers', async () => {
    const r = await provider.discoverModelDetails!('gpt-5.4', 'eastus2');
    expect(r!.capabilities.chat).toBe(true);
    expect(r!.capabilities.streaming).toBe(true);
    expect(r!.contextWindow).toBeGreaterThan(0);
    expect(r!.maxOutputTokens).toBeGreaterThan(0);
  });

  it('fetches pricing via AzureRetailPricesFetcher', async () => {
    const r = await provider.discoverModelDetails!('gpt-5.4', 'eastus2');
    expect(r!.pricing.inputTokenUsd).toBe(5.0);
    expect(r!.pricing.outputTokenUsd).toBe(15.0);
    expect(r!.pricing.source).toBe('azure-retail-prices');
    expect(r!.pricing.region).toBe('eastus2');
  });

  it('throws if model is not deployed in this account', async () => {
    ((provider as any).injectedListDeployments as any).mockResolvedValueOnce(
      [],
    );
    await expect(
      provider.discoverModelDetails!('not-deployed', 'eastus2'),
    ).rejects.toThrow(/not deployed/i);
  });

  // Pricing keys off Azure base model (deployment.modelName), NOT deployment
  // alias (deployment.name). Customer-chosen alias 'gpt-5.4' has zero meters
  // in Azure Retail Prices; the underlying base 'gpt-5-mini' has many.
  it('passes deployment.modelName (base model) to the pricing fetcher, not the alias', async () => {
    ((provider as any).injectedListDeployments as any).mockResolvedValueOnce([
      { name: 'gpt-5.4', modelName: 'gpt-5-mini', modelVersion: '2026-04-01' },
    ]);
    const fetchSpy = (provider as any).injectedPricingFetcher.fetch;
    await provider.discoverModelDetails!('gpt-5.4', 'eastus2');
    expect(fetchSpy).toHaveBeenCalledWith({
      modelId: 'gpt-5-mini',
      region: 'eastus2',
    });
  });
});
