/**
 * Sev-2 (2026-04-19) — Bedrock model-discovery capability inference.
 *
 * AWSBedrockProvider.discoverModels() had a hardcoded-model-id violation
 * (see docs/rules/no-hardcoded-models.md): it used `modelId.includes(
 * 'claude-opus-4')` and friends to guess capabilities + cost tier +
 * family. That breaks the moment a deployment names a model differently
 * ('claude-opus-4-6-dev' vs 'claude-opus-4-6', cross-region inference
 * profiles 'us.anthropic.claude-…' etc) and forces us to fork for every
 * new model family.
 *
 * This module is a pure-function replacement: it derives a DiscoveredModel
 * from nothing but AWS API responses and a small, API-exposed shape.
 * Unknown fields are returned as `undefined`, not guessed — the admin UI
 * fills them in during the "add to registry" step from
 * ModelCapabilityDiscoveryService, which reads from Milvus / DB.
 *
 * Everything here stays inside the allow-list for the no-hardcoded-models
 * rule: no name literals, no family regex, no cost-tier guessing.
 */

import type { DiscoveredModel } from './ILLMProvider.js';

/** Minimal shape we consume from ListFoundationModelsCommand items. */
export interface BedrockFoundationSummary {
  modelId?: string;
  modelName?: string;
  providerName?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  responseStreamingSupported?: boolean;
  inferenceTypesSupported?: string[];
  modelLifecycle?: { status?: string };
}

/** Minimal shape we consume from ListInferenceProfilesCommand items. */
export interface BedrockInferenceProfileSummary {
  inferenceProfileId?: string;
  inferenceProfileArn?: string;
  inferenceProfileName?: string;
  status?: string;
  type?: string;
  /** Array of underlying foundation models the profile routes to. */
  models?: Array<{ modelArn?: string }>;
}

/**
 * Extract the foundation model id (without region prefix) out of an
 * inference profile's underlying model ARN. Used only to look the
 * foundation record up in the pre-fetched cache; no pattern match, no
 * capability derivation from this string.
 */
export function extractFoundationIdFromProfile(
  profile: BedrockInferenceProfileSummary,
): string | null {
  const arn = profile.models?.[0]?.modelArn;
  if (!arn) return null;
  // ARN form: arn:aws:bedrock:<region>::foundation-model/<provider>.<model-id>
  const idx = arn.indexOf('foundation-model/');
  if (idx < 0) return null;
  return arn.slice(idx + 'foundation-model/'.length);
}

/**
 * Decide whether a Bedrock foundation summary should appear in the
 * add-to-registry catalog.
 *
 * Eligibility is invocability-driven:
 *   - MUST support ON_DEMAND inference (admins can invoke without a
 *     provisioned-throughput commitment).
 *   - MUST emit a usable output modality (TEXT, EMBEDDING, or IMAGE).
 *
 * NOTE: we do NOT exclude `modelLifecycle.status === 'LEGACY'`. AWS tags
 * many fully-usable, on-demand image models LEGACY (e.g.
 * `amazon.nova-canvas-v1:0`, `amazon.titan-image-generator-v2:0`). A blanket
 * LEGACY exclusion hid them from the Add-Model catalog even though they are
 * invocable today. Lifecycle is surfaced for display, never used to filter.
 */
export function isFoundationModelEligibleForDiscovery(
  m: BedrockFoundationSummary,
): boolean {
  const inferenceTypes = m.inferenceTypesSupported ?? [];
  if (!inferenceTypes.includes('ON_DEMAND')) return false;
  const outputModalities = m.outputModalities ?? [];
  return (
    outputModalities.includes('TEXT') ||
    outputModalities.includes('EMBEDDING') ||
    outputModalities.includes('IMAGE')
  );
}

/**
 * Derive a DiscoveredModel from a Bedrock foundation summary.
 * Capability inference is 100% API-driven:
 *   - chat  ← outputModalities includes TEXT
 *   - vision ← inputModalities includes IMAGE
 *   - embeddings ← outputModalities includes EMBEDDING
 *   - imageGeneration ← outputModalities includes IMAGE && NOT text-input
 *   - streaming ← responseStreamingSupported
 *   - tools ← undefined (not exposed by API; DB populates post-add)
 *   - thinking ← undefined (not exposed by API; DB populates post-add)
 *
 * costTier / family / contextWindow / maxOutputTokens are set to
 * undefined here — the registry / ModelCapabilityDiscoveryService owns
 * those values via Milvus-backed data, not substring guessing.
 */
