/**
 * k6 Extreme Stress Test for OpenAgentic - 1000 Concurrent Users
 *
 * Tests AKS autoscaling behavior under extreme load.
 * Ramps from 0 → 1000 VUs over ~20 minutes, then sustains for 5 min.
 *
 * PREREQUISITES:
 *   - AKS cluster autoscaler enabled (min 2, max 6 nodes)
 *   - HPA enabled for API (max 10), MCP proxy (max 8), UI (max 5)
 *   - API key with premium rate limits (600/min, 10k/hour, burst 100)
 *
 * Run: BASE_URL=https://dev.openagentic.io API_KEY=awc_xxx ~/bin/k6 run tests/load/scenarios/stress-1000.js
 *
 * MONITORING (run in parallel):
 *   kubectl get hpa -n agentic-dev -w
 *   kubectl top pods -n agentic-dev --sort-by=cpu
 *   kubectl get nodes -w
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const chatLatency = new Trend('chat_latency', true);
const sessionCreateLatency = new Trend('session_create_latency', true);
const healthLatency = new Trend('health_latency', true);
const successfulChats = new Counter('successful_chats');
const failedChats = new Counter('failed_chats');
const totalRequests = new Counter('total_requests');
const http429s = new Counter('rate_limited_requests');
const http503s = new Counter('service_unavailable');
const activeVUs = new Gauge('active_vus_gauge');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://dev.openagentic.io';
const API_KEY = __ENV.API_KEY || '';

// Aggressive ramp to 1000 VUs
export const options = {
  stages: [
    { duration: '1m', target: 10 },     // Phase 1: Warm up
    { duration: '2m', target: 50 },     // Phase 2: Moderate (should trigger first HPA)
    { duration: '2m', target: 100 },    // Phase 3: Heavy (API pods scaling)
    { duration: '2m', target: 250 },    // Phase 4: Stress (MCP proxy scaling)
    { duration: '2m', target: 500 },    // Phase 5: Extreme (node autoscaler kicks in?)
    { duration: '3m', target: 1000 },   // Phase 6: Maximum load
    { duration: '5m', target: 1000 },   // Phase 7: Sustain peak
    { duration: '3m', target: 0 },      // Phase 8: Cool down
  ],
  thresholds: {
    // Relaxed thresholds - we expect degradation at 1000 VUs
    errors: ['rate<0.6'],                    // Allow up to 60% errors (rate limiting expected)
    chat_latency: ['p(50)<60000'],           // 50% of chats under 60s
    successful_chats: ['count>100'],         // At least 100 successful chats total
  },
  // Don't abort on threshold breach - we want to see the full curve
  noVUConnectionReuse: false,
  insecureSkipTLSVerify: true,
};

const simplePrompts = [
  'What is 2+2?',
  'Hello.',
  'Name a color.',
  'What is HTTP?',
  'Hi there.',
  'What is 1+1?',
  'Yes or no?',
  'Name a fruit.',
];

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  };
}

export function setup() {
  if (!API_KEY) throw new Error('API_KEY required');

  const res = http.get(`${BASE_URL}/api/health`);
  const ok = check(res, { 'API healthy': (r) => r.status === 200 });
  if (!ok) throw new Error(`API not healthy: ${res.status}`);

  console.log('='.repeat(60));
  console.log('  1000-USER STRESS TEST');
  console.log(`  Target: ${BASE_URL}`);
  console.log('  Ramp: 0 → 10 → 50 → 100 → 250 → 500 → 1000 VUs');
  console.log('  Duration: ~20 min');
  console.log('  Monitor: kubectl get hpa -n agentic-dev -w');
  console.log('='.repeat(60));

  return { baseUrl: BASE_URL };
}

export default function (data) {
  activeVUs.add(__VU);

  // Weighted distribution:
  // 50% - full chat journey (create session + send message)
  // 30% - quick health checks (fast, tests infra capacity)
  // 15% - session management (CRUD load on DB)
  // 5% - heavy chat (multiple messages, tests sustained LLM load)
  const roll = Math.random();

  if (roll < 0.50) {
    quickChat(data);
  } else if (roll < 0.80) {
    healthSpam(data);
  } else if (roll < 0.95) {
    sessionCRUD(data);
  } else {
    multiTurnChat(data);
  }

  // Think time scales with VU count - more VUs = less wait to sustain pressure
  sleep(Math.random() * 2 + 0.5);
}

function quickChat(data) {
  group('quick_chat', function () {
    totalRequests.add(1);

    // Create session
    const createStart = Date.now();
    const sessionRes = http.post(
      `${data.baseUrl}/api/chat/sessions`,
      JSON.stringify({ title: `k6-1k-${__VU}-${Date.now()}` }),
      { headers: authHeaders(), timeout: '15s' }
    );
    sessionCreateLatency.add(Date.now() - createStart);
    totalRequests.add(1);

    if (sessionRes.status === 429) {
      http429s.add(1);
      errorRate.add(1);
      sleep(2); // Back off on rate limit
      return;
    }

    if (sessionRes.status >= 500) {
      http503s.add(1);
      errorRate.add(1);
      return;
    }

    if (sessionRes.status !== 200 && sessionRes.status !== 201) {
      errorRate.add(1);
      failedChats.add(1);
      return;
    }

    let sessionId;
    try {
      const body = sessionRes.json();
      sessionId = body.session?.id || body.id;
    } catch {
      errorRate.add(1);
      return;
    }

    // Send one quick message
    const prompt = simplePrompts[Math.floor(Math.random() * simplePrompts.length)];
    const chatStart = Date.now();
    const chatRes = http.post(
      `${data.baseUrl}/api/chat/stream`,
      JSON.stringify({ sessionId, message: prompt }),
      {
        headers: { ...authHeaders(), 'Accept': 'text/event-stream' },
        timeout: '120s',
      }
    );
    const dur = Date.now() - chatStart;
    chatLatency.add(dur);
    totalRequests.add(1);

    if (chatRes.status === 429) {
      http429s.add(1);
      errorRate.add(1);
    } else if (chatRes.status >= 500) {
      http503s.add(1);
      errorRate.add(1);
      failedChats.add(1);
    } else {
      const ok = check(chatRes, {
        'chat 200': (r) => r.status === 200,
        'chat has data': (r) => r.body && r.body.length > 10,
      });
      if (ok) {
        successfulChats.add(1);
      } else {
        failedChats.add(1);
        errorRate.add(1);
      }
    }

    // Cleanup (fire and forget)
    http.del(`${data.baseUrl}/api/chat/sessions/${sessionId}`, null, {
      headers: authHeaders(),
      timeout: '5s',
    });
  });
}

function healthSpam(data) {
  group('health_spam', function () {
    // Rapid health checks - tests raw HTTP capacity
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      const res = http.get(`${data.baseUrl}/api/health`);
      healthLatency.add(Date.now() - start);
      totalRequests.add(1);

      if (res.status === 429) http429s.add(1);
      if (res.status >= 500) http503s.add(1);

      check(res, { 'health ok': (r) => r.status === 200 });
      sleep(0.2);
    }
  });
}

function sessionCRUD(data) {
  group('session_crud', function () {
    // List sessions
    const listRes = http.get(`${data.baseUrl}/api/chat/sessions`, {
      headers: authHeaders(),
      timeout: '10s',
    });
    totalRequests.add(1);

    if (listRes.status === 429) { http429s.add(1); return; }

    // Create + delete
    const createRes = http.post(
      `${data.baseUrl}/api/chat/sessions`,
      JSON.stringify({ title: `k6-crud-${Date.now()}` }),
      { headers: authHeaders(), timeout: '10s' }
    );
    totalRequests.add(1);

    if (createRes.status === 200 || createRes.status === 201) {
      try {
        const body = createRes.json();
        const id = body.session?.id || body.id;
        if (id) {
          http.del(`${data.baseUrl}/api/chat/sessions/${id}`, null, {
            headers: authHeaders(), timeout: '5s',
          });
          totalRequests.add(1);
        }
      } catch {}
    }
  });
}

function multiTurnChat(data) {
  group('multi_turn_chat', function () {
    totalRequests.add(1);

    const sessionRes = http.post(
      `${data.baseUrl}/api/chat/sessions`,
      JSON.stringify({ title: `k6-multi-${__VU}-${Date.now()}` }),
      { headers: authHeaders(), timeout: '15s' }
    );
    totalRequests.add(1);

    if (sessionRes.status !== 200 && sessionRes.status !== 201) {
      errorRate.add(1);
      return;
    }

    let sessionId;
    try {
      const body = sessionRes.json();
      sessionId = body.session?.id || body.id;
    } catch { return; }

    // Send 3 messages
    for (let i = 0; i < 3; i++) {
      const prompt = simplePrompts[Math.floor(Math.random() * simplePrompts.length)];
      const chatStart = Date.now();
      const chatRes = http.post(
        `${data.baseUrl}/api/chat/stream`,
        JSON.stringify({ sessionId, message: prompt }),
        {
          headers: { ...authHeaders(), 'Accept': 'text/event-stream' },
          timeout: '120s',
        }
      );
      chatLatency.add(Date.now() - chatStart);
      totalRequests.add(1);

      if (chatRes.status === 200) {
        successfulChats.add(1);
      } else {
        if (chatRes.status === 429) http429s.add(1);
        if (chatRes.status >= 500) http503s.add(1);
        failedChats.add(1);
        errorRate.add(1);
        break; // Stop this session on error
      }

      sleep(Math.random() * 2 + 1);
    }

    // Cleanup
    http.del(`${data.baseUrl}/api/chat/sessions/${sessionId}`, null, {
      headers: authHeaders(), timeout: '5s',
    });
  });
}

export function teardown() {
  console.log('='.repeat(60));
  console.log('  1000-USER STRESS TEST COMPLETE');
  console.log('  Check scaling events:');
  console.log('    kubectl get hpa -n agentic-dev');
  console.log('    kubectl get events -n agentic-dev --sort-by=.lastTimestamp | tail -30');
  console.log('    kubectl get nodes');
  console.log('='.repeat(60));
}
