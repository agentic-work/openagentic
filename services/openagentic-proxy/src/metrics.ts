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

import client, { Registry, Counter, Histogram, Gauge } from 'prom-client';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Use the default global registry
export const register: Registry = client.register;

// Collect default Node.js metrics (event loop, heap, GC, etc.)
client.collectDefaultMetrics({ register });

// ─── HTTP Metrics ──────────────────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'openagentic_proxy_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'openagentic_proxy_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.1, 0.3, 0.5, 1, 3, 5, 10, 30],
  registers: [register],
});

// ─── Agent Execution Metrics ───────────────────────────────────────────────

export const agentExecutionsTotal = new Counter({
  name: 'openagentic_proxy_agent_executions_total',
  help: 'Total agent executions by orchestration pattern and status',
  labelNames: ['pattern', 'status'] as const,
  registers: [register],
});

export const agentExecutionDuration = new Histogram({
  name: 'openagentic_proxy_agent_execution_duration_seconds',
  help: 'Agent execution duration in seconds',
  labelNames: ['pattern'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export const activeExecutions = new Gauge({
  name: 'openagentic_proxy_active_executions',
  help: 'Number of currently active agent executions',
  registers: [register],
});

// ─── Tool Call Metrics ─────────────────────────────────────────────────────

export const toolCallsTotal = new Counter({
  name: 'openagentic_proxy_tool_calls_total',
  help: 'Total MCP tool calls',
  labelNames: ['tool_name', 'status'] as const,
  registers: [register],
});

export const toolCallDuration = new Histogram({
  name: 'openagentic_proxy_tool_call_duration_seconds',
  help: 'MCP tool call duration in seconds',
  labelNames: ['tool_name'] as const,
  buckets: [0.1, 0.5, 1, 3, 5, 10],
  registers: [register],
});

// ─── Cost Metrics ──────────────────────────────────────────────────────────

export const costTotal = new Counter({
  name: 'openagentic_proxy_cost_total',
  help: 'Total token cost in cents by model',
  labelNames: ['model'] as const,
  registers: [register],
});

// ─── Fastify Hook Helpers ──────────────────────────────────────────────────

const REQUEST_START_KEY = Symbol('metricsStartTime');

/**
 * Fastify onRequest hook — records the start time for duration measurement.
 */
export function onRequestHook(request: FastifyRequest, _reply: FastifyReply, done: () => void): void {
  (request as any)[REQUEST_START_KEY] = process.hrtime.bigint();
  done();
}

/**
 * Fastify onResponse hook — records request count and duration.
 */
export function onResponseHook(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const route = request.routeOptions?.url || request.url || 'unknown';
  const method = request.method;
  const status = String(reply.statusCode);

  httpRequestsTotal.inc({ method, route, status });

  const startNs = (request as any)[REQUEST_START_KEY] as bigint | undefined;
  if (startNs) {
    const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
    httpRequestDuration.observe({ method, route }, durationSec);
  }

  done();
}
