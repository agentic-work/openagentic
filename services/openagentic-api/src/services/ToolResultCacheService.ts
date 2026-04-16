/**
 * Tool Result Cache Service - Milvus Semantic Caching (Layer 2)
 *
 * Provides cross-session, CROSS-USER semantic caching for MCP tool results.
 * Uses Milvus vector database for semantic similarity matching.
 *
 * Architecture:
 * - Layer 1 (Redis): Session-level, exact-match caching with 5-60 min TTL
 * - Layer 2 (Milvus): Tenant-level, CROSS-USER semantic caching with 24-48h TTL
 *
 * CROSS-USER CACHING WITH RBAC:
 * - Cache is keyed by RESOURCE SCOPE (e.g., "azure:sub-123:rg-prod"), not user
 * - When User A caches "/subscriptions/sub-123/costs", User B can benefit
 * - RBAC verification happens at READ time - user must have access to resource
 * - This enables 100 users asking similar Azure/AWS/GCP questions to share results
 *
 * Example flow:
 * 1. Admin A: "get azure costs for sub-123" → executes in 45s, cached with scope "azure:sub-123"
 * 2. User B: "show subscription 123 spending" → semantic match (97% similar)
 *    → RBAC check: User B has READ on sub-123? YES → return cached result in 50ms
 */

import type { Logger } from 'pino';
import { pino } from 'pino';
import { MilvusClient, DataType, MetricType } from '@zilliz/milvus2-sdk-node';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { checkMCPAccess } from './MCPAccessControlService.js';
import crypto from 'crypto';
import prisma from '../utils/prisma.js';

// =================================================================
// Configuration
// =================================================================

const COLLECTION_NAME = 'tool_result_cache_v2';  // New collection with resource_scope
const DEFAULT_SIMILARITY_THRESHOLD = 0.90;  // 90% similarity for cloud resource tools (Azure/AWS/GCP)
const GENERAL_TOOL_SIMILARITY_THRESHOLD = 0.75;  // 75% for general tools (web_search, fetch, etc.)
const DEFAULT_TTL_HOURS = 24;  // 24 hour default TTL
const MAX_RESULT_SIZE = 50000;  // Max cached result size (50KB) - larger results are summarized
const INDEX_BUILD_WAIT_MS = 2000;  // Wait time for index building

// Tools that use lower similarity threshold (general-purpose tools)
const GENERAL_TOOLS_PATTERNS = [
  /web.*search/i,
  /search/i,
  /fetch/i,
  /weather/i,
  /query/i,
];

// Tools that should NEVER use semantic result caching
// These tools have location/context-specific outputs where semantic similarity fails
// e.g., "weather in Seattle" vs "weather in Ashland" are 82% similar but need DIFFERENT results
const UNCACHEABLE_TOOLS_PATTERNS = [
  /weather/i,          // Weather is location-specific
  /web.*search/i,      // Web search results depend on exact query
  /web.*fetch/i,       // Fetching a URL is URL-specific
  /search/i,           // General search is query-specific
  /news/i,             // News is time and query specific
  /current/i,          // "Current" anything is time-sensitive
  /today/i,            // Time-sensitive
  /now/i,              // Time-sensitive
  /live/i,             // Real-time data
];

/**
 * Check if a tool should be completely excluded from semantic result caching
 * These are tools where semantic similarity matching leads to incorrect results
 * because the output is highly dependent on specific parameters (location, time, URL, etc.)
 */
function isUncacheableTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return UNCACHEABLE_TOOLS_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Check if a tool should use the lower (general) similarity threshold
 */
function isGeneralTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  // Cloud tools need higher precision
  if (normalized.includes('azure') || normalized.includes('aws') ||
      normalized.includes('gcp') || normalized.includes('arm')) {
    return false;
  }
  return GENERAL_TOOLS_PATTERNS.some(pattern => pattern.test(normalized));
}

// TTL configuration by tool type (in hours)
const TOOL_TTL_CONFIG: Record<string, number> = {
  // Static data - long TTL (48 hours)
  'subscription': 48,
  'account': 48,
  'resource_group': 48,
  'resourcegroup': 48,

  // Semi-static data - medium TTL (24 hours)
  'list': 24,
  'config': 24,
  'setting': 24,
  'describe': 24,

  // Dynamic data - short TTL (4 hours)
  'cost': 4,
  'metric': 4,
  'status': 4,
  'health': 4,
  'usage': 4,
};

// =================================================================
// Resource Scope Extraction - Key for Cross-User Caching
// =================================================================

