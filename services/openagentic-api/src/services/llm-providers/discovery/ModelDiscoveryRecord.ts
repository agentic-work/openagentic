/**
 * #650 — Authoritative shape for live provider-pulled model details.
 *
 * Every Registry write at Add-Model time MUST be sourced from the
 * provider's SDK via discoverModelDetails(modelId, region?). The body of
 * the POST /llm-providers/:id/models endpoint is admin-overrides ONLY
 * (display name, role-priority overrides) — NEVER the source of truth
 * for capabilities, limits, defaults, or pricing.
 *
 * RouterTuning math (cost-per-token, ctx-fit gates, FCA floors) reads
 * the Registry row populated from this shape. Stale or fake numbers
 * here break every downstream routing decision.
 */
export interface ModelDiscoveryRecord {
  // identity
  modelId: string;
  providerType:
    | 'aws-bedrock'
    | 'google-vertex'
    | 'azure-ai-foundry'
    | 'ollama'
    | 'azure-openai'
    | 'anthropic'
    | 'openai';
  displayName: string;
  family: string;

  // capabilities (8 flags)
  capabilities: {
    chat: boolean;
    vision: boolean;
    tools: boolean;
    thinking: boolean;
    embeddings: boolean;
    imageGeneration: boolean;
    streaming: boolean;
    nativeToolCalling: boolean;
  };

  // limits
  contextWindow: number | null;
  maxOutputTokens: number | null;
  thinkingBudget: number | null;

  // defaults
  temperature: number;
  topP: number;
  topK: number | null;

  // pricing
  pricing: {
    inputTokenUsd: number | null;
    outputTokenUsd: number | null;
    cacheReadUsd: number | null;
    cacheWriteUsd: number | null;
    thinkingTokenUsd: number | null;
    embeddingTokenUsd: number | null;
    perRequestUsd: number | null;
    source:
      | 'bedrock-pricing-sdk'
      | 'vertex-publisher-list'
      | 'azure-retail-prices'
      | 'zero-cost-local'
      | 'manual';
    fetchedAt: string;
    region: string | null;
  };
}
