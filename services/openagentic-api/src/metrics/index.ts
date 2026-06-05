/**
 * Metrics Collection and Tracking
 * 
 * Centralized metrics for monitoring API performance, user activity,
 * and system health across the OpenAgentic Chat platform.
 */

import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Export the register for external use
export { register };
import { logger } from '../utils/logger.js';

// Initialize default metrics collection
collectDefaultMetrics({ register });

// API Metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'user_id'],
  registers: [register]
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register]
});

// Chat Metrics
export const chatMessagesTotal = new Counter({
  name: 'chat_messages_total',
  help: 'Total number of chat messages',
  labelNames: ['user_id', 'model', 'type'],
  registers: [register]
});

export const chatSessionsTotal = new Counter({
  name: 'chat_sessions_total',
  help: 'Total number of chat sessions created',
  labelNames: ['user_id'],
  registers: [register]
});

export const chatResponseTime = new Histogram({
  name: 'chat_response_time_seconds',
  help: 'Time to generate chat responses',
  labelNames: ['model', 'user_id'],
  buckets: [1, 2, 5, 10, 15, 30, 60, 120],
  registers: [register]
});

// Token Usage Metrics
export const tokenUsageTotal = new Counter({
  name: 'token_usage_total',
  help: 'Total tokens consumed',
  labelNames: ['model', 'type', 'user_id'],
  registers: [register]
});

// ──────────────────────────────────────────────────────────────────────────
// gen_ai.* — OpenTelemetry GenAI semantic conventions
// (https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/)
//
// One canonical set the dashboard reads via PromQL — every provider call
// (OpenAI / Azure / Anthropic / Bedrock / Vertex / Ollama) maps onto these
// at emit time. Buckets tuned for chat/agent workloads — adjust if you
// see clipping at the tails on PromQL `histogram_quantile`.
// ──────────────────────────────────────────────────────────────────────────
export const genAiClientOperationDurationSeconds = new Histogram({
  name: 'gen_ai_client_operation_duration_seconds',
  help: 'Duration of LLM client operations (full request wall-clock)',
  labelNames: ['provider', 'model', 'operation', 'status'],
  // 50ms → 120s — covers cached completions through long reasoning runs.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [register],
});

export const genAiServerTimeToFirstTokenSeconds = new Histogram({
  name: 'gen_ai_server_time_to_first_token_seconds',
  help: 'Time from request send to first streamed token (TTFT)',
  labelNames: ['provider', 'model'],
  // 50ms → 30s — anything above 30s is a separate alert.
  buckets: [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30],
  registers: [register],
});

