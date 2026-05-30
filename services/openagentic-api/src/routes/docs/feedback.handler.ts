/**
 * Documentation Feedback Handler
 *
 * Allows users to submit feedback on docs assistant answers.
 * Feedback is stored in a dedicated Milvus collection (docs_feedback)
 * that only the docs agent has access to for improving future answers.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { getDocsRAGService } from '../../services/DocsRAGService.js';

interface FeedbackBody {
  question: string;
  answer: string;
  feedback: string;
  rating: number; // 1-5
}

export async function docsFeedbackHandler(
  request: FastifyRequest<{ Body: FeedbackBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { question, answer, feedback, rating } = request.body;
  const user = (request as any).user;
  const logger = loggers.routes;

  if (!question || !rating || rating < 1 || rating > 5) {
    return reply.code(400).send({ error: 'question and rating (1-5) are required' });
  }

  const docsRAG = getDocsRAGService(logger);
  const success = await docsRAG.storeFeedback({
    question,
    answer: answer || '',
    feedback: feedback || '',
    rating,
    userId: user?.id || 'anonymous',
  });

  return reply.send({ success });
}
