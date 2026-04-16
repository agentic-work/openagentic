/**
 * DataQueryTool
 *
 * A system tool that allows LLMs to query stored datasets without re-fetching.
 * This implements the "Query Many" part of the "Fetch Once, Query Many" pattern.
 *
 * Usage by LLMs:
 * - query_data(datasetId: "data_abc123", query: "show unhealthy items")
 * - query_data(datasetId: "data_abc123", query: "count by status")
 * - query_data(datasetId: "data_abc123", filters: { status: "failed" }, limit: 10)
 *
 * This tool is automatically injected into all chat sessions and allows models
 * to efficiently work with large datasets that were stored by previous tool calls.
 */

import logger from '../utils/logger.js';
import { getDataLayerService, type DataQueryResult } from './DataLayerService.js';
import { getAgentRegistry } from './AgentRegistry.js';
import { getLargeResultStorageService } from './LargeResultStorageService.js';
import type { Logger } from 'pino';

// =============================================================================
// TOOL DEFINITION
// =============================================================================

/**
 * Tool definition for MCP discovery
 */
export const QUERY_DATA_TOOL_DEFINITION = {
  name: 'query_data',
  description: `Query a previously stored dataset without re-fetching the data.

Use this tool to drill down into large datasets that were returned by previous tool calls.
When a tool returns a dataset reference (e.g., "Dataset stored: data_abc123"), use this tool
to query that data instead of calling the original tool again.

IMPORTANT: This is the preferred way to work with large data. Do NOT re-fetch data that's already stored.

Examples:
- Show unhealthy items: query_data(datasetId: "data_abc", query: "status = unhealthy")
- Count by region: query_data(datasetId: "data_abc", query: "count by location")
- Get specific item: query_data(datasetId: "data_abc", query: "name = my-vm-01")
- First 10 items: query_data(datasetId: "data_abc", limit: 10)
- Filter and paginate: query_data(datasetId: "data_abc", filters: { status: "running" }, limit: 20, offset: 0)`,
  inputSchema: {
    type: 'object',
    properties: {
      datasetId: {
        type: 'string',
        description: 'The dataset ID returned by a previous tool call (e.g., "data_abc123")'
      },
      query: {
        type: 'string',
        description: 'Natural language query or filter expression (e.g., "unhealthy items", "count by status", "name=my-vm")'
      },
      filters: {
        type: 'object',
        description: 'Optional key-value filters to apply (e.g., { "status": "failed", "location": "eastus" })',
        additionalProperties: true
      },
      limit: {
        type: 'number',
        description: 'Maximum number of items to return (default: 20)',
        default: 20
      },
      offset: {
        type: 'number',
        description: 'Number of items to skip for pagination (default: 0)',
        default: 0
      },
      includeStats: {
        type: 'boolean',
        description: 'Include statistical summary in results',
        default: false
      }
    },
    required: ['datasetId']
  }
};

// =============================================================================
// TOOL EXECUTION
// =============================================================================

export interface QueryDataParams {
  datasetId: string;
  query?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  includeStats?: boolean;
}

export interface QueryDataResponse {
  success: boolean;
  summary: string;
  items?: unknown[];
  itemCount: number;
  totalAvailable: number;
  anomalyCount: number;
  groupings?: Record<string, Record<string, number>>;
  hasMore: boolean;
  nextQuery?: string;
  error?: string;
}

/**
 * Execute the query_data tool
 */
