/**
 * Admin Dashboard Counts Route (OSS free tier)
 *
 * Provides basic platform counts for the admin dashboard.
 * Replaces the enterprise admin-dashboard-metrics endpoint with a
 * simple, free-tier count of core entities.
 *
 * GET /api/admin/dashboard/counts
 *
 * 2026-06 — EXTENDED (backward-compatible, fields ADDED only) so the v4
 * admin console HomePage stops rendering empty. In addition to the original
 * 7 integer counts it now also returns:
 *   - structural counts that ARE real on a fresh install:
 *       mcpServers (running MCP count from the mcp-proxy /servers list),
 *       mcpTools   (indexed tools from the mcp_tools table, ~352 on boot),
 *       models     (registry model-role-assignment rows),
 *       providers  (configured LLM providers)
 *   - a `summary` block with usage rollups (real once usage flows; zeros on
 *     day 1) shaped to the UI's DashboardSummary
 *   - a `timeSeries` block (token-burn series; empty array on day 1)
 *
 * Every original field is preserved at the top level, so older consumers
 * that read `response.chats` etc. keep working unchanged.
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';

/**
 * Count the MCP servers the mcp-proxy currently reports as loaded. This is the
 * same /servers endpoint MCPSyncService + the Fleet view use. Fail-open to 0 so
 * a slow/unreachable proxy never blocks the dashboard.
 */
async function getRunningMcpServerCount(): Promise<number> {
  try {
    const url = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
    const r = await fetch(`${url}/servers`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return 0;
    const data: any = await r.json();
    if (Array.isArray(data?.servers)) return data.servers.length;
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object') return Object.keys(data).length;
    return 0;
  } catch {
    return 0;
  }
}

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

      // 24h window for the usage-summary rollups.
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Aggregate token/cost usage over the last 24h from LLMRequestLog. Real
      // once requests flow; { _sum: null } (→ 0) on a fresh box. Fail-open.
      const safeUsage = async (): Promise<{ totalTokens: number; totalCost: number }> => {
        try {
          const agg = await prisma.lLMRequestLog.aggregate({
            where: { request_started_at: { gte: since24h } },
            _sum: { total_tokens: true, total_cost: true },
          });
          return {
            totalTokens: Number(agg._sum.total_tokens ?? 0),
            totalCost: Number(agg._sum.total_cost ?? 0),
          };
        } catch {
          return { totalTokens: 0, totalCost: 0 };
        }
      };

      // Active users (24h) — distinct chat-session owners. Real once chats flow.
      const safeActiveUsers = async (): Promise<number> => {
        try {
          const rows = await prisma.chatSession.findMany({
            where: { created_at: { gte: since24h } },
            select: { user_id: true },
            distinct: ['user_id'],
          });
          return rows.filter((r) => r.user_id != null).length;
        } catch {
          return 0;
        }
      };

      const [
        chats,
        messages,
        users,
        workflows,
        flowRuns,
        agentRuns,
        llmRequests,
        // structural counts (real on a fresh install)
        mcpServers,
        mcpTools,
        models,
        providers,
        // usage rollups
        usage,
        activeUsers,
      ] = await Promise.all([
        safeCount(() => prisma.chatSession.count()),
        safeCount(() => prisma.chatMessage.count()),
        safeCount(() => prisma.user.count()),
        safeCount(() => prisma.workflow.count()),
        safeCount(() => prisma.workflowExecution.count()),
        safeCount(() => prisma.agentExecution.count()),
        safeCount(() => prisma.lLMRequestLog.count()),
        getRunningMcpServerCount(),
        safeCount(() => prisma.mCPTool.count()),
        safeCount(() => prisma.modelRoleAssignment.count()),
        safeCount(() => prisma.lLMProvider.count({ where: { deleted_at: null } })),
        safeUsage(),
        safeActiveUsers(),
      ]);

      const activeWorkflows = await safeCount(() =>
        prisma.workflow.count({ where: { deleted_at: null, is_active: true } }),
      );

      // ── summary block (DashboardSummary shape; zeros are honest on day 1) ──
      const summary = {
        totalUsers: users,
        activeUsers,
        totalSessions: chats,
        sessionChange: 0,
        totalMessages: messages,
        messageChange: 0,
        totalTokens: usage.totalTokens,
        totalCost: usage.totalCost,
        totalImages: 0,
        totalMcpCalls: 0,
        totalEmbeddings: 0,
        contextWindowAvgUtil: 0,
        totalWorkflowExecutions: flowRuns,
        totalWorkflows: workflows,
        activeWorkflows,
        workflowSuccessRate: 0,
        totalAgentExecutions: agentRuns,
        agentTotalTokens: 0,
        agentTotalCost: 0,
        totalApiRequests: llmRequests,
        apiErrorRate: 0,
        apiAvgResponseTime: 0,
        // additive deltas — null/undefined renders an honest "—", never a fake number
        tokensDeltaPct: null as number | null,
        costDeltaPct: null as number | null,
        activeUsersBroad: activeUsers,
      };

      // ── timeSeries block (token-burn etc.; empty arrays on day 1) ──
      const timeSeries = {
        sessions: [] as Array<{ timestamp: number; value: number }>,
        messages: [] as Array<{ timestamp: number; value: number }>,
        tokenUsage: [] as Array<{ timestamp: number; value: number }>,
        images: [] as Array<{ timestamp: number; value: number }>,
        embeddings: [] as Array<{ timestamp: number; value: number }>,
        contextUtilization: [] as Array<{ timestamp: number; value: number }>,
        workflowExecutions: [] as Array<{ timestamp: number; value: number }>,
        agentExecutions: [] as Array<{ timestamp: number; value: number }>,
        apiRequests: [] as Array<{ timestamp: number; value: number }>,
      };

      return reply.send({
        // ── original 7 counts (UNCHANGED — backward-compatible) ──
        chats,
        messages,
        users,
        workflows,
        flowRuns,
        agentRuns,
        llmRequests,
        // ── ADDED: structural counts (real on a fresh install) ──
        mcpServers,
        mcpTools,
        models,
        providers,
        // ── ADDED: usage summary + time series ──
        summary,
        timeSeries,
      });
    },
  );

  loggers.routes.info('Admin Dashboard Counts route extended with structural counts + summary/timeSeries');
};

export default adminDashboardCountsRoutes;