export const genAiServerTimePerOutputTokenSeconds = new Histogram({
  name: 'gen_ai_server_time_per_output_token_seconds',
  help: 'Inter-token latency / decode rate (TPOT) — derived as 1 / tokens_per_second',
  labelNames: ['provider', 'model'],
  // 1ms → 1s per token — covers fast decode through degraded.
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const genAiClientTokenUsageTotal = new Counter({
  name: 'gen_ai_client_token_usage_total',
  help: 'Cumulative tokens consumed split by direction (input / output / cached / reasoning)',
  labelNames: ['provider', 'model', 'token_type'],
  registers: [register],
});

export const genAiFinishReasonsTotal = new Counter({
  name: 'gen_ai_finish_reasons_total',
  help: 'Per-provider finish_reason / stop_reason distribution',
  labelNames: ['provider', 'model', 'finish_reason'],
  registers: [register],
});

export const genAiErrorsTotal = new Counter({
  name: 'gen_ai_errors_total',
  help: 'LLM request errors by class (timeout / rate_limit / 4xx / 5xx / network / unknown)',
  labelNames: ['provider', 'model', 'error_class'],
  registers: [register],
});

export const tokenCostTotal = new Counter({
  name: 'token_cost_total',
  help: 'Total cost from token usage',
  labelNames: ['model', 'user_id'],
  registers: [register]
});

// MCP Metrics
export const mcpCallsTotal = new Counter({
  name: 'mcp_calls_total',
  help: 'Total number of MCP tool calls',
  labelNames: ['server_id', 'tool_name', 'user_id', 'status'],
  registers: [register]
});

export const mcpResponseTime = new Histogram({
  name: 'mcp_response_time_seconds',
  help: 'MCP tool call response time',
  labelNames: ['server_id', 'tool_name'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register]
});

export const mcpServerInstances = new Gauge({
  name: 'mcp_server_instances_total',
  help: 'Number of active MCP server instances',
  labelNames: ['server_id', 'status'],
  registers: [register]
});

// ──────────────────────────────────────────────────────────────────────────
// mcp_tool_calls_total — per-server / per-tool MCP dispatch counter.
//
// Source: the SAME live chat-pipeline dispatch seam that writes a row to the
// `mcp_usage` Postgres table (`recordChatMcpUsage` in buildChatV2Deps +
// `recordMcpUsage` in MCPProxyClient). Every chat-v2 MCP tool dispatch and
// every legacy sub-agent dispatch increments this counter alongside the DB
// write, so the admin "MCP usage by server" pie/donut can be backed by a
// PromQL `sum by (server) (mcp_tool_calls_total)` instead of depending on a
// deleted REST aggregation endpoint. NOT fabricated — one inc per real
// dispatch, mirroring the durable audit row 1:1.
//
// `server` is derived from the canonical (server-prefixed) tool name via
// `mcpServerLabelFromToolName` below; `outcome` is ok|error.
export const mcpToolCallsTotal = new Counter({
  name: 'mcp_tool_calls_total',
  help: 'MCP tool dispatches from the chat pipeline by server, tool, and outcome (ok|error). One inc per real dispatch (mirrors the mcp_usage DB row).',
  labelNames: ['server', 'tool_name', 'outcome'],
  registers: [register]
});

/**
 * Canonical MCP server ids (matches `BUILTIN_MCP_CATALOG` bare ids). Used to
 * resolve a clean `server` label from a server-prefixed tool slug. A small
 * alias map folds common naming drifts (e.g. `k8s_*` tools → `kubernetes`)
 * onto the catalog id so the pie aggregates to one slice per server.
 *
 * Kept here (not imported from mcpBuiltinCatalog) to keep the metrics module
 * dependency-free / import-safe at module load — adding a catalog import here
 * would pull the fleet module into every metric consumer.
 */
const MCP_SERVER_PREFIX_ALIASES: Record<string, string> = {
  k8s: 'kubernetes',
  kube: 'kubernetes',
  kubectl: 'kubernetes',
  prom: 'prometheus',
};

/**
 * Derive the `server` label for `mcpToolCallsTotal` from a (canonical,
 * server-prefixed) MCP tool slug. Tool slugs are `<server>_<verb>_<resource>`
 * (e.g. `prometheus_query`, `aws_list_buckets`, `kubernetes_list_pods`), so
 * the first underscore-delimited segment is the server id. Returns `'unknown'`
 * for empty / unprefixable names so the counter never throws on a bad label.
 */
export function mcpServerLabelFromToolName(toolName: string | null | undefined): string {
  const name = String(toolName ?? '').trim().toLowerCase();
  if (!name) return 'unknown';
  const first = name.split(/[_-]/)[0] || 'unknown';
  return MCP_SERVER_PREFIX_ALIASES[first] ?? first;
}

/**
 * Emit-site for `mcpToolCallsTotal`. Called from the chat-pipeline MCP
 * dispatch seam (the same seam that records the durable `mcp_usage` row).
 * Side-effect only — never throws, so a bad label can't break a tool call.
 *
 * @param toolName canonical tool slug (server-prefixed)
 * @param ok       dispatch outcome
 * @param server   optional explicit server id (e.g. the legacy MCPProxyClient
 *                 path knows the server directly); falls back to deriving it
 *                 from the tool name.
 */
export function trackMcpToolCall(toolName: string, ok: boolean, server?: string): void {
  try {
    const serverLabel = (server && server.trim())
      ? server.trim().toLowerCase()
      : mcpServerLabelFromToolName(toolName);
    mcpToolCallsTotal
      .labels(serverLabel, toolName || 'unknown', ok ? 'ok' : 'error')
      .inc();
  } catch {
    // Side-effect only — never break a tool dispatch on a metrics emit.
  }
}

// Authentication Metrics
export const authAttemptsTotal = new Counter({
  name: 'auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['method', 'status', 'user_agent'],
  registers: [register]
});

export const activeUsersGauge = new Gauge({
  name: 'active_users_current',
  help: 'Current number of active users',
  registers: [register]
});

// Memory & Vector Metrics
export const vectorOperationsTotal = new Counter({
  name: 'vector_operations_total',
  help: 'Total vector database operations',
  labelNames: ['operation', 'collection', 'status'],
  registers: [register]
});

export const memoryUsageBytes = new Gauge({
  name: 'memory_usage_bytes',
  help: 'Memory usage in bytes',
  labelNames: ['type'],
  registers: [register]
});

// Memory System Metrics
export const memoryCacheOperationsTotal = new Counter({
  name: 'memory_cache_operations_total',
  help: 'Total memory cache operations',
  labelNames: ['operation', 'cache_type', 'result'],
  registers: [register]
});

export const memoryContextAssemblyTotal = new Counter({
  name: 'memory_context_assembly_total',
  help: 'Total context assembly operations',
  labelNames: ['model', 'cache_hit'],
  registers: [register]
});

export const memoryContextAssemblyDuration = new Histogram({
  name: 'memory_context_assembly_duration_seconds',
  help: 'Duration of context assembly operations',
  labelNames: ['model'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register]
});

export const memoryContextTokens = new Histogram({
  name: 'memory_context_tokens',
  help: 'Number of tokens in assembled context',
  labelNames: ['model'],
  buckets: [100, 500, 1000, 2000, 4000, 8000, 16000, 32000],
  registers: [register]
});

export const memoryTierUtilization = new Gauge({
  name: 'memory_tier_utilization',
  help: 'Memory tier utilization percentage (0-1)',
  labelNames: ['tier'],
  registers: [register]
});

export const memoryRetrievalTotal = new Counter({
  name: 'memory_retrieval_total',
  help: 'Total memory retrieval operations',
  labelNames: ['user_id', 'cache_hit'],
  registers: [register]
});

export const memoryRetrievalDuration = new Histogram({
  name: 'memory_retrieval_duration_seconds',
  help: 'Duration of memory retrieval operations',
  labelNames: ['cache_hit'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register]
});

// Pipeline Observability Metrics (Task 22)
export const pipelineDuration = new Histogram({
  name: 'openagentic_pipeline_duration_seconds',
  help: 'Pipeline stage duration in seconds',
  labelNames: ['stage', 'model'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const toolCallDuration = new Histogram({
  name: 'openagentic_tool_call_duration_seconds',
  help: 'MCP tool call duration in seconds',
  labelNames: ['tool', 'server', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const pipelineTokenUsageTotal = new Counter({
  name: 'openagentic_token_usage_total',
  help: 'Total token usage',
  labelNames: ['model', 'direction'],
  registers: [register],
});

export const hitlWaitDuration = new Histogram({
  name: 'openagentic_hitl_wait_seconds',
  help: 'Time waiting for HITL approval in seconds',
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export const agentSpawnTotal = new Counter({
  name: 'openagentic_agent_spawn_total',
  help: 'Total agent spawns',
  labelNames: ['agent_role'],
  registers: [register],
});

// Database Metrics
export const dbQueriesTotal = new Counter({
  name: 'database_queries_total',
  help: 'Total database queries executed',
  labelNames: ['operation', 'table', 'status'],
  registers: [register]
});

export const dbConnectionsActive = new Gauge({
  name: 'database_connections_active',
  help: 'Active database connections',
  registers: [register]
});

// Helper Functions

/**
 * Track a chat message
 */
export function trackChatMessage(userId: string, model: string, type: 'user' | 'assistant' = 'assistant') {
  chatMessagesTotal.labels(userId, model, type).inc();
}

/**
 * Track a chat session creation
 */
export function trackChatSession(userId: string) {
  chatSessionsTotal.labels(userId).inc();
}

/**
 * Track MCP tool call
 */
export function trackMCPCall(serverId: string, toolName: string, userId: string, status: 'success' | 'error') {
  mcpCallsTotal.labels(serverId, toolName, userId, status).inc();
}

/**
 * Track authentication attempt
 */
export function trackAuthAttempt(method: string, status: 'success' | 'failure', userAgent?: string) {
  authAttemptsTotal.labels(method, status, userAgent || 'unknown').inc();
}

/**
 * Track token usage
 */
export function trackTokenUsage(model: string, type: 'input' | 'output', tokens: number, userId: string, cost?: number) {
  tokenUsageTotal.labels(model, type, userId).inc(tokens);
  if (cost) {
    tokenCostTotal.labels(model, userId).inc(cost);
  }
}

/**
 * One-shot emit-site for gen_ai.* metrics. Called by LLMMetricsService.logRequest()
 * AFTER the per-request DB row is written, so a single seam covers both
 * Prom + Postgres. Keep this function side-effect-only — never throws,
 * never blocks the calling LLM request.
 *
 * Token-type rows that are zero or undefined are elided so the Counter
 * doesn't emit empty rows that pollute PromQL `topk()` and `sum by(token_type)`.
 */
export interface LLMRequestTrack {
  provider: string;
  model: string;
  operation: 'chat' | 'embedding' | 'completion' | 'image';
  status: 'success' | 'error' | 'timeout' | 'rate_limited';
  durationMs: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
  errorClass?: string;
}

export function trackLLMRequest(t: LLMRequestTrack): void {
  try {
    const { provider, model, operation, status } = t;

    // NOTE: prom-client orders labels alphabetically internally on `.labels(...)`
    // positional calls — we use the object form so binding is explicit and
    // immune to label-name reordering.
    genAiClientOperationDurationSeconds
      .labels({ provider, model, operation, status })
      .observe(t.durationMs / 1000);

    if (t.ttftMs != null && t.ttftMs > 0) {
      genAiServerTimeToFirstTokenSeconds
        .labels({ provider, model })
        .observe(t.ttftMs / 1000);
    }
    if (t.tokensPerSecond != null && t.tokensPerSecond > 0) {
      genAiServerTimePerOutputTokenSeconds
        .labels({ provider, model })
        .observe(1 / t.tokensPerSecond);
    }

    if (t.promptTokens && t.promptTokens > 0) {
      genAiClientTokenUsageTotal.labels({ provider, model, token_type: 'input' }).inc(t.promptTokens);
    }
    if (t.completionTokens && t.completionTokens > 0) {
      genAiClientTokenUsageTotal.labels({ provider, model, token_type: 'output' }).inc(t.completionTokens);
    }
    if (t.cachedTokens && t.cachedTokens > 0) {
      genAiClientTokenUsageTotal.labels({ provider, model, token_type: 'cached' }).inc(t.cachedTokens);
    }
    if (t.reasoningTokens && t.reasoningTokens > 0) {
      genAiClientTokenUsageTotal.labels({ provider, model, token_type: 'reasoning' }).inc(t.reasoningTokens);
    }

    if (status === 'success' && t.finishReason) {
      genAiFinishReasonsTotal.labels({ provider, model, finish_reason: t.finishReason }).inc();
    } else if (status !== 'success') {
      genAiErrorsTotal
        .labels({ provider, model, error_class: t.errorClass || 'unknown' })
        .inc();
    }
  } catch (err) {
    // Side-effect only — never break the calling request.
    logger.debug({ err }, '[metrics] trackLLMRequest failed');
  }
}

/**
 * Track vector operation
 */
export function trackVectorOperation(operation: string, collection: string, status: 'success' | 'error') {
  vectorOperationsTotal.labels(operation, collection, status).inc();
}

/**
 * Track database query
 */
export function trackDatabaseQuery(operation: string, table: string, status: 'success' | 'error') {
  dbQueriesTotal.labels(operation, table, status).inc();
}

/**
 * Track memory cache operation
 */
export function trackMemoryCacheOperation(operation: 'get' | 'set' | 'delete', cacheType: string, result: 'hit' | 'miss' | 'success') {
  memoryCacheOperationsTotal.labels(operation, cacheType, result).inc();
}

/**
 * Track context assembly
 */
export function trackContextAssembly(model: string, tokens: number, cacheHit: boolean, durationSeconds: number) {
  memoryContextAssemblyTotal.labels(model, cacheHit.toString()).inc();
  memoryContextAssemblyDuration.labels(model).observe(durationSeconds);
  memoryContextTokens.labels(model).observe(tokens);
}

/**
 * Track memory retrieval
 */
export function trackMemoryRetrieval(userId: string, cacheHit: boolean, durationSeconds: number) {
  memoryRetrievalTotal.labels(userId, cacheHit.toString()).inc();
  memoryRetrievalDuration.labels(cacheHit.toString()).observe(durationSeconds);
}

/**
 * Update tier utilization gauge
 */
export function updateTierUtilization(tierStats: Record<string, number>) {
  Object.entries(tierStats).forEach(([tier, utilization]) => {
    memoryTierUtilization.labels(tier).set(utilization);
  });
}

/**
 * Set up metrics collection
 * NOTE: Custom metrics are registered at module load time via their constructors.
 * We don't clear the registry here to preserve them.
 */
export function setupMetrics() {
  logger.info('📊 Setting up metrics collection');

  // Custom metrics are already registered at module load time
  // Just ensure default metrics are collected (they're already added at top of file)
  
  return {
    registers: [register],
    httpRequestsTotal,
    httpRequestDuration,
    chatMessagesTotal,
    chatSessionsTotal,
    chatResponseTime,
    tokenUsageTotal,
    tokenCostTotal,
    mcpCallsTotal,
    mcpResponseTime,
    mcpServerInstances,
    authAttemptsTotal,
    activeUsersGauge,
    vectorOperationsTotal,
    memoryUsageBytes,
    dbQueriesTotal,
    dbConnectionsActive,
    memoryCacheOperationsTotal,
    memoryContextAssemblyTotal,
    memoryContextAssemblyDuration,
    memoryContextTokens,
    memoryTierUtilization,
    memoryRetrievalTotal,
    memoryRetrievalDuration,
    pipelineDuration,
    toolCallDuration,
    pipelineTokenUsageTotal,
    hitlWaitDuration,
    agentSpawnTotal,
  };
}

/**
 * Start periodic metrics updates
 */
export function startMetricsUpdates() {
  logger.info('📈 Starting periodic metrics updates');
  
  // Update active users every 30 seconds
  setInterval(async () => {
    try {
      // This would connect to your session store or database
      // For now, we'll use a placeholder
      const activeUsers = 0; // await getActiveUserCount();
      activeUsersGauge.set(activeUsers);
    } catch (error) {
      logger.error('Error updating active users metric:', error);
    }
  }, 30000);
  
  // Update memory usage every 60 seconds
  setInterval(() => {
    try {
      const usage = process.memoryUsage();
      memoryUsageBytes.labels('heap_used').set(usage.heapUsed);
      memoryUsageBytes.labels('heap_total').set(usage.heapTotal);
      memoryUsageBytes.labels('external').set(usage.external);
      memoryUsageBytes.labels('rss').set(usage.rss);
    } catch (error) {
      logger.error('Error updating memory metrics:', error);
    }
  }, 60000);
}

/**
 * Get metrics endpoint handler
 */
export async function getMetrics() {
  try {
    return await register.metrics();
  } catch (error) {
    logger.error('Error getting metrics:', error);
    throw error;
  }
}

// Middleware
export class MetricsUtils {
  static trackHttpRequest(method: string, route: string, statusCode: number, duration: number, userId?: string) {
    httpRequestsTotal.labels(method, route, statusCode.toString(), userId || 'anonymous').inc();
    httpRequestDuration.labels(method, route, statusCode.toString()).observe(duration / 1000);
  }
  
  static trackChatResponse(model: string, duration: number, userId: string) {
    chatResponseTime.labels(model, userId).observe(duration / 1000);
  }
  
  static trackMCPResponse(serverId: string, toolName: string, duration: number) {
    mcpResponseTime.labels(serverId, toolName).observe(duration / 1000);
  }
}

// ============================================================================
// Router + Tuning + Defaults Metrics (added 2026-04-23)
// ============================================================================

/** Counter: which model got picked and how it got picked */
export const routerDecisionCounter = new Counter({
  name: 'openagentic_router_decision_total',
  help: 'SmartRouter model selection count, labelled by resolution path, model, and tier',
  labelNames: ['resolved_by', 'selected_model', 'tier'] as const,
  registers: [register],
});

/** Counter: when an escalation path fired (destructive/infra/complexity/chat-pool/quality-gate) */
export const routerEscalationCounter = new Counter({
  name: 'openagentic_router_escalation_fires_total',
  help: 'SmartRouter escalation path triggers',
  labelNames: ['type'] as const,
  registers: [register],
});

/** Counter: when an FCA floor filtered a model out */
export const routerFloorExcludedCounter = new Counter({
  name: 'openagentic_router_floor_excluded_total',
  help: 'SmartRouter candidate filtered by an FCA floor',
  labelNames: ['floor', 'model'] as const,
  registers: [register],
});

/** Histogram: routeRequest latency in ms */
export const routerRouteRequestDurationMs = new Histogram({
  name: 'openagentic_router_route_request_duration_ms',
  help: 'SmartRouter routeRequest wall time (ms)',
  buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [register],
});

/** Counter: whether quality bonus was applied on a request */
export const routerQualityBonusCounter = new Counter({
  name: 'openagentic_router_quality_bonus_applied_total',
  help: 'SmartRouter quality bonus fired on a request (gated: was the fcaQualityGatedByComplexity check passed)',
  labelNames: ['applied'] as const,
  registers: [register],
});

/** Counter: admin updated a tuning field */
export const routerTuningUpdatedCounter = new Counter({
  name: 'openagentic_router_tuning_updated_total',
  help: 'Router tuning field mutations via admin UI / API',
  labelNames: ['field', 'updated_by'] as const,
  registers: [register],
});

/** Gauge: current value of each tuning field (scalar fields only) */
export const routerTuningCurrentGauge = new Gauge({
  name: 'openagentic_router_tuning_current',
  help: 'Current value of each router tuning field',
  labelNames: ['field'] as const,
  registers: [register],
});

/** Counter: admin updated a default-models category */
export const defaultModelsUpdatedCounter = new Counter({
  name: 'openagentic_defaults_updated_total',
  help: 'Tenant default_models category mutations via admin UI / API',
  labelNames: ['category', 'updated_by'] as const,
  registers: [register],
});

/** Gauge: the currently-selected model per default-models category */
export const defaultModelsCurrentGauge = new Gauge({
  name: 'openagentic_defaults_current',
  help: 'Current tenant default model per category (value is always 1; label carries the model id)',
  labelNames: ['category', 'model'] as const,
  registers: [register],
});

/** Histogram: bootstrap step duration — labelled by step name and outcome status */
export const bootstrapStepDuration = new Histogram({
  name: 'bootstrap_step_duration_seconds',
  help: 'Duration of each API bootstrap step in seconds',
  labelNames: ['step', 'status'] as const,
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [register],
});

/** Histogram: sub-agent concurrent dispatch count per orchestration run */
export const subagentConcurrentDispatch = new Histogram({
  name: 'openagentic_subagent_concurrent_dispatch_count',
  help: 'Number of sub-agents dispatched concurrently from a single orchestration group',
  buckets: [1, 2, 3, 4, 5, 8, 10],
  registers: [register],
});

// Default export
export default {
  setupMetrics,
  startMetricsUpdates,
  getMetrics,
  MetricsUtils,
  trackChatMessage,
  trackChatSession,
  trackMCPCall,
  trackAuthAttempt,
  trackTokenUsage,
  trackVectorOperation,
  trackDatabaseQuery,
  trackMemoryCacheOperation,
  trackContextAssembly,
  trackMemoryRetrieval,
  updateTierUtilization,
  registers: [register]
};