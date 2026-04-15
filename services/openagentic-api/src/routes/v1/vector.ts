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
 * Vector Search API Routes - v1
 *
 * Provides semantic vector search endpoints for the CLI and other clients.
 * Uses Milvus for vector storage and similarity search.
 *
 * Endpoints:
 * - POST /api/v1/vector/search - Semantic search across code/docs
 *
 * Authentication: Requires valid awc_* token or JWT
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import { authMiddleware } from '../../middleware/unifiedAuth.js';
import { loggers } from '../../utils/logger.js';

const logger = loggers.routes;

// Milvus client singleton
let milvusClient: MilvusClient | null = null;

function getMilvusClient(): MilvusClient {
  if (!milvusClient) {
    const milvusAddress = process.env.MILVUS_ADDRESS ||
      `${process.env.MILVUS_HOST || 'milvus-standalone'}:${process.env.MILVUS_PORT || '19530'}`;

    milvusClient = new MilvusClient({
      address: milvusAddress,
      username: process.env.MILVUS_USERNAME,
      password: process.env.MILVUS_PASSWORD,
    });
  }
  return milvusClient;
}

// Request/Response interfaces
interface VectorSearchBody {
  query: string;
  collection?: string;  // 'code' | 'docs' | 'memories' - defaults to 'code'
  topK?: number;        // Number of results (max 50)
  minScore?: number;    // Minimum similarity score (0-1)
  filter?: {
    file_extensions?: string[];
    paths?: string[];
  };
}

interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: {
    file_path?: string;
    line_start?: number;
    line_end?: number;
    language?: string;
    [key: string]: any;
  };
}

interface VectorSearchResponse {
  results: VectorSearchResult[];
  total?: number;
  query: string;
  collection: string;
}

