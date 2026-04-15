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
 * Azure Integration Services Routes
 * 
 * Provides Azure authentication, user metrics, and real-time event streaming.
 * Uses real Prisma queries for user cost/usage data.
 * 
 * @see {@link https://docs.openagentics.io/api/azure-integration}
 */

import { FastifyPluginAsync } from 'fastify';
import { azureAuthRoutes } from './auth.js';
import { azureAdminRoutes } from './admin.js';
import { azureMetricsRoutes } from './metrics.js';
import { azureEventsRoutes } from './events.js';

export const azureIntegrationPlugin: FastifyPluginAsync = async (fastify) => {
  // Register Azure authentication and OBO routes
  await fastify.register(azureAuthRoutes, { prefix: '/auth' });
  
  // Register Azure admin routes (resource info stub)
  await fastify.register(azureAdminRoutes, { prefix: '/admin/azure' });
  
  // Register Azure user metrics routes
  await fastify.register(azureMetricsRoutes, { prefix: '/azure' });
  
  // Register Azure real-time events (SSE)
  await fastify.register(azureEventsRoutes, { prefix: '/events' });
  
  fastify.log.info('Azure Integration Services routes registered - Real metrics, event stubs');
};