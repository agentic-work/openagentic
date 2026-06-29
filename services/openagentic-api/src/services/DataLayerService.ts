/**
 * DataLayerService
 *
 * The intelligent data layer for handling massive tool responses across ALL LLMs and ALL tools.
 *
 * This service implements the "Fetch Once, Query Many" pattern:
 * 1. STORE: Large tool responses are stored with semantic indexing
 * 2. REFERENCE: LLMs receive summaries + reference IDs (not full data)
 * 3. QUERY: LLMs can query stored data with natural language
 * 4. ITERATE: Supports agentic drill-down without re-fetching
 *
 * Key Principles (from industry research):
 * - Don't dump massive JSON into context - models lose accuracy in the "middle"
 * - Store data externally, keep references lightweight
 * - Progressive disclosure: summary → drill-down → specific items
 * - Query-driven retrieval: fetch only what's needed for current question
 *
 * @see https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import { getRedisClient, type UnifiedRedisClient } from '../utils/redis-client.js';
import prisma from '../utils/prisma.js';
import type { Logger } from 'pino';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface StoredDataset {
  id: string;
  sessionId: string;
  userId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  userQuery: string;  // Original question that triggered this fetch

  // Data
  data: unknown;
  dataType: 'array' | 'object' | 'primitive';
  itemCount: number;
  totalSizeBytes: number;

  // Schema (for intelligent querying)
  schema: DataSchema;

  // Metadata
  createdAt: Date;
  expiresAt: Date;
  accessCount: number;
  lastAccessedAt: Date;
}

export interface DataSchema {
  type: string;
  fields: SchemaField[];
  sampleValues: Record<string, unknown>;
  anomalyFields: string[];  // Fields that commonly indicate problems
  statusFields: string[];   // Fields that indicate health/state
}

export interface SchemaField {
  name: string;
  type: string;
  description?: string;
  isArray: boolean;
  uniqueValues?: (string | number)[];  // For enum-like fields
  minValue?: number;
  maxValue?: number;
  commonValues?: string[];
}

export interface DataQueryRequest {
  datasetId: string;
  query: string;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  includeStats?: boolean;
}

export interface DataQueryResult {
  success: boolean;
  datasetId: string;
  originalQuery: string;

  // Results
  items?: unknown[];
  count: number;
  totalAvailable: number;

  // Groupings/aggregations
  groupings?: Record<string, Record<string, number>>;

  // Anomalies highlighted
  anomalies?: unknown[];
  anomalyCount: number;

  // Pagination
  hasMore: boolean;
  nextQuery?: string;

  // Context for LLM
  contextSummary: string;
}

export interface DataLayerStats {
  totalDatasets: number;
  totalSizeBytes: number;
  avgQueryTimeMs: number;
  cacheHitRate: number;
  datasetsPerSession: Record<string, number>;
}

// =============================================================================
// DATA LAYER SYSTEM INSTRUCTIONS
// =============================================================================

/**
 * Instructions injected into ALL LLM system prompts about using the data layer.
 * This is the key to making ALL models handle massive responses correctly.
 */
