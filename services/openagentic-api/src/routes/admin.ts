/**
 * Admin Routes
 * 
 * Administrative endpoints for system management, user administration,
 * usage analytics, and platform configuration. Provides comprehensive
 * admin dashboard functionality with real-time system monitoring.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import os from 'os';
// jwt import removed — admin auth handled by outer adminMiddleware (unifiedAuth.ts)
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { loggers } from '../utils/logger.js';
import llmProviderRoutes from './admin/llm-providers.js';
import multiModelRoutes from './admin/multi-model.js';
import routerTuningRoutes from './admin/router-tuning.js';
import chatLoopConfigRoutes from './admin/chat-loop-config.js';
import enrichedToolsRoutes from './admin/enriched-tools.js';
import { ProviderManager, getProviderManager } from '../services/llm-providers/ProviderManager.js';
import { ProviderConfigService } from '../services/llm-providers/ProviderConfigService.js';
import { contextManagementService } from '../services/ContextManagementService.js';

// Milvus client for vector database operations
let milvusClient: MilvusClient | null = null;
function getMilvusClient(): MilvusClient | null {
  if (!milvusClient && process.env.MILVUS_HOST && process.env.MILVUS_PORT) {
    try {
      milvusClient = new MilvusClient({
        address: `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
        username: process.env.MILVUS_USERNAME,
        password: process.env.MILVUS_PASSWORD,
        timeout: 30000
      });
    } catch (error) {
      console.error('Failed to create Milvus client:', error);
    }
  }
  return milvusClient;
}

// JWT_SECRET removed — admin auth handled by outer adminMiddleware (unifiedAuth.ts)

// Helper functions removed - orchestrator references removed

// Type definitions
interface SystemMetric {
  id: string;
  name: string;
  value: number;
  unit: string;
  status: 'healthy' | 'warning' | 'critical';
  trend: 'up' | 'down' | 'stable';
  history: Array<{ timestamp: string; value: number }>;
}

interface ResourceUsage {
  cpu?: number;
  memory?: number;
  uptime?: number;
  [key: string]: any;
}

interface InspectorServer {
  id: string;
  name: string;
  enabled: boolean;
  type: string;
  tools?: Array<{
    name: string;
    description?: string;
    [key: string]: any;
  }>;
  command?: string;
  args?: string[];
  env?: Record<string, any>;
  requireObo?: boolean;
  userIsolated?: boolean;
  capabilities?: string[];
}

interface ToolsAPIResponse {
  servers?: InspectorServer[];
}

interface InspectorAPIResponse {
  servers?: InspectorServer[];
}

// NOTE: Admin auth is handled by the outer adminMiddleware from unifiedAuth.ts
// which supports API keys, Azure AD tokens, and local JWTs.
// The legacy requireAdmin function was removed — it only supported local JWTs
// and rejected API keys, causing 401 errors for valid admin API key holders.

/**
 * Admin Routes Plugin - Completely rewritten to use Prisma properly
 */
