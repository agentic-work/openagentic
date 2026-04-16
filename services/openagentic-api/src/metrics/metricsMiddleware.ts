/**
 * Metrics Middleware
 * 
 * Express/Fastify middleware for automatic metrics collection
 */

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import {
  httpRequestsTotal,
  httpRequestDuration,
  register,
  trackMemoryCacheOperation,
  trackContextAssembly as trackContextAssemblyMetric,
  trackMemoryRetrieval as trackMemoryRetrievalMetric,
  updateTierUtilization as updateTierUtilizationMetric
} from './index.js';
import { logger } from '../utils/logger.js';

/**
 * HTTP Metrics Middleware for Fastify
 */
export function httpMetricsMiddleware() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const method = request.method;
    const route = request.routeOptions?.url || request.url;
    
    // Add request start time
    (request as any).startTime = start;
    
    reply.raw.on('finish', () => {
      const duration = Date.now() - start;
      const statusCode = reply.statusCode;
      const userId = (request as any).user?.userId || 'anonymous';
      
      // Track metrics
      httpRequestsTotal
        .labels(method, route, statusCode.toString(), userId)
        .inc();
      
      httpRequestDuration
        .labels(method, route, statusCode.toString())
        .observe(duration / 1000);
      
      logger.debug({
        method,
        route,
        statusCode,
        duration,
        userId
      }, 'HTTP request metrics tracked');
    });
  };
}

/**
 * Metrics endpoint handler
 */
export async function metricsEndpoint(request: FastifyRequest, reply: FastifyReply) {
  try {
    const metrics = await register.metrics();
    reply
      .header('Content-Type', register.contentType)
      .send(metrics);
  } catch (error) {
    logger.error('Error serving metrics:', error);
    reply.status(500).send({ error: 'Failed to collect metrics' });
  }
}

/**
 * Get current metrics data
 */
export async function getMetrics() {
  try {
    return await register.metrics();
  } catch (error) {
    logger.error('Error getting metrics:', error);
    throw error;
  }
}

/**
 * Utility class for tracking various metrics
 */
export class MetricsUtils {
  /**
   * Track HTTP request metrics
   */
  static trackHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    userId?: string
  ) {
    httpRequestsTotal
      .labels(method, route, statusCode.toString(), userId || 'anonymous')
      .inc();

    httpRequestDuration
      .labels(method, route, statusCode.toString())
      .observe(duration / 1000);
  }

  /**
   * Track memory operations
   */
  static trackMemoryOperation(operation: string, labels?: Record<string, any>) {
    const { model, tokens, cacheHit, cacheType } = labels || {};

    // Track based on operation type
    if (operation === 'assembly') {
      trackContextAssemblyMetric(
        model || 'unknown',
        tokens || 0,
        cacheHit || false,
        0 // Duration tracked separately by MemoryMetricsIntegration
      );
    } else if (operation === 'cache_hit' || operation === 'cache_miss') {
      trackMemoryCacheOperation(
        'get',
        cacheType || 'unknown',
        operation === 'cache_hit' ? 'hit' : 'miss'
      );
    } else if (operation === 'retrieval') {
      trackMemoryRetrievalMetric(
        labels?.userId || 'unknown',
        cacheHit || false,
        0 // Duration tracked separately
      );
    }

    logger.debug(`Memory operation: ${operation}`, labels);
  }

  /**
   * Update tier utilization metrics
   */
  static updateTierUtilization(tierStats: Record<string, number>) {
    updateTierUtilizationMetric(tierStats);
    logger.debug('Tier utilization updated', tierStats);
  }

  /**
   * Create metrics tracking middleware
   */
  static createTrackingMiddleware() {
    return httpMetricsMiddleware();
  }
}

/**
 * Register metrics plugin with Fastify
 */
export async function registerMetricsPlugin(fastify: FastifyInstance) {
  // Add metrics endpoint
  fastify.get('/metrics', metricsEndpoint);
  
  // Add metrics middleware
  fastify.addHook('onRequest', httpMetricsMiddleware());
  
  logger.info('📊 Metrics plugin registered with Fastify');
}

export default {
  httpMetricsMiddleware,
  metricsEndpoint,
  getMetrics,
  MetricsUtils,
  registerMetricsPlugin
};