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
 * Chat Capabilities API Route
 * 
 * Returns available AI capabilities, model information, and feature availability
 * based on current deployment configuration and connected services.
 * 
 * @see {@link https://docs.openagentics.io/api/chat/capabilities}
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../../middleware/unifiedAuth.js';
import { ExtendedCapabilitiesService } from '../../services/ModelCapabilitiesService.js';
import { loggers } from '../../utils/logger.js';

/**
 * Get available AI capabilities for this deployment
 */
export async function getCapabilitiesHandler(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Initialize capabilities service with proper configuration
    const capabilitiesService = new ExtendedCapabilitiesService({
      autoDiscovery: true,
      benchmarkOnDiscovery: true,
      testToolsOnDiscovery: true,
      cacheCapabilities: true
    });
    
    const capabilities = await capabilitiesService.discoverAllCapabilities();

    // Add deployment metadata
    const response = {
      ...capabilities,
      deployment: {
        name: process.env.AZURE_OPENAI_DEPLOYMENT || 'unknown',
        region: process.env.AZURE_REGION || 'unknown',
        timestamp: new Date().toISOString()
      }
    };

    reply.send(response);

  } catch (error) {
    request.log.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to get capabilities');

    reply.code(500).send({
      error: {
        code: 'CAPABILITIES_ERROR',
        message: 'Failed to retrieve AI capabilities'
      }
    });
  }
}