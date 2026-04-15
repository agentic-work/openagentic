/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Response Feedback Routes
 *
 * Allows users to provide feedback on LLM responses:
 * - POST /api/feedback - Submit feedback for a message
 * - GET /api/feedback/:messageId - Get feedback for a specific message
 * - DELETE /api/feedback/:feedbackId - Remove feedback
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { z } from 'zod';
import { getFeedbackIntegrationService } from '../services/FeedbackIntegrationService.js';
import { getSemanticLearningService } from '../services/SemanticLearningService.js';
import { getFeedbackLearningService, detectResponseFormat } from '../services/FeedbackLearningService.js';

// Validation schemas
const feedbackSubmitSchema = z.object({
  messageId: z.string().min(1),
  sessionId: z.string(),
  feedbackType: z.enum(['thumbs_up', 'thumbs_down', 'copy', 'regenerate', 'share', 'report']),
  rating: z.number().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
  tags: z.array(z.string()).optional(),
  // Context about the response (optional - captured from message if not provided)
  model: z.string().optional(),
  provider: z.string().optional(),
  responseTime: z.number().optional(),
  tokenCount: z.number().optional(),
});

type FeedbackSubmitBody = z.infer<typeof feedbackSubmitSchema>;

interface MessageIdParams {
  messageId: string;
}

interface FeedbackIdParams {
  feedbackId: string;
}

