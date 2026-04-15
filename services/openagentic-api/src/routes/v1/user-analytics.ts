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
 * User Tool Analytics API (v1)
 *
 * Returns per-user tool usage statistics derived from the tool_call_attempts table.
 * This is a user-facing endpoint (not admin-only) so each user can only see their
 * own data, filtered by request.user.id.
 *
 * Endpoints:
 *   GET /api/v1/me/tool-usage  - Personal tool usage summary (last 30 days)
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/unifiedAuth.js';
import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';

interface ToolUsageSummary {
  totalToolCalls: number;
  successRate: number;
  topTools: Array<{
    name: string;
    count: number;
    successRate: number;
  }>;
  recentActivity: Array<{
    tool: string;
    timestamp: string;
    success: boolean;
  }>;
  periodDays: number;
}

/**
 * User Analytics Routes
 */
export const userAnalyticsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // Auth middleware on all routes
  fastify.addHook('preHandler', authMiddleware);

  /**
   * GET /api/v1/me/tool-usage
   *
   * Returns the authenticated user's tool usage statistics for the last N days.
   * Queries the tool_call_attempts table filtered by user_id.
   */
  fastify.get<{
    Querystring: { days?: number };
  }>('/tool-usage', {
    schema: {
      tags: ['Analytics'],
      summary: 'Personal tool usage statistics',
      description: 'Returns your tool call statistics including success rate, top tools, and recent activity.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'number', default: 30, minimum: 1, maximum: 365 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            totalToolCalls: { type: 'number' },
            successRate: { type: 'number' },
            topTools: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  count: { type: 'number' },
                  successRate: { type: 'number' },
                },
              },
            },
            recentActivity: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tool: { type: 'string' },
                  timestamp: { type: 'string' },
                  success: { type: 'boolean' },
                },
              },
            },
            periodDays: { type: 'number' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const { days = 30 } = request.query as { days?: number };
    const periodDays = Math.min(Math.max(days, 1), 365);
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    try {
      // Fetch all tool call attempts for this user within the period
      const attempts = await prisma.toolCallAttempt.findMany({
        where: {
          user_id: user.id,
          attempted_at: { gte: since },
        },
        select: {
          tool_name: true,
          success: true,
          attempted_at: true,
        },
        orderBy: { attempted_at: 'desc' },
      });

      const totalToolCalls = attempts.length;
      const successCount = attempts.filter(a => a.success).length;
      const successRate = totalToolCalls > 0 ? Math.round((successCount / totalToolCalls) * 100) / 100 : 0;

      // Aggregate by tool name
      const toolMap = new Map<string, { count: number; successes: number }>();
      for (const attempt of attempts) {
        const existing = toolMap.get(attempt.tool_name) || { count: 0, successes: 0 };
        existing.count++;
        if (attempt.success) existing.successes++;
        toolMap.set(attempt.tool_name, existing);
      }

      // Top 10 tools by usage count
      const topTools = Array.from(toolMap.entries())
        .map(([name, stats]) => ({
          name,
          count: stats.count,
          successRate: stats.count > 0 ? Math.round((stats.successes / stats.count) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Recent activity (last 20 calls)
      const recentActivity = attempts.slice(0, 20).map(a => ({
        tool: a.tool_name,
        timestamp: a.attempted_at.toISOString(),
        success: a.success,
      }));

      const result: ToolUsageSummary = {
        totalToolCalls,
        successRate,
        topTools,
        recentActivity,
        periodDays,
      };

      return result;
    } catch (error) {
      logger.error({ error, userId: user.id }, 'Failed to fetch user tool usage analytics');
      return reply.code(500).send({ error: 'Failed to fetch tool usage data' });
    }
  });

  logger.info('User analytics routes registered');
};

export default userAnalyticsRoutes;
