/**
 * Vector Database Management Routes
 *
 * Vector management is now handled through the unified data layer.
 * These routes return 503 to indicate the service has been consolidated.
 *
 */

import { FastifyPluginAsync } from 'fastify';

export const managementRoutes: FastifyPluginAsync = async (fastify) => {
  const unavailableResponse = { error: 'Vector management moved to unified data layer', status: 503 };

  fastify.get('/health', async (request, reply) => {
    return reply.code(503).send(unavailableResponse);
  });

  fastify.get('/maintenance/plan', async (request, reply) => {
    return reply.code(503).send(unavailableResponse);
  });

  fastify.post('/maintenance/execute', async (request, reply) => {
    return reply.code(503).send(unavailableResponse);
  });

  fastify.post('/backup', async (request, reply) => {
    return reply.code(503).send(unavailableResponse);
  });

  fastify.post('/restore', async (request, reply) => {
    return reply.code(503).send(unavailableResponse);
  });

  fastify.get('/analytics', async (request, reply) => {
    return reply.code(503).send(unavailableResponse);
  });

  fastify.post('/collections', async (request, reply) => {
    return reply.code(503).send(unavailableResponse);
  });

  fastify.get('/status', async (request, reply) => {
    return reply.code(503).send(unavailableResponse);
  });

  fastify.log.info('Vector Management routes registered (unified data layer stub)');
};