export const feedbackRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes.child({ module: 'feedback' });
  const prisma = fastify.prisma;

  /**
   * POST /api/feedback
   * Submit feedback for a message response
   */
  fastify.post<{ Body: FeedbackSubmitBody }>('/', async (request, reply) => {
    try {
      const user = (request as any).user;
      if (!user?.id) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Validate request body
      const validatedBody = feedbackSubmitSchema.parse(request.body);

      // Verify session belongs to the user (message IDs may be client-generated)
      const session = await prisma.chatSession.findFirst({
        where: {
          id: validatedBody.sessionId,
          user_id: user.id,
        },
      });

      if (!session) {
        // Fallback: try finding message directly (for DB-generated message IDs)
        const message = await prisma.chatMessage.findFirst({
          where: { id: validatedBody.messageId, session_id: validatedBody.sessionId },
          include: { session: { select: { user_id: true } } },
        });
        if (!message || message.session.user_id !== user.id) {
          return reply.code(404).send({ error: 'Session not found or access denied' });
        }
      }

      // Resolve the actual database message ID (UI sends stream event IDs which differ from DB IDs)
      let dbMessageId = validatedBody.messageId;
      const existsInDB = await prisma.chatMessage.findUnique({ where: { id: dbMessageId }, select: { id: true } });
      if (!existsInDB) {
        // Find the most recent assistant message in this session
        const recentMsg = await prisma.chatMessage.findFirst({
          where: { session_id: validatedBody.sessionId, role: 'assistant' },
          orderBy: { created_at: 'desc' },
          select: { id: true },
        });
        if (recentMsg) {
          dbMessageId = recentMsg.id;
        } else {
          return reply.code(404).send({ error: 'No assistant message found in session' });
        }
      }

      // Create or update feedback (upsert based on unique constraint)
      const feedback = await prisma.responseFeedback.upsert({
        where: {
          message_id_user_id_feedback_type: {
            message_id: dbMessageId,
            user_id: user.id,
            feedback_type: validatedBody.feedbackType,
          },
        },
        create: {
          message_id: dbMessageId,
          user_id: user.id,
          session_id: validatedBody.sessionId,
          feedback_type: validatedBody.feedbackType,
          rating: validatedBody.rating,
          comment: validatedBody.comment,
          tags: validatedBody.tags || [],
          model: validatedBody.model || null,
          provider: validatedBody.provider || null,
          response_time: validatedBody.responseTime,
          token_count: validatedBody.tokenCount || null,
          metadata: {
            userAgent: request.headers['user-agent'],
            timestamp: new Date().toISOString(),
          },
        },
        update: {
          rating: validatedBody.rating,
          comment: validatedBody.comment,
          tags: validatedBody.tags || [],
          updated_at: new Date(),
        },
      });

      logger.info({
        feedbackId: feedback.id,
        messageId: validatedBody.messageId,
        userId: user.id,
        feedbackType: validatedBody.feedbackType,
        model: feedback.model,
      }, 'Feedback submitted');

      // =================================================================
      // 📊 FEEDBACK LOOP INTEGRATION (B) - Update behavioral scoring
      // =================================================================
      // Direct user feedback signals are valuable for learning.
      // Map feedback types to behavioral actions for the scoring service.
      try {
        const feedbackService = getFeedbackIntegrationService();

        // Tool call IDs would come from message metadata — skip if message wasn't looked up
        const toolCallIds: string[] | undefined = undefined;

        if (toolCallIds && toolCallIds.length > 0) {
          // Map feedback type to behavioral action
          const actionMap: Record<string, 'positive' | 'negative' | 'continued'> = {
            'thumbs_up': 'positive',
            'thumbs_down': 'negative',
            'copy': 'positive',      // Copying indicates usefulness
            'share': 'positive',     // Sharing indicates value
            'regenerate': 'negative', // Regenerating indicates dissatisfaction
            'report': 'negative',     // Reporting indicates problem
          };

          const action = actionMap[validatedBody.feedbackType] || 'continued';

          // Update behavioral score for each tool call in the message
          for (const toolCallId of toolCallIds) {
            feedbackService.updateBehavioralFeedback(toolCallId, action);
          }

          logger.debug({
            messageId: validatedBody.messageId,
            toolCallIds,
            feedbackType: validatedBody.feedbackType,
            behavioralAction: action,
          }, '[FEEDBACK-LOOP] Behavioral scores updated from user feedback');
        }

        // Log structured feedback event for analysis
        logger.info({
          event: 'USER_EXPLICIT_FEEDBACK',
          feedbackId: feedback.id,
          messageId: validatedBody.messageId,
          sessionId: validatedBody.sessionId,
          feedbackType: validatedBody.feedbackType,
          rating: validatedBody.rating,
          userId: user.id,
          model: feedback.model,
          timestamp: new Date().toISOString(),
        }, '[FEEDBACK-LOOP] 👍 Explicit user feedback recorded for learning');
      } catch (feedbackLoopError) {
        // Non-fatal - original feedback was stored successfully
        logger.debug({ error: feedbackLoopError }, '[FEEDBACK-LOOP] Failed to update behavioral scoring');
      }

      // =================================================================
      // 📊 PROMPT EFFECTIVENESS — Update outcome for the session's composition
      // =================================================================
      try {
        const latestEffectiveness = await prisma.promptEffectiveness.findFirst({
          where: { session_id: validatedBody.sessionId },
          orderBy: { created_at: 'desc' },
        });
        if (latestEffectiveness) {
          const positiveTypes = new Set(['thumbs_up', 'copy', 'share']);
          const negativeTypes = new Set(['thumbs_down', 'regenerate', 'report']);
          const outcome = positiveTypes.has(validatedBody.feedbackType)
            ? 'positive'
            : negativeTypes.has(validatedBody.feedbackType)
            ? 'negative'
            : validatedBody.rating !== undefined
            ? validatedBody.rating > 3
              ? 'positive'
              : 'negative'
            : null;

          if (outcome) {
            await prisma.promptEffectiveness.update({
              where: { id: latestEffectiveness.id },
              data: {
                outcome,
                feedback_id: feedback.id,
              },
            });
          }
        }
      } catch {
        /* non-fatal */
      }

      // =================================================================
      // 🧠 ADAPTIVE MEMORY — Feed into FeedbackLearningService
      // =================================================================
      try {
        const feedbackLearningService = getFeedbackLearningService();
        const responseFormat = detectResponseFormat('');
        await feedbackLearningService.processFeedback(user.id, {
          messageId: validatedBody.messageId,
          feedbackType: validatedBody.feedbackType as any,
          model: feedback.model || undefined,
          responseFormat,
          topics: validatedBody.tags,
        });
        logger.debug({
          userId: user.id,
          feedbackType: validatedBody.feedbackType,
          responseFormat,
        }, '[ADAPTIVE-MEMORY] Feedback processed for user learning');
      } catch (adaptiveError) {
        logger.debug({ error: adaptiveError }, '[ADAPTIVE-MEMORY] FeedbackLearning not available');
      }

      return reply.send({
        success: true,
        feedback: {
          id: feedback.id,
          feedbackType: feedback.feedback_type,
          rating: feedback.rating,
          createdAt: feedback.created_at,
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Invalid request body',
          details: error.errors,
        });
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : '';
      console.error('[FEEDBACK-DEBUG] Failed to submit feedback:', errMsg, errStack);
      logger.error({ error: errMsg, stack: errStack }, 'Failed to submit feedback');
      return reply.code(500).send({ error: 'Failed to submit feedback', debug: errMsg });
    }
  });

  /**
   * GET /api/feedback/:messageId
   * Get feedback for a specific message
   */
  fastify.get<{ Params: MessageIdParams }>('/:messageId', async (request, reply) => {
    try {
      const user = (request as any).user;
      if (!user?.id) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { messageId } = request.params;

      // Get feedback for this message from this user
      const feedback = await prisma.responseFeedback.findMany({
        where: {
          message_id: messageId,
          user_id: user.id,
        },
        select: {
          id: true,
          feedback_type: true,
          rating: true,
          comment: true,
          tags: true,
          created_at: true,
        },
      });

      // Also get aggregate feedback stats for the message (visible to all users)
      const stats = await prisma.responseFeedback.groupBy({
        by: ['feedback_type'],
        where: {
          message_id: messageId,
        },
        _count: {
          feedback_type: true,
        },
      });

      const feedbackStats = stats.reduce((acc, stat) => {
        acc[stat.feedback_type] = stat._count.feedback_type;
        return acc;
      }, {} as Record<string, number>);

      return reply.send({
        userFeedback: feedback,
        stats: feedbackStats,
      });
    } catch (error: any) {
      logger.error({ error }, 'Failed to get feedback');
      return reply.code(500).send({ error: 'Failed to get feedback' });
    }
  });

  /**
   * DELETE /api/feedback/:feedbackId
   * Remove user's feedback
   */
  fastify.delete<{ Params: FeedbackIdParams }>('/:feedbackId', async (request, reply) => {
    try {
      const user = (request as any).user;
      if (!user?.id) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { feedbackId } = request.params;

      // Verify feedback belongs to user
      const feedback = await prisma.responseFeedback.findFirst({
        where: {
          id: feedbackId,
          user_id: user.id,
        },
      });

      if (!feedback) {
        return reply.code(404).send({ error: 'Feedback not found' });
      }

      await prisma.responseFeedback.delete({
        where: {
          id: feedbackId,
        },
      });

      logger.info({
        feedbackId,
        userId: user.id,
      }, 'Feedback deleted');

      return reply.send({ success: true });
    } catch (error: any) {
      logger.error({ error }, 'Failed to delete feedback');
      return reply.code(500).send({ error: 'Failed to delete feedback' });
    }
  });
};
