/**
 * Tool Execution Helper
 *
 * Handles execution of tool calls via MCP Proxy integration
 * Also handles System MCP tools (like create_diagram) that run locally
 */

import axios from 'axios';
import type { Logger } from 'pino';
import { prisma } from '../../../utils/prisma.js';
import { trackMCPCall, mcpResponseTime } from '../../../metrics/index.js';
import os from 'os';
import crypto from 'crypto';
// TODO: System MCPs moved to MCP Proxy (oap-diagram-mcp) - keeping import for future use
// import { isSystemMcpTool, processSystemMcpToolCall } from '../../../services/system-mcps/index.js';
import { getToolSuccessTrackingService, type ToolSuccessRecord } from '../../../services/ToolSuccessTrackingService.js';
import { mcpAccessControlService } from '../../../services/MCPAccessControlService.js';
import jwt from 'jsonwebtoken';
import { getRedisClient } from '../../../utils/redis-client.js';
import { getToolResultCacheService, initializeToolResultCache, type SemanticCacheHit } from '../../../services/ToolResultCacheService.js';
import { getFeedbackIntegrationService, type FeedbackResult } from '../../../services/FeedbackIntegrationService.js';
import { getSemanticLearningService } from '../../../services/SemanticLearningService.js';
import { isDataLayerTool, executeDataLayerTool, formatQueryResultForLLM, type QueryDataResponse } from '../../../services/DataQueryTool.js';
import { isMemoryTool, executeMemoryToolCall } from '../../../services/AgentMemoryService.js';
import { getDataLayerService } from '../../../services/DataLayerService.js';
import { queueToolResultForGrounding } from '../../../services/ToolResultGroundingService.js';
import { ToolResultValidationService } from '../../../services/ToolResultValidationService.js';
// Security: DLP scanning, HITL gate, credential scoping
import { getDLPScanner, type DLPScanContext } from '../../../services/DLPScannerService.js';
import { getToolApprovalGate } from '../../../services/ToolApprovalGate.js';
import { getCredentialScopeService } from '../../../services/CredentialScopeService.js';
import { executeParallelSettled, type ParallelTask } from '../../../utils/parallel-executor.js';
import { AzureOBOService } from '../../../services/AzureOBOService.js';

// Lazy singleton — OBO service is stateless after construction; reuse across calls
let _oboServiceForSynth: AzureOBOService | null = null;
function getOBOServiceForSynth(logger: Logger): AzureOBOService {
  if (!_oboServiceForSynth) _oboServiceForSynth = new AzureOBOService(logger);
  return _oboServiceForSynth;
}

// =================================================================
// 📊 TOOL EXECUTION RESULT - Extended interface with feedback metadata
// =================================================================
export interface ToolExecutionResultFeedback {
  finalScore: number;
  confidence: number;
  compressionStrategy: string;
  informationLoss: string;
  fullResultId?: string;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  result: any;                      // Original result for caching/auditing
  processedResult?: string;         // Compressed result for LLM context
  serverName: string;
  executedOn: string;
  executionTimeMs: number;
  requestSize?: number;
  responseSize?: number;
  feedback?: ToolExecutionResultFeedback;  // Quality/compression metadata
  semanticMatchId?: string;         // If result came from semantic cache
  isCrossUserHit?: boolean;         // If result was from another user's cache
}

// Invisible Agent: Code execution routing to openagentic-manager
import {
  isCodeTool,
  executeCodeToolCall,
  getOrCreateOpenagenticSession,
  type CodeExecutionContext
} from './code-execution.helper.js';

// Synth (Tool Synthesis): Dynamic tool synthesis
import {
  isSynthTool,
  executeSynthToolCall
} from './synth-execution.helper.js';

// Image Generation: generate_image tool for artifact agents
import {
  isImageGenTool,
  executeImageGenTool
} from './image-gen-tool.js';

// Flag to track if semantic cache initialization has been attempted
let semanticCacheInitialized = false;
let semanticCacheInitPromise: Promise<void> | null = null;

/**
 * Ensure the Milvus semantic cache is initialized (called once at startup)
 * This is critical - without calling initialize(), isReady() always returns false!
 */
async function ensureSemanticCacheInitialized(logger: Logger): Promise<void> {
  if (semanticCacheInitialized) return;
  if (semanticCacheInitPromise) return semanticCacheInitPromise;

  semanticCacheInitPromise = (async () => {
    try {
      const service = getToolResultCacheService(logger);
      await service.initialize();
      semanticCacheInitialized = true;
      logger.info('[SEMANTIC-CACHE] ✅ Milvus semantic cache initialized successfully');
    } catch (error) {
      logger.warn({ error }, '[SEMANTIC-CACHE] ⚠️ Failed to initialize Milvus semantic cache - using Redis only');
      semanticCacheInitialized = true; // Mark as attempted to avoid retry loops
    }
  })();

  return semanticCacheInitPromise;
}

// =================================================================
// 🚀 TOOL RESULT CACHING - Redis Layer
// =================================================================
// Cache tool results to avoid redundant MCP calls for the same data.
// GET operations are cacheable; mutations (POST/PUT/DELETE) are not.
// Cache key: mcp:tool:{toolName}:{userId}:{argsHash}
// TTL: 5-10 minutes for user-specific, 1 hour for tenant-wide static data

/**
 * Cacheable tool patterns - these are READ operations that return stable data
 * Pattern matching is case-insensitive
 */
const CACHEABLE_TOOL_PATTERNS = [
  // Azure - List operations (subscriptions, resource groups, resources)
  /azure.*list/i,
  /azure.*get/i,
  /azure_arm_execute.*method.*GET/i,  // ARM GET operations
  /azmcp.*list/i,
  /azmcp.*get/i,

  // AWS - List/Describe operations
  /aws.*list/i,
  /aws.*describe/i,
  /aws.*get/i,

  // General read patterns
  /list_subscriptions/i,
  /list_resource_groups/i,
  /list_resources/i,
  /get_subscription/i,
  /get_resource_group/i,
  /fetch/i,
  /search/i,
  /query/i,
];

/**
 * Non-cacheable tool patterns - mutations that change state
 */
const NON_CACHEABLE_PATTERNS = [
  /create/i,
  /delete/i,
  /update/i,
  /modify/i,
  /put/i,
  /post/i,
  /remove/i,
  /start/i,
  /stop/i,
  /restart/i,
  /deploy/i,
  /execute_command/i,  // Commands that run arbitrary code
];

/**
 * Determine if a tool call is cacheable based on tool name and arguments.
 * Respects TOOL_RESULT_CACHE env var (default: enabled).
 */
function isToolCacheable(toolName: string, toolArgs: any): boolean {
  // Allow disabling via env var (for debugging or compliance requirements)
  if (process.env.TOOL_RESULT_CACHE === 'false') return false;

  const normalizedName = toolName.toLowerCase();

  // First check non-cacheable patterns (mutations)
  for (const pattern of NON_CACHEABLE_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return false;
    }
  }

  // Special handling for azure_arm_execute - check HTTP method
  if (normalizedName.includes('arm_execute') || normalizedName.includes('arm-execute')) {
    const method = toolArgs?.method?.toUpperCase() || 'GET';
    // Only cache GET requests
    return method === 'GET';
  }

  // Check cacheable patterns
  for (const pattern of CACHEABLE_TOOL_PATTERNS) {
    if (pattern.test(normalizedName)) {
      return true;
    }
  }

  // Default: cache read-like operations
  return normalizedName.includes('list') ||
         normalizedName.includes('get') ||
         normalizedName.includes('fetch') ||
         normalizedName.includes('search') ||
         normalizedName.includes('query');
}

/**
 * Normalize tool arguments for consistent cache keying
 * - Sorts object keys alphabetically
 * - Normalizes string values (trim, lowercase for query-like fields)
 * - Removes undefined/null values
 */
