/**
 * selectChatCapableFallback — the chat-capable "first available" fallback.
 *
 * THE BUG THIS FIXES (live on 0.7.1-71516d01b, RAG exec 525cbda2 +
 * Knowledge-Base exec 0bf49161):
 *
 *   A flow LLM node (or any agent) sends `model:"auto"` to the smart
 *   router. TaskAnalysis returns no suggestion, so the route fell back to
 *   `ProviderManager.listModels()[0].id`. `listModels()` hardcodes
 *   `type:'chat'` for EVERY model and returns them in provider/discovery
 *   order — so the embedding model `nomic-embed-text:latest` (the first
 *   discovered Ollama model) was selected for a CHAT request. Ollama then
 *   returns `400 "nomic-embed-text:latest" does not support chat`, the
 *   terminal node fails, and the whole flow shows failed/empty.
 *
 * THE FIX:
 *   The "first available" fallback must NEVER return a model that is not
 *   chat-capable for a chat/completion request. We:
 *     1. Filter the candidate pool to chat-capable models using the
 *        AUTHORITATIVE discovered/registry capability (`capabilities.chat`
 *        — NOT a name substring check, no hardcoded ids).
 *     2. Return the first chat-capable candidate.
 *     3. If none of the listed candidates can be PROVEN chat-capable,
 *        deterministically resolve the chat-role default from the Registry
 *        SoT (`resolveChatModelId`). An embedding-only model can never win.
 *
 * This module is deliberately pure + dependency-injected so it can be
 * unit-tested against the real Registry capability shape without booting
 * the full ProviderManager.
 */

/** Minimal shape of a model entry from ProviderManager.listModels(). */
export interface ListedModel {
  id: string;
  provider?: string;
  [k: string]: unknown;
}

/**
 * Discovered/registry capability flags. Mirrors
 * `ILLMProvider.DiscoveredModel.capabilities`. Only `chat` is consulted
 * here; the rest are accepted so callers can pass the whole object through.
 */
export interface ModelCapabilityFlags {
  chat?: boolean;
  embeddings?: boolean;
  [k: string]: unknown;
}

export interface SelectChatCapableFallbackDeps {
  /**
   * Look up the AUTHORITATIVE discovered capabilities for a model id.
   * Wire this to `ProviderManager.getDiscoveredCapabilities(id)?.capabilities`.
   * Returns null/undefined when the model has not been discovered.
   */
  getCapabilities: (modelId: string) => ModelCapabilityFlags | null | undefined;
  /**
   * Deterministic chat-role default from the Registry SoT.
   * Wire this to `resolveChatModelId` from ./resolveModel.js.
   * Only invoked when no listed candidate can be proven chat-capable.
   */
  resolveChatDefault: () => Promise<string>;
  /** Optional structured logger (pino-shaped). */
  logger?: { info?: (o: unknown, m?: string) => void; warn?: (o: unknown, m?: string) => void };
}

/**
 * True only when the model's AUTHORITATIVE capabilities prove it is
 * chat-capable. Unknown capabilities are treated as NOT chat-capable for
 * the purpose of the fallback selection — we never *guess* a model into a
 * chat request when a deterministic chat-role default is available. An
 * embedding-only model (`chat:false` and/or `embeddings:true`) is always
 * rejected.
 *
 * NOTE: this is a capability check, NOT a name check. No model-id string
 * matching, no hardcoded ids (see docs/rules/no-hardcoded-models.md).
 */
export function isProvenChatCapable(
  caps: ModelCapabilityFlags | null | undefined,
): boolean {
  if (!caps) return false;
  // Explicit non-chat / embedding-only → never chat-capable.
  if (caps.chat === false) return false;
  if (caps.embeddings === true && caps.chat !== true) return false;
  // Only an explicit chat:true proves it.
  return caps.chat === true;
}

/**
 * Pick a chat-capable model from `listedModels`, falling back to the
 * deterministic Registry chat-role default. NEVER returns an embedding-only
 * / non-chat model for a chat request.
 *
 * @throws if neither a chat-capable listed candidate NOR a Registry chat
 *         default can be resolved (no chat model exists at all). The caller
 *         should surface this as an actionable "no chat model available"
 *         error rather than silently dispatching to a non-chat model.
 */
export async function selectChatCapableFallback(
  listedModels: ListedModel[],
  deps: SelectChatCapableFallbackDeps,
): Promise<string> {
  const { getCapabilities, resolveChatDefault, logger } = deps;

  // 1. First listed candidate that is PROVEN chat-capable.
  for (const m of listedModels) {
    if (!m?.id) continue;
    const caps = getCapabilities(m.id);
    if (isProvenChatCapable(caps)) {
      logger?.info?.(
        { selectedModel: m.id, provider: m.provider, via: 'first-chat-capable' },
        '[chat-fallback] selected first chat-capable listed model',
      );
      return m.id;
    }
  }

  // 2. No listed candidate proven chat-capable → deterministic Registry
  //    chat-role default. This guarantees an embedding-only model can never
  //    be selected for a chat request even when it is the only thing
  //    `listModels()` surfaced first.
  const skipped = listedModels.map((m) => m?.id).filter(Boolean);
  logger?.warn?.(
    { skippedNonChatCapable: skipped },
    '[chat-fallback] no listed model proven chat-capable — resolving Registry chat-role default',
  );
  const chatDefault = await resolveChatDefault();
  if (!chatDefault) {
    throw new Error(
      'No chat-capable model available: none of the listed models are chat-capable and no chat-role default is configured in the Registry.',
    );
  }
  logger?.info?.(
    { selectedModel: chatDefault, via: 'registry-chat-default' },
    '[chat-fallback] selected Registry chat-role default',
  );
  return chatDefault;
}
