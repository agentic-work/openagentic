/**
 * Embeddings API Route
 *
 * Provides a unified embeddings endpoint that uses the UniversalEmbeddingService
 * to generate embeddings via the configured provider (Azure, AWS, Ollama, etc.)
 *
 * This endpoint is OpenAI-compatible and can be called by:
 * - MCP proxy
 * - Memory services
 * - Any internal service that needs embeddings
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { UniversalEmbeddingService } from '../services/UniversalEmbeddingService.js';

const logger = loggers.routes.child({ component: 'Embeddings' });

// Singleton embedding service
let embeddingService: UniversalEmbeddingService | null = null;

interface EmbeddingRequest {
  model?: string;
  input: string | string[];
  encoding_format?: string;
  dimensions?: number;
}

interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

const embeddingsRoutes: FastifyPluginAsync = async (fastify) => {
  // Initialize embedding service on first request
  const getEmbeddingService = (): UniversalEmbeddingService => {
    if (!embeddingService) {
      try {
        embeddingService = new UniversalEmbeddingService(logger);
        const info = embeddingService.getInfo();
        logger.info({
          provider: info.provider,
          model: info.model,
          dimensions: info.dimensions
        }, 'Embeddings service initialized');
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to initialize embeddings service');
        throw error;
      }
    }
    return embeddingService;
  };

  /**
   * POST /api/embeddings
   * OpenAI-compatible embeddings endpoint
   */
  fastify.post('/', async (request: FastifyRequest<{ Body: EmbeddingRequest }>, reply: FastifyReply) => {
    const startTime = Date.now();
    const { input, model, encoding_format, dimensions } = request.body;

    if (!input) {
      return reply.code(400).send({
        error: {
          message: 'input is required',
          type: 'invalid_request_error'
        }
      });
    }

    try {
      const service = getEmbeddingService();
      const inputArray = Array.isArray(input) ? input : [input];

      if (inputArray.length === 1) {
        // Single embedding
        const result = await service.generateEmbedding(inputArray[0]);

        const response: EmbeddingResponse = {
          object: 'list',
          data: [{
            object: 'embedding',
            embedding: result.embedding,
            index: 0
          }],
          model: result.model,
          usage: {
            prompt_tokens: result.usage?.prompt_tokens || inputArray[0].split(/\s+/).length,
            total_tokens: result.usage?.total_tokens || inputArray[0].split(/\s+/).length
          }
        };

        const duration = Date.now() - startTime;
        logger.info({
          provider: result.provider,
          model: result.model,
          dimensions: result.dimensions,
          inputLength: inputArray[0].length,
          duration
        }, 'Generated single embedding');

        return reply.send(response);
      } else {
        // Batch embeddings
        const result = await service.generateBatchEmbeddings(inputArray);

        const response: EmbeddingResponse = {
          object: 'list',
          data: result.embeddings.map((embedding, index) => ({
            object: 'embedding',
            embedding,
            index
          })),
          model: result.model,
          usage: {
            prompt_tokens: result.usage?.prompt_tokens || inputArray.reduce((sum, text) => sum + text.split(/\s+/).length, 0),
            total_tokens: result.usage?.total_tokens || inputArray.reduce((sum, text) => sum + text.split(/\s+/).length, 0)
          }
        };

        const duration = Date.now() - startTime;
        logger.info({
          provider: result.provider,
          model: result.model,
          dimensions: result.dimensions,
          count: inputArray.length,
          duration
        }, 'Generated batch embeddings');

        return reply.send(response);
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        stack: error.stack
      }, 'Embedding generation failed');

      return reply.code(500).send({
        error: {
          message: `Embedding generation failed: ${error.message}`,
          type: 'server_error'
        }
      });
    }
  });

  /**
   * GET /api/embeddings/info
   * Get information about the configured embedding service
   */
  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getEmbeddingService();
      const info = service.getInfo();

      return reply.send({
        success: true,
        ...info
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/embeddings/health
   * Health check for embedding service
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getEmbeddingService();
      const info = service.getInfo();

      // Try a simple embedding to verify service is working
      await service.generateEmbedding('test');

      return reply.send({
        status: 'healthy',
        provider: info.provider,
        model: info.model,
        dimensions: info.dimensions
      });
    } catch (error: any) {
      return reply.code(503).send({
        status: 'unhealthy',
        error: error.message
      });
    }
  });
};

export default embeddingsRoutes;
