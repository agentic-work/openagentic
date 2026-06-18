import { ModelConfigurationService } from '../../services/ModelConfigurationService.js';

/**
 * Minimal SmartModelRouter surface used by resolveChatModel.
 * Defined locally to avoid pulling in the full service module at the
 * resolver-import boundary; downstream callers pass the real instance.
 *
 * Q1-fix-10: `opts` 3rd arg carries `priorClassification` so the router
 * can thread it into PromptClassifier for conversation-context
 * inheritance. The 2nd `userId` arg stays unused here — kept positional
 * so the live SmartModelRouter signature still matches.
 */
export interface ChatModelRouter {
  routeRequest(
    req: any,
    userId?: string,
    opts?: { priorClassification?: string },
  ): Promise<{
    selectedModel?: { modelId: string };
    /**
     * True when the router escalated above the chat-pool because the prompt
     * structurally requires it (T3 capability gate / agentic capability
     * profile). Under the default-first contract this is the ONLY signal
     * that lets the router's pick override the configured DB chat default.
     */
    escalated?: boolean;
    resolvedBy?: string;
    [k: string]: any;
  }>;
}

/**
 * Precedence (DB is SoT — never reads process.env):
 *   1. explicitModel    — caller specified it (request body, stream handler)
 *   2. sessionModel     — persisted on the session row
 *   3. SmartModelRouter — FCA-FLOOR ROUTING (2026-05-24, user direction):
 *                         when `smartRouter` is supplied AND no explicit/
 *                         session, consult it and HONOR ITS PICK IN BOTH
 *                         DIRECTIONS. The router only returns a candidate that
 *                         passes the RouterTuning FCA floor for the prompt's
 *                         complexity, so its pick is authoritative — DOWN to a
 *                         cheap model (gpt-oss:20b) for trivial prompts and
 *                         trivial follow-ups, UP for hard prompts. This makes
 *                         "what is 2+2" actually use gpt-oss:20b instead of
 *                         burning the (Sonnet) default. The DB default in
 *                         step 4 is the FALLBACK (router produced no valid
 *                         pick / errored / absent), not an override.
 *                         A deliberate capability REFUSAL the router throws
 *                         (NO_T3_MODEL_IN_REGISTRY / No models available /
 *                         NO_VISION_MODEL on an image turn with no vision
 *                         model) is propagated — never downgraded to the
 *                         cheap default.
 *   4. ModelConfigurationService.getDefaultChatModel() — DB-backed default
 *                         (fallback when the router yields no valid pick)
 *   5. 'default'        — emergency sentinel if all the above fail
 */
export async function resolveChatModel(params: {
  explicitModel?: string | null;
  sessionModel?: string | null;
  /** User message text — passed to SmartModelRouter for prompt-length analysis. */
  message?: string;
  /** Tools array — passed to SmartModelRouter so analysis.hasTools is set. */
  tools?: any[];
  /**
   * VISION (sev1): true when THIS turn carries an image/* attachment. The
   * SmartModelRouter keys vision detection (`analyzeRequest`) on an ARRAY
   * content block with `type:'image_url'`. The synthetic router request we
   * build below otherwise sends `content` as a plain STRING, so the router
   * computes requiresVision=false on every turn and its vision candidate
   * filter is dead code on the chat path — an image-only prompt routes by
   * FCA/cost to the default chat model (which may be vision:false). When this
   * is set, we shape the user content as an array including an image_url part
   * so the router narrows candidates to vision-capable models. We do NOT pass
   * the raw bytes here (the router only needs the SHAPE for analysis); the
   * actual image bytes flow to the provider via runChat's `attachments`.
   */
  hasVision?: boolean;
  /** Optional SmartModelRouter dep. When absent, falls back to DB default. */
  smartRouter?: ChatModelRouter | null;
  /**
   * Q1-fix-10 — prior turn's classification (taskType string from
   * PromptClassifier). Forwarded into SmartModelRouter.routeRequest's
   * opts arg so the classifier can inherit capability requirements on
   * short follow-up turns. Optional.
   */
  priorClassification?: string;
}): Promise<string> {
  const explicit = params.explicitModel?.trim();
  if (explicit) return explicit;
  const session = params.sessionModel?.trim();
  if (session) return session;

  // Step 3: consult SmartModelRouter when available — DEFAULT-FIRST. The
  // router runs the structural classifier + capability gates; we use its
  // pick ONLY when it escalated. A non-escalated pick (the cheap cost-score
  // winner) is intentionally discarded so the DB default in step 4 wins.
  if (params.smartRouter) {
    try {
      // VISION (sev1): when the turn carries an image attachment, the user
      // content MUST be an ARRAY containing an `image_url` part so
      // SmartModelRouter.analyzeRequest sets requiresVision=true and its
      // vision candidate filter narrows to vision-capable models. A plain
      // string (the prior shape) made requiresVision=false on every turn.
      // The bytes aren't needed for routing — only the structural shape — so
      // we use a tiny placeholder data URL. The real image bytes are attached
      // to the provider call downstream via runChat's `attachments`.
      const userContent: any = params.hasVision
        ? [
            ...(params.message ? [{ type: 'text', text: params.message }] : []),
            {
              type: 'image_url',
              image_url: { url: 'data:image/*;routing-shape-only' },
            },
          ]
        : params.message;
      const decision = await params.smartRouter.routeRequest(
        {
          messages:
            params.hasVision || params.message
              ? [{ role: 'user', content: userContent }]
              : [],
          tools: params.tools ?? [],
        },
        undefined,
        params.priorClassification ? { priorClassification: params.priorClassification } : undefined,
      );
      const routed = decision?.selectedModel?.modelId;
      // FCA-floor routing (2026-05-24, user direction): honor the router's
      // pick in BOTH directions. The SmartModelRouter only returns a candidate
      // that passes the RouterTuning FCA floor for the prompt's complexity, so
      // its pick is authoritative — DOWN to a cheap model (gpt-oss:20b) for
      // trivial prompts / trivial follow-ups ("thanks"), UP for hard prompts.
      // The DB default below is the FALLBACK (router produced no valid pick),
      // not an override that discards a floor-passing cheaper model. Reverses
      // the prior escalate-only-up gate now that per-model FCA is populated.
      if (routed && typeof routed === 'string' && routed.trim()) {
        return routed.trim();
      }
    } catch (err) {
      // A deliberate capability REFUSAL must propagate — never downgrade to
      // the cheap default the router just excluded (#1046 lineage: the catch
      // used to swallow this and re-admit the very gpt-oss:20b the T3 gate
      // refused, then the turn died on a doomed cheap-model dispatch).
      const msg = err instanceof Error ? err.message : String(err);
      // NO_VISION_MODEL (image turn, no vision model) MUST also surface rather
      // than degrade to the DB chat default — falling through would route the
      // image to a BLIND model that silently ignores it and hallucinates.
      if (/NO_T3_MODEL_IN_REGISTRY|No models available for routing/i.test(msg) || /NO_VISION_MODEL/.test(msg)) {
        throw err;
      }
      // Transient failure (timeout / Milvus blip / unexpected throw) — fall
      // through to the DB default below so chat never crashes.
    }
  }

  try {
    const m = await ModelConfigurationService.getDefaultChatModel();
    if (m && m.trim()) return m;
  } catch {
    // fall through to sentinel
  }
  return 'default';
}
