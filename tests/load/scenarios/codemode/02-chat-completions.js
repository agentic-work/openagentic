/**
 * Scenario 02 — chat-completions (10 users sustained)
 *
 * 10 VUs each spawn a session, then send a steady stream of chat messages
 * for ~3 minutes. Each VU sends 1 prompt, waits for the SSE to drain, sleeps
 * 2-5s, repeats. Stresses:
 *   - Smart Router cascade (intent classifier → tool ranker → provider)
 *   - Redis intent-cache (cold for first prompt per VU, warm thereafter)
 *   - Milvus tool-search vector lookup under concurrent load
 *   - Provider connection pool (Anthropic/OpenAI/Bedrock fan-out)
 *   - SSE streaming (no buffering, chunked transfer)
 *
 * Failure modes:
 *   - p95 chat latency > 60s (router cascade stalled)
 *   - 5xx from /api/chat/stream (provider 429 or socket exhaustion)
 *   - SSE connection drops mid-stream
 *
 * Run:
 *   BASE_URL=https://chat-dev.openagentic.io API_KEY=awc_xxx \
 *   k6 run tests/load/scenarios/codemode/02-chat-completions.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import {
  BASE_URL,
  authHeaders,
  preflight,
  spawnCodemodeSession,
  killCodemodeSession,
} from './_lib.js';

const cmChatLatency = new Trend('cm_chat_latency', true);
const cmChatErrors = new Rate('cm_chat_errors');
const cmChatSuccess = new Counter('cm_chat_success');
const cmChatFailures = new Counter('cm_chat_failures');

export const options = {
  scenarios: {
    chat: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 5 }, // gentle ramp to half
        { duration: '20s', target: 10 }, // full 10
        { duration: '3m', target: 10 }, // sustain
        { duration: '20s', target: 0 }, // drain
      ],
      gracefulStop: '60s',
    },
  },
  thresholds: {
    cm_chat_latency: ['p(95)<60000'],
    cm_chat_errors: ['rate<0.15'],
    cm_chat_success: ['count>=30'],
  },
};

const PROMPTS = [
  'Run `ls -la` and tell me what you see.',
  'Read package.json and summarise the dev dependencies.',
  'What does the codemode preview proxy do? One sentence.',
  'Grep for TODO in the workspace, just tell me the count.',
  'List the files in the current directory.',
  'What language is this project written in?',
  'Show me the last commit message.',
  'How many files are in node_modules? Use a one-line bash.',
];

export function setup() {
  return preflight();
}

export default function () {
  // Each VU spawns ONE session for its lifetime to avoid melting the
  // spawn path; chat-completions is what we're stressing here.
  const sess = spawnCodemodeSession('chat');
  if (!sess.ok) {
    cmChatErrors.add(1);
    cmChatFailures.add(1);
    return;
  }
  const sid = sess.sessionId;
  // Loop for the duration of the iteration. k6 will tear us down at scenario end.
  for (let i = 0; i < 6; i++) {
    const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/chat/stream`,
      JSON.stringify({ sessionId: sid, message: prompt }),
      {
        headers: authHeaders({ Accept: 'text/event-stream' }),
        timeout: '90s',
      },
    );
    cmChatLatency.add(Date.now() - start);
    const ok = check(res, {
      'chat 2xx': (r) => r.status >= 200 && r.status < 300,
      'chat has body': (r) => r.body && r.body.length > 0,
    });
    if (ok) {
      cmChatSuccess.add(1);
      cmChatErrors.add(0);
    } else {
      cmChatFailures.add(1);
      cmChatErrors.add(1);
    }
    sleep(2 + Math.random() * 3);
  }
  killCodemodeSession(sid);
}
