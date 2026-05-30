/**
 * Normalize the `capabilities` payload for POST/PUT /llm-providers/:id/models.
 *
 * Historical bug (2026-04-21): Add-Model callers sometimes omit the `tools`
 * field from capabilities. ModelCapabilityGate then reads `tools === undefined`
 * as "lacks tool support" and auto-upgrades the request to a different (often
 * nonexistent) model — causing 404s from AIF for pins that were actually
 * fine on Bedrock. Defaulting tools=true when chat=true and tools is absent
 * prevents this.
 *
 * Admin can still explicitly disable tools by passing `tools: false`.
 */

export interface CapabilitiesInput {
  chat?: boolean;
  vision?: boolean;
  tools?: boolean;
  streaming?: boolean;
  embeddings?: boolean;
  imageGeneration?: boolean;
  imageGen?: boolean;
  thinking?: boolean;
}

export interface NormalizedCapabilities {
  chat: boolean;
  vision: boolean;
  tools: boolean;
  streaming: boolean;
  embeddings: boolean;
  imageGeneration: boolean;
  thinking?: boolean;
}

/**
 * Returns a fully-populated capabilities object with sensible defaults based
 * on the admin-provided input. If the admin omits a field, we default based
 * on the others:
 *   - chat undefined → true if neither embeddings nor imageGen are set
 *   - tools undefined → true when chat=true (safe default — prevents the
 *     CapabilityGate auto-upgrade cascade)
 *   - streaming undefined → true when chat=true
 *   - others → explicit only (default false)
 */
export function normalizeAddModelCapabilities(
  input: CapabilitiesInput | null | undefined,
): NormalizedCapabilities {
  const caps = (input && typeof input === 'object') ? input : {};

  const isEmbeddingOnly = !!caps.embeddings && caps.chat === false;
  const isImageOnly     = (!!caps.imageGeneration || !!caps.imageGen) && caps.chat === false;

  // Default chat to true unless explicitly set to false, or unless the model
  // is clearly embedding-only / image-gen-only.
  const chat = caps.chat === false ? false : (!isEmbeddingOnly && !isImageOnly);

  // Chat-capable models need tools unless the admin explicitly disabled them.
  const tools = caps.tools === false ? false : (chat ? true : !!caps.tools);

  // Streaming follows the same default — every chat-capable model today
  // supports streaming; disable only on explicit request.
  const streaming = caps.streaming === false ? false : (chat ? true : !!caps.streaming);

  return {
    chat,
    vision: !!caps.vision,
    tools,
    streaming,
    embeddings: !!caps.embeddings,
    imageGeneration: !!caps.imageGeneration || !!caps.imageGen,
    ...(typeof caps.thinking === 'boolean' ? { thinking: caps.thinking } : {}),
  };
}
