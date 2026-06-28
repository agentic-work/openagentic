/**
 * Outbound adapter registry + selector.
 *
 * The companion to ../normalizers/select.ts but for the OUT direction.
 * Provider classes call `selectOutboundAdapter(streamFormat)` once at request
 * time and dispatch through the returned adapter's `adaptRequest()`.
 *
 * the design notes
 *       §"Phase 0.3 — outbound adapters"
 */

import type { ProviderHint } from '../canonical/toolIdNormalize.js';
import type { IOutboundAdapter } from './AdapterContract.js';

import { OpenagenticToAnthropic } from './OpenagenticToAnthropic.js';
import { OpenagenticToAIFResponses } from './OpenagenticToAIFResponses.js';
import { OpenagenticToOpenAI } from './OpenagenticToOpenAI.js';
import { OpenagenticToBedrock } from './OpenagenticToBedrock.js';
import { OpenagenticToVertexGemini } from './OpenagenticToVertexGemini.js';
import { OpenagenticToOllama } from './OpenagenticToOllama.js';

export type { IOutboundAdapter } from './AdapterContract.js';
export { OpenagenticToAnthropic } from './OpenagenticToAnthropic.js';
export { OpenagenticToAIFResponses } from './OpenagenticToAIFResponses.js';
export { OpenagenticToOpenAI } from './OpenagenticToOpenAI.js';
export { OpenagenticToBedrock } from './OpenagenticToBedrock.js';
export { OpenagenticToVertexGemini } from './OpenagenticToVertexGemini.js';
export { OpenagenticToOllama } from './OpenagenticToOllama.js';

// Re-export the canonical request bridge so api providers can pull both
// the converter and the adapter selector from a single module path.
export { completionRequestToCanonical } from '../canonical/legacyShape.js';
export type {
  LegacyCompletionRequestLike,
  LegacyMessage,
} from '../canonical/legacyShape.js';
export type {
  CanonicalRequest,
  CanonicalMessage,
  CanonicalTool,
  CanonicalToolChoice,
} from '../canonical/types.js';
export type { ProviderHint } from '../canonical/toolIdNormalize.js';

/**
 * Select the outbound adapter for a given provider format.
 *
 * `provider` mirrors `CanonicalStreamFormat` from normalizers/select.ts plus
 * a `vertex` (Gemini non-Anthropic) entry for symmetry with `toolIdNormalize`.
 *
 * Returns a fresh instance per call — adapters are stateless so allocation is
 * cheap. Memoize at the provider class level if turn count is huge.
 */
export function selectOutboundAdapter(provider: ProviderHint): IOutboundAdapter {
  switch (provider) {
    case 'anthropic':
      return new OpenagenticToAnthropic();
    case 'bedrock-anthropic':
      return new OpenagenticToBedrock();
    case 'vertex-anthropic':
      // Vertex's Anthropic-on-Vertex path is request-shape-identical to direct
      // Anthropic except for the URL/auth layer (which the adapter doesn't own).
      return new OpenagenticToAnthropic();
    case 'foundry-anthropic':
      // AIF's Anthropic format on the /chat/completions endpoint uses the
      // Anthropic Messages request shape verbatim.
      return new OpenagenticToAnthropic();
    case 'aif-responses':
      return new OpenagenticToAIFResponses();
    case 'openai':
      return new OpenagenticToOpenAI();
    case 'vertex':
      return new OpenagenticToVertexGemini();
    case 'ollama':
      return new OpenagenticToOllama();
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}
