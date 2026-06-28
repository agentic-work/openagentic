/**
 * User Feedback API
 *
 * Handles explicit user feedback signals (upvotes/thumbs-down)
 * Part of the Feedback Loop System (Signal B: Direct user feedback)
 *
 * Endpoints:
 * - POST /api/chat/feedback - Record user feedback on a tool execution or response
 * - GET /api/chat/feedback/stats - Get feedback statistics for the current user
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getFeedbackIntegrationService } from '../../services/FeedbackIntegrationService.js';
import { getSemanticLearningService } from '../../services/SemanticLearningService.js';
import { authMiddleware } from '../../middleware/unifiedAuth.js';
import logger from '../../utils/logger.js';

interface FeedbackRequest {
  toolCallId?: string;
  messageId?: string;
  sessionId: string;
  feedbackType: 'positive' | 'negative';
  feedbackCategory?: 'accuracy' | 'relevance' | 'completeness' | 'speed' | 'other';
  feedbackText?: string;
}

interface VerifyResultRequest {
  resultId: string;
  qualityScore: number;  // 0-1
  verificationComment?: string;
}

export async function registerUserFeedbackRoutes(fastify: FastifyInstance) {
  const log = logger.child({ route: 'user-feedback' });

  /**
   * POST /api/chat/feedback
   *
   * Record explicit user feedback on a tool execution or LLM response.
   * This updates the behavioral scoring and helps the system learn
   * what works and what doesn't.
   */
  fastify.post<{ Body: FeedbackRequest }>(
    '/api/chat/feedback',
    {
      onRequest: authMiddleware,
      schema: {
        description: 'Record user feedback on a tool execution or response',
        tags: ['chat', 'feedback'],
        body: {
          type: 'object',
          required: ['sessionId', 'feedbackType'],
          properties: {
            toolCallId: { type: 'string', description: 'ID of the tool call to provide feedback on' },
            messageId: { type: 'string', description: 'ID of the message to provide feedback on' },
            sessionId: { type: 'string', description: 'Session ID' },
            feedbackType: { type: 'string', enum: ['positive', 'negative'], description: 'Type of feedback' },
            feedbackCategory: {
              type: 'string',
              enum: ['accuracy', 'relevance', 'completeness', 'speed', 'other'],
              description: 'Category of feedback'
            },
            feedbackText: { type: 'string', description: 'Optional feedback text' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              updatedScore: { type: 'number' }
            }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: FeedbackRequest }>, reply: FastifyReply) => {
      const { toolCallId, messageId, sessionId, feedbackType, feedbackCategory, feedbackText } = request.body;
      const userId = (request as any).userId || 'anonymous';

      log.info({
        toolCallId,
        messageId,
        sessionId,
        feedbackType,
        feedbackCategory,
        userId
      }, '[USER-FEEDBACK] Recording user feedback');

      try {
        const feedbackService = getFeedbackIntegrationService();

        // Update behavioral score based on feedback
        if (toolCallId) {
          feedbackService.updateBehavioralFeedback(toolCallId, feedbackType);
        }

        // Log structured feedback event for analysis
        log.info({
          event: 'USER_FEEDBACK_RECEIVED',
          toolCallId,
          messageId,
          sessionId,
          feedbackType,
          feedbackCategory,
          feedbackText: feedbackText?.substring(0, 500),
          userId,
          timestamp: new Date().toISOString()
        }, '[USER-FEEDBACK] 👍 Explicit user feedback recorded');

        // Get updated reliability info if available
        let updatedScore: number | undefined;
        if (toolCallId) {
          const reliability = feedbackService.getToolReliability(toolCallId, 'unknown');
          updatedScore = reliability?.averageScore;
        }

        return reply.send({
          success: true,
          message: `Feedback recorded: ${feedbackType}`,
          updatedScore
        });
      } catch (error) {
        log.error({ error, toolCallId, messageId }, '[USER-FEEDBACK] Failed to record feedback');
        return reply.status(500).send({
          success: false,
          message: 'Failed to record feedback'
        });
      }
    }
  );

  /**
   * POST /api/chat/feedback/verify
   *
   * Verify a stored tool result as high-quality.
   * This marks the result for use in semantic learning.
   */
  fastify.post<{ Body: VerifyResultRequest }>(
    '/api/chat/feedback/verify',
    {
      onRequest: authMiddleware,
      schema: {
        description: 'Verify a tool result as high-quality for semantic learning',
        tags: ['chat', 'feedback'],
        body: {
          type: 'object',
          required: ['resultId', 'qualityScore'],
          properties: {
            resultId: { type: 'string', description: 'ID of the result to verify' },
            qualityScore: { type: 'number', minimum: 0, maximum: 1, description: 'Quality score (0-1)' },
            verificationComment: { type: 'string', description: 'Optional verification comment' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              verifiedResult: { type: 'object' }
            }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: VerifyResultRequest }>, reply: FastifyReply) => {
      const { resultId, qualityScore, verificationComment } = request.body;
      const userId = (request as any).userId || 'anonymous';

      log.info({
        resultId,
        qualityScore,
        userId
      }, '[USER-FEEDBACK] Verifying tool result');

      try {
        const learningService = getSemanticLearningService();

        const verifiedResult = await learningService.verifyResult({
          resultId,
          qualityScore,
          verifiedBy: userId,
          verificationType: 'user'  // Changed from 'human' to match expected type
        });

        log.info({
          event: 'RESULT_VERIFIED',
          resultId,
          qualityScore,
          verifiedBy: userId,
          timestamp: new Date().toISOString()
        }, '[USER-FEEDBACK] ✅ Result verified for semantic learning');

        return reply.send({
          success: true,
          message: 'Result verified successfully',
          verifiedResult
        });
      } catch (error) {
        log.error({ error, resultId }, '[USER-FEEDBACK] Failed to verify result');
        return reply.status(500).send({
          success: false,
          message: 'Failed to verify result'
        });
      }
    }
  );

  /**
   * GET /api/chat/feedback/stats
   *
   * Get feedback and learning statistics for the current user.
   */
  fastify.get(
    '/api/chat/feedback/stats',
    {
      onRequest: authMiddleware,
      schema: {
        description: 'Get feedback and learning statistics',
        tags: ['chat', 'feedback'],
        response: {
          200: {
            type: 'object',
            properties: {
              toolReliability: { type: 'array' },
              learningStats: { type: 'object' }
            }
          }
        }
      }
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const feedbackService = getFeedbackIntegrationService();
        const learningService = getSemanticLearningService();

        // Get tool reliability aggregates
        const toolReliability = feedbackService.getAllToolReliability();

        // Get learning statistics
        const learningStats = await learningService.getStats();

        return reply.send({
          toolReliability,
          learningStats
        });
      } catch (error) {
        log.error({ error }, '[USER-FEEDBACK] Failed to get stats');
        return reply.status(500).send({
          success: false,
          message: 'Failed to get feedback stats'
        });
      }
    }
  );

  log.info('[USER-FEEDBACK] User feedback routes registered');
}

export default registerUserFeedbackRoutes;
