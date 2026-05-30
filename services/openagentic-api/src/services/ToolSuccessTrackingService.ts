/**
 * Tool Success Tracking Service
 *
 * Provides structured semantic tracking of successful tool executions.
 * Uses a dedicated Milvus collection to store tool usage patterns with
 * embeddings, enabling semantic search for similar queries and intents.
 *
 * Key Features:
 * - Semantic storage: Queries are embedded for similarity matching
 * - Structured tracking: Tool name, server, context tags, success metrics
 * - Cross-user learning: Optional aggregation of successful patterns
 * - Intent linking: Tags connect tools to user intents and memory contexts
 *
 * This replaces the text-based "Tool success: ..." pattern in memory MCP
 * with a proper structured approach that enables:
 * - Better tool recommendations based on semantic similarity
 * - Multi-dimensional filtering (by tool, server, tags, user)
 * - Analytics on tool usage patterns
 */

import { MilvusClient, DataType, MetricType, IndexType } from '@zilliz/milvus2-sdk-node';
import { loggers } from '../utils/logger.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { randomUUID } from 'crypto';
import prisma from '../utils/prisma.js';

const COLLECTION_NAME = 'tool_success_tracking';
const serviceLogger = loggers.services.child({ service: 'tool-success-tracking' });

// Vector dimensions - populated dynamically
let EMBEDDING_DIMENSIONS = 768;

/**
 * Represents a successful tool execution to be tracked
 */
export interface ToolSuccessRecord {
  id?: string;
  userId: string;
  sessionId?: string;
  query: string;              // The user query that triggered the tool
  queryEmbedding?: number[];  // Embedding of the query for semantic search
  toolName: string;           // Name of the tool that was used
  serverName: string;         // MCP server that provides the tool
  intentTags: string[];       // Tags describing the intent (e.g., "azure", "list", "resources")
  contextTags: string[];      // Additional context tags from memory/session
  executionTimeMs?: number;   // How long the tool took to execute
  resultSummary?: string;     // Brief summary of what the tool returned
  successScore: number;       // 0-1 score of how successful the execution was
  createdAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Search options for finding relevant tool success patterns
 */
export interface ToolSuccessSearchOptions {
  query: string;              // Query to search for semantically
  userId: string;             // REQUIRED: User isolation - always filter by user
  serverFilter?: string[];    // Filter by specific MCP servers
  tagFilter?: string[];       // Filter by intent/context tags
  limit?: number;             // Max results (default 10)
  minScore?: number;          // Minimum similarity score (default 0.5)
  /** @deprecated Cross-user pattern access disabled for FedRAMP/HIPAA compliance */
  includeAllUsers?: boolean;  // DEPRECATED: Always enforces user isolation
}

/**
 * Reliability tier for a tool based on historical success data
 */
export type ReliabilityTier = 'gold' | 'silver' | 'bronze' | 'untrusted';
export type TrendDirection = 'improving' | 'stable' | 'degrading';

export interface ToolReliability {
  toolName: string;
  serverName?: string;
  tier: ReliabilityTier;
  avgScore: number;
  totalExecutions: number;
  recentSuccessRate: number;  // Last 50 executions
  trend: TrendDirection;
  lastExecuted?: Date;
}

/**
 * Result from tool success search
 */
export interface ToolSuccessSearchResult {
  toolName: string;
  serverName: string;
  query: string;
  intentTags: string[];
  successScore: number;
  similarity: number;         // Semantic similarity to search query
  usageCount?: number;        // How many times this pattern was successful
}

/**
 * Tool Success Tracking Service
 * Manages structured tracking of successful tool executions in Milvus
 */
export class ToolSuccessTrackingService {
  private client: MilvusClient;
  private embeddingService: UniversalEmbeddingService;
  private _isInitialized: boolean = false;
  private readonly instanceId: string = `tracker-${process.env.HOSTNAME || randomUUID().substring(0, 8)}`;
  private reliabilityCache: Map<string, { reliability: ToolReliability; cachedAt: number }> = new Map();
  private static readonly RELIABILITY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor() {
    const milvusHost = process.env.MILVUS_HOST || 'milvus';
    const milvusPort = process.env.MILVUS_PORT || '19530';

    this.client = new MilvusClient({
      address: `${milvusHost}:${milvusPort}`,
      timeout: 30000
    });

    // UniversalEmbeddingService requires a logger
    this.embeddingService = new UniversalEmbeddingService(serviceLogger);
  }

