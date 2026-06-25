/**
 * HandoffDecisionService — Phase 10 (TFC).
 *
 * Decides whether a `model_handoff_offer` should be emitted given the
 * current model + classified intent. Pure capability-score (FCA) driven —
 * never hardcodes per-model logic. Spec §11.3.
 *
 * Status (2026-05-12): NOT wired through the V3 chat pipeline.
 * F0-2 audit removed the pre-loop handoff emit (intent signal was
 * deleted in Phase E.1). Phase 2.4.2 §A6 retired the local
 * `buildModelHandoffOffer` from routes/chat/pipeline/chat/builders.ts.
 * The service is preserved for future re-wiring; any caller would need
 * to (a) re-introduce a payload builder (the SDK canonical at
 * lib/agentic-sdk/agentic-events/builders.ts is a candidate) and
 * (b) call `ctx.emit('model_handoff_offer', <built payload>)` from
 * the appropriate pipeline site.
 *
 * The `router` dependency is structural — production wires
 * SmartModelRouter.simulatePrompt() through a thin adapter that returns
 * `{ model, confidence }[]` ranked by FCA score for the given intent. Unit
 * tests inject a `vi.fn()` stub. The service is intent-keyed, model-
 * agnostic by construction (NO model-name branches).
 *
 * the design notes
 * the design notes
 */

export interface HandoffDecisionInput {
  currentModel: string;
  intent: string;
}

export interface HandoffDecision {
  /** True iff offer should be emitted. */
  shouldOffer: boolean;
  /** Always present — echoes the input. */
  currentModel: string;
  /** The strictly-stronger alternative; only when shouldOffer=true. */
  suggestedModel?: string;
  /** Human-readable rationale; only when shouldOffer=true. */
  reason?: string;
  /** Current model's FCA score for the intent, when available. */
  confidenceCurrent?: number;
  /** Suggested model's FCA score, when shouldOffer=true. */
  confidenceSuggested?: number;
}

/**
 * Structural router interface. `routeRequest(intent)` returns ALL eligible
 * models ranked by FCA score for the given intent. The current model SHOULD
 * appear in this list when it's eligible at all; if it's missing entirely,
 * we treat it as score=0 (worst-case) and a stronger alternative wins
 * automatically.
 */
export interface HandoffDecisionRouter {
  routeRequest(intent: string): Promise<Array<{ model: string; confidence: number }>>;
}

export interface HandoffDecisionDeps {
  router: HandoffDecisionRouter;
  /** FCA score floor below which we offer a handoff. Default 0.65. */
  threshold?: number;
}

export class HandoffDecisionService {
  private readonly threshold: number;

  constructor(private readonly deps: HandoffDecisionDeps) {
    this.threshold = deps.threshold ?? 0.65;
  }

  /**
   * Decide whether to offer a handoff. Returns shouldOffer=false on any of:
   *
   *   - Router throws (graceful — caller continues with current model).
   *   - Current model's score >= threshold.
   *   - No NON-current model has a score >= threshold.
   *
   * When shouldOffer=true, picks the STRONGEST alternative (highest score)
   * — not just the first above threshold.
   */
  async decide(opts: HandoffDecisionInput): Promise<HandoffDecision> {
    const { currentModel, intent } = opts;
    let scores: Array<{ model: string; confidence: number }>;
    try {
      scores = await this.deps.router.routeRequest(intent);
    } catch {
      // Best-effort. Router unavailability MUST NOT break the chat turn —
      // the caller proceeds with the current model and the user gets no
      // handoff affordance. Logged at the call-site, not here (the service
      // is logger-free for testability).
      return { shouldOffer: false, currentModel };
    }

    // Find the current model's row. The score list may carry duplicates in
    // pathological cases — pick the FIRST occurrence (router contract is
    // ordered-by-confidence-desc, so the first row is the highest score
    // attributed to the model).
    const currentRow = scores.find((s) => s.model === currentModel);
    const currentScore = currentRow?.confidence ?? 0;

    if (currentScore >= this.threshold) {
      return {
        shouldOffer: false,
        currentModel,
        confidenceCurrent: currentScore,
      };
    }

    // Find the strictly-stronger alternative — strongest model OTHER than
    // current that meets the threshold. Sort desc by confidence so the
    // first match is the best.
    const better = scores
      .filter((s) => s.model !== currentModel && s.confidence >= this.threshold)
      .sort((a, b) => b.confidence - a.confidence)[0];

    if (!better) {
      return {
        shouldOffer: false,
        currentModel,
        confidenceCurrent: currentScore,
      };
    }

    return {
      shouldOffer: true,
      currentModel,
      suggestedModel: better.model,
      confidenceCurrent: currentScore,
      confidenceSuggested: better.confidence,
      reason: this.formatReason(intent, currentScore, better.confidence, this.threshold),
    };
  }

  private formatReason(
    intent: string,
    currentScore: number,
    suggestedScore: number,
    threshold: number,
  ): string {
    const pct = (n: number): string => `${Math.round(n * 100)}%`;
    return (
      `Current model's capability for "${intent}" (${pct(currentScore)}) is below ` +
      `the configured floor (${pct(threshold)}); the suggested alternative ` +
      `scores ${pct(suggestedScore)}.`
    );
  }
}
