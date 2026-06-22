/**
 * LargeResponseHandler
 *
 * Handles massive tool responses without losing critical information or exceeding context limits.
 * Part of the Data Layer Evolution Plan - Phase: Large Response Handling
 *
 * Problem: Tool responses can exceed model context windows. Simple truncation loses data
 * and can lead to incorrect conclusions.
 *
 * Solution: Smart extraction strategies based on user query context:
 * - Anomaly prioritization: Surface items that differ from majority
 * - Query-aligned filtering: Extract only data relevant to query
 * - Statistical summary: Counts, distributions, ranges
 * - Hierarchical compression: Tree structure with expandable nodes
 * - Reference storage: Store full result, return summary + ref ID
 */

import { Logger } from 'pino';
import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

// Token limits for different strategies
const TOKEN_LIMITS = {
  passThrough: 4000,   // Just pass it through
  summarize: 16000,    // Needs summarization
  extract: 32000       // Above this - smart extraction required
};

// Approximate tokens per character (for estimation)
const CHARS_PER_TOKEN = 4;

export type CompressionStrategy = 'passthrough' | 'filter' | 'summarize' | 'paginate' | 'extract';
export type InformationLoss = 'none' | 'minimal' | 'moderate' | 'significant';

export interface ProcessedResponse {
  // What to send to LLM
  compressedResult: string;

  // Metadata
  originalSize: number;
  compressedSize: number;
  compressionStrategy: CompressionStrategy;

  // For follow-up
  fullResultId?: string;    // Reference to stored full result
  pagination?: {
    total: number;
    shown: number;
    hasMore: boolean;
    nextCommand: string;    // "show more backends"
  };

  // Quality indicators
  informationLoss: InformationLoss;
  anomaliesPreserved: boolean;

  // Processing time
  processingDurationMs: number;
}

export interface LargeResponseConfig {
  tokenLimits: typeof TOKEN_LIMITS;
  enableAnomalyPrioritization: boolean;
  enableQueryFiltering: boolean;
  maxItemsBeforePagination: number;
  storeFullResults: boolean;
}

const DEFAULT_CONFIG: LargeResponseConfig = {
  tokenLimits: TOKEN_LIMITS,
  enableAnomalyPrioritization: true,
  enableQueryFiltering: true,
  maxItemsBeforePagination: 50,
  storeFullResults: true
};

// In-memory storage for full results (should be Redis in production)
const fullResultStore: Map<string, { result: unknown; timestamp: Date; userQuery: string }> = new Map();

export class LargeResponseHandler {
  private log: Logger;
  private config: LargeResponseConfig;

