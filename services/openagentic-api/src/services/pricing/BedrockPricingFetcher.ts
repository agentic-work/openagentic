/**
 * Bedrock pricing fetcher (task #342).
 *
 * Calls AWS Pricing Bulk API via @aws-sdk/client-pricing — filtered by
 * ServiceCode=AmazonBedrock + regionCode. Returns normalized USD/1M-token
 * rates to store on the Registry row.
 *
 * Called from the Add-Model path and from a daily background refresh cron.
 * Never called on the hot LLM inference path — rates live on the
 * model_role_assignments row and are read without a network call.
 */

import type {
  ModelPricing,
  PricingFetcher,
  PricingFetchRequest,
} from './types.js';
import { PricingFetchError } from './types.js';

/**
 * Raw shape of a single PriceList entry after JSON.parse. AWS returns
 * each entry as a STRING in the outer response; callers must parse
 * twice (we do it here to keep the AWS wire format contained).
 */
interface BedrockSku {
  product: {
    productFamily?: string;
    sku: string;
    attributes: {
      servicecode?: string;
      region?: string;
      regionCode?: string;
      usagetype?: string;
      model?: string;
      /** 'Input' | 'Output' | 'Cache Read' | 'Cache Write' | 'Embedding' | (others as new models land) */
      inputOutput?: string;
      operation?: string;
    };
  };
  terms?: {
    OnDemand?: Record<
      string,
      {
        priceDimensions?: Record<
          string,
          {
            unit?: string;
            pricePerUnit?: { USD?: string };
          }
        >;
      }
    >;
  };
}

/**
 * Normalize a pricePerUnit.USD string + unit into USD per 1M tokens.
 * Bedrock consistently publishes per-token rates with unit='tokens',
 * but we accept 'MTokens' / 'Million tokens' / '1M tokens' variants
 * defensively — AWS has been known to change units silently on new models.
 */
function normalizeToPerMillion(priceStr: string, unit: string): number {
  const price = parseFloat(priceStr);
  if (!Number.isFinite(price)) {
    throw new Error(`unparseable pricePerUnit.USD: ${priceStr}`);
  }
  const u = unit.trim().toLowerCase();
  if (u === 'tokens') return price * 1_000_000;
  if (u === 'mtokens' || u === '1m tokens' || u === 'million tokens') return price;
  if (u === 'requests' || u === 'request' || u === 'image') {
    // Per-request — caller decides which field to populate.
    return price;
  }
  throw new Error(`unrecognized unit: ${unit}`);
}

/**
 * Extract the first (and by convention only) rate dimension from a SKU's
 * OnDemand terms block. Returns undefined if the SKU has no OnDemand
 * pricing (e.g., it was listed but no rate published yet).
 */
function firstOnDemandRate(sku: BedrockSku): {
  usd: number;
  unit: string;
} | undefined {
  const onDemand = sku.terms?.OnDemand;
  if (!onDemand) return undefined;
  for (const term of Object.values(onDemand)) {
    const dims = term.priceDimensions;
    if (!dims) continue;
    for (const dim of Object.values(dims)) {
      const raw = dim.pricePerUnit?.USD;
      if (raw === undefined) continue;
      return { usd: parseFloat(raw), unit: dim.unit ?? 'tokens' };
    }
  }
  return undefined;
}

/**
 * Map `product.attributes.inputOutput` to the ModelPricing field it
 * populates. Keeping this centralized so new Bedrock pricing dimensions
 * (when AWS adds them) surface as a typed switch that `never`-checks
 * exhaustive.
 */
function fieldForInputOutput(
  io: string | undefined,
): keyof Pick<
  ModelPricing,
  | 'inputTokenUsd'
  | 'outputTokenUsd'
  | 'cacheReadUsd'
  | 'cacheWriteUsd'
  | 'embeddingTokenUsd'
  | 'imageGenPerRequestUsd'
  | 'thinkingTokenUsd'
> | undefined {
  switch ((io ?? '').trim()) {
    case 'Input':
      return 'inputTokenUsd';
    case 'Output':
      return 'outputTokenUsd';
    case 'Cache Read':
      return 'cacheReadUsd';
    case 'Cache Write':
      return 'cacheWriteUsd';
    case 'Embedding':
      return 'embeddingTokenUsd';
    case 'Image Output':
      return 'imageGenPerRequestUsd';
    case 'Thinking':
      return 'thinkingTokenUsd';
    default:
      return undefined;
  }
}

/**
 * Parse a PriceList from @aws-sdk/client-pricing GetProductsCommand
 * (each entry is a JSON-encoded string) and extract the rates relevant
 * to the requested modelId. Silently ignores SKUs for other models —
 * the same API call often returns pricing for many models in one region.
 */
export function parseBedrockPriceList(
  priceList: string[],
  modelId: string,
): ModelPricing {
  const now = new Date().toISOString();
  const pricing: ModelPricing = {
    source: 'bedrock-pricing-sdk',
    fetchedAt: now,
  };

  let region: string | undefined;
  for (const entryStr of priceList) {
    let sku: BedrockSku;
    try {
      sku = JSON.parse(entryStr) as BedrockSku;
    } catch {
      continue;
    }
    if (sku.product?.attributes?.model !== modelId) continue;
    region = region ?? sku.product.attributes.regionCode ?? sku.product.attributes.region;

    const field = fieldForInputOutput(sku.product.attributes.inputOutput);
    if (!field) continue;

    const rate = firstOnDemandRate(sku);
    if (!rate) continue;

    const perMillion = normalizeToPerMillion(String(rate.usd), rate.unit);
    pricing[field] = perMillion;
  }

  if (region) {
    pricing.sourceDetails = `${region} OnDemand`;
  }
  return pricing;
}

/**
 * Live SDK fetcher. Deferred implementation — the parser above is pure
 * and testable without AWS creds; the SDK wrapper is integration-tested
 * against the live API when AWS_PRICING_INTEGRATION=1 is set.
 */
export class BedrockPricingFetcher implements PricingFetcher {
  async fetch(req: PricingFetchRequest): Promise<ModelPricing> {
    const { PricingClient, GetProductsCommand } = await import('@aws-sdk/client-pricing');
    const client = new PricingClient({
      // AWS Pricing API is hosted in us-east-1 and ap-south-1 only.
      // This does NOT have to match the inference region — we pass
      // the inference region as a FILTER, not as the pricing endpoint.
      region: 'us-east-1',
    });
    try {
      const allPrices: string[] = [];
      let nextToken: string | undefined;
      do {
        const resp = await client.send(
          new GetProductsCommand({
            ServiceCode: 'AmazonBedrock',
            Filters: [
              { Type: 'TERM_MATCH', Field: 'regionCode', Value: req.region },
            ],
            NextToken: nextToken,
            MaxResults: 100,
          }),
        );
        if (resp.PriceList) allPrices.push(...resp.PriceList.map(String));
        nextToken = resp.NextToken;
      } while (nextToken);
      return parseBedrockPriceList(allPrices, req.modelId);
    } catch (e) {
      throw new PricingFetchError(
        'bedrock',
        req.modelId,
        e instanceof Error ? e.message : String(e),
        e,
      );
    } finally {
      client.destroy();
    }
  }
}
