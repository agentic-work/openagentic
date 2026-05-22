/**
 * Sev-2 — tests for Bedrock capability inference.
 *
 * Critical invariant (enforced by docs/rules/no-hardcoded-models.md):
 *   NO model-name substring matching. These tests fail immediately if
 *   someone reintroduces `modelId.includes('claude-…')` logic.
 */

import { describe, it, expect } from 'vitest';
import {
  bedrockSummaryToDiscoveredModel,
  bedrockInferenceProfileToDiscoveredModel,
  extractFoundationIdFromProfile,
  indexFoundationSummaries,
  type BedrockFoundationSummary,
  type BedrockInferenceProfileSummary,
} from '../services/llm-providers/BedrockCapabilityInference';

describe('bedrockSummaryToDiscoveredModel', () => {
  it('returns null when modelId is missing', () => {
    expect(bedrockSummaryToDiscoveredModel({ modelName: 'x' })).toBeNull();
  });

  it('derives chat/vision/streaming from API modalities', () => {
    const summary: BedrockFoundationSummary = {
      modelId: 'opaque-id-1',
      modelName: 'Opaque Model',
      providerName: 'SomeProvider',
      inputModalities: ['TEXT', 'IMAGE'],
      outputModalities: ['TEXT'],
      responseStreamingSupported: true,
    };
    const out = bedrockSummaryToDiscoveredModel(summary)!;
    expect(out.capabilities?.chat).toBe(true);
    expect(out.capabilities?.vision).toBe(true);
    expect(out.capabilities?.embeddings).toBe(false);
    expect(out.capabilities?.imageGeneration).toBe(false);
    expect(out.capabilities?.streaming).toBe(true);
  });

  it('treats EMBEDDING output as embeddings-only (not chat)', () => {
    const out = bedrockSummaryToDiscoveredModel({
      modelId: 'embed-1',
      outputModalities: ['EMBEDDING'],
      providerName: 'Amazon',
    })!;
    expect(out.capabilities?.embeddings).toBe(true);
    expect(out.capabilities?.chat).toBe(false);
  });

  it('flags image generation only when output is IMAGE and input lacks TEXT', () => {
    const imageOnly = bedrockSummaryToDiscoveredModel({
      modelId: 'img-1',
      inputModalities: ['IMAGE'],
      outputModalities: ['IMAGE'],
    })!;
    expect(imageOnly.capabilities?.imageGeneration).toBe(true);

    const textToImage = bedrockSummaryToDiscoveredModel({
      modelId: 'img-2',
      inputModalities: ['TEXT'],
      outputModalities: ['IMAGE'],
    })!;
    // Text-driven image renderers are still chat-capable, so we don't
    // flag them as imageGeneration-only.
    expect(textToImage.capabilities?.imageGeneration).toBe(false);
  });

  it('defaults streaming to true when responseStreamingSupported is omitted', () => {
    const out = bedrockSummaryToDiscoveredModel({
      modelId: 'nostream-field',
      outputModalities: ['TEXT'],
    })!;
    expect(out.capabilities?.streaming).toBe(true);
  });

  it('does NOT guess family/costTier/tools/thinking from the modelId string', () => {
    // If a hardcoded pattern-match ever comes back, one of these asserts
    // will flip because the result would contain tooling/thinking flags
    // the API never exposed.
    const out = bedrockSummaryToDiscoveredModel({
      modelId: 'anthropic.claude-opus-4-6-v1',
      outputModalities: ['TEXT'],
      providerName: 'Anthropic',
    })!;
    // Family is derived from providerName, NOT from parsing the model id.
    expect(out.family).toBe('anthropic');
    // Nothing in the API told us about tools/thinking, so we leave them
    // undefined rather than fabricate a "claude-4 supports thinking" flag.
    expect((out.capabilities as any)?.tools).toBeUndefined();
    expect((out.capabilities as any)?.thinking).toBeUndefined();
    expect((out as any).costTier).toBeUndefined();
  });
});

