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
 * Advanced Prompting Services Routes
 * 
 * Registers prompt generation, optimization, and engineering endpoints.
 * Provides centralized access to all advanced prompting capabilities.
 * 
 * @see {@link https://docs.openagentics.io/api/advanced-prompting}
 */

import { FastifyPluginAsync } from 'fastify';
import { advancedPromptingRoutes } from './prompts.js';

export const advancedPromptingPlugin: FastifyPluginAsync = async (fastify) => {
  // Register advanced prompting routes
  await fastify.register(advancedPromptingRoutes, { prefix: '/prompts' });
  
  fastify.log.info('Advanced Prompting Services routes registered');
};