// Embedding generation (uses the same model as indexing)
async function generateEmbedding(text: string): Promise<number[]> {
  const embeddingEndpoint = process.env.EMBEDDING_ENDPOINT || 'http://localhost:8000/api/embeddings';
  const embeddingApiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;

  try {
    // Try internal embedding service first
    const response = await fetch(embeddingEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${embeddingApiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.data?.[0]?.embedding || data.embedding;
    }

    // Fallback to OpenAI directly
    const openaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text,
        model: 'text-embedding-ada-002',
      }),
    });

    if (!openaiResponse.ok) {
      throw new Error(`Embedding generation failed: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    return openaiData.data[0].embedding;
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to generate embedding');
    throw new Error(`Embedding generation failed: ${error.message}`);
  }
}

// Collection name mapping
function getCollectionName(collection: string): string {
  const collectionMap: Record<string, string> = {
    'code': process.env.MILVUS_CODE_COLLECTION || 'code_embeddings',
    'docs': process.env.MILVUS_DOCS_COLLECTION || 'doc_embeddings',
    'memories': process.env.MILVUS_MEMORY_COLLECTION || 'user_memories',
  };
  return collectionMap[collection] || collectionMap['code'];
}

export const vectorRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /api/v1/vector/search
   * Semantic search using Milvus vector database
   */
  fastify.post<{ Body: VectorSearchBody }>('/search', {
    preHandler: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 1000 },
          collection: { type: 'string', enum: ['code', 'docs', 'memories'] },
          topK: { type: 'number', minimum: 1, maximum: 50 },
          minScore: { type: 'number', minimum: 0, maximum: 1 },
          filter: {
            type: 'object',
            properties: {
              file_extensions: { type: 'array', items: { type: 'string' } },
              paths: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: VectorSearchBody }>, reply: FastifyReply) => {
    const startTime = Date.now();
    const user = (request as any).user;

    try {
      const {
        query,
        collection = 'code',
        topK = 10,
        minScore = 0.5,
        filter
      } = request.body;

      logger.info({
        userId: user?.userId || user?.id,
        query: query.substring(0, 100),
        collection,
        topK,
      }, '[VECTOR] Starting semantic search');

      // Check if Milvus is available
      const client = getMilvusClient();
      const health = await client.checkHealth();

      if (!health.isHealthy) {
        logger.warn('[VECTOR] Milvus is not healthy');
        return reply.code(503).send({
          error: 'Vector search unavailable',
          message: 'Milvus vector database is not available. Please try again later.',
        });
      }

      // Get the collection name
      const collectionName = getCollectionName(collection);

      // Check if collection exists
      const hasCollection = await client.hasCollection({ collection_name: collectionName });
      if (!hasCollection.value) {
        logger.warn({ collectionName }, '[VECTOR] Collection does not exist');
        return reply.send({
          results: [],
          total: 0,
          query,
          collection,
          message: `No indexed content found for collection '${collection}'`,
        });
      }

      // Load collection if not loaded
      try {
        await client.loadCollection({ collection_name: collectionName });
      } catch (loadError: any) {
        // Collection might already be loaded
        if (!loadError.message?.includes('already loaded')) {
          logger.warn({ error: loadError.message }, '[VECTOR] Collection load warning');
        }
      }

      // Generate embedding for the query
      const queryEmbedding = await generateEmbedding(query);

      // Build filter expression
      let filterExpr = '';
      if (filter?.file_extensions?.length) {
        const extensions = filter.file_extensions.map(e => `"${e}"`).join(', ');
        filterExpr = `file_extension in [${extensions}]`;
      }
      if (filter?.paths?.length) {
        const pathFilters = filter.paths.map(p => `file_path like "${p}%"`).join(' or ');
        filterExpr = filterExpr ? `${filterExpr} and (${pathFilters})` : pathFilters;
      }

      // Perform vector search
      const searchParams = {
        collection_name: collectionName,
        vectors: [queryEmbedding],
        vector_type: DataType.FloatVector as DataType.FloatVector,
        search_params: {
          anns_field: 'embedding',
          topk: Math.min(topK, 50),
          metric_type: 'COSINE',
          params: JSON.stringify({ nprobe: 10 }),
        },
        output_fields: ['id', 'content', 'file_path', 'line_start', 'line_end', 'language', 'metadata'],
        filter: filterExpr || undefined,
      };

      const searchResult = await client.search(searchParams);

      // Process results - cast to any to handle varying Milvus SDK result structures
      const results: VectorSearchResult[] = [];
      const rawResults = (searchResult as any).results || [];

      if (rawResults.length > 0) {
        for (const hit of rawResults) {
          const score = (hit as any).score || 0;

          // Filter by minimum score
          if (score < minScore) continue;

          let metadata: any = {};
          try {
            const rawMeta = (hit as any).metadata;
            metadata = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta || {};
          } catch {
            metadata = {};
          }

          results.push({
            id: (hit as any).id?.toString() || String((hit as any).$meta?.id || ''),
            content: (hit as any).content || '',
            score: score,
            metadata: {
              file_path: (hit as any).file_path || metadata.file_path,
              line_start: (hit as any).line_start || metadata.line_start,
              line_end: (hit as any).line_end || metadata.line_end,
              language: (hit as any).language || metadata.language,
              ...metadata,
            },
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info({
        userId: user?.userId || user?.id,
        resultCount: results.length,
        duration,
        collection,
      }, '[VECTOR] Search completed');

      return reply.send({
        results,
        total: results.length,
        query,
        collection,
      } as VectorSearchResponse);

    } catch (error: any) {
      const duration = Date.now() - startTime;
      logger.error({
        error: error.message,
        stack: error.stack?.substring(0, 500),
        duration,
      }, '[VECTOR] Search failed');

      // Handle specific errors
      if (error.message?.includes('embedding')) {
        return reply.code(503).send({
          error: 'Embedding service unavailable',
          message: 'Failed to generate query embedding. Please try again later.',
        });
      }

      return reply.code(500).send({
        error: 'Vector search failed',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/vector/health
   * Check Milvus health status
   */
  fastify.get('/health', async (request, reply) => {
    try {
      const client = getMilvusClient();
      const health = await client.checkHealth();

      return reply.send({
        healthy: health.isHealthy,
        status: health.isHealthy ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      return reply.code(503).send({
        healthy: false,
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /api/v1/vector/collections
   * List available collections
   */
  fastify.get('/collections', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const client = getMilvusClient();
      const collections = await client.listCollections();

      return reply.send({
        collections: collections.data?.map(c => ({
          name: c.name,
          // Add collection stats if needed
        })) || [],
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[VECTOR] Failed to list collections');
      return reply.code(500).send({
        error: 'Failed to list collections',
        message: error.message,
      });
    }
  });
};

export default vectorRoutes;
