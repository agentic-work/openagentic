/**
 * Canonical normalizer factory — one accumulator per provider stream format.
 * The pipeline calls `selectCanonicalNormalizer(format, opts)` once per
 * stream and feeds the provider's native chunks through `consume()` /
 * `finalize()`. Output is the canonical `CanonicalEvent` (Anthropic Messages
 * SSE wire-exact) — never provider-specific shapes downstream.
 *
 * Architecture parity: matches Anthropic Claude Code's claude.ts:1997-2111
 * single-accumulator-per-stream pattern. Providers stay dumb chunk pipes;
 * the pipeline owns canonicalization via this factory.
 *
 * SoT note: this factory + the `CanonicalStreamFormat` discriminator live
 * in the SDK (here). openagentic-api previously invented its own copy —
 * that copy is being removed in the same consolidation.
 */

import type { CanonicalEvent } from './CanonicalEvent.js';
import {
  createAIFResponsesToOpenagenticNormalizer,
  createAnthropicShapeToOpenagenticNormalizer,
  createBedrockToOpenagenticNormalizer,
  createFoundryAnthropicToOpenagenticNormalizer,
  createGemmaToOpenagenticNormalizer,
  createOllamaToOpenagenticNormalizer,
  createOpenAIToOpenagenticNormalizer,
  createVertexAnthropicToOpenagenticNormalizer,
  createVertexGeminiToOpenagenticNormalizer,
} from './index.js';

/**
 * Canonical stream format discriminator. Every provider declares one of
 * these via `provider.streamFormat` and the pipeline picks the matching
 * SDK normalizer factory.
 *
 * - `anthropic`        — direct Anthropic Messages API (native SSE)
 * - `bedrock-anthropic`— AWS Bedrock invocation of an Anthropic model
 * - `vertex-anthropic` — Vertex AI Anthropic Claude endpoints
 * - `foundry-anthropic`— Azure AI Foundry Anthropic deployments
 * - `ollama`           — Ollama native chat NDJSON
 * - `openai`           — OpenAI Chat Completions (Azure OpenAI, OpenAI direct)
 * - `gemini`           — Vertex AI Gemini streaming
 * - `aif-responses`    — Azure AI Foundry Responses API (`/v1/responses`)
 * - `gemma`            — Gemma open-model text/tool-call stream (```tool_calls fenced)
 */
export type CanonicalStreamFormat =
  | 'anthropic'
  | 'bedrock-anthropic'
  | 'vertex-anthropic'
  | 'foundry-anthropic'
  | 'ollama'
  | 'openai'
  | 'gemini'
  | 'aif-responses'
  | 'gemma';

export interface CanonicalNormalizerOptions {
  /** Stable id for the assistant message — used as `message.id` in the canonical
   * `message_start` event so downstream consumers can correlate frames. */
  messageId: string;
  /** Model id surfaced in `message_start.message.model`. Defaults to `'unknown'`. */
  model?: string;
  /** Override the synthetic tool_use id prefix. Defaults to `'toolu_'`. */
  toolIdPrefix?: string;
}

export interface CanonicalNormalizer {
  consume(chunk: any): CanonicalEvent[];
  finalize(): CanonicalEvent[];
}

export function selectCanonicalNormalizer(
  format: CanonicalStreamFormat,
  opts: CanonicalNormalizerOptions,
): CanonicalNormalizer {
  switch (format) {
    case 'anthropic':
      return createAnthropicShapeToOpenagenticNormalizer(opts);
    case 'bedrock-anthropic':
      return createBedrockToOpenagenticNormalizer(opts);
    case 'vertex-anthropic':
      return createVertexAnthropicToOpenagenticNormalizer(opts);
    case 'foundry-anthropic':
      return createFoundryAnthropicToOpenagenticNormalizer(opts);
    case 'ollama':
      return createOllamaToOpenagenticNormalizer(opts);
    case 'openai':
      return createOpenAIToOpenagenticNormalizer(opts);
    case 'gemini':
      return createVertexGeminiToOpenagenticNormalizer(opts);
    case 'aif-responses':
      return createAIFResponsesToOpenagenticNormalizer(opts);
    case 'gemma':
      return createGemmaToOpenagenticNormalizer(opts);
    default: {
      const _exhaustive: never = format;
      throw new Error(
        `selectCanonicalNormalizer: unsupported stream format: ${String(_exhaustive)}`,
      );
    }
  }
}