  /**
   * Initialize the service and create collection if needed
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    try {
      serviceLogger.info('[ToolSuccessTracking] Initializing service...');

      // Get embedding dimensions (UniversalEmbeddingService auto-detects on first use)
      EMBEDDING_DIMENSIONS = await this.embeddingService.getInfo().dimensions;

      // Check if collection exists
      const hasCollection = await this.client.hasCollection({
        collection_name: COLLECTION_NAME
      });

      if (!hasCollection.value) {
        await this.createCollection();
      } else {
        // Verify collection schema matches expected dimensions
        const collectionInfo = await this.client.describeCollection({
          collection_name: COLLECTION_NAME
        });

        const vectorField = collectionInfo.schema.fields.find(
          f => f.name === 'query_embedding'
        );

        if (vectorField && vectorField.type_params) {
          // type_params can be an array or object - handle both
          let existingDim = 0;
          if (Array.isArray(vectorField.type_params)) {
            const dimParam = vectorField.type_params.find((p: any) => p.key === 'dim');
            existingDim = dimParam ? parseInt(String(dimParam.value) || '0') : 0;
          } else if (typeof vectorField.type_params === 'object') {
            existingDim = parseInt(String((vectorField.type_params as any).dim) || '0');
          }
          if (existingDim !== EMBEDDING_DIMENSIONS) {
            serviceLogger.warn({
              existingDim,
              expectedDim: EMBEDDING_DIMENSIONS
            }, '[ToolSuccessTracking] Dimension mismatch - recreating collection');
            await this.client.dropCollection({ collection_name: COLLECTION_NAME });
            await this.createCollection();
          }
        }
      }

      // Load collection into memory
      await this.client.loadCollection({ collection_name: COLLECTION_NAME });

      this._isInitialized = true;
      serviceLogger.info('[ToolSuccessTracking] Service initialized successfully');
    } catch (error) {
      serviceLogger.error({ error }, '[ToolSuccessTracking] Failed to initialize');
      throw error;
    }
  }

  /**
   * Create the Milvus collection with proper schema
   */
  private async createCollection(): Promise<void> {
    serviceLogger.info('[ToolSuccessTracking] Creating collection...');

    await this.client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        {
          name: 'id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 64
        },
        {
          name: 'user_id',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'session_id',
          data_type: DataType.VarChar,
          max_length: 64
        },
        {
          name: 'query',
          data_type: DataType.VarChar,
          max_length: 2048
        },
        {
          name: 'tool_name',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'server_name',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'intent_tags',
          data_type: DataType.VarChar,
          max_length: 1024  // Comma-separated tags
        },
        {
          name: 'context_tags',
          data_type: DataType.VarChar,
          max_length: 1024
        },
        {
          name: 'success_score',
          data_type: DataType.Float
        },
        {
          name: 'execution_time_ms',
          data_type: DataType.Int64
        },
        {
          name: 'result_summary',
          data_type: DataType.VarChar,
          max_length: 512
        },
        {
          name: 'created_at',
          data_type: DataType.Int64  // Unix timestamp
        },
        {
          name: 'metadata_json',
          data_type: DataType.VarChar,
          max_length: 4096
        },
        {
          name: 'query_embedding',
          data_type: DataType.FloatVector,
          dim: EMBEDDING_DIMENSIONS
        }
      ]
    });

    // Create vector index for semantic search
    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'query_embedding',
      index_type: IndexType.HNSW,
      metric_type: MetricType.COSINE,
      params: { M: 16, efConstruction: 256 }
    });

    // Create scalar indexes for filtering
    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'user_id',
      index_type: 'INVERTED'
    });

    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'tool_name',
      index_type: 'INVERTED'
    });

    await this.client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'server_name',
      index_type: 'INVERTED'
    });

    serviceLogger.info('[ToolSuccessTracking] Collection created with indexes');
  }

  /**
   * Record a successful tool execution
   */
  async recordSuccess(record: ToolSuccessRecord): Promise<string> {
    await this.ensureInitialized();

    try {
      // Generate embedding for the query
      const result = await this.embeddingService.generateEmbedding(record.query);
      const embedding = result.embedding;

      const id = record.id || randomUUID();
      const now = Date.now();

      await this.client.insert({
        collection_name: COLLECTION_NAME,
        data: [{
          id,
          user_id: record.userId,
          session_id: record.sessionId || '',
          query: record.query.substring(0, 2048),
          tool_name: record.toolName,
          server_name: record.serverName,
          intent_tags: record.intentTags.join(','),
          context_tags: record.contextTags.join(','),
          success_score: record.successScore,
          execution_time_ms: record.executionTimeMs || 0,
          result_summary: (record.resultSummary || '').substring(0, 512),
          created_at: now,
          metadata_json: JSON.stringify(record.metadata || {}),
          query_embedding: embedding
        }]
      });

      serviceLogger.debug({
        id,
        toolName: record.toolName,
        serverName: record.serverName,
        userId: record.userId.substring(0, 8) + '...',
        intentTags: record.intentTags
      }, '[ToolSuccessTracking] Recorded successful tool execution in Milvus');

      // Also store in pgvector for recent per-user queries (ACID, bounded working set)
      try {
        const vectorSql = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `INSERT INTO tool_success_records (id, user_id, session_id, query, tool_name, server_name, intent_tags, context_tags, success_score, execution_time_ms, result_summary, metadata, query_embedding, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::halfvec, NOW())
           ON CONFLICT (id) DO NOTHING`,
          id,
          record.userId,
          record.sessionId || null,
          record.query.substring(0, 4000),
          record.toolName,
          record.serverName,
          record.intentTags,
          record.contextTags,
          record.successScore,
          record.executionTimeMs || 0,
          (record.resultSummary || '').substring(0, 512),
          JSON.stringify(record.metadata || {}),
          vectorSql
        );
        serviceLogger.debug({ id }, '[ToolSuccessTracking] Also stored in pgvector');
      } catch (pgError) {
        serviceLogger.debug({ error: pgError }, '[ToolSuccessTracking] pgvector write failed (non-fatal, Milvus has the data)');
      }

      return id;
    } catch (error) {
      serviceLogger.error({ error, record }, '[ToolSuccessTracking] Failed to record success');
      throw error;
    }
  }

  /**
   * Search for successful tool patterns similar to a query
   * Returns tools that worked well for similar queries in the past
   */
  async searchSuccessfulTools(options: ToolSuccessSearchOptions): Promise<ToolSuccessSearchResult[]> {
    await this.ensureInitialized();

    try {
      // Generate embedding for search query
      const queryResult = await this.embeddingService.generateEmbedding(options.query);
      const queryEmbedding = queryResult.embedding;

      // 1. PRIMARY: Try pgvector first (recent, per-user, ACID)
      let results: ToolSuccessSearchResult[] = [];
      try {
        const vectorSql = `[${queryEmbedding.join(',')}]`;
        // SECURITY: Always enforce user isolation (FedRAMP/HIPAA compliance)
        let whereClause = `WHERE query_embedding IS NOT NULL AND user_id = '${options.userId}'`;

        const pgResults = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id, tool_name, server_name, query, intent_tags, context_tags,
                  success_score, 1 - (query_embedding <=> $1::halfvec) as similarity
           FROM tool_success_records
           ${whereClause}
           ORDER BY query_embedding <=> $1::halfvec
           LIMIT $2`,
          vectorSql,
          options.limit || 10
        );

        const minScore = options.minScore || 0.5;
        for (const row of pgResults) {
          if (row.similarity < minScore) continue;
          const intentTags = Array.isArray(row.intent_tags) ? row.intent_tags : [];
          results.push({
            toolName: row.tool_name,
            serverName: row.server_name,
            query: row.query,
            intentTags,
            successScore: row.success_score,
            similarity: row.similarity
          });
        }

        if (results.length > 0) {
          serviceLogger.debug({
            queryPreview: options.query.substring(0, 50),
            resultsFound: results.length,
            topTool: results[0]?.toolName,
            source: 'pgvector'
          }, '[ToolSuccessTracking] pgvector search completed');
          return results;
        }
      } catch (pgError) {
        serviceLogger.debug({ error: pgError }, '[ToolSuccessTracking] pgvector search failed, trying Milvus');
      }

      // 2. FALLBACK: Milvus search (historical, user-isolated)
      // SECURITY: Always enforce user isolation (FedRAMP/HIPAA compliance)
      const filters: string[] = [];
      filters.push(`user_id == "${options.userId}"`);
      if (options.serverFilter && options.serverFilter.length > 0) {
        const serverConditions = options.serverFilter.map(s => `server_name == "${s}"`);
        filters.push(`(${serverConditions.join(' || ')})`);
      }
      const filterExpr = filters.length > 0 ? filters.join(' && ') : undefined;

      const searchResults = await this.client.search({
        collection_name: COLLECTION_NAME,
        data: [queryEmbedding],
        limit: options.limit || 10,
        filter: filterExpr || '',
        output_fields: [
          'tool_name', 'server_name', 'query', 'intent_tags',
          'success_score', 'context_tags'
        ],
        params: { ef: 128 }
      });

      if (!searchResults.results || searchResults.results.length === 0) {
        return [];
      }

      const minScore = options.minScore || 0.5;
      for (const result of searchResults.results) {
        const similarity = result.score || 0;
        if (similarity < minScore) continue;
        const intentTags = (result.intent_tags as string || '').split(',').filter(Boolean);
        if (options.tagFilter && options.tagFilter.length > 0) {
          const hasMatchingTag = options.tagFilter.some(tag =>
            intentTags.includes(tag) ||
            (result.context_tags as string || '').includes(tag)
          );
          if (!hasMatchingTag) continue;
        }
        results.push({
          toolName: result.tool_name as string,
          serverName: result.server_name as string,
          query: result.query as string,
          intentTags,
          successScore: result.success_score as number,
          similarity
        });
      }

      serviceLogger.debug({
        queryPreview: options.query.substring(0, 50),
        resultsFound: results.length,
        topTool: results[0]?.toolName,
        source: 'milvus'
      }, '[ToolSuccessTracking] Milvus search completed');

      return results;
    } catch (error) {
      serviceLogger.error({ error }, '[ToolSuccessTracking] Search failed');
      return [];
    }
  }

  /**
   * Get aggregated tool success patterns for a user
   * Returns tools with their success counts and average scores
   */
  async getUserToolPatterns(userId: string, limit: number = 20): Promise<{
    toolName: string;
    serverName: string;
    usageCount: number;
    avgSuccessScore: number;
    topIntentTags: string[];
  }[]> {
    await this.ensureInitialized();

    try {
      // Query all records for user
      const queryResult = await this.client.query({
        collection_name: COLLECTION_NAME,
        filter: `user_id == "${userId}"`,
        output_fields: ['tool_name', 'server_name', 'success_score', 'intent_tags'],
        limit: 1000  // Get up to 1000 records for aggregation
      });

      if (!queryResult.data || queryResult.data.length === 0) {
        return [];
      }

      // Aggregate by tool
      const toolStats = new Map<string, {
        serverName: string;
        count: number;
        totalScore: number;
        tagCounts: Map<string, number>;
      }>();

      for (const record of queryResult.data) {
        const key = record.tool_name as string;
        const stats = toolStats.get(key) || {
          serverName: record.server_name as string,
          count: 0,
          totalScore: 0,
          tagCounts: new Map()
        };

        stats.count++;
        stats.totalScore += record.success_score as number;

        // Count intent tags
        const tags = (record.intent_tags as string || '').split(',').filter(Boolean);
        for (const tag of tags) {
          stats.tagCounts.set(tag, (stats.tagCounts.get(tag) || 0) + 1);
        }

        toolStats.set(key, stats);
      }

      // Convert to sorted array
      const results = Array.from(toolStats.entries())
        .map(([toolName, stats]) => ({
          toolName,
          serverName: stats.serverName,
          usageCount: stats.count,
          avgSuccessScore: stats.totalScore / stats.count,
          topIntentTags: Array.from(stats.tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tag]) => tag)
        }))
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, limit);

      return results;
    } catch (error) {
      serviceLogger.error({ error, userId }, '[ToolSuccessTracking] Failed to get user patterns');
      return [];
    }
  }

  /**
   * Extract intent tags from a query using keyword analysis
   * This provides immediate tags without LLM overhead
   */
  extractIntentTags(query: string): string[] {
    const queryLower = query.toLowerCase();
    const tags: string[] = [];

    // Cloud provider detection
    const cloudPatterns: Record<string, string[]> = {
      'aws': ['aws', 'amazon', 's3', 'ec2', 'lambda', 'iam', 'dynamodb', 'rds', 'eks', 'cloudwatch', 'bedrock'],
      'azure': ['azure', 'microsoft', 'subscription', 'resource group', 'aks', 'blob', 'cosmos', 'entra'],
      'gcp': ['gcp', 'google cloud', 'gke', 'bigquery', 'cloud run', 'vertex', 'compute engine'],
      'kubernetes': ['kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'service', 'namespace', 'helm']
    };

    for (const [provider, keywords] of Object.entries(cloudPatterns)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        tags.push(provider);
      }
    }

    // Action detection
    const actionPatterns: Record<string, string[]> = {
      'list': ['list', 'show', 'get all', 'display', 'enumerate'],
      'create': ['create', 'make', 'new', 'add', 'provision'],
      'delete': ['delete', 'remove', 'destroy', 'terminate'],
      'update': ['update', 'modify', 'change', 'edit', 'patch'],
      'describe': ['describe', 'details', 'info', 'information about'],
      'search': ['search', 'find', 'look for', 'query', 'browse'],
      'analyze': ['analyze', 'audit', 'check', 'review', 'assess']
    };

    for (const [action, keywords] of Object.entries(actionPatterns)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        tags.push(action);
      }
    }

    // Resource type detection
    const resourcePatterns: Record<string, string[]> = {
      'compute': ['vm', 'virtual machine', 'instance', 'server', 'container'],
      'storage': ['storage', 'bucket', 'blob', 'disk', 'volume'],
      'database': ['database', 'db', 'sql', 'nosql', 'table'],
      'network': ['network', 'vpc', 'subnet', 'firewall', 'load balancer'],
      'identity': ['user', 'role', 'permission', 'policy', 'identity', 'iam'],
      'monitoring': ['log', 'metric', 'alert', 'monitor', 'trace']
    };

    for (const [resource, keywords] of Object.entries(resourcePatterns)) {
      if (keywords.some(kw => queryLower.includes(kw))) {
        tags.push(resource);
      }
    }

    return [...new Set(tags)]; // Remove duplicates
  }

  /**
   * Check if service is initialized
   */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Ensure service is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this._isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<{
    totalRecords: number;
    uniqueTools: number;
    uniqueUsers: number;
  }> {
    await this.ensureInitialized();

    try {
      const stats = await this.client.getCollectionStatistics({
        collection_name: COLLECTION_NAME
      });

      return {
        totalRecords: parseInt(stats.data.row_count || '0'),
        uniqueTools: 0,  // Would need aggregation query
        uniqueUsers: 0
      };
    } catch (error) {
      serviceLogger.error({ error }, '[ToolSuccessTracking] Failed to get stats');
      return { totalRecords: 0, uniqueTools: 0, uniqueUsers: 0 };
    }
  }

  // ─── Reliability Tiers (Phase 10 - Data Layer Evolution) ────────────────────

  /**
   * Get reliability data for a specific tool.
   * Queries Milvus for all success records, calculates average score,
   * recent success rate, tier classification, and trend direction.
   */
  async getToolReliability(toolName: string, serverName?: string): Promise<ToolReliability> {
    await this.ensureInitialized();

    try {
      // Build filter expression
      let filterExpr = `tool_name == "${toolName}"`;
      if (serverName) {
        filterExpr += ` && server_name == "${serverName}"`;
      }

      // Query all records for this tool, sorted by created_at descending
      const queryResult = await this.client.query({
        collection_name: COLLECTION_NAME,
        filter: filterExpr,
        output_fields: ['success_score', 'created_at', 'server_name'],
        limit: 10000
      });

      const records = queryResult.data || [];
      const totalExecutions = records.length;

      if (totalExecutions === 0) {
        return {
          toolName,
          serverName,
          tier: 'untrusted',
          avgScore: 0,
          totalExecutions: 0,
          recentSuccessRate: 0,
          trend: 'stable',
          lastExecuted: undefined
        };
      }

      // Sort by created_at descending (most recent first)
      const sorted = [...records].sort(
        (a, b) => (b.created_at as number) - (a.created_at as number)
      );

      // Calculate avg success_score across all records
      const totalScore = sorted.reduce((sum, r) => sum + (r.success_score as number), 0);
      const avgScore = totalScore / totalExecutions;

      // Calculate recent success rate (last 50 executions)
      const recent50 = sorted.slice(0, 50);
      const recentSuccessRate = recent50.reduce(
        (sum, r) => sum + (r.success_score as number), 0
      ) / recent50.length;

      // Determine tier
      let tier: ReliabilityTier;
      if (avgScore > 0.9 && totalExecutions > 100) {
        tier = 'gold';
      } else if (avgScore > 0.7 && totalExecutions > 50) {
        tier = 'silver';
      } else if (avgScore > 0.5 && totalExecutions > 10) {
        tier = 'bronze';
      } else {
        tier = 'untrusted';
      }

      // Determine trend: compare recent 25 avg vs older 25 avg
      let trend: TrendDirection = 'stable';
      if (recent50.length >= 50) {
        const recent25 = recent50.slice(0, 25);
        const older25 = recent50.slice(25, 50);
        const recent25Avg = recent25.reduce(
          (sum, r) => sum + (r.success_score as number), 0
        ) / 25;
        const older25Avg = older25.reduce(
          (sum, r) => sum + (r.success_score as number), 0
        ) / 25;

        if (recent25Avg > older25Avg + 0.05) {
          trend = 'improving';
        } else if (recent25Avg < older25Avg - 0.05) {
          trend = 'degrading';
        }
      }

      // Last executed timestamp
      const lastExecutedTs = sorted[0].created_at as number;
      const lastExecuted = new Date(lastExecutedTs);

      // Resolve server name from first record if not provided
      const resolvedServerName = serverName || (sorted[0].server_name as string) || undefined;

      const reliability: ToolReliability = {
        toolName,
        serverName: resolvedServerName,
        tier,
        avgScore,
        totalExecutions,
        recentSuccessRate,
        trend,
        lastExecuted
      };

      serviceLogger.debug({
        toolName,
        tier,
        avgScore: avgScore.toFixed(3),
        totalExecutions,
        trend
      }, '[ToolSuccessTracking] Computed tool reliability');

      return reliability;
    } catch (error) {
      serviceLogger.error({ error, toolName }, '[ToolSuccessTracking] Failed to get tool reliability');
      return {
        toolName,
        serverName,
        tier: 'untrusted',
        avgScore: 0,
        totalExecutions: 0,
        recentSuccessRate: 0,
        trend: 'stable'
      };
    }
  }

  /**
   * Get a reliability report for all tracked tools.
   * Returns tools sorted by tier (gold first) then by avgScore descending.
   */
  async getReliabilityReport(limit?: number): Promise<ToolReliability[]> {
    await this.ensureInitialized();

    try {
      // Get distinct tool names from the collection
      const queryResult = await this.client.query({
        collection_name: COLLECTION_NAME,
        filter: 'tool_name != ""',
        output_fields: ['tool_name', 'server_name'],
        limit: 10000
      });

      const records = queryResult.data || [];

      // Extract distinct tool+server combinations
      const toolSet = new Map<string, string | undefined>();
      for (const record of records) {
        const toolName = record.tool_name as string;
        if (!toolSet.has(toolName)) {
          toolSet.set(toolName, (record.server_name as string) || undefined);
        }
      }

      // Calculate reliability for each tool
      const reliabilities: ToolReliability[] = [];
      for (const [toolName, serverName] of toolSet.entries()) {
        const reliability = await this.getToolReliability(toolName, serverName);
        reliabilities.push(reliability);
      }

      // Define tier ordering for sort
      const tierOrder: Record<ReliabilityTier, number> = {
        gold: 0,
        silver: 1,
        bronze: 2,
        untrusted: 3
      };

      // Sort by tier (gold first) then avgScore descending
      reliabilities.sort((a, b) => {
        const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
        if (tierDiff !== 0) return tierDiff;
        return b.avgScore - a.avgScore;
      });

      const result = limit ? reliabilities.slice(0, limit) : reliabilities;

      serviceLogger.info({
        totalTools: result.length,
        gold: result.filter(r => r.tier === 'gold').length,
        silver: result.filter(r => r.tier === 'silver').length,
        bronze: result.filter(r => r.tier === 'bronze').length,
        untrusted: result.filter(r => r.tier === 'untrusted').length
      }, '[ToolSuccessTracking] Generated reliability report');

      return result;
    } catch (error) {
      serviceLogger.error({ error }, '[ToolSuccessTracking] Failed to generate reliability report');
      return [];
    }
  }

  /**
   * Get a reliability boost factor for search ranking.
   * Returns a multiplier based on the tool's reliability tier.
   * Uses a 1-hour cache to avoid repeated Milvus queries.
   *
   * - Gold:      1.3x
   * - Silver:    1.1x
   * - Bronze:    1.0x
   * - Untrusted: 0.8x
   */
  async getReliabilityBoostFactor(toolName: string): Promise<number> {
    const boostFactors: Record<ReliabilityTier, number> = {
      gold: 1.3,
      silver: 1.1,
      bronze: 1.0,
      untrusted: 0.8
    };

    const cacheKey = toolName;
    const cached = this.reliabilityCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.cachedAt) < ToolSuccessTrackingService.RELIABILITY_CACHE_TTL_MS) {
      return boostFactors[cached.reliability.tier];
    }

    try {
      const reliability = await this.getToolReliability(toolName);
      this.reliabilityCache.set(cacheKey, { reliability, cachedAt: now });
      return boostFactors[reliability.tier];
    } catch (error) {
      serviceLogger.error({ error, toolName }, '[ToolSuccessTracking] Failed to get boost factor, defaulting to 1.0');
      return 1.0;
    }
  }
}

// Singleton instance
let instance: ToolSuccessTrackingService | null = null;

export function getToolSuccessTrackingService(): ToolSuccessTrackingService {
  if (!instance) {
    instance = new ToolSuccessTrackingService();
  }
  return instance;
}
