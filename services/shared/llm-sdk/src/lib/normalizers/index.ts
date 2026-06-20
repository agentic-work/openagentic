/**
 * Stream normalizers — translate provider-native streaming chunks into the
 * canonical OpenAgentic Messages SSE event union, plus the OpenAgentic
 * superset extensions (tool execution, sub-agents, RAG citations,
 * artifacts, HITL, viz hints, cost pulses, etc).
 *
 * Every provider wrapper in `@agentic-work/llm-sdk` uses one of these
 * normalizers to translate raw cloud SSE/NDJSON into the canonical event
 * union the rest of the platform consumes. Downstream services
 * (openagentic-api, workflows, and other consumers) see ONLY
 * canonical OpenAgentic events. Provider differences become invisible.
 *
 * Spec: docs/superpowers/specs/2026-05-01-canonical-stream-normalizer.md
 *
 * Architecture: each normalizer is a pure state machine — feed native
 * provider chunks one at a time via `consume()`, collect emitted canonical
 * events; call `finalize()` at stream end to flush wrapper events. The
 * OpenAgentic SDK owns the canonical taxonomy and extends it with platform
 * events the upstream providers have no concept of (sub-agents, HITL,
 * artifacts, RAG, cost, tier handoff, etc).
 */

// Shared canonical event union — every normalizer emits this exact shape.
export type {
  CanonicalEvent,
  CanonicalContentBlock,
  CanonicalDelta,
  CanonicalStopReason,
} from './CanonicalEvent.js';

export {
  createOpenAIToOpenagenticNormalizer,
  type OpenAIToolCallDelta,
  type OpenAIChoice,
  type OpenAIChunk,
  type Normalizer as OpenAINormalizer,
  type NormalizerOptions as OpenAINormalizerOptions,
} from './OpenAIToOpenagentic.js';

export {
  createOllamaToOpenagenticNormalizer,
  type OllamaToolCall,
  type OllamaMessage,
  type OllamaChunk,
  type Normalizer as OllamaNormalizer,
  type NormalizerOptions as OllamaNormalizerOptions,
} from './OllamaToOpenagentic.js';

export {
  createVertexGeminiToOpenagenticNormalizer,
  type GeminiFunctionCall,
  type GeminiPart,
  type GeminiContent,
  type GeminiCandidate,
  type GeminiChunk,
  type Normalizer as VertexGeminiNormalizer,
  type NormalizerOptions as VertexGeminiNormalizerOptions,
} from './VertexGeminiToOpenagentic.js';

export {
  createAIFResponsesToOpenagenticNormalizer,
  type AIFOutputTextPart,
  type AIFMessageOutput,
  type AIFFunctionCallOutput,
  type AIFOutputItem,
  type AIFResponsesEnvelope,
  type Normalizer as AIFResponsesNormalizer,
  type NormalizerOptions as AIFResponsesNormalizerOptions,
} from './AIFResponsesToOpenagentic.js';

export {
  createAnthropicShapeToOpenagenticNormalizer,
  createBedrockToOpenagenticNormalizer,
  createVertexAnthropicToOpenagenticNormalizer,
  createFoundryAnthropicToOpenagenticNormalizer,
  type AnthropicShapeChunk,
  type AnthropicShapeMessageStart,
  type AnthropicShapeContentBlockStart,
  type AnthropicShapeContentBlockDelta,
  type AnthropicShapeContentBlockStop,
  type AnthropicShapeMessageDelta,
  type AnthropicShapeMessageStop,
  type AnthropicShapePing,
  type Normalizer as AnthropicShapeNormalizer,
  type NormalizerOptions as AnthropicShapeNormalizerOptions,
} from './AnthropicShapeToOpenagentic.js';

export {
  createGemmaToOpenagenticNormalizer,
  type GemmaChunk,
  type Normalizer as GemmaNormalizer,
  type NormalizerOptions as GemmaNormalizerOptions,
} from './GemmaToOpenagentic.js';

// Format-discriminated factory dispatch — single entry-point downstream
// consumers use to obtain the right normalizer for a given provider stream.
export {
  selectCanonicalNormalizer,
  type CanonicalStreamFormat,
  type CanonicalNormalizer,
  type CanonicalNormalizerOptions,
} from './select.js';
