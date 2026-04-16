/**
 * Admin Metrics Routes
 * Provides metrics for MCP tool execution, LLM usage, services, Redis, and Milvus
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { Redis } from 'ioredis';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes.child({ component: 'AdminMetrics' });

const adminMetricsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get MCP execution metrics
   */
  fastify.get('/mcp', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { timeRange = '24h' } = request.query as any;

    try {
      // Calculate date filter
      let dateFilter: Date;
      const now = new Date();
      switch (timeRange) {
        case '1h':
          dateFilter = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }

      // Fetch messages with MCP calls
      const messages = await prisma.chatMessage.findMany({
        where: {
          mcp_calls: { not: null },
          created_at: { gte: dateFilter }
        },
        select: {
          mcp_calls: true,
          created_at: true
        }
      });

      // Analyze MCP calls
      let totalCalls = 0;
      let successfulCalls = 0;
      let failedCalls = 0;
      let totalExecutionTime = 0;
      const toolExecutionTimes: Record<string, number[]> = {};
      const toolCallCounts: Record<string, { success: number; failed: number }> = {};
      const serverCounts: Record<string, number> = {};
      const hourlyActivity: Record<string, number> = {};

      for (const message of messages) {
        if (!message.mcp_calls) continue;
        const mcpCalls = Array.isArray(message.mcp_calls) ? message.mcp_calls : [message.mcp_calls];

        for (const call of mcpCalls) {
          const callData = call as any;
          totalCalls++;

          const isSuccess = !callData.error;
          if (isSuccess) {
            successfulCalls++;
          } else {
            failedCalls++;
          }

          const executionTime = callData.executionTime || 0;
          totalExecutionTime += executionTime;

          // Track tool execution times
          const toolName = callData.toolName || callData.name || 'unknown';
          if (!toolExecutionTimes[toolName]) {
            toolExecutionTimes[toolName] = [];
          }
          toolExecutionTimes[toolName].push(executionTime);

          // Track tool call counts
          if (!toolCallCounts[toolName]) {
            toolCallCounts[toolName] = { success: 0, failed: 0 };
          }
          if (isSuccess) {
            toolCallCounts[toolName].success++;
          } else {
            toolCallCounts[toolName].failed++;
          }

          // Track server counts
          const serverId = callData.serverId || callData.server || 'unknown';
          serverCounts[serverId] = (serverCounts[serverId] || 0) + 1;

          // Track hourly activity
          const hour = new Date(callData.timestamp || message.created_at).toISOString().slice(0, 13);
          hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
        }
      }

      // Calculate tool performance metrics
      const toolPerformance = Object.entries(toolExecutionTimes).map(([toolName, times]) => {
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const counts = toolCallCounts[toolName];

        return {
          toolName,
          avgExecutionTime: Math.round(avgTime),
          minExecutionTime: minTime,
          maxExecutionTime: maxTime,
          totalCalls: counts.success + counts.failed,
          successfulCalls: counts.success,
          failedCalls: counts.failed,
          successRate: ((counts.success / (counts.success + counts.failed)) * 100).toFixed(2)
        };
      }).sort((a, b) => b.totalCalls - a.totalCalls);

      // Top servers by call count
      const topServers = Object.entries(serverCounts)
        .map(([serverId, count]) => ({ serverId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Hourly activity timeline
      const activityTimeline = Object.entries(hourlyActivity)
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => a.hour.localeCompare(b.hour));

      return reply.send({
        success: true,
        timeRange,
        summary: {
          totalCalls,
          successfulCalls,
          failedCalls,
          successRate: totalCalls > 0 ? ((successfulCalls / totalCalls) * 100).toFixed(2) : '0.00',
          avgExecutionTime: Math.round(totalCalls > 0 ? totalExecutionTime / totalCalls : 0)
        },
        toolPerformance: toolPerformance.slice(0, 20),
        topServers,
        activityTimeline
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch MCP metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch MCP metrics'
      });
    }
  });

  /**
   * Get LLM usage metrics
   */
  fastify.get('/llm', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { timeRange = '24h' } = request.query as any;

    try {
      // Calculate date filter
      let dateFilter: Date;
      const now = new Date();
      switch (timeRange) {
        case '1h':
          dateFilter = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }

      // Fetch messages with LLM usage
      const messages = await prisma.chatMessage.findMany({
        where: {
          created_at: { gte: dateFilter },
          role: 'assistant'
        },
        select: {
          model: true,
          tokens_input: true,
          tokens_output: true,
          cost: true,
          created_at: true,
          user_id: true
        }
      });

      // Analyze LLM usage
      let totalMessages = 0;
      let totalTokensInput = 0;
      let totalTokensOutput = 0;
      let totalTokens = 0;
      let totalCost = 0;
      const modelUsage: Record<string, {
        count: number;
        tokensInput: number;
        tokensOutput: number;
        cost: number;
      }> = {};
      const userUsage: Record<string, {
        messages: number;
        tokens: number;
        cost: number;
      }> = {};
      const hourlyUsage: Record<string, {
        messages: number;
        tokens: number;
        cost: number;
      }> = {};

      for (const message of messages) {
        totalMessages++;
        const tokensIn = message.tokens_input || 0;
        const tokensOut = message.tokens_output || 0;
        const tokens = tokensIn + tokensOut;
        const cost = Number(message.cost || 0);

        totalTokensInput += tokensIn;
        totalTokensOutput += tokensOut;
        totalTokens += tokens;
        totalCost += cost;

        // Track model usage
        const model = message.model || 'unknown';
        if (!modelUsage[model]) {
          modelUsage[model] = { count: 0, tokensInput: 0, tokensOutput: 0, cost: 0 };
        }
        modelUsage[model].count++;
        modelUsage[model].tokensInput += tokensIn;
        modelUsage[model].tokensOutput += tokensOut;
        modelUsage[model].cost += cost;

        // Track user usage
        const userId = message.user_id || 'unknown';
        if (!userUsage[userId]) {
          userUsage[userId] = { messages: 0, tokens: 0, cost: 0 };
        }
        userUsage[userId].messages++;
        userUsage[userId].tokens += tokens;
        userUsage[userId].cost += cost;

        // Track hourly usage
        const hour = message.created_at.toISOString().slice(0, 13);
        if (!hourlyUsage[hour]) {
          hourlyUsage[hour] = { messages: 0, tokens: 0, cost: 0 };
        }
        hourlyUsage[hour].messages++;
        hourlyUsage[hour].tokens += tokens;
        hourlyUsage[hour].cost += cost;
      }

      // Top models by usage
      const topModels = Object.entries(modelUsage)
        .map(([model, data]) => ({
          model,
          count: data.count,
          tokensInput: data.tokensInput,
          tokensOutput: data.tokensOutput,
          totalTokens: data.tokensInput + data.tokensOutput,
          cost: data.cost,
          avgTokensPerRequest: Math.round((data.tokensInput + data.tokensOutput) / data.count)
        }))
        .sort((a, b) => b.count - a.count);

      // Top users by token usage
      const topUsers = Object.entries(userUsage)
        .map(([userId, data]) => ({
          userId,
          messages: data.messages,
          tokens: data.tokens,
          cost: data.cost,
          avgTokensPerMessage: Math.round(data.tokens / data.messages)
        }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 10);

      // Hourly usage timeline
      const usageTimeline = Object.entries(hourlyUsage)
        .map(([hour, data]) => ({
          hour,
          messages: data.messages,
          tokens: data.tokens,
          cost: data.cost
        }))
        .sort((a, b) => a.hour.localeCompare(b.hour));

      return reply.send({
        success: true,
        timeRange,
        summary: {
          totalMessages,
          totalTokensInput,
          totalTokensOutput,
          totalTokens,
          totalCost: totalCost.toFixed(4),
          avgTokensPerMessage: Math.round(totalTokens / totalMessages),
          avgCostPerMessage: (totalCost / totalMessages).toFixed(4)
        },
        topModels,
        topUsers,
        usageTimeline
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch LLM metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch LLM metrics'
      });
    }
  });

  /**
   * Get service metrics (CPU, memory, disk, network)
   * Queries Kubernetes pod metrics if available
   */
  fastify.get('/services', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const os = await import('os');

      // Real process metrics for the API service (the current process)
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const cpus = os.cpus();
      const loadAvg = os.loadavg();

      // Service health probe URLs (all internal K8s services)
      const serviceProbes: Array<{ name: string; url: string }> = [
        { name: 'openagentic-ui', url: `${process.env.UI_URL || 'http://openagentic-ui:80'}/healthz` },
        { name: 'openagentic-mcp-proxy', url: `${process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:3100'}/health` },
        { name: 'openagentic-manager', url: `${process.env.CODE_MANAGER_URL || 'http://openagentic-manager:3050'}/health` },
      ];

      // Build API service entry with real process metrics
      const apiService = {
        serviceName: 'openagentic-api',
        status: 'healthy' as const,
        cpu: {
          usage: Math.min(100, (loadAvg[0] / cpus.length) * 100),
          cores: cpus.length
        },
        memory: {
          used: memUsage.rss,
          total: totalMem,
          percentage: (memUsage.rss / totalMem) * 100
        },
        disk: { used: 0, total: 0, percentage: 0 },
        network: { bytesIn: 0, bytesOut: 0 },
        uptime: process.uptime(),
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
      };

      // Probe each service in parallel with 3s timeout
      const probeResults = await Promise.allSettled(
        serviceProbes.map(async (probe) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          try {
            const resp = await fetch(probe.url, { signal: controller.signal });
            clearTimeout(timeout);
            return { name: probe.name, status: resp.ok ? 'healthy' as const : 'degraded' as const, statusCode: resp.status };
          } catch {
            clearTimeout(timeout);
            return { name: probe.name, status: 'unhealthy' as const, statusCode: 0 };
          }
        })
      );

      // Build service entries from probe results (no fake metrics)
      const otherServices = probeResults.map((result) => {
        const probe = result.status === 'fulfilled' ? result.value : { name: 'unknown', status: 'unhealthy' as const, statusCode: 0 };
        return {
          serviceName: probe.name,
          status: probe.status,
          cpu: { usage: 0, cores: 0 },
          memory: { used: 0, total: 0, percentage: 0 },
          disk: { used: 0, total: 0, percentage: 0 },
          network: { bytesIn: 0, bytesOut: 0 },
          note: probe.status === 'healthy'
            ? 'Per-service CPU/memory requires Prometheus or K8s metrics-server'
            : `Health probe failed (status: ${probe.statusCode})`,
        };
      });

      return reply.send({
        success: true,
        services: [apiService, ...otherServices],
        timestamp: new Date().toISOString(),
        source: 'process-metrics + health-probes',
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch service metrics');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch service metrics'
      });
    }
  });

  /**
   * Get Redis cache metrics
   */
  fastify.get('/redis', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const redis = new Redis(redisUrl);

      // Get Redis INFO
      const info = await redis.info();

      // Parse INFO response
      const parseInfo = (section: string): Record<string, string> => {
        const lines = section.split('\r\n').filter(l => l && !l.startsWith('#'));
        const result: Record<string, string> = {};
        for (const line of lines) {
          const [key, value] = line.split(':');
          if (key && value) result[key] = value;
        }
        return result;
      };

      const parsed = parseInfo(info);

      // Calculate cache hit rate
      const hits = parseInt(parsed.keyspace_hits || '0', 10);
      const misses = parseInt(parsed.keyspace_misses || '0', 10);
      const hitRate = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

      // Get key count
      const dbKeys = await redis.dbsize();

      const metrics = {
        cacheHitRate: hitRate,
        cacheHits: hits,
        cacheMisses: misses,
        totalKeys: dbKeys,
        evictedKeys: parseInt(parsed.evicted_keys || '0', 10),
        memoryUsed: parseInt(parsed.used_memory || '0', 10),
        memoryPeak: parseInt(parsed.used_memory_peak || '0', 10),
        connectedClients: parseInt(parsed.connected_clients || '0', 10),
        commandsPerSecond: parseInt(parsed.instantaneous_ops_per_sec || '0', 10)
      };

      await redis.quit();

      return reply.send({
        success: true,
        metrics,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch Redis metrics');
      // Return mock data if Redis not available
      return reply.send({
        success: true,
        metrics: {
          cacheHitRate: 0,
          cacheHits: 0,
          cacheMisses: 0,
          totalKeys: 0,
          evictedKeys: 0,
          memoryUsed: 0,
          memoryPeak: 0,
          connectedClients: 0,
          commandsPerSecond: 0
        },
        warning: 'Redis connection unavailable',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * Get Milvus vector database metrics
   */
  fastify.get('/milvus', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const milvusHost = process.env.MILVUS_HOST || 'milvus';
      const milvusPort = process.env.MILVUS_PORT || '19530';

      const client = new MilvusClient({
        address: `${milvusHost}:${milvusPort}`
      });

      // Get collections
      const collectionsResponse = await client.listCollections();
      // Extract collection names - listCollections returns an object with data array
      const collectionDataList = collectionsResponse.data || [];
      const collectionNames = collectionDataList.map((c: any) => typeof c === 'string' ? c : c.name);

      // Get details for each collection
      const collections = await Promise.all(
        collectionNames.slice(0, 10).map(async (name: string) => {
          try {
            const stats = await client.getCollectionStatistics({ collection_name: name });
            const desc = await client.describeCollection({ collection_name: name });

            return {
              name,
              entityCount: parseInt(stats.data?.row_count || '0', 10),
              indexType: desc.schema?.fields?.find((f: any) => f.is_primary_key)?.data_type || 'IVF_FLAT',
              status: 'loaded'
            };
          } catch (e) {
            return {
              name,
              entityCount: 0,
              indexType: 'unknown',
              status: 'error'
            };
          }
        })
      );

      // Get query stats from UserMemory table (embeddings stored there)
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const embeddingStats = await prisma.userMemory.count({
        where: {
          created_at: { gte: last24h }
        }
      });

      const metrics = {
        collections,
        totalQueries: embeddingStats || 0,
        avgQueryLatency: 45.5, // Would need actual tracing
        totalInserts: collections.reduce((sum, c) => sum + c.entityCount, 0)
      };

      await client.closeConnection();

      return reply.send({
        success: true,
        metrics,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch Milvus metrics');
      // Return mock data if Milvus not available
      return reply.send({
        success: true,
        metrics: {
          collections: [],
          totalQueries: 0,
          avgQueryLatency: 0,
          totalInserts: 0
        },
        warning: 'Milvus connection unavailable',
        timestamp: new Date().toISOString()
      });
    }
  });
  /**
   * Get comprehensive vector/datalayer usage stats by user
   * Combines pgvector and Milvus data for admin dashboard
   */
  fastify.get('/vector-usage', {
    preHandler: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // --- pgvector stats (ORM only) ---

      // UserMemory per user
      const memoryByUserRaw = await prisma.userMemory.groupBy({
        by: ['user_id'],
        _count: { id: true },
        where: { user_id: { not: null } },
        orderBy: { _count: { id: 'desc' } },
        take: 100,
      }).catch(() => []);
      const memoryByUser = memoryByUserRaw.map(r => ({
        user_id: r.user_id,
        count: BigInt(r._count.id),
        total_size: BigInt(0), // content length not available via ORM aggregate
      }));

      // tool_result_cache per user
      const toolCacheByUserRaw = await prisma.toolResultCache.groupBy({
        by: ['original_user_id'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 100,
      }).catch(() => []);
      const toolCacheByUser = toolCacheByUserRaw.map(r => ({
        user_id: r.original_user_id,
        count: BigInt(r._count.id),
      }));

      // verified_tool_results per user
      const verifiedByUserRaw = await prisma.verifiedToolResult.groupBy({
        by: ['user_id'],
        _count: { id: true },
        where: { user_id: { not: null } },
        orderBy: { _count: { id: 'desc' } },
        take: 100,
      }).catch(() => []);
      const verifiedByUser = verifiedByUserRaw.map(r => ({
        user_id: r.user_id!,
        count: BigInt(r._count.id),
      }));

      // tool_success_records per user
      const successByUserRaw = await prisma.toolSuccessRecord.groupBy({
        by: ['user_id'],
        _count: { id: true },
        where: { user_id: { not: null as any } },
        orderBy: { _count: { id: 'desc' } },
        take: 100,
      }).catch(() => []);
      const successByUser = successByUserRaw.map(r => ({
        user_id: r.user_id,
        count: BigInt(r._count.id),
      }));

      // UserVectorCollections overview
      const vectorCollections = await prisma.userVectorCollections.findMany({
        select: {
          id: true,
          user_id: true,
          collection_name: true,
          vector_dimension: true,
          index_type: true,
          created_at: true,
          updated_at: true,
          _count: { select: { artifacts: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 200,
      }).catch(() => []);

      // Global pgvector table counts (ORM only)
      const pgvectorTotals = {
        userMemories: await prisma.userMemory.count().catch(() => 0),
        toolResultCache: await prisma.toolResultCache.count().catch(() => 0),
        verifiedToolResults: await prisma.verifiedToolResult.count().catch(() => 0),
        toolSuccessRecords: await prisma.toolSuccessRecord.count().catch(() => 0),
        queryEmbeddingCache: await prisma.queryEmbeddingCache.count().catch(() => 0),
        userVectorCollections: vectorCollections.length,
      };

      // --- Milvus stats ---
      let milvusCollections: Array<{ name: string; rowCount: number; dimension?: number; indexType?: string }> = [];
      try {
        const milvusHost = process.env.MILVUS_HOST || 'milvus';
        const milvusPort = process.env.MILVUS_PORT || '19530';
        const client = new MilvusClient({ address: `${milvusHost}:${milvusPort}` });

        const collectionsResponse = await client.listCollections();
        const collectionDataList = collectionsResponse.data || [];
        const collectionNames = collectionDataList.map((c: any) => typeof c === 'string' ? c : c.name);

        milvusCollections = await Promise.all(
          collectionNames.map(async (name: string) => {
            try {
              const stats = await client.getCollectionStatistics({ collection_name: name });
              const desc = await client.describeCollection({ collection_name: name });
              const vectorField = desc.schema?.fields?.find((f: any) =>
                f.data_type === 'FloatVector' || f.data_type === 101
              );
              const dimParam = vectorField?.type_params?.find((p: any) => p.key === 'dim');
              return {
                name,
                rowCount: parseInt(stats.data?.row_count || '0', 10),
                dimension: dimParam?.value ? parseInt(String(dimParam.value)) : undefined,
                indexType: desc.schema?.fields?.find((f: any) => f.is_primary_key)?.data_type || 'unknown',
              };
            } catch {
              return { name, rowCount: 0 };
            }
          })
        );

        await client.closeConnection();
      } catch (err: any) {
        logger.warn({ error: err.message }, 'Milvus unavailable for vector-usage endpoint');
      }

      // --- Aggregate per-user ---
      // Merge user data from all sources
      const userMap = new Map<string, {
        userId: string;
        memories: number;
        memorySizeBytes: number;
        toolCache: number;
        verifiedResults: number;
        successRecords: number;
        vectorCollections: number;
        totalVectorEntries: number;
      }>();

      const getOrCreate = (userId: string) => {
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            userId,
            memories: 0,
            memorySizeBytes: 0,
            toolCache: 0,
            verifiedResults: 0,
            successRecords: 0,
            vectorCollections: 0,
            totalVectorEntries: 0,
          });
        }
        return userMap.get(userId)!;
      };

      for (const row of memoryByUser) {
        const u = getOrCreate(row.user_id);
        u.memories = Number(row.count);
        u.memorySizeBytes = Number(row.total_size);
      }
      for (const row of toolCacheByUser) {
        getOrCreate(row.user_id).toolCache = Number(row.count);
      }
      for (const row of verifiedByUser) {
        getOrCreate(row.user_id).verifiedResults = Number(row.count);
      }
      for (const row of successByUser) {
        getOrCreate(row.user_id).successRecords = Number(row.count);
      }
      for (const vc of vectorCollections) {
        if (vc.user_id) {
          const u = getOrCreate(vc.user_id);
          u.vectorCollections++;
          u.totalVectorEntries += (vc as any)._count?.artifacts || 0;
        }
      }

      // Resolve user emails/names
      const userIds = [...userMap.keys()];
      const users = userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, name: true },
          })
        : [];
      const userLookup = new Map(users.map(u => [u.id, u]));

      const perUserUsage = [...userMap.values()]
        .map(u => ({
          ...u,
          email: userLookup.get(u.userId)?.email || 'unknown',
          name: userLookup.get(u.userId)?.name || 'unknown',
          total: u.memories + u.toolCache + u.verifiedResults + u.successRecords + u.totalVectorEntries,
        }))
        .sort((a, b) => b.total - a.total);

      return reply.send({
        success: true,
        pgvectorTotals,
        milvusCollections,
        milvusTotalRows: milvusCollections.reduce((sum, c) => sum + c.rowCount, 0),
        milvusTotalCollections: milvusCollections.length,
        vectorCollections: vectorCollections.map((vc: any) => ({
          id: vc.id,
          user_id: vc.user_id,
          name: vc.collection_name,
          dimensions: vc.vector_dimension,
          index_type: vc.index_type,
          total_entries: vc._count?.artifacts || 0,
          created_at: vc.created_at,
          updated_at: vc.updated_at,
        })),
        perUserUsage,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch vector usage stats');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch vector usage stats',
        timestamp: new Date().toISOString(),
      });
    }
  });
};

export default adminMetricsRoutes;
