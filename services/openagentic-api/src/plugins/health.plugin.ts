/**
 * Health & Monitoring Routes Plugin
 *
 * Modularized from server.ts (HIGH-001 refactoring)
 * Groups all health check and monitoring route registrations.
 *
 * Includes:
 * - Basic health check
 * - Prometheus metrics
 * - Model health check
 * - Prompt health validation
 * - OpenAPI spec endpoint
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { PrismaClient } from '@prisma/client';

interface HealthPluginOptions {
  prisma: PrismaClient;
  modelHealthCheck?: {
    checkModelHealth: () => Promise<unknown>;
  };
  adminGuard?: (request: any, reply: any) => Promise<void>;
}

const healthPlugin: FastifyPluginAsync<HealthPluginOptions> = async (
  fastify: FastifyInstance,
  options: HealthPluginOptions
) => {
  const { modelHealthCheck, adminGuard } = options;

  loggers.routes.info('Registering health & monitoring routes plugin...');

  // NOTE: Basic /health is registered in server.ts (line ~799) before DB init
  // for Kubernetes probes. Do NOT duplicate it here.

  // Prometheus metrics endpoint
  fastify.get('/metrics', async (request, reply) => {
    try {
      const { register } = await import('../metrics/index.js');
      reply.type(register.contentType);
      const metrics = await register.metrics();
      return metrics;
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to get metrics');
      return reply.code(500).send({ error: 'Failed to retrieve metrics' });
    }
  });

  // Also expose metrics at /api/metrics for compatibility
  fastify.get('/api/metrics', async (request, reply) => {
    try {
      const { register } = await import('../metrics/index.js');
      reply.type(register.contentType);
      const metrics = await register.metrics();
      return metrics;
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to get metrics');
      return reply.code(500).send({ error: 'Failed to retrieve metrics' });
    }
  });
  loggers.routes.info('Prometheus metrics routes registered at /metrics and /api/metrics');

  // OpenAPI spec JSON endpoint for Admin Portal embedding (requires admin auth)
  if (adminGuard) {
    fastify.get('/api/openapi.json', { preHandler: [adminGuard] }, async (request, reply) => {
      reply.type('application/json');
      return fastify.swagger();
    });
    loggers.routes.info('OpenAPI spec route registered at /api/openapi.json (admin auth required)');
  }

  // Model health check endpoint
  if (modelHealthCheck) {
    fastify.get('/model-health', async () => {
      const healthResult = await modelHealthCheck.checkModelHealth();
      return healthResult;
    });
    loggers.routes.info('Model health check route registered at /model-health');
  }

  // /prompt-health and /prompts/debug routes RIPPED 2026-05-11
  // (the chat-pipeline refactor Phase E final). Both depended on the legacy
  // PromptTemplate / SystemPrompt / UserPromptAssignment Prisma models
  // which have been dropped along with the composable prompt-module
  // system. RBAC system prompts have their own health surface via the
  // rbac_system_prompts table.

  loggers.routes.info('Health & monitoring routes plugin registered successfully');
};

export default fp(healthPlugin, {
  name: 'health-routes',
  dependencies: []
});