export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Ensure Prisma is connected on startup
  try {
    await prisma.$connect();
    logger.info('Admin routes initialized with Prisma connection');
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to connect to database via Prisma');
    throw error;
  }

  /**
   * Get available models endpoint
   */
  fastify.get('/models', async (request, reply) => {
    try {
      const availableModels = [];

      // Dynamically discover Azure OpenAI deployment environment variables
      const deploymentEnvVars = Object.keys(process.env)
        .filter(key => key.includes('AZURE_OPENAI') && key.includes('DEPLOYMENT'))
        .filter(key => process.env[key]); // Only include vars that have values

      if (deploymentEnvVars.length === 0) {
        return reply.code(500).send({ error: 'No Azure OpenAI deployment environment variables found' });
      }

      deploymentEnvVars.forEach((envVar, index) => {
        const deploymentName = process.env[envVar];
        if (deploymentName) {
          availableModels.push({
            id: deploymentName,
            name: deploymentName,
            provider: 'azure-openai',
            isDefault: index === 0, // First one found is default
            description: `Azure OpenAI deployment from ${envVar}`,
            envVar: envVar
          });
        }
      });

      const defaultForUI = availableModels.find(m => m.isDefault) || availableModels[0];

      return reply.send({
        models: availableModels,
        defaultModel: defaultForUI.id,
        configured: true,
        discoveredEnvVars: deploymentEnvVars
      });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get models');
      return reply.code(500).send({ error: 'Failed to get models' });
    }
  });

  /**
   * Health check endpoint - Using Prisma
   */
  fastify.get('/health', async (request, reply) => {
    try {
      // Check database connection via Prisma
      await prisma.$queryRaw`SELECT 1 as healthy`;
      
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: true,
        services: {
          prisma: 'connected',
          admin: 'operational'
        }
      });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Admin health check failed');
      return reply.code(500).send({ error: 'Health check failed' });
    }
  });

  /**
   * Dashboard endpoint - Using Prisma with proper relations
   */
  fastify.get('/dashboard', async (request, reply) => {
    const debugId = `DASH_${Date.now()}`;
    logger.info(`[${debugId}] Dashboard request started`);
    
    try {
      // Get basic stats using Prisma
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const [
        activeUsersToday,
        totalUsers,
        totalSessions,
        messagesInDb
      ] = await Promise.all([
        prisma.chatSession.groupBy({
          by: ['user_id'],
          where: {
            created_at: { gte: today }
          }
        }).then(results => results.length),
        
        prisma.user.count(),
        
        prisma.chatSession.count({
          where: { deleted_at: null }
        }),
        
        prisma.chatMessage.count({
          where: { deleted_at: null }
        })
      ]);

      // Get token usage stats
      const tokenStats = await prisma.tokenUsage.aggregate({
        where: {
          timestamp: { gte: today }
        },
        _sum: {
          total_tokens: true,
          total_cost: true
        },
        _count: true
      });

      // Get MCP server status from configs
      const mcpConfigs = await prisma.mCPServerConfig.findMany({
        include: {
          status: true,
          instances: {
            where: {
              status: 'running'
            }
          }
        }
      });

      const mcpStats = mcpConfigs.reduce((acc, config) => {
        const status = config.enabled ? 'enabled' : 'disabled';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // System metrics
      const systemMetrics = {
        cpu: {
          usage: Math.round(os.loadavg()[0] * 100 / os.cpus().length),
          cores: os.cpus().length
        },
        memory: {
          total: os.totalmem(),
          used: os.totalmem() - os.freemem(),
          percentage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
        },
        uptime: Math.round(os.uptime())
      };
      
      logger.info(`[${debugId}] Dashboard data compiled successfully`);
      
      return reply.send({
        stats: {
          activeUsersToday: activeUsersToday || 0,
          messagesToday: messagesInDb || 0,
          tokensToday: tokenStats._sum.total_tokens || 0,
          costToday: Number(tokenStats._sum.total_cost) || 0,
          totalSessions: totalSessions || 0,
          totalUsers: totalUsers || 0
        },
        mcp: mcpStats,
        systemMetrics
      });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error), debugId }, 'Dashboard error');
      return reply.code(500).send({ 
        error: 'Failed to fetch dashboard data',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * User Management - Using Prisma relations
   */
  fastify.get('/users', async (request, reply) => {
    try {
      const { search, limit = 50, offset = 0 } = request.query as any;
      
      const where: any = {};
      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } }
        ];
      }

      const [users, totalCount] = await Promise.all([
        prisma.user.findMany({
          where,
          include: {
            sessions: {
              where: { deleted_at: null },
              select: { id: true, created_at: true, message_count: true }
            },
            token_usage: {
              select: { total_tokens: true, total_cost: true }
            }
          },
          orderBy: { created_at: 'desc' },
          take: parseInt(limit),
          skip: parseInt(offset)
        }),
        
        prisma.user.count({ where })
      ]);

      const enhancedUsers = users.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.is_admin,
        groups: user.groups,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
        stats: {
          totalSessions: user.sessions.length,
          totalMessages: user.sessions.reduce((sum, s) => sum + s.message_count, 0),
          totalTokens: user.token_usage.reduce((sum, t) => sum + t.total_tokens, 0),
          totalCost: user.token_usage.reduce((sum, t) => sum + Number(t.total_cost), 0)
        }
      }));

      return reply.send({
        users: enhancedUsers,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: totalCount > parseInt(offset) + parseInt(limit)
        }
      });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'User list error');
      return reply.code(500).send({ error: 'Failed to fetch users' });
    }
  });

  /**
   * Chat Sessions - Using Prisma with proper filtering
   */
  // Alias for admin portal compatibility
  fastify.get('/sessions', async (request, reply) => {
    try {
      const { search, timeframe, limit = 50, offset = 0 } = request.query as any;

      let where: any = { deleted_at: null };

      if (search) {
        where.OR = [
          { sessionId: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } }
        ];
      }

      if (timeframe) {
        const now = new Date();
        const timeframeHours = parseInt(timeframe);
        if (!isNaN(timeframeHours)) {
          where.createdAt = {
            gte: new Date(now.getTime() - timeframeHours * 60 * 60 * 1000)
          };
        }
      }

      const sessions = await prisma.chatSession.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, name: true } },
          _count: { select: { messages: true } }
        },
        orderBy: { created_at: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      });

      const total = await prisma.chatSession.count({ where });

      reply.send({ sessions, total });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch chat sessions');
      reply.code(500).send({ error: 'Failed to fetch chat sessions' });
    }
  });

  fastify.get('/chat-sessions', async (request, reply) => {
    try {
      const { search, timeframe, limit = 50, offset = 0 } = request.query as any;
      
      let where: any = { deleted_at: null };
      
      // Time filter
      if (timeframe) {
        const now = new Date();
        switch (timeframe) {
          case 'today':
            where.created_at = { gte: new Date(now.setHours(0, 0, 0, 0)) };
            break;
          case 'week':
            where.created_at = { gte: new Date(now.setDate(now.getDate() - 7)) };
            break;
          case 'month':
            where.created_at = { gte: new Date(now.setMonth(now.getMonth() - 1)) };
            break;
        }
      }

      // Search filter
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } }
        ];
      }

      const [sessions, totalCount] = await Promise.all([
        prisma.chatSession.findMany({
          where,
          include: {
            user: {
              select: { id: true, email: true, name: true }
            },
            messages: {
              where: { deleted_at: null },
              select: { id: true, role: true, created_at: true },
              orderBy: { created_at: 'desc' },
              take: 1
            }
          },
          orderBy: { updated_at: 'desc' },
          take: parseInt(limit),
          skip: parseInt(offset)
        }),
        
        prisma.chatSession.count({ where })
      ]);

      const enhancedSessions = sessions.map(session => ({
        id: session.id,
        title: session.title,
        messageCount: session.message_count,
        totalTokens: session.total_tokens,
        totalCost: Number(session.total_cost),
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        user: session.user,
        lastMessage: session.messages[0] || null
      }));

      return reply.send({
        sessions: enhancedSessions,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: totalCount > parseInt(offset) + parseInt(limit)
        }
      });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Chat sessions error');
      return reply.code(500).send({ error: 'Failed to fetch chat sessions' });
    }
  });

  // MCP Management routes removed - all orchestrator references deleted

  /**
   * Global Usage - System-wide usage from database
   * NOTE: Previously fetched from MCP Proxy, now uses database directly
   */
  fastify.get('/global-usage', async (request, reply) => {
    try {
      logger.info('[GLOBAL-USAGE] Fetching usage data from database');
      return await getFallbackUsageData(prisma, reply);
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch global usage');
      return reply.code(500).send({
        error: 'Failed to fetch global usage data',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Fallback function to get usage data from database
  async function getFallbackUsageData(prisma: PrismaClient, reply: any) {
    try {
      logger.info('[GLOBAL-USAGE] Using database fallback');

      // Get usage from our database
      const dbUsage = await prisma.tokenUsage.aggregate({
        _sum: {
          total_tokens: true,
          total_cost: true
        },
        _count: true
      });

      const modelBreakdown = await prisma.tokenUsage.groupBy({
        by: ['model'],
        _sum: {
          total_tokens: true,
          total_cost: true
        },
        _count: true
      });

      const breakdown: Record<string, any> = {};
      modelBreakdown.forEach((model) => {
        breakdown[model.model] = {
          count: model._count,
          spend: Number(model._sum.total_cost) || 0,
          tokens: model._sum.total_tokens || 0
        };
      });

      return reply.send({
        total_spend: Number(dbUsage._sum.total_cost) || 0,
        max_budget: 1000, // Default budget
        model_breakdown: breakdown,
        total_requests: dbUsage._count || 0,
        data_source: 'database_fallback'
      });
    } catch (dbError) {
      logger.error({ error: dbError instanceof Error ? dbError.message : String(dbError) }, 'Database fallback also failed');
      return reply.code(500).send({
        error: 'Failed to fetch global usage data',
        details: 'Both provider and database sources failed'
      });
    }
  }

  // REMOVED: /analytics/usage route - now handled by admin-analytics.ts at /api/admin/analytics/usage
  // The new admin-analytics.ts provides per-user cost tracking, model usage, and token stats

  // REMOVED: /prompts/templates POST and PUT routes - now handled by admin-prompts.ts at /api/admin/prompts/templates

  /**
   * User usage endpoint - Using Prisma with proper user context
   */
  fastify.get('/my-usage', async (request, reply) => {
    try {
      // Auth handled by outer adminMiddleware — request.user already populated
      const user = (request as any).user;
      if (!user) {
        return reply.code(401).send({ error: 'Authorization required' });
      }

      const userId = user.id || user.oid || user.userId;

      if (!userId) {
        return reply.code(400).send({ error: 'User ID not found in token' });
      }

      // Get current month usage
      const currentMonth = new Date();
      currentMonth.setDate(1);
      currentMonth.setHours(0, 0, 0, 0);

      const [monthlyUsage, dailyUsage, modelUsage] = await Promise.all([
        // Monthly total
        prisma.tokenUsage.aggregate({
          where: {
            user_id: userId,
            timestamp: { gte: currentMonth }
          },
          _sum: {
            total_tokens: true,
            prompt_tokens: true,
            completion_tokens: true,
            total_cost: true
          },
          _count: true
        }),
        
        // Daily breakdown
        prisma.tokenUsage.groupBy({
          by: ['timestamp'],
          where: {
            user_id: userId,
            timestamp: { gte: currentMonth }
          },
          _sum: {
            total_tokens: true,
            total_cost: true
          },
          orderBy: {
            timestamp: 'asc'
          }
        }),
        
        // Model breakdown
        prisma.tokenUsage.groupBy({
          by: ['model'],
          where: {
            user_id: userId,
            timestamp: { gte: currentMonth }
          },
          _sum: {
            total_tokens: true,
            prompt_tokens: true,
            completion_tokens: true,
            total_cost: true
          },
          _count: true,
          orderBy: {
            _sum: {
              total_cost: 'desc'
            }
          }
        })
      ]);

      // Format daily usage for charts
      const dailyStats = dailyUsage.map(day => ({
        date: day.timestamp.toISOString().split('T')[0],
        tokens: day._sum.total_tokens || 0,
        cost: Number(day._sum.total_cost) || 0
      }));

      // Format model usage
      const modelStats = modelUsage.map(model => ({
        model: model.model,
        requests: model._count,
        tokens: model._sum.total_tokens || 0,
        promptTokens: model._sum.prompt_tokens || 0,
        completionTokens: model._sum.completion_tokens || 0,
        cost: Number(model._sum.total_cost) || 0
      }));

      const summary = {
        totalRequests: monthlyUsage._count,
        totalTokens: monthlyUsage._sum.total_tokens || 0,
        promptTokens: monthlyUsage._sum.prompt_tokens || 0,
        completionTokens: monthlyUsage._sum.completion_tokens || 0,
        estimatedCost: Number(monthlyUsage._sum.total_cost) || 0
      };

      return reply.send({
        period: 'current_month',
        summary,
        dailyUsage: dailyStats,
        modelBreakdown: modelStats
      });
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'My usage error');
      return reply.code(500).send({ error: 'Failed to fetch usage data' });
    }
  });

  // REMOVED: /templates stub - now handled by admin-prompts.ts at /api/admin/prompts/templates

  fastify.get('/prompts', async (request, reply) => {
    try {
      // Alias to existing admin prompting route
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/admin/prompts/semantic',
        headers: request.headers
      });
      reply.code(response.statusCode).send(response.json());
    } catch (error) {
      logger.error({ error }, 'Failed to fetch prompts');
      reply.code(500).send({ error: 'Failed to fetch prompts' });
    }
  });

  fastify.get('/milvus/collections', async (request, reply): Promise<void> => {
    try {
      const client = getMilvusClient();
      if (!client) {
        reply.send({
          collections: [],
          total: 0,
          error: 'Milvus not configured - set MILVUS_HOST and MILVUS_PORT'
        });
        return;
      }

      // List all collections
      const collectionsResponse = await client.listCollections();
      const collectionData = collectionsResponse.data || [];
      // Extract collection names - data can be string[] or CollectionData[]
      const collectionNames: string[] = collectionData.map((item: any) =>
        typeof item === 'string' ? item : item.name
      );

      // Get details for each collection
      const collections = await Promise.all(
        collectionNames.map(async (name: string) => {
          try {
            const stats = await client.getCollectionStatistics({ collection_name: name });
            const describe = await client.describeCollection({ collection_name: name });

            return {
              name,
              row_count: parseInt(stats.data?.row_count || '0'),
              status: describe.status?.code === 0 ? 'loaded' : 'created',
              fields: describe.schema?.fields?.length || 0,
              created_at: describe.created_timestamp || null,
              description: describe.schema?.description || '',
              dimension: describe.schema?.fields?.find((f: any) =>
                f.data_type === 101 // FloatVector type
              )?.type_params?.find((p: any) => p.key === 'dim')?.value || null
            };
          } catch (err) {
            return {
              name,
              row_count: 0,
              status: 'error',
              error: err instanceof Error ? err.message : 'Unknown error'
            };
          }
        })
      );

      reply.send({
        collections,
        total: collections.length
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch milvus collections');
      reply.code(500).send({ error: 'Failed to fetch milvus collections' });
    }
  });

  fastify.get('/milvus/stats', async (request, reply): Promise<void> => {
    try {
      const client = getMilvusClient();
      if (!client) {
        reply.send({
          stats: {},
          total_documents: 0,
          collections_count: 0,
          error: 'Milvus not configured - set MILVUS_HOST and MILVUS_PORT'
        });
        return;
      }

      // Get health status
      const health = await client.checkHealth();

      // List collections and aggregate stats
      const collectionsResponse = await client.listCollections();
      const collectionData = collectionsResponse.data || [];
      // Extract collection names - data can be string[] or CollectionData[]
      const collectionNames: string[] = collectionData.map((item: any) =>
        typeof item === 'string' ? item : item.name
      );

      let totalDocuments = 0;
      const collectionStats: Record<string, any> = {};

      for (const name of collectionNames) {
        try {
          const stats = await client.getCollectionStatistics({ collection_name: name });
          const rowCount = parseInt(stats.data?.row_count || '0');
          totalDocuments += rowCount;
          collectionStats[name] = {
            row_count: rowCount,
            data_size: stats.data?.data_size || 'unknown'
          };
        } catch (err) {
          collectionStats[name] = { error: 'Failed to get stats' };
        }
      }

      reply.send({
        stats: collectionStats,
        total_documents: totalDocuments,
        collections_count: collectionNames.length,
        health: {
          isHealthy: health.isHealthy,
          reasons: health.reasons || []
        },
        connection: {
          host: process.env.MILVUS_HOST,
          port: process.env.MILVUS_PORT
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch milvus stats');
      reply.code(500).send({ error: 'Failed to fetch milvus stats' });
    }
  });

  // GET /milvus/collections/:name/sample — return sample records from a collection
  fastify.get<{ Params: { name: string } }>('/milvus/collections/:name/sample', async (request, reply): Promise<void> => {
    try {
      const client = getMilvusClient();
      if (!client) {
        reply.code(503).send({ error: 'Milvus not configured' });
        return;
      }

      const collectionName = request.params.name;

      // Get collection schema
      const describe = await client.describeCollection({ collection_name: collectionName });
      const fields = describe.schema?.fields?.map((f: any) => ({
        name: f.name,
        data_type: f.data_type,
        is_primary: f.is_primary_key,
        description: f.description,
        dim: f.type_params?.find((p: any) => p.key === 'dim')?.value,
      })) || [];

      // Query sample records (exclude vector fields for readability)
      const outputFields = fields
        .filter((f: any) => f.data_type !== 101 && f.data_type !== 102) // Skip FloatVector and BinaryVector
        .map((f: any) => f.name);

      let records: any[] = [];
      try {
        const queryResult = await client.query({
          collection_name: collectionName,
          output_fields: outputFields.length > 0 ? outputFields : undefined,
          limit: 10,
        });
        records = queryResult.data || [];
      } catch (queryErr: any) {
        // Some collections may need loading first
        logger.warn({ err: queryErr.message, collection: collectionName }, 'Failed to query sample — collection may need loading');
      }

      reply.send({
        collection: collectionName,
        schema: fields,
        sample_records: records,
        record_count: records.length,
      });
    } catch (error: any) {
      logger.error({ error }, 'Failed to fetch collection sample');
      reply.code(500).send({ error: error.message || 'Failed to fetch collection sample' });
    }
  });

  // REMOVED: /audit-logs/sessions stub - now handled by admin-audit-logs.ts at /api/admin/audit-logs/sessions

  // DEBUG: Force MCP tool indexing
  fastify.post('/debug/force-index-mcp-tools', async (request, reply) => {
    try {
      if (!global.toolSemanticCache) {
        return reply.status(503).send({ error: 'Tool semantic cache not initialized' });
      }

      const result = await global.toolSemanticCache.forceIndexToolsWithDebugging();

      return reply.send({
        success: result.success,
        message: result.success ? 'MCP tools force indexed successfully' : 'MCP indexing failed',
        stats: result.stats,
        error: result.error
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to force index MCP tools');
      return reply.code(500).send({
        success: false,
        error: 'Failed to force index MCP tools',
        message: error.message
      });
    }
  });

  // DEBUG: Test tool calling with MCP Proxy
  fastify.post('/debug/test-tool-calling', async (request, reply) => {
    try {
      const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:3100';

      // Get available tools from MCP Proxy
      const toolsResponse = await fetch(`${mcpProxyUrl}/tools`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      const toolsData = await toolsResponse.json();
      const tools = toolsData.tools || [];

      const azureTools = tools.filter((t: any) => t.name?.includes('subscription') || t.name?.includes('azure'));

      fastify.log.info({
        toolsCount: azureTools.length,
        toolNames: azureTools.map((t: any) => t.name),
        mcpProxyUrl
      }, 'Testing MCP Proxy tool calling');

      reply.send({
        success: true,
        mcpProxyUrl,
        availableTools: azureTools.length,
        toolNames: azureTools.map((t: any) => t.name),
        note: 'Tool calling uses MCP Proxy. Use provider SDK with MCP tools for actual execution.'
      });
    } catch (error: any) {
      fastify.log.error({ error }, 'Failed to test tool calling');
      reply.code(500).send({
        success: false,
        error: 'Failed to test tool calling',
        message: error.message
      });
    }
  });

  // Register LLM Provider routes
  // IMPORTANT: Use the singleton ProviderManager instance from server.ts startup
  // This ensures admin CRUD operations reload the same instance used by chat
  try {
    // Get singleton providerManager set during startup
    const globalProviderManager = getProviderManager();

    if (globalProviderManager) {
      await fastify.register(llmProviderRoutes, {
        providerManager: globalProviderManager
      });
      logger.info('LLM Provider routes registered with singleton providerManager (chat will see changes)');
    } else {
      // Fallback: create local instance if singleton not available (shouldn't happen)
      logger.warn('Global providerManager not found - creating local instance (admin changes may not affect chat!)');
      const configService = new ProviderConfigService(loggers.admin);
      const config = await configService.loadProviderConfig();
      const providerManager = new ProviderManager(loggers.admin, config);
      await providerManager.initialize();

      await fastify.register(llmProviderRoutes, {
        providerManager
      });
    }

    logger.info('LLM Provider routes registered successfully');
  } catch (error) {
    logger.error({
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error)
    }, 'Failed to initialize LLM Provider routes');
    // Don't throw - allow admin routes to work even if provider manager fails
  }

  // Admin AI assistant — SSE handler for the in-product help bar.
  // Mounted directly because the handler is the route, not a plugin.
  try {
    const { adminAiAskHandler } = await import('./admin/ai/ask.handler.js');
    fastify.post('/ai/ask', adminAiAskHandler);
    logger.info('Admin AI assistant route registered at /api/admin/ai/ask');
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) },
      'Failed to register admin AI ask handler');
  }

  // Register Multi-Model Configuration routes
  try {
    await fastify.register(multiModelRoutes, {
      prefix: '' // Routes already include /multi-model prefix
    });

    logger.info('Multi-Model Configuration routes registered successfully');
  } catch (error) {
    logger.error({
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error)
    }, 'Failed to initialize Multi-Model routes');
    // Don't throw - allow admin routes to work even if multi-model fails
  }

  // Register Router Tuning routes
  try {
    await fastify.register(routerTuningRoutes, {
      prefix: '' // Routes already include /router-tuning prefix
    });

    logger.info('Router Tuning routes registered successfully');
  } catch (error) {
    logger.error({
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error)
    }, 'Failed to initialize Router Tuning routes');
    // Don't throw - allow admin routes to work even if router tuning fails
  }

  // Register Chat Loop Config routes — admin-tunable max_turns + future
  // chat-loop knobs (SoT: admin.system_configuration row keyed `chat_loop`).
  // Surfaced at /admin#chat-loop in the admin UI.
  try {
    await fastify.register(chatLoopConfigRoutes, {
      prefix: '' // Routes already include /chat-loop-config prefix
    });
    logger.info('Chat Loop Config routes registered successfully');
  } catch (error) {
    logger.error({
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error)
    }, 'Failed to initialize Chat Loop Config routes');
    // Don't throw - allow admin routes to work even if chat-loop-config fails
  }

  // V3 Phase 5 — EnrichedTool registry (per-T1-tool metadata SoT).
  // Drives the V3 envelope splitter outputTemplate + truncate_summary;
  // admin can edit/disable rows live via /admin#enriched-tools.
  try {
    await fastify.register(enrichedToolsRoutes, {
      prefix: '' // Routes already include /enriched-tools prefix
    });
    logger.info('EnrichedTool routes registered successfully');
  } catch (error) {
    logger.error({
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : String(error),
    }, 'Failed to initialize EnrichedTool routes');
    // Don't throw - additive, V3 falls back to default outputTemplate (none).
  }

  // ============================================================================
  // Context Management Routes (Silent Compaction)
  // ============================================================================

  /**
   * Get context usage for a specific session
   * GET /api/admin/context/:sessionId
   */
  fastify.get('/context/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    try {
      const usage = await contextManagementService.getContextUsage(sessionId);
      return reply.send({ usage });
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to get context usage');
      return reply.code(500).send({ error: 'Failed to get context usage' });
    }
  });

  /**
   * Get all sessions needing compaction
   * GET /api/admin/context/sessions/needing-compaction
   */
  fastify.get('/context/sessions/needing-compaction', async (request, reply) => {
    try {
      const sessions = await contextManagementService.getSessionsNeedingCompaction();

      // Enrich with user info
      const sessionIds = sessions.map(s => s.sessionId);
      const dbSessions = await prisma.chatSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, user_id: true },
      });

      const userIds = [...new Set(dbSessions.map(s => s.user_id))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true },
      });

      const sessionUserMap = new Map(dbSessions.map(s => [s.id, s.user_id]));
      const userMap = new Map(users.map(u => [u.id, u]));

      const enriched = sessions.map(s => {
        const userId = sessionUserMap.get(s.sessionId);
        const user = userId ? userMap.get(userId) : null;
        return {
          ...s,
          userId,
          userEmail: user?.email || 'Unknown',
          userName: user?.name || user?.email || 'Unknown',
        };
      });

      return reply.send({
        sessions: enriched,
        count: enriched.length,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get sessions needing compaction');
      return reply.code(500).send({ error: 'Failed to get sessions' });
    }
  });

  /**
   * Trigger manual compaction for a session
   * POST /api/admin/context/:sessionId/compact
   */
  fastify.post('/context/:sessionId/compact', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };

    try {
      const result = await contextManagementService.compactContext(sessionId);

      if (!result) {
        return reply.send({
          success: true,
          message: 'Session does not need compaction or compaction already in progress',
        });
      }

      return reply.send({
        success: true,
        result,
      });
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to compact context');
      return reply.code(500).send({ error: 'Failed to compact context' });
    }
  });

  /**
   * Get context limits configuration
   * GET /api/admin/context/limits
   */
  fastify.get('/context/limits', async (request, reply) => {
    // Import MODEL_CONTEXT_LIMITS from the service
    const { MODEL_CONTEXT_LIMITS } = await import('../services/ContextManagementService.js');

    return reply.send({
      limits: MODEL_CONTEXT_LIMITS,
      thresholds: {
        warning: 0.7,
        trigger: 0.85,
        aggressive: 0.95,
      },
    });
  });

};