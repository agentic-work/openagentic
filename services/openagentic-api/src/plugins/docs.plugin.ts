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
import { docsChatHandler } from '../routes/docs/chat.handler.js';
import { docsIngestHandler } from '../routes/docs/ingest.handler.js';
import { docsFeedbackHandler } from '../routes/docs/feedback.handler.js';

const docsPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  loggers.routes.info('Registering documentation chat plugin...');

  // POST /chat (with prefix becomes /api/docs/chat)
  fastify.post('/chat', {
    onRequest: authMiddleware
  }, docsChatHandler);
  loggers.routes.info('Documentation chat route registered');

  // POST /ingest (with prefix becomes /api/docs/ingest) — admin only
  fastify.post('/ingest', {
    onRequest: adminMiddleware
  }, docsIngestHandler);
  loggers.routes.info('Documentation ingest route registered');

  // POST /feedback (with prefix becomes /api/docs/feedback) — auth required
  fastify.post('/feedback', {
    onRequest: authMiddleware
  }, docsFeedbackHandler);
  loggers.routes.info('Documentation feedback route registered');
};

export default docsPlugin;
