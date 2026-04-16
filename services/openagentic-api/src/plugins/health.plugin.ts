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
  const { prisma, modelHealthCheck, adminGuard } = options;

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

  // Prompt validation health check - validates prompts are loaded in database
  fastify.get('/prompt-health', async (request, reply) => {
    try {
      // Check for default prompt template using Prisma
      const defaultPrompt = await prisma.promptTemplate.findFirst({
        where: {
          is_default: true,
          is_active: true
        }
      });

      // Check for admin prompts using Prisma
      const adminPromptsCount = await prisma.promptTemplate.count({
        where: {
          is_active: true,
          name: {
            contains: 'admin',
            mode: 'insensitive'
          }
        }
      });

      // Check for system prompts using Prisma
      const systemPromptsCount = await prisma.systemPrompt.count({
        where: { is_active: true }
      });

      // Check for user assignments using Prisma
      const assignmentsCount = await prisma.userPromptAssignment.count();

      const hasDefaultPrompt = !!defaultPrompt;
      const hasAdminPrompts = adminPromptsCount > 0;
      const hasSystemPrompts = systemPromptsCount > 0;
      const isHealthy = hasDefaultPrompt && (hasAdminPrompts || hasSystemPrompts);

      if (!isHealthy) {
        loggers.server.error({
          hasDefaultPrompt,
          hasAdminPrompts,
          hasSystemPrompts,
          hasAssignments: assignmentsCount > 0,
          defaultPrompt: defaultPrompt || null
        }, '❌ CRITICAL: Prompts NOT properly loaded in database!');

        return reply.code(503).send({
          status: 'CRITICAL ERROR',
          error: 'Prompts NOT loaded in database',
          details: {
            hasDefaultPrompt,
            defaultPromptName: defaultPrompt?.name || 'MISSING',
            adminPromptCount: adminPromptsCount,
            systemPromptCount: systemPromptsCount,
            assignmentCount: assignmentsCount,
            message: 'Database seed needs to be run to populate prompts!'
          }
        });
      }

      loggers.server.info({
        defaultPrompt: defaultPrompt?.name,
        adminPrompts: adminPromptsCount,
        systemPrompts: systemPromptsCount,
        assignments: assignmentsCount
      }, '✅ Prompts properly loaded and validated');

      return {
        status: 'healthy',
        prompts: {
          defaultPrompt: defaultPrompt ? {
            id: defaultPrompt.id,
            name: defaultPrompt.name,
            isActive: defaultPrompt.is_active
          } : null,
          adminPromptCount: adminPromptsCount,
          systemPromptCount: systemPromptsCount,
          assignmentCount: assignmentsCount
        }
      };
    } catch (error: any) {
      loggers.server.error({ err: error }, '❌ Failed to check prompt health');
      return reply.code(500).send({
        status: 'error',
        error: 'Failed to validate prompts',
        details: error.message
      });
    }
  });
  loggers.routes.info('Prompt health check route registered at /prompt-health');

  // Debug endpoint for prompt content (admin only in production)
  fastify.get('/prompts/debug', async (request, reply) => {
    try {
      // Get the default prompt with content using Prisma
      const defaultPrompt = await prisma.promptTemplate.findFirst({
        where: {
          is_default: true,
          is_active: true
        },
        select: {
          id: true,
          name: true,
          content: true
        }
      });

      // Get admin prompts with content using Prisma
      const adminPrompts = await prisma.promptTemplate.findMany({
        where: {
          is_active: true,
          name: {
            contains: 'admin',
            mode: 'insensitive'
          }
        },
        select: {
          id: true,
          name: true,
          content: true
        },
        take: 5
      });

      const response = {
        status: 'Prompts loaded from database',
        defaultPrompt: defaultPrompt ? {
          id: defaultPrompt.id,
          name: defaultPrompt.name,
          contentPreview: defaultPrompt.content.substring(0, 200) + '...',
          fullContent: defaultPrompt.content
        } : null,
        adminPrompts: adminPrompts.map(p => ({
          id: p.id,
          name: p.name,
          contentPreview: p.content.substring(0, 200) + '...'
        }))
      };

      loggers.server.info('✅ Prompts debug info retrieved successfully');
      return reply.send(response);
    } catch (error: any) {
      loggers.server.error({ err: error }, '❌ Failed to get prompt debug info');
      return reply.code(500).send({
        status: 'error',
        error: 'Failed to retrieve prompt content',
        details: error.message
      });
    }
  });
  loggers.routes.info('Prompts debug route registered at /prompts/debug');

  loggers.routes.info('✅ Health & monitoring routes plugin registered successfully');
};

export default fp(healthPlugin, {
  name: 'health-routes',
  dependencies: []
});