  constructor(config: Partial<LargeResponseConfig> = {}) {
    this.log = logger.child({ service: 'LargeResponseHandler' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process a potentially large tool response
   */
  async processLargeResponse(
    toolResult: unknown,
    userQuery: string,
    contextBudget: number = 16000
  ): Promise<ProcessedResponse> {
    const startTime = Date.now();
    const rawResult = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2);
    const originalSize = rawResult.length;
    const estimatedTokens = originalSize / CHARS_PER_TOKEN;

    this.log.debug({
      originalSize,
      estimatedTokens,
      contextBudget,
      userQuery: userQuery.substring(0, 100)
    }, 'Processing large response');

    // Determine strategy based on size
    let strategy: CompressionStrategy;
    if (estimatedTokens <= this.config.tokenLimits.passThrough) {
      strategy = 'passthrough';
    } else if (estimatedTokens <= this.config.tokenLimits.summarize) {
      strategy = 'summarize';
    } else if (estimatedTokens <= this.config.tokenLimits.extract) {
      strategy = 'filter';
    } else {
      strategy = 'extract';
    }

    let result: ProcessedResponse;

    switch (strategy) {
      case 'passthrough':
        result = this.passThrough(rawResult, originalSize, startTime);
        break;
      case 'summarize':
        result = await this.summarizeResponse(toolResult, userQuery, originalSize, startTime);
        break;
      case 'filter':
        result = await this.filterResponse(toolResult, userQuery, originalSize, contextBudget, startTime);
        break;
      case 'extract':
        result = await this.smartExtract(toolResult, userQuery, originalSize, contextBudget, startTime);
        break;
      default:
        result = this.passThrough(rawResult, originalSize, startTime);
    }

    // Store full result if configured and compressed
    if (this.config.storeFullResults && strategy !== 'passthrough') {
      const fullResultId = uuidv4();
      fullResultStore.set(fullResultId, {
        result: toolResult,
        timestamp: new Date(),
        userQuery
      });
      result.fullResultId = fullResultId;
    }

    this.log.info({
      originalSize,
      compressedSize: result.compressedSize,
      strategy: result.compressionStrategy,
      informationLoss: result.informationLoss,
      durationMs: result.processingDurationMs
    }, 'Response processing complete');

    return result;
  }

  /**
   * Pass through small responses unchanged
   */
  private passThrough(rawResult: string, originalSize: number, startTime: number): ProcessedResponse {
    return {
      compressedResult: rawResult,
      originalSize,
      compressedSize: rawResult.length,
      compressionStrategy: 'passthrough',
      informationLoss: 'none',
      anomaliesPreserved: true,
      processingDurationMs: Date.now() - startTime
    };
  }

  /**
   * Summarize medium-sized responses
   */
  private async summarizeResponse(
    toolResult: unknown,
    userQuery: string,
    originalSize: number,
    startTime: number
  ): Promise<ProcessedResponse> {
    // Parse and analyze structure
    const parsed = typeof toolResult === 'string' ? this.tryParse(toolResult) : toolResult;

    if (Array.isArray(parsed)) {
      return this.summarizeArray(parsed, userQuery, originalSize, startTime);
    } else if (typeof parsed === 'object' && parsed !== null) {
      return this.summarizeObject(parsed as Record<string, unknown>, userQuery, originalSize, startTime);
    }

    // Fall back to truncation for non-structured data
    const rawResult = String(toolResult);
    const truncated = rawResult.substring(0, this.config.tokenLimits.summarize * CHARS_PER_TOKEN);
    return {
      compressedResult: truncated + (rawResult.length > truncated.length ? '\n...[truncated]' : ''),
      originalSize,
      compressedSize: truncated.length,
      compressionStrategy: 'summarize',
      informationLoss: rawResult.length > truncated.length ? 'moderate' : 'none',
      anomaliesPreserved: false,
      processingDurationMs: Date.now() - startTime
    };
  }

  /**
   * Summarize an array of items
   */
  private summarizeArray(
    items: unknown[],
    userQuery: string,
    originalSize: number,
    startTime: number
  ): ProcessedResponse {
    const total = items.length;

    // Analyze for anomalies if enabled
    let anomalies: unknown[] = [];
    let normalItems: unknown[] = items;

    if (this.config.enableAnomalyPrioritization && total > 0) {
      const { anomalyItems, normalItemsFiltered } = this.detectAnomalies(items, userQuery);
      anomalies = anomalyItems;
      normalItems = normalItemsFiltered;
    }

    // Build summary
    const summary: string[] = [];
    summary.push(`Total items: ${total}`);

    // Add statistical summary
    const stats = this.calculateArrayStats(items);
    if (stats) {
      summary.push(`Statistics: ${stats}`);
    }

    // Prioritize anomalies
    if (anomalies.length > 0) {
      summary.push(`\n--- Anomalies (${anomalies.length}) ---`);
      const maxAnomalies = Math.min(anomalies.length, 10);
      for (let i = 0; i < maxAnomalies; i++) {
        summary.push(JSON.stringify(anomalies[i], null, 2));
      }
      if (anomalies.length > maxAnomalies) {
        summary.push(`... and ${anomalies.length - maxAnomalies} more anomalies`);
      }
    }

    // Show sample of normal items
    if (normalItems.length > 0 && anomalies.length < 10) {
      summary.push(`\n--- Sample (first 5 of ${normalItems.length} normal items) ---`);
      const sampleCount = Math.min(normalItems.length, 5);
      for (let i = 0; i < sampleCount; i++) {
        summary.push(JSON.stringify(normalItems[i], null, 2));
      }
    }

    const compressedResult = summary.join('\n');

    return {
      compressedResult,
      originalSize,
      compressedSize: compressedResult.length,
      compressionStrategy: 'summarize',
      pagination: total > this.config.maxItemsBeforePagination ? {
        total,
        shown: Math.min(10, anomalies.length) + Math.min(5, normalItems.length),
        hasMore: true,
        nextCommand: 'show more items'
      } : undefined,
      informationLoss: total > 15 ? 'moderate' : 'minimal',
      anomaliesPreserved: anomalies.length > 0 || total <= 10,
      processingDurationMs: Date.now() - startTime
    };
  }

  /**
   * Summarize an object
   */
  private summarizeObject(
    obj: Record<string, unknown>,
    userQuery: string,
    originalSize: number,
    startTime: number
  ): ProcessedResponse {
    const summary: string[] = [];
    const keys = Object.keys(obj);

    summary.push(`Object with ${keys.length} top-level keys:`);

    // List keys with type info
    for (const key of keys.slice(0, 20)) {
      const value = obj[key];
      const type = Array.isArray(value) ? `array[${value.length}]` :
                   typeof value === 'object' && value !== null ? 'object' :
                   typeof value;

      // For arrays, show count
      if (Array.isArray(value)) {
        const anomalyInfo = this.config.enableAnomalyPrioritization ?
          this.getAnomalyCount(value, userQuery) : '';
        summary.push(`  ${key}: ${type}${anomalyInfo}`);
      } else if (typeof value === 'string' && value.length > 100) {
        summary.push(`  ${key}: string (${value.length} chars)`);
      } else {
        summary.push(`  ${key}: ${JSON.stringify(value)}`);
      }
    }

    if (keys.length > 20) {
      summary.push(`  ... and ${keys.length - 20} more keys`);
    }

    // Find and prioritize error/warning fields
    const errorFields = this.findErrorFields(obj);
    if (errorFields.length > 0) {
      summary.push('\n--- Errors/Warnings Found ---');
      for (const { key, value } of errorFields) {
        summary.push(`${key}: ${JSON.stringify(value)}`);
      }
    }

    const compressedResult = summary.join('\n');

    return {
      compressedResult,
      originalSize,
      compressedSize: compressedResult.length,
      compressionStrategy: 'summarize',
      informationLoss: keys.length > 20 ? 'moderate' : 'minimal',
      anomaliesPreserved: errorFields.length > 0,
      processingDurationMs: Date.now() - startTime
    };
  }

  /**
   * Filter response based on user query
   */
  private async filterResponse(
    toolResult: unknown,
    userQuery: string,
    originalSize: number,
    contextBudget: number,
    startTime: number
  ): Promise<ProcessedResponse> {
    const parsed = typeof toolResult === 'string' ? this.tryParse(toolResult) : toolResult;

    if (!this.config.enableQueryFiltering) {
      return this.summarizeResponse(toolResult, userQuery, originalSize, startTime);
    }

    // Extract filter keywords from user query
    const filterKeywords = this.extractFilterKeywords(userQuery);

    if (Array.isArray(parsed)) {
      const filtered = this.filterArrayByQuery(parsed, filterKeywords, userQuery);
      if (filtered.length < parsed.length) {
        const summary = [
          `Filtered to ${filtered.length} of ${parsed.length} items matching query.`,
          `Query keywords: ${filterKeywords.join(', ')}`,
          '',
          JSON.stringify(filtered, null, 2)
        ].join('\n');

        return {
          compressedResult: summary.substring(0, contextBudget * CHARS_PER_TOKEN),
          originalSize,
          compressedSize: summary.length,
          compressionStrategy: 'filter',
          pagination: filtered.length > this.config.maxItemsBeforePagination ? {
            total: filtered.length,
            shown: this.config.maxItemsBeforePagination,
            hasMore: true,
            nextCommand: 'show more matching items'
          } : undefined,
          informationLoss: 'minimal',
          anomaliesPreserved: true,
          processingDurationMs: Date.now() - startTime
        };
      }
    }

    // Fall back to summarize if filtering didn't help
    return this.summarizeResponse(toolResult, userQuery, originalSize, startTime);
  }

  /**
   * Smart extraction for very large responses
   */
  private async smartExtract(
    toolResult: unknown,
    userQuery: string,
    originalSize: number,
    contextBudget: number,
    startTime: number
  ): Promise<ProcessedResponse> {
    const parsed = typeof toolResult === 'string' ? this.tryParse(toolResult) : toolResult;

    // First, try query-aligned filtering
    const filterKeywords = this.extractFilterKeywords(userQuery);
    const queryLower = userQuery.toLowerCase();

    // Special handling for common query patterns
    if (queryLower.includes('unhealthy') || queryLower.includes('error') ||
        queryLower.includes('failed') || queryLower.includes('warning')) {
      // User is looking for problems - prioritize anomalies
      return this.extractAnomaliesOnly(parsed, userQuery, originalSize, startTime);
    }

    if (queryLower.includes('count') || queryLower.includes('how many') ||
        queryLower.includes('total')) {
      // User wants counts - provide statistical summary
      return this.extractStatistics(parsed, userQuery, originalSize, startTime);
    }

    // Extract with hierarchical summary
    return this.extractHierarchical(parsed, userQuery, originalSize, contextBudget, startTime);
  }

  /**
   * Extract only anomalies from the result
   */
  private extractAnomaliesOnly(
    toolResult: unknown,
    userQuery: string,
    originalSize: number,
    startTime: number
  ): ProcessedResponse {
    const summary: string[] = [];

    if (Array.isArray(toolResult)) {
      const { anomalyItems } = this.detectAnomalies(toolResult, userQuery);

      if (anomalyItems.length === 0) {
        summary.push(`No anomalies found among ${toolResult.length} items.`);
        summary.push('All items appear healthy/normal based on query context.');
      } else {
        summary.push(`Found ${anomalyItems.length} anomalies out of ${toolResult.length} total items:`);
        summary.push('');

        for (const item of anomalyItems.slice(0, 20)) {
          summary.push(JSON.stringify(item, null, 2));
          summary.push('---');
        }

        if (anomalyItems.length > 20) {
          summary.push(`... and ${anomalyItems.length - 20} more anomalies`);
        }
      }
    } else {
      summary.push('Result is not an array - cannot extract anomalies.');
      summary.push(JSON.stringify(toolResult, null, 2).substring(0, 2000));
    }

    const compressedResult = summary.join('\n');

    return {
      compressedResult,
      originalSize,
      compressedSize: compressedResult.length,
      compressionStrategy: 'extract',
      informationLoss: 'minimal',
      anomaliesPreserved: true,
      processingDurationMs: Date.now() - startTime
    };
  }

  /**
   * Extract statistical summary
   */
  private extractStatistics(
    toolResult: unknown,
    userQuery: string,
    originalSize: number,
    startTime: number
  ): ProcessedResponse {
    const summary: string[] = [];

    if (Array.isArray(toolResult)) {
      summary.push(`Total count: ${toolResult.length}`);

      // Group by common status fields
      const groupings = this.groupByFields(toolResult, ['status', 'health', 'state', 'type', 'kind']);
      for (const [field, groups] of Object.entries(groupings)) {
        if (Object.keys(groups).length > 0) {
          summary.push(`\nBy ${field}:`);
          for (const [value, count] of Object.entries(groups)) {
            summary.push(`  ${value}: ${count}`);
          }
        }
      }
    } else if (typeof toolResult === 'object' && toolResult !== null) {
      // Count nested arrays
      for (const [key, value] of Object.entries(toolResult as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          summary.push(`${key}: ${value.length} items`);
        }
      }
    }

    const compressedResult = summary.join('\n');

    return {
      compressedResult,
      originalSize,
      compressedSize: compressedResult.length,
      compressionStrategy: 'extract',
      informationLoss: 'minimal',
      anomaliesPreserved: false,
      processingDurationMs: Date.now() - startTime
    };
  }

  /**
   * Extract with hierarchical summary
   */
  private extractHierarchical(
    toolResult: unknown,
    userQuery: string,
    originalSize: number,
    contextBudget: number,
    startTime: number
  ): ProcessedResponse {
    const summary: string[] = [];
    const maxChars = contextBudget * CHARS_PER_TOKEN;

    if (Array.isArray(toolResult)) {
      summary.push(`Array of ${toolResult.length} items`);

      // Show first few items
      const showCount = Math.min(this.config.maxItemsBeforePagination, toolResult.length);
      summary.push(`\nFirst ${showCount} items:`);

      for (let i = 0; i < showCount; i++) {
        const itemStr = JSON.stringify(toolResult[i], null, 2);
        if (summary.join('\n').length + itemStr.length < maxChars - 500) {
          summary.push(itemStr);
          summary.push('---');
        } else {
          summary.push(`... and ${toolResult.length - i} more items (use "show more" to continue)`);
          break;
        }
      }
    } else if (typeof toolResult === 'object' && toolResult !== null) {
      const obj = toolResult as Record<string, unknown>;
      summary.push(`Object with ${Object.keys(obj).length} keys`);

      for (const [key, value] of Object.entries(obj)) {
        const valueStr = JSON.stringify(value, null, 2);
        if (summary.join('\n').length + valueStr.length < maxChars - 500) {
          summary.push(`\n${key}:`);
          summary.push(valueStr);
        } else {
          summary.push(`\n${key}: [too large - ${valueStr.length} chars]`);
        }
      }
    }

    const compressedResult = summary.join('\n');

    return {
      compressedResult,
      originalSize,
      compressedSize: compressedResult.length,
      compressionStrategy: 'extract',
      pagination: {
        total: Array.isArray(toolResult) ? toolResult.length : Object.keys(toolResult as object).length,
        shown: this.config.maxItemsBeforePagination,
        hasMore: true,
        nextCommand: 'show more'
      },
      informationLoss: 'moderate',
      anomaliesPreserved: false,
      processingDurationMs: Date.now() - startTime
    };
  }

  /**
   * Detect anomalies in an array based on user query context
   */
  private detectAnomalies(
    items: unknown[],
    userQuery: string
  ): { anomalyItems: unknown[]; normalItemsFiltered: unknown[] } {
    const anomalyItems: unknown[] = [];
    const normalItemsFiltered: unknown[] = [];

    const queryLower = userQuery.toLowerCase();
    const lookingForProblems = queryLower.includes('unhealthy') ||
                               queryLower.includes('error') ||
                               queryLower.includes('failed') ||
                               queryLower.includes('warning') ||
                               queryLower.includes('issue');

    for (const item of items) {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        let isAnomaly = false;

        // Check common anomaly indicators
        const statusFields = ['status', 'health', 'state', 'condition'];
        for (const field of statusFields) {
          const value = String(obj[field] || '').toLowerCase();
          if (value.includes('unhealthy') || value.includes('error') ||
              value.includes('failed') || value.includes('warning') ||
              value.includes('critical') || value.includes('down')) {
            isAnomaly = true;
            break;
          }
        }

        // Check for error fields
        if (obj.error || obj.errors || obj.warning || obj.warnings) {
          isAnomaly = true;
        }

        if (isAnomaly) {
          anomalyItems.push(item);
        } else {
          normalItemsFiltered.push(item);
        }
      } else {
        normalItemsFiltered.push(item);
      }
    }

    return { anomalyItems, normalItemsFiltered };
  }

  /**
   * Get anomaly count string for summary
   */
  private getAnomalyCount(items: unknown[], userQuery: string): string {
    const { anomalyItems } = this.detectAnomalies(items, userQuery);
    if (anomalyItems.length > 0) {
      return ` (${anomalyItems.length} anomalies)`;
    }
    return '';
  }

  /**
   * Find error/warning fields in object
   */
  private findErrorFields(obj: Record<string, unknown>): { key: string; value: unknown }[] {
    const errorFields: { key: string; value: unknown }[] = [];
    const errorKeywords = ['error', 'warning', 'fault', 'exception', 'failure'];

    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      if (errorKeywords.some(kw => keyLower.includes(kw))) {
        if (value && (
          (typeof value === 'string' && value.length > 0) ||
          (Array.isArray(value) && value.length > 0) ||
          (typeof value === 'object' && Object.keys(value).length > 0)
        )) {
          errorFields.push({ key, value });
        }
      }
    }

    return errorFields;
  }

