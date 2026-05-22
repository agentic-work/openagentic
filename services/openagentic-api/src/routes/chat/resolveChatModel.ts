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
    [k: string]: any;
  }>;
}

/**
 * Precedence (DB is SoT — never reads process.env):
 *   1. explicitModel    — caller specified it (request body, stream handler)
 *   2. sessionModel     — persisted on the session row
 *   3. SmartModelRouter — when `smartRouter` dep is supplied AND no
 *                         explicit/session, consult it. routeRequest()
 *                         runs structural analysis + FCA-floor cost+quality
 *                         scoring across enabled models. Post Phase E.1
 *                         (2026-05-10): no pre-LLM intent classifier.
 *                         Spec §50: model decides.
 *   4. ModelConfigurationService.getDefaultChatModel() — DB-backed default
 *   5. 'default'        — emergency sentinel if all the above fail
 */
export async function resolveChatModel(params: {
  explicitModel?: string | null;
  sessionModel?: string | null;
  /** User message text — passed to SmartModelRouter for prompt-length analysis. */
  message?: string;
  /** Tools array — passed to SmartModelRouter so analysis.hasTools is set. */
  tools?: any[];
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

  // Step 3: consult SmartModelRouter when available. This is best-effort —
  // any failure (router throws, malformed return) falls through to the
  // DB-backed default below so chat never crashes.
  if (params.smartRouter) {
    try {
      const decision = await params.smartRouter.routeRequest(
        {
          messages: params.message ? [{ role: 'user', content: params.message }] : [],
          tools: params.tools ?? [],
        },
        undefined,
        params.priorClassification ? { priorClassification: params.priorClassification } : undefined,
      );
      const routed = decision?.selectedModel?.modelId;
      if (routed && typeof routed === 'string' && routed.trim()) {
        return routed.trim();
      }
    } catch {
      // fall through to DB default
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
