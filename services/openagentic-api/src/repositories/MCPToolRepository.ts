/**
 * MCP Tool Repository
 * 
 * Handles database operations for MCP tools and executions with caching
 * Specialized queries for tool analytics and monitoring
 */

import { MCPTool, MCPToolExecution } from '@prisma/client';
import { BaseRepository, QueryOptions } from './BaseRepository.js';
import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

export interface MCPToolWithExecutions extends MCPTool {
  executions?: MCPToolExecution[];
}

export interface CreateMCPToolData {
  name: string;
  server_id: string;
  description?: string;
  schema?: any;
  category?: string;
  is_enabled?: boolean;
  metadata?: any;
}

export interface UpdateMCPToolData {
  description?: string;
  schema?: any;
  category?: string;
  is_enabled?: boolean;
  metadata?: any;
  last_executed?: Date;
  execution_count?: number;
}

export interface MCPToolFilters {
  server_id?: string;
  category?: string;
  is_enabled?: boolean;
  name?: string;
  executed_after?: Date;
  limit?: number;
  offset?: number;
  includeExecutions?: boolean;
}

export interface ToolExecutionStats {
  toolId: string;
  toolName: string;
  totalExecutions: number;
  successCount: number;
  errorCount: number;
  avgExecutionTime: number;
  lastExecuted: Date;
}

/**
 * Repository for MCP Tool model with specialized queries
 */
export class MCPToolRepository extends BaseRepository<MCPTool> {
  constructor(prisma: PrismaClient, logger?: Logger) {
    super(prisma, 'mCPTool', {
      defaultTTL: 3600, // 1 hour for tool metadata
      keyPrefix: 'mcp',
      enableCaching: true
    }, logger);
  }

  /**
   * Find tools by server with caching
   */
  async findByServerId(
    server_id: string,
    options: QueryOptions & { includeExecutions?: boolean } = {}
  ): Promise<MCPToolWithExecutions[]> {
    const includeExecutions = options.includeExecutions || false;
    const cacheKey = this.getCacheKey(`server:${server_id}:executions:${includeExecutions}`);

    try {
      // Check cache first
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger.debug('Cache hit for server tools', { server_id, includeExecutions });
          return cached as MCPToolWithExecutions[];
        }
      }

      const db = options.transaction || this.prisma;
      const tools = await (db as any).mCPTool.findMany({
        where: { server_id },
        include: includeExecutions ? {
          executions: {
            select: {
              id: true,
              status: true,
              execution_time: true,
              created_at: true,
              error: true
            },
            orderBy: { created_at: 'desc' },
            take: 10 // Limit executions in list view
          }
        } : false,
        orderBy: { name: 'asc' }
      });

      // Execution stats already included from database

