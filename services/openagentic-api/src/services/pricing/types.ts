/**
 * Dynamic per-model pricing types.
 *
 * Pricing is fetched from the CSP billing catalog (AWS Price List Bulk API
 * via @aws-sdk/client-pricing, Azure Retail Prices API, Google Cloud
 * Billing SDK) at Add-Model time and stored on the Registry row. Every
 * LLM call then reads the cached rates from the row it already resolved
 * — zero extra API round-trips on the hot path, zero added TTFT.
 *
 * A background daily cron re-fetches and updates rows in-place; any rate
 * delta writes an audit row to keep historical cost calculations honest.
 *
 * Rates are USD per 1M tokens (industry standard unit), stored as Decimal
 * in Postgres to avoid float precision drift on ledger aggregation.
 *
 * Since tenants exclusively use CSP creds (no direct Anthropic/OpenAI API
 * keys), the CSP list price IS the tenant's true cost. Negotiated enterprise
 * discounts are a v2 feature (tenant.pricingOverride override row).
 */

export type PricingSource =
  /** AWS Pricing SDK — @aws-sdk/client-pricing GetProducts(ServiceCode=AmazonBedrock) */
  | 'bedrock-pricing-sdk'
  /** Google Cloud Billing SDK — @google-cloud/billing CloudCatalogClient.listSkus */
  | 'google-billing-sdk'
  /**
   * Vendored Vertex AI publisher list (#650 U3). GCP does not publish
   * a public REST endpoint covering Gemini per-model pricing; the JSON
   * lives at services/openagentic-api/src/services/pricing/data/
   * vertex-publisher-list.json and is admin-editable. The daily refresh
   * cron flags drift via diff log.
   */
  | 'vertex-publisher-list'
  /** Azure Retail Prices API — prices.azure.com (public JSON, auth via platform membership) */
  | 'azure-retail-prices'
  /** No CSP catalog available (e.g., self-hosted Ollama) — rates are 0. */
  | 'zero-cost-local'
  /** Admin entered manually — flag in UI with ⚠ indicator. */
  | 'manual';

/**
 * Per-model USD rates. All values are per 1M tokens (millionths) except
 * where explicitly called out as per-request (image generation).
 *
 * Any rate left undefined means "not applicable for this model" — e.g.,
 * an embedding model has no outputTokenUsd, a text-only model has no
 * imageGenPerRequestUsd.
 */
export interface ModelPricing {
  /** Input tokens consumed (prompt + system + tool definitions). */
  inputTokenUsd?: number;
  /** Output tokens generated (assistant reply + tool calls + thinking). */
  outputTokenUsd?: number;
  /** Prompt-cache read tokens. Anthropic/Bedrock claude-*-v1 cache_read pricing. */
  cacheReadUsd?: number;
  /** Prompt-cache write tokens (creation). Higher than normal input; charged once. */
  cacheWriteUsd?: number;
  /** Extended-thinking tokens (Claude reasoning channel). */
  thinkingTokenUsd?: number;
  /** Embedding input tokens (for embedding models only — Titan, text-embedding-3). */
  embeddingTokenUsd?: number;
  /** Per-request cost for image generation models (Stable Diffusion, Imagen). */
  imageGenPerRequestUsd?: number;
  /** Where the rates came from, for UI badge + audit trail. */
  source: PricingSource;
  /** ISO-8601 UTC timestamp when this rate snapshot was fetched. */
  fetchedAt: string;
  /** Optional free-text breadcrumb for audit — e.g., "us-east-1 OnDemand tier". */
  sourceDetails?: string;
}

/**
 * Input spec for any provider-specific pricing fetcher. The fetcher
 * decides which SDK to call based on its provider type.
 */
export interface PricingFetchRequest {
  /** Model identifier as registered in the Registry — e.g., `anthropic.claude-opus-4-6-v1:0`. */
  modelId: string;
  /** Region where inference actually runs — pricing varies by region. */
  region: string;
  /** Optional: credentials override. If not provided, fetcher uses ambient provider creds. */
  credentialsOverride?: Record<string, string>;
}

/**
 * Interface every provider-specific pricing fetcher implements.
 * Registering a new provider = implementing this one method.
 */
export interface PricingFetcher {
  /**
   * @throws PricingFetchError on transient failure (network, auth, quota).
   *   Call sites should fail-open — treat missing pricing as "unknown" and
   *   set the Registry row's cost columns to null rather than blocking Add-Model.
   */
  fetch(req: PricingFetchRequest): Promise<ModelPricing>;
}

export class PricingFetchError extends Error {
  constructor(
    public readonly provider: string,
    public readonly modelId: string,
    public readonly reason: string,
    public readonly cause?: unknown,
  ) {
    super(`[PricingFetch:${provider}] ${modelId}: ${reason}`);
    this.name = 'PricingFetchError';
  }
}
