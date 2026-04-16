/**
 * Context Management Routes
 * 
 * Manages memory contexts and relationships between memories. Supports
 * context merging, relationship graphs, and data import/export capabilities.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for memory-vector routes');
}

export const contextsRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Helper to get user from token
  const getUserFromToken = (request: any): string | null => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;

    try {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return decoded.userId || decoded.id || decoded.oid;
    } catch (error) {
      logger.warn({ error }, 'Failed to decode user token');
      return null;
    }
  };

  /**
   * List user contexts
   * GET /api/contexts
   */
  fastify.get('/', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { 
        search, 
        category, 
        limit = 50, 
        offset = 0,
        includeMemoryCount = true
      } = request.query as {
        search?: string;
        category?: string;
        limit?: number;
        offset?: number;
        includeMemoryCount?: boolean;
      };

      const where: any = { user_id: userId };
      
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ];
      }
      
      if (category) {
        where.category = category;
      }

      const [contexts, totalCount] = await Promise.all([
        prisma.memoryContext.findMany({
          where,
          orderBy: { updated_at: 'desc' },
          take: parseInt(limit.toString()),
          skip: parseInt(offset.toString()),
          include: includeMemoryCount ? {
            memories: {
              select: { id: true }
            }
          } : undefined
        }),
        
        prisma.memoryContext.count({ where })
      ]);

      // Get categories for filter options
      const categories = await prisma.memoryContext.groupBy({
        by: ['category'],
        where: { user_id: userId },
        _count: true
      });

      return reply.send({
        contexts: contexts.map(context => ({
          id: context.id,
          name: context.name,
          description: context.description,
          category: context.category,
          metadata: context.metadata as Record<string, any> || {},
          memoryCount: includeMemoryCount ? ((context as any).memories?.length || 0) : undefined,
          createdAt: context.created_at,
          updatedAt: context.updated_at,
          isActive: true  // Default value - field not in schema
        })),
        pagination: {
          total: totalCount,
          limit: parseInt(limit.toString()),
          offset: parseInt(offset.toString()),
          hasMore: totalCount > parseInt(offset.toString()) + parseInt(limit.toString())
        },
        categories: categories.map(cat => ({
          name: cat.category,
          count: cat._count
        }))
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list contexts');
      return reply.code(500).send({ error: 'Failed to retrieve contexts' });
    }
  });

  /**
   * Create new context
   * POST /api/contexts
   */
  fastify.post('/', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        name,
        description,
        category = 'general',
        metadata = {},
        memoryIds = []
      } = request.body as {
        name: string;
        description?: string;
        category?: string;
        metadata?: Record<string, any>;
        memoryIds?: string[];
      };

      if (!name) {
        return reply.code(400).send({ error: 'Context name is required' });
      }

      // Check if context name already exists for this user
      const existingContext = await prisma.memoryContext.findFirst({
        where: {
          user_id: userId,
          name: name
        }
      });

      if (existingContext) {
        return reply.code(400).send({ error: 'A context with this name already exists' });
      }

      // Validate memory IDs if provided
      if (memoryIds.length > 0) {
        const validMemories = await prisma.userMemory.findMany({
          where: {
            id: { in: memoryIds },
            user_id: userId
          },
          select: { id: true }
        });

        if (validMemories.length !== memoryIds.length) {
          return reply.code(400).send({ 
            error: 'Some memory IDs are invalid or not accessible' 
          });
        }
      }

      // Create new context
      const newContext = await prisma.memoryContext.create({
        data: {
          user_id: userId,
          name,
          description,
          category,
          context_key: `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          context_data: metadata || {},
          embedding: new Array(1536).fill(0),  // Default embedding vector
          metadata,
          memories: memoryIds.length > 0 ? {
            connect: memoryIds.map(id => ({ id }))
          } : undefined
        },
        include: {
          memories: {
            select: {
              id: true,
              memory_key: true,
              content: true,
              category: true,
              importance: true
            }
          }
        }
      });

      return reply.code(201).send({
        context: {
          id: newContext.id,
          name: newContext.name,
          description: newContext.description,
          category: newContext.category,
          metadata: newContext.metadata as Record<string, any> || {},
          memories: (newContext as any).memories,
          memoryCount: (newContext as any).memories?.length || 0,
          createdAt: newContext.created_at,
          updatedAt: newContext.updated_at,
          isActive: true  // Default value - field not in schema
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create context');
      return reply.code(500).send({ error: 'Failed to create context' });
    }
  });

  /**
   * Get specific context
   * GET /api/contexts/:id
   */
  fastify.get('/:id', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };
      const { includeMemories = true } = request.query as { includeMemories?: boolean };

      const context = await prisma.memoryContext.findFirst({
        where: {
          id,
          user_id: userId
        },
        include: includeMemories ? {
          memories: {
            orderBy: { importance: 'desc' }
          }
        } : undefined
      });

      if (!context) {
        return reply.code(404).send({ error: 'Context not found' });
      }

      // Update last accessed timestamp (update updated_at field instead)
      await prisma.memoryContext.update({
        where: { id },
        data: { updated_at: new Date() }
      });

      return reply.send({
        context: {
          id: context.id,
          name: context.name,
          description: context.description,
          category: context.category,
          metadata: context.metadata as Record<string, any> || {},
          memories: includeMemories ? (context as any).memories?.map((memory: any) => ({
            id: memory.id,
            memoryKey: memory.memory_key,
            content: memory.content,
            category: memory.category,
            importance: memory.importance,
            metadata: memory.metadata as Record<string, any> || {},
            createdAt: memory.created_at,
            updatedAt: memory.updated_at
          })) : undefined,
          memoryCount: (context as any).memories?.length || 0,
          createdAt: context.created_at,
          updatedAt: context.updated_at,
          lastAccessed: context.updated_at,  // Use updated_at as last accessed
          isActive: true  // Default value - field not in schema
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get context');
      return reply.code(500).send({ error: 'Failed to retrieve context' });
    }
  });

  /**
   * Update context
   * PUT /api/contexts/:id
   */
  fastify.put('/:id', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };
      const {
        name,
        description,
        category,
        metadata,
        isActive
      } = request.body as {
        name?: string;
        description?: string;
        category?: string;
        metadata?: Record<string, any>;
        isActive?: boolean;
      };

      const updateData: any = { updated_at: new Date() };
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (category) updateData.category = category;
      if (metadata) updateData.metadata = metadata;
      if (typeof isActive === 'boolean') updateData.is_active = isActive;

      const updatedContext = await prisma.memoryContext.updateMany({
        where: {
          id,
          user_id: userId
        },
        data: updateData
      });

      if (updatedContext.count === 0) {
        return reply.code(404).send({ error: 'Context not found' });
      }

      // Get updated context
      const context = await prisma.memoryContext.findFirst({
        where: { id, user_id: userId },
        include: {
          memories: {
            select: { id: true }
          }
        }
      });

      return reply.send({
        context: context ? {
          id: context.id,
          name: context.name,
          description: context.description,
          category: context.category,
          metadata: context.metadata as Record<string, any> || {},
          memoryCount: (context as any).memories?.length || 0,
          createdAt: context.created_at,
          updatedAt: context.updated_at,
          isActive: true  // Default value - field not in schema
        } : null
      });
    } catch (error) {
      logger.error({ error }, 'Failed to update context');
      return reply.code(500).send({ error: 'Failed to update context' });
    }
  });

  /**
   * Delete context
   * DELETE /api/contexts/:id
   */
  fastify.delete('/:id', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };
      const { preserveMemories = true } = request.query as { preserveMemories?: boolean };

      const context = await prisma.memoryContext.findFirst({
        where: { id, user_id: userId },
        include: {
          memories: { select: { id: true } }
        }
      });

      if (!context) {
        return reply.code(404).send({ error: 'Context not found' });
      }

      // If not preserving memories, delete them too
      if (!preserveMemories && (context as any).memories?.length > 0) {
        await prisma.userMemory.deleteMany({
          where: {
            id: { in: (context as any).memories.map((m: any) => m.id) },
            user_id: userId
          }
        });
      }

      // Delete the context (this will automatically disconnect memories due to relation)
      await prisma.memoryContext.delete({
        where: { id }
      });

      return reply.send({ 
        success: true, 
        message: 'Context deleted successfully',
        preservedMemories: preserveMemories ? ((context as any).memories?.length || 0) : 0,
        deletedMemories: preserveMemories ? 0 : ((context as any).memories?.length || 0)
      });
    } catch (error) {
      logger.error({ error }, 'Failed to delete context');
      return reply.code(500).send({ error: 'Failed to delete context' });
    }
  });

  /**
   * Add memories to context
   * POST /api/contexts/:id/memories
   */
  fastify.post('/:id/memories', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };
      const { memoryIds } = request.body as { memoryIds: string[] };

      if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
        return reply.code(400).send({ error: 'Memory IDs array is required' });
      }

      // Verify context exists and belongs to user
      const context = await prisma.memoryContext.findFirst({
        where: { id, user_id: userId }
      });

      if (!context) {
        return reply.code(404).send({ error: 'Context not found' });
      }

      // Validate memory IDs
      const validMemories = await prisma.userMemory.findMany({
        where: {
          id: { in: memoryIds },
          user_id: userId
        },
        select: { id: true, memory_key: true }
      });

      if (validMemories.length !== memoryIds.length) {
        return reply.code(400).send({ 
          error: 'Some memory IDs are invalid or not accessible' 
        });
      }

      // Add memories to context
      await prisma.memoryContext.update({
        where: { id },
        data: {
          memories: {
            connect: memoryIds.map(memoryId => ({ id: memoryId }))
          },
          updated_at: new Date()
        }
      });

      return reply.send({
        success: true,
        message: `${memoryIds.length} memories added to context`,
        addedMemories: validMemories.map(m => ({
          id: m.id,
          memoryKey: m.memory_key
        }))
      });
    } catch (error) {
      logger.error({ error }, 'Failed to add memories to context');
      return reply.code(500).send({ error: 'Failed to add memories to context' });
    }
  });

  /**
   * Remove memory from context
   * DELETE /api/contexts/:id/memories/:memoryId
   */
  fastify.delete('/:id/memories/:memoryId', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id, memoryId } = request.params as { id: string; memoryId: string };

      // Verify context exists and belongs to user
      const context = await prisma.memoryContext.findFirst({
        where: { id, user_id: userId }
      });

      if (!context) {
        return reply.code(404).send({ error: 'Context not found' });
      }

      // Remove memory from context
      await prisma.memoryContext.update({
        where: { id },
        data: {
          memories: {
            disconnect: { id: memoryId }
          },
          updated_at: new Date()
        }
      });

      return reply.send({
        success: true,
        message: 'Memory removed from context',
        removedMemoryId: memoryId
      });
    } catch (error) {
      logger.error({ error }, 'Failed to remove memory from context');
      return reply.code(500).send({ error: 'Failed to remove memory from context' });
    }
  });

  /**
   * Merge multiple contexts
   * POST /api/contexts/merge
   */
  fastify.post('/merge', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        contextIds,
        targetName,
        targetDescription,
        targetCategory = 'general',
        deleteSourceContexts = true
      } = request.body as {
        contextIds: string[];
        targetName: string;
        targetDescription?: string;
        targetCategory?: string;
        deleteSourceContexts?: boolean;
      };

      if (!Array.isArray(contextIds) || contextIds.length < 2) {
        return reply.code(400).send({ error: 'At least 2 context IDs are required for merging' });
      }

      if (!targetName) {
        return reply.code(400).send({ error: 'Target context name is required' });
      }

      // Verify all contexts exist and belong to user
      const contexts = await prisma.memoryContext.findMany({
        where: {
          id: { in: contextIds },
          user_id: userId
        },
        include: {
          memories: { select: { id: true } }
        }
      });

      if (contexts.length !== contextIds.length) {
        return reply.code(400).send({ error: 'Some context IDs are invalid or not accessible' });
      }

      // Collect all unique memory IDs from all contexts
      const allMemoryIds = new Set<string>();
      let totalMemories = 0;
      
      contexts.forEach(context => {
        (context as any).memories?.forEach((memory: any) => {
          allMemoryIds.add(memory.id);
        });
        totalMemories += (context as any).memories?.length || 0;
      });

      // Create the merged context
      const mergedContext = await prisma.memoryContext.create({
        data: {
          user_id: userId,
          name: targetName,
          description: targetDescription || `Merged from ${contexts.length} contexts`,
          category: targetCategory,
          context_key: `merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          context_data: {
            merged: true,
            sourceContexts: contexts.map(c => ({
              id: c.id,
              name: c.name,
              memoryCount: (c as any).memories?.length || 0
            }))
          },
          embedding: new Array(1536).fill(0),  // Default embedding vector
          metadata: {
            merged: true,
            sourceContexts: contexts.map(c => ({
              id: c.id,
              name: c.name,
              memoryCount: (c as any).memories?.length || 0
            })),
            mergedAt: new Date().toISOString()
          },
          memories: {
            connect: Array.from(allMemoryIds).map(id => ({ id }))
          }
        },
        include: {
          memories: {
            select: { id: true, memory_key: true }
          }
        }
      });

      // Delete source contexts if requested
      if (deleteSourceContexts) {
        await prisma.memoryContext.deleteMany({
          where: {
            id: { in: contextIds },
            user_id: userId
          }
        });
      }

      return reply.code(201).send({
        success: true,
        mergedContext: {
          id: mergedContext.id,
          name: mergedContext.name,
          description: mergedContext.description,
          category: mergedContext.category,
          memoryCount: (mergedContext as any).memories?.length || 0,
          createdAt: mergedContext.created_at
        },
        statistics: {
          sourceContexts: contexts.length,
          totalMemoriesBeforeMerge: totalMemories,
          uniqueMemoriesAfterMerge: allMemoryIds.size,
          deduplicatedMemories: totalMemories - allMemoryIds.size,
          sourceContextsDeleted: deleteSourceContexts
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to merge contexts');
      return reply.code(500).send({ error: 'Failed to merge contexts' });
    }
  });

  /**
   * Get context relationship graph
   * GET /api/contexts/:id/graph
   */
  fastify.get('/:id/graph', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };
      const { depth = 2 } = request.query as { depth?: number };

      const context = await prisma.memoryContext.findFirst({
        where: { id, user_id: userId },
        include: {
          memories: {
            include: {
              context: true  // Include the related memory context
            }
          }
        }
      });

      if (!context) {
        return reply.code(404).send({ error: 'Context not found' });
      }

      // Build relationship graph
      const nodes = [
        {
          id: context.id,
          name: context.name,
          type: 'context',
          category: context.category,
          level: 0
        }
      ];

      const edges: Array<{
        source: string;
        target: string;
        type: 'contains' | 'related';
        weight?: number;
      }> = [];

      // Add memories as nodes and edges
      (context as any).memories?.forEach((memory: any) => {
        nodes.push({
          id: memory.id,
          name: memory.memory_key,
          type: 'memory',
          category: memory.category || 'general',
          level: 1
        });

        edges.push({
          source: context.id,
          target: memory.id,
          type: 'contains',
          weight: memory.importance || 5
        });

        // Add related context through memory association
        if (memory.context && memory.context.id !== context.id) {
          const existingNode = nodes.find(n => n.id === memory.context.id);
          if (!existingNode) {
            nodes.push({
              id: memory.context.id,
              name: memory.context.name,
              type: 'context',
              category: memory.context.category || 'general',
              level: 2
            });
          }

          edges.push({
            source: memory.id,
            target: memory.context.id,
            type: 'related'
          });
        }
      });

      // Calculate graph statistics
      const stats = {
        totalNodes: nodes.length,
        contexts: nodes.filter(n => n.type === 'context').length,
        memories: nodes.filter(n => n.type === 'memory').length,
        totalEdges: edges.length,
        maxDepth: Math.max(...nodes.map(n => n.level)),
        categories: [...new Set(nodes.map(n => n.category))]
      };

      return reply.send({
        contextId: id,
        graph: {
          nodes,
          edges
        },
        statistics: stats,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate context graph');
      return reply.code(500).send({ error: 'Failed to generate relationship graph' });
    }
  });

  /**
   * Export context data
   * POST /api/contexts/:id/export
   */
  fastify.post('/:id/export', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };
      const {
        format = 'json',
        includeMetadata = true,
        includeRelationships = true
      } = request.body as {
        format?: 'json' | 'csv' | 'txt';
        includeMetadata?: boolean;
        includeRelationships?: boolean;
      };

      const context = await prisma.memoryContext.findFirst({
        where: { id, user_id: userId },
        include: {
          memories: includeRelationships ? {
            include: {
              context: true  // Include the memory context
            }
          } : true
        }
      });

      if (!context) {
        return reply.code(404).send({ error: 'Context not found' });
      }

      let exportData: any;

      switch (format) {
        case 'json':
          exportData = {
            context: {
              id: context.id,
              name: context.name,
              description: context.description,
              category: context.category,
              metadata: includeMetadata ? context.metadata : undefined,
              createdAt: context.created_at,
              updatedAt: context.updated_at
            },
            memories: (context as any).memories?.map((memory: any) => ({
              id: memory.id,
              memoryKey: memory.memory_key,
              content: memory.content,
              category: memory.category,
              importance: memory.importance,
              metadata: includeMetadata ? memory.metadata : undefined,
              createdAt: memory.created_at,
              updatedAt: memory.updated_at,
              relatedContext: includeRelationships && memory.context ? {
                id: memory.context.id,
                name: memory.context.name
              } : undefined
            })) || [],
            exportInfo: {
              exportedAt: new Date().toISOString(),
              format,
              memoryCount: (context as any).memories?.length || 0,
              userId
            }
          };
          break;

        case 'csv':
          const csvHeaders = ['Memory Key', 'Content', 'Category', 'Importance', 'Created At'];
          const csvRows = (context as any).memories?.map((memory: any) => [
            memory.memory_key,
            memory.content.replace(/"/g, '""'), // Escape quotes
            memory.category || '',
            memory.importance?.toString() || '',
            memory.created_at.toISOString()
          ]) || [];
          
          exportData = [csvHeaders, ...csvRows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
          break;

        case 'txt':
          exportData = `Context: ${context.name}\n`;
          exportData += `Description: ${context.description || 'No description'}\n`;
          exportData += `Category: ${context.category}\n`;
          exportData += `Memory Count: ${(context as any).memories?.length || 0}\n`;
          exportData += `\n--- MEMORIES ---\n\n`;
          
          (context as any).memories?.forEach((memory: any, index: number) => {
            exportData += `${index + 1}. ${memory.memory_key}\n`;
            exportData += `   Content: ${memory.content}\n`;
            exportData += `   Category: ${memory.category || 'general'}\n`;
            exportData += `   Importance: ${memory.importance || 'not set'}\n`;
            exportData += `   Created: ${memory.created_at.toISOString()}\n\n`;
          });
          break;
      }

      return reply.send({
        contextId: id,
        format,
        data: exportData,
        filename: `context_${context.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.${format}`,
        size: JSON.stringify(exportData).length,
        exportedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to export context');
      return reply.code(500).send({ error: 'Failed to export context data' });
    }
  });

  /**
   * Import context data
   * POST /api/contexts/import
   */
  fastify.post('/import', async (request, reply) => {
    try {
      const userId = getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        data,
        format = 'json',
        mergeStrategy = 'create_new',
        targetContextId
      } = request.body as {
        data: any;
        format?: 'json' | 'csv' | 'txt';
        mergeStrategy?: 'create_new' | 'merge_existing' | 'overwrite';
        targetContextId?: string;
      };

      if (!data) {
        return reply.code(400).send({ error: 'Import data is required' });
      }

      let importResult: any = {
        success: false,
        contextsCreated: 0,
        memoriesCreated: 0,
        memoriesUpdated: 0,
        errors: [] as string[]
      };

      if (format === 'json') {
        try {
          const importData = typeof data === 'string' ? JSON.parse(data) : data;
          
          // Validate import data structure
          if (!importData.context || !importData.memories) {
            return reply.code(400).send({ 
              error: 'Invalid import data structure. Expected context and memories fields.' 
            });
          }

          let contextId = targetContextId;

          if (mergeStrategy === 'create_new' || !targetContextId) {
            // Create new context
            const newContext = await prisma.memoryContext.create({
              data: {
                user_id: userId,
                name: importData.context.name + (targetContextId ? '' : '_imported'),
                description: importData.context.description,
                category: importData.context.category || 'general',
                context_key: `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                context_data: importData.context.metadata || {},
                embedding: new Array(1536).fill(0),  // Default embedding vector
                metadata: {
                  ...(importData.context.metadata || {}),
                  imported: true,
                  importedAt: new Date().toISOString(),
                  originalId: importData.context.id
                }
              }
            });

            contextId = newContext.id;
            importResult.contextsCreated = 1;
          }

          // Import memories
          for (const memoryData of importData.memories) {
            try {
              const existingMemory = await prisma.userMemory.findFirst({
                where: {
                  user_id: userId,
                  memory_key: memoryData.memoryKey
                }
              });

              if (existingMemory && mergeStrategy !== 'overwrite') {
                // Update existing memory
                await prisma.userMemory.update({
                  where: { id: existingMemory.id },
                  data: {
                    content: memoryData.content,
                    category: memoryData.category,
                    importance: memoryData.importance,
                    metadata: memoryData.metadata,
                    updated_at: new Date()
                  }
                });

                // Add to context if not already there
                await prisma.memoryContext.update({
                  where: { id: contextId },
                  data: {
                    memories: {
                      connect: { id: existingMemory.id }
                    }
                  }
                });

                importResult.memoriesUpdated++;
              } else {
                // Create new memory
                const newMemory = await prisma.userMemory.create({
                  data: {
                    user_id: userId,
                    memory_key: memoryData.memoryKey,
                    content: memoryData.content,
                    category: memoryData.category || 'general',
                    importance: memoryData.importance || 5,
                    metadata: {
                      ...(memoryData.metadata || {}),
                      imported: true,
                      originalId: memoryData.id
                    }
                  }
                });

                // Add to context
                await prisma.memoryContext.update({
                  where: { id: contextId },
                  data: {
                    memories: {
                      connect: { id: newMemory.id }
                    }
                  }
                });

                importResult.memoriesCreated++;
              }
            } catch (memoryError) {
              importResult.errors.push(`Failed to import memory "${memoryData.memoryKey}": ${memoryError}`);
            }
          }

          importResult.success = true;
          importResult.contextId = contextId;

        } catch (parseError) {
          return reply.code(400).send({ 
            error: 'Failed to parse JSON import data',
            details: parseError.message
          });
        }
      } else {
        return reply.code(400).send({ 
          error: 'Unsupported import format. Currently only JSON is supported.'
        });
      }

      return reply.code(201).send({
        import: importResult,
        importedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to import context data');
      return reply.code(500).send({ error: 'Failed to import context data' });
    }
  });
};