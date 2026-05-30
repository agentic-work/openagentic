/**
 * Personal Memory Management API
 * Provides endpoints for users to manage their persistent memories
 * Features: Create, retrieve, search, update, delete memories
 * @see ./docs/api/memories.md
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/fastify-auth.js';
import { EnhancedMemoryService } from '../services/EnhancedMemoryService.js';
import { MemoryService } from '../services/MemoryService.js';
import { logger } from '../utils/logger.js';

// Request/Response schemas
const CreateMemorySchema = z.object({
  content: z.string().min(1).max(10000),
  type: z.enum(['explicit', 'contextual', 'inferred']).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  importance: z.number().min(0).max(1).optional()
});

const UpdateMemorySchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  importance: z.number().min(0).max(1).optional()
});

const SearchMemoriesSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(100).default(10),
  threshold: z.number().min(0).max(1).default(0.7),
  tags: z.array(z.string()).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional()
});

export default async function memoriesRoutes(fastify: FastifyInstance & {
  prisma: any;
  milvus: any;
  openai: any;
  cache: any;
}) {
  const memoryService = new MemoryService(logger, fastify.prisma, fastify.milvus);
  const enhancedMemoryService = new EnhancedMemoryService(
    logger,
    fastify.prisma,
    memoryService,
    fastify.openai,
    fastify.cache,
    fastify.milvus
  );

  /**
   * Get all memories for the authenticated user
   */
  fastify.get('/memories', {
    preHandler: authenticate,
    schema: {
      querystring: z.object({
        limit: z.string().transform(Number).pipe(z.number().min(1).max(100)).optional().default('50'),
        offset: z.string().transform(Number).pipe(z.number().min(0)).optional().default('0'),
        type: z.enum(['explicit', 'contextual', 'inferred']).optional(),
        sortBy: z.enum(['created', 'updated', 'importance']).optional().default('created'),
        order: z.enum(['asc', 'desc']).optional().default('desc')
      }),
      response: {
        200: z.object({
          memories: z.array(z.object({
            id: z.string(),
            content: z.string(),
            type: z.string(),
            tags: z.array(z.string()),
            importance: z.number(),
            createdAt: z.string(),
            updatedAt: z.string(),
            metadata: z.record(z.string(), z.any()).optional()
          })),
          total: z.number(),
          hasMore: z.boolean()
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user!;
    const { limit, offset, type, sortBy, order } = request.query as any;

    try {
      // Get memories from database
      const where: any = { userId };
      if (type) where.type = type;

      const [memories, total] = await Promise.all([
        fastify.prisma.userMemory.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: {
            [sortBy === 'created' ? 'createdAt' : sortBy === 'updated' ? 'updatedAt' : 'importanceScore']: order
          }
        }),
        fastify.prisma.userMemory.count({ where })
      ]);

      return reply.send({
        memories: memories.map(m => ({
          id: m.id,
          content: m.content,
          type: m.memoryType,
          tags: m.tags || [],
          importance: m.importanceScore,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
          metadata: m.metadata as any
        })),
        total,
        hasMore: offset + limit < total
      });
    } catch (error) {
      logger.error('Failed to get memories:', error);
      return reply.status(500).send({ error: 'Failed to retrieve memories' });
    }
  });

  /**
   * Search memories using semantic similarity
   */
  fastify.post('/memories/search', {
    preHandler: authenticate,
    schema: {
      body: SearchMemoriesSchema,
      response: {
        200: z.object({
          results: z.array(z.object({
            id: z.string(),
            content: z.string(),
            type: z.string(),
            tags: z.array(z.string()),
            importance: z.number(),
            similarity: z.number(),
            createdAt: z.string(),
            metadata: z.record(z.string(), z.any()).optional()
          }))
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user!;
    const body = request.body as z.infer<typeof SearchMemoriesSchema>;

    try {
      const results = await memoryService.searchMemories(
        userId,
        body.query,
        body.limit,
        body.threshold
      );

      // Apply additional filters if provided
      let filtered = results;
      
      if (body.tags && body.tags.length > 0) {
        filtered = filtered.filter(r => 
          r.tags.some(tag => body.tags!.includes(tag))
        );
      }

      if (body.startDate) {
        const start = new Date(body.startDate);
        filtered = filtered.filter(r => new Date(r.createdAt) >= start);
      }

      if (body.endDate) {
        const end = new Date(body.endDate);
        filtered = filtered.filter(r => new Date(r.createdAt) <= end);
      }

      return reply.send({
        results: filtered.map(r => ({
          id: r.id,
          content: r.content,
          type: r.type,
          tags: r.tags,
          importance: r.importance,
          similarity: r.similarity || 0,
          createdAt: r.createdAt,
          metadata: r.metadata
        }))
      });
    } catch (error) {
      logger.error('Failed to search memories:', error);
      return reply.status(500).send({ error: 'Failed to search memories' });
    }
  });

  /**
   * Create a new memory
   */
  fastify.post('/memories', {
    preHandler: authenticate,
    schema: {
      body: CreateMemorySchema,
      response: {
        201: z.object({
          id: z.string(),
          content: z.string(),
          type: z.string(),
          tags: z.array(z.string()),
          importance: z.number(),
          createdAt: z.string()
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user!;
    const body = request.body as z.infer<typeof CreateMemorySchema>;

    try {
      const memory = await memoryService.createMemory({
        userId,
        content: body.content,
        type: body.type || 'explicit',
        tags: body.tags,
        metadata: body.metadata,
        importance: body.importance || 0.5
      });

      return reply.status(201).send({
        id: memory.id,
        content: memory.content,
        type: memory.type,
        tags: memory.tags || [],
        importance: memory.importance,
        createdAt: memory.createdAt
      });
    } catch (error) {
      logger.error('Failed to create memory:', error);
      return reply.status(500).send({ error: 'Failed to create memory' });
    }
  });

  /**
   * Get a specific memory
   */
  fastify.get('/memories/:id', {
    preHandler: authenticate,
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      response: {
        200: z.object({
          id: z.string(),
          content: z.string(),
          type: z.string(),
          tags: z.array(z.string()),
          importance: z.number(),
          createdAt: z.string(),
          updatedAt: z.string(),
          metadata: z.record(z.string(), z.any()).optional()
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user!;
    const { id } = request.params as { id: string };

    try {
      const memory = await fastify.prisma.userMemory.findFirst({
        where: { id, userId }
      });

      if (!memory) {
        return reply.status(404).send({ error: 'Memory not found' });
      }

      return reply.send({
        id: memory.id,
        content: memory.content,
        type: memory.memoryType,
        tags: memory.tags || [],
        importance: memory.importanceScore,
        createdAt: memory.createdAt.toISOString(),
        updatedAt: memory.updatedAt.toISOString(),
        metadata: memory.metadata as any
      });
    } catch (error) {
      logger.error('Failed to get memory:', error);
      return reply.status(500).send({ error: 'Failed to retrieve memory' });
    }
  });

  /**
   * Update a memory
   */
  fastify.patch('/memories/:id', {
    preHandler: authenticate,
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      body: UpdateMemorySchema,
      response: {
        200: z.object({
          id: z.string(),
          content: z.string(),
          type: z.string(),
          tags: z.array(z.string()),
          importance: z.number(),
          updatedAt: z.string()
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user!;
    const { id } = request.params as { id: string };
    const body = request.body as z.infer<typeof UpdateMemorySchema>;

    try {
      // Check ownership
      const existing = await fastify.prisma.userMemory.findFirst({
        where: { id, userId }
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Memory not found' });
      }

      // Update memory
      const updated = await fastify.prisma.userMemory.update({
        where: { id },
        data: {
          content: body.content,
          tags: body.tags,
          metadata: body.metadata as any,
          importanceScore: body.importance,
          updatedAt: new Date()
        }
      });

      // Update vector if content changed
      if (body.content && body.content !== existing.content) {
        await memoryService.updateMemoryEmbedding(id, body.content);
      }

      return reply.send({
        id: updated.id,
        content: updated.content,
        type: updated.memoryType,
        tags: updated.tags || [],
        importance: updated.importanceScore,
        updatedAt: updated.updatedAt.toISOString()
      });
    } catch (error) {
      logger.error('Failed to update memory:', error);
      return reply.status(500).send({ error: 'Failed to update memory' });
    }
  });

  /**
   * Delete a memory
   */
  fastify.delete('/memories/:id', {
    preHandler: authenticate,
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      response: {
        204: z.null()
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user!;
    const { id } = request.params as { id: string };

    try {
      // Check ownership
      const memory = await fastify.prisma.userMemory.findFirst({
        where: { id, userId }
      });

      if (!memory) {
        return reply.status(404).send({ error: 'Memory not found' });
      }

      // Delete from database and vector store
      await Promise.all([
        fastify.prisma.userMemory.delete({ where: { id } }),
        memoryService.deleteMemoryVector(userId, id)
      ]);

      return reply.status(204).send();
    } catch (error) {
      logger.error('Failed to delete memory:', error);
      return reply.status(500).send({ error: 'Failed to delete memory' });
    }
  });

  /**
   * Get memory clusters
   */
  fastify.get('/memories/clusters', {
    preHandler: authenticate,
    schema: {
      response: {
        200: z.object({
          clusters: z.array(z.object({
            id: z.string(),
            theme: z.string(),
            memories: z.array(z.string()),
            centroid: z.array(z.number()).optional(),
            createdAt: z.string()
          }))
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user!;

    try {
      const clusters = await enhancedMemoryService.clusterUserMemories(userId);

      return reply.send({
        clusters: clusters.map((c, i) => ({
          id: `cluster-${i}`,
          theme: c.theme,
          memories: c.memories,
          centroid: c.centroid,
          createdAt: new Date().toISOString()
        }))
      });
    } catch (error) {
      logger.error('Failed to get memory clusters:', error);
      return reply.status(500).send({ error: 'Failed to retrieve memory clusters' });
    }
  });

  /**
   * Export memories
   */
  fastify.get('/memories/export', {
    preHandler: authenticate,
    schema: {
      querystring: z.object({
        format: z.enum(['json', 'csv', 'markdown']).default('json')
      })
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user!;
    const { format } = request.query as { format: string };

    try {
      const memories = await fastify.prisma.userMemory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });

      if (format === 'json') {
        return reply
          .header('Content-Type', 'application/json')
          .header('Content-Disposition', 'attachment; filename="memories.json"')
          .send(JSON.stringify(memories, null, 2));
      } else if (format === 'csv') {
        const csv = [
          'ID,Content,Type,Tags,Importance,Created,Updated',
          ...memories.map(m => 
            `"${m.id}","${m.content.replace(/"/g, '""')}","${m.memoryType}","${m.tags?.join(';') || ''}",${m.importanceScore},"${m.createdAt.toISOString()}","${m.updatedAt.toISOString()}"`
          )
        ].join('\n');
        
        return reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', 'attachment; filename="memories.csv"')
          .send(csv);
      } else {
        const markdown = memories.map(m => 
          `## ${m.createdAt.toLocaleDateString()}\n\n${m.content}\n\n*Type: ${m.memoryType}, Importance: ${m.importanceScore}*\n\n---\n`
        ).join('\n');
        
        return reply
          .header('Content-Type', 'text/markdown')
          .header('Content-Disposition', 'attachment; filename="memories.md"')
          .send(markdown);
      }
    } catch (error) {
      logger.error('Failed to export memories:', error);
      return reply.status(500).send({ error: 'Failed to export memories' });
    }
  });
}