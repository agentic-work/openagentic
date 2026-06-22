/**
 * Admin Dashboard Counts Route (OSS free tier)
 *
 * Provides basic platform counts for the admin dashboard.
 * Replaces the enterprise admin-dashboard-metrics endpoint with a
 * simple, free-tier count of core entities.
 *
 * GET /api/admin/dashboard/counts
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { adminMiddleware } from '../middleware/unifiedAuth.js';

const adminDashboardCountsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/counts',
    {
      onRequest: [adminMiddleware as any],
    },
    async (_request, reply) => {
      const safeCount = async (fn: () => Promise<number>): Promise<number> => {
        try {
          return await fn();
        } catch {
          return 0;
        }
      };

      const [chats, messages, users, workflows, flowRuns, agentRuns, llmRequests] =
        await Promise.all([
          safeCount(() => prisma.chatSession.count()),
          safeCount(() => prisma.chatMessage.count()),
          safeCount(() => prisma.user.count()),
          safeCount(() => prisma.workflow.count()),
          safeCount(() => prisma.workflowExecution.count()),
          safeCount(() => prisma.agentExecution.count()),
          safeCount(() => prisma.lLMRequestLog.count()),
        ]);

      return reply.send({
        chats,
        messages,
        users,
        workflows,
        flowRuns,
        agentRuns,
        llmRequests,
      });
    },
  );
};

export default adminDashboardCountsRoutes;
