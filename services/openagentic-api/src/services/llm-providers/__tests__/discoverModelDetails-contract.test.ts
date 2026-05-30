/**
 * #650 Sev-0 — schema contract for live provider-pulled model details.
 *
 * Every Registry write at Add-Model time MUST be sourced from the
 * provider's SDK via discoverModelDetails(modelId, region?). The body of
 * POST /llm-providers/:id/models is admin-overrides ONLY — never the
 * source of truth for capabilities, limits, defaults, or pricing.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { ILLMProvider } from '../ILLMProvider.js';
import type { ModelDiscoveryRecord } from '../discovery/ModelDiscoveryRecord.js';

describe('ModelDiscoveryRecord — schema contract (#650)', () => {
  it('matches the live shape — identity + 8 capabilities + limits + defaults + pricing', () => {
    expectTypeOf<ModelDiscoveryRecord>().toEqualTypeOf<{
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
    }>();
  });

  it('discoverModelDetails is the optional method on ILLMProvider with the live signature', () => {
    type ExpectedSig = (modelId: string, region?: string) => Promise<ModelDiscoveryRecord | null>;
    expectTypeOf<NonNullable<ILLMProvider['discoverModelDetails']>>().toEqualTypeOf<ExpectedSig>();
  });
});