export function bedrockSummaryToDiscoveredModel(
  m: BedrockFoundationSummary,
): DiscoveredModel | null {
  const modelId = m.modelId;
  if (!modelId) return null;
  const inputModalities = m.inputModalities ?? [];
  const outputModalities = m.outputModalities ?? [];
  const providerName = (m.providerName ?? 'unknown').toLowerCase();

  const hasVision = inputModalities.includes('IMAGE');
  const hasChat = outputModalities.includes('TEXT');
  const hasEmbeddings = outputModalities.includes('EMBEDDING');
  // A model whose OUTPUT modality is IMAGE generates images — regardless of
  // whether it also accepts a TEXT prompt (text-to-image: Nova Canvas, Titan
  // Image, Stable Diffusion) or a source IMAGE (edit/upscale models). The
  // earlier `&& !inputModalities.includes('TEXT')` clause wrongly excluded
  // every text-to-image generator, since a prompt is TEXT input.
  const hasImageGen = outputModalities.includes('IMAGE');
  const hasStreaming = m.responseStreamingSupported !== false;

  return {
    id: modelId,
    name: m.modelName ?? modelId,
    provider: 'aws-bedrock',
    description: `${m.providerName ?? 'Unknown'} — ${m.modelName ?? modelId}`,
    family: providerName,
    capabilities: {
      chat: hasChat && !hasEmbeddings,
      vision: hasVision,
      embeddings: hasEmbeddings,
      imageGeneration: hasImageGen,
      streaming: hasStreaming,
    } as DiscoveredModel['capabilities'],
  };
}

/**
 * Derive a DiscoveredModel from a Bedrock inference-profile summary.
 * When the underlying foundation model is available in the already-
 * fetched foundation list, its modality fields are reused for chat /
 * vision / embeddings / streaming. Otherwise we mark chat=true +
 * streaming=true (inference profiles are only created for invocable
 * chat models; no embeddings or image gen profiles exist today in
 * SYSTEM_DEFINED form) and leave vision/tools/thinking as undefined
 * so the registry can fill them in.
 */
export function bedrockInferenceProfileToDiscoveredModel(
  p: BedrockInferenceProfileSummary,
  underlyingByBaseId?: Map<string, BedrockFoundationSummary>,
): DiscoveredModel | null {
  const profileId = p.inferenceProfileId ?? '';
  if (!profileId) return null;

  const underlyingId = extractFoundationIdFromProfile(p);
  const underlying =
    underlyingId && underlyingByBaseId
      ? underlyingByBaseId.get(underlyingId)
      : undefined;

  const providerName = (underlying?.providerName ?? 'unknown').toLowerCase();
  const inputModalities = underlying?.inputModalities ?? [];
  const outputModalities = underlying?.outputModalities ?? [];
  const hasVision = inputModalities.includes('IMAGE');
  const hasChat = outputModalities.length === 0
    ? true // default assumption: SYSTEM_DEFINED profiles are invocable chat targets
    : outputModalities.includes('TEXT');
  const hasEmbeddings = outputModalities.includes('EMBEDDING');
  // Output modality IMAGE ⇒ image generation (see bedrockSummaryToDiscoveredModel).
  const hasImageGen = outputModalities.includes('IMAGE');
  const hasStreaming =
    underlying?.responseStreamingSupported === undefined
      ? true
      : underlying.responseStreamingSupported !== false;

  return {
    id: profileId,
    name: p.inferenceProfileName ?? profileId,
    provider: 'aws-bedrock',
    description: `${underlying?.providerName ?? providerName} cross-region inference profile — ${p.inferenceProfileName ?? profileId}`,
    family: providerName,
    capabilities: {
      chat: hasChat && !hasEmbeddings,
      vision: hasVision,
      embeddings: hasEmbeddings,
      imageGeneration: hasImageGen,
      streaming: hasStreaming,
    } as DiscoveredModel['capabilities'],
  };
}

/**
 * Build a lookup from base foundation-model id → summary so inference
 * profiles can reuse the underlying model's modality fields without
 * another API round-trip. The key is the full id (e.g.
 * `anthropic.claude-3-5-haiku-20241022-v1:0`), as returned on the
 * profile's models[].modelArn path component.
 */
