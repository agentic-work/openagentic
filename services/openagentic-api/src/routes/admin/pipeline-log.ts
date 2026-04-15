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

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface PipelineLogEntry {
  stageTimings: Record<string, number>;
  modelRouting: { requested: string; selected: string; reason: string; slider: number };
  systemPrompt: { totalTokens: number; sections: { name: string; tokens: number }[] };
  mcpTools: { matched: number; injected: number; toolNames: string[] };
  toolCallRounds: { round: number; tools: { name: string; duration: number; status: string }[] }[];
  tokenUsage: { input: number; output: number; cost: number };
  hitlEvents: { id: string; tool: string; approved: boolean; waitMs: number }[];
}

export async function pipelineLogRoutes(fastify: FastifyInstance) {
  // GET /api/admin/pipeline-log/:sessionId/:messageId
  fastify.get<{ Params: { sessionId: string; messageId: string } }>(
    '/pipeline-log/:sessionId/:messageId',
    async (request: FastifyRequest<{ Params: { sessionId: string; messageId: string } }>, reply: FastifyReply) => {
      const { sessionId, messageId } = request.params;

      // Try to read from Redis cache
      try {
        const { getRedisClient } = await import('../../utils/redis-client.js');
        const redis = getRedisClient();
        if (redis) {
          const key = `pipeline:${sessionId}:${messageId}`;
          const data = await redis.get(key);
          if (data) {
            return reply.send(JSON.parse(data));
          }
        }
      } catch {
        // Redis not available — fall through
      }

      // Return placeholder if no cached data
      return reply.status(404).send({
        error: 'Pipeline log not found',
        message: 'Pipeline logs are cached for 1 hour after execution. This log may have expired or the pipeline may not have logged data for this message.',
      });
    }
  );
}
