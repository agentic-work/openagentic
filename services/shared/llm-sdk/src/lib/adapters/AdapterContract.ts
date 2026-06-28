/**
 * Outbound adapter contract — canonical CanonicalRequest → provider wire body.
 *
 * Inverse of the inbound normalizers in ../normalizers/. Every adapter is a
 * pure transform function — no IO, no auth, no streaming — it just converts
 * canonical shapes into the JSON body shape each provider expects.
 *
 * Why: every provider class in services/openagentic-api/src/services/llm-providers/
 * currently hand-rolls its own convertMessages / convertTools function. This
 * lifts that conversion into one SoT per provider, so the api code becomes a
 * thin transport wrapper:
 *
 *     const adapter = selectOutboundAdapter(this.streamFormat);
 *     const body = adapter.adaptRequest(canonicalReq);
 *     const resp = await fetch(this.endpoint, { method: 'POST', body: JSON.stringify(body), ... });
 *
 * the design notes
 *       §"Phase 0.3 — outbound adapters"
 */

import type { CanonicalRequest } from '../canonical/types.js';
import type { ProviderHint } from '../canonical/toolIdNormalize.js';

export interface IOutboundAdapter {
  /** Discriminator — same value `selectOutboundAdapter()` keys off. */
  readonly format: ProviderHint;

  /**
   * Transform a CanonicalRequest into the provider's wire body. The result
   * is the JSON object to POST to the provider's /messages | /chat/completions
   * | /v1/responses | /generateContent | /api/chat endpoint. Auth headers,
   * URL, and timeouts are the caller's concern.
   *
   * Implementations MUST:
   *   1. Drop `cache_control` markers when target != Anthropic-shape.
   *   2. Convert tool_use_id `toolu_*` → provider-native via `fromToolu`.
   *   3. Map system prompt to the provider's slot (separate field for OpenAI/
   *      AIF/Anthropic/Bedrock; inlined for Gemini classic / older Ollama).
   *   4. Preserve thinking blocks across history when the wire allows it
   *      (Anthropic, AIF Responses) — drop only on wires that can't carry
   *      them (OpenAI Chat, Ollama, Vertex Gemini).
   *   5. NEVER throw on unknown canonical fields — adapters are forward-
   *      compatible. Log + drop unknown blocks rather than crash.
   */
  adaptRequest(req: CanonicalRequest): unknown;
}
