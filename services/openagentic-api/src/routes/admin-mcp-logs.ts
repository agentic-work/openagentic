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
 * Admin MCP Call Logs Routes
 * Provides comprehensive logging and analytics for all MCP tool executions
 * Data is sourced from mcp_usage table with full request/response JSON
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { Prisma } from '@prisma/client';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes.child({ component: 'AdminMCPLogs' });

interface MCPCallLog {
  id: string;
  toolName: string;
  serverId: string;
  method?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  status: 'success' | 'error' | 'timeout';
  executionTime: number;
  requestSize?: number;
  responseSize?: number;
  input: any;
  output?: any;
  error?: string;
  timestamp: string;
  modelUsed?: string;       // LLM model that triggered the tool call
  modelProvider?: string;   // LLM provider (vertex-ai, ollama, etc.)
}

const adminMCPLogsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/admin/mcp-logs
   * Returns paginated MCP call logs with full request/response data
   */
  fastify.get('/api/admin/mcp-logs', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as any;
    const page = parseInt(query.page) || 1;
    const limit = Math.min(parseInt(query.limit) || 50, 100); // Max 100 per page
    const { status, toolName, userId, serverName, startDate, endDate } = query;

    try {
      // Build where clause
      const whereClause: Prisma.MCPUsageWhereInput = {};

      if (userId) whereClause.user_id = userId;
      if (serverName) whereClause.server_name = serverName;
      if (toolName) whereClause.tool_name = { contains: toolName, mode: 'insensitive' };

      // Status filter
      if (status === 'success') whereClause.success = true;
      else if (status === 'error') whereClause.success = false;

      // Date range filter
      if (startDate || endDate) {
        whereClause.timestamp = {};
        if (startDate) whereClause.timestamp.gte = new Date(startDate);
        if (endDate) whereClause.timestamp.lte = new Date(endDate);
      }

      // Get paginated results with full data
      const [mcpUsages, totalCount] = await Promise.all([
        prisma.mCPUsage.findMany({
          where: whereClause,
          orderBy: { timestamp: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        }),
        prisma.mCPUsage.count({ where: whereClause })
      ]);

      // Map to response format with full request/response data
      const logs: MCPCallLog[] = mcpUsages.map(usage => {
        // Extract model info from request_metadata
        const metadata = usage.request_metadata as Record<string, any> | null;
        return {
          id: usage.id,
          toolName: usage.tool_name,
          serverId: usage.server_name || 'unknown',
          method: usage.method || undefined,
          userId: usage.user_id,
          userName: usage.user_name || usage.user?.name || undefined,
          userEmail: usage.user_email || usage.user?.email || undefined,
          status: usage.success ? 'success' : 'error',
          executionTime: usage.execution_time_ms || 0,
          requestSize: usage.request_size || undefined,
          responseSize: usage.response_size || undefined,
          input: metadata?.requestPayload || {}, // Full request params
          output: usage.response_data || null, // Full response data
          error: usage.error_message || undefined,
          timestamp: usage.timestamp.toISOString(),
          modelUsed: metadata?.modelUsed || undefined,
          modelProvider: metadata?.modelProvider || undefined
        };
      });

      const totalPages = Math.ceil(totalCount / limit);

      return reply.send({
        success: true,
        logs,
        pagination: {
          page,
          limit,
          totalPages,
          totalItems: totalCount,
          hasMore: page < totalPages
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch MCP logs');
      return reply.code(500).send({ success: false, error: 'Failed to fetch MCP logs' });
    }
  });

  /**
   * GET /api/admin/mcp-logs/stats
   * Returns aggregate statistics for MCP calls
   */
  fastify.get('/api/admin/mcp-logs/stats', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Get aggregate statistics using Prisma
      const [
        totalStats,
        successCount,
        recentCount,
        topToolsData,
        topServersData,
        topUsersData
      ] = await Promise.all([
        // Total stats with averages
        prisma.mCPUsage.aggregate({
          _count: { id: true },
          _avg: { execution_time_ms: true },
          _sum: { execution_time_ms: true, request_size: true, response_size: true }
        }),
        // Success count
        prisma.mCPUsage.count({ where: { success: true } }),
        // Recent 24h count
        prisma.mCPUsage.count({ where: { timestamp: { gte: last24h } } }),
        // Top tools by usage
        prisma.mCPUsage.groupBy({
          by: ['tool_name', 'server_name'],
          _count: { tool_name: true },
          orderBy: { _count: { tool_name: 'desc' } },
          take: 10
        }),
        // Top servers by usage
        prisma.mCPUsage.groupBy({
          by: ['server_name'],
          _count: { server_name: true },
          orderBy: { _count: { server_name: 'desc' } },
          take: 10
        }),
        // Top users by usage
        prisma.mCPUsage.groupBy({
          by: ['user_id', 'user_name', 'user_email'],
          _count: { user_id: true },
          orderBy: { _count: { user_id: 'desc' } },
          take: 10
        })
      ]);

      const totalCalls = totalStats._count.id;
      const successfulCalls = successCount;
      const failedCalls = totalCalls - successfulCalls;
      const successRate = totalCalls > 0 ? ((successfulCalls / totalCalls) * 100).toFixed(2) : '0.00';
      const avgExecutionTime = Math.round(totalStats._avg.execution_time_ms || 0);

      return reply.send({
        success: true,
        totalCalls,
        recentCalls24h: recentCount,
        successfulCalls,
        failedCalls,
        successRate,
        avgExecutionTime,
        totalExecutionTime: totalStats._sum.execution_time_ms || 0,
        totalRequestSize: totalStats._sum.request_size || 0,
        totalResponseSize: totalStats._sum.response_size || 0,
        topTools: topToolsData.map(t => ({
          toolId: t.tool_name,
          toolName: t.tool_name,
          serverId: t.server_name,
          count: t._count.tool_name
        })),
        topServers: topServersData.map(s => ({
          serverId: s.server_name || 'unknown',
          count: s._count.server_name
        })),
        topUsers: topUsersData.map(u => ({
          userId: u.user_id,
          userName: u.user_name,
          userEmail: u.user_email,
          count: u._count.user_id
        }))
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch MCP stats');
      return reply.code(500).send({ success: false, error: 'Failed to fetch MCP statistics' });
    }
  });

  /**
   * GET /api/admin/mcp-logs/:id
   * Returns a single MCP call log with full details
   */
  fastify.get('/api/admin/mcp-logs/:id', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      const usage = await prisma.mCPUsage.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, name: true, email: true } }
        }
      });

      if (!usage) {
        return reply.code(404).send({ success: false, error: 'MCP log not found' });
      }

      return reply.send({
        success: true,
        log: {
          id: usage.id,
          toolName: usage.tool_name,
          serverId: usage.server_name || 'unknown',
          method: usage.method,
          userId: usage.user_id,
          userName: usage.user_name || usage.user?.name,
          userEmail: usage.user_email || usage.user?.email,
          status: usage.success ? 'success' : 'error',
          executionTime: usage.execution_time_ms || 0,
          requestSize: usage.request_size,
          responseSize: usage.response_size,
          input: usage.request_metadata, // Full request params
          output: usage.response_data, // Full response data
          error: usage.error_message,
          timestamp: usage.timestamp.toISOString()
        }
      });
    } catch (error: any) {
      logger.error({ error: error.message, id }, 'Failed to fetch MCP log');
      return reply.code(500).send({ success: false, error: 'Failed to fetch MCP log' });
    }
  });
  /**
   * GET /api/admin/mcp/logs
   * Returns recent console logs from MCP proxy container
   * Query params: lines (default 200), server (optional filter)
   */
  fastify.get('/api/admin/mcp/logs', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { lines?: string; server?: string };
    const lines = parseInt(query.lines || '200');
    const serverFilter = query.server;

    try {
      // Execute docker logs command to get MCP proxy logs
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execPromise = promisify(exec);

      const { stdout, stderr } = await execPromise(
        `docker logs openagentic-mcp-proxy --tail ${lines} 2>&1`,
        { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
      );

      const allOutput = stdout + stderr;
      const logLines = allOutput.split('\n').filter(line => line.trim());

      // Parse logs into structured format
      const logs = logLines.map(line => {
        // Try to extract timestamp and level from log line
        let timestamp = new Date().toISOString();
        let level = 'info';
        let server = 'mcp-proxy';
        let message = line;

        // Match common log patterns
        // Pattern: 2025-12-24 17:14:29,123 - server-name - LEVEL - message
        const logMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.\d]*)\s*-?\s*([^-]+)\s*-?\s*(\w+)\s*-?\s*(.*)$/);
        if (logMatch) {
          timestamp = new Date(logMatch[1].replace(',', '.')).toISOString();
          server = logMatch[2].trim().replace(/^openagentic-/, '').replace(/-mcp$/, '') || 'mcp-proxy';
          level = logMatch[3].toLowerCase();
          message = logMatch[4] || line;
        }

        // Alternative JSON log format
        try {
          if (line.startsWith('{')) {
            const parsed = JSON.parse(line);
            timestamp = parsed.timestamp || parsed.time || timestamp;
            level = parsed.level || parsed.levelname?.toLowerCase() || level;
            server = parsed.server || parsed.name || server;
            message = parsed.message || parsed.msg || JSON.stringify(parsed);
          }
        } catch {
          // Not JSON, use default parsing
        }

        return { timestamp, server, level, message };
      });

      // Filter by server if specified
      const filteredLogs = serverFilter
        ? logs.filter(log => log.server.toLowerCase().includes(serverFilter.toLowerCase()))
        : logs;

      return reply.send({ success: true, logs: filteredLogs });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch MCP logs');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch MCP logs',
        logs: []
      });
    }
  });

  /**
   * GET /api/admin/mcp/logs/stream
   * SSE endpoint for streaming live MCP proxy logs
   * Query params: token (auth), server (optional filter)
   */
  fastify.get('/api/admin/mcp/logs/stream', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const query = request.query as { token?: string; server?: string };
    const serverFilter = query.server;

    // Validate token for SSE (can't use preHandler with EventSource)
    const token = query.token;
    if (!token) {
      reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    try {
      // Verify the token
      const jwt = await import('jsonwebtoken');
      const decoded = jwt.default.verify(
        token,
        process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('JWT_SECRET must be set'); })()
      ) as any;

      if (!decoded.isAdmin && !decoded.is_admin) {
        reply.code(403).send({ error: 'Admin access required' });
        return;
      }

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      // Spawn docker logs process with follow
      const { spawn } = await import('child_process');
      const dockerLogs = spawn('docker', ['logs', 'openagentic-mcp-proxy', '-f', '--tail', '0'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const sendLogEntry = (line: string) => {
        if (!line.trim()) return;

        let logEntry = {
          timestamp: new Date().toISOString(),
          server: 'mcp-proxy',
          level: 'info',
          message: line
        };

        // Try to parse structured log
        const logMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.\d]*)\s*-?\s*([^-]+)\s*-?\s*(\w+)\s*-?\s*(.*)$/);
        if (logMatch) {
          logEntry.timestamp = new Date(logMatch[1].replace(',', '.')).toISOString();
          logEntry.server = logMatch[2].trim().replace(/^openagentic-/, '').replace(/-mcp$/, '') || 'mcp-proxy';
          logEntry.level = logMatch[3].toLowerCase();
          logEntry.message = logMatch[4] || line;
        }

        // Apply server filter if specified
        if (serverFilter && !logEntry.server.toLowerCase().includes(serverFilter.toLowerCase())) {
          return;
        }

        try {
          reply.raw.write(`data: ${JSON.stringify(logEntry)}\n\n`);
        } catch {
          // Connection closed
        }
      };

      // Process stdout
      dockerLogs.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        lines.forEach(sendLogEntry);
      });

      // Process stderr
      dockerLogs.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        lines.forEach(sendLogEntry);
      });

      // Handle process end
      dockerLogs.on('close', () => {
        try {
          reply.raw.write(`data: ${JSON.stringify({ type: 'close', message: 'Log stream ended' })}\n\n`);
          reply.raw.end();
        } catch {
          // Already closed
        }
      });

      // Handle client disconnect
      request.raw.on('close', () => {
        dockerLogs.kill();
      });

      // Keep connection alive with heartbeat
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on connection close
      reply.raw.on('close', () => {
        clearInterval(heartbeat);
        dockerLogs.kill();
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to start log stream');
      reply.code(500).send({ error: 'Failed to start log stream' });
    }
  });
};

export default adminMCPLogsRoutes;