export const DATA_LAYER_INSTRUCTIONS = `
## Data Layer Usage (CRITICAL)

When tool calls return large datasets (hundreds/thousands of items), the system stores the full data and gives you a **summary + reference ID**. This prevents context overflow and ensures accuracy.

### How to Work with Large Datasets

**Pattern: FETCH ONCE → QUERY MANY**

1. **Initial Fetch**: When you call a tool (e.g., \`list_vms\`, \`azure_get_app_gateway\`), you may receive:
   \`\`\`
   📊 Dataset stored (ID: data_abc123)
   Total: 450 items | Type: array
   Summary: 448 healthy, 2 unhealthy
   Anomalies: 2 items with status=failed
   Schema: {name, status, resourceGroup, location, ...}

   Use 'query_data' tool to explore this data without re-fetching.
   \`\`\`

2. **Query the Data** (DON'T re-fetch!): Use the \`query_data\` tool:
   - \`query_data(datasetId: "data_abc123", query: "show unhealthy items")\`
   - \`query_data(datasetId: "data_abc123", query: "count by location")\`
   - \`query_data(datasetId: "data_abc123", query: "items in eastus with status running")\`

3. **Answer FROM Context**: Once you have the specific data, answer directly. Don't dump raw JSON.

### Rules

1. **NEVER re-fetch static data** - If you have a dataset ID, use \`query_data\` instead
2. **DO re-fetch dynamic data** - Metrics, health checks, real-time status need fresh calls
3. **Correlate across datasets** - Track multiple dataset IDs to answer complex questions
4. **Summarize, don't dump** - Transform data into insights, don't paste JSON
5. **Use anomalies first** - When troubleshooting, anomalies are already highlighted

### Query Patterns

| User Question | Query |
|--------------|-------|
| "Show me unhealthy items" | \`query_data(id, query: "status != healthy")\` |
| "How many VMs per region?" | \`query_data(id, query: "count by location")\` |
| "Details on VM-123" | \`query_data(id, query: "name=VM-123")\` |
| "Items with errors" | \`query_data(id, query: "anomalies only")\` |
| "First 10 items" | \`query_data(id, limit: 10)\` |

### Example Flow

User: "Check our App Gateway health and list any backend issues"

You (step 1): Call \`azure_app_gateway_backend_health(name, rg)\`
→ Returns: "Dataset data_xyz (50 backend servers). 48 healthy, 2 unhealthy."

You (step 2): Call \`query_data(datasetId: "data_xyz", query: "unhealthy backends")\`
→ Returns: Full details of 2 unhealthy backends

You (step 3): Answer directly:
"Found 2 unhealthy backend servers:
1. backend-api-03: Connection refused (port 8080 not responding)
2. backend-web-07: Timeout (response >30s)
Recommend: Check application health on these servers."

✅ You fetched ONCE, queried TWICE, answered SPECIFICALLY.
❌ Bad: Re-calling the health tool, dumping all 50 servers, or pasting raw JSON.
`;

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

export class DataLayerService {
  private log: Logger;
  private redis: UnifiedRedisClient | null = null;
  // No in-memory fallback — Redis is the only backend for multi-pod safety

  // Configuration
  private readonly DATA_TTL_SECONDS = 3600;  // 1 hour
  private readonly MAX_ITEMS_IN_SUMMARY = 5;
  private readonly MAX_ANOMALIES_IN_SUMMARY = 10;
  private readonly REDIS_KEY_PREFIX = 'datalayer:';

  private redisInit: Promise<void> | null = null;

  constructor() {
    this.log = logger.child({ service: 'DataLayerService' });
  }

  /**
   * Lazily connect to Redis on first use (idempotent). Moved out of the
   * constructor so no unawaited async work runs at construction time; the
   * connection is established (once) on the first store/query call.
   */
  private async ensureRedis(): Promise<void> {
    if (this.redis) return;
    if (!this.redisInit) {
      this.redisInit = (async () => {
        try {
          this.redis = await getRedisClient();
          this.log.info('DataLayerService initialized with Redis backing');
        } catch (error) {
          this.log.error({ error }, 'Redis not available — DataLayerService requires Redis for multi-pod safety');
        }
      })();
    }
    await this.redisInit;
  }

  // ===========================================================================
  // STORE DATA
  // ===========================================================================

  /**
   * Store a large tool response and return a summary for the LLM.
   * This is the core "Fetch Once" step.
   */
  async storeToolResponse(
    sessionId: string,
    userId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    userQuery: string,
    data: unknown,
    opts?: { resourceScope?: string | null; tenantId?: string | null; toolCallId?: string }
  ): Promise<{ datasetId: string; summary: string; schema: DataSchema }> {
    const datasetId = `data_${uuidv4().substring(0, 12)}`;
    const now = new Date();

    // Analyze the data
    const dataType = this.determineDataType(data);
    const itemCount = this.countItems(data);
    const totalSizeBytes = JSON.stringify(data).length;
    const schema = this.inferSchema(data, userQuery);

    // Create dataset record
    const dataset: StoredDataset = {
      id: datasetId,
      sessionId,
      userId,
      toolName,
      toolArgs,
      userQuery,
      data,
      dataType,
      itemCount,
      totalSizeBytes,
      schema,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.DATA_TTL_SECONDS * 1000),
      accessCount: 0,
      lastAccessedAt: now
    };

