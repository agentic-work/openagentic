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
 * AI/ML Services Routes Index
 *
 * Central registration point for AI and ML service endpoints.
 * Manages model discovery, capabilities, and service integrations.
 *
 * @see {@link https://docs.openagentics.io/api/ai-ml-services}
 */

import { FastifyPluginAsync } from 'fastify';
import { modelsRoutes } from './models.js';
import type { ProviderManager } from '../../services/llm-providers/ProviderManager.js';

export interface AIMLPluginOptions {
  providerManager?: ProviderManager;
}

export const aiMlServicesPlugin: FastifyPluginAsync<AIMLPluginOptions> = async (fastify, options) => {
  // Register model discovery and capabilities routes with providerManager
  await fastify.register(modelsRoutes, {
    prefix: '/models',
    providerManager: options.providerManager
  });

  fastify.log.info('AI/ML Services routes registered');
};