/**
 * FeedbackService — Phase 13 V3 advisory loop write-side.
 *
 * Thin write-side wrapper around prisma.responseFeedback that captures the
 * binary feedback signal (positive|negative + intent + model). Maps the
 * signal onto the existing ResponseFeedback.feedback_type column
 * (thumbs_up | thumbs_down) so legacy admin analytics dashboards keep
 * working.
 *
 * Intentionally separate from FeedbackLearningService — that service is the
 * READ/ANALYZE side of the loop and must not depend on the write surface.
 *
 * Phase E.7 (2026-05-10): `audience` field RIPPED. Role discrimination at
 * chat time runs through the system-prompt selector
 * (chat-system-{admin,member}.md). Storing audience on every feedback
 * row was redundant and tightly coupled the analyze() loop to a
 * deprecated routing concept.
 */
import { randomUUID } from 'crypto';

export type FeedbackSignal = 'positive' | 'negative';

export interface FeedbackInput {
  messageId: string;
  sessionId: string;
  userId: string;
  signal: FeedbackSignal;
  reason?: string;
  intent?: string;
  model?: string;
}

export interface FeedbackRow {
  id: string;
  message_id: string;
  user_id: string;
  session_id: string;
  feedback_type: string;
  comment: string | null;
  intent: string | null;
  model: string | null;
  created_at: Date;
}

const VALID_SIGNALS = new Set<FeedbackSignal>(['positive', 'negative']);

export class FeedbackService {
  constructor(private prismaLike: any) {}

  async record(input: FeedbackInput): Promise<{ id: string }> {
    if (!VALID_SIGNALS.has(input.signal)) {
      throw new Error(
        `FeedbackService.record: invalid signal "${input.signal}" — must be positive|negative`,
      );
    }

    const feedbackType = input.signal === 'positive' ? 'thumbs_up' : 'thumbs_down';
    const id = randomUUID();

    const row = await this.prismaLike.responseFeedback.upsert({
      where: {
        message_id_user_id_feedback_type: {
          message_id: input.messageId,
          user_id: input.userId,
          feedback_type: feedbackType,
        },
      },
      create: {
        id,
        message_id: input.messageId,
        user_id: input.userId,
        session_id: input.sessionId,
        feedback_type: feedbackType,
        comment: input.reason ?? null,
        intent: input.intent ?? null,
        model: input.model ?? null,
      },
      update: {
        comment: input.reason ?? null,
        intent: input.intent ?? null,
        model: input.model ?? null,
        updated_at: new Date(),
      },
    });

    return { id: row.id };
  }

  async listForUser(
    userId: string,
    opts?: { since?: Date; limit?: number },
  ): Promise<FeedbackRow[]> {
    const where: any = { user_id: userId };
    if (opts?.since) where.created_at = { gte: opts.since };
    return this.prismaLike.responseFeedback.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: opts?.limit ?? 100,
    });
  }

  /**
   * Used by FeedbackLearningService.analyze — read all rows since `since`
   * for advisory aggregation. Filters out rows with null intent or null model
   * since those can't be grouped meaningfully.
   */
  async listSince(since: Date): Promise<FeedbackRow[]> {
    return this.prismaLike.responseFeedback.findMany({
      where: {
        created_at: { gte: since },
        NOT: [{ intent: null }, { model: null }],
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
