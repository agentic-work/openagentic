/**
 * ToolPgvectorSearchService - pgvector-based MCP tool search
 *
 * PRIMARY search path for MCP tool discovery using PostgreSQL pgvector.
 * Uses PrismaVectorClient.findSimilar() against the mcp_tools table.
 *
 * Architecture: pgvector (primary) → Milvus (fallback) → Redis (last resort)
 *
 * @see DATA_LAYER_EVOLUTION_PLAN.md for architecture decisions
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { PrismaVectorClient, getPrismaVectorClient } from './database/PrismaVectorClient.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { OpenAIFunction } from './ToolSemanticCacheService.js';

// Cloud provider detection for score boosting
interface CloudConfig {
  serverPatterns: string[];
  boost: number;
}

// Intent-priority routing result
interface IntentRoutingResult {
  primary: string[];   // Primary intent servers (action verb match)
  context: string[];   // Content context servers (noun/topic match)
}

// Server routing configuration
interface ServerRouteConfig {
  serverIds: string[];
  keywords: string[];
}

// Tool result from pgvector search
interface PgvectorToolResult {
  id: string;
  name: string;
  server_id: string;
  description: string | null;
  schema: any;
  category: string | null;
  similarity: number;
  cloudBoost?: number;
  matchedClouds?: string[];
}

// Score-gap cutoff configuration
interface ScoreGapConfig {
  gapMultiplier: number;  // How many times the mean gap to consider "significant"
  minTools: number;       // Minimum tools to keep regardless of gaps
  maxTools: number;       // Maximum tools to keep regardless of gaps
  defaultMax: number;     // Default max when no clear gap found (flat distribution)
}

export class ToolPgvectorSearchService {
  private prisma: PrismaClient;
  private vectorClient: PrismaVectorClient;
  private embeddingService: UniversalEmbeddingService;
  private logger: Logger;
  private _isReady: boolean = false;
  private embeddingDimensions: number = 1024;

  constructor(prisma: PrismaClient, embeddingService: UniversalEmbeddingService, logger: Logger) {
    this.prisma = prisma;
    this.vectorClient = getPrismaVectorClient(prisma);
    this.embeddingService = embeddingService;
    this.logger = logger.child({ service: 'tool-pgvector-search' });
  }

  /**
   * Initialize the service: verify pgvector, create HNSW indexes
   */
  async initialize(): Promise<void> {
    try {
      // Initialize the vector client
      await this.vectorClient.initialize();

      // Detect embedding dimensions from first non-null embedding
      const dimResult = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT array_length(search_embedding::text::float[], 1) as dim
         FROM mcp_tools
         WHERE search_embedding IS NOT NULL
         LIMIT 1`
      ).catch(() => []);

      if (dimResult.length > 0 && dimResult[0].dim) {
        this.embeddingDimensions = dimResult[0].dim;
        this.logger.info({ dimensions: this.embeddingDimensions }, '[PGVECTOR-TOOLS] Detected embedding dimensions');
      }

      // Create HNSW indexes if they don't exist
      await this.ensureHNSWIndexes();

      // Check if we have embeddings
      const stats = await this.vectorClient.getTableStats('mcp_tools', 'search_embedding');
      this._isReady = stats.totalRows > 0 && stats.rowsWithEmbeddings > 0;

      this.logger.info({
        ready: this._isReady,
        totalTools: stats.totalRows,
        embeddedTools: stats.rowsWithEmbeddings,
        dimensions: this.embeddingDimensions
      }, '[PGVECTOR-TOOLS] Service initialized');
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[PGVECTOR-TOOLS] Initialization failed');
      this._isReady = false;
    }
  }

  /**
   * Create HNSW indexes for efficient similarity search
   */
  private async ensureHNSWIndexes(): Promise<void> {
    try {
      await this.vectorClient.createHNSWIndex({
        table: 'mcp_tools',
        embeddingColumn: 'search_embedding',
        indexName: 'mcp_tools_search_embedding_hnsw_idx',
        m: 16,
        efConstruction: 256,
        metric: 'cosine'
      });
      this.logger.info('[PGVECTOR-TOOLS] HNSW index on search_embedding ensured');
    } catch (error: any) {
      // Index may already exist - that's fine
      if (!error.message?.includes('already exists')) {
        this.logger.warn({ error: error.message }, '[PGVECTOR-TOOLS] HNSW index creation warning');
      }
    }

    try {
      await this.vectorClient.createHNSWIndex({
        table: 'mcp_tools',
        embeddingColumn: 'description_embedding',
        indexName: 'mcp_tools_description_embedding_hnsw_idx',
        m: 16,
        efConstruction: 256,
        metric: 'cosine'
      });
      this.logger.info('[PGVECTOR-TOOLS] HNSW index on description_embedding ensured');
    } catch (error: any) {
      if (!error.message?.includes('already exists')) {
        this.logger.warn({ error: error.message }, '[PGVECTOR-TOOLS] HNSW description index warning');
      }
    }
  }

  /**
   * Check if the service has embeddings and is ready for search
   */
  isReady(): boolean {
    return this._isReady;
  }

  /**
   * Refresh readiness state (call after indexing)
   */
  async refreshReadiness(): Promise<void> {
    try {
      const stats = await this.vectorClient.getTableStats('mcp_tools', 'search_embedding');
      this._isReady = stats.totalRows > 0 && stats.rowsWithEmbeddings > 0;
      this.logger.info({
        ready: this._isReady,
        embeddedTools: stats.rowsWithEmbeddings
      }, '[PGVECTOR-TOOLS] Readiness refreshed');
    } catch {
      this._isReady = false;
    }
  }

  /**
   * Detect target MCP servers based on query content.
   * Returns server IDs to scope the pgvector search, dramatically reducing candidates.
   * Returns empty array if no specific servers detected (search all).
   *
   * LEGACY wrapper — returns flat array for backward compatibility.
   */
  detectTargetServers(query: string): string[] {
    const result = this.detectTargetServersWithIntent(query);
    return [...new Set([...result.primary, ...result.context])];
  }

  /**
   * Intent-priority server detection.
   *
   * Distinguishes between the ACTION the user wants (primary) and
   * the CONTENT/TOPIC they mention (context).
   *
   * Example: "search the web for latest kubernetes release"
   *   → primary: openagentic_web  (action = web search)
   *   → context: openagentic_kubernetes  (topic = kubernetes)
   *
   * The primary server's tools get priority ranking; context tools
   * are supplementary.
   */
  detectTargetServersWithIntent(query: string): IntentRoutingResult {
    const lowerQuery = query.toLowerCase();
    const primary: string[] = [];
    const context: string[] = [];

    // ── Action-verb patterns: these override topic keywords ──
    const ACTION_PATTERNS: { pattern: RegExp; serverIds: string[] }[] = [
      { pattern: /\b(search\s+the\s+web|search\s+online|web\s+search|look\s*up\s+online|google|browse\s+the\s+web|find\s+online)\b/, serverIds: ['openagentic_web'] },
      { pattern: /\b(check\s+pods?|get\s+deploy|kubectl|helm\s+(install|upgrade|list|status)|scale\s+(up|down)|rollout)\b/, serverIds: ['openagentic_kubernetes'] },
      { pattern: /\b(search\s+repos?|check\s+pr|list\s+issues?|create\s+issue|open\s+pr|github\s+search)\b/, serverIds: ['openagentic_github'] },
      { pattern: /\b(draw\s+a?\s*diagram|create\s+a?\s*diagram|architecture\s+diagram|sequence\s+diagram|flowchart)\b/, serverIds: ['openagentic_diagram'] },
      { pattern: /\b(run\s+code|execute\s+code|compile|run\s+python|run\s+script)\b/, serverIds: ['openagentic_openagentic'] },
      { pattern: /\b(remember\s+this|recall|what\s+did\s+i\s+say|forget\s+about)\b/, serverIds: ['openagentic_memory'] },
    ];

    // Check action patterns first — these determine PRIMARY intent
    for (const ap of ACTION_PATTERNS) {
      if (ap.pattern.test(lowerQuery)) {
        primary.push(...ap.serverIds);
      }
    }

    // ── Topic/noun keyword routes ──
    const SERVER_ROUTES: ServerRouteConfig[] = [
      {
        serverIds: ['openagentic_azure'],
        keywords: ['azure', 'microsoft', 'subscription', 'resource group', 'aks', 'acr', 'cosmos',
          'keyvault', 'app service', 'function app', 'blob', 'storage account', 'sql server',
          'entra', 'active directory', 'aad', 'rbac', 'arm', 'bicep', 'azure ad']
      },
      {
        serverIds: ['openagentic_aws'],
        keywords: ['aws', 'amazon', 'ec2', 'iam', 's3', 'lambda', 'dynamodb', 'rds', 'cloudwatch',
          'cloudformation', 'sqs', 'sns', 'eks', 'ecs', 'fargate', 'bedrock', 'sagemaker',
          'route53', 'vpc', 'elastic', 'kinesis', 'redshift', 'aurora', 'secretsmanager']
      },
      {
        serverIds: ['openagentic_gcp'],
        keywords: ['gcp', 'google cloud', 'gke', 'bigquery', 'cloud run', 'cloud function',
          'firestore', 'pubsub', 'vertex', 'spanner', 'dataflow', 'gcs']
      },
      {
        serverIds: ['openagentic_kubernetes'],
        keywords: ['kubernetes', 'k8s', 'kubectl', 'helm', 'pod', 'pods', 'deployment', 'deployments',
          'namespace', 'namespaces', 'ingress', 'configmap', 'secret', 'daemonset',
          'statefulset', 'replica', 'hpa', 'pvc', 'kube', 'container', 'orchestration']
      },
      {
        serverIds: ['openagentic_web'],
        keywords: ['weather', 'forecast', 'temperature', 'news', 'current events', 'latest',
          'search the web', 'search online', 'google', 'browse', 'website', 'web search',
          'look up', 'lookup', 'price', 'stock', 'market', 'bitcoin', 'crypto',
          'score', 'game', 'playing', 'tutorial', 'documentation', 'docs']
      },
      {
        serverIds: ['openagentic_github'],
        keywords: ['github', 'repository', 'repo', 'pull request', 'pr', 'issue', 'issues',
          'commit', 'branch', 'merge', 'clone', 'fork', 'release', 'actions', 'ci/cd']
      },
      {
        serverIds: ['openagentic_admin'],
        keywords: ['admin', 'system health', 'platform status', 'redis status', 'postgres',
          'milvus status', 'database status', 'server status', 'configuration',
          'system config', 'audit', 'user management',
          'infrastructure health', 'platform health', 'llm provider', 'provider status',
          'system test', 'full test', 'database health', 'redis health', 'milvus health']
      },
      {
        serverIds: ['openagentic_prometheus', 'openagentic_loki'],
        keywords: ['prometheus', 'grafana', 'metrics', 'monitoring', 'alerting', 'alerts',
          'loki', 'logs', 'log query', 'logql',
          'cpu usage', 'memory usage', 'memory consumption', 'disk usage', 'disk space',
          'cpu utilization', 'resource usage', 'resource utilization',
          'latency', 'throughput', 'error rate', 'request rate',
          'container restart', 'pod restart', 'oom', 'out of memory',
          'node health', 'scrape', 'promql']
      },
      {
        serverIds: ['openagentic_diagram'],
        keywords: ['diagram', 'flowchart', 'sequence diagram', 'mermaid', 'architecture diagram',
          'draw', 'visualize', 'chart']
      },
      {
        serverIds: ['openagentic_openagentic'],
        keywords: ['run code', 'execute code', 'python script', 'javascript code',
          'code execution', 'compile', 'sandbox']
      },
      {
        serverIds: ['openagentic_memory'],
        keywords: ['remember', 'recall', 'memory', 'forget', 'what did i say',
          'previous conversation', 'earlier']
      },
    ];

    for (const route of SERVER_ROUTES) {
      if (route.keywords.some(kw => lowerQuery.includes(kw))) {
        for (const sid of route.serverIds) {
          // If this server is already in primary, don't also add to context
          if (!primary.includes(sid)) {
            context.push(sid);
          }
        }
      }
    }

    // URL detection → web server
    if (/https?:\/\/[^\s]+/i.test(query)) {
      if (!primary.includes('openagentic_web') && !context.includes('openagentic_web')) {
        primary.push('openagentic_web');
      }
    }

    return {
      primary: [...new Set(primary)],
      context: [...new Set(context)]
    };
  }

  /**
   * Apply score-gap detection to find natural cutoff point in results.
   * Looks for the first gap between consecutive scores that's significantly
   * larger than the mean gap, indicating a relevance boundary.
   */
  applyScoreGapCutoff(
    results: PgvectorToolResult[],
    config: ScoreGapConfig = { gapMultiplier: 2.0, minTools: 3, maxTools: 15, defaultMax: 12 }
  ): PgvectorToolResult[] {
    if (results.length <= config.minTools) return results;

    // Compute gaps between consecutive scores
    const gaps: number[] = [];
    for (let i = 0; i < results.length - 1; i++) {
      gaps.push(results[i].similarity - results[i + 1].similarity);
    }

    if (gaps.length === 0) return results.slice(0, config.maxTools);

    // Calculate mean gap (excluding zero gaps)
    const nonZeroGaps = gaps.filter(g => g > 0.001);
    if (nonZeroGaps.length === 0) {
      // All scores essentially identical — flat distribution
      return results.slice(0, config.defaultMax);
    }

    const meanGap = nonZeroGaps.reduce((a, b) => a + b, 0) / nonZeroGaps.length;
    const significantGapThreshold = meanGap * config.gapMultiplier;

    // Find first significant gap (starting from minTools position)
    let cutIndex = -1;
    for (let i = Math.max(0, config.minTools - 1); i < gaps.length; i++) {
      if (gaps[i] >= significantGapThreshold && gaps[i] > 0.02) {
        cutIndex = i + 1; // Cut AFTER this index (keep this tool)
        break;
      }
    }

    // Apply bounds
    let finalCount: number;
    if (cutIndex === -1) {
      // No clear gap found — use default max
      finalCount = Math.min(results.length, config.defaultMax);
    } else {
      finalCount = Math.max(config.minTools, Math.min(cutIndex, config.maxTools));
    }

    this.logger.debug({
      totalResults: results.length,
      meanGap: meanGap.toFixed(4),
      significantGapThreshold: significantGapThreshold.toFixed(4),
      cutIndex,
      finalCount,
      topScore: results[0]?.similarity?.toFixed(3),
      cutScore: results[finalCount - 1]?.similarity?.toFixed(3),
      nextScore: results[finalCount]?.similarity?.toFixed(3) || 'N/A'
    }, '[PGVECTOR-TOOLS] Score-gap cutoff applied');

    return results.slice(0, finalCount);
  }

  /**
   * Search for tools using pgvector semantic similarity.
   * Supports optional server filtering for server-first routing.
   */
  async searchTools(
    query: string,
    topK: number = 30,
    options?: { serverIds?: string[]; applyScoreGap?: boolean }
  ): Promise<PgvectorToolResult[]> {
    if (!this._isReady) {
      this.logger.debug('[PGVECTOR-TOOLS] Not ready, returning empty results');
      return [];
    }

    try {
      // Generate embedding for the query
      const embeddingResult = await this.embeddingService.generateEmbedding(query);
      if (!embeddingResult || !embeddingResult.embedding || embeddingResult.embedding.length === 0) {
        this.logger.warn('[PGVECTOR-TOOLS] Failed to generate query embedding');
        return [];
      }

      // Multi-cloud queries get broader search
      const lowerQuery = query.toLowerCase();
      const isMultiCloud = ['aws', 'azure', 'gcp'].filter(c => lowerQuery.includes(c)).length > 1
        || lowerQuery.includes('cloud') && (lowerQuery.includes('all') || lowerQuery.includes('every') || lowerQuery.includes('compare'));
      const adjustedTopK = isMultiCloud ? Math.min(topK * 2, 100) : topK;

      // Build WHERE clause with optional server filtering
      let whereClause = 'is_enabled = true';
      if (options?.serverIds && options.serverIds.length > 0) {
        const serverList = options.serverIds.map(s => `'${s.replace(/'/g, "''")}'`).join(', ');
        whereClause += ` AND server_id IN (${serverList})`;
      }

      // Search using PrismaVectorClient
      const results = await this.vectorClient.findSimilar({
        table: 'mcp_tools',
        embeddingColumn: 'search_embedding',
        queryEmbedding: embeddingResult.embedding,
        limit: adjustedTopK,
        threshold: 0.15, // Lower threshold, let cloud boosting sort relevance
        metric: 'cosine',
        additionalColumns: ['name', 'server_id', 'description', 'schema', 'category'],
        whereClause
      });

      // Map to our result format
      let toolResults: PgvectorToolResult[] = results.map(r => ({
        id: r.id,
        name: r.data.name as string,
        server_id: r.data.server_id as string,
        description: r.data.description as string | null,
        schema: r.data.schema,
        category: r.data.category as string | null,
        similarity: r.similarity
      }));

      // Cloud boosting REMOVED — it inverts correct semantic rankings.
      // The LLM picks the right tool from well-ranked results without score manipulation.

      // Apply score-gap cutoff if requested
      if (options?.applyScoreGap) {
        toolResults = this.applyScoreGapCutoff(toolResults);
      } else {
        // Trim to requested topK
        toolResults = toolResults.slice(0, topK);
      }

      this.logger.info({
        query: query.substring(0, 100),
        resultCount: toolResults.length,
        topScore: toolResults[0]?.similarity?.toFixed(3),
        bottomScore: toolResults[toolResults.length - 1]?.similarity?.toFixed(3),
        serverFilter: options?.serverIds || 'all',
        scoreGapApplied: !!options?.applyScoreGap
      }, '[PGVECTOR-TOOLS] pgvector search completed');

      return toolResults;
    } catch (error: any) {
      this.logger.error({ error: error.message, query: query.substring(0, 100) },
        '[PGVECTOR-TOOLS] Search failed');
      return [];
    }
  }

  /**
   * Search tools and return in OpenAI function calling format.
   * Supports server-first routing and score-gap cutoff.
   */
  async searchToolsAsOpenAIFunctions(
    query: string,
    topK: number = 30,
    options?: { serverIds?: string[]; applyScoreGap?: boolean }
  ): Promise<OpenAIFunction[]> {
    const tools = await this.searchTools(query, topK, options);
    return this.convertToOpenAIFormat(tools);
  }

  /**
   * Detect cloud providers mentioned in the query for score boosting
   */
  private detectCloudProviders(query: string): Map<string, CloudConfig> {
    const lowerQuery = query.toLowerCase();
    const detectedClouds = new Map<string, CloudConfig>();

    const awsKeywords = ['aws', 'amazon', 'ec2', 'iam', 's3', 'lambda', 'dynamodb', 'rds', 'cloudwatch',
      'cloudformation', 'sqs', 'sns', 'eks', 'ecs', 'fargate', 'bedrock', 'sagemaker',
      'route53', 'vpc', 'elastic', 'kinesis', 'redshift', 'aurora', 'secretsmanager'];
    if (awsKeywords.some(kw => lowerQuery.includes(kw))) {
      detectedClouds.set('aws', { serverPatterns: ['aws', 'amazon'], boost: 2.0 });
    }

    const azureKeywords = ['azure', 'microsoft', 'subscription', 'resource group', 'aks', 'acr', 'cosmos',
      'keyvault', 'app service', 'function app', 'blob', 'storage account', 'sql server',
      'entra', 'active directory', 'aad', 'rbac', 'arm', 'bicep'];
    if (azureKeywords.some(kw => lowerQuery.includes(kw))) {
      detectedClouds.set('azure', { serverPatterns: ['azure', 'microsoft'], boost: 2.0 });
    }

    const gcpKeywords = ['gcp', 'google cloud', 'gke', 'bigquery', 'cloud run', 'cloud function',
      'firestore', 'pubsub', 'vertex', 'spanner', 'dataflow', 'gcs'];
    if (gcpKeywords.some(kw => lowerQuery.includes(kw))) {
      detectedClouds.set('gcp', { serverPatterns: ['google', 'gcp', 'vertex'], boost: 2.0 });
    }

    const k8sKeywords = ['kubernetes', 'k8s', 'kubectl', 'helm', 'pod', 'deployment', 'service', 'ingress',
      'docker', 'container', 'orchestration'];
    if (k8sKeywords.some(kw => lowerQuery.includes(kw))) {
      detectedClouds.set('kubernetes', { serverPatterns: ['kubernetes', 'k8s', 'aks', 'eks', 'gke'], boost: 1.5 });
    }

    return detectedClouds;
  }

  /**
   * Apply cloud-aware score boosting to search results
   */
  private applyCloudBoosting(
    results: PgvectorToolResult[],
    detectedClouds: Map<string, CloudConfig>
  ): PgvectorToolResult[] {
    return results.map(result => {
      const serverName = (result.server_id || '').toLowerCase();
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
        similarity: result.similarity * totalBoost,
        cloudBoost: totalBoost,
        matchedClouds
      };
    }).sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Sanitize tool name for OpenAI function calling standard
   */
  private sanitizeToolName(name: string): string {
    if (!name) return 'unknown_tool';
    let sanitized = name.replace(/[^a-zA-Z0-9_\-]/g, '_');
    sanitized = sanitized.replace(/_+/g, '_');
    if (!/^[a-zA-Z_]/.test(sanitized)) {
      sanitized = `_${sanitized}`;
    }
    if (sanitized.length > 64) {
      sanitized = sanitized.substring(0, 64);
    }
    return sanitized;
  }

  /**
   * Normalize schema for Azure OpenAI compatibility
   */
  private normalizeSchemaForAzure(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    const normalized = { ...schema };
    delete normalized.title;
    if (normalized.type === 'object' && !normalized.properties) {
      normalized.properties = {};
    }
    if (normalized.properties) {
      const normalizedProps: any = {};
      for (const [key, value] of Object.entries(normalized.properties)) {
        normalizedProps[key] = this.normalizeSchemaForAzure(value);
      }
      normalized.properties = normalizedProps;
    }
    if (normalized.items) {
      normalized.items = this.normalizeSchemaForAzure(normalized.items);
    }
    if (normalized.additionalProperties && typeof normalized.additionalProperties === 'object') {
      normalized.additionalProperties = this.normalizeSchemaForAzure(normalized.additionalProperties);
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(normalized[key])) {
        normalized[key] = normalized[key].map((s: any) => this.normalizeSchemaForAzure(s));
      }
    }
    return normalized;
  }

  /**
   * Convert pgvector tool results to OpenAI function calling format
   */
  private convertToOpenAIFormat(tools: PgvectorToolResult[]): OpenAIFunction[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: this.sanitizeToolName(tool.name),
        description: tool.description || `Tool: ${tool.name}`,
        parameters: this.normalizeSchemaForAzure(tool.schema),
        server_name: tool.server_id
      },
      serverId: tool.server_id,
      originalToolName: tool.name,
      _similarity: tool.similarity,
      _serverName: tool.server_id
    } as any));
  }
}

// Singleton
let instance: ToolPgvectorSearchService | null = null;

export function getToolPgvectorSearchService(): ToolPgvectorSearchService | null {
  return instance;
}

export function setToolPgvectorSearchService(service: ToolPgvectorSearchService): void {
  instance = service;
}
