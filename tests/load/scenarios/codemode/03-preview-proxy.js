/**
 * Scenario 03 — preview-proxy (10 concurrent paths)
 *
 * 10 VUs hammer the path-proxy at /api/code/preview/<sid>/<port>/. Each
 * VU spawns a session, asks the agent to start a tiny `python -m http.server`
 * on a unique port, waits for the daemon to auto-announce it, then GETs
 * that port through the proxy in a tight loop for ~2 minutes. Stresses:
 *
 *   - The Fastify proxy fetch path (request rewrite + WS upgrade probe)
 *   - The frame-lock header injection cost
 *   - The openagentic-api → runner-pod NetworkPolicy egress (chart fix #c5896d2)
 *   - The new daemon port-rescanner (auto-announce of the http.server boot)
 *   - The Service spec port-list expansion (8000 needs to be reachable)
 *
 * Failure modes:
 *   - 502 upstream unreachable (Service port missing OR podHost not announced)
 *   - 403 port_not_announced (rescanner failed to fire)
 *   - p95 proxy latency > 1s (proxy overhead unacceptable for inline preview)
 *
 * Run:
 *   BASE_URL=https://chat.example.com API_KEY=awc_xxx \
 *   k6 run tests/load/scenarios/codemode/03-preview-proxy.js
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

const cmProxyLatency = new Trend('cm_proxy_latency', true);
const cmProxyErrors = new Rate('cm_proxy_errors');
const cmProxy200 = new Counter('cm_proxy_200');
const cmProxy403 = new Counter('cm_proxy_403_port_not_announced');
const cmProxy502 = new Counter('cm_proxy_502_upstream');
const cmProxyOther = new Counter('cm_proxy_other');

export const options = {
  scenarios: {
    proxy: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 }, // ramp
        { duration: '2m', target: 10 }, // sustain
        { duration: '15s', target: 0 }, // drain
      ],
      gracefulStop: '60s',
    },
  },
  thresholds: {
    cm_proxy_latency: ['p(95)<1000'], // proxy overhead under 1s for static GET
    cm_proxy_errors: ['rate<0.1'],
    cm_proxy_403_port_not_announced: ['count<10'], // rescanner should catch ≥90% within the test window
  },
};

export function setup() {
  return preflight();
}

export default function () {
  const sess = spawnCodemodeSession('proxy');
  if (!sess.ok) {
    cmProxyErrors.add(1);
    return;
  }
  const sid = sess.sessionId;
  // Pick a per-VU port so VUs don't fight for the same `python -m http.server`.
  // Range 4500-4509 stays well clear of standard dev ports + the Service
  // expansion list — the rescanner is our test subject for these.
  const port = 4500 + (__VU % 10);

  // Ask the agent to start an http.server in the background. The chat
  // endpoint will block waiting for the agent to respond — but the http
  // server is detached so the response returns once the agent posts the
  // command. In a real session the agent would surface this naturally.
  const startMsg = `Run this in the background and don't wait: cd /tmp && (python3 -m http.server ${port} &) && sleep 1 && echo started`;
  http.post(
    `${BASE_URL}/api/chat/stream`,
    JSON.stringify({ sessionId: sid, message: startMsg }),
    {
      headers: authHeaders({ Accept: 'text/event-stream' }),
      timeout: '60s',
    },
  );

  // Give the daemon's rescanner one cycle (30s tick) PLUS the agent boot.
  // We poll the proxy URL — first response either 200 (announced & up),
  // 403 (port not announced yet), or 502 (announced but upstream unreachable).
  const url = `${BASE_URL}/api/code/preview/${sid}/${port}/`;
  // Allow up to 45s for the rescanner to pick it up.
  let announced = false;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const r = http.get(url, { headers: authHeaders(), timeout: '5s' });
    if (r.status === 200) {
      announced = true;
      break;
    }
    sleep(3);
  }

  if (!announced) {
    // Don't bail — record the failure mode and keep going so we get
    // throughput data on whatever IS responding. (Most likely: 403.)
    console.warn(`VU${__VU}: port ${port} never reached 200 within 45s`);
  }

  // Hammer the URL for the rest of the iteration window.
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    const r = http.get(url, { headers: authHeaders(), timeout: '5s' });
    cmProxyLatency.add(Date.now() - start);
    if (r.status === 200) {
      cmProxy200.add(1);
      cmProxyErrors.add(0);
    } else if (r.status === 403) {
      cmProxy403.add(1);
      cmProxyErrors.add(1);
    } else if (r.status === 502) {
      cmProxy502.add(1);
      cmProxyErrors.add(1);
    } else {
      cmProxyOther.add(1);
      cmProxyErrors.add(1);
    }
    sleep(0.5);
  }

  killCodemodeSession(sid);
}
