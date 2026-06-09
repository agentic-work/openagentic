/**
 * Prompt Metrics Routes
 *
 * Provides analytics for prompt usage tracking across chat sessions.
 * Shows which prompts, templates, and injections are used per session.
 *
 * @see {@link https://docs.openagentic.io/api/analytics-monitoring}
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for prompt metrics routes');
}

export const promptMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Helper to get user from token
  const getUserFromToken = (request: any): { userId: string; isAdmin: boolean } | null => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return null;

    try {
      const token = authHeader.replace('Bearer ', '');
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as any;
      return {
        userId: decoded.userId || decoded.id || decoded.oid,
        isAdmin: decoded.isAdmin || false
      };
    } catch (error) {
      logger.warn({ error }, 'Failed to decode user token');
      return null;
    }
  };

  // Admin auth middleware
  const requireAdmin = async (request: any, reply: any) => {
    const user = getUserFromToken(request);
    if (!user || !user.isAdmin) {
      return reply.code(403).send({ error: 'Admin access required' });
    }
    request.user = user;
  };

  /**
   * Get prompt metrics for all sessions
   * GET /api/admin/analytics/prompt-metrics
   */
  fastify.get('/prompt-metrics', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { timeRange = '7d' } = request.query as { timeRange?: string };

      // Calculate date range
      let startDate: Date | undefined;
      const now = new Date();

      switch (timeRange) {
        case '24h':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'all':
          startDate = undefined;
          break;
        default:
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      const whereClause: any = {};
      if (startDate) {
        whereClause.created_at = { gte: startDate };
      }

      // NEW: Get prompt usage records from dedicated tracking table
      const promptUsageRecords = await prisma.promptUsage.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' }
      });

      // Get user information for records
      const userIds = [...new Set(promptUsageRecords.map(r => r.user_id))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true }
      });

      const userMap = new Map(users.map(u => [u.id, u]));

      // Process prompt usage records
      const metrics = promptUsageRecords.map(record => {
        const user = userMap.get(record.user_id);

        return {
          id: record.id,
          sessionId: record.session_id,
          messageId: record.message_id,
          userId: record.user_id,
          userName: user?.name || 'Unknown',
          userEmail: user?.email || 'Unknown',
          timestamp: record.created_at.toISOString(),

          // Template information
          baseTemplateId: record.base_template_id,
          baseTemplateName: record.base_template_name,
          domainTemplateId: record.domain_template_id,
          domainTemplateName: record.domain_template_name,

          // System prompt
          systemPrompt: record.system_prompt,
          systemPromptLength: record.system_prompt_length,

          // Techniques
          appliedTechniques: record.techniques_applied || [],
          tokensAdded: record.tokens_added || 0,

          // Context injections
          hasFormatting: record.has_formatting,
          hasMcpContext: record.has_mcp_context,
          hasRAG: record.has_rag_context,
          hasMemory: record.has_memory_context,
          hasAzureSdkDocs: record.has_azure_sdk_docs,

          // Context counts
          ragDocsCount: record.rag_docs_count,
          ragChatsCount: record.rag_chats_count,
          memoryCount: record.memory_count,
          mcpToolsCount: record.mcp_tools_count,

          // Metadata
          metadata: record.metadata
        };
      });

      // Calculate aggregate statistics
      const uniqueSessionIds = new Set(metrics.map(m => m.sessionId));
      const uniqueUserIds = new Set(metrics.map(m => m.userId));
      const allTechniques = metrics.flatMap(m => m.appliedTechniques);
      const techniqueCount = allTechniques.reduce((acc, tech) => {
        acc[tech] = (acc[tech] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const mostUsedTechniques = Object.entries(techniqueCount)
        .map(([technique, count]) => ({ technique, count: count as number }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

      const totalTokensAdded = metrics.reduce((sum, m) => sum + (m.tokensAdded || 0), 0);
      const avgTokensAdded = metrics.length > 0 ? totalTokensAdded / metrics.length : 0;

      // Template usage stats
      const baseTemplateCount = metrics.reduce((acc, m) => {
        if (m.baseTemplateName) acc[m.baseTemplateName] = (acc[m.baseTemplateName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const domainTemplateCount = metrics.reduce((acc, m) => {
        if (m.domainTemplateName) acc[m.domainTemplateName] = (acc[m.domainTemplateName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const aggregate = {
        totalRequests: metrics.length,
        uniqueSessions: uniqueSessionIds.size,
        uniqueUsers: uniqueUserIds.size,
        totalPrompts: metrics.filter(m => m.systemPrompt).length,
        mostUsedTechniques,
        avgTokensAdded,
        avgSystemPromptLength: metrics.reduce((sum, m) => sum + (m.systemPromptLength || 0), 0) / metrics.length,

        // Template stats
        baseTemplatesUsed: Object.keys(baseTemplateCount).length,
        domainTemplatesUsed: Object.keys(domainTemplateCount).length,
        mostUsedBaseTemplate: Object.entries(baseTemplateCount).sort((a, b) => b[1] - a[1])[0],
        mostUsedDomainTemplate: Object.entries(domainTemplateCount).sort((a, b) => b[1] - a[1])[0],

        // Context injection stats
        formattingInjections: metrics.filter(m => m.hasFormatting).length,
        mcpContextInjections: metrics.filter(m => m.hasMcpContext).length,
        ragContextInjections: metrics.filter(m => m.hasRAG).length,
        memoryContextInjections: metrics.filter(m => m.hasMemory).length,
        azureSdkDocsInjections: metrics.filter(m => m.hasAzureSdkDocs).length,

        // Average context counts
        avgRagDocsCount: metrics.reduce((sum, m) => sum + (m.ragDocsCount || 0), 0) / metrics.length,
        avgRagChatsCount: metrics.reduce((sum, m) => sum + (m.ragChatsCount || 0), 0) / metrics.length,
        avgMemoryCount: metrics.reduce((sum, m) => sum + (m.memoryCount || 0), 0) / metrics.length,
        avgMcpToolsCount: metrics.reduce((sum, m) => sum + (m.mcpToolsCount || 0), 0) / metrics.length
      };

      return reply.send({
        metrics,
        aggregate,
        timeRange,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch prompt metrics');
      return reply.code(500).send({
        error: 'Failed to fetch prompt metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Get prompt metrics for a specific session
   * GET /api/admin/analytics/prompt-metrics/:sessionId
   */
  fastify.get('/prompt-metrics/:sessionId', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };

      // Get session info
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      if (!session) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      // Get all prompt usage records for this session
      const promptUsageRecords = await prisma.promptUsage.findMany({
        where: { session_id: sessionId },
        orderBy: { created_at: 'asc' }
      });

      // Get messages for this session to show the complete picture
      const messages = await prisma.chatMessage.findMany({
        where: { session_id: sessionId },
        select: {
          id: true,
          role: true,
          content: true,
          mcp_calls: true,
          created_at: true
        },
        orderBy: { created_at: 'asc' }
      });

      // Map prompt usage to messages
      const promptUsageByMessage = new Map(
        promptUsageRecords.map(r => [r.message_id, r])
      );

      // Enhanced message list with prompt info
      const messagesWithPromptInfo = messages.map(msg => {
        const promptInfo = promptUsageByMessage.get(msg.id);

        return {
          messageId: msg.id,
          role: msg.role,
          contentLength: msg.content?.length || 0,
          timestamp: msg.created_at.toISOString(),
          hasMcpCalls: !!(msg.mcp_calls && Array.isArray(msg.mcp_calls) && msg.mcp_calls.length > 0),
          mcpCallsCount: (msg.mcp_calls && Array.isArray(msg.mcp_calls)) ? msg.mcp_calls.length : 0,

          // Prompt information (if this is an assistant message)
          promptInfo: promptInfo ? {
            baseTemplate: promptInfo.base_template_name,
            domainTemplate: promptInfo.domain_template_name,
            techniquesApplied: promptInfo.techniques_applied || [],
            tokensAdded: promptInfo.tokens_added || 0,
            hasFormatting: promptInfo.has_formatting,
            hasMcpContext: promptInfo.has_mcp_context,
            hasRAG: promptInfo.has_rag_context,
            hasMemory: promptInfo.has_memory_context,
            ragDocsCount: promptInfo.rag_docs_count,
            ragChatsCount: promptInfo.rag_chats_count,
            memoryCount: promptInfo.memory_count,
            mcpToolsCount: promptInfo.mcp_tools_count,
            systemPromptLength: promptInfo.system_prompt_length
          } : null
        };
      });

      // Calculate session-level stats
      const sessionStats = {
        sessionId: session.id,
        userId: session.user_id,
        userName: session.user?.name || 'Unknown',
        userEmail: session.user?.email || 'Unknown',
        createdAt: session.created_at.toISOString(),
        totalMessages: messages.length,
        totalPromptRecords: promptUsageRecords.length,

        // Aggregated prompt stats
        uniqueTemplatesUsed: new Set([
          ...promptUsageRecords.map(r => r.domain_template_name).filter(Boolean)
        ]).size,
        totalTokensAdded: promptUsageRecords.reduce((sum, r) => sum + (r.tokens_added || 0), 0),
        avgSystemPromptLength: promptUsageRecords.length > 0
          ? promptUsageRecords.reduce((sum, r) => sum + (r.system_prompt_length || 0), 0) / promptUsageRecords.length
          : 0,

        // Context injection stats
        requestsWithRAG: promptUsageRecords.filter(r => r.has_rag_context).length,
        requestsWithMemory: promptUsageRecords.filter(r => r.has_memory_context).length,
        requestsWithMCP: promptUsageRecords.filter(r => r.has_mcp_context).length
      };

      return reply.send({
        sessionStats,
        messages: messagesWithPromptInfo,
        promptUsageRecords: promptUsageRecords.map(r => ({
          id: r.id,
          messageId: r.message_id,
          timestamp: r.created_at.toISOString(),
          baseTemplate: r.base_template_name,
          domainTemplate: r.domain_template_name,
          techniquesApplied: r.techniques_applied || [],
          tokensAdded: r.tokens_added || 0,
          systemPromptLength: r.system_prompt_length,
          hasFormatting: r.has_formatting,
          hasMcpContext: r.has_mcp_context,
          hasRAG: r.has_rag_context,
          hasMemory: r.has_memory_context,
          hasAzureSdkDocs: r.has_azure_sdk_docs,
          ragDocsCount: r.rag_docs_count,
          ragChatsCount: r.rag_chats_count,
          memoryCount: r.memory_count,
          mcpToolsCount: r.mcp_tools_count,
          systemPrompt: r.system_prompt, // Full system prompt
          metadata: r.metadata
        })),
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch session prompt metrics');
      return reply.code(500).send({
        error: 'Failed to fetch session prompt metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
};

