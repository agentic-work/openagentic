/**
 * Advanced Prompting Services Routes
 * 
 * Registers prompt generation, optimization, and engineering endpoints.
 * Provides centralized access to all advanced prompting capabilities.
 * 
 * @see {@link https://docs.openagentic.io/api/advanced-prompting}
 */

import { FastifyPluginAsync } from 'fastify';
import { advancedPromptingRoutes } from './prompts.js';

export const advancedPromptingPlugin: FastifyPluginAsync = async (fastify) => {
  // Register advanced prompting routes
  await fastify.register(advancedPromptingRoutes, { prefix: '/prompts' });
  
  fastify.log.info('Advanced Prompting Services routes registered');
};