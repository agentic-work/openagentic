/**
 * Admin Azure AI Foundry Metrics API
 *
 * Exposes metrics from Azure AI Foundry per model deployment
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getAIFoundryMetricsService } from '../services/AzureAIFoundryMetricsService.js';
import { logger } from '../utils/logger.js';

export default async function adminAIFMetricsRoutes(fastify: FastifyInstance) {

  // Get all model metrics
  fastify.get('/aif-metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metricsService = getAIFoundryMetricsService();

      if (!metricsService) {
        return reply.code(503).send({
          error: 'Azure AI Foundry metrics service not initialized',
          message: 'Metrics collection may not be configured'
        });
      }

      const allMetrics = metricsService.getAllCachedMetrics();

      return reply.send({
        metrics: allMetrics,
        summary: metricsService.getMetricsSummary()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get AIF metrics');
      return reply.code(500).send({ error: 'Failed to get metrics' });
    }
  });

  // Get metrics for specific model deployment
  fastify.get<{
    Params: { deploymentName: string }
  }>('/aif-metrics/:deploymentName', async (request, reply) => {
    try {
      const { deploymentName } = request.params;
      const metricsService = getAIFoundryMetricsService();

      if (!metricsService) {
        return reply.code(503).send({
          error: 'Azure AI Foundry metrics service not initialized'
        });
      }

      const metrics = await metricsService.getModelMetrics(deploymentName);

      if (!metrics) {
        return reply.code(404).send({
          error: 'Model deployment not found',
          deploymentName
        });
      }

      return reply.send(metrics);

    } catch (error) {
      logger.error({ error, deployment: request.params.deploymentName }, 'Failed to get model metrics');
      return reply.code(500).send({ error: 'Failed to get model metrics' });
    }
  });

  // Force refresh metrics (admin action)
  fastify.post('/aif-metrics/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metricsService = getAIFoundryMetricsService();

      if (!metricsService) {
        return reply.code(503).send({
          error: 'Azure AI Foundry metrics service not initialized'
        });
      }

      logger.info('Admin requested metrics refresh');
      const metrics = await metricsService.collectAllMetrics();

      return reply.send({
        success: true,
        message: 'Metrics refreshed successfully',
        count: metrics.length,
        metrics
      });

    } catch (error) {
      logger.error({ error }, 'Failed to refresh metrics');
      return reply.code(500).send({
        error: 'Failed to refresh metrics',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get metrics summary
  fastify.get('/aif-metrics-summary', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metricsService = getAIFoundryMetricsService();

      if (!metricsService) {
        return reply.code(503).send({
          error: 'Azure AI Foundry metrics service not initialized'
        });
      }

      const summary = metricsService.getMetricsSummary();

      return reply.send(summary);

    } catch (error) {
      logger.error({ error }, 'Failed to get metrics summary');
      return reply.code(500).send({ error: 'Failed to get metrics summary' });
    }
  });
}