export async function executeQueryData(
  params: QueryDataParams,
  sessionId: string,
  userId: string,
  executionId?: string
): Promise<QueryDataResponse> {
  const log = logger.child({
    service: 'DataQueryTool',
    sessionId,
    userId,
    datasetId: params.datasetId
  });

  const startTime = Date.now();
  const dataLayer = getDataLayerService();
  const registry = getAgentRegistry();

  try {
    log.info({
      query: params.query,
      filters: params.filters,
      limit: params.limit,
      offset: params.offset
    }, 'Executing query_data tool');

    // Record this tool call in the execution (if tracking)
    if (executionId) {
      registry.recordToolCall(executionId, 'query_data');
      registry.recordDatasetAccess(executionId, params.datasetId);
    }

    // Execute the query
    const result = await dataLayer.queryData({
      datasetId: params.datasetId,
      query: params.query || '*',
      filters: params.filters,
      limit: params.limit,
      offset: params.offset,
      includeStats: params.includeStats
    });

    const durationMs = Date.now() - startTime;

    if (!result.success) {
      // FALLBACK: Check LargeResultStorageService for result_ prefixed IDs
      // This handles cases where MCP tool results were stored but not indexed in DataLayerService
      if (params.datasetId.startsWith('result_')) {
        log.info({ datasetId: params.datasetId }, 'Dataset not in DataLayer, checking LargeResultStorageService');

        const largeResultStorage = getLargeResultStorageService();
        const storedResult = await largeResultStorage.getResultAsync(params.datasetId);

        if (storedResult) {
          log.info({
            datasetId: params.datasetId,
            toolName: storedResult.toolName,
            durationMs: Date.now() - startTime
          }, '📦 Found result in LargeResultStorageService, returning full data');

          // Return the full result data
          const resultData = storedResult.result;
          let items: unknown[] = [];
          let totalCount = 0;

          // Handle different result structures
          if (Array.isArray(resultData)) {
            items = resultData.slice(params.offset || 0, (params.offset || 0) + (params.limit || 20));
            totalCount = resultData.length;
          } else if (resultData && typeof resultData === 'object') {
            // Look for common array properties
            const arrayProps = ['items', 'data', 'results', 'records', 'subscriptions',
                               'backend_address_pools', 'http_listeners', 'probes',
                               'frontend_ports', 'request_routing_rules'];
            for (const prop of arrayProps) {
              if (Array.isArray((resultData as any)[prop])) {
                items = ((resultData as any)[prop] as unknown[]).slice(
                  params.offset || 0,
                  (params.offset || 0) + (params.limit || 20)
                );
                totalCount = ((resultData as any)[prop] as unknown[]).length;
                break;
              }
            }
            // If no array found, return the object as a single item
            if (items.length === 0) {
              items = [resultData];
              totalCount = 1;
            }
          }

          return {
            success: true,
            summary: storedResult.summary,
            items,
            itemCount: items.length,
            totalAvailable: totalCount,
            anomalyCount: 0,
            hasMore: totalCount > (params.offset || 0) + items.length,
            nextQuery: totalCount > (params.offset || 0) + items.length
              ? `offset=${(params.offset || 0) + items.length}`
              : undefined
          };
        }
      }

      log.warn({ datasetId: params.datasetId, durationMs }, 'Dataset not found in any storage');
      return {
        success: false,
        summary: result.contextSummary,
        itemCount: 0,
        totalAvailable: 0,
        anomalyCount: 0,
        hasMore: false,
        error: `Dataset ${params.datasetId} not found or expired. You may need to re-fetch the data.`
      };
    }

    log.info({
      durationMs,
      itemCount: result.count,
      totalAvailable: result.totalAvailable,
      anomalyCount: result.anomalyCount,
      hasMore: result.hasMore
    }, 'Query executed successfully');

    return {
      success: true,
      summary: result.contextSummary,
      items: result.items,
      itemCount: result.count,
      totalAvailable: result.totalAvailable,
      anomalyCount: result.anomalyCount,
      groupings: result.groupings,
      hasMore: result.hasMore,
      nextQuery: result.nextQuery
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;
    log.error({ error, durationMs }, 'Failed to execute query_data');

    return {
      success: false,
      summary: 'Query failed due to an error',
      itemCount: 0,
      totalAvailable: 0,
      anomalyCount: 0,
      hasMore: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Format query result for LLM context
 * Converts the result to a human-readable format that fits well in prompts
 */
export function formatQueryResultForLLM(result: QueryDataResponse): string {
  const lines: string[] = [];

  if (!result.success) {
    lines.push(`❌ Query failed: ${result.error}`);
    return lines.join('\n');
  }

  lines.push(`✅ Query Results:`);
  lines.push(result.summary);
  lines.push('');

  // Add groupings if present
  if (result.groupings && Object.keys(result.groupings).length > 0) {
    lines.push('📊 Groupings:');
    for (const [field, groups] of Object.entries(result.groupings)) {
      const dist = Object.entries(groups)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      lines.push(`By ${field}:`);
      lines.push(dist);
    }
    lines.push('');
  }

  // Add items if present
  if (result.items && result.items.length > 0) {
    lines.push(`📋 Items (${result.itemCount} of ${result.totalAvailable}):`);

    // Format items nicely
    for (let i = 0; i < Math.min(result.items.length, 10); i++) {
      const item = result.items[i];
      // Try to extract key identifiers
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        const name = obj.name || obj.id || obj.title || `Item ${i + 1}`;
        const status = obj.status || obj.health || obj.state || '';
        const location = obj.location || obj.region || '';

        let summary = `  ${i + 1}. ${name}`;
        if (status) summary += ` [${status}]`;
        if (location) summary += ` (${location})`;
        lines.push(summary);
      } else {
        lines.push(`  ${i + 1}. ${JSON.stringify(item)}`);
      }
    }

    if (result.itemCount > 10) {
      lines.push(`  ... and ${result.itemCount - 10} more items`);
    }
    lines.push('');
  }

  // Add anomaly highlight
  if (result.anomalyCount > 0) {
    lines.push(`⚠️ ${result.anomalyCount} anomalies found in results`);
  }

  // Add pagination info
  if (result.hasMore) {
    lines.push('');
    lines.push(`📄 More results available. Use: ${result.nextQuery}`);
  }

  return lines.join('\n');
}

// =============================================================================
// LIST DATASETS TOOL (for discovery)
// =============================================================================

export const LIST_DATASETS_TOOL_DEFINITION = {
  name: 'list_datasets',
  description: `List all datasets currently stored in your session.

Use this to see what data is available for querying without re-fetching.
Each dataset has an ID that you can use with the query_data tool.`,
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID (automatically provided)'
      }
    },
    required: []
  }
};

