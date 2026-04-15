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
 * Tool Semantic Cache Service
 *
 * Implements semantic caching for MCP tools using Milvus vector database.
 * Stores tool definitions with embeddings and provides semantic search
 * to find relevant tools based on natural language queries.
 *
 * Features:
 * - Store all MCP tools in Milvus with vector embeddings
 * - Semantic search to find relevant tools by description/intent
 * - Automatic indexing and cache management
 * - Supports OpenAI function format output
 */

import { MilvusClient, DataType, MetricType, IndexType } from '@zilliz/milvus2-sdk-node';
import { loggers } from '../utils/logger.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { redis as redisService } from './redis.js';
import { getRedisClient } from '../utils/redis-client.js';
import type { ProviderManager } from './llm-providers/ProviderManager.js';
import { extractToolTags } from '../utils/toolTagExtractor.js';
import { randomUUID, createHash } from 'crypto';

// Collection name for tool cache
const TOOLS_COLLECTION_NAME = 'mcp_tools_cache';
const REDIS_CACHE_KEY = 'mcp_tools_cache';

// Distributed lock constants for Kubernetes/multi-instance deployments
const MCP_INDEX_LOCK_KEY = 'mcp_tools_indexing';
const MCP_INDEX_LOCK_TTL_SECONDS = 300; // 5 minutes - should be enough for indexing
const MCP_INDEX_COOLDOWN_KEY = 'mcp_tools_last_indexed';

// Vector dimensions - populated dynamically
let EMBEDDING_DIMENSIONS = 768; // Default, will be updated during initialization

/**
 * MCP Tool interface matching the MCP protocol
 */
export interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  server_name?: string;
  // CRITICAL: Original MCP tool name before sanitization
  // Used for routing tool calls to MCP proxy (e.g., aws___search_documentation)
  original_tool_name?: string;
}

/**
 * OpenAI function format for tool definitions
 */
export interface OpenAIFunction {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties?: Record<string, any>;
      required?: string[];
    };
  };
}

/**
 * Cached tool with metadata
 */
interface CachedTool {
  id: string;
  tool_name: string;
  description: string;
  server_name: string;
  parameters_json: string;
  embedding: number[];
  metadata: Record<string, any>;
}

/**
 * Search result with relevance score
 */
export interface ToolSearchResult extends Tool {
  score: number;
  relevance: number;
}

/**
 * Tool Semantic Cache Service
 * Provides semantic search and caching for MCP tools using Milvus
 */
export class ToolSemanticCacheService {
  private client: MilvusClient;
  private embeddingService: UniversalEmbeddingService;
  private _isInitialized: boolean = false;
  private logger = loggers.services.child({ service: 'tool-semantic-cache' });
  private providerManager?: ProviderManager;
  // Unique instance ID for distributed locking (Kubernetes/multi-instance)
  private readonly instanceId: string = `api-${process.env.HOSTNAME || process.env.POD_NAME || randomUUID().substring(0, 8)}`;

  constructor(providerManager?: ProviderManager) {
    this.providerManager = providerManager;
    // Initialize Milvus client
    if (!process.env.MILVUS_HOST || !process.env.MILVUS_PORT) {
      throw new Error('MILVUS_HOST and MILVUS_PORT must be configured');
    }

    const milvusTimeout = parseInt(process.env.MILVUS_TIMEOUT || '120000');
    this.client = new MilvusClient({
      address: `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
      username: process.env.MILVUS_USERNAME,
      password: process.env.MILVUS_PASSWORD,
      timeout: milvusTimeout
    });

    // Initialize embedding service with ProviderManager
    this.embeddingService = new UniversalEmbeddingService(this.logger);
    // Dimension will be auto-detected during initialize()

    this.logger.info('ToolSemanticCacheService initialized', {
      milvusAddress: `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
      embeddingDimensions: 'auto-detect',
      hasProviderManager: !!providerManager
    });
  }

  /**
   * Check if the service is initialized
   */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Initialize the service and create necessary collections
   */
  async initialize(): Promise<void> {
    try {
      // Auto-detect embedding dimensions first
      EMBEDDING_DIMENSIONS = await this.embeddingService.getInfo().dimensions;
      this.logger.info({
        detectedDimensions: EMBEDDING_DIMENSIONS,
        model: this.embeddingService.getInfo().model
      }, '✅ Embedding dimensions auto-detected');

      // Test embedding service connection
      const testResult = await this.embeddingService.isConfigured();
      if (!testResult) {
        throw new Error('Embedding service connection test failed');
      }

      // Check Milvus health
      const health = await this.client.checkHealth();
      this.logger.info('Milvus health check', { health });

      // Create or load tools collection (will use auto-detected dimensions)
      await this.ensureCollectionExists();

      this._isInitialized = true;
      this.logger.info('ToolSemanticCacheService initialization complete', {
        collectionName: TOOLS_COLLECTION_NAME,
        embeddingModel: this.embeddingService.getInfo().model,
        dimensions: EMBEDDING_DIMENSIONS
      });

      // Check if collection is empty (happens after dimension mismatch recreation)
      const stats = await this.client.getCollectionStatistics({
        collection_name: TOOLS_COLLECTION_NAME
      });
      const toolCount = parseInt(stats.data.row_count || '0');

      if (toolCount === 0) {
        this.logger.warn({
          collectionName: TOOLS_COLLECTION_NAME,
          toolCount: 0,
          action: 'NEEDS_REINDEX'
        }, '⚠️ Tools collection is empty - auto-indexing will be triggered on first request');
      } else {
        this.logger.info({
          collectionName: TOOLS_COLLECTION_NAME,
          toolCount,
          embeddingDimensions: EMBEDDING_DIMENSIONS
        }, '✅ Tools collection ready with existing tools');
      }

    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize ToolSemanticCacheService');
      throw error;
    }
  }

