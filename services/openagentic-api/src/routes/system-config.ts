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
 * System Configuration Routes
 *
 * Provides endpoints for discovering system configuration.
 * Native OpenAgentic workflow engine is the default.
 */

import { FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';

export const systemConfigRoutes: FastifyPluginAsync = async (fastify, opts) => {

  /**
   * Get system configuration including deployed workflow engine
   * No authentication required - public configuration endpoint
   */
  fastify.get('/config', async (request, reply) => {
    try {
      return reply.send({
        workflowEngine: {
          type: 'native' as const,
          name: 'OpenAgentic Workflows',
          available: true,
        },
        features: {
          // Core features - default to enabled
          openagentic: process.env.OPENAGENTIC_ENABLED !== 'false',
          mcp: process.env.ENABLE_MCP !== 'false',
          vectorSearch: process.env.ENABLE_VECTOR_SEARCH !== 'false',
          // Optional services - require explicit enabling
          ollama: process.env.OLLAMA_ENABLED === 'true',
          multiModel: process.env.ENABLE_MULTI_MODEL === 'true',
          slider: process.env.ENABLE_INTELLIGENCE_SLIDER !== 'false' // Default enabled
        },
        version: process.env.APP_VERSION || '1.0.0'
      });
    } catch (error) {
      loggers.routes.error({ error }, 'Failed to get system config');
      return reply.status(500).send({ error: 'Failed to get system configuration' });
    }
  });
};

export default systemConfigRoutes;
