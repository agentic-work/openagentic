/**
 * k6 Stress Test for OpenAgentic
 *
 * Pushes the system past normal load to find breaking points.
 * Ramps from 5 → 50 VUs over ~15 minutes.
 *
 * Run: BASE_URL=https://dev.openagentic.io API_KEY=awc_xxx ~/bin/k6 run tests/load/scenarios/stress.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const chatLatency = new Trend('chat_latency', true);
const sessionLatency = new Trend('session_latency', true);
const successfulChats = new Counter('successful_chats');
const failedChats = new Counter('failed_chats');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'https://dev.openagentic.io';
const API_KEY = __ENV.API_KEY || '';

export const options = {
  stages: [
    { duration: '1m', target: 5 },    // Warm up
    { duration: '2m', target: 10 },   // Normal load
    { duration: '2m', target: 20 },   // Above normal
    { duration: '2m', target: 30 },   // Heavy load
    { duration: '2m', target: 50 },   // Stress
    { duration: '1m', target: 50 },   // Sustain stress
    { duration: '2m', target: 0 },    // Recovery
  ],
  thresholds: {
    errors: ['rate<0.4'],                  // Allow up to 40% errors under stress
    chat_latency: ['p(95)<120000'],        // 95% under 2 min
    successful_chats: ['count>30'],        // At least 30 successful
  },
};

const prompts = [
  'What is 2+2?',
  'Name three colors.',
  'What is the capital of Japan?',
  'Hello, how are you?',
  'What is HTTP?',
  'Name a programming language.',
  'What day is today?',
  'What is AI?',
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
  check(res, { 'API healthy': (r) => r.status === 200 });
  console.log(`Stress test: ${BASE_URL}, ramping 5→50 VUs over ~12 min`);
  return { baseUrl: BASE_URL };
}

export default function (data) {
  // Create session
  const sessionStart = Date.now();
  const sessionRes = http.post(
    `${data.baseUrl}/api/chat/sessions`,
    JSON.stringify({ title: `k6-stress-${__VU}-${Date.now()}` }),
    { headers: authHeaders(), timeout: '10s' }
  );
  sessionLatency.add(Date.now() - sessionStart);

  if (sessionRes.status !== 200 && sessionRes.status !== 201) {
    errorRate.add(1);
    failedChats.add(1);
    sleep(Math.random() * 2 + 1);
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

  // Send one chat message
  const prompt = prompts[Math.floor(Math.random() * prompts.length)];
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

  const ok = check(chatRes, {
    'chat 200': (r) => r.status === 200,
    'chat has content': (r) => r.body && r.body.length > 10,
  });

  if (ok) {
    successfulChats.add(1);
  } else {
    failedChats.add(1);
    errorRate.add(1);
  }

  // Cleanup
  http.del(`${data.baseUrl}/api/chat/sessions/${sessionId}`, null, {
    headers: authHeaders(),
    timeout: '5s',
  });

  sleep(Math.random() * 3 + 1);
}

export function teardown() {
  console.log('Stress test completed');
}
