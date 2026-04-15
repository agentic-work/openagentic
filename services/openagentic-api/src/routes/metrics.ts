/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * System Metrics and Monitoring Routes
 * 
 * Exposes Prometheus metrics, health checks, and system monitoring
 * endpoints for observability and performance tracking.
 * 
 * @see {@link https://docs.openagentics.io/api/metrics}
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { metricsEndpoint, getMetrics } from '../metrics/metricsMiddleware.js';

export default async function metricsRoutes(fastify: FastifyInstance) {
  // Expose metrics endpoint
  fastify.get('/metrics', metricsEndpoint);

  // Health check endpoint with metrics
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const metrics = await getMetrics();
  
    // Update active sessions count (this would normally come from your session manager)
    // metrics.setActiveSessions(sessionManager.getActiveCount());
    
    return reply.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal
      }
    });
  });

  // Readiness check endpoint
  fastify.get('/ready', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check dependencies
      const checks = {
        api: true,
        // Add other service checks here
        // redis: await checkRedis(),
        // postgres: await checkPostgres(),
        // milvus: await checkMilvus()
      };
      
      const allHealthy = Object.values(checks).every(status => status === true);
      
      if (allHealthy) {
        return reply.send({
          status: 'ready',
          checks
        });
      } else {
        return reply.status(503).send({
          status: 'not ready',
          checks
        });
      }
    } catch (error) {
      return reply.status(503).send({
        status: 'error',
        error: (error as Error).message
      });
    }
  });
}