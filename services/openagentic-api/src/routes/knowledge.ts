import { FastifyInstance } from 'fastify';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { KnowledgeIngestionService } from '../services/KnowledgeIngestionService.js';
import { AzureSDKKnowledgeIngester } from '../services/AzureSDKKnowledgeIngester.js';

interface SearchRequest {
  query: string;
  collections?: string[];
  limit?: number;
  includePrivate?: boolean;
  includeSources?: boolean;
}

interface IngestionRequest {
  type: 'documentation' | 'chats' | 'all';
  options?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  };
}

export default async function knowledgeRoutes(fastify: FastifyInstance) {
  const milvus = new MilvusClient({
    address: process.env.MILVUS_HOST || 'localhost:19530',
    username: process.env.MILVUS_USERNAME,
    password: process.env.MILVUS_PASSWORD
  });
  
  const ingestionService = new KnowledgeIngestionService(
    milvus,
    (fastify as any).prisma,
    fastify.log as any
  );

  /**
   * Search knowledge base
   */
  fastify.post<{ Body: SearchRequest }>(
    '/api/knowledge/search',
    {
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            collections: {
              type: 'array',
              items: { type: 'string' }
            },
            limit: { type: 'number', minimum: 1, maximum: 50 },
            includePrivate: { type: 'boolean' },
            includeSources: { type: 'boolean' }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    content: { type: 'string' },
                    score: { type: 'number' },
                    source: { type: 'string' },
                    type: { type: 'string' },
                    metadata: { type: 'object' }
                  }
                }
              },
              query: { type: 'string' },
              totalResults: { type: 'number' },
              searchTime: { type: 'number' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const startTime = Date.now();
      const { query, collections, limit = 10, includePrivate = false, includeSources = true } = request.body;
      
      try {
        // Get user ID from session if authenticated
        const userId = (request as any).user?.id;
        
        const results = await ingestionService.searchKnowledge(query, {
          collections,
          limit,
          includePrivate,
          userId
        });
        
        // Format results
        const formattedResults = results.map(result => {
          const metadata = typeof result.metadata === 'string' 
            ? JSON.parse(result.metadata) 
            : result.metadata;
          
          return {
            content: result.content,
            score: result.score,
            source: includeSources ? result.source : undefined,
            type: result.type,
            metadata: {
              title: metadata.title,
              category: metadata.category,
              timestamp: metadata.timestamp,
              tags: metadata.tags
            }
          };
        });
        
        return {
          results: formattedResults,
          query,
          totalResults: formattedResults.length,
          searchTime: Date.now() - startTime
        };
      } catch (error) {
        request.log.error({ error }, 'Knowledge search failed');
        return reply.status(500).send({
          error: 'Search failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );

  /**
   * Get knowledge base statistics
   */
  fastify.get('/api/knowledge/stats', async (request, reply) => {
    try {
      const stats = ingestionService.getStats();
      
      // Get collection counts
      const collections = ['app_documentation', 'chat_conversations', 'code_knowledge'];
      const collectionStats: any = {};
      
      for (const collection of collections) {
        try {
          const stats = await milvus.getCollectionStatistics({
            collection_name: collection
          });
          collectionStats[collection] = {
            rowCount: stats.stats.find((s: any) => s.key === 'row_count')?.value || 0
          };
        } catch (error) {
          collectionStats[collection] = { rowCount: 0 };
        }
      }
      
      return {
        ingestionStats: stats,
        collections: collectionStats,
        status: 'healthy'
      };
    } catch (error) {
      request.log.error({ error }, 'Failed to get knowledge stats');
      return reply.status(500).send({
        error: 'Failed to get statistics'
      });
    }
  });

  /**
   * Trigger knowledge ingestion (admin only)
   */
  fastify.post<{ Body: IngestionRequest }>(
    '/api/knowledge/ingest',
    {
      preHandler: [(fastify as any).authenticate, (fastify as any).adminGuard],
      schema: {
        body: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: ['documentation', 'chats', 'all']
            },
            options: {
              type: 'object',
              properties: {
                startDate: { type: 'string', format: 'date' },
                endDate: { type: 'string', format: 'date' },
                limit: { type: 'number' }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { type, options } = request.body;
      
      try {
        // Initialize collections first
        await ingestionService.initializeCollections();
        
        // Reset stats
        ingestionService.resetStats();
        
        // Run ingestion based on type
        if (type === 'documentation' || type === 'all') {
          await ingestionService.ingestDocumentation();
        }
        
        if (type === 'chats' || type === 'all') {
          await ingestionService.ingestChatLogs({
            startDate: options?.startDate ? new Date(options.startDate) : undefined,
            endDate: options?.endDate ? new Date(options.endDate) : undefined,
            limit: options?.limit
          });
        }
        
        const stats = ingestionService.getStats();
        
        return {
          success: true,
          stats,
          message: `Successfully ingested ${stats.successfulChunks} chunks`
        };
      } catch (error) {
        request.log.error({ error }, 'Ingestion failed');
        return reply.status(500).send({
          error: 'Ingestion failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );

  /**
   * Trigger Azure SDK documentation ingestion (admin only)
   * This fetches latest Azure CLI/SDK docs from Microsoft Learn and stores in Milvus
   */
  fastify.post(
    '/api/knowledge/ingest/azure-sdk',
    {
      preHandler: [(fastify as any).authenticate, (fastify as any).adminGuard],
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              sourcesProcessed: { type: 'number' },
              chunksStored: { type: 'number' },
              errors: { type: 'array', items: { type: 'string' } },
              message: { type: 'string' }
            }
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        request.log.info('Starting Azure SDK documentation ingestion');

        const azureIngester = new AzureSDKKnowledgeIngester(milvus, fastify.log as any);
        const results = await azureIngester.ingestAllDocumentation();

        request.log.info({
          sourcesProcessed: results.sourcesProcessed,
          chunksStored: results.chunksStored,
          errors: results.errors.length
        }, 'Azure SDK documentation ingestion completed');

        return {
          success: results.success,
          sourcesProcessed: results.sourcesProcessed,
          chunksStored: results.chunksStored,
          errors: results.errors,
          message: results.success
            ? `Successfully ingested ${results.chunksStored} chunks from ${results.sourcesProcessed} Azure documentation sources`
            : `Ingestion completed with ${results.errors.length} errors`
        };
      } catch (error) {
        request.log.error({ error }, 'Azure SDK documentation ingestion failed');
        reply.code(500);
        return {
          success: false,
          error: 'Ingestion failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  );

  /**
   * Search Azure SDK documentation specifically
   */
  fastify.post<{ Body: { query: string; limit?: number; category?: string } }>(
    '/api/knowledge/search/azure-sdk',
    {
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', minimum: 1, maximum: 20 },
            category: {
              type: 'string',
              enum: ['azure-cli', 'azure-sdk-python', 'azure-rest-api', 'azure-general']
            }
          }
        }
      }
    },
    async (request, reply) => {
      const { query, limit = 5, category } = request.body;

      try {
        const azureIngester = new AzureSDKKnowledgeIngester(milvus, fastify.log as any);
        const results = await azureIngester.search(query, { limit, category });

        return {
          results: results.map(r => ({
            content: r.content,
            score: r.score,
            source: r.source,
            sourceUrl: r.sourceUrl,
            category: r.category,
            commands: r.metadata?.commands,
            examples: r.metadata?.examples
          })),
          query,
          totalResults: results.length
        };
      } catch (error) {
        request.log.error({ error }, 'Azure SDK search failed');
        return reply.status(500).send({
          error: 'Search failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  );

  /**
   * Get Azure SDK documentation statistics
   */
  fastify.get('/api/knowledge/stats/azure-sdk', async (request, reply) => {
    try {
      const azureIngester = new AzureSDKKnowledgeIngester(milvus, fastify.log as any);
      const stats = await azureIngester.getStats();

      return {
        collection: 'azure_sdk_documentation',
        ...stats,
        status: stats.totalChunks > 0 ? 'populated' : 'empty'
      };
    } catch (error) {
      request.log.error({ error }, 'Failed to get Azure SDK stats');
      return reply.status(500).send({
        error: 'Failed to get statistics'
      });
    }
  });

  /**
   * Search chat conversations with privacy controls
   */
  fastify.post<{ Body: { query: string; limit?: number } }>(
    '/api/knowledge/search/chats',
    {
      preHandler: [(fastify as any).authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', minimum: 1, maximum: 20 }
          }
        }
      }
    },
    async (request, reply) => {
      const { query, limit = 5 } = request.body;
      const userId = (request as any).user?.id;
      const isAdmin = (request as any).user?.role === 'admin';
      
      try {
        const results = await ingestionService.searchKnowledge(query, {
          collections: ['chat_conversations'],
          limit,
          includePrivate: isAdmin, // Admins can see all chats
          userId // Regular users only see their own private chats
        });
        
        // Anonymize results if not admin
        const formattedResults = results.map(result => {
          const metadata = typeof result.metadata === 'string' 
            ? JSON.parse(result.metadata) 
            : result.metadata;
          
          if (!isAdmin && metadata.userId !== userId) {
            // Anonymize other users' data
            metadata.userId = 'anonymous';
            metadata.sessionId = 'hidden';
          }
          
          return {
            content: result.content,
            score: result.score,
            timestamp: metadata.timestamp,
            topics: metadata.tags,
            isOwn: metadata.userId === userId
          };
        });
        
        return {
          results: formattedResults,
          query,
          totalResults: formattedResults.length
        };
      } catch (error) {
        request.log.error({ error }, 'Chat search failed');
        return reply.status(500).send({
          error: 'Search failed'
        });
      }
    }
  );
}