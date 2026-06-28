/**
 * MCP Logs API
 *
 * Receives and stores MCP call logs from mcp-proxy service
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';

// Validation schema for MCP log entries with full request/response data
const MCPLogSchema = z.object({
  user_id: z.string().optional().nullable(), // Allow any string, null, or undefined (some MCP calls may not have user context)
  user_name: z.string().optional().nullable(), // User's display name
  user_email: z.string().optional().nullable(), // User's email
  instance_id: z.string().uuid().optional().nullable(),
  server_name: z.string(),
  tool_name: z.string(),
  method: z.string(),
  params: z.record(z.any()).optional().nullable(), // Full request parameters
  result: z.any().optional().nullable(), // Full response data
  error: z.object({
    code: z.number(),
    message: z.string()
  }).optional().nullable(), // Allow null error field
  execution_time_ms: z.number(),
  success: z.boolean(),
  timestamp: z.string().datetime().optional().nullable()
});

const BatchMCPLogsSchema = z.object({
  logs: z.array(MCPLogSchema)
});

export default async function mcpLogsRoutes(fastify: FastifyInstance) {

  // Single MCP log endpoint
  fastify.post('/mcp-logs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const logData = MCPLogSchema.parse(request.body);

      // Calculate request/response sizes
      const requestSize = logData.params ? JSON.stringify(logData.params).length : 0;
      const responseSize = logData.result ? JSON.stringify(logData.result).length : 0;

      // Validate user_id exists before storing (avoid foreign key constraint errors)
      let validatedUserId: string | undefined = undefined;
      if (logData.user_id) {
        const userExists = await prisma.user.findUnique({
          where: { id: logData.user_id },
          select: { id: true }
        });
        validatedUserId = userExists ? logData.user_id : undefined;

        if (!userExists) {
          logger.warn({ user_id: logData.user_id }, 'MCP log references non-existent user - setting user_id to null');
        }
      }

      // If no valid user_id, skip logging (user_id is required by schema)
      if (!validatedUserId) {
        logger.warn({
          tool_name: logData.tool_name,
          server: logData.server_name,
          user_id: logData.user_id
        }, 'Skipping MCP log - no valid user_id');

        return reply.status(200).send({
          success: true,
          message: 'Log skipped - no valid user_id',
          id: null
        });
      }

      // Store in database with full request/response data
      const mcpUsage = await prisma.mCPUsage.create({
        data: {
          user_id: validatedUserId, // Validated - will not be undefined
          user_name: logData.user_name || undefined,
          user_email: logData.user_email || undefined,
          instance_id: logData.instance_id || undefined,
          server_name: logData.server_name,
          tool_name: logData.tool_name,
          method: logData.method,
          execution_time_ms: Math.round(logData.execution_time_ms),
          request_size: requestSize,
          response_size: responseSize,
          success: logData.success,
          error_message: logData.error?.message || undefined,
          request_metadata: logData.params || undefined, // Full request params
          response_data: logData.result || undefined, // Full response data
          timestamp: logData.timestamp ? new Date(logData.timestamp) : new Date()
        }
      });

      logger.debug({ mcpUsageId: mcpUsage.id, toolName: logData.tool_name }, 'MCP log stored');

      return reply.code(201).send({
        success: true,
        id: mcpUsage.id
      });

    } catch (error) {
      logger.error({ error }, 'Failed to store MCP log');

      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Invalid log data',
          details: error.errors
        });
      }

      return reply.code(500).send({ error: 'Failed to store MCP log' });
    }
  });

  // Batch MCP logs endpoint (for performance)
  fastify.post('/mcp-logs/batch', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { logs } = BatchMCPLogsSchema.parse(request.body);

      if (logs.length === 0) {
        return reply.send({ success: true, count: 0 });
      }

      // Get all unique user_ids that need validation
      const userIds = [...new Set(logs.map(log => log.user_id).filter(Boolean))];

      // Validate which users exist in database
      const existingUsers = await prisma.user.findMany({
        where: { id: { in: userIds as string[] } },
        select: { id: true }
      });
      const validUserIds = new Set(existingUsers.map(u => u.id));

      // Log any invalid user_ids
      const invalidUserIds = userIds.filter(id => !validUserIds.has(id as string));
      if (invalidUserIds.length > 0) {
        logger.warn({ invalid_user_ids: invalidUserIds }, 'Batch MCP logs contain non-existent user IDs - setting to null');
      }

      // Batch insert for better performance with full request/response data
      const mcpUsageData = logs.map(logData => ({
        user_id: (logData.user_id && validUserIds.has(logData.user_id)) ? logData.user_id : undefined,
        user_name: logData.user_name || undefined,
        user_email: logData.user_email || undefined,
        instance_id: logData.instance_id || undefined,
        server_name: logData.server_name,
        tool_name: logData.tool_name,
        method: logData.method,
        execution_time_ms: Math.round(logData.execution_time_ms),
        request_size: logData.params ? JSON.stringify(logData.params).length : 0,
        response_size: logData.result ? JSON.stringify(logData.result).length : 0,
        success: logData.success,
        error_message: logData.error?.message || undefined,
        request_metadata: logData.params || undefined, // Full request params
        response_data: logData.result || undefined, // Full response data
        timestamp: logData.timestamp ? new Date(logData.timestamp) : new Date()
      }));

      const result = await prisma.mCPUsage.createMany({
        data: mcpUsageData,
        skipDuplicates: true
      });

      logger.info({ count: result.count }, 'Batch MCP logs stored');

      return reply.code(201).send({
        success: true,
        count: result.count
      });

    } catch (error) {
      logger.error({ error }, 'Failed to store batch MCP logs');

      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Invalid log data',
          details: error.errors
        });
      }

      return reply.code(500).send({ error: 'Failed to store batch MCP logs' });
    }
  });

  // Get MCP usage statistics
  fastify.get('/mcp-logs/stats', async (request: FastifyRequest<{
    Querystring: {
      user_id?: string;
      server_name?: string;
      tool_name?: string;
      start_date?: string;
      end_date?: string;
    }
  }>, reply: FastifyReply) => {
    try {
      const { user_id, server_name, tool_name, start_date, end_date } = request.query;

      const whereClause: any = {};

      if (user_id) whereClause.user_id = user_id;
      if (tool_name) whereClause.tool_name = tool_name;
      if (server_name) {
        whereClause.request_metadata = {
          path: ['server'],
          equals: server_name
        };
      }
      if (start_date || end_date) {
        whereClause.timestamp = {};
        if (start_date) whereClause.timestamp.gte = new Date(start_date);
        if (end_date) whereClause.timestamp.lte = new Date(end_date);
      }

      // Get aggregate statistics
      const stats = await prisma.mCPUsage.aggregate({
        where: whereClause,
        _count: { id: true },
        _avg: { execution_time_ms: true },
        _sum: {
          execution_time_ms: true,
          request_size: true,
          response_size: true
        }
      });

      // Get success rate
      const successCount = await prisma.mCPUsage.count({
        where: { ...whereClause, success: true }
      });

      // Get top tools
      const topTools = await prisma.mCPUsage.groupBy({
        by: ['tool_name'],
        where: whereClause,
        _count: { tool_name: true },
        orderBy: { _count: { tool_name: 'desc' } },
        take: 10
      });

      return reply.send({
        total_calls: stats._count.id,
        success_rate: stats._count.id > 0
          ? (successCount / stats._count.id * 100).toFixed(2) + '%'
          : '0%',
        avg_execution_time_ms: stats._avg.execution_time_ms,
        total_execution_time_ms: stats._sum.execution_time_ms,
        total_request_size_bytes: stats._sum.request_size,
        total_response_size_bytes: stats._sum.response_size,
        top_tools: topTools.map(t => ({
          tool: t.tool_name,
          count: t._count.tool_name
        }))
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get MCP stats');
      return reply.code(500).send({ error: 'Failed to get MCP statistics' });
    }
  });
}
