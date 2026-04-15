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
 * Internal Result Storage API
 *
 * Endpoints for MCPs to query stored results.
 * Not exposed publicly - only accessible via internal network.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LargeResultStorageService } from '../../services/LargeResultStorageService.js';

// Singleton storage service (shared across pipeline instances)
let storageService: LargeResultStorageService | null = null;

export function getStorageService(logger: any): LargeResultStorageService {
  if (!storageService) {
    storageService = new LargeResultStorageService(logger);
  }
  return storageService;
}

export async function registerResultStorageRoutes(fastify: FastifyInstance) {
  const logger = fastify.log;

  // Query stored result (now async — Redis backed)
  fastify.post('/api/internal/result-storage/query', async (
    request: FastifyRequest<{
      Body: {
        resultId: string;
        query: string;
        limit?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { resultId, query, limit = 10 } = request.body;

      logger.info({
        resultId,
        query,
        limit
      }, 'Internal API: Querying stored result');

      const storage = getStorageService(logger);
      const results = await storage.queryStoredResult({
        resultId,
        query,
        limit
      });

      return reply.send({
        success: true,
        resultId,
        query,
        results,
        count: results.length
      });
    } catch (error: any) {
      logger.error({
        error: error.message
      }, 'Failed to query stored result');

      const statusCode = error.message.includes('not found or has expired') ? 404 : 500;

      return reply.code(statusCode).send({
        success: false,
        error: error.message,
        expired: statusCode === 404
      });
    }
  });

  // Get stored result summary (now async — Redis backed)
  fastify.get('/api/internal/result-storage/summary/:resultId', async (
    request: FastifyRequest<{
      Params: {
        resultId: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { resultId } = request.params;

      logger.info({
        resultId
      }, 'Internal API: Getting stored result summary');

      const storage = getStorageService(logger);
      const fullResult = await storage.getFullResult(resultId);

      if (!fullResult) {
        return reply.code(404).send({
          success: false,
          error: 'Result not found or expired'
        });
      }

      return reply.send({
        success: true,
        resultId,
        summary: 'Stored result available',
        chunkCount: 0,
        sizeBytes: JSON.stringify(fullResult).length,
        timestamp: Date.now()
      });
    } catch (error: any) {
      logger.error({
        error: error.message
      }, 'Failed to get stored result summary');

      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  logger.info('Result storage internal API routes registered');
}
