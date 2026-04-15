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
 * Internal HITL Policy API
 *
 * Single source of truth for HITL approval timeout + risk-classification
 * config. Read by openagentic-proxy AgentRunner so the inline chat ReAct loop and
 * the sub-agent loop wait for the same duration on a HITL approval.
 *
 * Not exposed publicly — internal network only.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../utils/prisma.js';

interface HitlPolicyRow {
  timeoutMs?: number;
  mediumRiskRequiresApproval?: boolean;
  trustThreshold?: number;
  minCallsForTrust?: number;
}

const DEFAULT_POLICY: HitlPolicyRow = {
  timeoutMs: 120_000,
  mediumRiskRequiresApproval: true,
  trustThreshold: 0.85,
  minCallsForTrust: 5,
};

export async function registerHitlPolicyRoutes(fastify: FastifyInstance) {
  // GET /api/internal/hitl/policy
  // Returns the current HITL policy from admin.system_configuration.hitl_policy.
  // Falls back to in-process defaults if the row is missing (matches the
  // ToolApprovalGate seed defaults).
  fastify.get('/api/internal/hitl/policy', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const row = await prisma.systemConfiguration.findFirst({
        where: { key: 'hitl_policy' },
      });
      if (row?.value) {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : (row.value as HitlPolicyRow);
        return reply.send({
          timeoutMs: val.timeoutMs ?? DEFAULT_POLICY.timeoutMs,
          mediumRiskRequiresApproval: val.mediumRiskRequiresApproval ?? DEFAULT_POLICY.mediumRiskRequiresApproval,
          trustThreshold: val.trustThreshold ?? DEFAULT_POLICY.trustThreshold,
          minCallsForTrust: val.minCallsForTrust ?? DEFAULT_POLICY.minCallsForTrust,
          source: 'db',
        });
      }
      return reply.send({ ...DEFAULT_POLICY, source: 'default' });
    } catch (err: any) {
      fastify.log.warn({ err: err.message }, '[hitl-policy] Failed to read DB, returning defaults');
      return reply.send({ ...DEFAULT_POLICY, source: 'fallback', error: err.message });
    }
  });
}
