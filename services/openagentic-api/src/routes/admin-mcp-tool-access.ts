/**
 * Admin MCP Tool-Level Access Control Routes
 *
 * Per-tool granularity for MCP access policies.
 *
 * Endpoints:
 * - GET    /api/admin/mcp-access/tools           — list all tool-level policies
 * - GET    /api/admin/mcp-access/tools/:serverId  — list for a server
 * - POST   /api/admin/mcp-access/tools           — create policy
 * - PUT    /api/admin/mcp-access/tools/:id        — update
 * - DELETE /api/admin/mcp-access/tools/:id        — delete
 * - POST   /api/admin/mcp-access/tools/test       — test access
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { mcpAccessControlService } from '../services/MCPAccessControlService.js';
import { prisma } from '../utils/prisma.js';
import { enterpriseOnly } from '../middleware/enterpriseOnly.js';

const logger = loggers.routes;

interface ToolPolicyBody {
  serverId: string;
  toolName: string;
  azureGroupId?: string;
  userId?: string;
  accessType: 'allow' | 'deny';
  isEnabled?: boolean;
  priority?: number;
  reason?: string;
  requireApproval?: boolean;
}

interface TestAccessBody {
  userId: string;
  serverId: string;
  toolName: string;
  userGroups?: string[];
  isAdmin?: boolean;
}

export const adminMCPToolAccessRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {


  // OSS gate — all routes in this plugin return 402 with upgrade_url.
  fastify.addHook('preHandler', enterpriseOnly);
  /**
   * GET /api/admin/mcp-access/tools — list all tool-level policies
   */
  fastify.get('/tools', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const policies = await prisma.mCPToolAccessPolicy.findMany({
        orderBy: [{ server_id: 'asc' }, { tool_name: 'asc' }, { priority: 'asc' }]
      });

      return reply.send({
        policies: policies.map(p => ({
          id: p.id,
          serverId: p.server_id,
          toolName: p.tool_name,
          azureGroupId: p.azure_group_id,
          userId: p.user_id,
          accessType: p.access_type,
          isEnabled: p.is_enabled,
          priority: p.priority,
          reason: p.reason,
          requireApproval: p.require_approval,
          createdBy: p.created_by,
          updatedBy: p.updated_by,
          createdAt: p.created_at,
          updatedAt: p.updated_at
        })),
        total: policies.length
      });
    } catch (error: any) {
      logger.error({ error }, '[MCP-ToolAccess] Failed to list policies');
      return reply.code(500).send({ error: 'Failed to list tool access policies', message: error.message });
    }
  });

  /**
   * GET /api/admin/mcp-access/tools/:serverId — list for a server
   */
  fastify.get<{ Params: { serverId: string } }>('/tools/:serverId', async (request, reply) => {
    try {
      const { serverId } = request.params;
      const policies = await prisma.mCPToolAccessPolicy.findMany({
        where: { server_id: serverId },
        orderBy: [{ tool_name: 'asc' }, { priority: 'asc' }]
      });

      return reply.send({
        serverId,
        policies: policies.map(p => ({
          id: p.id,
          toolName: p.tool_name,
          azureGroupId: p.azure_group_id,
          userId: p.user_id,
          accessType: p.access_type,
          isEnabled: p.is_enabled,
          priority: p.priority,
          reason: p.reason,
          requireApproval: p.require_approval,
          createdAt: p.created_at,
          updatedAt: p.updated_at
        })),
        total: policies.length
      });
    } catch (error: any) {
      logger.error({ error }, '[MCP-ToolAccess] Failed to list server policies');
      return reply.code(500).send({ error: 'Failed to list server tool policies', message: error.message });
    }
  });

  /**
   * POST /api/admin/mcp-access/tools — create policy
   */
  fastify.post<{ Body: ToolPolicyBody }>('/tools', async (request, reply) => {
    try {
      const body = request.body;
      const user = (request as any).user;
      const adminId = user?.userId || user?.id || 'system';

      const policy = await prisma.mCPToolAccessPolicy.create({
        data: {
          server_id: body.serverId,
          tool_name: body.toolName,
          azure_group_id: body.azureGroupId || null,
          user_id: body.userId || null,
          access_type: body.accessType,
          is_enabled: body.isEnabled ?? true,
          priority: body.priority ?? 1000,
          reason: body.reason || null,
          require_approval: body.requireApproval ?? false,
          created_by: adminId,
          updated_by: adminId
        }
      });

      logger.info({ policyId: policy.id, serverId: body.serverId, toolName: body.toolName }, '[MCP-ToolAccess] Policy created');

      return reply.code(201).send({
        success: true,
        policy: {
          id: policy.id,
          serverId: policy.server_id,
          toolName: policy.tool_name,
          accessType: policy.access_type,
          isEnabled: policy.is_enabled,
          priority: policy.priority,
          requireApproval: policy.require_approval
        }
      });
    } catch (error: any) {
      logger.error({ error }, '[MCP-ToolAccess] Failed to create policy');
      return reply.code(500).send({ error: 'Failed to create tool access policy', message: error.message });
    }
  });

  /**
   * PUT /api/admin/mcp-access/tools/:id — update policy
   */
  fastify.put<{ Params: { id: string }; Body: Partial<ToolPolicyBody> }>('/tools/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const body = request.body;
      const user = (request as any).user;
      const adminId = user?.userId || user?.id || 'system';

      const existing = await prisma.mCPToolAccessPolicy.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Policy not found' });
      }

      const data: any = { updated_by: adminId };
      if (body.accessType !== undefined) data.access_type = body.accessType;
      if (body.isEnabled !== undefined) data.is_enabled = body.isEnabled;
      if (body.priority !== undefined) data.priority = body.priority;
      if (body.reason !== undefined) data.reason = body.reason;
      if (body.requireApproval !== undefined) data.require_approval = body.requireApproval;
      if (body.azureGroupId !== undefined) data.azure_group_id = body.azureGroupId || null;
      if (body.userId !== undefined) data.user_id = body.userId || null;

      const updated = await prisma.mCPToolAccessPolicy.update({ where: { id }, data });

      logger.info({ policyId: id }, '[MCP-ToolAccess] Policy updated');
      return reply.send({ success: true, policy: updated });
    } catch (error: any) {
      logger.error({ error }, '[MCP-ToolAccess] Failed to update policy');
      return reply.code(500).send({ error: 'Failed to update tool access policy', message: error.message });
    }
  });

  /**
   * DELETE /api/admin/mcp-access/tools/:id — delete policy
   */
  fastify.delete<{ Params: { id: string } }>('/tools/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const existing = await prisma.mCPToolAccessPolicy.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Policy not found' });
      }

      await prisma.mCPToolAccessPolicy.delete({ where: { id } });
      logger.info({ policyId: id }, '[MCP-ToolAccess] Policy deleted');
      return reply.send({ success: true, deleted: id });
    } catch (error: any) {
      logger.error({ error }, '[MCP-ToolAccess] Failed to delete policy');
      return reply.code(500).send({ error: 'Failed to delete tool access policy', message: error.message });
    }
  });

  /**
   * POST /api/admin/mcp-access/tools/test — test access for a user+tool
   */
  fastify.post<{ Body: TestAccessBody }>('/tools/test', async (request, reply) => {
    try {
      const { userId, serverId, toolName, userGroups = [], isAdmin = false } = request.body;

      const result = await mcpAccessControlService.checkToolAccess(
        userId, serverId, toolName, userGroups, isAdmin
      );

      return reply.send({
        userId,
        serverId,
        toolName,
        ...result
      });
    } catch (error: any) {
      logger.error({ error }, '[MCP-ToolAccess] Failed to test access');
      return reply.code(500).send({ error: 'Failed to test tool access', message: error.message });
    }
  });

  logger.info('Admin MCP Tool Access routes registered');
};

export default adminMCPToolAccessRoutes;
