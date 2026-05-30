/**
 * Tool-use ID normalization — canonical format is Anthropic's `toolu_*`.
 *
 * The Anthropic Messages API emits tool_use blocks with `id: "toolu_..."`.
 * Downstream openagentic code (chat-loop dispatch, sub-agent correlation,
 * audit logs, HITL approvals, sub-tool result reconciliation) keys on this
 * exact prefix. So inbound from non-Anthropic providers we normalize the
 * provider native id to `toolu_*`; outbound we strip and re-prefix per
 * provider hint.
 *
 * Audit references in the api today (each one of these has its own ad-hoc
 * normalization that this module replaces):
 *   - OllamaProvider — `synthesizeToolUseId()` (lib/normalizers — moved to SDK).
 *   - OpenAIProvider — sometimes preserves call_*, sometimes ignores.
 *   - VertexGeminiProvider — vc_* prefix on outbound, no inbound normalize.
 *   - BedrockProvider — already-canonical toolu_* (Anthropic-on-Bedrock).
 *   - AIF Responses — `call_*` echoes from gpt-5.x.
 *
 * Spec: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */

/** Provider format discriminator — same union the future adapters will
 * dispatch on. Mirrors `CanonicalStreamFormat` plus `vertex` (Gemini
 * non-Anthropic). */
export type ProviderHint =
  | 'anthropic'
  | 'bedrock-anthropic'
  | 'openai'
  | 'ollama'
  | 'vertex'
  | 'vertex-anthropic'
  | 'aif-responses'
  | 'foundry-anthropic';

const CANONICAL_PREFIX = 'toolu_';

// Allowed characters in a canonical tool_use id body (after the prefix).
// Match what the Anthropic Messages API actually emits — alphanumeric +
// underscore + hyphen. Any other character is replaced with underscore.
const CANONICAL_BODY_RE = /[^A-Za-z0-9_-]/g;

/** Inbound — normalize a provider-native tool_use id to canonical
 * `toolu_*` shape. Idempotent when given an already-canonical id. */
export function toToolu(rawId: string, _provider: ProviderHint): string {
  if (rawId.startsWith(CANONICAL_PREFIX)) {
    return rawId;
  }
  const sanitized = rawId.replace(CANONICAL_BODY_RE, '_');
  return CANONICAL_PREFIX + sanitized;
}

/** Outbound — convert a canonical `toolu_*` id to the provider's native
 * prefix shape. Defensive on already-native ids: returns input unchanged
 * if it doesn't start with `toolu_` (boundary safety). */
export function fromToolu(canonicalId: string, provider: ProviderHint): string {
  if (!canonicalId.startsWith(CANONICAL_PREFIX)) {
    return canonicalId;
  }
  const body = canonicalId.slice(CANONICAL_PREFIX.length);

  switch (provider) {
    case 'anthropic':
    case 'bedrock-anthropic':
    case 'foundry-anthropic':
    case 'vertex-anthropic':
      // Anthropic-shape clouds want the canonical `toolu_*` prefix preserved.
      return canonicalId;

    case 'openai':
    case 'aif-responses':
    case 'ollama':
      // OpenAI Chat Completions + Azure AIF Responses API + Ollama all use
      // `call_*` natively for tool_call ids. If the canonical body already
      // starts with `call_` (because the inbound id was already native, e.g.
      // `call_abc` → canonical `toolu_call_abc` per `toToolu`), avoid
      // re-prefixing — that would emit `call_call_abc` and break the
      // round-trip when the model echoes the id back in tool_call_id.
      return body.startsWith('call_') ? body : 'call_' + body;

    case 'vertex':
      // Vertex Gemini function-calls don't have a native id slot at the wire
      // level (Gemini's functionCall has no id field), but downstream
      // openagentic code that produces a synthetic outbound id uses `vc_*`
      // so adapters can recognize own-emit on echo-back.
      return body.startsWith('vc_') ? body : 'vc_' + body;

    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}