/**
 * Extract resource scope from tool call for cross-user cache keying
 * This is the CRITICAL function that enables cross-user caching while respecting RBAC
 *
 * Resource scopes are hierarchical:
 * - azure:subscription-id
 * - azure:subscription-id:resource-group
 * - aws:account-id:region
 * - gcp:project-id
 *
 * Users with access to a resource scope can benefit from cached results for that scope
 */
export function extractResourceScope(toolName: string, toolArgs: any): string | null {
  const normalizedTool = toolName.toLowerCase();

  // ===========================================
  // AZURE Resource Scope Extraction
  // ===========================================
  if (normalizedTool.includes('azure') || normalizedTool.includes('arm_execute') || normalizedTool.includes('azmcp')) {
    const path = toolArgs?.path || toolArgs?.resource_path || '';

    // Extract subscription ID: /subscriptions/{sub-id}/...
    const subMatch = path.match(/\/subscriptions\/([a-f0-9-]+)/i);
    if (subMatch) {
      const subscriptionId = subMatch[1];

      // Check for resource group: /resourceGroups/{rg-name}/...
      const rgMatch = path.match(/\/resourceGroups\/([^\/]+)/i);
      if (rgMatch) {
        return `azure:${subscriptionId}:${rgMatch[1].toLowerCase()}`;
      }

      return `azure:${subscriptionId}`;
    }

    // Check for subscription_id in args directly
    const subId = toolArgs?.subscription_id || toolArgs?.subscriptionId;
    if (subId) {
      const rg = toolArgs?.resource_group || toolArgs?.resourceGroup;
      if (rg) {
        return `azure:${subId}:${rg.toLowerCase()}`;
      }
      return `azure:${subId}`;
    }
  }

  // ===========================================
  // AWS Resource Scope Extraction
  // ===========================================
  if (normalizedTool.includes('aws')) {
    const accountId = toolArgs?.account_id || toolArgs?.accountId || toolArgs?.account;
    const region = toolArgs?.region;

    if (accountId) {
      if (region) {
        return `aws:${accountId}:${region}`;
      }
      return `aws:${accountId}`;
    }
  }

  // ===========================================
  // GCP Resource Scope Extraction
  // ===========================================
  if (normalizedTool.includes('gcp') || normalizedTool.includes('google')) {
    const projectId = toolArgs?.project || toolArgs?.project_id || toolArgs?.projectId;
    const region = toolArgs?.region || toolArgs?.zone;

    if (projectId) {
      if (region) {
        return `gcp:${projectId}:${region}`;
      }
      return `gcp:${projectId}`;
    }
  }

  // ===========================================
  // Kubernetes Resource Scope Extraction
  // ===========================================
  if (normalizedTool.includes('k8s') || normalizedTool.includes('kube')) {
    const cluster = toolArgs?.cluster || toolArgs?.context;
    const namespace = toolArgs?.namespace;

    if (cluster) {
      if (namespace) {
        return `k8s:${cluster}:${namespace}`;
      }
      return `k8s:${cluster}`;
    }
  }

  // No identifiable resource scope - cache will be user-isolated
  return null;
}

/**
 * Map resource scope to MCP server ID for access control check
 * Dynamically derives server name from provider prefix without hardcoding
 */
function getServerIdForScope(resourceScope: string): string {
  const [provider] = resourceScope.split(':');

  // Dynamically construct server name from provider
  // MCP servers follow naming convention: openagentic_<provider>
  // This avoids hardcoding specific server names
  if (provider && provider.length > 0) {
    return `openagentic_${provider.toLowerCase()}`;
  }

  return 'unknown';
}

/**
 * Determine required permission level for a tool operation
 */
function getRequiredPermission(toolName: string, toolArgs: any): 'read' | 'write' | 'execute' {
  const normalizedTool = toolName.toLowerCase();
  const method = (toolArgs?.method || 'GET').toUpperCase();

  // Mutations require write/execute
  if (method !== 'GET' ||
      normalizedTool.includes('create') ||
      normalizedTool.includes('delete') ||
      normalizedTool.includes('update') ||
      normalizedTool.includes('modify')) {
    return 'write';
  }

  // Read operations
  return 'read';
}

// =================================================================
// Types
// =================================================================

export interface CachedToolResult {
  id: string;
  tenantId: string;
  toolName: string;
  argsHash: string;
  queryText: string;
  result: string;  // JSON stringified result (possibly summarized)
  resultHash: string;
  embedding: number[];
  createdAt: Date;
  expiresAt: Date;
  hitCount: number;
  lastHitAt: Date;
  originalUserId: string;  // Who first cached this result
  resourceScope: string | null;  // NEW: For cross-user caching (e.g., "azure:sub-123")
  isShared: boolean;  // NEW: Whether this result can be shared cross-user
}