      // Cache results
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const ttl = options.cache?.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, tools, ttl);
        this.logger.debug('Cached server tools', {
          server_id,
          count: tools.length,
          includeExecutions
        });
      }

      return tools;

    } catch (error) {
      this.logger.error('Failed to find tools by server', { server_id, error });
      throw error;
    }
  }

  /**
   * Find enabled tools only (for execution)
   */
  async findEnabledTools(
    filters: Omit<MCPToolFilters, 'is_enabled'> = {},
    options: QueryOptions = {}
  ): Promise<MCPTool[]> {
    const cacheKey = this.getCacheKey(`enabled:${JSON.stringify(filters)}`);

    try {
      // Check cache first
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger.debug('Cache hit for enabled tools');
          return cached as MCPTool[];
        }
      }

      // Build where clause
      const whereClause: any = { is_enabled: true };
      if (filters.server_id) whereClause.server_id = filters.server_id;
      if (filters.category) whereClause.category = filters.category;
      if (filters.name) {
        whereClause.name = { contains: filters.name, mode: 'insensitive' };
      }

      const db = options.transaction || this.prisma;
      const tools = await (db as any).mCPTool.findMany({
        where: whereClause,
        orderBy: { name: 'asc' },
        take: filters.limit || 100,
        skip: filters.offset || 0
      });

      // Cache results
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const ttl = options.cache?.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, tools, ttl);
        this.logger.debug('Cached enabled tools', { count: tools.length });
      }

      return tools;

    } catch (error) {
      this.logger.error('Failed to find enabled tools', { filters, error });
      throw error;
    }
  }

  /**
   * Record tool execution
   */
  async recordExecution(
    tool_id: string,
    executionData: {
      session_id?: string;
      user_id?: string;
      input: any;
      output?: any;
      status: 'success' | 'error' | 'timeout';
      execution_time: number;
      error?: string;
      metadata?: any;
    },
    options: QueryOptions = {}
  ): Promise<MCPToolExecution> {
    const db = options.transaction || this.prisma;

    try {
      // Create execution record
      const execution = await (db as any).mCPToolExecution.create({
        data: {
          tool_id,
          ...executionData,
          created_at: new Date()
        }
      });

      // Update tool's last executed time and count
      await this.update(tool_id, {
        last_executed: new Date(),
        execution_count: {
          increment: 1
        }
      } as any, options);

      this.logger.info('Recorded tool execution', {
        tool_id,
        executionId: execution.id,
        status: executionData.status,
        execution_time: executionData.execution_time
      });

      return execution;

    } catch (error) {
      this.logger.error('Failed to record tool execution', { tool_id, error });
      throw error;
    }
  }

  /**
   * Get tool execution statistics
   */
  async getToolStats(
    toolId?: string,
    dateRange?: { from: Date; to: Date }
  ): Promise<ToolExecutionStats[]> {
    try {
      let whereClause = '';
      const params: any[] = [];

      if (toolId) {
        whereClause += ' AND t.id = $1';
        params.push(toolId);
      }

      if (dateRange) {
        const paramIndex = params.length;
        whereClause += ` AND e.created_at BETWEEN $${paramIndex + 1} AND $${paramIndex + 2}`;
        params.push(dateRange.from, dateRange.to);
      }

      const stats = await this.prisma.$queryRaw<ToolExecutionStats[]>`
        SELECT 
          t.id as "toolId",
          t.name as "toolName",
          COUNT(e.id)::int as "totalExecutions",
          COUNT(CASE WHEN e.status = 'success' THEN 1 END)::int as "successCount",
          COUNT(CASE WHEN e.status = 'error' THEN 1 END)::int as "errorCount",
          COALESCE(AVG(e.execution_time), 0)::float as "avgExecutionTime",
          MAX(e.created_at) as "lastExecuted"
        FROM mcp_tools t
        LEFT JOIN mcp_tool_executions e ON e.tool_id = t.id
        WHERE 1=1 ${whereClause}
        GROUP BY t.id, t.name
        ORDER BY "totalExecutions" DESC
        LIMIT 50
      `;

      return stats;

    } catch (error) {
      this.logger.error('Failed to get tool stats', { toolId, dateRange, error });
      throw error;
    }
  }

  /**
   * Get execution history for a tool
   */
  async getExecutionHistory(
    tool_id: string,
    options: {
      limit?: number;
      offset?: number;
      status?: 'success' | 'error' | 'timeout';
      user_id?: string;
    } = {}
  ): Promise<MCPToolExecution[]> {
    try {
      const whereClause: any = { tool_id };
      if (options.status) whereClause.status = options.status;
      if (options.user_id) whereClause.user_id = options.user_id;

      const executions = await this.prisma.mCPToolExecution.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        take: options.limit || 50,
        skip: options.offset || 0,
        include: {
          tool: {
            select: {
              name: true,
              server_id: true
            }
          }
        }
      });

      return executions;

    } catch (error) {
      this.logger.error('Failed to get execution history', { tool_id, options, error });
      throw error;
    }
  }

  /**
   * Clean up old execution records
   */
  async cleanupOldExecutions(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.prisma.mCPToolExecution.deleteMany({
        where: {
          created_at: {
            lt: cutoffDate
          }
        }
      });

      this.logger.info('Cleaned up old tool executions', {
        deletedCount: result.count,
        cutoffDate
      });

      return result.count;

    } catch (error) {
      this.logger.error('Failed to cleanup old executions', { olderThanDays, error });
      throw error;
    }
  }

  /**
   * Override cache invalidation to clear server-specific caches
   */
  protected async invalidateCache(tool_id?: string): Promise<void> {
    if (!this.cache) return;

    try {
      // Get tool to find server_id before invalidating
      if (tool_id) {
        const tool = await this.prisma.mCPTool.findUnique({
          where: { id: tool_id },
          select: { server_id: true }
        });

        if (tool) {
          // Invalidate server-specific caches
          const serverPattern = this.getCacheKey(`server:${tool.server_id}:*`);
          const serverKeys = await this.cache.keys(serverPattern);
          if (serverKeys.length > 0) {
            await this.cache.del(...serverKeys);
          }
        }
      }

      // Call parent invalidation
      await super.invalidateCache(tool_id);

      // Also invalidate enabled tools cache
      const enabledPattern = this.getCacheKey('enabled:*');
      const enabledKeys = await this.cache.keys(enabledPattern);
      if (enabledKeys.length > 0) {
        await this.cache.del(...enabledKeys);
      }

    } catch (error) {
      this.logger.warn('Cache invalidation error in MCPToolRepository', {
        tool_id,
        error
      });
    }
  }

  /**
   * Find tools using semantic search (Milvus vector search)
   * Reduces token usage from ~18k to ~3k per request by finding most relevant tools
   *
   * @param query - Natural language query describing the task
   * @param topK - Number of most relevant tools to return (default: 30)
   * @param filters - Optional filters (server_id, is_enabled, etc.)
   * @returns Array of tools most relevant to the query
   */
  async findBySemantic(
    query: string,
    topK: number = 30,
    filters?: Pick<MCPToolFilters, 'server_id' | 'is_enabled'>
  ): Promise<any[]> {
    try {
      this.logger.info('Semantic tool search requested', {
        query: query.substring(0, 100),
        topK,
        filters
      });

      // Check if semantic cache is initialized
      if (!global.toolSemanticCache?.isInitialized) {
        this.logger.warn('Semantic cache not initialized, falling back to standard query');
        return this.findEnabledTools(filters || {});
      }

      // Search using semantic cache
      const tools = await global.toolSemanticCache.searchToolsAsOpenAIFunctions(
        query,
        topK,
        filters?.server_id
      );

      this.logger.info('Semantic search completed', {
        query: query.substring(0, 100),
        resultsFound: tools.length,
        topK
      });

      return tools;

    } catch (error) {
      this.logger.error('Semantic search failed, falling back to standard query', {
        query,
        error
      });
      // Fallback to standard enabled tools query
      return this.findEnabledTools(filters || {});
    }
  }

  /**
   * Index tools in semantic cache (Milvus) for vector search
   * Should be called when tools are updated or on startup
   *
   * @param tools - Array of tools in OpenAI function format
   */
  async indexToolsInSemanticCache(tools: any[]): Promise<void> {
    try {
      if (!global.toolSemanticCache?.isInitialized) {
        this.logger.warn('Semantic cache not initialized, skipping tool indexing');
        return;
      }

      this.logger.info('Indexing tools in semantic cache', { toolCount: tools.length });

      await global.toolSemanticCache.indexAllTools(tools);

      this.logger.info('Tools indexed successfully in semantic cache', {
        toolCount: tools.length
      });

    } catch (error) {
      this.logger.error('Failed to index tools in semantic cache', {
        toolCount: tools.length,
        error
      });
      throw error;
    }
  }

  /**
   * Get semantic cache statistics
   * Useful for monitoring and debugging
   */
  async getSemanticCacheStats(): Promise<{
    isInitialized: boolean;
    totalTools: number;
    collectionName: string;
  }> {
    try {
      if (!global.toolSemanticCache?.isInitialized) {
        return {
          isInitialized: false,
          totalTools: 0,
          collectionName: 'N/A'
        };
      }

      const stats = await global.toolSemanticCache.getCacheStats();

      return {
        isInitialized: true,
        totalTools: stats.totalTools,
        collectionName: stats.collectionName
      };

    } catch (error) {
      this.logger.error('Failed to get semantic cache stats', { error });
      return {
        isInitialized: false,
        totalTools: 0,
        collectionName: 'Error'
      };
    }
  }
}