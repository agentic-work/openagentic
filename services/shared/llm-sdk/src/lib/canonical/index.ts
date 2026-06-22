/**
 * SDK canonical invariants — shared types + helpers that future adapters
 * (canonical → provider wire) depend on. Mirrors the existing `normalizers/`
 * folder (provider wire → canonical) but for the OUTBOUND direction.
 *
 * the design notes
 *        §"Phase 0.2 — SDK shared canonical invariants"
 *
 * Public surface:
 *   - `CanonicalRequest` + supporting types (the outbound request shape).
 *   - Stop-reason mapping table — bidirectional across 5 providers.
 *   - Tool-use id normalization between canonical `toolu_*` and provider-native.
 *   - `stripCacheControl` — strip Anthropic-only `cache_control` for non-
 *     Anthropic adapters.
 *   - Thinking-block extraction helpers — one per provider native shape.
 *
 * Phase 0.3 (separate work) wires these into per-provider adapter classes
 * that translate `CanonicalRequest` → provider-native request bodies. This
 * Phase 0.2 module ships ONLY the invariants those adapters depend on.
 */

export {
  CANONICAL_REQUEST_VERSION,
  type CanonicalRequest,
  type CanonicalMessage,
  type CanonicalTool,
  type CanonicalToolChoice,
  type CanonicalRequestContentBlock,
  type CanonicalRequestTextBlock,
  type CanonicalRequestThinkingBlock,
  type CanonicalRequestToolUseBlock,
  type CanonicalRequestToolResultBlock,
  type CanonicalRequestToolResultContentBlock,
  type CanonicalRequestImageBlock,
  type CanonicalCacheControl,
} from './types.js';

export {
  mapAnthropicStopReason,
  mapOpenAIFinishReason,
  mapBedrockStopReason,
  mapVertexFinishReason,
  mapOllamaDoneReason,
  toAnthropicStopReason,
  toOpenAIFinishReason,
  toBedrockStopReason,
  toVertexFinishReason,
  toOllamaDoneReason,
  type CanonicalStopReason,
} from './stopReasons.js';

export {
  toToolu,
  fromToolu,
  type ProviderHint,
} from './toolIdNormalize.js';

export { stripCacheControl } from './stripCacheControl.js';

export {
  extractThinkingFromOpenAIDelta,
  extractThinkingFromAIFResponses,
  extractThinkingFromVertexGemini,
  extractThinkingFromOllamaContent,
  extractThinkingFromOllamaContentStreaming,
  type StreamingThinkState,
  type StreamingExtractOptions,
  wrapAsCanonicalThinking,
} from './thinkingShape.js';

export {
  completionRequestToCanonical,
  type LegacyCompletionRequestLike,
  type LegacyMessage,
} from './legacyShape.js';
