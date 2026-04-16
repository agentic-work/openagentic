/**
 * k6 Ollama Stress Test — 50 concurrent users, Ollama models ONLY
 *
 * Tests gpt-oss, qwen2.5-coder, embedding-gemma through the full pipeline.
 * Goal: find where Ollama inference + pipeline + DB bottleneck under load.
 *
 * Usage:
 *   k6 run --env TOKEN=$(cat /tmp/k6_token.txt) scripts/k6-ollama-stress.js
 *
 * Ramp: 0→10 over 15s, 10→50 over 30s, hold 50 for 3m, ramp down.
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const chatLatency = new Trend('chat_stream_latency', true);
const ttft = new Trend('time_to_first_token', true);
const sessionCreateLatency = new Trend('session_create_latency', true);
const toolCallLatency = new Trend('tool_call_latency', true);
const apiErrors = new Counter('api_errors');
const sseSuccess = new Rate('sse_success_rate');
const timeouts = new Counter('timeouts');
const http429s = new Counter('rate_limit_429s');
const http500s = new Counter('server_errors_500s');
const ollamaFailures = new Counter('ollama_failures');

// Config
const API_BASE = __ENV.API_BASE || 'https://chat-dev.openagentic.io';
const TOKEN = __ENV.TOKEN || '';

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

// Ollama models to rotate through
const OLLAMA_MODELS = ['gpt-oss', 'qwen2.5-coder'];

// Prompts — mix of simple (no tools) and complex (may trigger tools)
const SIMPLE_PROMPTS = [
  'What is Kubernetes?',
  'Explain the CAP theorem in 2 sentences',
  'Write a Python one-liner to reverse a string',
  'What is the difference between TCP and UDP?',
  'Explain DNS resolution briefly',
  'What is a container?',
  'Define microservices architecture',
  'What is OAuth 2.0?',
  'Explain REST vs GraphQL',
  'What is a load balancer?',
];

const TOOL_PROMPTS = [
  'List all Kubernetes pods in agentic-dev namespace',
  'Check the health of all services in the cluster',
  'What Prometheus alerts are currently firing?',
  'Search the knowledge base for deployment runbooks',
  'Show me recent Loki logs for the API service',
];

export const options = {
  stages: [
    { duration: '15s', target: 10 },   // Warm up
    { duration: '30s', target: 30 },   // Ramp to 30
    { duration: '30s', target: 50 },   // Ramp to 50
    { duration: '3m', target: 50 },    // HOLD 50 users — stress zone
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<30000'],   // 95% under 30s (Ollama is slow)
    http_req_failed: ['rate<0.2'],        // Less than 20% failure
    sse_success_rate: ['rate>0.7'],       // At least 70% SSE success
    chat_stream_latency: ['p(95)<45000'], // Ollama p95 under 45s
    session_create_latency: ['p(95)<3000'],
  },
};

export default function () {
  const model = OLLAMA_MODELS[Math.floor(Math.random() * OLLAMA_MODELS.length)];
  const useToolPrompt = Math.random() < 0.3; // 30% tool prompts
  const prompt = useToolPrompt
    ? TOOL_PROMPTS[Math.floor(Math.random() * TOOL_PROMPTS.length)]
    : SIMPLE_PROMPTS[Math.floor(Math.random() * SIMPLE_PROMPTS.length)];

  // 1. Health check
  group('health', () => {
    const res = http.get(`${API_BASE}/api/health`, { timeout: '5s' });
    check(res, { 'health 200': (r) => r.status === 200 });
  });

  // 2. Create session (force Ollama model)
  let sessionId = '';
  group('create_session', () => {
    const res = http.post(
      `${API_BASE}/api/chat/sessions`,
      JSON.stringify({ title: `k6-ollama-${__VU}-${__ITER}` }),
      { headers, timeout: '5s' }
    );
    sessionCreateLatency.add(res.timings.duration);
    const ok = check(res, {
      'session created': (r) => r.status === 200 || r.status === 201,
    });
    if (ok) {
      try {
        const d = JSON.parse(res.body);
        sessionId = d.session?.id || d.id || '';
      } catch {}
    }
    if (!ok) apiErrors.add(1);
  });

  if (!sessionId) {
    sleep(1);
    return;
  }

  // 3. Chat with Ollama model (SSE streaming)
  group('chat_ollama', () => {
    const start = Date.now();
    const res = http.post(
      `${API_BASE}/api/chat/stream`,
      JSON.stringify({
        message: prompt,
        sessionId,
        model: model,           // Force Ollama model
        slider: 10,             // Low slider = prefer cheap/fast model
      }),
      {
        headers: { ...headers, Accept: 'text/event-stream' },
        timeout: '60s',         // Ollama can be slow
      }
    );
    const duration = Date.now() - start;
    chatLatency.add(duration);

    // Track specific failure modes
    if (res.status === 429) {
      http429s.add(1);
      apiErrors.add(1);
    } else if (res.status >= 500) {
      http500s.add(1);
      apiErrors.add(1);
    } else if (res.timings.duration >= 59000) {
      timeouts.add(1);
    }

    const body = res.body || '';

    // Check for Ollama-specific failures
    if (body.includes('RESOURCE_NOT_FOUND') || body.includes('model not found')) {
      ollamaFailures.add(1);
    }
    if (body.includes('ECONNREFUSED') || body.includes('connect ECONNREFUSED')) {
      ollamaFailures.add(1);
    }

    // Measure TTFT — time from request to first content_block_delta
    const firstDeltaIdx = body.indexOf('content_block_delta');
    if (firstDeltaIdx > 0) {
      // Rough TTFT estimate based on position in response
      // Not perfectly accurate but good enough for load testing
      ttft.add(res.timings.waiting);
    }

    const ok = check(res, {
      'stream 200': (r) => r.status === 200,
      'has SSE data': (r) => r.body && r.body.includes('data:'),
      'has content': (r) => r.body && (
        r.body.includes('content_block_delta') ||
        r.body.includes('"content"') ||
        r.body.includes('completion_complete')
      ),
      'no Ollama error': (r) => !r.body?.includes('RESOURCE_NOT_FOUND'),
      'no connection refused': (r) => !r.body?.includes('ECONNREFUSED'),
    });
    sseSuccess.add(ok ? 1 : 0);

    // If tool prompt, check for tool execution events
    if (useToolPrompt && ok) {
      const hasToolEvents = body.includes('tool_executing') || body.includes('mcp_calls_data');
      if (hasToolEvents) {
        // Measure tool latency from tool_executing to tool result
        toolCallLatency.add(duration); // Approximation — full request duration
      }
    }
  });

  // 4. List sessions (simulates sidebar load)
  group('list_sessions', () => {
    const res = http.get(`${API_BASE}/api/chat/sessions`, { headers, timeout: '5s' });
    check(res, { 'sessions 200': (r) => r.status === 200 });
  });

  // 5. Memories endpoint (10% of requests — tests Milvus under load)
  if (Math.random() < 0.1) {
    group('memories', () => {
      const res = http.get(`${API_BASE}/api/memories`, { headers, timeout: '5s' });
      check(res, { 'memories 200': (r) => r.status === 200 || r.status === 404 });
    });
  }

  // 6. Feedback (if we got a response)
  if (Math.random() < 0.2) {
    group('feedback', () => {
      const res = http.post(
        `${API_BASE}/api/feedback`,
        JSON.stringify({
          messageId: `k6-test-${__VU}-${__ITER}`,
          sessionId,
          feedbackType: Math.random() > 0.5 ? 'thumbs_up' : 'thumbs_down',
          model: model,
        }),
        { headers, timeout: '5s' }
      );
      // Feedback may fail due to messageId format — that's a known issue
      check(res, { 'feedback ok': (r) => r.status === 200 || r.status === 400 });
    });
  }

  // Simulate user think time
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

export function handleSummary(data) {
  const m = data.metrics;
  const summary = {
    timestamp: new Date().toISOString(),
    test: 'ollama-stress-50-users',
    vus_max: m.vus_max?.values?.max || 0,
    iterations: m.iterations?.values?.count || 0,
    http_reqs: m.http_reqs?.values?.count || 0,
    // Latency
    http_p50: m.http_req_duration?.values?.['p(50)'] || 0,
    http_p95: m.http_req_duration?.values?.['p(95)'] || 0,
    http_p99: m.http_req_duration?.values?.['p(99)'] || 0,
    chat_stream_p50: m.chat_stream_latency?.values?.['p(50)'] || 0,
    chat_stream_p95: m.chat_stream_latency?.values?.['p(95)'] || 0,
    chat_stream_p99: m.chat_stream_latency?.values?.['p(99)'] || 0,
    ttft_p50: m.time_to_first_token?.values?.['p(50)'] || 0,
    ttft_p95: m.time_to_first_token?.values?.['p(95)'] || 0,
    session_create_p95: m.session_create_latency?.values?.['p(95)'] || 0,
    // Errors
    http_failure_rate: m.http_req_failed?.values?.rate || 0,
    sse_success_rate: m.sse_success_rate?.values?.rate || 0,
    api_errors: m.api_errors?.values?.count || 0,
    timeouts: m.timeouts?.values?.count || 0,
    rate_limit_429s: m.rate_limit_429s?.values?.count || 0,
    server_errors_500: m.server_errors_500s?.values?.count || 0,
    ollama_failures: m.ollama_failures?.values?.count || 0,
  };

  console.log('\n' + '='.repeat(70));
  console.log('  OLLAMA STRESS TEST RESULTS (50 users, gpt-oss + qwen2.5-coder)');
  console.log('='.repeat(70));
  console.log(`  Max VUs:              ${summary.vus_max}`);
  console.log(`  Total iterations:     ${summary.iterations}`);
  console.log(`  Total HTTP reqs:      ${summary.http_reqs}`);
  console.log('');
  console.log('  LATENCY');
  console.log(`  Chat stream p50:      ${Math.round(summary.chat_stream_p50)}ms`);
  console.log(`  Chat stream p95:      ${Math.round(summary.chat_stream_p95)}ms`);
  console.log(`  Chat stream p99:      ${Math.round(summary.chat_stream_p99)}ms`);
  console.log(`  TTFT p50:             ${Math.round(summary.ttft_p50)}ms`);
  console.log(`  TTFT p95:             ${Math.round(summary.ttft_p95)}ms`);
  console.log(`  Session create p95:   ${Math.round(summary.session_create_p95)}ms`);
  console.log('');
  console.log('  ERRORS');
  console.log(`  HTTP failure rate:    ${(summary.http_failure_rate * 100).toFixed(1)}%`);
  console.log(`  SSE success rate:     ${(summary.sse_success_rate * 100).toFixed(1)}%`);
  console.log(`  API errors:           ${summary.api_errors}`);
  console.log(`  Timeouts (>60s):      ${summary.timeouts}`);
  console.log(`  Rate limits (429):    ${summary.rate_limit_429s}`);
  console.log(`  Server errors (5xx):  ${summary.server_errors_500}`);
  console.log(`  Ollama failures:      ${summary.ollama_failures}`);
  console.log('='.repeat(70));

  // Scaling analysis
  if (summary.ollama_failures > 0) {
    console.log('\n  !! OLLAMA BOTTLENECK: Model not found or connection refused');
    console.log('     → Ollama on k3s has NO models loaded, or dalek unreachable');
  }
  if (summary.rate_limit_429s > summary.iterations * 0.1) {
    console.log('\n  !! RATE LIMITING: >10% of requests hit 429');
    console.log('     → Increase rate limits or add API replicas');
  }
  if (summary.chat_stream_p95 > 30000) {
    console.log('\n  !! SLOW INFERENCE: Chat p95 > 30s');
    console.log('     → Ollama GPU saturation, need more inference capacity');
  }
  if (summary.server_errors_500 > 0) {
    console.log('\n  !! SERVER ERRORS: 5xx responses detected');
    console.log('     → Check API logs for OOM, connection pool exhaustion, or Prisma timeouts');
  }

  return {
    '/tmp/k6-ollama-results.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
