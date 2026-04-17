/**
 * Admin Chargeback Routes
 *
 * Provides endpoints for enterprise chargeback/cost allocation:
 * - GET /api/admin/chargeback/budgets - Get all cost budgets
 * - POST /api/admin/chargeback/budgets - Create a new cost budget
 * - GET /api/admin/chargeback/budgets/:id - Get budget by ID
 * - PUT /api/admin/chargeback/budgets/:id - Update a budget
 * - DELETE /api/admin/chargeback/budgets/:id - Delete a budget
 * - GET /api/admin/chargeback/reports - Get chargeback reports
 * - POST /api/admin/chargeback/reports/generate - Generate a new report
 * - GET /api/admin/chargeback/reports/:id - Get report by ID
 * - GET /api/admin/chargeback/groups - Get user groups for billing
 * - GET /api/admin/chargeback/usage - Get current usage summary
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { Prisma } from '@prisma/client';
import { getCachedMetrics, setCachedMetrics } from '../services/AdminMetricsCache.js';
import { prisma } from '../utils/prisma.js';
import { enterpriseOnly } from '../middleware/enterpriseOnly.js';

// Request/Response interfaces
interface BudgetCreateRequest {
  name: string;
  budget_type: 'user' | 'group' | 'global';
  user_id?: string;
  group_id?: string;
  daily_limit?: number;
  weekly_limit?: number;
  monthly_limit: number;
  annual_limit?: number;
  alert_threshold_50?: boolean;
  alert_threshold_75?: boolean;
  alert_threshold_90?: boolean;
  alert_threshold_100?: boolean;
  action_on_limit?: 'warn' | 'throttle' | 'block';
  throttle_to_model?: string;
  notify_emails?: string[];
  notify_slack_channel?: string;
}

interface ReportGenerateRequest {
  report_period: string; // YYYY-MM format
  group_id?: string;
  user_id?: string;
  cost_center?: string;
}

interface BudgetIdParams {
  id: string;
}

interface ReportIdParams {
  id: string;
}

interface ReportsQuerystring {
  period?: string;
  group_id?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
}

interface UsageQuerystring {
  period?: 'day' | 'week' | 'month' | 'year';
  group_by?: 'user' | 'group' | 'provider' | 'model';
}

export const adminChargebackRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // Gate every route in this plugin with the EDITION flag. OSS returns 402
  // with an upgrade_url; enterprise falls through to the real handlers.
  fastify.addHook('preHandler', enterpriseOnly);

  // ==================== BUDGET ROUTES ====================

  /**
   * GET /api/admin/chargeback/budgets
   * Get all cost budgets
   */
  fastify.get('/budgets', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const budgets = await prisma.costBudget.findMany({
        include: {
          user: {
            select: { id: true, email: true, name: true }
          },
          group: {
            select: { id: true, name: true, display_name: true, cost_center: true }
          }
        },
        orderBy: { created_at: 'desc' }
      });

      // Calculate usage percentage for each budget
      const budgetsWithUsage = budgets.map(budget => {
        const monthlyLimit = Number(budget.monthly_limit);
        const currentSpend = Number(budget.current_spend);
        const usagePercentage = monthlyLimit > 0 ? (currentSpend / monthlyLimit) * 100 : 0;

        return {
          ...budget,
          monthly_limit: monthlyLimit,
          current_spend: currentSpend,
          daily_limit: budget.daily_limit ? Number(budget.daily_limit) : null,
          weekly_limit: budget.weekly_limit ? Number(budget.weekly_limit) : null,
          annual_limit: budget.annual_limit ? Number(budget.annual_limit) : null,
          usage_percentage: Math.min(usagePercentage, 100),
          over_budget: usagePercentage > 100,
          alert_level: usagePercentage >= 100 ? 'critical' :
                       usagePercentage >= 90 ? 'warning' :
                       usagePercentage >= 75 ? 'caution' : 'normal'
        };
      });

      return reply.send({
        budgets: budgetsWithUsage,
        total: budgets.length
      });
    } catch (error: any) {
      logger.error({ error }, '[Chargeback] Failed to get budgets');
      return reply.code(500).send({
        error: 'Failed to get budgets',
        message: error.message
      });
    }
  });

  /**
   * POST /api/admin/chargeback/budgets
   * Create a new cost budget
   */
  fastify.post<{ Body: BudgetCreateRequest }>(
    '/budgets',
    async (request, reply) => {
      try {
        const {
          name,
          budget_type,
          user_id,
          group_id,
          daily_limit,
          weekly_limit,
          monthly_limit,
          annual_limit,
          alert_threshold_50 = true,
          alert_threshold_75 = true,
          alert_threshold_90 = true,
          alert_threshold_100 = true,
          action_on_limit = 'warn',
          throttle_to_model,
          notify_emails = [],
          notify_slack_channel
        } = request.body;

        // Validate budget type requirements
        if (budget_type === 'user' && !user_id) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'user_id is required for user-type budgets'
          });
        }
        if (budget_type === 'group' && !group_id) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'group_id is required for group-type budgets'
          });
        }

        const budget = await prisma.costBudget.create({
          data: {
            name,
            budget_type,
            user_id: budget_type === 'user' ? user_id : null,
            group_id: budget_type === 'group' ? group_id : null,
            daily_limit: daily_limit ? new Prisma.Decimal(daily_limit) : null,
            weekly_limit: weekly_limit ? new Prisma.Decimal(weekly_limit) : null,
            monthly_limit: new Prisma.Decimal(monthly_limit),
            annual_limit: annual_limit ? new Prisma.Decimal(annual_limit) : null,
            alert_threshold_50,
            alert_threshold_75,
            alert_threshold_90,
            alert_threshold_100,
            action_on_limit,
            throttle_to_model,
            notify_emails,
            notify_slack_channel
          },
          include: {
            user: { select: { id: true, email: true, name: true } },
            group: { select: { id: true, name: true, display_name: true } }
          }
        });

        logger.info({ budgetId: budget.id, name, budget_type }, '[Chargeback] Budget created');

        return reply.code(201).send({
          success: true,
          budget
        });
      } catch (error: any) {
        logger.error({ error }, '[Chargeback] Failed to create budget');
        return reply.code(500).send({
          error: 'Failed to create budget',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/chargeback/budgets/:id
   * Get budget by ID
   */
  fastify.get<{ Params: BudgetIdParams }>(
    '/budgets/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;

        const budget = await prisma.costBudget.findUnique({
          where: { id },
          include: {
            user: { select: { id: true, email: true, name: true } },
            group: { select: { id: true, name: true, display_name: true, cost_center: true } }
          }
        });

        if (!budget) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Budget with ID '${id}' not found`
          });
        }

        return reply.send({ budget });
      } catch (error: any) {
        logger.error({ error }, '[Chargeback] Failed to get budget');
        return reply.code(500).send({
          error: 'Failed to get budget',
          message: error.message
        });
      }
    }
  );

  /**
   * PUT /api/admin/chargeback/budgets/:id
   * Update a budget
   */
  fastify.put<{ Params: BudgetIdParams; Body: Partial<BudgetCreateRequest> }>(
    '/budgets/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const updates = request.body;

        // Check if budget exists
        const existing = await prisma.costBudget.findUnique({ where: { id } });
        if (!existing) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Budget with ID '${id}' not found`
          });
        }

        // Convert numeric fields to Decimal
        const data: any = { ...updates };
        if (updates.daily_limit !== undefined) {
          data.daily_limit = updates.daily_limit ? new Prisma.Decimal(updates.daily_limit) : null;
        }
        if (updates.weekly_limit !== undefined) {
          data.weekly_limit = updates.weekly_limit ? new Prisma.Decimal(updates.weekly_limit) : null;
        }
        if (updates.monthly_limit !== undefined) {
          data.monthly_limit = new Prisma.Decimal(updates.monthly_limit);
        }
        if (updates.annual_limit !== undefined) {
          data.annual_limit = updates.annual_limit ? new Prisma.Decimal(updates.annual_limit) : null;
        }

        const budget = await prisma.costBudget.update({
          where: { id },
          data,
          include: {
            user: { select: { id: true, email: true, name: true } },
            group: { select: { id: true, name: true, display_name: true } }
          }
        });

        logger.info({ budgetId: id }, '[Chargeback] Budget updated');

        return reply.send({
          success: true,
          budget
        });
      } catch (error: any) {
        logger.error({ error }, '[Chargeback] Failed to update budget');
        return reply.code(500).send({
          error: 'Failed to update budget',
          message: error.message
        });
      }
    }
  );

  /**
   * DELETE /api/admin/chargeback/budgets/:id
   * Delete a budget
   */
  fastify.delete<{ Params: BudgetIdParams }>(
    '/budgets/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Check if budget exists
        const existing = await prisma.costBudget.findUnique({ where: { id } });
        if (!existing) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Budget with ID '${id}' not found`
          });
        }

        await prisma.costBudget.delete({ where: { id } });

        logger.info({ budgetId: id }, '[Chargeback] Budget deleted');

        return reply.send({
          success: true,
          message: `Budget '${id}' deleted`
        });
      } catch (error: any) {
        logger.error({ error }, '[Chargeback] Failed to delete budget');
        return reply.code(500).send({
          error: 'Failed to delete budget',
          message: error.message
        });
      }
    }
  );

  // ==================== REPORT ROUTES ====================

  /**
   * GET /api/admin/chargeback/reports
   * Get chargeback reports
   */
  fastify.get<{ Querystring: ReportsQuerystring }>(
    '/reports',
    async (request, reply) => {
      try {
        const { period, group_id, user_id, limit = 50, offset = 0 } = request.query;

        const where: any = {};
        if (period) where.report_period = period;
        if (group_id) where.group_id = group_id;
        if (user_id) where.user_id = user_id;

        const [reports, total] = await Promise.all([
          prisma.chargebackReport.findMany({
            where,
            include: {
              group: { select: { id: true, name: true, display_name: true, cost_center: true } },
              user: { select: { id: true, email: true, name: true } }
            },
            orderBy: { report_period: 'desc' },
            take: Number(limit),
            skip: Number(offset)
          }),
          prisma.chargebackReport.count({ where })
        ]);

        // Convert BigInt and Decimal to numbers for JSON serialization
        const serializedReports = reports.map(report => ({
          ...report,
          total_input_tokens: Number(report.total_input_tokens),
          total_output_tokens: Number(report.total_output_tokens),
          total_cached_tokens: Number(report.total_cached_tokens),
          total_thinking_tokens: Number(report.total_thinking_tokens),
          total_llm_cost: Number(report.total_llm_cost),
          total_mcp_cost: Number(report.total_mcp_cost),
          total_compute_cost: Number(report.total_compute_cost),
          total_storage_cost: Number(report.total_storage_cost),
          total_cost: Number(report.total_cost)
        }));

        return reply.send({
          reports: serializedReports,
          total,
          limit: Number(limit),
          offset: Number(offset)
        });
      } catch (error: any) {
        logger.error({ error }, '[Chargeback] Failed to get reports');
        return reply.code(500).send({
          error: 'Failed to get reports',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/admin/chargeback/reports/generate
   * Generate a new chargeback report for a period
   */
  fastify.post<{ Body: ReportGenerateRequest }>(
    '/reports/generate',
    async (request, reply) => {
      try {
        const { report_period, group_id, user_id, cost_center } = request.body;

        // Validate period format (YYYY-MM)
        if (!/^\d{4}-\d{2}$/.test(report_period)) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'report_period must be in YYYY-MM format'
          });
        }

        // Parse period dates
        const [year, month] = report_period.split('-').map(Number);
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

        // Build query conditions
        const where: any = {
          timestamp: { gte: periodStart, lte: periodEnd }
        };
        if (user_id) where.user_id = user_id;
        if (group_id) where.group_id = group_id;

        // Aggregate token usage data from TokenUsage table
        const tokenAggregates = await prisma.tokenUsage.aggregate({
          where,
          _sum: {
            prompt_tokens: true,
            completion_tokens: true,
            cached_tokens: true,
            thinking_tokens: true,
            input_cost: true,
            output_cost: true,
            cached_cost: true,
            thinking_cost: true,
            total_cost: true
          },
          _count: {
            id: true
          }
        });

        // Count unique sessions
        const sessionCount = await prisma.tokenUsage.groupBy({
          by: ['session_id'],
          where,
          _count: true
        });

        // Get cost by provider
        const costByProvider = await prisma.tokenUsage.groupBy({
          by: ['provider'],
          where,
          _sum: { total_cost: true }
        });

        // Get cost by model
        const costByModel = await prisma.tokenUsage.groupBy({
          by: ['model'],
          where,
          _sum: { total_cost: true }
        });

        // Format cost breakdowns
        const costByProviderObj: Record<string, number> = {};
        for (const p of costByProvider) {
          if (p.provider) {
            costByProviderObj[p.provider] = Number(p._sum.total_cost || 0);
          }
        }

        const costByModelObj: Record<string, number> = {};
        for (const m of costByModel) {
          if (m.model) {
            costByModelObj[m.model] = Number(m._sum.total_cost || 0);
          }
        }

        // Create or update the report
        const reportData = {
          report_period,
          group_id,
          user_id,
          cost_center,
          total_input_tokens: BigInt(tokenAggregates._sum.prompt_tokens || 0),
          total_output_tokens: BigInt(tokenAggregates._sum.completion_tokens || 0),
          total_cached_tokens: BigInt(tokenAggregates._sum.cached_tokens || 0),
          total_thinking_tokens: BigInt(tokenAggregates._sum.thinking_tokens || 0),
          cost_by_provider: costByProviderObj,
          cost_by_model: costByModelObj,
          total_llm_cost: new Prisma.Decimal(Number(tokenAggregates._sum.total_cost || 0)),
          total_mcp_cost: new Prisma.Decimal(0), // TODO: Calculate from MCP usage logs
          total_compute_cost: new Prisma.Decimal(0), // TODO: Calculate from compute usage
          total_storage_cost: new Prisma.Decimal(0), // TODO: Calculate from storage usage
          total_cost: new Prisma.Decimal(Number(tokenAggregates._sum.total_cost || 0)),
          total_requests: tokenAggregates._count.id || 0,
          total_sessions: sessionCount.length,
          total_workflow_executions: 0, // TODO: Count from workflow executions
          total_code_executions: 0, // TODO: Count from code executions
          status: 'generated',
          generated_at: new Date()
        };

        // Upsert report (update if exists for same period/group/user)
        const report = await prisma.chargebackReport.upsert({
          where: {
            report_period_group_id_user_id: {
              report_period,
              group_id: group_id || null,
              user_id: user_id || null
            }
          },
          create: reportData,
          update: reportData,
          include: {
            group: { select: { id: true, name: true, display_name: true } },
            user: { select: { id: true, email: true, name: true } }
          }
        });

        logger.info({ reportId: report.id, period: report_period }, '[Chargeback] Report generated');

        // Serialize BigInt/Decimal for JSON response
        const serializedReport = {
          ...report,
          total_input_tokens: Number(report.total_input_tokens),
          total_output_tokens: Number(report.total_output_tokens),
          total_cached_tokens: Number(report.total_cached_tokens),
          total_thinking_tokens: Number(report.total_thinking_tokens),
          total_llm_cost: Number(report.total_llm_cost),
          total_mcp_cost: Number(report.total_mcp_cost),
          total_compute_cost: Number(report.total_compute_cost),
          total_storage_cost: Number(report.total_storage_cost),
          total_cost: Number(report.total_cost)
        };

        return reply.code(201).send({
          success: true,
          report: serializedReport
        });
      } catch (error: any) {
        logger.error({ error }, '[Chargeback] Failed to generate report');
        return reply.code(500).send({
          error: 'Failed to generate report',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/chargeback/reports/:id
   * Get report by ID
   */
  fastify.get<{ Params: ReportIdParams }>(
    '/reports/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;

        const report = await prisma.chargebackReport.findUnique({
          where: { id },
          include: {
            group: { select: { id: true, name: true, display_name: true, cost_center: true } },
            user: { select: { id: true, email: true, name: true } }
          }
        });

        if (!report) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Report with ID '${id}' not found`
          });
        }

        // Serialize BigInt/Decimal for JSON response
        const serializedReport = {
          ...report,
          total_input_tokens: Number(report.total_input_tokens),
          total_output_tokens: Number(report.total_output_tokens),
          total_cached_tokens: Number(report.total_cached_tokens),
          total_thinking_tokens: Number(report.total_thinking_tokens),
          total_llm_cost: Number(report.total_llm_cost),
          total_mcp_cost: Number(report.total_mcp_cost),
          total_compute_cost: Number(report.total_compute_cost),
          total_storage_cost: Number(report.total_storage_cost),
          total_cost: Number(report.total_cost)
        };

        return reply.send({ report: serializedReport });
      } catch (error: any) {
        logger.error({ error }, '[Chargeback] Failed to get report');
        return reply.code(500).send({
          error: 'Failed to get report',
          message: error.message
        });
      }
    }
  );

  // ==================== GROUP ROUTES ====================

  /**
   * GET /api/admin/chargeback/groups
   * Get user groups for billing/chargeback purposes
   */
  fastify.get('/groups', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const groups = await prisma.userGroup.findMany({
        where: { is_active: true },
        include: {
          _count: {
            select: { memberships: true }
          },
          cost_budgets: {
            select: {
              id: true,
              name: true,
              monthly_limit: true,
              current_spend: true
            }
          }
        },
        orderBy: { name: 'asc' }
      });

      const groupsWithStats = groups.map(group => ({
        id: group.id,
        name: group.name,
        display_name: group.display_name,
        description: group.description,
        cost_center: group.cost_center,
        billing_contact_email: group.billing_contact_email,
        member_count: group._count.memberships,
        budgets: group.cost_budgets.map(b => ({
          id: b.id,
          name: b.name,
          monthly_limit: Number(b.monthly_limit),
          current_spend: Number(b.current_spend),
          usage_percentage: Number(b.monthly_limit) > 0
            ? (Number(b.current_spend) / Number(b.monthly_limit)) * 100
            : 0
        })),
        created_at: group.created_at,
        updated_at: group.updated_at
      }));

      return reply.send({
        groups: groupsWithStats,
        total: groups.length
      });
    } catch (error: any) {
      logger.error({ error }, '[Chargeback] Failed to get groups');
      return reply.code(500).send({
        error: 'Failed to get groups',
        message: error.message
      });
    }
  });

  // ==================== USAGE SUMMARY ====================

  /**
   * GET /api/admin/chargeback/usage
   * Get current usage summary across all users/groups
   */
  fastify.get<{ Querystring: UsageQuerystring }>(
    '/usage',
    async (request, reply) => {
      try {
        const { period = 'month', group_by = 'user' } = request.query;

        // Check cache
        const cacheKey = `chargeback:usage:${period}:${group_by}`;
        const cached = await getCachedMetrics<any>(cacheKey);
        if (cached) {
          return reply.send(cached);
        }

        // Calculate period start date
        const now = new Date();
        let periodStart: Date;
        switch (period) {
          case 'day':
            periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'week':
            const dayOfWeek = now.getDay();
            periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
            break;
          case 'year':
            periodStart = new Date(now.getFullYear(), 0, 1);
            break;
          case 'month':
          default:
            periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        }

        // Get aggregated usage
        const usageByGroup = await prisma.tokenUsage.groupBy({
          by: [group_by === 'provider' ? 'provider' : group_by === 'model' ? 'model' : group_by === 'group' ? 'group_id' : 'user_id'],
          where: {
            timestamp: { gte: periodStart }
          },
          _sum: {
            prompt_tokens: true,
            completion_tokens: true,
            total_cost: true
          },
          _count: {
            id: true
          }
        });

        // Get total summary
        const totalSummary = await prisma.tokenUsage.aggregate({
          where: {
            timestamp: { gte: periodStart }
          },
          _sum: {
            prompt_tokens: true,
            completion_tokens: true,
            cached_tokens: true,
            thinking_tokens: true,
            total_cost: true
          },
          _count: {
            id: true
          }
        });

        const responseData = {
          period,
          period_start: periodStart.toISOString(),
          group_by,
          summary: {
            total_input_tokens: Number(totalSummary._sum.prompt_tokens || 0),
            total_output_tokens: Number(totalSummary._sum.completion_tokens || 0),
            total_cached_tokens: Number(totalSummary._sum.cached_tokens || 0),
            total_thinking_tokens: Number(totalSummary._sum.thinking_tokens || 0),
            total_cost: Number(totalSummary._sum.total_cost || 0),
            total_requests: totalSummary._count.id || 0
          },
          breakdown: usageByGroup.map((item: any) => ({
            key: item.user_id || item.group_id || item.provider || item.model || 'unknown',
            input_tokens: Number(item._sum.prompt_tokens || 0),
            output_tokens: Number(item._sum.completion_tokens || 0),
            total_cost: Number(item._sum.total_cost || 0),
            request_count: item._count.id || 0
          }))
        };

        await setCachedMetrics(cacheKey, responseData, 120);
        return reply.send(responseData);
      } catch (error: any) {
        logger.error({ error }, '[Chargeback] Failed to get usage summary');
        return reply.code(500).send({
          error: 'Failed to get usage summary',
          message: error.message
        });
      }
    }
  );

  logger.info('Admin Chargeback routes registered');
};

export default adminChargebackRoutes;
