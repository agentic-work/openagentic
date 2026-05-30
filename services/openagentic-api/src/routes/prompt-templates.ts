/**
 * Prompt Templates Routes
 * 
 * API endpoints for managing AI prompt templates including creation,
 * retrieval, updates, and assignment to users or groups. Supports
 * versioning, validation, and template inheritance patterns.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import { prisma } from '../utils/prisma.js';

const logger = pino({
  name: 'prompt-templates',
  level: process.env.LOG_LEVEL || 'info'
});
// Prisma client imported from utils/prisma

interface PromptTemplateRequest {
  Body: {
    name: string;
    description?: string;
    content: string;
    category?: string;
    tags?: string[];
    isPublic?: boolean;
    userId: string;
  };
}

interface PromptTemplateParams {
  Params: {
    id: string;
  };
}

interface PromptTemplateQuery {
  Querystring: {
    category?: string;
    userId?: string;
    isPublic?: boolean;
    limit?: number;
    offset?: number;
  };
}

const promptTemplateRoutes: FastifyPluginAsync = async (fastify, opts) => {
  // Get all prompt templates
  fastify.get<{ Querystring: PromptTemplateQuery['Querystring'] }>(
    '/',
    async (request, reply) => {
      try {
        const { category, userId, isPublic, limit = 100, offset = 0 } = request.query;

        const where: any = {};
        if (category) where.category = category;
        if (userId) where.userId = userId;
        if (isPublic !== undefined) where.isPublic = isPublic;

        const [templates, total] = await Promise.all([
          prisma.promptTemplate.findMany({
            where,
            orderBy: { created_at: 'desc' },
            take: Number(limit),
            skip: Number(offset)
          }),
          prisma.promptTemplate.count({ where })
        ]);

        return reply.send({
          templates,
          total
        });
      } catch (error) {
        logger.error({ error }, 'Failed to fetch prompt templates');
        return reply.status(500).send({ error: 'Failed to fetch templates' });
      }
    }
  );

  // Get single prompt template
  fastify.get<PromptTemplateParams>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;

        const template = await prisma.promptTemplate.findUnique({
          where: { id: parseInt(id) }
        });

        if (!template) {
          return reply.status(404).send({ error: 'Template not found' });
        }

        return reply.send(template);
      } catch (error) {
        logger.error({ error }, 'Failed to fetch prompt template');
        return reply.status(500).send({ error: 'Failed to fetch template' });
      }
    }
  );

  // Create prompt template
  fastify.post<PromptTemplateRequest>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'content', 'userId'],
          properties: {
            name: { type: 'string', minLength: 1 },
            description: { type: 'string' },
            content: { type: 'string', minLength: 1 },
            category: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            isPublic: { type: 'boolean' },
            userId: { type: 'string' }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const template = await prisma.promptTemplate.create({
          data: request.body
        });

        return reply.status(201).send(template);
      } catch (error) {
        logger.error({ error }, 'Failed to create prompt template');
        return reply.status(500).send({ error: 'Failed to create template' });
      }
    }
  );

  // Update prompt template
  fastify.put<PromptTemplateRequest & PromptTemplateParams>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;

        const template = await prisma.promptTemplate.update({
          where: { id: parseInt(id) },
          data: request.body
        });

        return reply.send(template);
      } catch (error: any) {
        if (error.message?.includes('Record not found')) {
          return reply.status(404).send({ error: 'Template not found' });
        }
        logger.error({ error }, 'Failed to update prompt template');
        return reply.status(500).send({ error: 'Failed to update template' });
      }
    }
  );

  // Delete prompt template
  fastify.delete<PromptTemplateParams>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;

        await prisma.promptTemplate.delete({
          where: { id: parseInt(id) }
        });

        return reply.status(204).send();
      } catch (error: any) {
        if (error.message?.includes('Record not found')) {
          return reply.status(404).send({ error: 'Template not found' });
        }
        logger.error({ error }, 'Failed to delete prompt template');
        return reply.status(500).send({ error: 'Failed to delete template' });
      }
    }
  );

  // Get available categories
  fastify.get('/categories', async (request, reply) => {
    const categories = [
      'general',
      'development',
      'writing',
      'analysis',
      'creative',
      'business',
      'education',
      'other'
    ];

    return reply.send({ categories });
  });
};

export default promptTemplateRoutes;