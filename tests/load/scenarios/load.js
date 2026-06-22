/**
 * k6 Load Test for OpenAgentic
 *
 * Simulates realistic concurrent user load (10 users, ramping pattern).
 * Tests chat sessions, session management, and API endpoints under sustained load.
 *
 * Run: BASE_URL=http://localhost:8080 API_KEY=awc_xxx ~/bin/k6 run tests/load/scenarios/load.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const chatLatency = new Trend('chat_latency', true);
const sessionCreateLatency = new Trend('session_create_latency', true);
const sessionListLatency = new Trend('session_list_latency', true);
const healthLatency = new Trend('health_latency', true);
const successfulChats = new Counter('successful_chats');
const failedChats = new Counter('failed_chats');
const totalRequests = new Counter('total_requests');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const API_KEY = __ENV.API_KEY || '';

// Ramp pattern: 0 → 5 → 10 → 10 (sustained) → 0
export const options = {
  stages: [
    { duration: '30s', target: 3 },   // Warm up
    { duration: '1m', target: 5 },    // Ramp to 5
    { duration: '1m', target: 10 },   // Ramp to 10
    { duration: '3m', target: 10 },   // Sustain 10 users
    { duration: '1m', target: 5 },    // Cool down
    { duration: '30s', target: 0 },   // Drain
  ],
  thresholds: {
    errors: ['rate<0.2'],                    // Less than 20% error rate
    chat_latency: ['p(95)<60000'],           // 95% of chats under 60s
    session_create_latency: ['p(95)<5000'],  // 95% of session creates under 5s
    health_latency: ['p(95)<2000'],          // 95% of health checks under 2s
    successful_chats: ['count>20'],          // At least 20 successful chats
  },
};

const chatPrompts = [
  'What is the capital of France? One sentence.',
  'What is 2+2? One word answer.',
  'Name three programming languages.',
  'What does HTTP stand for?',
  'What is Kubernetes in one sentence?',
  'What is the speed of light?',
  'Name the planets in our solar system.',
  'What is Docker? Brief answer.',
  'Explain REST API in one sentence.',
  'What year was JavaScript created?',
];

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
  };
}

export function setup() {
  if (!API_KEY) {
    throw new Error('API_KEY environment variable is required');
  }

  // Pre-flight checks
  const healthRes = http.get(`${BASE_URL}/api/health`);
  const ok = check(healthRes, {
    'API healthy': (r) => r.status === 200,
  });
  if (!ok) {
    throw new Error(`API not healthy: ${healthRes.status}`);
  }

  const authRes = http.get(`${BASE_URL}/api/chat/sessions`, { headers: authHeaders() });
  check(authRes, { 'Auth valid': (r) => r.status === 200 });

  console.log(`Load test starting against ${BASE_URL}`);
  console.log(`Target: 10 concurrent VUs, ~7 min total`);
  return { baseUrl: BASE_URL };
}

export default function (data) {
  // Each VU iteration does one full user journey:
  // 1. Health check
  // 2. List sessions
  // 3. Create session
  // 4. Send 1-3 chat messages
  // 5. Delete session

  // Weighted random: 70% chat journey, 20% session management, 10% health spam
  const roll = Math.random();
  if (roll < 0.7) {
    chatJourney(data);
  } else if (roll < 0.9) {
    sessionManagement(data);
  } else {
    healthCheck(data);
  }

  // Think time between iterations
  sleep(Math.random() * 2 + 1);
}

function chatJourney(data) {
  group('chat_journey', function () {
    totalRequests.add(1);

    // Create session
    const createStart = Date.now();
    const sessionRes = http.post(
      `${data.baseUrl}/api/chat/sessions`,
      JSON.stringify({ title: `k6-load-${__VU}-${Date.now()}` }),
      { headers: authHeaders(), timeout: '10s' }
    );
    sessionCreateLatency.add(Date.now() - createStart);
    totalRequests.add(1);

    const sessionOk = check(sessionRes, {
      'session created': (r) => r.status === 200 || r.status === 201,
    });

    if (!sessionOk) {
      errorRate.add(1);
      failedChats.add(1);
      console.error(`VU${__VU}: Session create failed: ${sessionRes.status}`);
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

    sleep(0.5);

    // Send 1-3 messages in this session
    const numMessages = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numMessages; i++) {
      const prompt = chatPrompts[Math.floor(Math.random() * chatPrompts.length)];

      const chatStart = Date.now();
      const chatRes = http.post(
        `${data.baseUrl}/api/chat/stream`,
        JSON.stringify({
          sessionId: sessionId,
          message: prompt,
        }),
        {
          headers: {
            ...authHeaders(),
            'Accept': 'text/event-stream',
          },
          timeout: '90s',
        }
      );
      const chatDuration = Date.now() - chatStart;
      chatLatency.add(chatDuration);
      totalRequests.add(1);

      const chatOk = check(chatRes, {
        'chat 200': (r) => r.status === 200,
        'chat has data': (r) => r.body && r.body.length > 50,
        'chat has SSE events': (r) => r.body && r.body.includes('data:'),
      });

      if (chatOk) {
        successfulChats.add(1);
      } else {
        failedChats.add(1);
        errorRate.add(1);
        console.error(`VU${__VU}: Chat failed (${chatDuration}ms): status=${chatRes.status} body_len=${chatRes.body?.length}`);
      }

      // Wait between messages in same session (simulates user reading + typing)
      if (i < numMessages - 1) {
        sleep(Math.random() * 3 + 2);
      }
    }

    // Cleanup
    http.del(`${data.baseUrl}/api/chat/sessions/${sessionId}`, null, {
      headers: authHeaders(),
      timeout: '5s',
    });
  });
}

function sessionManagement(data) {
  group('session_management', function () {
    // List sessions
    const listStart = Date.now();
    const listRes = http.get(`${data.baseUrl}/api/chat/sessions`, {
      headers: authHeaders(),
      timeout: '10s',
    });
    sessionListLatency.add(Date.now() - listStart);
    totalRequests.add(1);

    check(listRes, {
      'sessions list 200': (r) => r.status === 200,
      'sessions is array': (r) => {
        try { return Array.isArray(r.json().sessions || r.json()); } catch { return false; }
      },
    });

    sleep(1);

    // Create and immediately delete a session
    const createRes = http.post(
      `${data.baseUrl}/api/chat/sessions`,
      JSON.stringify({ title: `k6-ephemeral-${Date.now()}` }),
      { headers: authHeaders(), timeout: '5s' }
    );
    totalRequests.add(1);

    if (createRes.status === 200 || createRes.status === 201) {
      try {
        const body = createRes.json();
        const id = body.session?.id || body.id;
        if (id) {
          sleep(0.5);
          http.del(`${data.baseUrl}/api/chat/sessions/${id}`, null, {
            headers: authHeaders(),
            timeout: '5s',
          });
          totalRequests.add(1);
        }
      } catch {}
    }
  });
}

function healthCheck(data) {
  group('health_check', function () {
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      const res = http.get(`${data.baseUrl}/api/health`);
      healthLatency.add(Date.now() - start);
      totalRequests.add(1);

      const ok = check(res, {
        'health 200': (r) => r.status === 200,
      });
      errorRate.add(!ok);

      sleep(0.5);
    }
  });
}

export function teardown() {
  console.log('Load test completed');
}