/**
 * List available datasets for a session
 */
export async function listDatasets(sessionId: string): Promise<{
  datasets: Array<{
    id: string;
    toolName: string;
    itemCount: number;
    createdAt: Date;
  }>;
}> {
  // For now, return empty - this would query the DataLayerService
  // In a full implementation, DataLayerService would track datasets by session
  return { datasets: [] };
}

// =============================================================================
// TOOL REGISTRATION
// =============================================================================

/**
 * Common interface for data layer tool definitions
 */
export interface DataLayerToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Get all data layer tools for injection into MCP discovery
 */
export function getDataLayerTools(): DataLayerToolDefinition[] {
  return [
    QUERY_DATA_TOOL_DEFINITION as DataLayerToolDefinition,
    LIST_DATASETS_TOOL_DEFINITION as DataLayerToolDefinition
  ];
}

/**
 * Check if a tool name is a data layer tool
 */
export function isDataLayerTool(toolName: string): boolean {
  return toolName === 'query_data' || toolName === 'list_datasets';
}

/**
 * Execute a data layer tool
 */
export async function executeDataLayerTool(
  toolName: string,
  params: Record<string, unknown>,
  sessionId: string,
  userId: string,
  executionId?: string
): Promise<unknown> {
  switch (toolName) {
    case 'query_data':
      // Cast params to QueryDataParams with required datasetId
      const queryParams: QueryDataParams = {
        datasetId: params.datasetId as string,
        query: params.query as string | undefined,
        filters: params.filters as Record<string, unknown> | undefined,
        limit: params.limit as number | undefined,
        offset: params.offset as number | undefined,
        includeStats: params.includeStats as boolean | undefined
      };
      return executeQueryData(queryParams, sessionId, userId, executionId);
    case 'list_datasets':
      return listDatasets(sessionId);
    default:
      throw new Error(`Unknown data layer tool: ${toolName}`);
  }
}

export default {
  QUERY_DATA_TOOL_DEFINITION,
  LIST_DATASETS_TOOL_DEFINITION,
  executeQueryData,
  formatQueryResultForLLM,
  getDataLayerTools,
  isDataLayerTool,
  executeDataLayerTool
};
