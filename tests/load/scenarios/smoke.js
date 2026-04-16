/**
 * k6 Smoke Test for OpenAgentic
 *
 * Quick verification that the system works under minimal load.
 * Run: BASE_URL=https://dev.openagentic.io API_KEY=awc_xxx ~/bin/k6 run tests/load/scenarios/smoke.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const chatLatency = new Trend('chat_latency');
const healthLatency = new Trend('health_latency');
const sessionLatency = new Trend('session_latency');
const successfulChats = new Counter('successful_chats');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://dev.openagentic.io';
const API_KEY = __ENV.API_KEY || '';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    errors: ['rate<0.1'],
    health_latency: ['p(95)<1000'],
    chat_latency: ['p(95)<45000'],
    session_latency: ['p(95)<3000'],
  },
};

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  };
}

export function setup() {
  if (!API_KEY) {
    console.error('API_KEY environment variable is required');
  }

  // Verify API is reachable
  const res = http.get(`${BASE_URL}/api/health`);
  const ok = check(res, {
    'API is reachable': (r) => r.status === 200,
    'API reports healthy': (r) => {
      try { return r.json().status === 'healthy'; } catch { return false; }
    },
  });
  if (!ok) {
    console.error(`API health check failed: ${res.status} ${res.body}`);
  }

  // Verify auth works
  const authRes = http.get(`${BASE_URL}/api/chat/sessions`, { headers: authHeaders() });
  const authOk = check(authRes, {
    'Auth works': (r) => r.status === 200,
  });
  if (!authOk) {
    console.error(`Auth check failed: ${authRes.status} ${authRes.body}`);
  }

  return { baseUrl: BASE_URL };
}

export default function (data) {
  // 1. Health check
  const healthStart = Date.now();
  const healthRes = http.get(`${data.baseUrl}/api/health`);
  healthLatency.add(Date.now() - healthStart);

  const healthOk = check(healthRes, {
    'health status 200': (r) => r.status === 200,
    'health body valid': (r) => {
      try { return r.json().status !== undefined; } catch { return false; }
    },
  });
  errorRate.add(!healthOk);
  sleep(1);

  // 2. Create a chat session
  const sessionStart = Date.now();
  const sessionRes = http.post(
    `${data.baseUrl}/api/chat/sessions`,
    JSON.stringify({ title: `k6-smoke-${Date.now()}` }),
    { headers: authHeaders(), timeout: '10s' }
  );
  sessionLatency.add(Date.now() - sessionStart);

  const sessionOk = check(sessionRes, {
    'session created': (r) => r.status === 200 || r.status === 201,
    'session has id': (r) => {
      try {
        const body = r.json();
        return (body.session?.id || body.id) !== undefined;
      } catch { return false; }
    },
  });
  errorRate.add(!sessionOk);

  if (!sessionOk) {
    console.error(`Session creation failed: ${sessionRes.status} ${sessionRes.body}`);
    return;
  }

  let sessionId;
  try {
    const body = sessionRes.json();
    sessionId = body.session?.id || body.id;
  } catch {
    return;
  }
  sleep(0.5);

  // 3. Send a simple chat message (SSE stream)
  const chatStart = Date.now();
  const chatRes = http.post(
    `${data.baseUrl}/api/chat/stream`,
    JSON.stringify({
      sessionId: sessionId,
      message: 'What is 2+2? Answer in one word.',
    }),
    {
      headers: {
        ...authHeaders(),
        'Accept': 'text/event-stream',
      },
      timeout: '60s',
    }
  );
  chatLatency.add(Date.now() - chatStart);

  const chatOk = check(chatRes, {
    'chat status 200': (r) => r.status === 200,
    'chat has content': (r) => r.body && r.body.length > 0,
    'chat has SSE events': (r) => r.body && r.body.includes('data:'),
  });

  if (chatOk) {
    successfulChats.add(1);
  }
  errorRate.add(!chatOk);

  if (!chatOk) {
    console.error(`Chat failed: ${chatRes.status} body_len=${chatRes.body?.length}`);
  }

  // 4. Cleanup - delete the session
  http.del(`${data.baseUrl}/api/chat/sessions/${sessionId}`, null, {
    headers: authHeaders(),
    timeout: '5s',
  });

  sleep(2);
}

export function teardown() {
  console.log('Smoke test completed');
}
