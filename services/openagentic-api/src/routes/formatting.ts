/**
 * Formatting Capabilities API Routes
 *
 * REST endpoints for accessing formatting capabilities, validation, and guidance
 */

import { FastifyPluginAsync } from 'fastify';
import { getFormattingCapabilitiesService } from '../services/formatting/index.js';
import type { Logger } from 'pino';

const formattingRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log.child({ plugin: 'formatting' }) as Logger;
  const formattingService = getFormattingCapabilitiesService(logger);

  /**
   * GET /api/formatting/capabilities
   * Get all available formatting capabilities
   */
  fastify.get('/capabilities', async (request, reply) => {
    try {
      const capabilities = formattingService.getAllCapabilities();

      return reply.send({
        success: true,
        count: capabilities.length,
        capabilities
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get capabilities');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch formatting capabilities'
      });
    }
  });

  /**
   * GET /api/formatting/capabilities/:category
   * Get capabilities filtered by category
   */
  fastify.get<{
    Params: { category: string };
  }>('/capabilities/:category', async (request, reply) => {
    try {
      const { category } = request.params;
      const capabilities = formattingService.getCapabilitiesByCategory(category);

      return reply.send({
        success: true,
        category,
        count: capabilities.length,
        capabilities
      });
    } catch (error) {
      logger.error({ error, category: request.params.category }, 'Failed to get capabilities by category');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch capabilities by category'
      });
    }
  });

  /**
   * GET /api/formatting/presets
   * Get all available formatting presets
   */
  fastify.get('/presets', async (request, reply) => {
    try {
      const presets = formattingService.getAllPresets();

      return reply.send({
        success: true,
        count: presets.length,
        presets
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get presets');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch formatting presets'
      });
    }
  });

  /**
   * POST /api/formatting/guidance
   * Get contextual formatting guidance for a query
   */
  fastify.post<{
    Body: { query: string };
  }>('/guidance', async (request, reply) => {
    try {
      const { query } = request.body;

      if (!query || typeof query !== 'string') {
        return reply.code(400).send({
          success: false,
          error: 'Query string is required'
        });
      }

      const guidance = formattingService.getGuidanceForQuery(query);

      return reply.send({
        success: true,
        query,
        guidance
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get formatting guidance');
      return reply.code(500).send({
        success: false,
        error: 'Failed to generate formatting guidance'
      });
    }
  });

  /**
   * POST /api/formatting/validate
   * Validate markdown content
   */
  fastify.post<{
    Body: { content: string };
  }>('/validate', async (request, reply) => {
    try {
      const { content } = request.body;

      if (!content || typeof content !== 'string') {
        return reply.code(400).send({
          success: false,
          error: 'Content string is required'
        });
      }

      const validation = formattingService.validateContent(content);

      return reply.send({
        success: true,
        validation
      });
    } catch (error) {
      logger.error({ error }, 'Failed to validate content');
      return reply.code(500).send({
        success: false,
        error: 'Failed to validate content'
      });
    }
  });

  /**
   * GET /api/formatting/alternatives/bullets
   * Get alternatives to bullet lists
   */
  fastify.get<{
    Querystring: { context?: string };
  }>('/alternatives/bullets', async (request, reply) => {
    try {
      const { context } = request.query;
      const alternatives = formattingService.getAlternativesToBullets(context);

      return reply.send({
        success: true,
        alternatives
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get bullet alternatives');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch alternatives'
      });
    }
  });

  /**
   * GET /api/formatting/system-prompt
   * Get the complete system prompt section for formatting capabilities
   */
  fastify.get('/system-prompt', async (request, reply) => {
    try {
      const systemPrompt = formattingService.generateSystemPromptSection();

      return reply.send({
        success: true,
        prompt: systemPrompt
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate system prompt');
      return reply.code(500).send({
        success: false,
        error: 'Failed to generate system prompt'
      });
    }
  });

  /**
   * GET /api/formatting
   * Get complete service metadata (all capabilities, presets, categories)
   */
  fastify.get('/', async (request, reply) => {
    try {
      const metadata = formattingService.toJSON();

      return reply.send({
        success: true,
        ...metadata
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get service metadata');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch service metadata'
      });
    }
  });

  logger.info('Formatting capabilities routes registered');
};

export default formattingRoutes;
