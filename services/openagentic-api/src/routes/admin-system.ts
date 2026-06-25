/**
 * Admin System Routes
 * Backend endpoints for Admin Portal system monitoring
 * Connects to PostgreSQL, Redis, Milvus, and MCP Proxy for real-time data
 */

import { FastifyPluginAsync } from 'fastify';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import axios from 'axios';
import { getRedisClient } from '../utils/redis-client.js';
import { prisma } from '../utils/prisma.js';

// Initialize Milvus client for admin operations
let milvusClient: MilvusClient | null = null;
const getMilvusClient = () => {
  if (!milvusClient) {
    const milvusHost = process.env.MILVUS_HOST || 'openagentic-milvus';
    const milvusPort = process.env.MILVUS_PORT || '19530';
    milvusClient = new MilvusClient({
      address: `${milvusHost}:${milvusPort}`,
      timeout: 10000
    });
  }
  return milvusClient;
};

export const adminSystemRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Helper function to format uptime
  function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);
    
    return parts.join(' ');
  }

  /**
   * GET /api/admin/system/status
   * System status with uptime, version, and component health
   * UAT Requirements: P0-002, P0-006, UC-050
   */
  fastify.get('/status', async (request, reply) => {
    const startTime = process.hrtime.bigint();
    
    try {
      const results = {
        status: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
        uptime: process.uptime(),
        uptimeFormatted: formatUptime(process.uptime()),
        version: process.env.API_VERSION || '1.0.0',
        buildDate: process.env.BUILD_DATE || new Date().toISOString(),
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
        components: {} as Record<string, { status: string; latency?: number; error?: string }>,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          percentage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
        }
      };

      // Check PostgreSQL
      try {
        const dbStart = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        results.components.database = { status: 'healthy', latency: Date.now() - dbStart };
      } catch (error: any) {
        results.components.database = { status: 'unhealthy', error: error.message };
        results.status = 'degraded';
      }

      // Check Redis
      try {
        const redisStart = Date.now();
        const redisClient = getRedisClient();
        const isAlive = await redisClient.ping();
        results.components.redis = { 
          status: isAlive ? 'healthy' : 'unhealthy', 
          latency: Date.now() - redisStart 
        };
        if (!isAlive) results.status = 'degraded';
      } catch (error: any) {
        results.components.redis = { status: 'unhealthy', error: error.message };
        results.status = 'degraded';
      }

      // Check Milvus
      try {
        const milvusStart = Date.now();
        const client = getMilvusClient();
        await client.listCollections();
        results.components.milvus = { status: 'healthy', latency: Date.now() - milvusStart };
      } catch (error: any) {
        results.components.milvus = { status: 'unhealthy', error: error.message };
        results.status = 'degraded';
      }

      // Check MCP Proxy
      try {
        const mcpStart = Date.now();
        const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
        const mcpResponse = await axios.get(`${mcpProxyUrl}/health`, { timeout: 5000 });
        results.components.mcpProxy = { 
          status: mcpResponse.status === 200 ? 'healthy' : 'degraded',
          latency: Date.now() - mcpStart 
        };
      } catch (error: any) {
        results.components.mcpProxy = { status: 'unhealthy', error: error.message };
        results.status = 'degraded';
      }

      // Calculate total response time
      const endTime = process.hrtime.bigint();
      const responseTime = Number(endTime - startTime) / 1000000; // Convert to ms

      return reply.send({
        ...results,
        responseTime: Math.round(responseTime * 100) / 100
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get system status');
      return reply.code(500).send({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * Get MCP Servers from MCP Proxy
   */
  fastify.get('/mcp-servers', async (request, reply) => {
    try {
      const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

      // Get MCP tools from MCP Proxy (centralized management)
      const toolsResponse = await axios.get(`${mcpProxyUrl}/tools`, {
        timeout: 10000
      });

      // MCP Proxy returns { tools: [...] }
      const tools = toolsResponse.data.tools || [];

      // Group tools by server (MCP server name is prefix before first underscore or dash)
      const serverMap = new Map();

      tools.forEach((tool: any) => {
        const toolName = tool.name || '';
        const serverName = toolName.split('-')[0] || toolName.split('_')[0] || 'unknown';

        if (!serverMap.has(serverName)) {
          serverMap.set(serverName, {
            id: serverName,
            name: serverName,
            enabled: true,
            status: 'running',
            toolCount: 0,
            tools: []
          });
        }

        const server = serverMap.get(serverName);
        server.toolCount++;
        server.tools.push({
          name: tool.name,
          description: tool.description
        });
      });

      const servers = Array.from(serverMap.values());

      return reply.send({
        servers,
        totalServers: servers.length,
        totalTools: tools.length
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch MCP servers');
      return reply.code(500).send({
        error: 'Failed to fetch MCP servers',
        details: error.message
      });
    }
  });

  /**
   * Get Milvus Collections - Uses Node.js Milvus SDK for real data
   */
  fastify.get('/milvus/collections', async (request, reply) => {
    try {
      const client = getMilvusClient();

      // List all collections using SDK
      const listResult = await client.listCollections();

      if (listResult.status.error_code !== 'Success') {
        throw new Error(`Failed to list collections: ${listResult.status.reason}`);
      }

      // Get detailed info for each collection
      const collections = await Promise.all(
        listResult.data.map(async (collectionInfo: any) => {
          const collectionName = collectionInfo.name;
          let rowCount = 0;
          let description = '';
          let indexType = 'N/A';
          let metricType = 'N/A';
          let dimension = 0;

          try {
            // Get collection statistics
            const statsResult = await client.getCollectionStatistics({
              collection_name: collectionName
            });
            if (statsResult.status.error_code === 'Success') {
              rowCount = Number.parseInt(statsResult.data.row_count || '0', 10);
            }

            // Get collection schema for description
            const descResult = await client.describeCollection({
              collection_name: collectionName
            });
            if (descResult.status.error_code === 'Success') {
              description = descResult.schema?.description || '';
              // Find index info from fields
              const vectorField = descResult.schema?.fields?.find(
                (f: any) => f.data_type === 'FloatVector' || f.data_type === 101
              );
              if (vectorField) {
                const indexParams = vectorField.index_params as any;
                indexType = indexParams?.index_type || 'HNSW';
                metricType = indexParams?.metric_type || 'COSINE';
                // Get dimension from type_params
                const typeParams = vectorField.type_params as any;
                dimension = typeParams?.dim ? Number.parseInt(typeParams.dim, 10) : 0;
              }
            }
          } catch (err) {
            logger.debug({ error: err, collectionName }, 'Failed to get collection details');
          }

          return {
            name: collectionName,
            description: description || `Milvus collection: ${collectionName}`,
            rowCount,
            dimension,
            indexType,
            metricType,
            status: 'available',
            createdAt: collectionInfo.timestamp ? new Date(collectionInfo.timestamp) : null
          };
        })
      );

      return reply.send({
        collections,
        totalCollections: collections.length,
        totalVectors: collections.reduce((sum, c) => sum + c.rowCount, 0),
        milvusStatus: 'connected'
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch Milvus collections');

      // Return fallback with error status
      return reply.send({
        collections: [],
        totalCollections: 0,
        totalVectors: 0,
        milvusStatus: 'error',
        error: error.message
      });
    }
  });

  /**
   * Get Redis Stats - Uses unified Redis client singleton
   */
  fastify.get('/redis/stats', async (request, reply) => {
    try {
      const redisClient = getRedisClient();

      if (!redisClient.isConnected()) {
        return reply.send({
          status: 'unavailable',
          note: 'Redis client not connected. Use Redis Commander for manual inspection.',
          commanderUrl: '/redis-commander/'
        });
      }

      // Ping to verify connection
      const isAlive = await redisClient.ping();
      if (!isAlive) {
        return reply.send({
          status: 'unavailable',
          note: 'Redis ping failed. Use Redis Commander for manual inspection.',
          commanderUrl: '/redis-commander/'
        });
      }

      // Get keys count (approximate)
      const keys = await redisClient.keys('*');
      const keyCount = keys.length;

      return reply.send({
        status: 'connected',
        keyCount,
        note: 'Basic stats available. Use Redis Commander for detailed metrics.',
        commanderUrl: '/redis-commander/'
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch Redis stats');
      return reply.send({
        status: 'error',
        error: error.message,
        note: 'Use Redis Commander for manual inspection.',
        commanderUrl: '/redis-commander/'
      });
    }
  });

  /**
   * Get Dashboard Overview combining all sources
   */
  fastify.get('/dashboard/overview', async (request, reply) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get data from PostgreSQL
      const [userCount, sessionCount, messageCount, mcpServerCount] = await Promise.all([
        prisma.user.count(),
        prisma.chatSession.count({ where: { deleted_at: null } }),
        prisma.chatMessage.count({ where: { deleted_at: null } }),
        prisma.mCPServerConfig.count({ where: { enabled: true } })
      ]);

      // Get active sessions (updated in last 24 hours)
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const activeSessions = await prisma.chatSession.count({
        where: {
          updated_at: { gte: yesterday },
          deleted_at: null
        }
      });

      // Get MCP tool count from MCP Proxy
      let mcpToolCount = 0;
      try {
        const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:3100';

        const toolsResponse = await axios.get(`${mcpProxyUrl}/tools`, {
          timeout: 5000
        });
        // MCP Proxy returns { tools: [...] }
        mcpToolCount = toolsResponse.data.tools?.length || 0;
      } catch (error) {
        logger.warn('Failed to fetch MCP tool count from MCP Proxy, using fallback');
      }

      return reply.send({
        users: {
          total: userCount,
          active: activeSessions
        },
        sessions: {
          total: sessionCount,
          active: activeSessions
        },
        messages: {
          total: messageCount
        },
        mcpServers: {
          configured: mcpServerCount,
          tools: mcpToolCount
        },
        systemHealth: 'online'
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch dashboard overview');
      return reply.code(500).send({
        error: 'Failed to fetch dashboard overview',
        details: error.message
      });
    }
  });

};
