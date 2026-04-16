/**
 * Documentation Chat Plugin
 *
 * Registers the docs assistant chat endpoint and the admin-only
 * ingestion endpoint for the documentation UI.
 * Streams AI responses via SSE using a configurable agent from the admin console.
 *
 * NOTE: Do NOT use fastify-plugin (fp) here — we need encapsulation
 * so the prefix '/api/docs' is applied correctly.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { authMiddleware, adminMiddleware } from '../middleware/unifiedAuth.js';

const docsPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  loggers.routes.info('Registering documentation chat plugin...');

  try {
    const { docsChatHandler } = await import('../routes/docs/chat.handler.js');

    // POST /chat (with prefix becomes /api/docs/chat)
    fastify.post('/chat', {
      preHandler: authMiddleware
    }, docsChatHandler);

    loggers.routes.info('Documentation chat route registered');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register documentation chat handler');
  }

  try {
    const { docsIngestHandler } = await import('../routes/docs/ingest.handler.js');

    // POST /ingest (with prefix becomes /api/docs/ingest) — admin only
    fastify.post('/ingest', {
      preHandler: [authMiddleware, adminMiddleware]
    }, docsIngestHandler);

    loggers.routes.info('Documentation ingest route registered');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register documentation ingest handler');
  }

  try {
    const { docsFeedbackHandler } = await import('../routes/docs/feedback.handler.js');

    // POST /feedback (with prefix becomes /api/docs/feedback) — auth required
    fastify.post('/feedback', {
      preHandler: authMiddleware
    }, docsFeedbackHandler);

    loggers.routes.info('Documentation feedback route registered');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register documentation feedback handler');
  }
};

export default docsPlugin;