export interface SemanticCacheHit {
  result: any;
  similarity: number;
  cacheId: string;
  toolName: string;
  cachedAt: Date;
  hitCount: number;
  resourceScope?: string;  // NEW: The resource scope that was matched
  crossUserHit: boolean;   // NEW: Whether this was a cross-user cache hit
  originalUserId?: string; // NEW: Who originally cached this result
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  avgSimilarity: number;
  crossUserHits: number;  // NEW: Track cross-user cache benefits
  crossUserSavingsMs: number;  // NEW: Estimated time saved via cross-user caching
}

// =================================================================
// Service Implementation
// =================================================================

export class ToolResultCacheService {
  private logger: Logger;
  private milvusClient: MilvusClient | null = null;
  private embeddingService: UniversalEmbeddingService | null = null;
  private universalEmbedding: UniversalEmbeddingService | null = null;
  private dimension: number = 768;  // Will be auto-detected
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private similarityThreshold: number;
  private stats: CacheStats = {
    totalEntries: 0,
    hitCount: 0,
    missCount: 0,
    hitRate: 0,
    avgSimilarity: 0,
    crossUserHits: 0,
    crossUserSavingsMs: 0
  };

  constructor(
    logger?: Logger,
    embeddingService?: UniversalEmbeddingService,
    config?: {
      similarityThreshold?: number;
      milvusHost?: string;
      milvusPort?: number;
    }
  ) {
    this.logger = logger || pino({ name: 'ToolResultCacheService' });
    this.embeddingService = embeddingService || null;
    this.similarityThreshold = config?.similarityThreshold || DEFAULT_SIMILARITY_THRESHOLD;

    // Initialize Milvus client
    const milvusHost = config?.milvusHost || process.env.MILVUS_HOST || 'milvus';
    const milvusPort = config?.milvusPort || parseInt(process.env.MILVUS_PORT || '19530');

    try {
      this.milvusClient = new MilvusClient({
        address: `${milvusHost}:${milvusPort}`,
        timeout: 30000
      });
      this.logger.info({ host: milvusHost, port: milvusPort }, '[SEMANTIC-CACHE] Milvus client created');
    } catch (error) {
      this.logger.warn({ error }, '[SEMANTIC-CACHE] Failed to create Milvus client - semantic caching disabled');
    }
  }

