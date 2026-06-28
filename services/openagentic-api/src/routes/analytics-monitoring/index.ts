/**
 * Analytics & Monitoring Services Routes
 * 
 * Registers analytics, monitoring, and metrics collection endpoints.
 * Provides centralized access to all system analytics and health monitoring.
 * 
 * @see {@link https://docs.openagentic.io/api/analytics-monitoring}
 */

import { FastifyPluginAsync } from 'fastify';
import { analyticsRoutes } from './usage.js';
import { promptMetricsRoutes } from './prompt-metrics.js';

export const analyticsMonitoringPlugin: FastifyPluginAsync = async (fastify) => {
  // Register analytics and monitoring routes
  await fastify.register(analyticsRoutes, { prefix: '/' });
  await fastify.register(promptMetricsRoutes, { prefix: '/' });

  fastify.log.info('Analytics & Monitoring Services routes registered');
};