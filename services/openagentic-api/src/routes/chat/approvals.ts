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
import { getPendingApprovalStore } from '../../services/PendingApprovalStore.js';
import { getRedisClient } from '../../utils/redis-client.js';

export async function approvalsRoutes(fastify: FastifyInstance) {
  // POST /api/chat/approvals/:id
  // Resolves a pending approval by id. Two paths:
  //  1. The id matches an in-process pending approval (inline chat ReAct loop) →
  //     PendingApprovalStore.resolve() unblocks it.
  //  2. The id is for a sub-agent HITL request (`agent-hitl-*`) → publish to the
  //     `hitl:result:{id}` Redis channel so openagentic-proxy's waitForApproval picks
  //     it up. Same endpoint, same UI flow, single source of truth.
  // Both paths run unconditionally so the order doesn't matter.
  fastify.post<{ Params: { id: string }; Body: { approved: boolean } }>(
    '/approvals/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { approved: boolean } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { approved } = request.body;

      const store = getPendingApprovalStore();
      const inProcessResolved = store.resolve(id, approved);

      // Publish to Redis for sub-agent HITL listeners (openagentic-proxy AgentRunner).
      // We publish even when in-process resolved was successful — harmless if no
      // one is listening, and ensures both paths converge on a single approval id.
      let redisPublished = false;
      try {
        const redis = getRedisClient();
        const channel = `hitl:result:${id}`;
        const payload = JSON.stringify({
          decision: approved ? 'approved' : 'denied',
          approvedBy: 'user',
          requestId: id,
          timestamp: Date.now(),
        });
        // openagentic-proxy subscribes BEFORE emitting the SSE event, so a publish is
        // sufficient — the race window is closed by ordering.
        await redis.publish(channel, payload);
        redisPublished = true;
      } catch (err) {
        // Non-fatal — in-process path may still have resolved
        request.log.debug({ err, id }, '[approvals] Redis publish failed (sub-agent listeners may miss event)');
      }

      if (!inProcessResolved && !redisPublished) {
        return reply.status(404).send({ error: 'Approval not found or already resolved' });
      }

      return reply.send({ ok: true, id, approved, inProcess: inProcessResolved, viaRedis: redisPublished });
    }
  );
}
