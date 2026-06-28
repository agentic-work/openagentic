import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { getWorkflowMarketplaceService } from '../services/WorkflowMarketplaceService.js';

const logger = loggers.routes;

// Request types

interface TemplateIdParams {
  id: string;
}

interface AuthorIdParams {
  authorId: string;
}

interface SearchQuery {
  query?: string;
  category?: string;
  tags?: string;
  author?: string;
  visibility?: 'public' | 'organization' | 'private';
  minRating?: number;
  sortBy?: 'downloads' | 'stars' | 'rating' | 'recent' | 'name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

interface PublishBody {
  workflowId: string;
  displayName: string;
  description: string;
  shortDescription?: string;
  category: string;
  subcategory?: string;
  tags: string[];
  visibility: 'public' | 'organization' | 'private';
  license?: string;
  version?: string;
  changelog?: string;
}

interface ForkBody {
  newName: string;
  description?: string;
  visibility?: 'public' | 'organization' | 'private';
  customizations?: {
    nodeOverrides?: Record<string, any>;
    parameterDefaults?: Record<string, any>;
    removeNodes?: string[];
    addNodes?: any[];
  };
}

interface RateBody {
  rating: number;
  review?: string;
}

interface FeaturedQuery {
  limit?: number;
}

interface TagsQuery {
  limit?: number;
}

export const workflowMarketplaceRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const service = getWorkflowMarketplaceService();

  // GET /search
  fastify.get<{ Querystring: SearchQuery }>(
    '/search',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const { tags, ...rest } = request.query;
        const result = await service.searchTemplates({
          ...rest,
          tags: tags ? tags.split(',') : undefined,
          minRating: rest.minRating ? Number(rest.minRating) : undefined,
          page: rest.page ? Number(rest.page) : undefined,
          pageSize: rest.pageSize ? Number(rest.pageSize) : undefined,
        });
        return reply.send(result);
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Search failed');
        return reply.code(500).send({ error: 'Search failed', message: error.message });
      }
    }
  );

  // GET /featured
  fastify.get<{ Querystring: FeaturedQuery }>(
    '/featured',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? Number(request.query.limit) : undefined;
        const templates = await service.getFeaturedTemplates(limit);
        return reply.send({ templates });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Get featured failed');
        return reply.code(500).send({ error: 'Failed to get featured templates', message: error.message });
      }
    }
  );

  // GET /categories
  fastify.get(
    '/categories',
    { onRequest: authMiddleware },
    async (_request, reply) => {
      try {
        const categories = await service.getCategories();
        return reply.send({ categories });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Get categories failed');
        return reply.code(500).send({ error: 'Failed to get categories', message: error.message });
      }
    }
  );

  // GET /tags
  fastify.get<{ Querystring: TagsQuery }>(
    '/tags',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const limit = request.query.limit ? Number(request.query.limit) : undefined;
        const tags = await service.getPopularTags(limit);
        return reply.send({ tags });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Get tags failed');
        return reply.code(500).send({ error: 'Failed to get tags', message: error.message });
      }
    }
  );

  // GET /starred
  fastify.get(
    '/starred',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        const templates = await service.getUserStarredTemplates(userId);
        return reply.send({ templates });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Get starred failed');
        return reply.code(500).send({ error: 'Failed to get starred templates', message: error.message });
      }
    }
  );

  // GET /author/:authorId
  fastify.get<{ Params: AuthorIdParams }>(
    '/author/:authorId',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const templates = await service.getTemplatesByAuthor(request.params.authorId);
        return reply.send({ templates });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Get author templates failed');
        return reply.code(500).send({ error: 'Failed to get author templates', message: error.message });
      }
    }
  );

  // GET /templates/:id
  fastify.get<{ Params: TemplateIdParams }>(
    '/templates/:id',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        const template = await service.getTemplate(request.params.id);
        if (!template) {
          return reply.code(404).send({ error: 'Template not found' });
        }
        // Record download (fire-and-forget)
        service.recordDownload(request.params.id, userId).catch(() => {});
        return reply.send({ template });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Get template failed');
        return reply.code(500).send({ error: 'Failed to get template', message: error.message });
      }
    }
  );

  // POST /publish
  fastify.post<{ Body: PublishBody }>(
    '/publish',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        const { workflowId, ...options } = request.body;
        if (!workflowId || !options.displayName || !options.description || !options.category || !options.tags) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'workflowId, displayName, description, category, and tags are required',
          });
        }
        const template = await service.publishTemplate(workflowId, userId, options);
        return reply.code(201).send({ template });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Publish failed');
        const status = error.message?.includes('not found') ? 404 : 500;
        return reply.code(status).send({ error: 'Publish failed', message: error.message });
      }
    }
  );

  // POST /templates/:id/fork
  fastify.post<{ Params: TemplateIdParams; Body: ForkBody }>(
    '/templates/:id/fork',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        const { newName } = request.body;
        if (!newName) {
          return reply.code(400).send({ error: 'Validation error', message: 'newName is required' });
        }
        const result = await service.forkTemplate(request.params.id, userId, request.body);
        return reply.code(201).send(result);
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Fork failed');
        const status = error.message?.includes('not found') ? 404 : 500;
        return reply.code(status).send({ error: 'Fork failed', message: error.message });
      }
    }
  );

  // POST /templates/:id/rate
  fastify.post<{ Params: TemplateIdParams; Body: RateBody }>(
    '/templates/:id/rate',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        const { rating, review } = request.body;
        if (!rating || rating < 1 || rating > 5) {
          return reply.code(400).send({ error: 'Validation error', message: 'rating must be between 1 and 5' });
        }
        await service.rateTemplate(request.params.id, userId, rating, review);
        return reply.send({ success: true });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Rate failed');
        const status = error.message?.includes('not found') ? 404 : 500;
        return reply.code(status).send({ error: 'Rate failed', message: error.message });
      }
    }
  );

  // POST /templates/:id/star
  fastify.post<{ Params: TemplateIdParams }>(
    '/templates/:id/star',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        const result = await service.toggleStar(request.params.id, userId);
        return reply.send(result);
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Star toggle failed');
        const status = error.message?.includes('not found') ? 404 : 500;
        return reply.code(status).send({ error: 'Star toggle failed', message: error.message });
      }
    }
  );

  // DELETE /templates/:id
  fastify.delete<{ Params: TemplateIdParams }>(
    '/templates/:id',
    { onRequest: authMiddleware },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        if (!userId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        await service.deleteTemplate(request.params.id, userId);
        return reply.send({ success: true });
      } catch (error: any) {
        logger.error({ error }, '[Marketplace] Delete failed');
        let status = 500;
        if (error.message?.includes('not found')) status = 404;
        if (error.message?.includes('Not authorized')) status = 403;
        return reply.code(status).send({ error: 'Delete failed', message: error.message });
      }
    }
  );

  logger.info('Workflow marketplace routes registered');
};

export default workflowMarketplaceRoutes;
