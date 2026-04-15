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