function normalizeArgsForCache(toolArgs: any): any {
  if (!toolArgs || typeof toolArgs !== 'object') {
    return toolArgs;
  }

  // Fields that should be normalized (lowercased, trimmed)
  const queryLikeFields = ['query', 'search', 'q', 'keyword', 'term', 'text', 'question'];

  const normalized: Record<string, any> = {};
  const sortedKeys = Object.keys(toolArgs).sort();

  for (const key of sortedKeys) {
    const value = toolArgs[key];

    // Skip null/undefined values
    if (value === null || value === undefined) continue;

    // Normalize string values for query-like fields
    if (typeof value === 'string') {
      const lowerKey = key.toLowerCase();
      if (queryLikeFields.some(f => lowerKey.includes(f))) {
        // Normalize query strings: trim, lowercase, collapse whitespace
        normalized[key] = value.trim().toLowerCase().replace(/\s+/g, ' ');
      } else {
        normalized[key] = value.trim();
      }
    } else if (typeof value === 'object') {
      // Recursively normalize nested objects
      normalized[key] = normalizeArgsForCache(value);
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
}

/**
 * Generate a cache key hash from tool arguments
 * Uses SHA-256 for consistent, collision-resistant hashing
 * Arguments are normalized before hashing for better cache hits
 */
function generateArgsHash(toolArgs: any): string {
  const normalizedArgs = normalizeArgsForCache(toolArgs);
  const argsString = JSON.stringify(normalizedArgs || {});
  return crypto.createHash('sha256').update(argsString).digest('hex').substring(0, 16);
}

/**
 * Get cache TTL based on tool type (in seconds)
 * Static data (subscriptions, accounts) gets longer TTL
 * Dynamic data (costs, metrics) gets shorter TTL
 */
function getCacheTTL(toolName: string): number {
  const normalizedName = toolName.toLowerCase();

  // Static data - 1 hour TTL (subscriptions, accounts, resource groups)
  if (normalizedName.includes('subscription') ||
      normalizedName.includes('account') ||
      normalizedName.includes('resource_group') ||
      normalizedName.includes('resourcegroup')) {
    return 3600; // 1 hour
  }

  // Semi-static data - 30 min TTL (resource lists, configurations)
  if (normalizedName.includes('list') ||
      normalizedName.includes('config') ||
      normalizedName.includes('setting')) {
    return 1800; // 30 minutes
  }

  // Dynamic data - 5 min TTL (costs, metrics, status)
  if (normalizedName.includes('cost') ||
      normalizedName.includes('metric') ||
      normalizedName.includes('status') ||
      normalizedName.includes('health')) {
    return 300; // 5 minutes
  }

  // Default: 10 minutes
  return 600;
}

/**
 * Try to get cached tool result from Redis
 */
async function getCachedToolResult(
  toolName: string,
  userId: string,
  argsHash: string,
  logger: Logger
): Promise<any | null> {
  try {
    const redis = getRedisClient();
    const cacheKey = `mcp:tool:${toolName}:${userId}:${argsHash}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      logger.info({
        toolName,
        cacheKey,
        userId
      }, '[TOOL-CACHE] 🎯 Cache HIT - returning cached result');
      return cached;
    }

    return null;
  } catch (error) {
    logger.warn({
      error,
      toolName,
      userId
    }, '[TOOL-CACHE] Failed to get cached result (non-fatal)');
    return null;
  }
}

/**
 * Store tool result in Redis cache
 */
async function cacheToolResult(
  toolName: string,
  userId: string,
  argsHash: string,
  result: any,
  ttlSeconds: number,
  logger: Logger
): Promise<void> {
  try {
    const redis = getRedisClient();
    const cacheKey = `mcp:tool:${toolName}:${userId}:${argsHash}`;
    await redis.set(cacheKey, result, ttlSeconds);

    logger.info({
      toolName,
      cacheKey,
      ttlSeconds,
      resultSize: JSON.stringify(result).length
    }, '[TOOL-CACHE] 💾 Cached tool result');
  } catch (error) {
    logger.warn({
      error,
      toolName,
      userId
    }, '[TOOL-CACHE] Failed to cache result (non-fatal)');
  }
}

// =================================================================
// 📋 RECENT TOOL RESULTS - Session-level tool history for prompt injection
// =================================================================
// Store recent tool results per session so the LLM knows what data
// has already been fetched and can avoid redundant tool calls.

interface RecentToolResult {
  toolName: string;
  args: any;
  resultSummary: string;
  timestamp: number;
}

const RECENT_TOOLS_TTL = 600; // 10 minutes - short window for "recent" results
const MAX_RECENT_TOOLS = 10; // Keep last 10 tool results per session

/**
 * Store a recent tool result for prompt injection
 * This helps the LLM know what data has already been fetched
 */
export async function storeRecentToolResult(
  sessionId: string,
  toolName: string,
  args: any,
  result: any,
  logger: Logger
): Promise<void> {
  try {
    const redis = getRedisClient();
    const cacheKey = `session:tools:${sessionId}`;

    // Summarize result (keep it short for prompt)
    const resultStr = JSON.stringify(result);
    const resultSummary = resultStr.length > 500
      ? resultStr.substring(0, 500) + '...'
      : resultStr;

    const toolEntry: RecentToolResult = {
      toolName,
      args,
      resultSummary,
      timestamp: Date.now()
    };

    // Get existing results
    const existing = await redis.get(cacheKey);
    let recentTools: RecentToolResult[] = [];

    if (existing) {
      try {
        recentTools = JSON.parse(existing as string);
      } catch {
        recentTools = [];
      }
    }

    // Add new result and keep only the last N
    recentTools.push(toolEntry);
    if (recentTools.length > MAX_RECENT_TOOLS) {
      recentTools = recentTools.slice(-MAX_RECENT_TOOLS);
    }

    await redis.set(cacheKey, JSON.stringify(recentTools), RECENT_TOOLS_TTL);

    logger.debug({
      sessionId,
      toolName,
      recentToolCount: recentTools.length
    }, '[RECENT-TOOLS] Stored recent tool result for session');
  } catch (error) {
    logger.warn({ error, sessionId, toolName }, '[RECENT-TOOLS] Failed to store recent tool result');
  }
}

/**
 * Get recent tool results for a session (for prompt injection)
 */
export async function getRecentToolResults(
  sessionId: string,
  logger: Logger
): Promise<RecentToolResult[]> {
  try {
    const redis = getRedisClient();
    const cacheKey = `session:tools:${sessionId}`;
    const cached = await redis.get(cacheKey);

    if (!cached) return [];

    const recentTools: RecentToolResult[] = JSON.parse(cached as string);

    // Filter out old results (older than TTL)
    const cutoff = Date.now() - (RECENT_TOOLS_TTL * 1000);
    const activeTools = recentTools.filter(t => t.timestamp > cutoff);

    logger.debug({
      sessionId,
      totalTools: recentTools.length,
      activeTools: activeTools.length
    }, '[RECENT-TOOLS] Retrieved recent tool results for session');

    return activeTools;
  } catch (error) {
    logger.warn({ error, sessionId }, '[RECENT-TOOLS] Failed to get recent tool results');
    return [];
  }
}

/**
 * Format recent tool results for system prompt injection
 * Returns a string that can be appended to the system prompt
 */
export function formatRecentToolsForPrompt(recentTools: RecentToolResult[]): string | null {
  if (!recentTools || recentTools.length === 0) return null;

  const lines = ['## Recent Data (Already Fetched - Avoid Redundant Calls)\n'];
  lines.push('The following data was recently fetched. Use this cached data when possible instead of making new tool calls:\n');

  for (const tool of recentTools) {
    const ageSeconds = Math.floor((Date.now() - tool.timestamp) / 1000);
    const ageMinutes = Math.floor(ageSeconds / 60);
    const ageStr = ageMinutes > 0 ? `${ageMinutes}m ago` : `${ageSeconds}s ago`;

    // Summarize args
    const argsStr = JSON.stringify(tool.args);
    const shortArgs = argsStr.length > 100 ? argsStr.substring(0, 100) + '...' : argsStr;

    lines.push(`- **${tool.toolName}** (${ageStr}): args=${shortArgs}`);
    lines.push(`  Result: ${tool.resultSummary.substring(0, 200)}${tool.resultSummary.length > 200 ? '...' : ''}`);
    lines.push('');
  }

  lines.push('If the user asks for similar information, reference this data instead of calling tools again.\n');

  return lines.join('\n');
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: any;
  error?: string;
  serverName?: string;  // MCP server that executed the tool (admin, fetch, azure_mcp, etc.)
  executedOn?: string;  // MCP Proxy pod/container hostname for K8s traceability
  executionTimeMs?: number;  // Tool execution time in milliseconds
  requestSize?: number;      // Size of request in bytes
  responseSize?: number;     // Size of response in bytes
}

/**
 * Comprehensive MCP audit logging
 */
interface MCPAuditLog {
  userId: string;
  userName?: string;
  userEmail?: string;
  sessionId?: string;
  messageId?: string;
  toolCallId: string;
  toolName: string;
  resolvedToolName: string;
  mcpServer: string;
  mcpProxyHost: string;
  requestPayload: any;
  responsePayload: any;
  executionTimeMs: number;
  requestSizeBytes: number;
  responseSizeBytes: number;
  success: boolean;
  errorMessage?: string;
  userToken?: boolean;
  ipAddress?: string;
  userAgent?: string;
  modelUsed?: string;        // LLM model that triggered the tool call
  modelProvider?: string;    // Provider (vertex-ai, ollama, etc.)
}

/**
 * Log detailed MCP call information to multiple audit tables
 */
async function logMCPCall(auditData: MCPAuditLog, logger: Logger): Promise<void> {
  try {
    const timestamp = new Date();

    // 1. Log to MCPUsage table for usage tracking
    // CRITICAL: Store BOTH request AND response data for full audit trail
    await prisma.mCPUsage.create({
      data: {
        user_id: auditData.userId,
        user_name: auditData.userName,
        user_email: auditData.userEmail,
        server_name: auditData.mcpServer,
        tool_name: auditData.resolvedToolName,
        method: 'tools/call',
        execution_time_ms: auditData.executionTimeMs,
        request_size: auditData.requestSizeBytes,
        response_size: auditData.responseSizeBytes,
        success: auditData.success,
        error_message: auditData.errorMessage,
        request_metadata: {
          toolCallId: auditData.toolCallId,
          originalToolName: auditData.toolName,
          mcpServer: auditData.mcpServer,
          mcpProxyHost: auditData.mcpProxyHost,
          requestPayload: auditData.requestPayload,
          hasUserToken: auditData.userToken,
          sessionId: auditData.sessionId,
          messageId: auditData.messageId,
          ipAddress: auditData.ipAddress,
          userAgent: auditData.userAgent,
          apiHost: os.hostname(),
          modelUsed: auditData.modelUsed,
          modelProvider: auditData.modelProvider,
          timestamp: timestamp.toISOString()
        },
        // Store the full response data for audit trail
        response_data: auditData.responsePayload ? {
          result: auditData.responsePayload,
          mcpProxyHost: auditData.mcpProxyHost,
          executionTimeMs: auditData.executionTimeMs
        } : null,
        timestamp
      }
    });

    // 2. Log to UserQueryAudit table for admin query tracking
    if (auditData.sessionId || auditData.messageId) {
      await prisma.userQueryAudit.create({
        data: {
          user_id: auditData.userId,
          session_id: auditData.sessionId || '',
          message_id: auditData.messageId || auditData.toolCallId,
          query_type: 'MCP_TOOL_CALL',
          raw_query: `${auditData.toolName}(${JSON.stringify(auditData.requestPayload)})`,
          intent: `Execute ${auditData.toolName} via ${auditData.mcpServer} MCP server`,
          mcp_server: auditData.mcpServer,
          tools_called: [
            {
              name: auditData.resolvedToolName,
              arguments: auditData.requestPayload,
              result: auditData.success ? auditData.responsePayload : null,
              error: auditData.errorMessage,
              executionTimeMs: auditData.executionTimeMs,
              server: auditData.mcpServer
            }
          ],
          success: auditData.success,
          error_message: auditData.errorMessage,
          error_code: auditData.success ? null : 'MCP_TOOL_EXECUTION_FAILED',
          ip_address: auditData.ipAddress,
          user_agent: auditData.userAgent,
          created_at: timestamp
        }
      });
    }

    logger.info({
      userId: auditData.userId,
      toolName: auditData.resolvedToolName,
      mcpServer: auditData.mcpServer,
      executionTimeMs: auditData.executionTimeMs,
      success: auditData.success
    }, '[MCP-AUDIT] MCP call logged to audit tables');

  } catch (auditError) {
    // Don't fail the main operation if audit logging fails
    logger.error({
      error: auditError,
      auditData: {
        ...auditData,
        requestPayload: '[TRUNCATED]',
        responsePayload: '[TRUNCATED]'
      }
    }, '[MCP-AUDIT] Failed to log MCP call audit data');
  }
}

/**
 * Resolve tool name by matching against available tools
 *
 * LLMs often invent simplified names (e.g., "list_subscriptions")
 * instead of using actual MCP tool names (e.g., "azure_mcp-azmcp_subscription_list")
 *
 * This function performs fuzzy matching to find the correct tool name.
 */
function resolveToolName(
  llmToolName: string,
  availableTools: any[] | undefined,
  logger: Logger
): string {
  // No tools available - return original name
  if (!availableTools || availableTools.length === 0) {
    logger.warn({
      llmToolName,
      reason: 'no_available_tools'
    }, '[TOOL-EXEC] ⚠️ Cannot resolve tool name - no available tools provided');
    return llmToolName;
  }

  // Extract all tool names from available tools
  const toolNames = availableTools
    .map(t => t?.function?.name)
    .filter(Boolean) as string[];

  // Exact match (case-sensitive)
  if (toolNames.includes(llmToolName)) {
    return llmToolName;
  }

  logger.info({
    llmToolName,
    availableToolCount: toolNames.length,
    sampleTools: toolNames.slice(0, 5)
  }, '[TOOL-EXEC] 🔍 Tool name not found, attempting fuzzy match...');

  // Fuzzy matching strategies
  const normalizedLlmName = normalizeName(llmToolName);
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const toolName of toolNames) {
    const normalizedToolName = normalizeName(toolName);

    // Strategy 1: Exact match after normalization
    if (normalizedLlmName === normalizedToolName) {
      logger.info({
        llmToolName,
        matchedTool: toolName,
        strategy: 'normalized_exact'
      }, '[TOOL-EXEC] ✅ Found exact match after normalization');
      return toolName;
    }

    // Strategy 2: LLM name is contained in tool name (e.g., "list_subscriptions" in "azure_mcp-azmcp_subscription_list")
    if (normalizedToolName.includes(normalizedLlmName)) {
      const score = normalizedLlmName.length / normalizedToolName.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = toolName;
      }
    }

    // Strategy 3: Tool name is contained in LLM name (less common)
    if (normalizedLlmName.includes(normalizedToolName)) {
      const score = normalizedToolName.length / normalizedLlmName.length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = toolName;
      }
    }

    // Strategy 4: Calculate similarity score based on common words
    const similarityScore = calculateSimilarity(normalizedLlmName, normalizedToolName);
    if (similarityScore > bestScore && similarityScore > 0.5) {
      bestScore = similarityScore;
      bestMatch = toolName;
    }
  }

  if (bestMatch && bestScore > 0.3) {
    logger.info({
      llmToolName,
      matchedTool: bestMatch,
      score: bestScore,
      strategy: 'fuzzy_match'
    }, '[TOOL-EXEC] ✅ Found fuzzy match');
    return bestMatch;
  }

  // No match found - log warning and return original
  logger.warn({
    llmToolName,
    availableTools: toolNames.slice(0, 10),
    totalAvailable: toolNames.length
  }, '[TOOL-EXEC] ❌ No matching tool found - LLM invented tool name not in cache');

  return llmToolName;
}

/**
 * Normalize tool name for comparison
 * - Convert to lowercase
 * - Replace dashes with underscores
 * - Remove special characters
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Calculate tool success score based on execution results
 */
function calculateToolSuccessScore(
  executionError: boolean,
  executionTimeMs: number,
  resultLength: number
): number {
  // Execution error = complete failure
  if (executionError) return 0.0;

  let score = 1.0;

  // Execution time penalty (>5s = slower, >30s = significantly slower)
  if (executionTimeMs > 30000) score *= 0.5;
  else if (executionTimeMs > 10000) score *= 0.7;
  else if (executionTimeMs > 5000) score *= 0.9;

  // Result quality: penalize empty/minimal results
  if (resultLength < 10) score *= 0.4;
  else if (resultLength < 50) score *= 0.7;

  return Math.max(0, Math.min(1, score));
}

/**
 * Categorize error for structured logging and analysis
 * Enables pattern recognition across failures for strategy refinement
 */
function categorizeError(statusCode: number, errorMessage: string): string {
  // HTTP status-based categories
  if (statusCode === 401 || statusCode === 403) return 'AUTH_ERROR';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 429) return 'RATE_LIMIT';
  if (statusCode >= 500 && statusCode < 600) return 'SERVER_ERROR';
  if (statusCode >= 400 && statusCode < 500) return 'CLIENT_ERROR';

  // Message-based categories
  const lowerMessage = errorMessage.toLowerCase();
  if (lowerMessage.includes('timeout')) return 'TIMEOUT';
  if (lowerMessage.includes('connection')) return 'CONNECTION_ERROR';
  if (lowerMessage.includes('permission') || lowerMessage.includes('access')) return 'PERMISSION_ERROR';
  if (lowerMessage.includes('not found')) return 'NOT_FOUND';
  if (lowerMessage.includes('invalid') || lowerMessage.includes('validation')) return 'VALIDATION_ERROR';
  if (lowerMessage.includes('quota') || lowerMessage.includes('limit')) return 'QUOTA_EXCEEDED';

  return 'UNKNOWN_ERROR';
}

/**
 * Record successful tool execution to Milvus for semantic learning
 */
async function recordToolSuccess(
  userId: string,
  sessionId: string | undefined,
  query: string,
  toolName: string,
  serverName: string,
  executionTimeMs: number,
  result: any,
  logger: Logger
): Promise<void> {
  try {
    const tracker = getToolSuccessTrackingService();

    // Calculate result length for scoring
    const resultStr = result ? JSON.stringify(result) : '';
    const resultLength = resultStr.length;

    // Calculate success score
    const successScore = calculateToolSuccessScore(false, executionTimeMs, resultLength);

    // Extract intent tags from query
    const intentTags = tracker.extractIntentTags(query);

    // Build context tags from session/tool metadata
    const contextTags: string[] = [];
    if (serverName) contextTags.push(`server:${serverName}`);

    const record: ToolSuccessRecord = {
      userId,
      sessionId,
      query,
      toolName,
      serverName: serverName || 'unknown',
      intentTags,
      contextTags,
      successScore,
      executionTimeMs,
      resultSummary: resultStr.substring(0, 512),
      createdAt: new Date()
    };

    await tracker.recordSuccess(record);

    logger.debug({
      toolName,
      serverName,
      successScore,
      intentTags,
      executionTimeMs
    }, '[TOOL-SUCCESS] Recorded successful tool execution to Milvus');

  } catch (error) {
    // Don't fail the main operation if tracking fails
    logger.warn({
      error,
      toolName,
      serverName
    }, '[TOOL-SUCCESS] Failed to record tool success (non-fatal)');
  }
}

/**
 * Calculate similarity between two strings based on word overlap
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.split('_').filter(Boolean);
  const words2 = str2.split('_').filter(Boolean);

  if (words1.length === 0 || words2.length === 0) return 0;

  // Count matching words
  let matches = 0;
  for (const word1 of words1) {
    if (words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
      matches++;
    }
  }

  // Return ratio of matches to total unique words
  return matches / Math.max(words1.length, words2.length);
}

// =================================================================
// 🔄 PRE-PROCESSED TOOL CALL - Shared state after name resolution + arg parsing
// =================================================================
interface PreProcessedToolCall {
  originalIndex: number;          // Position in original toolCalls array (for ordering)
  toolCall: ToolCall;             // Original tool call
  resolvedToolName: string;       // Name after fuzzy resolution
  mcpToolName: string;            // Original MCP name (may differ from resolved)
  targetServer: string | undefined;
  toolArgs: any;                  // Parsed arguments
  isLocal: boolean;               // true = sequential local tool, false = MCP proxy
  localType?: 'data-layer' | 'memory' | 'synth' | 'code' | 'image-gen';  // Which local handler
  isHallucinated?: boolean;       // true = tool name not in availableTools (LLM invented it)
  hallucinationHint?: string;     // Suggested correct path (e.g., "use delegate_to_agents")
}

/**
 * Pre-process a tool call: resolve name, parse args, determine routing.
 * This is extracted from the main loop so categorization can happen before execution.
 */
function preProcessToolCall(
  toolCall: ToolCall,
  originalIndex: number,
  availableTools: any[] | undefined,
  userId: string | undefined,
  logger: Logger
): PreProcessedToolCall {
  // Resolve tool name (LLM may invent simplified names)
  const resolvedToolName = resolveToolName(
    toolCall.function.name,
    availableTools,
    logger
  );

  if (resolvedToolName !== toolCall.function.name) {
    logger.info({
      toolCallId: toolCall.id,
      llmToolName: toolCall.function.name,
      resolvedToolName
    }, '[TOOL-EXEC] Tool name resolved via fuzzy matching');
  }

  // Extract server from tool metadata
  let targetServer: string | undefined = undefined;
  let mcpToolName = resolvedToolName;

  if (availableTools && availableTools.length > 0) {
    const matchedTool = availableTools.find(t =>
      t?.function?.name === resolvedToolName
    );

    if (matchedTool && (matchedTool as any).serverId) {
      targetServer = (matchedTool as any).serverId;

      if ((matchedTool as any).originalToolName) {
        mcpToolName = (matchedTool as any).originalToolName;
        logger.info({
          sanitizedName: resolvedToolName,
          originalName: mcpToolName,
          targetServer
        }, '[TOOL-EXEC] Using original tool name for MCP proxy');
      }

      logger.info({
        toolName: resolvedToolName,
        mcpToolName,
        extractedServer: targetServer
      }, '[TOOL-EXEC] Extracted server from tool metadata');
    } else {
      logger.warn({
        toolName: resolvedToolName,
        hasMatchedTool: !!matchedTool,
        serverId: matchedTool ? (matchedTool as any).serverId : undefined
      }, '[TOOL-EXEC] Could not extract server from tool metadata - MCP proxy will auto-detect');
    }
  }

  // Parse tool arguments
  let toolArgs: any = {};
  try {
    toolArgs = toolCall.function.arguments
      ? JSON.parse(toolCall.function.arguments)
      : {};
  } catch (error) {
    logger.warn({
      toolCallId: toolCall.id,
      toolName: resolvedToolName,
      arguments: toolCall.function.arguments
    }, '[TOOL-EXEC] Failed to parse tool arguments, using empty object');
  }

  // Openagentic user context injection
  const isOpenagenticServer = targetServer &&
    targetServer.toLowerCase().includes('openagentic');

  if (isOpenagenticServer && userId) {
    const originalUserId = toolArgs.user_id;
    toolArgs.user_id = userId;

    logger.info({
      toolCallId: toolCall.id,
      toolName: resolvedToolName,
      targetServer,
      originalUserId,
      injectedUserId: userId
    }, '[TOOL-EXEC] OPENAGENTIC: Injected chat user ID into tool arguments');
  }

  // Determine routing: local or MCP proxy
  let isLocal = false;
  let localType: PreProcessedToolCall['localType'] = undefined;

  if (isDataLayerTool(resolvedToolName)) {
    isLocal = true;
    localType = 'data-layer';
  } else if (isMemoryTool(resolvedToolName)) {
    isLocal = true;
    localType = 'memory';
  } else if (isSynthTool(resolvedToolName)) {
    isLocal = true;
    localType = 'synth';
  } else if (isCodeTool(resolvedToolName)) {
    isLocal = true;
    localType = 'code';
  } else if (isImageGenTool(resolvedToolName)) {
    isLocal = true;
    localType = 'image-gen';
  }

  // Hallucination guard: if availableTools was provided AND the resolved name
  // is not in it AND it's not a known local tool type, the LLM invented a tool
  // that doesn't exist in this turn's whitelist. Mark it so the executor can
  // short-circuit with a corrective error message instead of dragging the
  // hallucinated call through HITL approval and a doomed MCP call.
  let isHallucinated = false;
  let hallucinationHint: string | undefined;
  if (availableTools && availableTools.length > 0 && !isLocal) {
    const inAvailable = availableTools.some(
      t => t?.function?.name === resolvedToolName
    );
    if (!inAvailable) {
      isHallucinated = true;
      const availableNames = availableTools
        .map(t => t?.function?.name)
        .filter(Boolean);
      const hasDelegate = availableNames.includes('delegate_to_agents');
      hallucinationHint = hasDelegate
        ? `Tool "${toolCall.function.name}" is not available in this turn. Cloud / infra tool calls are intentionally not exposed inline — call delegate_to_agents with role="cloud_operations" to perform this work in a sub-agent that has the typed cloud tools.`
        : `Tool "${toolCall.function.name}" is not available in this turn. Available tools: ${availableNames.slice(0, 20).join(', ')}.`;
      logger.warn({
        toolCallId: toolCall.id,
        invented: toolCall.function.name,
        resolved: resolvedToolName,
        availableCount: availableNames.length,
        hasDelegateOption: hasDelegate
      }, '[TOOL-EXEC] 🚫 Hallucinated tool call — short-circuit before HITL');
    }
  }

  return {
    originalIndex,
    toolCall,
    resolvedToolName,
    mcpToolName,
    targetServer,
    toolArgs,
    isLocal,
    localType,
    isHallucinated,
    hallucinationHint
  };
}

/**
 * Execute tool calls via MCP Proxy
 *
 * Local tools (code, memory, synth, data layer) execute sequentially to
 * preserve state dependencies. MCP proxy tools execute in parallel with
 * a concurrency limit of 5 for maximum throughput.
 *
 * @param toolCalls - Array of tool calls from LLM response
 * @param logger - Pino logger instance
 * @param availableTools - Array of available tools for name resolution
 * @param userToken - Optional user token for OBO auth (Azure access token for ARM, API key for service auth)
 * @param idToken - Optional Azure AD ID token for AWS Identity Center OBO (has app client ID as audience)
 * @param userId - User ID for audit logging
 * @param sessionId - Session ID for audit tracking
 * @param messageId - Message ID for audit tracking
 * @param ipAddress - User IP address for audit logging
 * @param userAgent - User agent for audit logging
 * @param emitEvent - Optional event emitter function to keep SSE stream alive during tool execution
 * @param originalQuery - The original user query that triggered the tool calls (for success tracking)
 * @param userGroups - User's Azure AD groups for access control
 * @param isAdmin - Whether user is admin for access control
 * @param modelUsed - LLM model that triggered the tool calls (for audit logging)
 * @param modelProvider - LLM provider (for audit logging)
 * @param userName - User's display name (for audit logging)
 * @param userEmail - User's email (for audit logging)
 * @param codeExecutionContext - Optional context for persisting openagentic sessions across tool calls
 * @returns Object with tool results and updated code execution context
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  logger: Logger,
  availableTools?: any[],
  userToken?: string,
  idToken?: string,
  userId?: string,
  sessionId?: string,
  messageId?: string,
  ipAddress?: string,
  userAgent?: string,
  emitEvent?: (event: string, data: any) => void,
  originalQuery?: string,
  userGroups?: string[],
  isAdmin?: boolean,
  modelUsed?: string,
  modelProvider?: string,
  userName?: string,
  userEmail?: string,
  codeExecutionContext?: CodeExecutionContext,
  authMethod?: string  // 'api-key' | 'azure-ad' | 'local' — from middleware, controls MCP proxy auth strategy
): Promise<{ results: ToolResult[]; codeExecutionContext?: CodeExecutionContext }> {
  const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

  // Track effective user ID for caching and session management
  const effectiveUserId = userId || 'anonymous';

  // Mutable context for openagentic sessions - will be updated if new session is created
  let updatedCodeExecutionContext: CodeExecutionContext | undefined = codeExecutionContext;

  // Detect if any tools require AWS OBO
  const hasAwsTools = toolCalls.some(tc =>
    tc.function.name.toLowerCase().includes('aws') ||
    tc.function.name.toLowerCase().includes('call_aws')
  );

  logger.info({
    toolCallCount: toolCalls.length,
    toolNames: toolCalls.map(tc => tc.function.name),
    hasUserToken: !!userToken,
    hasIdToken: !!idToken,
    hasAwsTools,
    // Log token info for OBO debugging (without exposing actual tokens)
    idTokenLength: idToken ? idToken.length : 0,
    userTokenLength: userToken ? userToken.length : 0
  }, '[TOOL-EXEC] Executing tool calls via MCP Proxy');

  // Warn if AWS tools are called without ID token (OBO will fail)
  if (hasAwsTools && !idToken) {
    logger.warn({
      toolNames: toolCalls.filter(tc =>
        tc.function.name.toLowerCase().includes('aws')
      ).map(tc => tc.function.name),
      hasUserToken: !!userToken
    }, '[TOOL-EXEC] ⚠️ AWS tools requested but no ID token available - AWS OBO authentication will fail');
  }

  // =================================================================
  // 🔀 PARALLEL EXECUTION: Pre-process and categorize tool calls
  // =================================================================
  // Phase 1: Pre-process all tool calls (resolve names, parse args, determine routing)
  // Phase 2: Execute local tools sequentially (code, memory, synth, data layer)
  // Phase 3: Execute MCP proxy tools in parallel (concurrency limit: 5)
  // Phase 4: Merge results in original tool call order
  const preprocessed = toolCalls.map((tc, idx) =>
    preProcessToolCall(tc, idx, availableTools, userId, logger)
  );

  // Split off hallucinated tool calls so they never reach HITL or MCP.
  // The LLM gets a corrective error pointing it at the right path
  // (typically `delegate_to_agents` for cloudOps-stripped turns).
  const hallucinatedTools = preprocessed.filter(p => p.isHallucinated);
  const realTools = preprocessed.filter(p => !p.isHallucinated);
  const localTools = realTools.filter(p => p.isLocal);
  const mcpTools = realTools.filter(p => !p.isLocal);

  logger.info({
    total: toolCalls.length,
    hallucinatedCount: hallucinatedTools.length,
    localCount: localTools.length,
    mcpProxyCount: mcpTools.length,
    localTypes: localTools.map(t => t.localType),
    mcpToolNames: mcpTools.map(t => t.resolvedToolName),
    hallucinatedNames: hallucinatedTools.map(t => t.toolCall.function.name)
  }, '[TOOL-EXEC] 🔀 Tool calls categorized for parallel execution');

  // Results map: originalIndex -> ToolResult (preserves ordering)
  const resultsMap = new Map<number, ToolResult>();

  // Synthesize corrective error results for hallucinated tools so the LLM
  // sees them as failed-with-instruction in its next turn and self-corrects.
  for (const pp of hallucinatedTools) {
    resultsMap.set(pp.originalIndex, {
      toolCallId: pp.toolCall.id,
      toolName: pp.toolCall.function.name,
      result: null,
      error: pp.hallucinationHint || `Tool "${pp.toolCall.function.name}" is not available in this turn.`,
      serverName: undefined,
      executedOn: os.hostname(),
      executionTimeMs: 0
    });
  }

  // =================================================================
  // Phase 2: Execute LOCAL tools sequentially
  // =================================================================
  // Code tools MUST be sequential (shared openagentic session state).
  // Memory/synth/data-layer tools are also sequential for simplicity.
  for (const pp of localTools) {
    const { toolCall, resolvedToolName, targetServer, toolArgs, localType } = pp;

    try {
      // =================================================================
      // 🛡️ ACCESS CONTROL CHECK - Enforce runtime MCP access policies
      // =================================================================
      // Check if user has access to execute tools from this MCP server
      if (userId && targetServer && userGroups && isAdmin !== undefined) {
        const accessResult = await mcpAccessControlService.checkToolExecution(
          userId,
          userGroups,
          isAdmin,
          resolvedToolName,
          targetServer,
          logger
        );

        if (!accessResult.allowed) {
          logger.error({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            serverId: targetServer,
            userId,
            reason: accessResult.reason
          }, '[TOOL-EXEC] ❌ ACCESS DENIED - User does not have permission to execute this tool');

          // Return access denied error
          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: null,
            error: `Access denied: ${accessResult.reason}`,
            serverName: targetServer,
            executedOn: os.hostname(),
            executionTimeMs: 0
          });

          // Log failed access attempt to audit
          if (userId) {
            await logMCPCall({
              userId,
              userName,
              userEmail,
              sessionId,
              messageId,
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              resolvedToolName,
              mcpServer: targetServer,
              mcpProxyHost: os.hostname(),
              requestPayload: toolArgs,
              responsePayload: null,
              executionTimeMs: 0,
              requestSizeBytes: 0,
              responseSizeBytes: 0,
              success: false,
              errorMessage: `Access denied: ${accessResult.reason}`,
              userToken: !!userToken,
              ipAddress,
              userAgent,
              modelUsed,
              modelProvider
            }, logger);
          }

          // Skip to next tool - access denied
          continue;
        }

        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          serverId: targetServer,
          userId,
          reason: accessResult.reason
        }, '[TOOL-EXEC] ✅ ACCESS GRANTED - User has permission to execute this tool');
      }

      // =================================================================
      // 📊 DATA LAYER TOOLS: "Fetch Once, Query Many" Pattern
      // =================================================================
      // Handle query_data and list_datasets tools locally instead of routing to MCP proxy.
      // These tools allow LLMs to query previously stored large datasets efficiently.
      if (isDataLayerTool(resolvedToolName)) {
        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          arguments: toolArgs,
          sessionId,
          userId
        }, '[TOOL-EXEC] 📊 Routing data layer tool to DataLayerService');

        const startTime = Date.now();

        try {
          const dataLayerResult = await executeDataLayerTool(
            resolvedToolName,
            toolArgs,
            sessionId || 'standalone',
            effectiveUserId
          );

          const executionTimeMs = Date.now() - startTime;

          // Format the result for LLM context if it's a query result
          let formattedResult = dataLayerResult;
          if (resolvedToolName === 'query_data') {
            formattedResult = formatQueryResultForLLM(dataLayerResult as QueryDataResponse);
          }

          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            executionTimeMs,
            success: (dataLayerResult as any).success !== false,
            itemCount: (dataLayerResult as any).itemCount || (dataLayerResult as any).datasets?.length || 0
          }, '[TOOL-EXEC] 📊 Data layer tool executed successfully');

          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: formattedResult,
            serverName: 'data-layer-service',
            executedOn: os.hostname(),
            executionTimeMs
          });

          // Emit tool execution event for streaming
          if (emitEvent) {
            emitEvent('tool_execution', {
              toolCallId: toolCall.id,
              toolName: resolvedToolName,
              status: 'completed',
              serverName: 'data-layer-service',
              executionTimeMs
            });
          }

          // Skip to next tool - data layer handled locally
          continue;

        } catch (error: any) {
          const executionTimeMs = Date.now() - startTime;

          logger.error({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            error: error.message,
            executionTimeMs
          }, '[TOOL-EXEC] ❌ Data layer tool execution failed');

          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: { error: error.message || 'Data layer tool execution failed' },
            serverName: 'data-layer-service',
            executedOn: os.hostname(),
            executionTimeMs
          });

          // Emit error event
          if (emitEvent) {
            emitEvent('tool_execution', {
              toolCallId: toolCall.id,
              toolName: resolvedToolName,
              status: 'failed',
              error: error.message
            });
          }

          continue;
        }
      }

      // =================================================================
      // AGENT MEMORY TOOLS: memory_store, memory_recall, memory_forget
      // =================================================================
      if (isMemoryTool(resolvedToolName)) {
        const startTime = Date.now();
        try {
          const memResult = await executeMemoryToolCall(resolvedToolName, toolArgs, effectiveUserId);
          const executionTimeMs = Date.now() - startTime;

          logger.info({
            toolCallId: toolCall.id, toolName: resolvedToolName, executionTimeMs
          }, '[TOOL-EXEC] 🧠 Memory tool executed');

          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: memResult,
            serverName: 'system-memory',
            executedOn: os.hostname(),
            executionTimeMs
          });

          if (emitEvent) {
            emitEvent('tool_execution', {
              toolCallId: toolCall.id, toolName: resolvedToolName,
              status: 'completed', serverName: 'system-memory', executionTimeMs
            });
          }
          continue;
        } catch (error: any) {
          const executionTimeMs = Date.now() - startTime;
          logger.error({ toolCallId: toolCall.id, error: error.message }, '[TOOL-EXEC] ❌ Memory tool failed');
          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id, toolName: resolvedToolName,
            result: JSON.stringify({ error: error.message }),
            serverName: 'system-memory', executedOn: os.hostname(), executionTimeMs
          });
          if (emitEvent) {
            emitEvent('tool_execution', {
              toolCallId: toolCall.id, toolName: resolvedToolName, status: 'failed', error: error.message
            });
          }
          continue;
        }
      }

      // =================================================================
      // SYNTH (TOOL SYNTHESIS): Dynamic Tool Synthesis
      // =================================================================
      // Route Synth tool calls to the SynthService for dynamic tool synthesis.
      // Synth allows the LLM to synthesize one-shot tools for tasks outside
      // built-in capabilities. Runs AS THE AUTHENTICATED USER (no service accounts).
      if (isSynthTool(resolvedToolName)) {
        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          intent: toolArgs.intent?.substring(0, 100),
          userId,
          userEmail
        }, '[TOOL-EXEC] Routing Synth tool to SynthService');

        try {
          // Get user's SSO provider from their auth context
          const ssoProvider = (codeExecutionContext as any)?.ssoProvider || 'local';

          // OBO credential injection — exchange the user's Azure AD token for an
          // ARM-scoped access token so synthesized Python in the sandbox can call
          // Azure SDKs as the user. Mirrors routes/synth.ts preHandler behavior
          // (which only runs on the standalone /api/synth/* endpoints, not chat).
          // Without this, synth executes with no Azure credentials and fails on
          // any synthesized azure-sdk call — defeating the "fill missing MCP tool gap" purpose.
          // Trigger OBO whenever we have a userToken that looks like a JWT (3-part dot-sep).
          // Covers both Azure AD SSO users AND API-key users with linked Azure accounts
          // (auth.stage loads the user's Azure access token from DB into userToken).
          // OBO requires the *ID token* (audience = our client ID), not the
          // access token (audience = https://management.azure.com). AAD rejects
          // OBO with AADSTS500131 if the assertion audience doesn't match the
          // app presenting it. The ID token is plumbed through tool-execution
          // for AWS Identity Center / Azure MCP — reuse it for synth too.
          let synthCloudCredentials: any = (codeExecutionContext as any)?.cloudCredentials;
          const oboAssertion = idToken || userToken; // prefer ID token
          logger.info({
            toolCallId: toolCall.id,
            hasIdToken: !!idToken,
            hasUserToken: !!userToken,
            assertionLen: oboAssertion?.length || 0,
            looksLikeJwt: !!oboAssertion && oboAssertion.split('.').length === 3,
            authMethod,
            hasPreExisting: !!synthCloudCredentials,
          }, '[SYNTH-OBO] Pre-OBO state');
          if (!synthCloudCredentials && oboAssertion && oboAssertion.split('.').length === 3) {
            try {
              const obo = getOBOServiceForSynth(logger);
              const armResult = await obo.acquireTokenOnBehalfOf({
                userAccessToken: oboAssertion,
                scopes: ['https://management.azure.com/.default'],
              });
              if (armResult?.accessToken) {
                synthCloudCredentials = {
                  azure: {
                    accessToken: armResult.accessToken,
                    tenantId: process.env.AZURE_TENANT_ID || '',
                  },
                };
                logger.info({
                  toolCallId: toolCall.id,
                  userId: effectiveUserId,
                  tokenLen: armResult.accessToken.length,
                }, '[SYNTH-OBO] ✅ Injected Azure ARM credentials into synth execution context');
              } else {
                logger.warn({
                  toolCallId: toolCall.id,
                  userId: effectiveUserId,
                  hasArmResult: !!armResult,
                  resultKeys: armResult ? Object.keys(armResult) : [],
                }, '[SYNTH-OBO] ⚠️ OBO returned no accessToken — synth will run without Azure credentials');
              }
            } catch (oboErr: any) {
              logger.warn({
                toolCallId: toolCall.id,
                userId: effectiveUserId,
                error: oboErr?.message,
              }, '[SYNTH-OBO] OBO exchange failed — synth will run without Azure credentials');
            }
          }

          const synthResult = await executeSynthToolCall(
            toolCall.id,
            resolvedToolName,
            toolArgs,
            {
              userId: effectiveUserId,
              userEmail: userEmail || '',
              sessionId,
              ssoProvider,
              cloudCredentials: synthCloudCredentials,
              logger
            }
          );

          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: synthResult.result,
            serverName: synthResult.serverName,
            executedOn: synthResult.executedOn,
            executionTimeMs: synthResult.executionTimeMs
          });

          // Emit tool execution event for streaming
          if (emitEvent) {
            emitEvent('tool_execution', {
              toolCallId: toolCall.id,
              toolName: resolvedToolName,
              status: 'completed',
              serverName: 'synth',
              executionTimeMs: synthResult.executionTimeMs
            });
          }

          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            success: !synthResult.result?.error,
            executionTimeMs: synthResult.executionTimeMs
          }, '[TOOL-EXEC] Synth tool executed');

          // Skip to next tool - Synth handled
          continue;

        } catch (synthError: any) {
          logger.error({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            error: synthError.message
          }, '[TOOL-EXEC] Synth tool execution failed');

          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: { error: synthError.message || 'Tool synthesis failed' },
            serverName: 'synth',
            executedOn: os.hostname(),
            executionTimeMs: 0
          });

          if (emitEvent) {
            emitEvent('tool_execution', {
              toolCallId: toolCall.id,
              toolName: resolvedToolName,
              status: 'failed',
              error: synthError.message
            });
          }

          continue;
        }
      }

      // =================================================================
      // 🤖 INVISIBLE AGENT: CODE TOOL ROUTING TO OPENAGENTIC-MANAGER
      // =================================================================
      // Route code-related tools (write_file, execute_command, etc.) to
      // openagentic-manager for execution instead of MCP Proxy.
      // IMPORTANT: Reuses the same openagentic session for the user's chat session
      // to maintain workspace state across multiple code tool calls.
      if (isCodeTool(resolvedToolName)) {
        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          arguments: toolArgs,
          existingSessionId: updatedCodeExecutionContext?.sessionId
        }, '[TOOL-EXEC] 🤖 Routing code tool to openagentic-manager');

        try {
          // Get or create openagentic session - REUSE existing session if available
          // This ensures workspace state persists across multiple tool calls
          const openagenticSession = await getOrCreateOpenagenticSession(
            effectiveUserId,
            sessionId || 'standalone',
            logger,
            updatedCodeExecutionContext?.sessionId // Pass existing session ID if available
          );

          // Update the context with session info if it's a new session
          if (!updatedCodeExecutionContext?.sessionId ||
              updatedCodeExecutionContext.sessionId !== openagenticSession.sessionId) {
            updatedCodeExecutionContext = {
              sessionId: openagenticSession.sessionId,
              workspacePath: openagenticSession.workspacePath,
              executions: updatedCodeExecutionContext?.executions || [],
              artifacts: updatedCodeExecutionContext?.artifacts || []
            };
            logger.info({
              sessionId: openagenticSession.sessionId,
              workspacePath: openagenticSession.workspacePath,
              isNewSession: true
            }, '[TOOL-EXEC] 📁 Created/updated openagentic session context');
          }

          // Execute the code tool
          const codeResult = await executeCodeToolCall(
            toolCall,
            openagenticSession.sessionId,
            logger,
            emitEvent
          );

          // Track this execution in the context
          if (updatedCodeExecutionContext) {
            updatedCodeExecutionContext.executions.push({
              toolCallId: toolCall.id,
              toolName: resolvedToolName,
              output: codeResult.result?.output || '',
              exitCode: codeResult.result?.exitCode,
              executionTimeMs: codeResult.executionTimeMs || 0,
              timestamp: new Date()
            });
          }

          resultsMap.set(pp.originalIndex, codeResult);

          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            openagenticSessionId: openagenticSession.sessionId,
            success: !codeResult.error,
            executionTimeMs: codeResult.executionTimeMs,
            totalExecutions: updatedCodeExecutionContext?.executions.length
          }, '[TOOL-EXEC] ✅ Code tool executed via openagentic-manager');

          // Skip to next tool - code tool handled
          continue;

        } catch (codeError: any) {
          logger.error({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            error: codeError.message
          }, '[TOOL-EXEC] ❌ Code tool execution failed');

          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: null,
            error: `Code execution failed: ${codeError.message}`,
            serverName: 'openagentic-manager',
            executedOn: os.hostname(),
            executionTimeMs: 0
          });

          // Skip to next tool
          continue;
        }
      }

      // ── Image generation tool ──────────────────────────────────────
      if (localType === 'image-gen') {
        try {
          const imgResult = await executeImageGenTool(
            toolCall.id,
            toolArgs,
            {
              userId: effectiveUserId,
              sessionId,
              logger,
            }
          );
          resultsMap.set(pp.originalIndex, imgResult);
          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            success: !imgResult.error,
            executionTimeMs: imgResult.executionTimeMs
          }, '[TOOL-EXEC] Image gen tool executed');
          continue;
        } catch (imgError: any) {
          logger.error({
            toolCallId: toolCall.id,
            error: imgError.message
          }, '[TOOL-EXEC] Image gen tool failed');
          resultsMap.set(pp.originalIndex, {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: null,
            error: `Image generation failed: ${imgError.message}`,
            serverName: 'image-gen',
            executedOn: os.hostname(),
            executionTimeMs: 0
          });
          continue;
        }
      }

      // If we reach here in the local loop, the tool was categorized as local
      // but didn't match any handler - shouldn't happen, treat as error
      logger.error({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        localType
      }, '[TOOL-EXEC] ❌ Local tool categorized but no handler matched');

      resultsMap.set(pp.originalIndex, {
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        result: null,
        error: `Internal error: no handler for local tool type '${localType}'`,
        serverName: 'local',
        executedOn: os.hostname(),
        executionTimeMs: 0
      });

    } catch (error: any) {
      logger.error({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        error: error.message
      }, '[TOOL-EXEC] ❌ Local tool execution failed (uncaught)');

      resultsMap.set(pp.originalIndex, {
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        result: null,
        error: error.message || 'Local tool execution failed',
        serverName: targetServer || 'local',
        executedOn: os.hostname(),
        executionTimeMs: 0
      });
    }
  } // End of local tools sequential loop

  // =================================================================
  // Phase 3: Execute MCP PROXY tools in PARALLEL (concurrency limit: 5)
  // =================================================================
  if (mcpTools.length > 0) {
    logger.info({
      mcpToolCount: mcpTools.length,
      toolNames: mcpTools.map(t => t.resolvedToolName)
    }, '[TOOL-EXEC] 🚀 Starting parallel MCP proxy execution');

    // Emit tool_executing for all MCP tools upfront so UI shows concurrent spinners
    for (const pp of mcpTools) {
      if (emitEvent) {
        emitEvent('tool_executing', {
          name: pp.resolvedToolName,
          arguments: pp.toolArgs,
          toolCallId: pp.toolCall.id,
          targetServer: pp.targetServer,
          timestamp: new Date().toISOString()
        });
      }
    }

    const mcpTasks: ParallelTask<ToolResult>[] = mcpTools.map(pp => ({
      name: `mcp:${pp.resolvedToolName}:${pp.toolCall.id}`,
      timeout: 660000, // 11 min (slightly above the 10 min axios timeout)
      execute: () => executeSingleMCPProxyCall(
        pp, mcpProxyUrl, effectiveUserId, logger,
        userToken, idToken, userId, sessionId, messageId,
        ipAddress, userAgent, emitEvent, originalQuery,
        userGroups, isAdmin, modelUsed, modelProvider,
        userName, userEmail, authMethod
      )
    }));

    const parallelResults = await executeParallelSettled<ToolResult>(mcpTasks, 5, logger);

    // Map results back by original index
    for (let i = 0; i < mcpTools.length; i++) {
      const pp = mcpTools[i];
      const pr = parallelResults[i];

      if (pr.success && pr.result) {
        resultsMap.set(pp.originalIndex, pr.result);
      } else {
        // Task failed at the parallel executor level (e.g., timeout)
        resultsMap.set(pp.originalIndex, {
          toolCallId: pp.toolCall.id,
          toolName: pp.resolvedToolName,
          result: null,
          error: pr.error?.message || 'MCP proxy call failed',
          serverName: pp.targetServer,
          executedOn: os.hostname(),
          executionTimeMs: pr.duration
        });
      }
    }

    logger.info({
      mcpToolCount: mcpTools.length,
      succeeded: parallelResults.filter(r => r.success).length,
      failed: parallelResults.filter(r => !r.success).length,
      totalDurationMs: parallelResults.reduce((max, r) => Math.max(max, r.duration), 0)
    }, '[TOOL-EXEC] 🚀 Parallel MCP proxy execution completed');
  }

  // =================================================================
  // Phase 4: Merge results in original tool call order
  // =================================================================
  const results: ToolResult[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const result = resultsMap.get(i);
    if (result) {
      results.push(result);
    } else {
      // Should not happen, but safety net
      logger.error({ index: i, toolName: toolCalls[i].function.name }, '[TOOL-EXEC] Missing result for tool call');
      results.push({
        toolCallId: toolCalls[i].id,
        toolName: toolCalls[i].function.name,
        result: null,
        error: 'Internal error: tool result missing after execution',
        serverName: 'unknown',
        executedOn: os.hostname(),
        executionTimeMs: 0
      });
    }
  }

  logger.info({
    totalToolCalls: toolCalls.length,
    successfulCalls: results.filter(r => !r.error).length,
    failedCalls: results.filter(r => r.error).length,
    hasCodeExecutionContext: !!updatedCodeExecutionContext,
    openagenticSessionId: updatedCodeExecutionContext?.sessionId
  }, '[TOOL-EXEC] Tool execution batch completed');

  // Fire-and-forget: ingest tool results into adaptive memory
  if (effectiveUserId !== 'anonymous') {
    try {
      const { getUserMemoryService } = await import('../../../services/UserMemoryService.js');
      const memService = getUserMemoryService();
      for (const result of results) {
        if (result.error || !result.result || result.result.length < 50) continue;
        const summary = `Tool ${result.toolName}: ${result.result.substring(0, 300)}`;
        memService.ingest(effectiveUserId, 'tool', result.toolCallId, summary, 0.5).catch(() => {});
      }
    } catch { /* memory service not available */ }
  }

  return { results, codeExecutionContext: updatedCodeExecutionContext };
}

// =================================================================
// 🔌 SINGLE MCP PROXY CALL - Extracted for parallel execution
// =================================================================
// This function handles a single MCP proxy tool call including:
// access control, cache lookups, semantic cache, security gates,
// HTTP call, post-call DLP, feedback, caching, and learning.
async function executeSingleMCPProxyCall(
  pp: PreProcessedToolCall,
  mcpProxyUrl: string,
  effectiveUserId: string,
  logger: Logger,
  userToken?: string,
  idToken?: string,
  userId?: string,
  sessionId?: string,
  messageId?: string,
  ipAddress?: string,
  userAgent?: string,
  emitEvent?: (event: string, data: any) => void,
  originalQuery?: string,
  userGroups?: string[],
  isAdmin?: boolean,
  modelUsed?: string,
  modelProvider?: string,
  userName?: string,
  userEmail?: string,
  authMethod?: string
): Promise<ToolResult> {
  const { toolCall, resolvedToolName, mcpToolName, targetServer, toolArgs } = pp;

  // =================================================================
  // 🛡️ ACCESS CONTROL CHECK - Enforce runtime MCP access policies
  // =================================================================
  if (userId && targetServer && userGroups && isAdmin !== undefined) {
    const accessResult = await mcpAccessControlService.checkToolExecution(
      userId,
      userGroups,
      isAdmin,
      resolvedToolName,
      targetServer,
      logger
    );

    if (!accessResult.allowed) {
      logger.error({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        serverId: targetServer,
        userId,
        reason: accessResult.reason
      }, '[TOOL-EXEC] ❌ ACCESS DENIED');

      if (userId) {
        await logMCPCall({
          userId, userName, userEmail, sessionId, messageId,
          toolCallId: toolCall.id, toolName: toolCall.function.name,
          resolvedToolName, mcpServer: targetServer,
          mcpProxyHost: os.hostname(), requestPayload: toolArgs,
          responsePayload: null, executionTimeMs: 0,
          requestSizeBytes: 0, responseSizeBytes: 0,
          success: false, errorMessage: `Access denied: ${accessResult.reason}`,
          userToken: !!userToken, ipAddress, userAgent, modelUsed, modelProvider
        }, logger);
      }

      return {
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        result: null,
        error: `Access denied: ${accessResult.reason}`,
        serverName: targetServer,
        executedOn: os.hostname(),
        executionTimeMs: 0
      };
    }

    logger.info({
      toolCallId: toolCall.id, toolName: resolvedToolName,
      serverId: targetServer, userId, reason: accessResult.reason
    }, '[TOOL-EXEC] ✅ ACCESS GRANTED');
  }

  // Wrap the main execution in try/catch for error handling
  try {
  // =================================================================
  // 🚀 REDIS CACHE LOOKUP - Check for cached tool result
  // =================================================================
      const cacheableCheck = isToolCacheable(resolvedToolName, toolArgs);
      const argsHash = generateArgsHash(toolArgs);
      // effectiveUserId is already defined at function start

      // DEBUG: Log cache check entry point (use INFO to ensure visibility)
      logger.info({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        cacheable: cacheableCheck,
        argsHash,
        effectiveUserId,
        hasToolArgs: Object.keys(toolArgs).length > 0,
        toolArgsMethod: toolArgs?.method
      }, '[TOOL-CACHE] 🔍 Cache check entry point');

      if (cacheableCheck && effectiveUserId) {
        const cachedResult = await getCachedToolResult(
          resolvedToolName,
          effectiveUserId,
          argsHash,
          logger
        );

        if (cachedResult !== null) {
          // Cache HIT - return cached result without calling MCP Proxy
          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            argsHash,
            userId: effectiveUserId
          }, '[TOOL-CACHE] 🎯 Cache HIT - skipping MCP Proxy call');

          // Emit cache hit event for SSE
          if (emitEvent) {
            emitEvent('tool_cache_hit', {
              name: resolvedToolName,
              toolCallId: toolCall.id,
              cached: true,
              timestamp: new Date().toISOString()
            });
          }

          return {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: cachedResult,
            serverName: targetServer || 'redis-cache',
            executedOn: 'redis-cache',
            executionTimeMs: 0  // Instant from cache
          };
        } else {
          logger.debug({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            argsHash
          }, '[TOOL-CACHE] Cache MISS - will call MCP Proxy');
        }
      } else {
        logger.debug({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          cacheable: cacheableCheck,
          userId: effectiveUserId
        }, '[TOOL-CACHE] Tool not cacheable or no userId - skipping cache');
      }

      // =================================================================
      // 🔍 MILVUS SEMANTIC CACHE LOOKUP (Layer 2) - CROSS-USER semantic matching
      // =================================================================
      // If Redis cache missed but tool is cacheable, try Milvus semantic cache
      // This enables CROSS-USER caching: User B can benefit from User A's cached results
      // if both have RBAC access to the same resource (subscription, account, etc.)
      let semanticCacheHit: SemanticCacheHit | null = null;
      const tenantId = effectiveUserId.split('_')[0] || 'default'; // Extract tenant from userId

      if (cacheableCheck && effectiveUserId) {
        try {
          // CRITICAL: Ensure Milvus semantic cache is initialized before use
          // Without this, isReady() always returns false and cache is never used!
          await ensureSemanticCacheInitialized(logger);

          const semanticCache = getToolResultCacheService(logger);
          if (semanticCache.isReady()) {
            const semanticSearchStart = Date.now();

            // Pass userId, userGroups, and isAdmin for CROSS-USER RBAC verification
            // The semantic cache will:
            // 1. Search for semantically similar queries across ALL users
            // 2. If found, verify the requesting user has RBAC access to the resource
            // 3. Only return if RBAC check passes
            semanticCacheHit = await semanticCache.searchCache(
              tenantId,
              resolvedToolName,
              toolArgs,
              originalQuery,
              effectiveUserId,     // For RBAC verification
              userGroups,          // For MCP access control check
              isAdmin              // Admin bypass for RBAC
            );

            const semanticSearchMs = Date.now() - semanticSearchStart;

            if (semanticCacheHit) {
              const isCrossUser = semanticCacheHit.crossUserHit;

              logger.info({
                toolCallId: toolCall.id,
                toolName: resolvedToolName,
                cacheId: semanticCacheHit.cacheId,
                similarity: semanticCacheHit.similarity.toFixed(4),
                hitCount: semanticCacheHit.hitCount,
                cachedAt: semanticCacheHit.cachedAt.toISOString(),
                crossUserHit: isCrossUser,
                originalUserId: semanticCacheHit.originalUserId,
                resourceScope: semanticCacheHit.resourceScope,
                searchTimeMs: semanticSearchMs
              }, `[SEMANTIC-CACHE] 🎯 Cache HIT${isCrossUser ? ' (CROSS-USER)' : ''} - ${semanticSearchMs}ms vs ~45000ms Azure call`);

              // Emit semantic cache hit event for SSE
              if (emitEvent) {
                emitEvent('tool_semantic_cache_hit', {
                  name: resolvedToolName,
                  toolCallId: toolCall.id,
                  cached: true,
                  semantic: true,
                  crossUser: isCrossUser,
                  similarity: semanticCacheHit.similarity,
                  resourceScope: semanticCacheHit.resourceScope,
                  timeSavedMs: 45000, // Approximate Azure API call time
                  timestamp: new Date().toISOString()
                });
              }

              // Handle data layer references in semantic cache hits.
              // When a large result was stored via DataLayerService, the semantic cache
              // contains { _dataLayerRef: true, datasetId, summary } instead of raw data.
              // Return the processedResult (dataset ref) so the LLM uses query_data.
              const cachedResult = semanticCacheHit.result;
              const isDataLayerRef = cachedResult && typeof cachedResult === 'object' && cachedResult._dataLayerRef;

              if (isDataLayerRef) {
                logger.info({
                  datasetId: cachedResult.datasetId,
                  toolName: resolvedToolName
                }, '[SEMANTIC-CACHE] 📊 Cache hit is a data layer reference — returning dataset ref');
              }

              return {
                toolCallId: toolCall.id,
                toolName: resolvedToolName,
                result: isDataLayerRef ? cachedResult : semanticCacheHit.result,
                processedResult: isDataLayerRef ? cachedResult.summary : undefined,
                serverName: targetServer || 'milvus-semantic-cache',
                executedOn: isCrossUser ? 'milvus-cross-user-cache' : 'milvus-semantic-cache',
                executionTimeMs: semanticSearchMs
              } as ToolExecutionResult;
            }
          }
        } catch (semanticError) {
          logger.debug({
            error: semanticError,
            toolName: resolvedToolName
          }, '[SEMANTIC-CACHE] Semantic cache lookup failed (non-fatal)');
        }
      }

      // =================================================================
      // 📚 SEMANTIC LEARNING LOOKUP - Find verified past results for guidance
      // =================================================================
      // This addresses "learning from ambiguity":
      // - Search for similar past queries that produced verified/high-quality results
      // - Even if not used as cache, this informs validation of new results
      // - Verified patterns help detect anomalies in new tool responses
      let verifiedGuidance: { result: any; similarity: number; qualityScore: number } | null = null;

      if (originalQuery && !semanticCacheHit) {
        try {
          const learningService = getSemanticLearningService();
          const bestVerified = await learningService.getBestVerifiedResult(
            resolvedToolName,
            targetServer || 'unknown',
            toolArgs
          );

          if (bestVerified && bestVerified.similarity > 0.85) {
            verifiedGuidance = {
              result: bestVerified.result,
              similarity: bestVerified.similarity,
              qualityScore: bestVerified.qualityScore || 0
            };
            logger.debug({
              toolName: resolvedToolName,
              similarity: bestVerified.similarity.toFixed(4),
              qualityScore: bestVerified.qualityScore,
              useCount: bestVerified.useCount
            }, '[SEMANTIC-LEARNING] 🎓 Found verified result for guidance');
          }
        } catch (learningError) {
          logger.debug({ error: learningError }, '[SEMANTIC-LEARNING] Verified lookup failed (non-fatal)');
        }
      }

      // =================================================================
      // EXTERNAL MCP PROXY - For all other tools
      // =================================================================
      logger.info({
        toolCallId: toolCall.id,
        toolName: resolvedToolName,
        originalName: toolCall.function.name,
        targetServer,
        arguments: toolArgs
      }, '[TOOL-EXEC] Executing tool call via MCP Proxy');

      // NOTE: tool_executing SSE event is emitted by the parallel launcher
      // before this function is called, so all tools show concurrent spinners.

      // Prepare headers for MCP Proxy
      const headers: any = {
        'Content-Type': 'application/json'
      };

      // Add authentication for MCP Proxy
      // Auth strategy is determined by the ORIGINAL auth method from middleware,
      // NOT by inspecting the token (which may have been overwritten by auth stage
      // with an Azure AD token loaded from DB for API key users with linked Azure accounts).
      //
      // Auth methods:
      // 1. 'azure-ad' → Pass the Azure AD JWT directly for OBO authentication
      // 2. 'api-key' or 'local' → Generate an internal HS256 JWT for MCP proxy auth
      // 3. Fallback → Internal API key for service-to-service auth
      const isApiKeyAuth = authMethod === 'api-key';
      const isLocalAuth = authMethod === 'local';
      const isAzureAdAuth = authMethod === 'azure-ad';
      const isValidAzureJwt = isAzureAdAuth && userToken && userToken.split('.').length === 3;

      if (isValidAzureJwt) {
        // Pass Azure AD JWT directly for OBO authentication
        headers['Authorization'] = `Bearer ${userToken}`;
      } else if (isApiKeyAuth || isLocalAuth || !userToken) {
        // API key and local users: generate an internal HS256 JWT for MCP proxy auth
        // MCP proxy validates HS256 tokens using shared JWT_SECRET
        const jwtSecret = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
        if (!jwtSecret) {
          throw new Error('FATAL: JWT_SECRET or SIGNING_SECRET must be configured for internal token generation');
        }
        const internalToken = jwt.sign({
          userId: userId || 'api-key-user',
          email: userEmail || '',
          name: userName || 'API Key User',
          isAdmin: isAdmin || false,
          groups: userGroups || [],
          source: isApiKeyAuth ? 'api-key-internal' : 'local-internal'
        }, jwtSecret, { expiresIn: '5m' });
        headers['Authorization'] = `Bearer ${internalToken}`;
        logger.info({
          toolCallId: toolCall.id,
          authMethod,
          source: isApiKeyAuth ? 'api-key-internal' : 'local-internal'
        }, '[TOOL-AUTH] Generated internal JWT for MCP proxy (non-Azure auth)');
      } else {
        // Fallback: unknown auth method but has a token - try passing it
        const apiInternalKey = process.env.API_INTERNAL_KEY || '';
        headers['Authorization'] = `Bearer ${userToken || apiInternalKey}`;
      }

      // Pass ID token for OBO (On-Behalf-Of) authentication
      // CRITICAL: ID token has audience = app's client ID, which is required for OBO
      // The access token has audience = https://management.azure.com which is WRONG for OBO
      // Both AWS and Azure MCP servers need the ID token for OBO to work!
      if (idToken) {
        headers['X-AWS-ID-Token'] = idToken;     // For AWS Identity Center
        headers['X-Azure-ID-Token'] = idToken;   // For Azure ARM MCP
      }

      // Pass user info for workspace isolation
      // CRITICAL: This enables MCP servers to look up user-specific workspaces
      // when no OBO token is available (Google auth, API keys, local accounts)
      if (userEmail) {
        headers['X-User-Email'] = userEmail;
      }
      if (userId) {
        headers['X-User-Id'] = userId;
      }

      // =================================================================
      // 🛡️ SECURITY GATE: HITL + DLP scan on tool inputs
      // =================================================================
      // 1. HITL Gate: High/Critical risk tools require human approval
      try {
        const approvalGate = getToolApprovalGate(logger);
        const approval = await approvalGate.evaluate(
          {
            toolName: resolvedToolName,
            serverName: targetServer,
            arguments: toolArgs,
            userId: effectiveUserId,
            sessionId,
            messageId,
          },
          emitEvent || (() => {}),
        );
        if (!approval.approved) {
          logger.warn({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            riskLevel: approval.riskLevel,
            reason: approval.reason,
          }, '[TOOL-EXEC] 🛑 HITL DENIED — tool call blocked');
          return {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: null,
            error: `Tool call denied: ${approval.reason}`,
            serverName: targetServer || 'unknown',
            executedOn: os.hostname(),
            executionTimeMs: 0,
          };
        }
      } catch (hitlError) {
        logger.warn({ error: hitlError }, '[TOOL-EXEC] HITL gate error — allowing (fail-open)');
      }

      // 2. DLP Scan: Check tool arguments for sensitive data
      try {
        const dlp = getDLPScanner(logger);
        const dlpContext: DLPScanContext = {
          userId: effectiveUserId,
          sessionId,
          scanPoint: 'tool_input',
          toolName: resolvedToolName,
        };
        const { blocked, result: dlpResult } = dlp.scanAndAct(JSON.stringify(toolArgs), dlpContext);
        if (blocked) {
          logger.warn({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            severity: dlpResult.severity,
            findings: dlpResult.findings.length,
          }, '[TOOL-EXEC] 🛑 DLP BLOCKED — sensitive data in tool arguments');
          return {
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            result: null,
            error: `DLP policy: ${dlpResult.severity} severity findings in tool arguments — execution blocked`,
            serverName: targetServer || 'unknown',
            executedOn: os.hostname(),
            executionTimeMs: 0,
          };
        }
      } catch (dlpError) {
        logger.warn({ error: dlpError }, '[TOOL-EXEC] DLP scan error — allowing (fail-open)');
      }

      // 3. Credential scoping: Only pass credentials the tool needs
      try {
        const credService = getCredentialScopeService(logger);
        const scopedHeaders = credService.buildScopedHeaders(
          resolvedToolName,
          { azureAccessToken: userToken, azureIdToken: idToken, userId: effectiveUserId, authMethod },
          headers,
        );
        // Apply scoped headers (may remove tokens the tool doesn't need)
        Object.assign(headers, scopedHeaders);
      } catch (credError) {
        logger.warn({ error: credError }, '[TOOL-EXEC] Credential scoping error — using original headers');
      }

      // Prepare audit data
      // CRITICAL: Use mcpToolName (original name) for MCP proxy, not resolvedToolName (sanitized)
      // The MCP server expects the original name like "aws___search_documentation"
      const requestPayload = {
        server: targetServer,
        tool: mcpToolName, // Use original tool name for MCP proxy
        arguments: toolArgs,
        id: toolCall.id
      };
      const requestSizeBytes = new TextEncoder().encode(JSON.stringify(requestPayload)).length;
      const startTime = Date.now();

      // Start heartbeat interval to emit progress events every 5 seconds
      // This gives the frontend real-time feedback that the tool is still executing
      let heartbeatCount = 0;
      const heartbeatInterval = setInterval(() => {
        heartbeatCount++;
        const elapsedSec = heartbeatCount * 5;
        if (emitEvent) {
          emitEvent('tool_progress', {
            toolCallId: toolCall.id,
            name: resolvedToolName,
            elapsed: elapsedSec,
            status: 'executing',
            message: `Executing ${resolvedToolName}... (${elapsedSec}s)`,
            timestamp: new Date().toISOString()
          });
        }
      }, 5000);

      let response;
      const MAX_RETRIES = 1; // Retry once on timeout
      let lastError: any = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            logger.warn({
              toolCallId: toolCall.id,
              toolName: resolvedToolName,
              attempt: attempt + 1,
            }, '[TOOL-EXEC] Retrying tool call after timeout');
            if (emitEvent) {
              emitEvent('tool_progress', {
                toolCallId: toolCall.id,
                name: resolvedToolName,
                elapsed: Math.round((Date.now() - startTime) / 1000),
                status: 'retrying',
                message: `Retry ${attempt}/${MAX_RETRIES}: Re-executing ${resolvedToolName}...`,
                timestamp: new Date().toISOString()
              });
            }
          }
          // Call MCP Proxy to execute the tool
          response = await axios.post(
            `${mcpProxyUrl}/mcp/tool`,
            requestPayload,
            {
              headers,
              timeout: 600000 // 10 minute timeout for long-running Azure operations (AKS, VMs, etc.)
            }
          );
          break; // Success — exit retry loop
        } catch (retryError: any) {
          lastError = retryError;
          const isTimeout = retryError.code === 'ECONNABORTED' ||
            retryError.message?.includes('timeout') ||
            retryError.message?.includes('ETIMEDOUT');
          if (!isTimeout || attempt >= MAX_RETRIES) {
            clearInterval(heartbeatInterval);
            throw retryError; // Not a timeout or exhausted retries — propagate
          }
          logger.warn({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            error: retryError.message,
            elapsedMs: Date.now() - startTime,
          }, `[TOOL-EXEC] Tool call timed out (attempt ${attempt + 1}/${MAX_RETRIES + 1}). The operation may still be running.`);
        }
      }
      clearInterval(heartbeatInterval);

      if (!response) {
        // Both attempts timed out
        throw lastError || new Error(`Tool ${resolvedToolName} timed out after ${MAX_RETRIES + 1} attempts`);
      }

      const executionTimeMs = Date.now() - startTime;
      const responseData = response.data;
      const responseSizeBytes = new TextEncoder().encode(JSON.stringify(responseData)).length;
      const mcpProxyHost = response.headers?.['x-mcp-proxy-host'] || 'mcp-proxy';

      logger.info({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        targetServer,
        statusCode: response.status,
        hasResult: !!response.data,
        executionTime: executionTimeMs,
        resultPreview: JSON.stringify(responseData?.result || responseData).substring(0, 200)
      }, '[TOOL-EXEC] Tool execution completed via MCP Proxy');

      // Track MCP metrics for Grafana dashboards
      trackMCPCall(targetServer || 'unknown', toolCall.function.name, effectiveUserId, 'success');
      mcpResponseTime.observe({ server_id: targetServer || 'unknown', tool_name: toolCall.function.name }, executionTimeMs / 1000);

      // Handle MCP Proxy response format
      let toolResult;
      let isSuccess = true;
      let errorMessage: string | undefined;

      if (responseData?.error) {
        // MCP Proxy returned a structured error envelope (v0.4.0+)
        // Use error_envelope for richer error info with recovery hints
        isSuccess = false;
        const envelope = responseData?.error_envelope;
        if (envelope) {
          errorMessage = `[${envelope.code}] ${envelope.message}`;
          if (envelope.suggestion) {
            errorMessage += ` | Suggestion: ${envelope.suggestion}`;
          }
          logger.warn({
            toolCallId: toolCall.id,
            errorCode: envelope.code,
            retryable: envelope.retryable,
            suggestion: envelope.suggestion
          }, '[TOOL-EXEC] Structured error from MCP proxy');
        } else {
          errorMessage = responseData.error.message || 'MCP tool execution failed';
        }
        trackMCPCall(targetServer || 'unknown', toolCall.function.name, effectiveUserId, 'error');
        throw new Error(errorMessage);
      } else {
        // Extract result from MCP Proxy response
        toolResult = responseData?.result;
      }

      // Use cache metadata from proxy if available (v0.4.0+)
      const proxyCacheMeta = responseData?.cache_meta;

      // Handle nested result structures from Azure MCP
      if (toolResult && typeof toolResult === 'object' && toolResult.result) {
        toolResult = toolResult.result;
      }

      // =================================================================
      // 🛡️ POST-CALL SECURITY: DLP scan + prompt injection scan on results
      // =================================================================
      try {
        const dlp = getDLPScanner(logger);
        const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult ?? '');

        // DLP scan on tool result
        const dlpResultContext: DLPScanContext = {
          userId: effectiveUserId,
          sessionId,
          scanPoint: 'tool_result',
          toolName: resolvedToolName,
        };
        const { text: redactedResult, blocked: resultBlocked, result: dlpScanResult } = dlp.scanAndAct(resultStr, dlpResultContext);

        if (resultBlocked) {
          logger.warn({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            severity: dlpScanResult.severity,
          }, '[TOOL-EXEC] 🛑 DLP BLOCKED tool result — sensitive data detected');
          toolResult = `[Tool result blocked by DLP policy — ${dlpScanResult.severity} severity findings detected]`;
        } else if (redactedResult !== resultStr) {
          // Result was redacted — use redacted version
          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            redactions: dlpScanResult.findings.length,
          }, '[TOOL-EXEC] 🔒 DLP redacted sensitive data from tool result');
          try {
            toolResult = JSON.parse(redactedResult);
          } catch {
            toolResult = redactedResult;
          }
        }

        // Prompt injection scan on tool result (prevent compromised MCP tools
        // from injecting instructions into the LLM context)
        const injectionFindings = dlpScanResult.findings.filter(f => f.category === 'injection');
        if (injectionFindings.length > 0) {
          logger.warn({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            injectionFindings: injectionFindings.length,
            patterns: injectionFindings.map(f => f.ruleName),
          }, '[TOOL-EXEC] ⚠️ INJECTION DETECTED in tool result — sanitizing');
          // The DLP scanner already handles redaction; log for alerting
        }
      } catch (dlpError) {
        logger.warn({ error: dlpError }, '[TOOL-EXEC] Post-call DLP scan error — passing result through');
      }

      // =================================================================
      // 📊 FEEDBACK LOOP INTEGRATION - Score, compress, and learn
      // =================================================================
      // Process tool result through the feedback pipeline:
      // 1. Score the execution quality (execution, structural, behavioral signals)
      // 2. Handle large responses with query-aligned compression
      // 3. Store for cross-user semantic learning
      let feedbackResult: FeedbackResult | undefined;
      let processedResult = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);

      try {
        const feedbackService = getFeedbackIntegrationService();
        feedbackResult = await feedbackService.processToolResult({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          serverName: targetServer || 'unknown',
          httpStatus: response.status,
          responseTimeMs: executionTimeMs,
          rawResult: processedResult,
          userQuery: originalQuery || '',
          userId: effectiveUserId || 'anonymous',
          sessionId
        });

        // Use compressed result if large response handling is active
        if (feedbackResult.processedResponse.compressionStrategy !== 'passthrough') {
          processedResult = feedbackResult.processedResponse.compressedResult;
          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            originalSize: feedbackResult.processedResponse.originalSize,
            compressedSize: feedbackResult.processedResponse.compressedSize,
            strategy: feedbackResult.processedResponse.compressionStrategy,
            informationLoss: feedbackResult.processedResponse.informationLoss,
            finalScore: feedbackResult.scoring.finalScore.toFixed(3)
          }, '[FEEDBACK] 📊 Tool result processed through feedback pipeline');
        } else {
          logger.debug({
            toolCallId: toolCall.id,
            finalScore: feedbackResult.scoring.finalScore.toFixed(3),
            confidence: feedbackResult.scoring.confidence.toFixed(3)
          }, '[FEEDBACK] Tool execution scored');
        }
      } catch (feedbackError) {
        // Feedback processing is non-fatal - continue with original result
        logger.debug({ error: feedbackError }, '[FEEDBACK] Feedback processing failed (non-fatal)');
      }

      // =================================================================
      // 🔍 VERIFIED GUIDANCE COMPARISON - Detect anomalies vs known-good patterns
      // =================================================================
      // If we found verified past results (high-quality, similar queries),
      // compare the new result against them to detect potential anomalies.
      // This is part of "learning from ambiguity" - using past success patterns.
      if (verifiedGuidance && feedbackResult) {
        try {
          // Simple structural comparison: check if result shapes match
          const newResultKeys = Object.keys(
            typeof toolResult === 'object' && toolResult ? toolResult : {}
          );
          const verifiedResultKeys = Object.keys(
            typeof verifiedGuidance.result === 'object' && verifiedGuidance.result
              ? (typeof verifiedGuidance.result === 'string'
                  ? JSON.parse(verifiedGuidance.result)
                  : verifiedGuidance.result)
              : {}
          );

          // Check for structural drift (new fields appearing/disappearing)
          const missingFields = verifiedResultKeys.filter(k => !newResultKeys.includes(k));
          const newFields = newResultKeys.filter(k => !verifiedResultKeys.includes(k));

          if (missingFields.length > 0 || newFields.length > 0) {
            logger.warn({
              toolName: resolvedToolName,
              missingFields,
              newFields,
              verifiedSimilarity: verifiedGuidance.similarity.toFixed(4),
              verifiedQuality: verifiedGuidance.qualityScore
            }, '[SEMANTIC-LEARNING] ⚠️ Structural drift detected vs verified pattern');
          } else {
            logger.debug({
              toolName: resolvedToolName,
              verifiedSimilarity: verifiedGuidance.similarity.toFixed(4)
            }, '[SEMANTIC-LEARNING] ✅ Result structure matches verified pattern');
          }
        } catch (comparisonError) {
          // Comparison is informational only - don't block on errors
          logger.debug({ error: comparisonError }, '[SEMANTIC-LEARNING] Comparison failed (non-fatal)');
        }
      }

      // Log successful MCP call audit data
      if (userId) {
        await logMCPCall({
          userId,
          userName,
          userEmail,
          sessionId,
          messageId,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          resolvedToolName,
          mcpServer: targetServer,
          mcpProxyHost,
          requestPayload: toolArgs,
          responsePayload: toolResult,
          executionTimeMs,
          requestSizeBytes,
          responseSizeBytes,
          success: isSuccess,
          errorMessage,
          userToken: !!userToken,
          ipAddress,
          userAgent,
          modelUsed,
          modelProvider
        }, logger);
      }

      // CRITICAL: Emit tool_result event to keep SSE stream alive
      // This shows the frontend that the tool execution completed successfully
      if (emitEvent) {
        const toolResultEvent = {
          name: resolvedToolName,
          result: toolResult,
          toolCallId: toolCall.id,
          executionTimeMs,
          targetServer,
          timestamp: new Date().toISOString()
        };

        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          executionTimeMs,
          resultSizeBytes: responseSizeBytes
        }, '🔧 [TOOL-SSE] Emitting tool_result event');

        emitEvent('tool_result', toolResultEvent);
      }

      // =================================================================
      // 📊 DATA LAYER AUTO-STORAGE: "Fetch Once, Query Many" Pattern
      // =================================================================
      // Automatically store large tool responses in the data layer.
      // This allows LLMs to query the data without re-fetching.
      // Threshold: >16KB, >50 items, or nested arrays
      let datasetReference: string | undefined;
      try {
        const dataLayer = getDataLayerService();

        // Check if response meets storage threshold
        if (dataLayer.shouldStoreResponse(toolResult)) {
          const storeResult = await dataLayer.storeToolResponse(
            sessionId || 'standalone',
            effectiveUserId,
            resolvedToolName,
            toolArgs,
            originalQuery || '',
            toolResult
          );

          datasetReference = storeResult.datasetId;
          const schemaFields = storeResult.schema.fields?.map(f => f.name) || [];

          // REPLACE processedResult with dataset reference ONLY (not prepend).
          // The full data is stored in the data layer — the LLM uses query_data
          // to drill into it. Sending 127KB raw data + dataset reference defeats
          // the purpose of the data layer and causes 200K+ token context overflow.
          const schemaInfo = schemaFields.length > 0
            ? `   Schema fields: ${schemaFields.slice(0, 15).join(', ')}${schemaFields.length > 15 ? ` (+${schemaFields.length - 15} more)` : ''}\n`
            : '';
          processedResult = `📊 Dataset stored (ID: ${storeResult.datasetId})\n` +
            `   ${storeResult.summary}\n` +
            schemaInfo +
            `   Use 'query_data' tool to explore this data without re-fetching.\n` +
            `   IMPORTANT: The full data is stored in the data layer. Do NOT ask for it again.`;

          logger.info({
            toolCallId: toolCall.id,
            toolName: resolvedToolName,
            datasetId: storeResult.datasetId,
            schemaFields
          }, '[DATA-LAYER] 📊 Large tool response stored for "Fetch Once, Query Many" pattern');
        }
      } catch (dataLayerError) {
        // Data layer storage is non-fatal - continue with original result
        logger.debug({ error: dataLayerError }, '[DATA-LAYER] Storage check failed (non-fatal)');
      }

      // Push result with feedback metadata for downstream processing
      // Use processedResult (potentially compressed) for LLM context optimization
      const resultEntry: ToolExecutionResult = {
        toolCallId: toolCall.id,
        toolName: resolvedToolName,  // Use resolved name
        result: toolResult,  // Original result for caching and auditing
        processedResult: processedResult,  // Compressed result for LLM context (may include dataset ref)
        serverName: targetServer,  // MCP server that executed the tool
        executedOn: mcpProxyHost,
        executionTimeMs,
        requestSize: requestSizeBytes,
        responseSize: responseSizeBytes,
        // Feedback metadata
        feedback: feedbackResult ? {
          finalScore: feedbackResult.scoring.finalScore,
          confidence: feedbackResult.scoring.confidence,
          compressionStrategy: feedbackResult.processedResponse.compressionStrategy,
          informationLoss: feedbackResult.processedResponse.informationLoss,
          fullResultId: feedbackResult.processedResponse.fullResultId
        } : undefined
      };
      // resultEntry will be returned at the end of this function

      // =================================================================
      // 📋 STEP-LEVEL LOGGING (E) - Structured action and decision logs
      // =================================================================
      // Detailed logs of what the agent did and why - enables analysis,
      // debugging, and behavior refinement. These logs trace reasoning chains.
      if (feedbackResult) {
        logger.info({
          event: 'TOOL_EXECUTION_SUCCESS',
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          targetServer,
          timestamp: new Date().toISOString(),
          // Execution metrics
          executionTimeMs,
          requestSizeBytes,
          responseSizeBytes,
          // Quality signals
          qualityScore: feedbackResult.scoring.finalScore.toFixed(3),
          confidence: feedbackResult.scoring.confidence.toFixed(3),
          executionScore: feedbackResult.scoring.executionScore.score.toFixed(3),
          structuralScore: feedbackResult.scoring.structuralScore.score.toFixed(3),
          // Compression info
          compressionStrategy: feedbackResult.processedResponse.compressionStrategy,
          compressionRatio: feedbackResult.processedResponse.originalSize > 0
            ? (feedbackResult.processedResponse.compressedSize / feedbackResult.processedResponse.originalSize).toFixed(3)
            : '1.000',
          informationLoss: feedbackResult.processedResponse.informationLoss,
          // Decision context
          decisionContext: {
            originalQuery: originalQuery?.substring(0, 200),
            hadVerifiedGuidance: !!verifiedGuidance,
            verifiedGuidanceSimilarity: verifiedGuidance?.similarity?.toFixed(4) || null,
            hadSemanticCacheHit: !!semanticCacheHit,
            fromRedisCache: false,
            userId: effectiveUserId,
            sessionId
          }
        }, '[FEEDBACK] 📋 Tool execution step logged for analysis');
      }

      // =================================================================
      // 💾 CACHE TOOL RESULT - Store in Redis for future lookups
      // =================================================================
      // Use proxy cache metadata TTL hint if available, otherwise fall back to local heuristic
      if (cacheableCheck && effectiveUserId && toolResult) {
        const ttl = (proxyCacheMeta?.cacheable && proxyCacheMeta?.ttl_seconds)
          ? proxyCacheMeta.ttl_seconds
          : getCacheTTL(resolvedToolName);
        cacheToolResult(
          resolvedToolName,
          effectiveUserId,
          argsHash,
          toolResult,
          ttl,
          logger
        ).catch(() => {}); // Fire and forget - don't block on caching

        // =================================================================
        // 🧠 MILVUS SEMANTIC CACHE STORAGE (Layer 2) - Cross-user caching
        // =================================================================
        // Store result in Milvus for semantic matching by other users
        try {
          // Ensure semantic cache is initialized (should already be from lookup above)
          await ensureSemanticCacheInitialized(logger);

          const semanticCache = getToolResultCacheService(logger);
          const cacheReady = semanticCache.isReady();
          logger.info({
            toolName: resolvedToolName,
            cacheReady,
            tenantId,
            userId: effectiveUserId
          }, `[SEMANTIC-CACHE] Attempting to store result (cache ready: ${cacheReady})`);

          if (cacheReady) {
            // When a dataset reference exists (large result stored in Redis),
            // cache the PROCESSED result (dataset ref + summary) in Milvus — NOT raw 200KB.
            // This way semantic cache hits return the dataset ref, and the LLM uses
            // query_data to drill into the full data. Avoids duplicating massive data.
            const resultToCache = (datasetReference && processedResult)
              ? { _dataLayerRef: true, datasetId: datasetReference, summary: processedResult, originalToolName: resolvedToolName }
              : toolResult;

            semanticCache.cacheResult(
              tenantId,
              effectiveUserId,
              resolvedToolName,
              toolArgs,
              resultToCache,
              originalQuery
            ).then(cached => {
              if (cached) {
                logger.info({
                  toolName: resolvedToolName,
                  tenantId,
                  hasDatasetRef: !!datasetReference,
                  datasetId: datasetReference || null
                }, '[SEMANTIC-CACHE] 💾 Result stored in semantic cache (per-user, RBAC-ready)');
              }
            }).catch(() => {}); // Fire and forget
          }
        } catch (semanticCacheError) {
          logger.debug({ error: semanticCacheError }, '[SEMANTIC-CACHE] Failed to store in semantic cache (non-fatal)');
        }
      }

      // =================================================================
      // 🧠 SEMANTIC LEARNING - Learn from successful tool executions
      // =================================================================
      // This addresses "learning from ambiguity" - when a tool execution
      // succeeds with high confidence, we store the pattern for future use.
      // The semantic learning service finds similar verified results to help
      // handle ambiguous queries in the future.
      if (userId && originalQuery) {
        // Legacy tool success tracking (for backward compatibility)
        recordToolSuccess(
          userId,
          sessionId,
          originalQuery,
          resolvedToolName,
          targetServer || 'unknown',
          executionTimeMs,
          toolResult,
          logger
        ).catch(() => {}); // Fire and forget - don't block on tracking

        // Enhanced semantic learning with quality signals
        // Only store as verified if high-quality execution
        if (feedbackResult && feedbackResult.scoring.finalScore >= 0.7) {
          try {
            const learningService = getSemanticLearningService();
            // Store the result for future semantic matching
            // High-quality results (score >= 0.7) are candidates for verification
            const resultSummary = `Query: ${originalQuery?.substring(0, 100) || 'N/A'} | ` +
              `Score: ${feedbackResult.scoring.finalScore.toFixed(2)} | ` +
              `Time: ${executionTimeMs}ms | ` +
              `Compression: ${feedbackResult.processedResponse.compressionStrategy}`;

            await learningService.storeResult({
              toolName: resolvedToolName,
              serverId: targetServer || 'unknown',
              inputParams: toolArgs,
              result: processedResult,  // Use processed (potentially compressed) result
              resultSummary,
              userId: effectiveUserId || undefined,
              sessionId: sessionId || undefined
            });
            logger.debug({
              toolName: resolvedToolName,
              finalScore: feedbackResult.scoring.finalScore.toFixed(3),
              query: originalQuery?.substring(0, 100) || 'N/A'
            }, '[SEMANTIC-LEARNING] 📚 High-quality result stored for future learning');
          } catch (learningError) {
            logger.debug({ error: learningError }, '[SEMANTIC-LEARNING] Failed to store for learning (non-fatal)');
          }
        }
      }

      // =================================================================
      // 📋 STORE RECENT TOOL RESULT - For prompt injection to prevent redundant calls
      // =================================================================
      // Store this tool result so it can be injected into future prompts
      // This helps the LLM know what data has already been fetched
      if (sessionId && toolResult) {
        storeRecentToolResult(
          sessionId,
          resolvedToolName,
          toolArgs,
          toolResult,
          logger
        ).catch(() => {}); // Fire and forget
      }

      // =================================================================
      // 🔬 BACKGROUND GROUNDING - Validate and index tool results in-process
      // =================================================================
      // Queue the tool result for background grounding workflow.
      // The grounding workflow will:
      // 1. Infer schema and validate structure
      // 2. Detect anomalies (unhealthy resources, errors, outliers)
      // 3. Extract hierarchy for Milvus indexing (e.g., azure/appgw/resource-name)
      // 4. Generate summary for cross-user caching
      // Fire-and-forget: doesn't block user response
      if (userId && sessionId && toolResult) {
        queueToolResultForGrounding({
          toolName: resolvedToolName,
          toolArgs,
          result: toolResult,
          userId,
          sessionId,
          tenantId,
          executionTimeMs
        }).catch((groundingError) => {
          logger.debug({ error: groundingError }, '[GROUNDING] Failed to queue for grounding (non-fatal)');
        });
      }

      // =================================================================
      // 🛡️ BACKGROUND VALIDATION - Validate LLM interpretation of tool results
      // =================================================================
      // Fire-and-forget: runs async to detect hallucinated claims about tool results
      if (toolResult && processedResult) {
        const validator = new ToolResultValidationService();
        const rawResultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
        validator.validateInterpretation(
          toolCall.id,
          resolvedToolName,
          rawResultStr,
          typeof processedResult === 'string' ? processedResult : JSON.stringify(processedResult)
        ).then(validation => {
          if (validation.shouldRegenerate) {
            logger.warn({
              toolName: resolvedToolName,
              confidence: validation.overallConfidence,
              warnings: validation.warnings,
              contradictions: validation.validatedClaims.filter(c => c.status === 'contradicted').length,
            }, '[VALIDATION] Low confidence in tool result interpretation');
          } else {
            logger.debug({
              toolName: resolvedToolName,
              confidence: validation.overallConfidence,
              claimsValidated: validation.validatedClaims.length,
            }, '[VALIDATION] Tool result interpretation validated');
          }
        }).catch(() => {}); // Fire and forget
      }

      return resultEntry;

    } catch (error: any) {
      const errorMessage = error.message || 'Tool execution failed';
      const errorResponseHost = error.response?.headers?.['x-mcp-proxy-host'] || 'mcp-proxy';
      const errorStatusCode = error.response?.status || 500;
      const errorTimestamp = new Date().toISOString();

      logger.error({
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        targetServer,
        error: errorMessage,
        responseData: error.response?.data,
        statusCode: errorStatusCode
      }, '[TOOL-EXEC] Tool execution failed');

      // =================================================================
      // 📉 ERROR LEARNING (D) - Learn from API errors and task failures
      // =================================================================
      // Environmental feedback: errors inform strategy refinement
      // Score failed executions to track tool reliability degradation
      try {
        const feedbackService = getFeedbackIntegrationService();
        const errorScoring = await feedbackService.processToolResult({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          serverName: targetServer || 'unknown',
          httpStatus: errorStatusCode,
          responseTimeMs: 0,
          rawResult: JSON.stringify({
            error: errorMessage,
            statusCode: errorStatusCode,
            responseData: error.response?.data
          }),
          userQuery: originalQuery || '',
          userId: effectiveUserId || 'anonymous',
          sessionId
        });

        // Log structured error event for analysis (E - Step-level logs)
        logger.warn({
          event: 'TOOL_EXECUTION_FAILURE',
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          targetServer,
          errorCategory: categorizeError(errorStatusCode, errorMessage),
          errorMessage,
          statusCode: errorStatusCode,
          failureScore: errorScoring.scoring.finalScore.toFixed(3),
          timestamp: errorTimestamp,
          userId: effectiveUserId,
          sessionId,
          // Decision context for debugging
          decisionContext: {
            originalQuery: originalQuery?.substring(0, 200),
            toolArgs: JSON.stringify(toolArgs).substring(0, 500)
          }
        }, '[FEEDBACK] 📉 Tool failure recorded for learning');
      } catch (errorLearningErr) {
        logger.debug({ error: errorLearningErr }, '[FEEDBACK] Error learning failed (non-fatal)');
      }

      // CRITICAL: Emit tool_error event to keep SSE stream alive
      // This shows the frontend that the tool execution failed
      if (emitEvent) {
        const toolErrorEvent = {
          name: resolvedToolName,
          error: errorMessage,
          toolCallId: toolCall.id,
          targetServer,
          timestamp: new Date().toISOString()
        };

        logger.info({
          toolCallId: toolCall.id,
          toolName: resolvedToolName,
          error: errorMessage
        }, '🔧 [TOOL-SSE] Emitting tool_error event');

        emitEvent('tool_error', toolErrorEvent);
      }

      // Log failed MCP call audit data
      if (userId) {
        await logMCPCall({
          userId,
          userName,
          userEmail,
          sessionId,
          messageId,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          resolvedToolName,
          mcpServer: targetServer,
          mcpProxyHost: errorResponseHost,
          requestPayload: toolArgs || {},
          responsePayload: error.response?.data || null,
          executionTimeMs: 0, // No timing data for failed calls
          requestSizeBytes: toolArgs ? new TextEncoder().encode(JSON.stringify(toolArgs)).length : 0,
          responseSizeBytes: error.response?.data ? new TextEncoder().encode(JSON.stringify(error.response.data)).length : 0,
          success: false,
          errorMessage,
          userToken: !!userToken,
          ipAddress,
          userAgent,
          modelUsed,
          modelProvider
        }, logger);
      }

      // Return error result
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        result: null,
        error: errorMessage,
        serverName: targetServer,  // Include server name even on error for traceability
        executedOn: errorResponseHost,
        executionTimeMs: 0,
        requestSize: toolArgs ? new TextEncoder().encode(JSON.stringify(toolArgs)).length : 0,
        responseSize: error.response?.data ? new TextEncoder().encode(JSON.stringify(error.response.data)).length : 0
      };
    }
}

/**
 * Format tool results - just pass raw JSON to the LLM
 * The LLM is smart enough to parse any JSON structure from any MCP
 */
function formatToolResult(toolName: string, result: any): string {
  // Handle null/undefined
  if (result === null || result === undefined) {
    return 'No data returned from tool';
  }

  // Already a string - return as-is
  if (typeof result === 'string') {
    return result;
  }

  // For everything else (objects, arrays, primitives), just return JSON
  // The LLM is smart enough to parse JSON - don't hardcode MCP-specific formatting
  return JSON.stringify(result, null, 2);
}

/**
 * Convert tool results to OpenAI tool message format with smart formatting
 *
 * Uses processedResult (data layer reference + compressed) when available,
 * falling back to raw result. This ensures large tool results (100K+ chars from
 * Azure/AWS) are replaced with dataset references instead of bloating LLM context.
 *
 * @param toolResults - Array of tool execution results (may include ToolExecutionResult with processedResult)
 * @returns Array of tool messages for conversation
 */
export function formatToolResultsAsMessages(toolResults: ToolResult[]): any[] {
  return toolResults.map(result => {
    if (result.error) {
      return {
        role: 'tool',
        tool_call_id: result.toolCallId,
        name: result.toolName,
        content: `Error: ${result.error}`
      };
    }

    // Use processedResult if available (includes data layer dataset reference
    // and feedback compression). This is the key integration point:
    // - DataLayerService stores large results and prepends "Dataset stored (ID: data_xxx)"
    // - FeedbackIntegrationService may compress the result
    // - Without this, raw 100K+ char results blow the 200K token limit
    const processedResult = (result as ToolExecutionResult).processedResult;
    const content = processedResult
      ? processedResult
      : formatToolResult(result.toolName, result.result);

    return {
      role: 'tool',
      tool_call_id: result.toolCallId,
      name: result.toolName,
      content: content
    };
  });
}

// =================================================================
// 🔄 AGENT EVENT RELAY — Redis Pub/Sub for real-time agent visibility
// =================================================================

import { v4 as uuidv4 } from 'uuid';
import { createClient } from 'redis';

/** Agent lifecycle event types forwarded from openagentic-proxy via Redis */
const AGENT_EVENT_TYPES = new Set([
  'agent_spawn_plan',
  'agent_start',
  'agent_complete',
  'agent_thinking',
  'agent_stream',
  'agent_tool_call',
  'agent_tool_result',
  'agent_image_generated',
  'agent_delegation',
  'execution_complete',
  'approval_required',
  // HITL-A: sub-agent HITL approval flow uses the same event name as the
  // inline chat path so the chat UI's existing ToolApprovalPopup component
  // renders without UI changes.
  'mcp_approval_required',
]);

interface AgentEventRelayOptions {
  sessionId: string;
  userId: string;
  emit: (event: string, data: any) => void;
  logger: Logger;
  timeoutMs?: number;
}

interface AgentEventRelay {
  executionId: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a Redis Pub/Sub relay that subscribes to agent execution events
 * BEFORE the blocking POST to openagentic-proxy, forwarding them to the SSE stream
 * and persisting audit records.
 *
 * Usage:
 *   const relay = await createAgentEventRelay({ sessionId, userId, emit, logger });
 *   // pass relay.executionId in the POST body
 *   try { await axios.post(..., { executionId: relay.executionId, ... }); }
 *   finally { await relay.cleanup(); }
 */
export async function createAgentEventRelay(
  options: AgentEventRelayOptions
): Promise<AgentEventRelay> {
  const { sessionId, userId, emit, logger, timeoutMs = 900_000 } = options;
  const executionId = uuidv4();
  const channel = `agent:exec:${executionId}`;

  // Create a dedicated subscriber connection (pub/sub requires its own client)
  const redisUrl = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'openagentic-redis'}:${process.env.REDIS_PORT || '6379'}`;
  const subscriber = createClient({ url: redisUrl });

  let cleaned = false;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (safetyTimer) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
    try {
      await subscriber.unsubscribe(channel);
      await subscriber.disconnect();
    } catch (err) {
      logger.debug({ err, channel }, '[AgentRelay] Cleanup error (non-fatal)');
    }
  };

  try {
    await subscriber.connect();

    // Message handler: forward events to SSE + persist audit records
    subscriber.subscribe(channel, (rawMessage: string) => {
      try {
        const event = JSON.parse(rawMessage);
        const eventType = event.event || event.type || event.eventType;

        if (!eventType || !AGENT_EVENT_TYPES.has(eventType)) {
          logger.debug({ eventType, channel }, '[AgentRelay] Ignoring unknown event type');
          return;
        }

        // Forward raw event to SSE stream (backward compat)
        const eventPayload = {
          executionId,
          ...event.data,
          ...(event.agentId ? { agentId: event.agentId } : {}),
          ...(event.role ? { role: event.role } : {}),
          timestamp: event.timestamp || Date.now(),
        };
        emit(eventType, eventPayload);

        // Also emit as normalized_event for the live agent tree UI (Claude Code-style)
        const agentId = event.data?.agentId || event.agentId || '';
        const d = event.data || {};
        if (eventType === 'agent_spawn_plan') {
          emit('normalized_event', {
            type: 'agent_spawn_plan',
            executionId,
            agents: d.agents || d.plan || [],
            strategy: d.strategy || 'parallel',
            timestamp: Date.now(),
          });
        } else if (eventType === 'agent_start') {
          emit('normalized_event', {
            type: 'agent_start',
            id: agentId,
            name: d.role || 'agent',
            role: d.role || 'custom',
            model: d.model || '',
            task: d.task || '',
            parentId: executionId,
            toolCount: d.toolCount || 0,
            tokenCount: d.tokenCount || 0,
            currentActivity: d.currentActivity || 'Starting...',
          });
        } else if (eventType === 'agent_tool_call') {
          emit('normalized_event', {
            type: 'tool_start',
            id: `${agentId}:tool:${Date.now()}`,
            toolName: d.toolName || '',
            serverName: '',
            agentId,
            toolCount: d.toolCount || 0,
            tokenCount: d.tokenCount || 0,
            currentActivity: d.currentActivity || `Using ${d.toolName}...`,
          });
        } else if (eventType === 'agent_tool_result') {
          emit('normalized_event', {
            type: 'tool_stop',
            id: `${agentId}:tool:result`,
            toolName: d.toolName || '',
            agentId,
            durationMs: d.durationMs || 0,
            success: d.success !== false,
            toolCount: d.toolCount || 0,
            tokenCount: d.tokenCount || 0,
            currentActivity: d.currentActivity || '',
          });
        } else if (eventType === 'agent_complete') {
          emit('normalized_event', {
            type: 'agent_stop',
            id: agentId,
            status: d.status || 'success',
            durationMs: d.durationMs || (Date.now() - (d.startTime || Date.now())),
            tokensIn: d.metrics?.inputTokens || 0,
            tokensOut: d.metrics?.outputTokens || 0,
            toolCount: d.toolCount || 0,
            cost: 0,
          });
        } else if (eventType === 'execution_complete') {
          emit('normalized_event', {
            type: 'execution_complete',
            executionId,
            status: d.status || 'completed',
            totalDurationMs: d.totalDurationMs || 0,
            totalInputTokens: d.totalInputTokens || 0,
            totalOutputTokens: d.totalOutputTokens || 0,
            totalToolCalls: d.totalToolCalls || 0,
          });
        }

        // Emit generated images inline so they appear in the chat stream immediately
        if (eventType === 'agent_image_generated' && event.data?.imageUrl) {
          const alt = event.data.prompt || 'Generated image';
          emit('content_delta', { content: `\n\n![${alt}](${event.data.imageUrl})\n\n` });
        }

        // Fire-and-forget audit persistence
        persistAuditEvent(event, executionId, sessionId, userId, logger).catch(
          (err) => logger.debug({ err, eventType }, '[AgentRelay] Audit persist failed (non-fatal)')
        );
      } catch (parseErr) {
        logger.debug({ parseErr, rawMessage: rawMessage?.substring(0, 200) }, '[AgentRelay] Failed to parse event');
      }
    });

    logger.info({ executionId, channel }, '[AgentRelay] Subscribed to agent execution events');

    // Safety timeout — auto-cleanup if POST hangs beyond expected time
    safetyTimer = setTimeout(() => {
      logger.warn({ executionId, timeoutMs }, '[AgentRelay] Safety timeout reached, cleaning up');
      cleanup();
    }, timeoutMs + 30_000); // 30s grace beyond the POST timeout
  } catch (err) {
    logger.warn({ err, executionId }, '[AgentRelay] Failed to connect Redis subscriber (agent events will not stream)');
    // Don't throw — agent execution should still work without real-time events
    cleaned = true;
  }

  return { executionId, cleanup };
}

/**
 * Persist a single agent event to the agent_audit_events table (fire-and-forget).
 */
async function persistAuditEvent(
  event: any,
  executionId: string,
  sessionId: string,
  userId: string,
  logger: Logger
): Promise<void> {
  const eventType = event.event || event.type || event.eventType;
  const data = event.data || {};

  await prisma.agentAuditEvent.create({
    data: {
      executionId,
      sessionId,
      userId,
      agentId: event.agentId || data.agentId || 'unknown',
      agentRole: event.role || data.role || 'unknown',
      eventType,
      eventPayload: data,
      parentAgentId: data.parentAgentId || null,
      modelId: data.model || data.modelUsed || null,
      source: 'chat',
      riskLevel: data.riskLevel || null,
      durationMs: data.durationMs || null,
      inputTokens: data.inputTokens || null,
      outputTokens: data.outputTokens || null,
      costCents: data.costCents || null,
    },
  });
}