    // Store in Redis for this user's fast-path
    await this.persistDataset(dataset);

    // Generate summary for LLM context
    const summary = this.generateSummary(dataset);

    // Shared-scope promotion: if a resourceScope is provided, also write
    // the full blob to PostgreSQL (LargeResponseStorage) so other users
    // hitting the semantic cache for the SAME scope can dereference the
    // datasetId cross-user. Without this step, shared cache hits return a
    // datasetId that only lives in the fetching user's Redis → dangling
    // reference from the querying user's perspective.
    if (opts?.resourceScope) {
      void this.promoteToSharedStorage({
        datasetId,
        sessionId,
        toolCallId: opts.toolCallId || datasetId,
        toolName,
        resourceScope: opts.resourceScope,
        tenantId: opts.tenantId ?? null,
        data,
        summary,
        userQuery,
        totalSizeBytes,
        itemCount,
      });
    }

    this.log.info({
      datasetId,
      toolName,
      itemCount,
      sizeKB: Math.round(totalSizeBytes / 1024),
      sessionId,
      resourceScope: opts?.resourceScope || null,
    }, 'Stored large tool response');

    return { datasetId, summary, schema };
  }

  /**
   * Fire-and-forget write of the full dataset to PostgreSQL
   * LargeResponseStorage so cross-user semantic-cache hits can resolve
   * the blob even after the fetching user's Redis key expires or the
   * querying user's Redis never had it.
   */
  private async promoteToSharedStorage(args: {
    datasetId: string;
    sessionId: string;
    toolCallId: string;
    toolName: string;
    resourceScope: string;
    tenantId: string | null;
    data: unknown;
    summary: string;
    userQuery: string;
    totalSizeBytes: number;
    itemCount: number;
  }): Promise<void> {
    try {
      const fullResult = JSON.stringify(args.data);
      const resultHash = Buffer.from(fullResult).toString('base64').slice(0, 32);
      const compressedSize = args.summary.length;
      const tokenEstimate = Math.ceil(args.totalSizeBytes / 4); // ~4 chars/token
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h in PG vs 1h in Redis

      await prisma.largeResponseStorage.create({
        data: {
          id: args.datasetId,
          session_id: args.sessionId,
          tool_call_id: args.toolCallId,
          tool_name: args.toolName,
          server_id: args.resourceScope, // server_id field repurposed to scope key for now
          full_result: fullResult,
          result_hash: resultHash,
          original_size: args.totalSizeBytes,
          token_estimate: tokenEstimate,
          compressed_summary: args.summary,
          compressed_size: compressedSize,
          compression_strategy: 'summarize',
          information_loss: 'moderate',
          user_query: args.userQuery,
          total_items: args.itemCount,
          items_shown: 0,
          current_page: 1,
          has_more: args.itemCount > 0,
          resource_scope: args.resourceScope,
          is_shared: true,
          tenant_id: args.tenantId,
          expires_at: expiresAt,
        },
      });
      this.log.info({
        datasetId: args.datasetId,
        resourceScope: args.resourceScope,
        sizeKB: Math.round(args.totalSizeBytes / 1024),
      }, '[DATA-LAYER-SHARED] Dataset promoted to PostgreSQL LargeResponseStorage');
    } catch (err) {
      // Non-fatal — primary Redis store already succeeded.
      this.log.warn({ err, datasetId: args.datasetId }, '[DATA-LAYER-SHARED] Promotion failed (non-fatal, Redis still holds data)');
    }
  }

  /**
   * Check if a response should be stored (based on size/complexity)
   */
  shouldStoreResponse(data: unknown): boolean {
    const str = JSON.stringify(data);
    const sizeBytes = str.length;
    const itemCount = this.countItems(data);

    // Store if:
    // - Over 64KB (raised from 16KB — typical K8s/Prometheus responses are 20-40KB)
    // - Over 100 items (raised from 50 — 24 pods + metadata shouldn't trigger storage)
    // - Nested structure with large arrays
    return sizeBytes > 64 * 1024 ||
           itemCount > 100 ||
           (this.determineDataType(data) === 'object' && this.hasLargeNestedArrays(data));
  }

  // ===========================================================================
  // QUERY DATA
  // ===========================================================================

  /**
   * Query stored data with natural language or filters.
   * This is the "Query Many" step - allows LLMs to drill down without re-fetching.
   */
  async queryData(request: DataQueryRequest): Promise<DataQueryResult> {
    const dataset = await this.getDataset(request.datasetId);

    if (!dataset) {
      return {
        success: false,
        datasetId: request.datasetId,
        originalQuery: request.query,
        count: 0,
        totalAvailable: 0,
        anomalyCount: 0,
        hasMore: false,
        contextSummary: `Dataset ${request.datasetId} not found or expired. Please re-fetch the data.`
      };
    }

    // Update access stats
    dataset.accessCount++;
    dataset.lastAccessedAt = new Date();
    await this.persistDataset(dataset);

    // Parse and execute query
    const queryLower = request.query.toLowerCase();
    let items: unknown[] = [];
    let anomalies: unknown[] = [];
    let groupings: Record<string, Record<string, number>> | undefined;

    // Convert data to array for querying
    const dataArray = this.toArray(dataset.data);

    // Handle special query patterns
    if (queryLower.includes('anomal') || queryLower.includes('unhealthy') ||
        queryLower.includes('error') || queryLower.includes('failed')) {
      // Query for anomalies
      anomalies = this.findAnomalies(dataArray, dataset.schema);
      items = anomalies;
    } else if (queryLower.includes('count by') || queryLower.includes('group by')) {
      // Grouping query
      const groupField = this.extractGroupField(queryLower, dataset.schema);
      groupings = this.groupBy(dataArray, groupField);
    } else if (queryLower.includes('all') || queryLower === '*') {
      // Return all (with pagination)
      items = dataArray;
    } else {
      // Filter query
      items = this.filterItems(dataArray, request.query, request.filters, dataset.schema);
      anomalies = this.findAnomalies(items, dataset.schema);
    }

    // Apply pagination
    const limit = request.limit || 20;
    const offset = request.offset || 0;
    const paginatedItems = items.slice(offset, offset + limit);
    const hasMore = offset + limit < items.length;

    // Generate context summary
    const contextSummary = this.generateQuerySummary(
      dataset,
      paginatedItems,
      items.length,
      anomalies.length,
      groupings,
      request.query
    );

    return {
      success: true,
      datasetId: request.datasetId,
      originalQuery: request.query,
      items: paginatedItems,
      count: paginatedItems.length,
      totalAvailable: items.length,
      groupings,
      anomalies: anomalies.slice(0, this.MAX_ANOMALIES_IN_SUMMARY),
      anomalyCount: anomalies.length,
      hasMore,
      nextQuery: hasMore ? `query_data(datasetId: "${request.datasetId}", query: "${request.query}", offset: ${offset + limit})` : undefined,
      contextSummary
    };
  }

  /**
   * Get dataset metadata without full data (for LLM context)
   */
  async getDatasetInfo(datasetId: string): Promise<string | null> {
    const dataset = await this.getDataset(datasetId);
    if (!dataset) return null;

    return this.generateSummary(dataset);
  }

  // ===========================================================================
  // SCHEMA INFERENCE
  // ===========================================================================

  private inferSchema(data: unknown, userQuery: string): DataSchema {
    const dataType = this.determineDataType(data);
    const fields: SchemaField[] = [];
    const sampleValues: Record<string, unknown> = {};
    const anomalyFields: string[] = [];
    const statusFields: string[] = [];

    if (dataType === 'array' && Array.isArray(data) && data.length > 0) {
      const sample = data[0];
      if (typeof sample === 'object' && sample !== null) {
        for (const [key, value] of Object.entries(sample as Record<string, unknown>)) {
          const field = this.inferFieldSchema(key, data as Record<string, unknown>[]);
          fields.push(field);
          sampleValues[key] = value;

          // Identify anomaly/status fields
          const keyLower = key.toLowerCase();
          if (['status', 'health', 'state', 'condition'].some(s => keyLower.includes(s))) {
            statusFields.push(key);
          }
          if (['error', 'warning', 'fault', 'issue'].some(s => keyLower.includes(s))) {
            anomalyFields.push(key);
          }
        }
      }
    } else if (dataType === 'object' && typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        fields.push({
          name: key,
          type: Array.isArray(value) ? 'array' : typeof value,
          isArray: Array.isArray(value)
        });
        sampleValues[key] = Array.isArray(value) ? `[${value.length} items]` : value;
      }
    }

    return {
      type: dataType,
      fields,
      sampleValues,
      anomalyFields,
      statusFields
    };
  }

  private inferFieldSchema(fieldName: string, items: Record<string, unknown>[]): SchemaField {
    const values = items.map(item => item[fieldName]).filter(v => v !== undefined && v !== null);
    const uniqueValues = [...new Set(values.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)))];

    // Determine type
    const sampleValue = values[0];
    let type = typeof sampleValue;
    const isArray = Array.isArray(sampleValue);

    // For enum-like fields (few unique values)
    const enumValues = uniqueValues.length <= 10 ? uniqueValues.slice(0, 10) : undefined;

    // For numeric fields
    let minValue: number | undefined;
    let maxValue: number | undefined;
    if (type === 'number') {
      const nums = values.filter(v => typeof v === 'number') as number[];
      minValue = Math.min(...nums);
      maxValue = Math.max(...nums);
    }

    return {
      name: fieldName,
      type,
      isArray,
      uniqueValues: enumValues as (string | number)[] | undefined,
      minValue,
      maxValue,
      commonValues: uniqueValues.slice(0, 5) as string[]
    };
  }

  // ===========================================================================
  // ANOMALY DETECTION
  // ===========================================================================

  private findAnomalies(items: unknown[], schema: DataSchema): unknown[] {
    const anomalies: unknown[] = [];

    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;

      let isAnomaly = false;

      // Check status fields
      for (const field of schema.statusFields) {
        const value = String(obj[field] || '').toLowerCase();
        if (['unhealthy', 'failed', 'error', 'critical', 'down', 'stopped', 'terminated'].some(s => value.includes(s))) {
          isAnomaly = true;
          break;
        }
      }

      // Check anomaly fields
      for (const field of schema.anomalyFields) {
        const value = obj[field];
        if (value && (
          (typeof value === 'string' && value.length > 0) ||
          (Array.isArray(value) && value.length > 0) ||
          (typeof value === 'object' && Object.keys(value).length > 0)
        )) {
          isAnomaly = true;
          break;
        }
      }

      if (isAnomaly) anomalies.push(item);
    }

    return anomalies;
  }

  // ===========================================================================
  // FILTERING & GROUPING
  // ===========================================================================

  private filterItems(
    items: unknown[],
    query: string,
    filters: Record<string, unknown> | undefined,
    schema: DataSchema
  ): unknown[] {
    const queryLower = query.toLowerCase();

    // Extract field=value patterns from query
    const fieldValuePattern = /(\w+)\s*[=:]\s*["']?([^"'\s,]+)["']?/gi;
    const extractedFilters: Record<string, string> = {};
    let match;
    while ((match = fieldValuePattern.exec(query)) !== null) {
      extractedFilters[match[1].toLowerCase()] = match[2].toLowerCase();
    }

    // Merge with explicit filters
    const allFilters = { ...extractedFilters, ...(filters || {}) };

    // Apply filters
    return items.filter(item => {
      if (typeof item !== 'object' || item === null) return false;
      const obj = item as Record<string, unknown>;

      // Check explicit filters
      for (const [key, value] of Object.entries(allFilters)) {
        const itemValue = this.getFieldValue(obj, key);
        if (itemValue === undefined) continue;
        if (String(itemValue).toLowerCase() !== String(value).toLowerCase()) {
          return false;
        }
      }

      // Check for keyword matches in any field
      const keywords = queryLower.split(/\s+/).filter(w =>
        w.length > 2 &&
        !['the', 'and', 'for', 'with', 'show', 'list', 'get', 'find'].includes(w)
      );

      if (keywords.length > 0 && Object.keys(allFilters).length === 0) {
        const itemStr = JSON.stringify(obj).toLowerCase();
        return keywords.some(kw => itemStr.includes(kw));
      }

      return true;
    });
  }

  private getFieldValue(obj: Record<string, unknown>, fieldName: string): unknown {
    // Case-insensitive field lookup
    const fieldLower = fieldName.toLowerCase();
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase() === fieldLower) return value;
    }
    return undefined;
  }

  private groupBy(items: unknown[], field: string): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    result[field] = {};

    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      const value = String(this.getFieldValue(obj, field) || 'unknown');
      result[field][value] = (result[field][value] || 0) + 1;
    }

    return result;
  }

  private extractGroupField(query: string, schema: DataSchema): string {
    // Look for "count by X" or "group by X"
    const match = query.match(/(?:count|group)\s+by\s+(\w+)/i);
    if (match) return match[1];

    // Default to first status field or 'status'
    return schema.statusFields[0] || 'status';
  }

  // ===========================================================================
  // SUMMARY GENERATION
  // ===========================================================================

  private generateSummary(dataset: StoredDataset): string {
    const lines: string[] = [];

    lines.push(`📊 **Dataset stored** (ID: \`${dataset.id}\`)`);
    lines.push(`   Tool: ${dataset.toolName}`);
    lines.push(`   Items: ${dataset.itemCount} | Type: ${dataset.dataType} | Size: ${Math.round(dataset.totalSizeBytes / 1024)}KB`);

    // Schema summary
    if (dataset.schema.fields.length > 0) {
      const fieldNames = dataset.schema.fields.slice(0, 8).map(f => f.name).join(', ');
      lines.push(`   Fields: ${fieldNames}${dataset.schema.fields.length > 8 ? '...' : ''}`);
    }

    // Anomaly summary
    if (dataset.dataType === 'array') {
      const dataArray = this.toArray(dataset.data);
      const anomalies = this.findAnomalies(dataArray, dataset.schema);
      const healthy = dataset.itemCount - anomalies.length;

      if (anomalies.length > 0) {
        lines.push(`   ⚠️ **Anomalies**: ${anomalies.length} items need attention`);
        lines.push(`   ✅ Healthy: ${healthy} items`);
      } else {
        lines.push(`   ✅ All ${dataset.itemCount} items appear healthy`);
      }
    }

    // Status field distribution
    if (dataset.schema.statusFields.length > 0) {
      const dataArray = this.toArray(dataset.data);
      const groupings = this.groupBy(dataArray, dataset.schema.statusFields[0]);
      const statusField = dataset.schema.statusFields[0];
      if (groupings[statusField] && Object.keys(groupings[statusField]).length > 0) {
        const distribution = Object.entries(groupings[statusField])
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        lines.push(`   Status distribution: ${distribution}`);
      }
    }

    // Data preview — show first 5 items with key fields so the LLM has actual values.
    // Without this, the model only sees counts and field names, not real data.
    if (dataset.dataType === 'array') {
      const dataArray = this.toArray(dataset.data);
      const previewItems = dataArray.slice(0, 5);
      if (previewItems.length > 0) {
        const keyFields = dataset.schema.fields.slice(0, 4).map(f => f.name);
        lines.push(`   Preview (first ${previewItems.length} of ${dataset.itemCount}):`);
        for (const item of previewItems) {
          if (typeof item === 'object' && item !== null) {
            const vals = keyFields.map(f => `${f}=${(item as any)[f] ?? '?'}`).join(', ');
            lines.push(`     - ${vals}`);
          } else {
            lines.push(`     - ${String(item).substring(0, 100)}`);
          }
        }
        if (dataset.itemCount > 5) {
          lines.push(`     ... and ${dataset.itemCount - 5} more`);
        }
      }
    }

    lines.push('');
    lines.push(`   💡 Use \`query_data(datasetId: "${dataset.id}", query: "your question")\` to explore without re-fetching.`);

    return lines.join('\n');
  }

  private generateQuerySummary(
    dataset: StoredDataset,
    items: unknown[],
    totalMatching: number,
    anomalyCount: number,
    groupings: Record<string, Record<string, number>> | undefined,
    query: string
  ): string {
    const lines: string[] = [];

    lines.push(`Query: "${query}" on dataset ${dataset.id}`);
    lines.push(`Matched: ${totalMatching} items (showing ${items.length})`);

    if (anomalyCount > 0) {
      lines.push(`⚠️ ${anomalyCount} anomalies in results`);
    }

    if (groupings) {
      for (const [field, groups] of Object.entries(groupings)) {
        const dist = Object.entries(groups).map(([k, v]) => `${k}: ${v}`).join(', ');
        lines.push(`By ${field}: ${dist}`);
      }
    }

    return lines.join('\n');
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  private async persistDataset(dataset: StoredDataset): Promise<void> {
    const key = `${this.REDIS_KEY_PREFIX}${dataset.id}`;
    await this.ensureRedis();

    if (this.redis) {
      try {
        await this.redis.set(key, dataset, this.DATA_TTL_SECONDS);
      } catch (error) {
        this.log.error({ error, datasetId: dataset.id }, 'Redis persist failed — dataset will be lost (no in-memory fallback)');
        throw new Error(`Failed to persist dataset ${dataset.id} to Redis: ${error}`);
      }
    } else {
      this.log.error({ datasetId: dataset.id }, 'Redis not available — cannot persist dataset (multi-pod requires Redis)');
      throw new Error('Redis not available — DataLayerService requires Redis for multi-pod safety');
    }
  }

  private async getDataset(datasetId: string): Promise<StoredDataset | null> {
    const key = `${this.REDIS_KEY_PREFIX}${datasetId}`;
    await this.ensureRedis();

    // Primary: Redis fast-path (per-user fetch cache).
    if (this.redis) {
      try {
        const data = await this.redis.get(key);
        if (data) {
          if (typeof data === 'string') return JSON.parse(data) as StoredDataset;
          return data as StoredDataset;
        }
      } catch (error) {
        this.log.error({ error, datasetId }, 'Redis get failed for dataset');
        // fall through to PG fallback
      }
    }

    // Fallback: PostgreSQL LargeResponseStorage — reached when the user's
    // Redis never had this datasetId (cross-user shared-cache hit), or the
    // Redis TTL elapsed. Only rows with is_shared=true are returned.
    try {
      const row = await prisma.largeResponseStorage.findFirst({
        where: { id: datasetId, is_shared: true, expires_at: { gt: new Date() } },
      });
      if (!row) return null;
      this.log.info({ datasetId, scope: row.resource_scope }, '[DATA-LAYER-SHARED] Redis miss, served from PostgreSQL shared storage');
      const parsedData = JSON.parse(row.full_result);
      return {
        id: row.id,
        sessionId: row.session_id,
        userId: '', // original fetcher — not propagated to consumers
        toolName: row.tool_name,
        toolArgs: {},
        userQuery: row.user_query,
        data: parsedData,
        dataType: this.determineDataType(parsedData),
        itemCount: row.total_items ?? this.countItems(parsedData),
        totalSizeBytes: row.original_size,
        schema: this.inferSchema(parsedData, row.user_query),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        accessCount: 0,
        lastAccessedAt: new Date(),
      };
    } catch (pgErr) {
      this.log.error({ pgErr, datasetId }, '[DATA-LAYER-SHARED] PG fallback failed');
      return null;
    }
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  private determineDataType(data: unknown): 'array' | 'object' | 'primitive' {
    if (Array.isArray(data)) return 'array';
    if (typeof data === 'object' && data !== null) return 'object';
    return 'primitive';
  }

  private countItems(data: unknown): number {
    if (Array.isArray(data)) return data.length;
    if (typeof data === 'object' && data !== null) return Object.keys(data).length;
    return 1;
  }

  private toArray(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    if (typeof data === 'object' && data !== null) return Object.values(data);
    return [data];
  }

  private hasLargeNestedArrays(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false;

    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 20) return true;
    }

    return false;
  }

  // ===========================================================================
  // STATS & CLEANUP
  // ===========================================================================

  async getStats(): Promise<DataLayerStats> {
    // Stats from Redis — datasets auto-expire via TTL
    return {
      totalDatasets: 0,  // Redis doesn't expose count without SCAN
      totalSizeBytes: 0,
      avgQueryTimeMs: 0,
      cacheHitRate: 0,
      datasetsPerSession: {}
    };
  }

  async cleanup(): Promise<number> {
    // Redis handles TTL-based cleanup automatically
    this.log.info('Cleanup: Redis handles TTL expiry automatically');
    return 0;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let instance: DataLayerService | null = null;

export function getDataLayerService(): DataLayerService {
  if (!instance) {
    instance = new DataLayerService();
  }
  return instance;
}

export default DataLayerService;
