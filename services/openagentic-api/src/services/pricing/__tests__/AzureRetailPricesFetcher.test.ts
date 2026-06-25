/**
 * #650 U4 — Azure Retail Prices fetcher contract test. Runs offline against
 * a captured fixture from prices.azure.com.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AzureRetailPricesFetcher,
  parseAzureRetailItems,
} from '../AzureRetailPricesFetcher.js';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const fixture = JSON.parse(
  readFileSync(
    join(FIXTURES_DIR, 'azure-retail-prices-cognitive-services-eastus2.json'),
    'utf8',
  ),
);

describe('AzureRetailPricesFetcher (#650 U4)', () => {
  it('parses Items[] and matches Inp/Outp meterName for the requested model', () => {
    const r = parseAzureRetailItems(fixture.Items, 'gpt-5.4', 'eastus2');
    expect(r.inputTokenUsd).toBeDefined();
    expect(r.outputTokenUsd).toBeDefined();
    expect(r.source).toBe('azure-retail-prices');
    expect(r.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('converts unitOfMeasure 1K Tokens → USD per 1M (multiply by 1000)', () => {
    // retailPrice $0.005 per 1K tokens → $5 per 1M
    const r = parseAzureRetailItems(fixture.Items, 'gpt-5.4', 'eastus2');
    expect(r.inputTokenUsd).toBe(5); // 0.005 * 1000
    expect(r.outputTokenUsd).toBe(15); // 0.015 * 1000
  });

  it('captures cache_read meters under cacheReadUsd', () => {
    const r = parseAzureRetailItems(fixture.Items, 'gpt-5.4', 'eastus2');
    expect(r.cacheReadUsd).toBe(0.5); // 0.0005 * 1000
  });

  it('walks NextPageLink across paginated responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...fixture,
          NextPageLink: 'https://prices.azure.com/api/retail/prices?$skip=200',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...fixture, NextPageLink: null }),
      });
    const f = new AzureRetailPricesFetcher({ injectedFetch: fetchMock as any });
    await f.fetch({ modelId: 'gpt-5.4', region: 'eastus2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws PricingFetchError on HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const f = new AzureRetailPricesFetcher({ injectedFetch: fetchMock as any });
    await expect(
      f.fetch({ modelId: 'gpt-5.4', region: 'eastus2' }),
    ).rejects.toThrow();
  });

  it('skips items from other regions', () => {
    const wrongRegionItem = { ...fixture.Items[0], armRegionName: 'westus' };
    const r = parseAzureRetailItems([wrongRegionItem], 'gpt-5.4', 'eastus2');
    expect(r.inputTokenUsd).toBeUndefined();
  });

  // 2026-05: Azure renamed the public service catalog from 'Cognitive Services'
  // to 'Foundry Models', and changed unit-of-measure from '1K Tokens' to plain
  // '1K' (or '1M'). Old hard filter blocked all matches for current AIF SKUs.
  it('matches the current Foundry Models serviceName + 1K unit shape', () => {
    const items = [
      {
        retailPrice: 0.00125,
        unitOfMeasure: '1K',
        armRegionName: 'eastus2',
        meterName: 'gpt-5-mini-inp-glbl Tokens',
        productName: 'Foundry Models — gpt-5-mini',
        skuName: 'gpt-5-mini-inp-glbl',
        serviceName: 'Foundry Models',
        type: 'Consumption',
      },
      {
        retailPrice: 0.01,
        unitOfMeasure: '1K',
        armRegionName: 'eastus2',
        meterName: 'gpt-5-mini-out-glbl Tokens',
        productName: 'Foundry Models — gpt-5-mini',
        skuName: 'gpt-5-mini-out-glbl',
        serviceName: 'Foundry Models',
        type: 'Consumption',
      },
    ];
    const r = parseAzureRetailItems(items, 'gpt-5-mini', 'eastus2');
    expect(r.inputTokenUsd).toBe(1.25); // 0.00125 * 1000
    expect(r.outputTokenUsd).toBe(10);  // 0.01 * 1000
  });

  it('still matches legacy Cognitive Services + "1K Tokens" shape (back-compat)', () => {
    const items = [
      {
        retailPrice: 0.005,
        unitOfMeasure: '1K Tokens',
        armRegionName: 'eastus2',
        meterName: 'gpt-5.4 Inp Tokens',
        productName: 'Cognitive Services',
        skuName: 'gpt-5.4-inp',
        serviceName: 'Cognitive Services',
        type: 'Consumption',
      },
    ];
    const r = parseAzureRetailItems(items, 'gpt-5.4', 'eastus2');
    expect(r.inputTokenUsd).toBe(5);
  });
});