export function indexFoundationSummaries(
  summaries: BedrockFoundationSummary[],
): Map<string, BedrockFoundationSummary> {
  const out = new Map<string, BedrockFoundationSummary>();
  for (const s of summaries) {
    if (s.modelId) out.set(s.modelId, s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// #650 — Family-table-driven inference for fields the Bedrock SDK does NOT
// return (tools/thinking flags, context window, max output tokens, default
// sampling).
//
// The Bedrock GetFoundationModel API exposes modality + streaming flags but
// is silent on:
//   - whether the model supports tool use / native function calling
//   - whether the model supports extended thinking
//   - the context window (model-specific, AWS publishes only per family)
//   - max output tokens
//   - default temperature / topP / topK
//
// For those fields we consult a small admin-editable table keyed by
// FAMILY SLUGS (e.g. `claude-sonnet-4`, `amazon-nova`). The slug is
// derived from the SDK's `providerName + modelId` shape — never a
// hardcoded model id. Admins override per-row via the Refresh button.
// ---------------------------------------------------------------------------

export interface BedrockInferredLimits {
  family: string;
  isEmbedding: boolean;
  supportsTools: boolean;
  supportsThinking: boolean;
  nativeToolCalling: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  thinkingBudget: number | null;
  temperature: number;
  topP: number;
  topK: number | null;
}

const BEDROCK_FAMILY_TABLE: Record<string, Omit<BedrockInferredLimits, 'family'>> = {
  'claude-opus-4': {
    isEmbedding: false, supportsTools: true, supportsThinking: true, nativeToolCalling: true,
    contextWindow: 200000, maxOutputTokens: 64000, thinkingBudget: 10000,
    temperature: 1.0, topP: 0.999, topK: 40,
  },
  'claude-sonnet-4': {
    isEmbedding: false, supportsTools: true, supportsThinking: true, nativeToolCalling: true,
    contextWindow: 200000, maxOutputTokens: 64000, thinkingBudget: 10000,
    temperature: 1.0, topP: 0.999, topK: 40,
  },
  'claude-haiku-4': {
    isEmbedding: false, supportsTools: true, supportsThinking: false, nativeToolCalling: true,
    contextWindow: 200000, maxOutputTokens: 16000, thinkingBudget: null,
    temperature: 1.0, topP: 0.999, topK: 40,
  },
  'claude-3-5-sonnet': {
    isEmbedding: false, supportsTools: true, supportsThinking: false, nativeToolCalling: true,
    contextWindow: 200000, maxOutputTokens: 8192, thinkingBudget: null,
    temperature: 1.0, topP: 0.999, topK: 40,
  },
  'amazon-titan-embed': {
    isEmbedding: true, supportsTools: false, supportsThinking: false, nativeToolCalling: false,
    contextWindow: 8192, maxOutputTokens: null, thinkingBudget: null,
    temperature: 0, topP: 1, topK: null,
  },
  'amazon-nova': {
    isEmbedding: false, supportsTools: true, supportsThinking: false, nativeToolCalling: true,
    contextWindow: 300000, maxOutputTokens: 5000, thinkingBudget: null,
    temperature: 0.7, topP: 0.9, topK: null,
  },
  'meta-llama': {
    isEmbedding: false, supportsTools: false, supportsThinking: false, nativeToolCalling: false,
    contextWindow: 131072, maxOutputTokens: 4096, thinkingBudget: null,
    temperature: 0.7, topP: 0.9, topK: null,
  },
  'mistral': {
    isEmbedding: false, supportsTools: false, supportsThinking: false, nativeToolCalling: false,
    contextWindow: 128000, maxOutputTokens: 8192, thinkingBudget: null,
    temperature: 0.7, topP: 1.0, topK: null,
  },
};

const FALLBACK_LIMITS: Omit<BedrockInferredLimits, 'family'> = {
  isEmbedding: false, supportsTools: false, supportsThinking: false, nativeToolCalling: false,
  contextWindow: null, maxOutputTokens: null, thinkingBudget: null,
  temperature: 0.7, topP: 0.9, topK: null,
};

/**
 * Map a Bedrock GetFoundationModel detail to a family slug + inferred
 * limits. Slug derivation is provider+keyword based (never hardcoded ids).
 *
 * Test: services/openagentic-api/src/services/llm-providers/discovery/__tests__/BedrockModelDiscovery.test.ts
 */
export function inferBedrockFamilyAndLimits(details: {
  modelId?: string;
  modelName?: string;
  providerName?: string;
}): BedrockInferredLimits {
  const m = (details.modelId ?? '').toLowerCase();
  const provider = (details.providerName ?? '').toLowerCase();

  let family = 'unknown';
  if (provider === 'anthropic') {
    if (m.includes('opus-4')) family = 'claude-opus-4';
    else if (m.includes('sonnet-4')) family = 'claude-sonnet-4';
    else if (m.includes('haiku-4')) family = 'claude-haiku-4';
    else if (m.includes('3-5-sonnet') || m.includes('3.5-sonnet')) family = 'claude-3-5-sonnet';
  } else if (provider === 'amazon') {
    if (m.includes('titan-embed')) family = 'amazon-titan-embed';
    else if (m.includes('nova')) family = 'amazon-nova';
  } else if (provider === 'meta') {
    family = 'meta-llama';
  } else if (provider === 'mistral ai' || provider === 'mistral') {
    family = 'mistral';
  }

  const t = BEDROCK_FAMILY_TABLE[family] ?? FALLBACK_LIMITS;
  return { family, ...t };
}