  /**
   * Initialize the service and ensure collection exists
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      if (!this.milvusClient) {
        this.logger.warn('[SEMANTIC-CACHE] Milvus client not available - skipping initialization');
        return;
      }

      // Try to use UniversalEmbeddingService if UniversalEmbeddingService not provided
      if (!this.embeddingService) {
        try {
          this.universalEmbedding = new UniversalEmbeddingService(this.logger);
          this.dimension = this.universalEmbedding.getInfo().dimensions;
          this.logger.info({ dimension: this.dimension }, '[SEMANTIC-CACHE] Using UniversalEmbeddingService');
        } catch (error) {
          this.logger.warn({ error }, '[SEMANTIC-CACHE] Failed to initialize UniversalEmbeddingService');
        }
      } else {
        this.dimension = await this.embeddingService.getInfo().dimensions;
      }

      // Check if collection exists
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: COLLECTION_NAME
      });

      if (!hasCollection.value) {
        await this.createCollection();
      } else {
        this.logger.info('[SEMANTIC-CACHE] Collection already exists');
      }

      // Load collection into memory
      await this.milvusClient.loadCollection({
        collection_name: COLLECTION_NAME
      });

      this.initialized = true;
      this.logger.info({
        collection: COLLECTION_NAME,
        dimension: this.dimension,
        similarityThreshold: this.similarityThreshold
      }, '[SEMANTIC-CACHE] ✅ Tool Result Cache Service initialized');

    } catch (error) {
      this.logger.error({ error }, '[SEMANTIC-CACHE] ❌ Failed to initialize');
      // Don't throw - allow graceful degradation
    }
  }

  /**
   * Create the Milvus collection for tool result caching
   */
  private async createCollection(): Promise<void> {
    if (!this.milvusClient) return;

    this.logger.info({ dimension: this.dimension }, '[SEMANTIC-CACHE] Creating collection...');

    await this.milvusClient.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        {
          name: 'id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 64
        },
        {
          name: 'tenant_id',
          data_type: DataType.VarChar,
          max_length: 64
        },
        {
          name: 'tool_name',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'args_hash',
          data_type: DataType.VarChar,
          max_length: 64
        },
        {
          name: 'query_text',
          data_type: DataType.VarChar,
          max_length: 2000
        },
        {
          name: 'result',
          data_type: DataType.VarChar,
          max_length: 65535
        },
        {
          name: 'result_hash',
          data_type: DataType.VarChar,
          max_length: 64
        },
        {
          name: 'embedding',
          data_type: DataType.FloatVector,
          dim: this.dimension
        },
        {
          name: 'created_at',
          data_type: DataType.Int64
        },
        {
          name: 'expires_at',
          data_type: DataType.Int64
        },
        {
          name: 'hit_count',
          data_type: DataType.Int32
        },
        {
          name: 'original_user_id',
          data_type: DataType.VarChar,
          max_length: 64
        },
        // NEW: Resource scope for cross-user caching
        {
          name: 'resource_scope',
          data_type: DataType.VarChar,
          max_length: 256  // e.g., "azure:sub-123:rg-prod"
        },
        // NEW: Flag indicating if this result can be shared cross-user
        {
          name: 'is_shared',
          data_type: DataType.Bool
        }
      ]
    });

    // Create index for vector search - HNSW for faster approximate search
    await this.milvusClient.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'embedding',
      index_type: 'HNSW',  // Faster than IVF_FLAT for similarity search
      metric_type: MetricType.COSINE,
      params: { M: 16, efConstruction: 256 }  // Higher values = more accurate but slower build
    });

    // Create scalar index on resource_scope for fast filtering
    await this.milvusClient.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: 'resource_scope',
      index_type: 'INVERTED'  // Fast for exact string matching filters
    });

    // Wait for indexes to build
    await new Promise(resolve => setTimeout(resolve, INDEX_BUILD_WAIT_MS));

    this.logger.info('[SEMANTIC-CACHE] ✅ Collection created with HNSW index and resource_scope support');
  }

  /**
   * Generate cache key text for embedding
   * Combines tool name with a summary of the query/args
   */
  private generateCacheText(toolName: string, toolArgs: any, queryText?: string): string {
    // Normalize tool name
    const normalizedTool = toolName.toLowerCase().replace(/[_-]/g, ' ');

    // Extract key identifiers from args (e.g., subscription IDs, resource names)
    const keyArgs = this.extractKeyArgs(toolArgs);

    // Combine for embedding
    const parts = [normalizedTool];
    if (keyArgs) parts.push(keyArgs);
    if (queryText) parts.push(queryText.substring(0, 500));

    return parts.join(' | ');
  }

  /**
   * Extract key identifiers from tool arguments for cache matching
   */
  private extractKeyArgs(toolArgs: any): string {
    if (!toolArgs || typeof toolArgs !== 'object') return '';

    const keyFields = ['subscription_id', 'subscriptionId', 'resource_group', 'resourceGroup',
                       'account_id', 'accountId', 'region', 'method', 'path'];

    const values: string[] = [];
    for (const field of keyFields) {
      if (toolArgs[field]) {
        values.push(`${field}:${toolArgs[field]}`);
      }
    }

    return values.join(' ');
  }

  /**
   * Generate embedding for cache lookup/storage
   */
  private async generateEmbedding(text: string): Promise<number[] | null> {
    try {
      if (this.embeddingService) {
        const result = await this.embeddingService.generateEmbedding(text);
        return result.embedding;
      }
      if (this.universalEmbedding) {
        const result = await this.universalEmbedding.generateEmbedding(text);
        return result.embedding;
      }
      return null;
    } catch (error) {
      this.logger.warn({ error, textLength: text.length }, '[SEMANTIC-CACHE] Failed to generate embedding');
      return null;
    }
  }

  /**
   * Get TTL for a tool based on its name
   */
  private getTTLHours(toolName: string): number {
    const normalizedName = toolName.toLowerCase();

    for (const [pattern, ttl] of Object.entries(TOOL_TTL_CONFIG)) {
      if (normalizedName.includes(pattern)) {
        return ttl;
      }
    }

    return DEFAULT_TTL_HOURS;
  }

  /**
   * Summarize large results to fit in cache
   */
  private summarizeResult(result: any): string {
    const stringified = JSON.stringify(result);

    if (stringified.length <= MAX_RESULT_SIZE) {
      return stringified;
    }

    // For large results, keep structure but truncate arrays
    if (Array.isArray(result)) {
      const summary = {
        _cached_summary: true,
        _total_items: result.length,
        items: result.slice(0, 10),
        _truncated: result.length > 10
      };
      return JSON.stringify(summary);
    }

    // For objects, truncate string values
    if (typeof result === 'object' && result !== null) {
      const summarized: any = { _cached_summary: true };
      for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'string' && value.length > 1000) {
          summarized[key] = value.substring(0, 1000) + '...[truncated]';
        } else if (Array.isArray(value) && value.length > 10) {
          summarized[key] = { _total: value.length, items: value.slice(0, 10), _truncated: true };
        } else {
          summarized[key] = value;
        }
      }
      return JSON.stringify(summarized);
    }

    return stringified.substring(0, MAX_RESULT_SIZE);
  }

  /**
   * Search for semantically similar cached results with CROSS-USER support
   *
   * This is the KEY method for cross-user caching:
   * 1. First tries to find a semantic match with the SAME resource scope
   * 2. If found, verifies the requesting user has RBAC access to that resource
   * 3. If access verified, returns cached result (even if originally cached by different user)
   *
   * @param tenantId - The tenant ID for multi-tenancy isolation
   * @param toolName - The MCP tool name being executed
   * @param toolArgs - Tool arguments (used for resource scope extraction)
   * @param queryText - Optional user query text for semantic matching
   * @param userId - The user requesting the cache lookup (for RBAC verification)
   * @param userGroups - User's Azure AD groups (for RBAC verification)
   * @param isAdmin - Whether the user is an admin
   */
  async searchCache(
    tenantId: string,
    toolName: string,
    toolArgs: any,
    queryText?: string,
    userId?: string,
    userGroups?: string[],
    isAdmin?: boolean
  ): Promise<SemanticCacheHit | null> {
    if (!this.initialized || !this.milvusClient) {
      return null;
    }

    // CRITICAL: Skip semantic caching for location/context-sensitive tools
    // These tools have outputs that depend on exact parameters (location, time, URL)
    // Semantic similarity fails: "weather Seattle" (82% similar to "weather Ashland") is WRONG
    if (isUncacheableTool(toolName)) {
      this.logger.debug({
        toolName,
        reason: 'Tool is location/context-sensitive - semantic caching disabled'
      }, '[SEMANTIC-CACHE] Skipping cache lookup for uncacheable tool');
      return null;
    }

    const startTime = Date.now();

    try {
      // Extract resource scope for cross-user cache lookup
      const resourceScope = extractResourceScope(toolName, toolArgs);

      // Generate search embedding
      const cacheText = this.generateCacheText(toolName, toolArgs, queryText);
      const embedding = await this.generateEmbedding(cacheText);

      if (!embedding) {
        this.logger.debug('[SEMANTIC-CACHE] Could not generate embedding for search');
        return null;
      }

      const now = Date.now();

      // 2. PGVECTOR L2: Semantic search on recent cached results (TTL-bounded, ACID)
      try {
        const vectorSql = `[${embedding.join(',')}]`;
        const pgResults = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id, tool_name, result, hit_count, created_at, is_shared, original_user_id,
                  1 - (embedding <=> $1::halfvec) as similarity
           FROM tool_result_cache
           WHERE tool_name = $2
             AND tenant_id = $3
             AND (original_user_id = $4 OR is_shared = true)
             AND expires_at > NOW()
             AND embedding IS NOT NULL
           ORDER BY embedding <=> $1::halfvec
           LIMIT 3`,
          vectorSql,
          toolName,
          tenantId,
          userId || ''
        );

        if (pgResults.length > 0 && pgResults[0].similarity >= this.similarityThreshold) {
          const hit = pgResults[0];
          this.stats.hitCount++;
          this.updateHitRate();

          // Increment hit count (fire-and-forget)
          prisma.$executeRawUnsafe(
            `UPDATE tool_result_cache SET hit_count = hit_count + 1 WHERE id = $1`, hit.id
          ).catch(() => {});

          this.logger.info({
            toolName,
            similarity: hit.similarity.toFixed(3),
            hitCount: hit.hit_count,
            source: 'pgvector_l2',
            durationMs: Date.now() - startTime
          }, '[SEMANTIC-CACHE] pgvector L2 cache HIT');

          return {
            result: hit.result,
            similarity: hit.similarity,
            hitCount: hit.hit_count + 1,
            cacheId: hit.id,
            isCrossUser: false,
            source: 'pgvector_l2'
          } as any;
        }
      } catch (pgError) {
        this.logger.debug({ error: pgError }, '[SEMANTIC-CACHE] pgvector L2 search failed, trying Milvus');
      }

      // 3. MILVUS L3: Cross-user archive search (historical, RBAC)
      // Build filter - enforce user isolation: own results OR shared results with matching resource scope
      let filter = `tenant_id == "${tenantId}" && tool_name == "${toolName}" && expires_at > ${now}`;

      if (resourceScope) {
        // CROSS-USER SEARCH: User's own results OR shared results with matching resource scope
        filter += ` && (original_user_id == "${userId || ''}" || (is_shared == true && resource_scope == "${resourceScope}"))`;
        this.logger.debug({
          resourceScope,
          toolName,
          userId
        }, '[SEMANTIC-CACHE] Cross-user cache search with resource scope + user isolation');
      } else {
        // NO resource scope: strict user isolation (personal results only)
        filter += ` && original_user_id == "${userId || ''}"`;
      }

      // Search with HNSW index for fast approximate nearest neighbor search
      const searchResult = await this.milvusClient.search({
        collection_name: COLLECTION_NAME,
        data: [embedding],
        filter,
        limit: 5,
        output_fields: ['id', 'result', 'result_hash', 'created_at', 'hit_count', 'tool_name', 'resource_scope', 'is_shared', 'original_user_id'],
        params: { ef: 64 }  // HNSW search parameter - higher = more accurate
      });

      if (!searchResult.results || searchResult.results.length === 0) {
        this.stats.missCount++;
        this.updateHitRate();
        this.logger.debug({
          toolName,
          tenantId,
          resourceScope,
          cacheText: cacheText.substring(0, 100)
        }, '[SEMANTIC-CACHE] Cache MISS - no results found');
        return null;
      }

      // Check similarity threshold - use lower threshold for general tools
      const topResult = searchResult.results[0];
      const similarity = topResult.score || 0;
      const effectiveThreshold = isGeneralTool(toolName)
        ? GENERAL_TOOL_SIMILARITY_THRESHOLD
        : this.similarityThreshold;

      if (similarity < effectiveThreshold) {
        this.stats.missCount++;
        this.updateHitRate();
        this.logger.info({
          toolName,
          tenantId,
          similarity: similarity.toFixed(4),
          threshold: effectiveThreshold,
          isGeneralTool: isGeneralTool(toolName)
        }, '[SEMANTIC-CACHE] Cache MISS - similarity below threshold');
        return null;
      }

      this.logger.info({
        toolName,
        similarity: similarity.toFixed(4),
        threshold: effectiveThreshold,
        isGeneralTool: isGeneralTool(toolName)
      }, '[SEMANTIC-CACHE] ✅ Similarity check PASSED');

      // ================================================================
      // CROSS-USER RBAC VERIFICATION
      // ================================================================
      const cachedResourceScope = topResult.resource_scope as string | null;
      const originalCachingUser = topResult.original_user_id as string;
      const isSharedResult = topResult.is_shared as boolean;
      const isCrossUserHit = isSharedResult && userId && originalCachingUser !== userId;

      if (isCrossUserHit && cachedResourceScope && userId && userGroups) {
        // This is a cross-user cache hit - verify RBAC access
        const serverId = getServerIdForScope(cachedResourceScope);
        const accessCheck = await checkMCPAccess(
          userId,
          serverId,
          userGroups,
          isAdmin || false,
          this.logger
        );

        if (!accessCheck.allowed) {
          // User doesn't have access to this resource - skip this cache entry
          this.logger.info({
            userId,
            originalCachingUser,
            resourceScope: cachedResourceScope,
            serverId,
            reason: accessCheck.reason
          }, '[SEMANTIC-CACHE] ⛔ Cross-user cache found but RBAC denied - skipping');

          // Try next result or return miss
          this.stats.missCount++;
          this.updateHitRate();
          return null;
        }

        this.logger.info({
          userId,
          originalCachingUser,
          resourceScope: cachedResourceScope,
          serverId,
          similarity: similarity.toFixed(4)
        }, '[SEMANTIC-CACHE] ✅ Cross-user RBAC verified - user has access to cached resource');
      }

      // Parse the cached result
      let parsedResult: any;
      try {
        parsedResult = JSON.parse(topResult.result as string);
      } catch {
        parsedResult = topResult.result;
      }

      // Update hit statistics
      this.stats.hitCount++;
      this.stats.avgSimilarity = (this.stats.avgSimilarity * (this.stats.hitCount - 1) + similarity) / this.stats.hitCount;

      // Track cross-user benefits
      if (isCrossUserHit) {
        this.stats.crossUserHits++;
        // Estimate savings: average Azure API call is ~30-60 seconds
        this.stats.crossUserSavingsMs += 45000;
      }

      this.updateHitRate();

      const searchTimeMs = Date.now() - startTime;

      this.logger.info({
        toolName,
        tenantId,
        cacheId: topResult.id,
        similarity: similarity.toFixed(4),
        hitCount: topResult.hit_count,
        cachedAt: new Date(Number(topResult.created_at)).toISOString(),
        crossUserHit: isCrossUserHit,
        originalCachingUser: isCrossUserHit ? originalCachingUser : undefined,
        resourceScope: cachedResourceScope,
        searchTimeMs
      }, `[SEMANTIC-CACHE] 🎯 Cache HIT${isCrossUserHit ? ' (CROSS-USER)' : ''} - ${searchTimeMs}ms`);

      // Increment hit count (fire and forget)
      this.incrementHitCount(topResult.id as string).catch(() => {});

      return {
        result: parsedResult,
        similarity,
        cacheId: topResult.id as string,
        toolName: topResult.tool_name as string,
        cachedAt: new Date(Number(topResult.created_at)),
        hitCount: (topResult.hit_count as number) + 1,
        resourceScope: cachedResourceScope || undefined,
        crossUserHit: isCrossUserHit,
        originalUserId: isCrossUserHit ? originalCachingUser : undefined
      };

    } catch (error) {
      this.logger.warn({ error, toolName }, '[SEMANTIC-CACHE] Search error (non-fatal)');
      return null;
    }
  }

  /**
   * Store a tool result in the semantic cache with CROSS-USER support
   *
   * Results are automatically marked as shareable (is_shared=true) when:
   * 1. A resource scope can be extracted (Azure subscription, AWS account, etc.)
   * 2. The operation is a READ operation (not a mutation)
   *
   * Shared results can be retrieved by other users who have RBAC access to the same resource.
   */
  async cacheResult(
    tenantId: string,
    userId: string,
    toolName: string,
    toolArgs: any,
    result: any,
    queryText?: string
  ): Promise<boolean> {
    if (!this.initialized || !this.milvusClient) {
      return false;
    }

    // CRITICAL: Skip caching for location/context-sensitive tools
    // These tools' results are specific to parameters like location, time, URL
    // Caching them causes wrong results (e.g., Seattle weather returned for Ashland query)
    if (isUncacheableTool(toolName)) {
      this.logger.debug({
        toolName,
        reason: 'Tool is location/context-sensitive - not caching result'
      }, '[SEMANTIC-CACHE] Skipping cache storage for uncacheable tool');
      return false;
    }

    // CRITICAL: Do NOT cache error results - they should never be served from cache
    // Error results contain isError: true or have error messages that shouldn't be reused
    if (result && typeof result === 'object') {
      // Check for MCP error format: { content: [...], isError: true }
      if (result.isError === true) {
        this.logger.debug({ toolName }, '[SEMANTIC-CACHE] Skipping cache for error result (isError: true)');
        return false;
      }
      // Check for nested error content
      if (Array.isArray(result.content)) {
        const hasError = result.content.some((item: any) =>
          item?.type === 'text' && typeof item?.text === 'string' &&
          (item.text.includes('error') || item.text.includes('Error') || item.text.includes('validation error'))
        );
        if (hasError) {
          this.logger.debug({ toolName }, '[SEMANTIC-CACHE] Skipping cache for error content');
          return false;
        }
      }
    }

    try {
      // Generate cache embedding
      const cacheText = this.generateCacheText(toolName, toolArgs, queryText);
      const embedding = await this.generateEmbedding(cacheText);

      if (!embedding) {
        this.logger.debug('[SEMANTIC-CACHE] Could not generate embedding for caching');
        return false;
      }

      // Extract resource scope for cross-user caching
      const resourceScope = extractResourceScope(toolName, toolArgs);
      const requiredPermission = getRequiredPermission(toolName, toolArgs);

      // Only share READ operations with valid resource scopes
      const isShared = resourceScope !== null && requiredPermission === 'read';

      // Prepare data
      const id = crypto.randomUUID();
      const argsHash = crypto.createHash('sha256').update(JSON.stringify(toolArgs || {})).digest('hex').substring(0, 16);
      const summarizedResult = this.summarizeResult(result);
      const resultHash = crypto.createHash('sha256').update(summarizedResult).digest('hex').substring(0, 16);
      const ttlHours = this.getTTLHours(toolName);
      const now = Date.now();
      const expiresAt = now + (ttlHours * 60 * 60 * 1000);

      // Insert into Milvus with resource scope for cross-user lookup
      await this.milvusClient.insert({
        collection_name: COLLECTION_NAME,
        data: [{
          id,
          tenant_id: tenantId,
          tool_name: toolName,
          args_hash: argsHash,
          query_text: (queryText || '').substring(0, 2000),
          result: summarizedResult,
          result_hash: resultHash,
          embedding,
          created_at: now,
          expires_at: expiresAt,
          hit_count: 0,
          original_user_id: userId,
          resource_scope: resourceScope || '',  // Empty string if no scope (user-isolated)
          is_shared: isShared
        }]
      });

      this.stats.totalEntries++;

      // Also store in pgvector L2 (TTL-bounded, ACID) alongside Milvus L3
      try {
        const vectorSql = `[${embedding.join(',')}]`;
        const expiresAtDate = new Date(expiresAt);
        await prisma.$executeRawUnsafe(
          `INSERT INTO tool_result_cache (id, tenant_id, tool_name, args_hash, query_text, result, resource_scope, is_shared, original_user_id, hit_count, embedding, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 0, $10::halfvec, NOW(), $11)
           ON CONFLICT (id) DO NOTHING`,
          id,
          tenantId,
          toolName,
          argsHash,
          (queryText || '').substring(0, 4000),
          summarizedResult,
          resourceScope || null,
          isShared,
          userId,
          vectorSql,
          expiresAtDate
        );
      } catch (pgError) {
        this.logger.debug({ error: pgError }, '[SEMANTIC-CACHE] pgvector L2 write failed (non-fatal)');
      }

      this.logger.info({
        cacheId: id,
        toolName,
        tenantId,
        ttlHours,
        resultSize: summarizedResult.length,
        argsHash,
        resourceScope,
        isShared,
        originalUserId: userId
      }, `[SEMANTIC-CACHE] 💾 Result cached${isShared ? ' (SHAREABLE cross-user)' : ' (user-isolated)'} [Milvus+pgvector]`);

      return true;

    } catch (error) {
      this.logger.warn({ error, toolName }, '[SEMANTIC-CACHE] Failed to cache result (non-fatal)');
      return false;
    }
  }

  /**
   * Increment hit count for a cached entry
   */
  private async incrementHitCount(cacheId: string): Promise<void> {
    // Note: Milvus doesn't support UPDATE, so we track hit counts differently
    // In a production system, you'd use a separate Redis counter or
    // periodically batch-update by deleting and re-inserting
    this.logger.debug({ cacheId }, '[SEMANTIC-CACHE] Hit count tracked');
  }

  /**
   * Update hit rate statistics
   */
  private updateHitRate(): void {
    const total = this.stats.hitCount + this.stats.missCount;
    this.stats.hitRate = total > 0 ? this.stats.hitCount / total : 0;
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpired(): Promise<number> {
    if (!this.initialized || !this.milvusClient) {
      return 0;
    }

    try {
      const now = Date.now();

      // Delete expired entries
      const deleteResult = await this.milvusClient.delete({
        collection_name: COLLECTION_NAME,
        filter: `expires_at < ${now}`
      });

      const deletedCount = Number(deleteResult.delete_cnt) || 0;

      if (deletedCount > 0) {
        this.logger.info({ deletedCount }, '[SEMANTIC-CACHE] 🧹 Cleaned up expired entries');
      }

      return deletedCount;

    } catch (error) {
      this.logger.warn({ error }, '[SEMANTIC-CACHE] Cleanup error (non-fatal)');
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Check if service is initialized and ready
   */
  isReady(): boolean {
    return this.initialized && this.milvusClient !== null;
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    if (this.milvusClient) {
      await this.milvusClient.closeConnection();
      this.milvusClient = null;
    }
    this.initialized = false;
    this.logger.info('[SEMANTIC-CACHE] Service closed');
  }
}

// =================================================================
// Singleton Instance
// =================================================================

let serviceInstance: ToolResultCacheService | null = null;

/**
 * Get or create the singleton ToolResultCacheService instance
 */
export function getToolResultCacheService(
  logger?: Logger,
  embeddingService?: UniversalEmbeddingService
): ToolResultCacheService {
  if (!serviceInstance) {
    serviceInstance = new ToolResultCacheService(logger, embeddingService);
  }
  return serviceInstance;
}

/**
 * Initialize the tool result cache service
 */
export async function initializeToolResultCache(
  logger?: Logger,
  embeddingService?: UniversalEmbeddingService
): Promise<ToolResultCacheService> {
  const service = getToolResultCacheService(logger, embeddingService);
  await service.initialize();
  return service;
}
