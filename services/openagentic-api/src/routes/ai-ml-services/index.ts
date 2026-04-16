/**
 * AI/ML Services Routes Index
 *
 * Central registration point for AI and ML service endpoints.
 * Manages model discovery, capabilities, and service integrations.
 *
 * @see {@link https://docs.openagentic.io/api/ai-ml-services}
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