  /**
   * Calculate statistics for an array
   */
  private calculateArrayStats(items: unknown[]): string | null {
    if (items.length === 0) return null;
    if (typeof items[0] !== 'object' || items[0] === null) return null;

    // Group by status-like fields
    const groups = this.groupByFields(items, ['status', 'health', 'state', 'type']);
    const parts: string[] = [];

    for (const [field, fieldGroups] of Object.entries(groups)) {
      const groupStrs = Object.entries(fieldGroups).map(([v, c]) => `${v}: ${c}`);
      if (groupStrs.length > 0 && groupStrs.length <= 5) {
        parts.push(`${field}={${groupStrs.join(', ')}}`);
      }
    }

    return parts.length > 0 ? parts.join('; ') : null;
  }

  /**
   * Group items by field values
   */
  private groupByFields(
    items: unknown[],
    fields: string[]
  ): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};

    for (const field of fields) {
      result[field] = {};
      for (const item of items) {
        if (typeof item === 'object' && item !== null) {
          const value = String((item as Record<string, unknown>)[field] || 'unknown');
          result[field][value] = (result[field][value] || 0) + 1;
        }
      }
      // Remove if only one group or too many groups
      if (Object.keys(result[field]).length <= 1 || Object.keys(result[field]).length > 10) {
        delete result[field];
      }
    }

    return result;
  }

  /**
   * Extract filter keywords from user query
   */
  private extractFilterKeywords(userQuery: string): string[] {
    // Remove common stop words and extract meaningful terms
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'what', 'which', 'who', 'whom',
      'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were',
      'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
      'did', 'doing', 'will', 'would', 'shall', 'should', 'can', 'could',
      'may', 'might', 'must', 'ought', 'i', 'you', 'he', 'she', 'it', 'we',
      'they', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
      'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'any', 'all',
      'show', 'list', 'get', 'find', 'tell', 'me', 'about'
    ]);

    return userQuery
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Filter array items by query keywords
   */
  private filterArrayByQuery(
    items: unknown[],
    keywords: string[],
    userQuery: string
  ): unknown[] {
    if (keywords.length === 0) return items;

    return items.filter(item => {
      const itemStr = JSON.stringify(item).toLowerCase();
      return keywords.some(kw => itemStr.includes(kw));
    });
  }

  /**
   * Try to parse a string as JSON
   */
  private tryParse(str: string): unknown {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  /**
   * Get a stored full result by ID
   */
  getFullResult(resultId: string): unknown | null {
    const stored = fullResultStore.get(resultId);
    return stored?.result || null;
  }

  /**
   * Clean up old stored results (older than 1 hour)
   */
  cleanupStaleResults(): number {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let cleaned = 0;

    for (const [id, data] of fullResultStore.entries()) {
      if (data.timestamp < oneHourAgo) {
        fullResultStore.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// Singleton instance
let instance: LargeResponseHandler | null = null;

export function getLargeResponseHandler(): LargeResponseHandler {
  if (!instance) {
    instance = new LargeResponseHandler();
  }
  return instance;
}

export default LargeResponseHandler;
