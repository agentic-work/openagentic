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
 * MCP Tools Cache Management API
 *
 * Provides admin interface for monitoring and managing the MCP tools cache in Milvus.
 * Shows indexing status, tool counts per server, and allows manual reindexing.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { MCPToolIndexingService } from '../services/MCPToolIndexingService.js';
import { getRedisClient } from '../utils/redis-client.js';
import axios from 'axios';

export default async function adminMCPToolsRoutes(fastify: FastifyInstance) {

  /**
   * GET /status
   * Get MCP tools cache status including last index time and tool counts
   */
  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const redis = getRedisClient();
      const milvus = new MilvusClient({
        address: `${process.env.MILVUS_HOST || 'openagentic-milvus'}:${process.env.MILVUS_PORT || '19530'}`
      });

      // Get indexing metadata from Redis
      const lastIndexTime = await redis.get('mcp:tools:last_index_time');
      const lastIndexSuccess = await redis.get('mcp:tools:last_index_success');
      const lastIndexError = await redis.get('mcp:tools:last_index_error');
      const totalToolsIndexed = await redis.get('mcp:tools:total_indexed');

      // Get tool counts by server from Redis
      const serverKeys = await redis.keys('mcp:tools:server:*:count');
      const serverCounts: Record<string, number> = {};

      for (const key of serverKeys) {
        const serverId = key.replace('mcp:tools:server:', '').replace(':count', '');
        const count = await redis.get(key);
        serverCounts[serverId] = parseInt(count || '0', 10);
      }

      // Get Milvus collection stats
      let milvusStats = null;
      try {
        const hasCollection = await milvus.hasCollection({ collection_name: 'mcp_tools_cache' });

        if (hasCollection.value) {
          const collectionInfo = await milvus.getCollectionStatistics({ collection_name: 'mcp_tools_cache' });
          milvusStats = {
            exists: true,
            rowCount: parseInt(collectionInfo.data.row_count || '0', 10)
          };
        } else {
          milvusStats = {
            exists: false,
            rowCount: 0
          };
        }
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to get Milvus stats');
        milvusStats = {
          exists: false,
          rowCount: 0,
          error: error.message
        };
      }

      // Get MCP Proxy tools for comparison
      let mcpProxyToolsCount = 0;
      let mcpProxyServers: Array<{serverId: string, toolCount: number}> = [];

      try {
        const mcpProxyUrl = process.env.MCP_PROXY_URL ||
                          `${process.env.MCP_PROXY_PROTOCOL || 'http'}://${process.env.MCP_PROXY_HOST || 'mcp-proxy'}:${process.env.MCP_PROXY_PORT || '3100'}`;

        const response = await axios.get(`${mcpProxyUrl}/tools`, {
          timeout: 30000, // 30 seconds for large tool list (900KB+)
          maxContentLength: 2000000, // 2MB max
          maxBodyLength: 2000000
        });

        if (response.data && Array.isArray(response.data)) {
          mcpProxyToolsCount = response.data.length;

          // Group by server
          const byServer: Record<string, number> = {};
          for (const tool of response.data) {
            const serverId = tool.serverId || 'unknown';
            byServer[serverId] = (byServer[serverId] || 0) + 1;
          }

          mcpProxyServers = Object.entries(byServer).map(([serverId, count]) => ({
            serverId,
            toolCount: count
          }));
        }
      } catch (error: any) {
        logger.warn({ error: error.message }, 'Failed to fetch tools from MCP Proxy');
      }

      return reply.send({
        status: 'success',
        indexing: {
          lastIndexTime: lastIndexTime ? new Date(parseInt(lastIndexTime, 10)) : null,
          lastIndexSuccess: lastIndexSuccess === 'true',
          lastIndexError: lastIndexError || null,
          totalToolsIndexed: parseInt(totalToolsIndexed || '0', 10)
        },
        milvus: milvusStats,
        redis: {
          serverCounts,
          totalServers: Object.keys(serverCounts).length
        },
        mcpProxy: {
          totalTools: mcpProxyToolsCount,
          servers: mcpProxyServers
        },
        inSync: milvusStats?.rowCount === mcpProxyToolsCount && mcpProxyToolsCount > 0
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get MCP tools status');
      return reply.code(500).send({
        status: 'error',
        error: 'Failed to get MCP tools status',
        message: error.message
      });
    }
  });

  /**
   * POST /reindex
   * Trigger manual reindexing of all MCP tools
   */
  fastify.post('/reindex', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const redis = getRedisClient();
      const milvus = new MilvusClient({
        address: `${process.env.MILVUS_HOST || 'openagentic-milvus'}:${process.env.MILVUS_PORT || '19530'}`
      });

      logger.info('[ADMIN_MCP_TOOLS] Starting manual reindex of MCP tools');

      // Create indexing service with Prisma for PostgreSQL pgvector indexing
      const prisma = fastify.prisma;
      const indexingService = new MCPToolIndexingService(logger, milvus, redis, prisma);

      // Store start time
      const startTime = Date.now();
      await redis.set('mcp:tools:last_index_time', startTime.toString());
      await redis.set('mcp:tools:last_index_success', 'false');
      await redis.del('mcp:tools:last_index_error');

      try {
        // Run indexing — pass forceReindex=true so the admin button always
        // re-indexes even when the cache says "recently indexed". The whole
        // point of clicking reindex is to bypass the cache.
        await indexingService.indexAllMCPTools(true);

        // Mark success
        await redis.set('mcp:tools:last_index_success', 'true');
        await redis.set('mcp:tools:last_index_time', Date.now().toString());

        // Get final count
        const hasCollection = await milvus.hasCollection({ collection_name: 'mcp_tools_cache' });
        let toolCount = 0;

        if (hasCollection.value) {
          const collectionInfo = await milvus.getCollectionStatistics({ collection_name: 'mcp_tools_cache' });
          toolCount = parseInt(collectionInfo.data.row_count || '0', 10);
        }

        await redis.set('mcp:tools:total_indexed', toolCount.toString());

        logger.info({
          toolCount,
          duration: Date.now() - startTime
        }, '[ADMIN_MCP_TOOLS] Manual reindex completed successfully');

        return reply.send({
          status: 'success',
          message: 'MCP tools reindexed successfully',
          toolsIndexed: toolCount,
          duration: Date.now() - startTime
        });

      } catch (indexError: any) {
        // Store error
        await redis.set('mcp:tools:last_index_success', 'false');
        await redis.set('mcp:tools:last_index_error', indexError.message);

        logger.error({
          error: indexError.message,
          stack: indexError.stack
        }, '[ADMIN_MCP_TOOLS] Manual reindex failed');

        throw indexError;
      }

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to reindex MCP tools');
      return reply.code(500).send({
        status: 'error',
        error: 'Failed to reindex MCP tools',
        message: error.message
      });
    }
  });
}