  /**
   * Ensure the tools collection exists, create if not
   * IMPORTANT: Auto-recreates collection if embedding dimensions changed
   */
  private async ensureCollectionExists(): Promise<void> {
    try {
      const hasCollection = await this.client.hasCollection({
        collection_name: TOOLS_COLLECTION_NAME
      });

      if (!hasCollection.value) {
        this.logger.info('Creating tools collection', {
          collectionName: TOOLS_COLLECTION_NAME,
          embeddingDimensions: EMBEDDING_DIMENSIONS
        });
        await this.createToolsCollection();
      } else {
        // Check if existing collection has correct embedding dimensions
        const collectionInfo = await this.client.describeCollection({
          collection_name: TOOLS_COLLECTION_NAME
        });

        // Find embedding field and check dimensions (single-vector schema for Milvus v2.3.x)
        const embeddingField = collectionInfo.schema.fields.find((f: any) => f.name === 'embedding');

        // IMPORTANT: Milvus returns dim as string, need to convert for proper comparison
        const existingDim = embeddingField?.dim ? Number(embeddingField.dim) : null;

        if (existingDim && existingDim !== EMBEDDING_DIMENSIONS) {
          this.logger.warn({
            collectionName: TOOLS_COLLECTION_NAME,
            existingDimension: existingDim,
            requiredDimension: EMBEDDING_DIMENSIONS,
            action: 'RECREATING COLLECTION'
          }, '⚠️ DIMENSION MISMATCH DETECTED - Dropping and recreating collection with correct dimensions');

          // Drop the collection with wrong dimensions
          await this.client.dropCollection({
            collection_name: TOOLS_COLLECTION_NAME
          });

          // Create new collection with correct dimensions
          await this.createToolsCollection();

          this.logger.info('✅ Collection recreated with correct dimensions', {
            oldDimension: existingDim,
            newDimension: EMBEDDING_DIMENSIONS
          });
        } else {
          // Load collection into memory
          await this.client.loadCollection({
            collection_name: TOOLS_COLLECTION_NAME
          });

          // CRITICAL: Wait for collection to be fully loaded before proceeding
          // loadCollection is async - collection isn't queryable until load completes
          await this.waitForCollectionLoaded(TOOLS_COLLECTION_NAME);

          this.logger.info('Tools collection loaded', {
            collectionName: TOOLS_COLLECTION_NAME,
            embeddingDimensions: existingDim || EMBEDDING_DIMENSIONS
          });
        }
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to ensure collection exists');
      throw error;
    }
  }

  /**
   * Wait for a collection to be fully loaded into memory
   * Milvus loadCollection is async - we must poll until load state is "Loaded"
   * This prevents the race condition where stats show 0 rows before load completes
   */
  private async waitForCollectionLoaded(collectionName: string, maxWaitMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    const pollIntervalMs = 500;

    this.logger.debug({ collectionName }, 'Waiting for collection to be fully loaded...');

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const loadState = await this.client.getLoadState({
          collection_name: collectionName
        });

        // LoadState enum: NotExist=0, NotLoad=1, Loading=2, Loaded=3
        // Check both string and numeric representations for compatibility
        if (loadState.state === 'LoadStateLoaded' || String(loadState.state) === '3' || String(loadState.state) === 'Loaded') {
          this.logger.debug({
            collectionName,
            waitTimeMs: Date.now() - startTime
          }, 'Collection fully loaded');
          return;
        }

        this.logger.trace({
          collectionName,
          state: loadState.state,
          elapsedMs: Date.now() - startTime
        }, 'Collection still loading...');

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        this.logger.warn({ error, collectionName }, 'Error checking load state, retrying...');
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    this.logger.warn({
      collectionName,
      maxWaitMs,
      elapsedMs: Date.now() - startTime
    }, 'Timed out waiting for collection to load - proceeding anyway');
  }

  /**
   * Create the tools collection with proper schema
   * Single-vector schema compatible with Milvus v2.3.x (multi-vector requires v2.4+)
   * Uses combined embedding of name + description + synthetic queries
   */
  private async createToolsCollection(): Promise<void> {
    try {
      // Define schema for tool storage with SINGLE-VECTOR embedding (Milvus v2.3.x compatible)
      const fields = [
        {
          name: 'id',
          data_type: DataType.VarChar,
          is_primary_key: true,
          max_length: 256
        },
        {
          name: 'tool_name',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'description',
          data_type: DataType.VarChar,
          max_length: 2048
        },
        {
          name: 'server_name',
          data_type: DataType.VarChar,
          max_length: 256
        },
        {
          name: 'parameters_json',
          data_type: DataType.VarChar,
          max_length: 8192
        },
        {
          name: 'tags',
          data_type: DataType.VarChar,
          max_length: 1024,
          description: 'Comma-separated searchable tags (abbreviations, keywords, etc.)'
        },
        {
          name: 'synthetic_queries',
          data_type: DataType.VarChar,
          max_length: 1024,
          description: 'Comma-separated synthetic user queries for this tool'
        },
        // Single combined embedding (Milvus v2.3.x compatible)
        // Combines: tool name + description + synthetic queries
        {
          name: 'embedding',
          data_type: DataType.FloatVector,
          dim: EMBEDDING_DIMENSIONS,
          description: 'Combined embedding of tool name, description, and synthetic queries'
        },
        {
          name: 'metadata',
          data_type: DataType.JSON
        }
      ];

      await this.client.createCollection({
        collection_name: TOOLS_COLLECTION_NAME,
        fields,
        enable_dynamic_field: true,
        consistency_level: 'Strong' as any
      });

      // Create vector index for semantic search
      // Use FLAT (brute-force) index for small datasets (<1000 vectors)
      await this.client.createIndex({
        collection_name: TOOLS_COLLECTION_NAME,
        field_name: 'embedding',
        index_type: 'FLAT',
        metric_type: 'COSINE',
        params: {}
      });

      // Create scalar indexes for filtering
      await this.client.createIndex({
        collection_name: TOOLS_COLLECTION_NAME,
        field_name: 'tool_name',
        index_type: 'INVERTED'
      });

      await this.client.createIndex({
        collection_name: TOOLS_COLLECTION_NAME,
        field_name: 'server_name',
        index_type: 'INVERTED'
      });

      // Load collection into memory
      await this.client.loadCollection({
        collection_name: TOOLS_COLLECTION_NAME
      });

      this.logger.info('Tools collection created successfully with single-vector schema (Milvus v2.3.x compatible)', {
        collectionName: TOOLS_COLLECTION_NAME,
        dimensions: EMBEDDING_DIMENSIONS,
        vectorField: 'embedding'
      });
    } catch (error) {
      this.logger.error({ error }, 'Failed to create tools collection');
      throw error;
    }
  }

  /**
   * Auto-index tools when both Milvus and MCP Proxy are ready
   * This triggers automatically when connections are established
   *
   * DISTRIBUTED LOCK:
   * Uses Redis distributed lock to prevent multiple API instances (Docker Compose restarts,
   * Kubernetes pods) from indexing simultaneously, which would cause:
   * - Data corruption in Milvus (partial writes, race conditions)
   * - Wasted compute resources (embedding generation is expensive)
   * - Inconsistent tool availability across instances
   */
  async autoIndexToolsWhenReady(): Promise<void> {
    this.logger.info({
      isInitialized: this._isInitialized,
      milvusHost: process.env.MILVUS_HOST,
      milvusPort: process.env.MILVUS_PORT,
      mcpProxyEndpoint: process.env.MCP_PROXY_ENDPOINT,
      hasMcpProxyKey: !!process.env.MCP_PROXY_API_KEY,
      instanceId: this.instanceId
    }, '[AUTO-INDEX] ========== STARTING AUTO-INDEX TOOLS ==========');

    if (!this._isInitialized) {
      this.logger.error('Tool semantic cache not initialized, skipping auto-index');
      return;
    }

    // Get Redis client for distributed locking
    const redisClient = getRedisClient();

    // CRITICAL: Check if collection is actually empty - this takes priority over cooldown
    // This handles the case where collection was recreated due to dimension mismatch
    // but cooldown from previous instance prevents repopulation
    let collectionIsEmpty = false;
    try {
      const stats = await this.client.getCollectionStatistics({
        collection_name: TOOLS_COLLECTION_NAME
      });
      const toolCount = parseInt(stats.data.row_count || '0');
      collectionIsEmpty = toolCount === 0;

      if (collectionIsEmpty) {
        this.logger.warn({
          toolCount,
          collectionName: TOOLS_COLLECTION_NAME,
          reason: 'COLLECTION_EMPTY_OVERRIDE'
        }, '[AUTO-INDEX] ⚠️ Collection is empty - ignoring cooldown and proceeding with indexing');
      }
    } catch (err: any) {
      this.logger.warn({
        error: err.message
      }, '[AUTO-INDEX] ⚠️ Could not check collection stats, proceeding with cooldown check');
    }

    // Check if another instance recently indexed (cooldown period)
    // BUT: Skip cooldown check if collection is empty (needs repopulation)
    if (!collectionIsEmpty) {
      const lastIndexed = await redisClient.get<{ timestamp: number; instanceId: string }>(MCP_INDEX_COOLDOWN_KEY);
      if (lastIndexed) {
        const timeSinceLastIndex = Date.now() - lastIndexed.timestamp;
        const cooldownMs = 60000; // 1 minute cooldown

        if (timeSinceLastIndex < cooldownMs) {
          this.logger.info({
            lastIndexedBy: lastIndexed.instanceId,
            lastIndexedAt: new Date(lastIndexed.timestamp).toISOString(),
            timeSinceLastIndex: `${Math.round(timeSinceLastIndex / 1000)}s`,
            cooldownRemaining: `${Math.round((cooldownMs - timeSinceLastIndex) / 1000)}s`
          }, '[AUTO-INDEX] 🔒 Skipping - recently indexed by another instance (cooldown period)');
          return;
        }
      }
    }

    // Attempt to acquire distributed lock
    const lockAcquired = await redisClient.acquireLock(
      MCP_INDEX_LOCK_KEY,
      this.instanceId,
      MCP_INDEX_LOCK_TTL_SECONDS
    );

    if (!lockAcquired) {
      const currentHolder = await redisClient.getLockHolder(MCP_INDEX_LOCK_KEY);
      this.logger.info({
        instanceId: this.instanceId,
        currentLockHolder: currentHolder
      }, '[AUTO-INDEX] 🔒 Skipping - another instance is currently indexing');
      return;
    }

    this.logger.info({
      instanceId: this.instanceId,
      lockTTL: MCP_INDEX_LOCK_TTL_SECONDS
    }, '[AUTO-INDEX] 🔓 Acquired distributed lock - proceeding with indexing');

    try {
      this.logger.info('🔄 Auto-indexing MCP tools from MCP Proxy...');

      // Fetch tools from MCP Proxy (centralized management with OBO support)
      const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

      this.logger.info({
        mcpProxyUrl: MCP_PROXY_URL,
        endpoint: `${MCP_PROXY_URL}/tools`,
      }, '[AUTO-INDEX] About to fetch tools from MCP Proxy');

      const response = await fetch(`${MCP_PROXY_URL}/tools`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(60000) // Increased to 60s for slow startup
      });

      this.logger.info({
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType: response.headers.get('content-type') || 'unknown'
      }, '[AUTO-INDEX] MCP Proxy response details');

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error({
          status: response.status,
          statusText: response.statusText,
          responseBody: errorText
        }, '[AUTO-INDEX] MCP Proxy request failed');
        throw new Error(`MCP Proxy responded with ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      // MCP REST API returns {tools: [...], message: "...", error: null}
      const mcpTools = data.tools || [];

      this.logger.info({
        totalTools: mcpTools.length,
        dataKeys: Object.keys(data),
        dataType: typeof data,
        message: data.message,
        hasError: !!data.error,
        sampleTool: mcpTools[0] || null
      }, '[AUTO-INDEX] Parsed MCP Proxy response');

      if (mcpTools && mcpTools.length > 0) {
        this.logger.info({
          toolCount: mcpTools.length,
          toolNames: mcpTools.map((t: any) => t.name || t.function?.name).slice(0, 10)
        }, '[AUTO-INDEX] Processing tools for indexing');

        // CRITICAL FIX: Compare tool names hash to detect actual changes (not just count)
        // This ensures re-indexing happens when tools are added, removed, or renamed
        if (!collectionIsEmpty) {
          // Generate hash of new tools (sorted names list)
          const newToolNames = mcpTools.map((t: any) => t.name || t.function?.name || '').filter(Boolean).sort();
          const newToolsHash = createHash('md5').update(newToolNames.join(',')).digest('hex').substring(0, 16);

          // Get the stored hash from Redis
          const storedToolsHash = await redisClient.get<string>('mcp_tools_hash');

          const existingStats = await this.client.getCollectionStatistics({
            collection_name: TOOLS_COLLECTION_NAME
          });
          const existingToolCount = parseInt(existingStats.data.row_count || '0');
          const newToolCount = mcpTools.length;

          if (storedToolsHash === newToolsHash && existingToolCount === newToolCount && existingToolCount > 0) {
            this.logger.info({
              existingToolCount,
              newToolCount,
              toolsHash: newToolsHash,
              instanceId: this.instanceId
            }, '[AUTO-INDEX] ✅ Tools unchanged (hash match) - SKIPPING RE-INDEX to preserve data');

            // Still update cooldown to prevent other instances from re-indexing
            await redisClient.set(MCP_INDEX_COOLDOWN_KEY, {
              timestamp: Date.now(),
              instanceId: this.instanceId,
              toolCount: existingToolCount,
              action: 'SKIP_REINDEX'
            }, 600);

            // CRITICAL: Release lock before returning (finally block won't run on early return within try)
            await redisClient.releaseLock(MCP_INDEX_LOCK_KEY, this.instanceId);
            this.logger.info({ instanceId: this.instanceId }, '[AUTO-INDEX] 🔓 Released distributed lock (skip re-index path)');

            return; // EXIT - don't re-index
          }

          this.logger.info({
            existingToolCount,
            newToolCount,
            storedHash: storedToolsHash,
            newHash: newToolsHash,
            toolsChanged: storedToolsHash !== newToolsHash,
            countChanged: existingToolCount !== newToolCount
          }, '[AUTO-INDEX] ⚠️ Tools changed (hash mismatch or count changed) - proceeding with re-index');
        }

        // Transform tools for indexing
        const toolsForIndexing = mcpTools.map((tool: any, index: number) => {
          const transformed = {
            name: tool.name || tool.function?.name,
            description: tool.description || tool.function?.description || 'No description',
            inputSchema: tool.inputSchema || tool.function?.parameters || {},
            server_name: tool.server || tool.serverName || 'unknown',
            metadata: {
              serverName: tool.server || tool.serverName,
              category: tool.category || 'general'
            }
          };

          if (index < 3) {
            this.logger.info({
              originalTool: tool,
              transformedTool: transformed
            }, `[AUTO-INDEX] Sample tool transformation ${index + 1}`);
          }

          return transformed;
        });

        this.logger.info({
          totalTransformed: toolsForIndexing.length,
          validNames: toolsForIndexing.filter(t => !!t.name).length,
          validDescriptions: toolsForIndexing.filter(t => t.description !== 'No description').length
        }, '[AUTO-INDEX] Tools transformation complete, starting indexing');

        await this.indexAllTools(toolsForIndexing);
        // Use actual indexed count instead of querying Milvus stats (which may not be updated yet)
        this.logger.info(`✅ Auto-indexed ${toolsForIndexing.length} MCP tools successfully`);

        // Store tools hash for future change detection
        const toolNames = toolsForIndexing.map(t => t.name || '').filter(Boolean).sort();
        const toolsHash = createHash('md5').update(toolNames.join(',')).digest('hex').substring(0, 16);
        await redisClient.set('mcp_tools_hash', toolsHash, 86400); // Store hash for 24 hours

        this.logger.info({
          toolsHash,
          toolCount: toolsForIndexing.length
        }, '[AUTO-INDEX] Stored tools hash for change detection');

        // Record successful indexing for cooldown
        await redisClient.set(MCP_INDEX_COOLDOWN_KEY, {
          timestamp: Date.now(),
          instanceId: this.instanceId,
          toolCount: toolsForIndexing.length,
          toolsHash: toolsHash
        }, 600); // 10 minute cooldown record

      } else {
        this.logger.error({
          mcpToolsType: typeof mcpTools,
          mcpToolsLength: mcpTools?.length || 0,
          dataObject: data
        }, '⚠️ No MCP tools returned from MCP Proxy');
      }
    } catch (error) {
      this.logger.error({
        error: error.message,
        stack: error.stack,
        errorType: error.constructor.name,
        instanceId: this.instanceId
      }, '❌ Auto-indexing failed - will retry later');
      throw error; // Re-throw to let caller handle it
    } finally {
      // ALWAYS release the lock, even on error
      await redisClient.releaseLock(MCP_INDEX_LOCK_KEY, this.instanceId);
      this.logger.info({
        instanceId: this.instanceId
      }, '[AUTO-INDEX] 🔓 Released distributed lock');
    }
  }

  /**
   * Force indexing with detailed debugging - for manual testing
   */
  async forceIndexToolsWithDebugging(): Promise<{ success: boolean; stats: any; error?: string }> {
    try {
      this.logger.info('🔧 [FORCE-INDEX] Starting force index with detailed debugging');

      await this.autoIndexToolsWhenReady();

      const stats = await this.getCacheStats();
      this.logger.info({ stats }, '✅ [FORCE-INDEX] Force indexing completed successfully');

      return { success: true, stats };
    } catch (error) {
      this.logger.error({
        error: error.message,
        stack: error.stack
      }, '❌ [FORCE-INDEX] Force indexing failed');

      return {
        success: false,
        stats: null,
        error: error.message
      };
    }
  }

  /**
   * Index all tools in Milvus
   * Clears existing cache and re-indexes all tools
   */
  async indexAllTools(tools: Tool[]): Promise<void> {
    if (!this._isInitialized) {
      throw new Error('ToolSemanticCacheService not initialized');
    }

    try {
      this.logger.info('Starting tool indexing (single-vector semantic search)', { toolCount: tools.length });

      // Clear existing tools
      await this.clearAllTools();

      if (tools.length === 0) {
        this.logger.info('No tools to index');
        return;
      }

      // Batch process tools for efficiency
      const batchSize = 100;
      let indexed = 0;

      for (let i = 0; i < tools.length; i += batchSize) {
        const batch = tools.slice(i, i + batchSize);

        this.logger.info({
          batchNumber: Math.floor(i / batchSize) + 1,
          batchStart: i,
          batchEnd: i + batch.length,
          batchSize: batch.length,
          totalTools: tools.length
        }, '[INDEX-BATCH] Starting batch indexing');

        try {
          await this.indexToolBatch(batch);
          indexed += batch.length;

          this.logger.info({
            batchNumber: Math.floor(i / batchSize) + 1,
            indexed,
            total: tools.length,
            progress: `${((indexed / tools.length) * 100).toFixed(1)}%`
          }, '[INDEX-BATCH] ✅ Batch indexed successfully');
        } catch (error) {
          this.logger.error({
            error: error.message,
            stack: error.stack,
            batchNumber: Math.floor(i / batchSize) + 1,
            batchStart: i,
            batchSize: batch.length
          }, '[INDEX-BATCH] ❌ Batch indexing FAILED - this batch was lost!');
          throw error; // Re-throw to stop indexing
        }
      }

      // Flush data to ensure persistence
      this.logger.info('Flushing indexed tools to Milvus...');
      await this.client.flush({
        collection_names: [TOOLS_COLLECTION_NAME]
      });

      // Cache tools in Redis for fallback
      this.logger.info('Caching tools in Redis for fallback...');
      await this.cacheToolsInRedis(tools);

      this.logger.info('Tool indexing complete', {
        totalTools: tools.length,
        indexed
      });
    } catch (error) {
      this.logger.error({ error }, 'Failed to index all tools');
      throw error;
    }
  }

  /**
   * Index a batch of tools with single combined embedding (Milvus v2.3.x compatible)
   */
  private async indexToolBatch(tools: Tool[]): Promise<void> {
    try {
      const records = await Promise.all(
        tools.map(async (tool, index) => {
          const id = this.generateToolId(tool);

          // Truncate description to Milvus max_length (2048 chars)
          const rawDescription = tool.description || `Tool: ${tool.name}`;
          // CRITICAL: Must be <= 2048 BYTES (Milvus varchar max_length)
          // Use 2000 chars to account for multi-byte UTF-8 characters
          // Each char can be up to 4 bytes in UTF-8, but 2000 chars + '...' = 2003 chars
          // should be safe for typical descriptions with mostly ASCII
          const description = rawDescription.length > 2000
            ? rawDescription.substring(0, 2000) + '...'
            : rawDescription;
          const serverName = tool.server_name || 'unknown';

          // Handle missing or invalid inputSchema
          const inputSchema = tool.inputSchema || { type: 'object', properties: {}, required: [] };
          const parametersJson = JSON.stringify(inputSchema);

          // Generate searchable tags from tool name (generic abbreviation extraction)
          const toolTags = extractToolTags(tool.name);
          const tagsString = toolTags.join(',');

          // Generate synthetic queries for better matching
          const syntheticQueries = this.generateSyntheticQueries(tool.name, description);
          const syntheticQueriesString = syntheticQueries.join(',');

          // Generate SINGLE combined embedding (Milvus v2.3.x compatible)
          // Combines: tool name + description + synthetic queries for comprehensive matching
          const combinedText = [
            `Tool: ${tool.name}`,
            description,
            syntheticQueries.join(' ')
          ].join('\n');
          const embedding = await this.generateEmbedding(combinedText);

          // Log embedding for first 3 tools
          if (index < 3) {
            this.logger.info({
              toolName: tool.name,
              embeddingDim: embedding.length,
              combinedTextLength: combinedText.length,
              syntheticQueryCount: syntheticQueries.length
            }, '[EMBEDDING] Generated combined embedding');
          }

          // Sanitize tool name - collapse multiple underscores, ensure valid chars
          const sanitizedToolName = tool.name
            .replace(/[^a-zA-Z0-9_\-]/g, '_')  // Replace invalid chars with underscore
            .replace(/_+/g, '_')               // Collapse multiple underscores
            .replace(/^_|_$/g, '');            // Trim leading/trailing underscores

          // SAFETY: Final truncation check right before insert (belt and suspenders)
          // Ensure description is NEVER over 2048 BYTES (Milvus max_length)
          // Use 2000 chars to account for multi-byte UTF-8 characters
          const finalDescription = description.length > 2000
            ? description.substring(0, 2000) + '...'
            : description;

          return {
            id,
            tool_name: sanitizedToolName || tool.name,
            description: finalDescription,
            server_name: serverName,
            parameters_json: parametersJson,
            tags: tagsString,
            synthetic_queries: syntheticQueriesString,
            // Single combined embedding (Milvus v2.3.x compatible)
            embedding,
            // Milvus JSON type expects an object, NOT a stringified JSON
            metadata: {
              indexed_at: new Date().toISOString(),
              has_description: !!tool.description,
              parameter_count: Object.keys(inputSchema.properties || {}).length,
              required_params: inputSchema.required || [],
              server: serverName,
              tag_count: toolTags.length,
              synthetic_query_count: syntheticQueries.length,
              // CRITICAL: Store original tool name for MCP server calls
              // Sanitized name is for LLM compatibility, original is what MCP expects
              original_tool_name: tool.name
            }
          };
        })
      );

      // Insert into Milvus
      this.logger.info({
        recordsCount: records.length,
        firstToolName: records[0]?.tool_name || 'unknown',
        lastToolName: records[records.length - 1]?.tool_name || 'unknown'
      }, '[MILVUS-INSERT] Inserting batch into Milvus');

      const insertResult = await this.client.insert({
        collection_name: TOOLS_COLLECTION_NAME,
        data: records
      });

      this.logger.info({
        count: records.length,
        insertStatus: insertResult.status?.error_code || 'unknown',
        insertedIds: insertResult.IDs ? 'present' : 'missing'
      }, '[MILVUS-INSERT] Milvus insert result');

      // Check if insert was successful
      if (insertResult.status?.error_code !== 'Success') {
        const errorMsg = insertResult.status?.reason || insertResult.status?.error_code || 'Unknown Milvus error';
        this.logger.error({
          errorCode: insertResult.status?.error_code,
          reason: insertResult.status?.reason,
          recordsAttempted: records.length,
          firstToolName: records[0]?.tool_name,
          lastToolName: records[records.length - 1]?.tool_name
        }, '[MILVUS-INSERT] ❌ Milvus insert FAILED with error status');
        throw new Error(`Milvus insert failed: ${errorMsg}`);
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to index tool batch');
      throw error;
    }
  }

  /**
   * Cache tools in Redis for fallback when semantic search fails
   */
  private async cacheToolsInRedis(tools: Tool[]): Promise<void> {
    try {
      // Convert tools to OpenAI function format
      const openAITools = this.convertToOpenAIFormat(tools);

      // Store in Redis with 24 hour expiration
      await redisService.set(
        REDIS_CACHE_KEY,
        JSON.stringify(openAITools),
        86400 // 24 hours in seconds
      );

      this.logger.info('Tools cached in Redis', {
        toolCount: openAITools.length,
        cacheKey: REDIS_CACHE_KEY
      });
    } catch (error) {
      this.logger.error({ error }, 'Failed to cache tools in Redis - fallback will not be available');
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Generate synthetic user queries for a tool
   * Phase 3: Creates 3-5 natural language queries that would map to this tool
   *
   * @param toolName - The tool name (e.g., "subscription_list", "group_get")
   * @param description - The tool description
   * @returns Array of synthetic queries
   */
  private generateSyntheticQueries(toolName: string, description: string): string[] {
    const queries: string[] = [];

    // Extract action and resource from tool name
    const parts = toolName.toLowerCase().split(/[_\-\.]/);

    // Identify action verbs and resources
    const actionKeywords = {
      list: ['list', 'show', 'get all', 'view', 'display'],
      get: ['get', 'show', 'view', 'display', 'retrieve'],
      create: ['create', 'add', 'new', 'make'],
      update: ['update', 'modify', 'change', 'edit'],
      delete: ['delete', 'remove', 'drop'],
      search: ['search', 'find', 'lookup', 'query'],
      check: ['check', 'verify', 'validate'],
      enable: ['enable', 'activate', 'turn on'],
      disable: ['disable', 'deactivate', 'turn off']
    };

    // Find action in tool name
    let action = '';
    let actionVariants: string[] = [];
    for (const [key, variants] of Object.entries(actionKeywords)) {
      if (parts.includes(key)) {
        action = key;
        actionVariants = variants;
        break;
      }
    }

    // Extract resource (everything before the action)
    const actionIndex = parts.indexOf(action);
    const resourceParts = actionIndex > 0 ? parts.slice(0, actionIndex) : parts.filter(p => p !== action);
    const resource = resourceParts.join(' ');

    // Generate common abbreviations for resource
    const resourceAbbrevs: string[] = [];
    if (resource === 'subscription') {
      resourceAbbrevs.push('sub', 'subs', 'subscriptions');
    } else if (resource === 'resource group' || resource === 'resourcegroup') {
      resourceAbbrevs.push('rg', 'resource groups');
    } else if (resource === 'virtual machine' || resource === 'vm') {
      resourceAbbrevs.push('vm', 'vms', 'virtual machines');
    } else if (resource === 'storage account' || resource === 'storageaccount') {
      resourceAbbrevs.push('storage', 'storage accounts');
    } else if (resource === 'group') {
      resourceAbbrevs.push('groups');
    }

    // Generate queries based on action + resource combinations
    if (action && resource) {
      // Use different action variants (singular and plural)
      actionVariants.slice(0, 2).forEach(actionVariant => {
        queries.push(`${actionVariant} ${resource}`);
        // Add plural form for lists
        if (action === 'list') {
          queries.push(`${actionVariant} ${resource}s`);
        }
      });

      // Add abbreviation variants
      if (resourceAbbrevs.length > 0) {
        queries.push(`${actionVariants[0]} ${resourceAbbrevs[0]}`);
      }

      // Add "azure" prefix for Azure-specific resources
      const azureResources = ['subscription', 'resource group', 'resourcegroup', 'vm', 'virtual machine', 'storage account'];
      if (azureResources.includes(resource)) {
        queries.push(`azure ${resource}`);
        if (action === 'list') {
          queries.push(`azure ${resource}s`);
        }
      }

      // Add question forms
      if (action === 'list') {
        queries.push(`what ${resource} do I have`);
        queries.push(`what ${resource}s do I have`);
      } else if (action === 'get') {
        queries.push(`show me the ${resource}`);
      }
    } else if (resource) {
      // No clear action, use resource-based queries
      queries.push(`${resource}`);
      if (resourceAbbrevs.length > 0) {
        queries.push(resourceAbbrevs[0]);
      }
    }

    // Extract key phrases from description (first 5 words)
    if (description) {
      const descWords = description.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 5);

      if (descWords.length >= 2) {
        queries.push(descWords.slice(0, 3).join(' '));
      }
    }

    // Deduplicate and limit to 10 queries (increased from 5 to handle plurals and prefixes)
    const uniqueQueries = [...new Set(queries)].filter(q => q.length > 2);
    return uniqueQueries.slice(0, 10);
  }

  /**
   * Generate embedding for a tool (DEPRECATED - Phase 2)
   * Kept for backwards compatibility during migration
   */
  private async generateToolEmbedding(tool: Tool): Promise<number[]> {
    try {
      // Handle missing or invalid inputSchema
      const inputSchema = tool.inputSchema || { type: 'object', properties: {}, required: [] };

      // Create rich text representation for embedding
      const parts = [
        `Tool: ${tool.name}`,
        tool.description ? `Description: ${tool.description}` : '',
        `Parameters: ${JSON.stringify(inputSchema)}`
      ];

      const text = parts.filter(p => p).join('\n');

      return await this.generateEmbedding(text);
    } catch (error) {
      this.logger.error({ error, tool: tool.name }, 'Failed to generate tool embedding');
      throw error;
    }
  }

  /**
   * Generate embedding using configured embedding service
   * Uses ProviderManager to support any embedding provider (Azure OpenAI, AWS Bedrock, Vertex AI, etc.)
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingService.generateEmbedding(text.substring(0, 8192)); // Limit input size
      const embedding = result.embedding;

      // Validate dimension matches expected
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        this.logger.error({
          expectedDimension: EMBEDDING_DIMENSIONS,
          actualDimension: embedding.length,
          textPreview: text.substring(0, 100),
          embeddingConfig: this.embeddingService.getInfo()
        }, '❌ DIMENSION MISMATCH: Generated embedding has wrong dimension!');
        throw new Error(`Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${embedding.length}`);
      }

      return embedding;
    } catch (error) {
      this.logger.error({
        error,
        textPreview: text.substring(0, 100),
        embeddingConfig: this.embeddingService.getInfo()
      }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Merge dense and sparse search results using Reciprocal Rank Fusion (RRF)
   * RRF Formula: score(d) = Σ 1 / (k + rank(d))
   *
   * @param denseResults - Results from dense vector search
   * @param sparseResults - Results from sparse vector search
   * @param k - RRF parameter (default: 60)
   * @returns Merged results sorted by RRF score
   */
  private mergeWithRRF(denseResults: any[], sparseResults: any[], k: number = 60): any[] {
    const rrfScores = new Map<string, { score: number; data: any; denseRank: number; sparseRank: number }>();

    // Process dense results
    denseResults.forEach((hit, rank) => {
      const id = hit.id;
      const rrfScore = 1 / (k + rank + 1); // rank is 0-indexed

      rrfScores.set(id, {
        score: rrfScore,
        data: hit,
        denseRank: rank + 1,
        sparseRank: -1
      });
    });

    // Process sparse results and add to existing scores
    sparseResults.forEach((hit, rank) => {
      const id = hit.id;
      const rrfScore = 1 / (k + rank + 1);

      if (rrfScores.has(id)) {
        // Tool found in both searches - add scores
        const existing = rrfScores.get(id)!;
        existing.score += rrfScore;
        existing.sparseRank = rank + 1;
      } else {
        // Tool only in sparse search
        rrfScores.set(id, {
          score: rrfScore,
          data: hit,
          denseRank: -1,
          sparseRank: rank + 1
        });
      }
    });

    // Convert to array and sort by RRF score
    const merged = Array.from(rrfScores.values())
      .sort((a, b) => b.score - a.score)
      .map(item => ({
        ...item.data,
        rrfScore: item.score,
        denseRank: item.denseRank,
        sparseRank: item.sparseRank
      }));

    return merged;
  }

  /**
   * Detect cloud providers mentioned in the query
   * Returns a map of cloud provider to their server names for boosting
   */
  private detectCloudProviders(query: string): Map<string, { serverPatterns: string[], boost: number }> {
    const lowerQuery = query.toLowerCase();
    const detectedClouds = new Map<string, { serverPatterns: string[], boost: number }>();

    // AWS detection - keywords that indicate AWS intent
    const awsKeywords = ['aws', 'amazon', 'ec2', 'iam', 's3', 'lambda', 'dynamodb', 'rds', 'cloudwatch',
                         'cloudformation', 'sqs', 'sns', 'eks', 'ecs', 'fargate', 'bedrock', 'sagemaker',
                         'route53', 'vpc', 'elastic', 'kinesis', 'redshift', 'aurora', 'secretsmanager'];
    if (awsKeywords.some(kw => lowerQuery.includes(kw))) {
      detectedClouds.set('aws', {
        serverPatterns: ['aws', 'amazon'],
        boost: 2.0  // Double the score for AWS tools when AWS is mentioned
      });
    }

    // Azure detection
    const azureKeywords = ['azure', 'microsoft', 'subscription', 'resource group', 'aks', 'acr', 'cosmos',
                           'keyvault', 'app service', 'function app', 'blob', 'storage account', 'sql server',
                           'entra', 'active directory', 'aad', 'rbac', 'arm', 'bicep'];
    if (azureKeywords.some(kw => lowerQuery.includes(kw))) {
      detectedClouds.set('azure', {
        serverPatterns: ['azure', 'microsoft'],
        boost: 2.0
      });
    }

    // GCP detection
    const gcpKeywords = ['gcp', 'google cloud', 'gke', 'bigquery', 'cloud run', 'cloud function',
                         'firestore', 'pubsub', 'vertex', 'spanner', 'dataflow', 'gcs'];
    if (gcpKeywords.some(kw => lowerQuery.includes(kw))) {
      detectedClouds.set('gcp', {
        serverPatterns: ['google', 'gcp', 'vertex'],
        boost: 2.0
      });
    }

    // Kubernetes/container detection (cloud-agnostic)
    const k8sKeywords = ['kubernetes', 'k8s', 'kubectl', 'helm', 'pod', 'deployment', 'service', 'ingress',
                         'docker', 'container', 'orchestration'];
    if (k8sKeywords.some(kw => lowerQuery.includes(kw))) {
      detectedClouds.set('kubernetes', {
        serverPatterns: ['kubernetes', 'k8s', 'aks', 'eks', 'gke'],
        boost: 1.5
      });
    }

    this.logger.info({
      query: query.substring(0, 100),
      detectedClouds: Array.from(detectedClouds.keys()),
      cloudCount: detectedClouds.size
    }, '[CLOUD-DETECT] Detected cloud providers in query');

    return detectedClouds;
  }

  /**
   * Apply cloud-aware boosting to search results
   * Boosts tools from servers matching the detected cloud providers
   */
  private applyCloudBoosting(
    results: any[],
    detectedClouds: Map<string, { serverPatterns: string[], boost: number }>
  ): any[] {
    if (detectedClouds.size === 0) {
      return results;
    }

    return results.map(result => {
      const serverName = (result.server_name || '').toLowerCase();
      let totalBoost = 1.0;
      const matchedClouds: string[] = [];

      for (const [cloud, config] of detectedClouds) {
        if (config.serverPatterns.some(pattern => serverName.includes(pattern))) {
          totalBoost *= config.boost;
          matchedClouds.push(cloud);
        }
      }

      return {
        ...result,
        rrfScore: (result.rrfScore || result.score || 0) * totalBoost,
        cloudBoost: totalBoost,
        matchedClouds
      };
    }).sort((a, b) => b.rrfScore - a.rrfScore);
  }

  /**
   * Ensure multi-cloud diversity by fetching tools from each detected cloud
   * Returns additional tools that might have been missed by the main search
   */
  private async ensureCloudDiversity(
    mainResults: any[],
    detectedClouds: Map<string, { serverPatterns: string[], boost: number }>,
    queryEmbedding: number[],
    minPerCloud: number = 3
  ): Promise<any[]> {
    if (detectedClouds.size <= 1) {
      return mainResults; // Single cloud or no cloud detected
    }

    const additionalResults: any[] = [];
    const existingToolNames = new Set(mainResults.map(r => r.tool_name));

    for (const [cloud, config] of detectedClouds) {
      // Count how many tools from this cloud are already in results
      const cloudToolCount = mainResults.filter(r =>
        config.serverPatterns.some(p => (r.server_name || '').toLowerCase().includes(p))
      ).length;

      if (cloudToolCount < minPerCloud) {
        // Need to fetch more tools from this cloud
        const neededCount = minPerCloud - cloudToolCount;

        this.logger.info({
          cloud,
          currentCount: cloudToolCount,
          neededCount,
          serverPatterns: config.serverPatterns
        }, '[CLOUD-DIVERSITY] Fetching additional tools for underrepresented cloud');

        // Build server filter for this cloud
        const serverFilter = config.serverPatterns
          .map(p => `server_name like "%${p}%"`)
          .join(' || ');

        try {
          const cloudResults = await this.client.search({
            collection_name: TOOLS_COLLECTION_NAME,
            data: [queryEmbedding],
            anns_field: 'embedding',
            output_fields: ['id', 'tool_name', 'description', 'server_name', 'parameters_json', 'metadata', 'tags'],
            limit: neededCount * 2, // Fetch extra in case of duplicates
            metric_type: 'COSINE',
            filter: serverFilter
          });

          // Add non-duplicate tools
          for (const result of cloudResults.results) {
            if (!existingToolNames.has(result.tool_name)) {
              additionalResults.push({
                ...result,
                rrfScore: (result.score || 0) * config.boost,
                cloudBoost: config.boost,
                matchedClouds: [cloud],
                diversityBonus: true
              });
              existingToolNames.add(result.tool_name);
            }
          }
        } catch (error) {
          this.logger.warn({
            cloud,
            error: error instanceof Error ? error.message : String(error)
          }, '[CLOUD-DIVERSITY] Failed to fetch additional tools for cloud');
        }
      }
    }

    if (additionalResults.length > 0) {
      this.logger.info({
        additionalToolsCount: additionalResults.length,
        additionalTools: additionalResults.map(r => ({ name: r.tool_name, cloud: r.matchedClouds }))
      }, '[CLOUD-DIVERSITY] Added tools for cloud diversity');
    }

    return [...mainResults, ...additionalResults];
  }

  /**
   * Get distribution of tools across detected cloud providers
   */
  private getCloudDistribution(
    results: any[],
    detectedClouds: Map<string, { serverPatterns: string[], boost: number }>
  ): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const [cloud, config] of detectedClouds) {
      distribution[cloud] = results.filter(r =>
        config.serverPatterns.some(p => (r.server_name || '').toLowerCase().includes(p))
      ).length;
    }

    // Count tools that don't match any detected cloud
    const matchedTools = new Set<string>();
    for (const config of detectedClouds.values()) {
      results.forEach(r => {
        if (config.serverPatterns.some(p => (r.server_name || '').toLowerCase().includes(p))) {
          matchedTools.add(r.tool_name);
        }
      });
    }
    distribution['other'] = results.filter(r => !matchedTools.has(r.tool_name)).length;

    return distribution;
  }

  /**
   * Search for relevant tools using semantic search with CLOUD-AWARE BOOSTING
   * Single-vector search compatible with Milvus v2.3.x
   *
   * CLOUD-AWARE FEATURES:
   * - Detects cloud providers mentioned in query (AWS, Azure, GCP)
   * - Boosts tools from matching cloud providers
   * - Ensures diversity across multiple clouds for multi-cloud queries
   *
   * @param query - Natural language query describing what the user wants to do
   * @param topK - Number of top results to return (default: 50 for multi-cloud, 30 for single)
   * @param serverFilter - Optional filter by server name
   * @returns Array of tools in OpenAI function format with relevance scores
   */
  async searchTools(
    query: string,
    topK: number = 50,
    serverFilter?: string
  ): Promise<Tool[]> {
    if (!this._isInitialized) {
      throw new Error('ToolSemanticCacheService not initialized');
    }

    try {
      const startTime = Date.now();

      // STEP 1: Detect cloud providers mentioned in query
      const detectedClouds = this.detectCloudProviders(query);
      const isMultiCloud = detectedClouds.size > 1;

      // Adjust topK based on multi-cloud detection
      // Multi-cloud queries need more tools to ensure diversity
      const effectiveTopK = isMultiCloud ? Math.max(topK, 50) : topK;

      this.logger.info(`\x1b[96m🔍 CLOUD-AWARE SEMANTIC SEARCH\x1b[0m`, {
        query: `\x1b[96m${query.substring(0, 100)}\x1b[0m`,
        topK: effectiveTopK,
        serverFilter: serverFilter || 'none',
        detectedClouds: Array.from(detectedClouds.keys()),
        isMultiCloud,
        rerankingEnabled: process.env.ENABLE_RERANKING === 'true'
      });

      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);

      // Build filter expression
      let filter = '';
      if (serverFilter) {
        filter = `server_name == "${serverFilter}"`;
      }

      // Fetch more candidates for cloud boosting and diversity
      const searchLimit = effectiveTopK * 3;

      // Single-vector semantic search (Milvus v2.3.x compatible)
      this.logger.info('\x1b[93m[SEARCH] Searching combined embedding...\x1b[0m');
      const searchResults = await this.client.search({
        collection_name: TOOLS_COLLECTION_NAME,
        data: [queryEmbedding],
        anns_field: 'embedding',
        output_fields: ['id', 'tool_name', 'description', 'server_name', 'parameters_json', 'metadata', 'tags', 'synthetic_queries'],
        limit: searchLimit,
        metric_type: 'COSINE',
        ...(filter ? { filter } : {})
      });

      // Add rrfScore for compatibility with cloud boosting
      let results = searchResults.results.map((hit: any) => ({
        ...hit,
        rrfScore: hit.score || 0
      }));

      this.logger.info('\x1b[92m[SEARCH] Search complete\x1b[0m', {
        resultsCount: results.length
      });

      // STEP 2: Apply cloud-aware boosting
      if (detectedClouds.size > 0) {
        results = this.applyCloudBoosting(results, detectedClouds);

        this.logger.info('\x1b[95m[CLOUD-BOOST] Applied cloud-aware boosting\x1b[0m', {
          detectedClouds: Array.from(detectedClouds.keys()),
          top5AfterBoost: results.slice(0, 5).map((r: any) => ({
            name: r.tool_name,
            server: r.server_name,
            boost: r.cloudBoost,
            clouds: r.matchedClouds
          }))
        });
      }

      // STEP 3: Ensure multi-cloud diversity
      if (isMultiCloud) {
        results = await this.ensureCloudDiversity(
          results,
          detectedClouds,
          queryEmbedding,
          3 // Minimum 3 tools per detected cloud
        );

        this.logger.info('\x1b[95m[CLOUD-DIVERSITY] Ensured multi-cloud representation\x1b[0m', {
          totalResultsAfterDiversity: results.length,
          cloudDistribution: this.getCloudDistribution(results, detectedClouds)
        });
      }

      console.log('\n🔍 [CLOUD-AWARE-SEARCH] Top 10 Tools After Boosting:');
      results.slice(0, 10).forEach((r: any, idx: number) => {
        const cloudInfo = r.matchedClouds?.length > 0 ? ` [${r.matchedClouds.join(',')}]` : '';
        console.log(`  ${idx + 1}. ${r.tool_name} (${r.server_name}) - Score: ${r.rrfScore?.toFixed(3)}${cloudInfo}`);
      });
      console.log('\n');

      // Convert results to tools
      const tools: Tool[] = results.map((hit: any) => {
        const inputSchema = JSON.parse(hit.parameters_json || '{}');
        // Parse metadata to extract original_tool_name
        let metadata: any = {};
        try {
          metadata = typeof hit.metadata === 'string' ? JSON.parse(hit.metadata) : (hit.metadata || {});
        } catch (e) {
          // Ignore parse errors
        }
        return {
          name: hit.tool_name,
          description: hit.description,
          inputSchema,
          server_name: hit.server_name,
          // CRITICAL: Include original tool name for MCP routing
          // Sanitized name is for LLM, original is for MCP proxy
          original_tool_name: metadata.original_tool_name || hit.tool_name
        };
      });

      let finalTools = tools;

      // Optional LLM-based reranking
      if (process.env.ENABLE_RERANKING === 'true' && finalTools.length > 0) {
        this.logger.info('\x1b[95m[RERANKING] Starting LLM-based reranking...\x1b[0m', {
          candidateCount: finalTools.length
        });

        try {
          const { rerankWithLLM } = await import('../utils/reranker.js');
          const rerankedTools = await rerankWithLLM(
            query,
            finalTools as any,
            effectiveTopK,
            this.providerManager
          );

          this.logger.info('\x1b[92m[RERANKING] Reranking complete\x1b[0m', {
            before: finalTools.slice(0, 5).map(t => t.name),
            after: rerankedTools.slice(0, 5).map(t => t.name)
          });

          finalTools = rerankedTools as any;
        } catch (error) {
          this.logger.error({
            error: error instanceof Error ? error.message : String(error)
          }, '\x1b[91m[RERANKING] Reranking failed, using boosted results\x1b[0m');
        }
      }

      // Take top K results
      finalTools = finalTools.slice(0, effectiveTopK);

      const duration = Date.now() - startTime;

      this.logger.info(`\x1b[92m✅ CLOUD-AWARE SEARCH COMPLETE\x1b[0m in ${duration}ms`, {
        query: `\x1b[96m${query.substring(0, 50)}\x1b[0m`,
        resultsFound: `\x1b[92m${finalTools.length}\x1b[0m`,
        isMultiCloud,
        detectedClouds: Array.from(detectedClouds.keys()),
        topK,
        approach: 'single-vector semantic search (Milvus v2.3.x compatible)',
        reranking: process.env.ENABLE_RERANKING === 'true'
      });

      return finalTools;
    } catch (error) {
      this.logger.error({ error, query }, '❌ Failed to search tools');
      throw error;
    }
  }

  /**
   * Search for tools and return in OpenAI function format
   * Uses Phase 3 multi-vector search with BM25 hybrid + RRF
   */
  async searchToolsAsOpenAIFunctions(
    query: string,
    topK: number = 30,
    serverFilter?: string
  ): Promise<OpenAIFunction[]> {
    const tools = await this.searchTools(query, topK, serverFilter);
    return this.convertToOpenAIFormat(tools);
  }

  /**
   * Sanitize tool name to meet OpenAI function calling standard (universal for all LLM providers):
   * - Must match pattern: ^[a-zA-Z0-9_-]{1,64}$
   * - Only a-z, A-Z, 0-9, _, - allowed (NO dots, NO spaces, NO special chars)
   * - Max 64 characters
   * - Should start with a letter or underscore (best practice)
   *
   * This standard is followed by:
   * - OpenAI (GPT-3.5, GPT-4, etc.)
   * - Anthropic (Claude)
   * - Google (Vertex AI, Gemini)
   * - Azure OpenAI
   * - Most other LLM providers
   */
  private sanitizeToolName(name: string): string {
    if (!name) {
      return 'unknown_tool';
    }

    let sanitized = name;

    // Replace any invalid characters with underscores
    // OpenAI standard: ONLY a-z, A-Z, 0-9, _, - allowed (NO dots!)
    sanitized = sanitized.replace(/[^a-zA-Z0-9_\-]/g, '_');

    // Collapse multiple consecutive underscores into a single underscore
    sanitized = sanitized.replace(/_+/g, '_');

    // Ensure it starts with a letter or underscore (best practice for all providers)
    if (!/^[a-zA-Z_]/.test(sanitized)) {
      sanitized = `_${sanitized}`;
    }

    // Truncate to 64 characters (OpenAI limit)
    if (sanitized.length > 64) {
      sanitized = sanitized.substring(0, 64);
    }

    // Log if we changed the name
    if (sanitized !== name) {
      this.logger.warn({
        original: name,
        sanitized,
        reason: 'OpenAI function calling standard (universal for all LLM providers)'
      }, '[TOOL-NAME] Sanitized tool name for universal LLM compatibility');
    }

    return sanitized;
  }

  /**
   * Normalize schema for Azure OpenAI compatibility
   * Azure OpenAI requires ALL object schemas to have a 'properties' field, even if empty
   * This recursively normalizes nested schemas as well
   */
  private normalizeSchemaForAzure(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const normalized = { ...schema };

    // OPTIMIZATION: Remove redundant 'title' fields to save tokens
    // Title fields are auto-generated by pydantic and waste ~5-10 tokens per parameter
    delete normalized.title;

    // If it's an object type, ensure it has properties
    if (normalized.type === 'object' && !normalized.properties) {
      normalized.properties = {};
    }

    // Recursively normalize nested properties
    if (normalized.properties) {
      const normalizedProps: any = {};
      for (const [key, value] of Object.entries(normalized.properties)) {
        normalizedProps[key] = this.normalizeSchemaForAzure(value);
      }
      normalized.properties = normalizedProps;
    }

    // Normalize items for array types
    if (normalized.items) {
      normalized.items = this.normalizeSchemaForAzure(normalized.items);
    }

    // Normalize additionalProperties if it's a schema
    if (normalized.additionalProperties && typeof normalized.additionalProperties === 'object') {
      normalized.additionalProperties = this.normalizeSchemaForAzure(normalized.additionalProperties);
    }

    // Normalize anyOf/oneOf/allOf schemas
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(normalized[key])) {
        normalized[key] = normalized[key].map((s: any) => this.normalizeSchemaForAzure(s));
      }
    }

    return normalized;
  }

  /**
   * Convert tools to OpenAI function format
   * CRITICAL: Includes serverId so API can route tool calls to correct MCP server
   * CRITICAL: Includes originalToolName for MCP proxy routing (aws___search_documentation vs aws_search_documentation)
   * NOTE: Normalizes schemas for Azure OpenAI compatibility (requires properties on object types)
   */
  private convertToOpenAIFormat(tools: Tool[]): OpenAIFunction[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: this.sanitizeToolName(tool.name),
        description: tool.description || `Tool: ${tool.name}`,
        parameters: this.normalizeSchemaForAzure(tool.inputSchema),
        server_name: tool.server_name // CRITICAL: Include server for routing
      },
      serverId: tool.server_name, // Also at top level for easy access
      // CRITICAL: Original tool name for MCP proxy - the ACTUAL name the MCP server expects
      // The sanitized name (function.name) is for LLM compatibility (no triple underscores)
      // But the MCP server may have tools like "aws___search_documentation" that need the original name
      originalToolName: tool.original_tool_name || tool.name
    } as any)); // Cast to any to allow extra fields
  }

  /**
   * Get a specific tool by name
   */
  async getTool(toolName: string, serverName?: string): Promise<Tool | null> {
    if (!this._isInitialized) {
      throw new Error('ToolSemanticCacheService not initialized');
    }

    try {
      let filter = `tool_name == "${toolName}"`;
      if (serverName) {
        filter += ` && server_name == "${serverName}"`;
      }

      const queryResult = await this.client.query({
        collection_name: TOOLS_COLLECTION_NAME,
        filter,
        output_fields: [
          'tool_name',
          'description',
          'server_name',
          'parameters_json'
        ],
        limit: 1
      });

      if (queryResult.data.length === 0) {
        return null;
      }

      const hit = queryResult.data[0];
      return {
        name: hit.tool_name,
        description: hit.description,
        inputSchema: JSON.parse(hit.parameters_json),
        server_name: hit.server_name
      };
    } catch (error) {
      this.logger.error({ error, toolName, serverName }, 'Failed to get tool');
      throw error;
    }
  }

  /**
   * Clear all tools from the cache
   */
  async clearAllTools(): Promise<void> {
    try {
      // Drop and recreate collection for efficient clearing
      const hasCollection = await this.client.hasCollection({
        collection_name: TOOLS_COLLECTION_NAME
      });

      if (hasCollection.value) {
        await this.client.dropCollection({
          collection_name: TOOLS_COLLECTION_NAME
        });
        this.logger.info('Dropped existing tools collection');
      }

      // Recreate collection
      await this.createToolsCollection();

      this.logger.info('Tools cache cleared');
    } catch (error) {
      this.logger.error({ error }, 'Failed to clear tools cache');
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalTools: number;
    collectionName: string;
    embeddingModel: string | null;
    dimensions: number;
    isInitialized: boolean;
  }> {
    try {
      let totalTools = 0;

      if (this._isInitialized) {
        const stats = await this.client.getCollectionStatistics({
          collection_name: TOOLS_COLLECTION_NAME
        });
        totalTools = parseInt(stats.data.row_count || '0');
      }

      return {
        totalTools,
        collectionName: TOOLS_COLLECTION_NAME,
        embeddingModel: this.embeddingService.getInfo().model,
        dimensions: EMBEDDING_DIMENSIONS,
        isInitialized: this._isInitialized
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to get cache stats');
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const health = await this.client.checkHealth();
      return health.isHealthy;
    } catch (error) {
      this.logger.error({ error }, 'Health check failed');
      return false;
    }
  }

  /**
   * Generate a unique ID for a tool
   */
  private generateToolId(tool: Tool): string {
    const serverName = tool.server_name || 'unknown';
    return `${serverName}:${tool.name}`.substring(0, 256);
  }
}

// Note: Singleton should be created in server.ts with ProviderManager
// Export class for creating instance with dependencies
export default ToolSemanticCacheService;
