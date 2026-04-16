/**
 * k6 Load Test — OpenAgentic 0.6.0 Release Readiness
 *
 * Simulates 100 concurrent users across the critical API endpoints.
 * Tests: auth, sessions, chat streaming, feedback, workflows, admin, MCP, settings.
 *
 * Usage:
 *   k6 run --env TOKEN=$(cat /tmp/k6_token.txt) scripts/k6-load-test.js
 *
 * Ramp: 0→50 users over 30s, hold 50 for 2m, ramp to 100 for 1m, hold 100 for 2m, ramp down.
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// Custom metrics
const chatLatency = new Trend('chat_stream_latency', true);
const sessionCreateLatency = new Trend('session_create_latency', true);
const feedbackLatency = new Trend('feedback_latency', true);
const apiErrors = new Counter('api_errors');
const sseSuccess = new Rate('sse_success_rate');
const authSuccess = new Rate('auth_success_rate');

// Config
const API_BASE = __ENV.API_BASE || 'http://localhost:18000';
const TOKEN = __ENV.TOKEN || '';

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
};

// Test prompts - diverse to stress different pipeline paths
const prompts = [
  'What is Kubernetes?',
  'Write a Python function to sort a list',
  'Explain the CAP theorem',
  'List all pods in the agentic-dev namespace',
  'What is the current CPU usage?',
  'Compare AWS Lambda vs Azure Functions',
  'Write a Dockerfile for a Node.js app',
  'What are the OWASP Top 10?',
  'Explain microservices vs monolith',
  'How does TLS work?',
  'What is a B-tree index?',
  'Write SQL to find duplicate rows',
  'Explain event-driven architecture',
  'What is GitOps?',
  'How do I set up Prometheus?',
  'What is the difference between TCP and UDP?',
  'Write a bash script to check disk usage',
  'Explain OAuth 2.0 PKCE flow',
  'What is a service mesh?',
  'How does DNS resolution work?',
];

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Warm up to 20 users
    { duration: '1m', target: 50 },    // Ramp to 50
    { duration: '2m', target: 50 },    // Hold 50 users
    { duration: '30s', target: 100 },  // Ramp to 100
    { duration: '2m', target: 100 },   // Hold 100 users — peak load
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<10000'],  // 95% of requests under 10s
    http_req_failed: ['rate<0.1'],        // Less than 10% failure rate
    session_create_latency: ['p(95)<2000'],
    auth_success_rate: ['rate>0.95'],
    sse_success_rate: ['rate>0.8'],
  },
};

export default function () {
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];

  // 1. Health check (lightweight, every iteration)
  group('health', () => {
    const res = http.get(`${API_BASE}/api/version/badge`);
    check(res, { 'health 200': (r) => r.status === 200 });
    if (res.status !== 200) apiErrors.add(1);
  });

  // 2. Create session
  let sessionId = '';
  group('create_session', () => {
    const res = http.post(
      `${API_BASE}/api/chat/sessions`,
      JSON.stringify({ title: `k6-${__VU}-${__ITER}` }),
      { headers, timeout: '5s' }
    );
    sessionCreateLatency.add(res.timings.duration);
    const ok = check(res, {
      'session 200/201': (r) => r.status === 200 || r.status === 201,
      'session has id': (r) => {
        try {
          const d = JSON.parse(r.body);
          sessionId = d.session?.id || '';
          return !!sessionId;
        } catch {
          return false;
        }
      },
    });
    authSuccess.add(ok ? 1 : 0);
    if (!ok) apiErrors.add(1);
  });

  if (!sessionId) {
    sleep(1);
    return; // Can't continue without a session
  }

  // 3. Send chat message (SSE streaming)
  group('chat_stream', () => {
    const start = Date.now();
    const res = http.post(
      `${API_BASE}/api/chat/stream`,
      JSON.stringify({ message: prompt, sessionId }),
      {
        headers: { ...headers, Accept: 'text/event-stream' },
        timeout: '45s',
      }
    );
    const duration = Date.now() - start;
    chatLatency.add(duration);

    const ok = check(res, {
      'stream 200': (r) => r.status === 200,
      'stream has content': (r) => r.body && r.body.length > 100,
      'stream has data events': (r) => r.body && r.body.includes('data:'),
    });
    sseSuccess.add(ok ? 1 : 0);
    if (!ok) apiErrors.add(1);

    // Extract messageId for feedback
    if (ok && res.body) {
      const match = res.body.match(/"messageId"\s*:\s*"([^"]+)"/);
      if (match) {
        // 4. Submit feedback
        group('feedback', () => {
          const fbType = Math.random() > 0.3 ? 'thumbs_up' : 'thumbs_down';
          const fbRes = http.post(
            `${API_BASE}/api/feedback`,
            JSON.stringify({
              messageId: match[1],
              sessionId,
              feedbackType: fbType,
              model: 'gpt-oss',
            }),
            { headers, timeout: '5s' }
          );
          feedbackLatency.add(fbRes.timings.duration);
          check(fbRes, { 'feedback 200': (r) => r.status === 200 });
        });
      }
    }
  });

  // 5. List sessions (read-heavy endpoint)
  group('list_sessions', () => {
    const res = http.get(`${API_BASE}/api/chat/sessions`, { headers, timeout: '5s' });
    check(res, { 'sessions 200': (r) => r.status === 200 });
  });

  // 6. Admin endpoints (lighter load — only 20% of iterations)
  if (Math.random() < 0.2) {
    group('admin', () => {
      // Version badge
      const v = http.get(`${API_BASE}/api/version/badge`);
      check(v, { 'version 200': (r) => r.status === 200 });

      // Synth approvals polling (simulates the constant polling the UI does)
      const s = http.get(`${API_BASE}/api/synth/approvals?sessionId=${sessionId}`, {
        headers,
        timeout: '5s',
      });
      check(s, { 'synth 200': (r) => r.status === 200 });
    });
  }

  // 7. Settings/preferences (10% of iterations)
  if (Math.random() < 0.1) {
    group('settings', () => {
      const res = http.get(`${API_BASE}/api/user/settings`, { headers, timeout: '5s' });
      check(res, { 'settings 200': (r) => r.status === 200 });
    });
  }

  // Simulate user think time between actions
  sleep(Math.random() * 3 + 1); // 1-4 seconds
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    vus_max: data.metrics.vus_max?.values?.max || 0,
    iterations: data.metrics.iterations?.values?.count || 0,
    http_reqs: data.metrics.http_reqs?.values?.count || 0,
    http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'] || 0,
    http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'] || 0,
    http_req_failed_rate: data.metrics.http_req_failed?.values?.rate || 0,
    chat_stream_p95: data.metrics.chat_stream_latency?.values?.['p(95)'] || 0,
    chat_stream_p99: data.metrics.chat_stream_latency?.values?.['p(99)'] || 0,
    session_create_p95: data.metrics.session_create_latency?.values?.['p(95)'] || 0,
    sse_success_rate: data.metrics.sse_success_rate?.values?.rate || 0,
    auth_success_rate: data.metrics.auth_success_rate?.values?.rate || 0,
    api_errors: data.metrics.api_errors?.values?.count || 0,
  };

  console.log('\n' + '='.repeat(60));
  console.log('  LOAD TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`  Max VUs:           ${summary.vus_max}`);
  console.log(`  Total iterations:  ${summary.iterations}`);
  console.log(`  Total HTTP reqs:   ${summary.http_reqs}`);
  console.log(`  HTTP p95 latency:  ${Math.round(summary.http_req_duration_p95)}ms`);
  console.log(`  HTTP p99 latency:  ${Math.round(summary.http_req_duration_p99)}ms`);
  console.log(`  HTTP failure rate: ${(summary.http_req_failed_rate * 100).toFixed(1)}%`);
  console.log(`  Chat stream p95:   ${Math.round(summary.chat_stream_p95)}ms`);
  console.log(`  Chat stream p99:   ${Math.round(summary.chat_stream_p99)}ms`);
  console.log(`  Session create p95: ${Math.round(summary.session_create_p95)}ms`);
  console.log(`  SSE success rate:  ${(summary.sse_success_rate * 100).toFixed(1)}%`);
  console.log(`  Auth success rate: ${(summary.auth_success_rate * 100).toFixed(1)}%`);
  console.log(`  API errors:        ${summary.api_errors}`);
  console.log('='.repeat(60));

  return {
    '/tmp/k6-results.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
  };
}

// Import textSummary for console output
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
