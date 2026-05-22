/**
 * FeedbackLearningService — Closes the feedback → learning loop.
 *
 * ResponseFeedback → user preferences → system prompt injection + per-user model routing.
 * Style/format preferences extracted from +/- signals.
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { getUserProfileService, InteractionSignal } from './UserProfileService.js';
import { getUserMemoryService } from './UserMemoryService.js';
import { FeedbackService } from './FeedbackService.js';

// ── Phase 13 advisory loop ───────────────────────────────────────────
export type AdvisoryWindow = '24h' | '7d' | '30d';

export type AdvisoryRecommendationType =
  | 'intent_floor_bump'
  | 'intent_floor_lower'
  | 'model_demote'
  | 'model_promote';

export interface AdvisoryRecommendation {
  type: AdvisoryRecommendationType;
  intent: string;
  model?: string;
  evidenceCount: number;
  positiveRate: number; // 0..1
  currentValue?: number;
  recommendedValue?: number;
  reason: string;
}

const WINDOW_MS: Record<AdvisoryWindow, number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
};

const DEMOTE_THRESHOLD = 0.5;
const PROMOTE_THRESHOLD = 0.85;
const DEFAULT_MIN_EVIDENCE = 10;

let _instance: FeedbackLearningService | null = null;

export function getFeedbackLearningService(): FeedbackLearningService {
  if (!_instance) throw new Error('FeedbackLearningService not initialized');
  return _instance;
}

export function initFeedbackLearningService(
  prisma: PrismaClient,
  logger: Logger,
): FeedbackLearningService {
  _instance = new FeedbackLearningService(prisma, logger);
  return _instance;
}

interface FeedbackInput {
  messageId: string;
  feedbackType: 'thumbs_up' | 'thumbs_down' | 'copy' | 'regenerate' | 'share' | 'report';
  model?: string;
  responseFormat?: string; // detected: code_block, bullet_list, narrative
  topics?: string[];
}

export class FeedbackLearningService {
  private logger: Logger;
  // Phase 13 — advisory loop deps. Constructor stays backward-compatible
  // (existing call sites pass only prisma+logger); test/init can wire
  // explicit feedback + routerTuning stubs by direct field assignment.
  protected feedback: { listSince: (since: Date) => Promise<any[]> } | null;
  protected routerTuning: any | null;

  constructor(
    private prisma: PrismaClient,
    logger: Logger,
    feedback?: FeedbackService | { listSince: (since: Date) => Promise<any[]> },
    routerTuning?: any,
  ) {
    this.logger = logger.child({ service: 'FeedbackLearningService' });
    this.feedback = (feedback as any) ?? null;
    this.routerTuning = routerTuning ?? null;
  }

  /**
   * Process user feedback into profile updates + memory ingestion.
   * Called from feedback.ts POST handler after storing ResponseFeedback.
   */
  async processFeedback(userId: string, feedback: FeedbackInput): Promise<void> {
    try {
      // 1. Update user profile via UserProfileService
      const signal: InteractionSignal = {
        type: 'feedback',
        feedbackType: feedback.feedbackType,
        model: feedback.model,
        format: feedback.responseFormat,
        topics: feedback.topics,
      };

      try {
        await getUserProfileService().recordInteraction(userId, signal);
      } catch { /* service may not be initialized yet */ }

      // 2. Ingest feedback as memory entry for future context
      try {
        const feedbackText = this.formatFeedbackForMemory(feedback);
        await getUserMemoryService().ingest(
          userId,
          'feedback',
          feedback.messageId,
          feedbackText,
          0.8, // High importance — explicit user signal
        );
      } catch { /* memory service may not be initialized yet */ }

      this.logger.debug({
        userId,
        feedbackType: feedback.feedbackType,
        model: feedback.model,
      }, 'Feedback processed for learning');

    } catch (err: any) {
      this.logger.debug({ error: err.message, userId }, 'processFeedback failed');
    }
  }

  /**
   * Get per-user model satisfaction scores for SmartModelRouter integration.
   * Returns a map of modelId → satisfaction bonus (-10 to +10).
   */
  async getUserModelPreferences(userId: string): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    try {
      const profile = await getUserProfileService().getOrCreateProfile(userId);
      const prefs = (profile.model_preferences as Record<string, any>) || {};

      for (const [modelId, pref] of Object.entries(prefs)) {
        const { satisfaction, sampleSize } = pref as any;
        if (sampleSize < 3) continue; // Need minimum sample
        // Formula: (satisfaction - 0.5) * 20 * min(sampleSize/20, 1)
        const bonus = (satisfaction - 0.5) * 20 * Math.min(sampleSize / 20, 1);
        result.set(modelId, bonus);
      }
    } catch { /* profile service may not be ready */ }

    return result;
  }

  // ── Phase 13 advisory loop ──────────────────────────────────────
  /**
   * Aggregate user feedback over a rolling window and return ADVISORY
   * recommendations. Read-only — never mutates RouterTuning state. The
   * /admin#feedback-advisories surface displays these for an operator
   * to review and (optionally) apply manually.
   *
   * Aggregation rules:
   *  - Group by (intent, model). Skip rows with null intent or null model.
   *  - For each group with evidenceCount >= minEvidence:
   *      positiveRate < 0.5  → recommend `model_demote`
   *      positiveRate > 0.85 → recommend `model_promote`
   *  - For each intent where ALL groups land < 0.5 (and the intent has
   *    >= minEvidence total signals), recommend `intent_floor_bump`.
   */
  async analyze(opts: {
    window: AdvisoryWindow;
    minEvidence?: number;
  }): Promise<AdvisoryRecommendation[]> {
    const minEvidence = opts.minEvidence ?? DEFAULT_MIN_EVIDENCE;
    const since = new Date(Date.now() - WINDOW_MS[opts.window]);

    if (!this.feedback) {
      this.logger.debug(
        { window: opts.window },
        'analyze called without feedback dep wired — returning empty',
      );
      return [];
    }

    const rows = await this.feedback.listSince(since);
    if (rows.length === 0) return [];

    // Group: intent → model → { positive, negative }
    const buckets = new Map<string, Map<string, { pos: number; neg: number }>>();
    for (const r of rows) {
      if (!r.intent || !r.model) continue;
      const ftype: string = r.feedback_type;
      const sig: 'positive' | 'negative' | null =
        ftype === 'thumbs_up'
          ? 'positive'
          : ftype === 'thumbs_down'
          ? 'negative'
          : null;
      if (!sig) continue;
      let intentMap = buckets.get(r.intent);
      if (!intentMap) {
        intentMap = new Map();
        buckets.set(r.intent, intentMap);
      }
      let cell = intentMap.get(r.model);
      if (!cell) {
        cell = { pos: 0, neg: 0 };
        intentMap.set(r.model, cell);
      }
      if (sig === 'positive') cell.pos++;
      else cell.neg++;
    }

    const out: AdvisoryRecommendation[] = [];
    for (const [intent, models] of buckets.entries()) {
      let intentTotalEvidence = 0;
      let intentAllBelowDemoteThreshold = true;
      for (const [, c] of models.entries()) {
        const ev = c.pos + c.neg;
        intentTotalEvidence += ev;
        const rate = ev === 0 ? 0 : c.pos / ev;
        if (rate >= DEMOTE_THRESHOLD) intentAllBelowDemoteThreshold = false;
      }

      for (const [model, c] of models.entries()) {
        const evidenceCount = c.pos + c.neg;
        if (evidenceCount < minEvidence) continue;
        const positiveRate = c.pos / evidenceCount;
        if (positiveRate < DEMOTE_THRESHOLD) {
          out.push({
            type: 'model_demote',
            intent,
            model,
            evidenceCount,
            positiveRate,
            reason: `Positive rate ${(positiveRate * 100).toFixed(0)}% over ${evidenceCount} signals — consider demoting ${model} for intent=${intent}`,
          });
        } else if (positiveRate > PROMOTE_THRESHOLD) {
          out.push({
            type: 'model_promote',
            intent,
            model,
            evidenceCount,
            positiveRate,
            reason: `Positive rate ${(positiveRate * 100).toFixed(0)}% over ${evidenceCount} signals — consider promoting ${model} for intent=${intent}`,
          });
        }
      }

      if (intentAllBelowDemoteThreshold && intentTotalEvidence >= minEvidence) {
        let intentPos = 0;
        let intentNeg = 0;
        for (const [, c] of models.entries()) {
          intentPos += c.pos;
          intentNeg += c.neg;
        }
        const intentRate = intentTotalEvidence === 0 ? 0 : intentPos / intentTotalEvidence;
        out.push({
          type: 'intent_floor_bump',
          intent,
          evidenceCount: intentTotalEvidence,
          positiveRate: intentRate,
          reason: `All ${models.size} model(s) for intent=${intent} below 50% positive (overall ${(intentRate * 100).toFixed(0)}% over ${intentTotalEvidence} signals) — consider bumping the FCA floor to require a stronger model`,
        });
      }
    }

    return out;
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private formatFeedbackForMemory(feedback: FeedbackInput): string {
    const action = feedback.feedbackType === 'thumbs_up' ? 'liked'
      : feedback.feedbackType === 'thumbs_down' ? 'disliked'
      : feedback.feedbackType === 'copy' ? 'copied'
      : feedback.feedbackType === 'regenerate' ? 'regenerated'
      : feedback.feedbackType;

    const parts = [`User ${action} a response`];
    if (feedback.model) parts.push(`from ${feedback.model}`);
    if (feedback.responseFormat) parts.push(`(format: ${feedback.responseFormat})`);
    if (feedback.topics?.length) parts.push(`about ${feedback.topics.join(', ')}`);

    return parts.join(' ');
  }
}

/**
 * Detect the format of a response by analyzing its content.
 */
export function detectResponseFormat(content: string | null): string {
  if (!content) return 'unknown';

  const lines = content.split('\n');
  const codeBlockCount = (content.match(/```/g) || []).length / 2;
  const bulletCount = lines.filter(l => l.match(/^\s*[-*•]\s/)).length;
  const totalLines = lines.length;

  if (codeBlockCount >= 1 && codeBlockCount > bulletCount) return 'code_block';
  if (bulletCount >= 3 && bulletCount / totalLines > 0.3) return 'bullet_list';
  if (totalLines > 5) return 'narrative';
  return 'mixed';
}
