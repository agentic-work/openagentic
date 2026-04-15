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
 * Admin Portal Health Check Routes
 * 
 * Provides health check endpoints for monitoring the admin portal SOT configuration
 */

import { FastifyPluginAsync } from 'fastify';
import { requireAdminFastify } from '../../middleware/adminGuard.js';
import { getAdminPortalHealth } from '../../startup/validateAdminPortal.js';

export const adminHealthRoutes: FastifyPluginAsync = async (fastify) => {
  
  /**
   * Get admin portal prompt system health
   * GET /admin/health/prompts
   */
  fastify.get('/prompts', {
    preHandler: [requireAdminFastify],
    schema: {
      summary: 'Get admin portal prompt system health status',
      description: 'Returns detailed health information about the admin portal prompt system configuration',
      response: {
        200: {
          type: 'object',
          properties: {
            defaultPromptExists: { type: 'boolean' },
            globalAssignmentExists: { type: 'boolean' },
            activePromptCount: { type: 'number' },
            status: { type: 'string', enum: ['healthy', 'unhealthy', 'error'] },
            errors: { type: 'array', items: { type: 'string' } }
          }
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            errors: { type: 'array', items: { type: 'string' } },
            message: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const health = await getAdminPortalHealth();
      
      const statusCode = health.status === 'healthy' ? 200 : 503;
      
      if (statusCode === 503) {
        return reply.code(statusCode).send({
          ...health,
          message: 'Admin portal prompt system is not properly configured'
        });
      }
      
      return reply.code(statusCode).send(health);
      
    } catch (error) {
      fastify.log.error({ error }, 'Failed to check admin portal health');
      return reply.code(503).send({
        status: 'error',
        errors: ['Failed to check admin portal health'],
        message: 'Internal server error'
      });
    }
  });

  /**
   * Get comprehensive admin portal health
   * GET /admin/health/system
   */
  fastify.get('/system', {
    preHandler: [requireAdminFastify],
    schema: {}
  }, async (request, reply) => {
    try {
      const promptHealth = await getAdminPortalHealth();
      
      // Add additional system health checks here in the future
      const systemHealth = {
        prompts: promptHealth,
        database: {
          status: 'healthy', // TODO: Add actual database health check
          responseTime: null
        },
        overall: promptHealth.status
      };
      
      const statusCode = systemHealth.overall === 'healthy' ? 200 : 503;
      return reply.code(statusCode).send(systemHealth);
      
    } catch (error) {
      fastify.log.error({ error }, 'Failed to check system health');
      return reply.code(500).send({
        overall: 'error',
        message: 'Failed to check system health'
      });
    }
  });

  fastify.log.info('Admin health routes registered');
};