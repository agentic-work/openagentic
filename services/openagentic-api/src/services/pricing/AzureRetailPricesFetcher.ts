/**
 * Azure Retail Prices fetcher (#650 U4).
 *
 * Anonymous public API at https://prices.azure.com/api/retail/prices.
 * Reference: https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
 *
 * Pulls 'Cognitive Services' meters for the requested region and walks
 * NextPageLink across paginated responses. Matches Inp/Outp/Cache meter
 * names against the requested modelId and converts unitOfMeasure
 * '1K Tokens' to USD per 1M (industry standard) by multiplying by 1000.
 *
 * No auth required — Azure Retail Prices is public, like AWS Pricing API.
 */
import type { ModelPricing, PricingFetcher, PricingFetchRequest } from './types.js';
import { PricingFetchError } from './types.js';

interface AzureRetailItem {
  retailPrice: number;
  unitPrice?: number;
  unitOfMeasure: string;
  armRegionName: string;
  meterName: string;
  productName: string;
  skuName: string;
  serviceName: string;
  type: string;
}

/**
 * Pure parser — extracts USD rates from a list of Retail Price items.
 * Centralized so the live fetcher and offline tests share the same logic.
 *
 * Filters: armRegionName === region, serviceName === 'Cognitive Services',
 * type === 'Consumption', meterName matches modelId substring.
 */
export function parseAzureRetailItems(
  items: AzureRetailItem[],
  modelId: string,
  region: string,
): ModelPricing {
  const ml = modelId.toLowerCase();
  const pricing: ModelPricing = {
    source: 'azure-retail-prices',
    fetchedAt: new Date().toISOString(),
    sourceDetails: `${region} retail`,
  };
  // 2026-05: Azure renamed the AI catalog. Old SKUs come back under
  // 'Cognitive Services'; new gpt-4.1 / gpt-5.* SKUs come back under
  // 'Foundry Models'. Accept either to span the migration window.
  const ALLOWED_SERVICE_NAMES = new Set(['Cognitive Services', 'Foundry Models']);
  for (const item of items) {
    if (item.armRegionName !== region) continue;
    if (!ALLOWED_SERVICE_NAMES.has(item.serviceName)) continue;
    if (item.type !== 'Consumption') continue;

    const meter = (item.meterName ?? '').toLowerCase();
    const sku = (item.skuName ?? '').toLowerCase();
    const matchesModel = meter.includes(ml) || sku.includes(ml);

    const unit = item.unitOfMeasure ?? '';
    const unitLc = unit.toLowerCase();

    // Image-based meters: charge per N images (Imagen, DALL·E).
    if (/image/i.test(unit)) {
      if (matchesModel) pricing.imageGenPerRequestUsd = item.retailPrice;
      continue;
    }

    if (!matchesModel) continue;

    // Token-based meters: convert to per-1M.
    // Foundry Models uses bare '1K' / '1M'; legacy Cognitive Services
    // uses '1K Tokens' / '1M Tokens'. Accept both.
    let perMillion = item.retailPrice;
    if (unitLc === '1k tokens' || unitLc === '1k') perMillion = item.retailPrice * 1000;
    else if (unitLc === '1m tokens' || unitLc === '1m') perMillion = item.retailPrice;
    else continue;

    // Direction tokens. Azure uses one of: -inp- / Inp Tokens (input),
    // -out- / Outp Tokens (output), -ccchd- / Cache hit (cache read).
    // Word-boundary anchors keep "inp" from matching the model name itself.
    if (/(?:^|[\s-])(?:inp|input)(?:[\s-]|$)/i.test(meter)) pricing.inputTokenUsd = perMillion;
    else if (/(?:^|[\s-])(?:out|outp|output)(?:[\s-]|$)/i.test(meter)) pricing.outputTokenUsd = perMillion;
    else if (/cache.*(?:read|hit)|ccchd/i.test(meter)) pricing.cacheReadUsd = perMillion;
    else if (/cache.*write/i.test(meter)) pricing.cacheWriteUsd = perMillion;
    else if (/embed/i.test(meter)) pricing.embeddingTokenUsd = perMillion;
    else if (/think|reason/i.test(meter)) pricing.thinkingTokenUsd = perMillion;
  }
  return pricing;
}

export class AzureRetailPricesFetcher implements PricingFetcher {
  constructor(private readonly opts?: { injectedFetch?: typeof fetch }) {}

  async fetch(req: PricingFetchRequest): Promise<ModelPricing> {
    const fetchFn = this.opts?.injectedFetch ?? globalThis.fetch;
    // Server-side $filter must include both service-name variants AND a
    // meterName substring match for the model so the response is small.
    // Without the meterName narrow the catalog returns hundreds of pages
    // and we time out at 15s per page on the connection-limited api pod.
    const ml = req.modelId.toLowerCase();
    const filter =
      `(serviceName eq 'Cognitive Services' or serviceName eq 'Foundry Models') ` +
      `and armRegionName eq '${req.region}' ` +
      `and contains(tolower(meterName), '${ml}')`;
    let url: string | null =
      `https://prices.azure.com/api/retail/prices?$filter=` + encodeURIComponent(filter);
    const items: AzureRetailItem[] = [];
    let pages = 0;
    while (url && pages < 50) {
      const resp = await fetchFn(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) {
        throw new PricingFetchError(
          'azure-retail',
          req.modelId,
          `HTTP ${resp.status}`,
        );
      }
      const data = (await resp.json()) as {
        Items: AzureRetailItem[];
        NextPageLink: string | null;
      };
      items.push(...data.Items);
      url = data.NextPageLink;
      pages++;
    }
    return parseAzureRetailItems(items, req.modelId, req.region);
  }
}