describe('extractFoundationIdFromProfile', () => {
  it('pulls the foundation id out of the underlying model ARN', () => {
    const out = extractFoundationIdFromProfile({
      models: [
        {
          modelArn:
            'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0',
        },
      ],
    });
    expect(out).toBe('anthropic.claude-3-5-haiku-20241022-v1:0');
  });

  it('returns null when no underlying models are present', () => {
    expect(extractFoundationIdFromProfile({})).toBeNull();
    expect(extractFoundationIdFromProfile({ models: [] })).toBeNull();
    expect(extractFoundationIdFromProfile({ models: [{}] })).toBeNull();
  });

  it('returns null for a malformed ARN', () => {
    expect(
      extractFoundationIdFromProfile({ models: [{ modelArn: 'not-an-arn' }] }),
    ).toBeNull();
  });
});

describe('indexFoundationSummaries', () => {
  it('keys by modelId and skips entries without one', () => {
    const idx = indexFoundationSummaries([
      { modelId: 'a.x-v1', providerName: 'A' },
      { providerName: 'B' },
      { modelId: 'c.y-v1', providerName: 'C' },
    ]);
    expect(idx.size).toBe(2);
    expect(idx.get('a.x-v1')?.providerName).toBe('A');
    expect(idx.get('c.y-v1')?.providerName).toBe('C');
  });
});

describe('bedrockInferenceProfileToDiscoveredModel', () => {
  const ancestor: BedrockFoundationSummary = {
    modelId: 'provider-x.cool-model-v1',
    modelName: 'Cool Model',
    providerName: 'ProviderX',
    inputModalities: ['TEXT', 'IMAGE'],
    outputModalities: ['TEXT'],
    responseStreamingSupported: true,
  };
  const ancestorIndex = indexFoundationSummaries([ancestor]);

  it('returns null when inferenceProfileId is missing', () => {
    expect(
      bedrockInferenceProfileToDiscoveredModel({}, ancestorIndex),
    ).toBeNull();
  });

  it('inherits capabilities from the linked foundation model', () => {
    const profile: BedrockInferenceProfileSummary = {
      inferenceProfileId: 'us.provider-x.cool-model-v1',
      inferenceProfileName: 'US Cool Model',
      models: [
        {
          modelArn:
            'arn:aws:bedrock:us-east-1::foundation-model/provider-x.cool-model-v1',
        },
      ],
    };
    const out = bedrockInferenceProfileToDiscoveredModel(
      profile,
      ancestorIndex,
    )!;
    expect(out.id).toBe('us.provider-x.cool-model-v1');
    expect(out.family).toBe('providerx');
    expect(out.capabilities?.chat).toBe(true);
    expect(out.capabilities?.vision).toBe(true);
    expect(out.capabilities?.streaming).toBe(true);
  });

  it('falls back to chat=true + streaming=true when ancestor lookup misses', () => {
    const orphan = bedrockInferenceProfileToDiscoveredModel(
      {
        inferenceProfileId: 'us.mystery-profile-v1',
        inferenceProfileName: 'Mystery',
        models: [
          {
            modelArn:
              'arn:aws:bedrock:us-east-1::foundation-model/mystery.not-in-index-v1',
          },
        ],
      },
      ancestorIndex,
    )!;
    // System-defined inference profiles are chat-invocable by contract —
    // our assumption is documented in the module. Vision remains false
    // because we refuse to guess without API evidence.
    expect(orphan.capabilities?.chat).toBe(true);
    expect(orphan.capabilities?.streaming).toBe(true);
    expect(orphan.capabilities?.vision).toBe(false);
  });

  it('works when no ancestor index is supplied (degraded defaults)', () => {
    const out = bedrockInferenceProfileToDiscoveredModel({
      inferenceProfileId: 'us.no-index-v1',
      inferenceProfileName: 'No Index',
    })!;
    expect(out.capabilities?.chat).toBe(true);
    expect(out.capabilities?.streaming).toBe(true);
  });

  it('never runs name-based substring matching to set thinking/tools/costTier', () => {
    // Even when the profile id looks like a Claude 4 string, we do not
    // fabricate `thinking: true`. This test guards against a future
    // refactor sneaking name-regex back in.
    const out = bedrockInferenceProfileToDiscoveredModel(
      {
        inferenceProfileId: 'us.anthropic.claude-opus-4-6-v1',
        inferenceProfileName: 'Claude Opus 4.6',
      },
      ancestorIndex,
    )!;
    expect((out.capabilities as any)?.thinking).toBeUndefined();
    expect((out.capabilities as any)?.tools).toBeUndefined();
    expect((out as any).costTier).toBeUndefined();
  });
});
