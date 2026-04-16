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

  constructor(
    private prisma: PrismaClient,
    logger: Logger,
  ) {
    this.logger = logger.child({ service: 'FeedbackLearningService' });
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
