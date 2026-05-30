/**
 * Scenario 04 — ws-soak (10 long-held WebSocket connections)
 *
 * 10 VUs each open a WebSocket to /api/code/ws/events and HOLD it for the
 * scenario duration (~3 minutes). Stresses:
 *
 *   - ui-nginx WS upgrade path (the dedicated /api/code/ws/events location)
 *   - api → code-manager WS proxy (mux from one nginx stream to many runner pods)
 *   - code-manager → runner-pod daemon WS (per-session)
 *   - heartbeat / keep-alive timers (idle connections shouldn't drop within 3m)
 *   - file-descriptor pressure on the api + code-manager pods
 *
 * Failure modes:
 *   - WS handshake failures (nginx upgrade not configured, CSP misfire)
 *   - Connection drops mid-soak (idle timeout < expected)
 *   - Memory growth on the api over the soak window (OOM signal)
 *   - code-manager FD exhaustion (would manifest as new sessions failing)
 *
 * Run:
 *   BASE_URL=https://chat.example.com API_KEY=awc_xxx \
 *   k6 run tests/load/scenarios/codemode/04-ws-soak.js
 */
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import {
  BASE_URL,
  API_KEY,
  preflight,
  spawnCodemodeSession,
  killCodemodeSession,
} from './_lib.js';

const cmWsConnects = new Counter('cm_ws_connects');
const cmWsDrops = new Counter('cm_ws_drops_during_soak');
const cmWsErrors = new Rate('cm_ws_errors');
const cmWsHandshakeLatency = new Trend('cm_ws_handshake_latency', true);

export const options = {
  scenarios: {
    soak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 10 }, // ramp all 10 connections
        { duration: '3m', target: 10 }, // hold open
        { duration: '15s', target: 0 }, // drain
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    cm_ws_handshake_latency: ['p(95)<5000'],
    cm_ws_errors: ['rate<0.1'],
    cm_ws_drops_during_soak: ['count<3'], // ≥7/10 must stay connected through soak
  },
};

export function setup() {
  return preflight();
}

export default function () {
  const sess = spawnCodemodeSession('wssoak');
  if (!sess.ok) {
    cmWsErrors.add(1);
    return;
  }
  const sid = sess.sessionId;

  // The ui-nginx /api/code/ws/events location proxies to code-manager which
  // mux'es to the runner-pod daemon. Auth is Bearer for HTTP fallback +
  // query-string token for WS (same pattern as the production codemode UI).
  const wsUrl =
    BASE_URL.replace(/^http/, 'ws') +
    `/api/code/ws/events?sessionId=${encodeURIComponent(sid)}&token=${encodeURIComponent(API_KEY)}`;

  const handshakeStart = Date.now();
  const params = {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
    timeout: '20s',
  };

  let droppedUnexpectedly = false;
  const res = ws.connect(wsUrl, params, function (socket) {
    cmWsHandshakeLatency.add(Date.now() - handshakeStart);
    cmWsConnects.add(1);

    socket.on('open', () => {
      // Stay subscribed; emit a ping every 20s to keep aggressive proxies awake.
      socket.setInterval(() => {
        try {
          socket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        } catch {
          /* socket closed */
        }
      }, 20_000);
    });

    socket.on('close', (code) => {
      // 1000 = normal closure (we tore it down at scenario end)
      // 1006 = abnormal disconnect (server-side drop) — that's a fail.
      if (code !== 1000 && code !== 1001) {
        droppedUnexpectedly = true;
        cmWsDrops.add(1);
      }
    });

    socket.on('error', (e) => {
      cmWsErrors.add(1);
      console.warn(`VU${__VU}: WS error ${e.error()}`);
    });

    // Hold the socket open for the rest of the iteration.
    socket.setTimeout(() => {
      try { socket.close(1000); } catch { /* ok */ }
    }, 170_000); // ~just under the 3m sustain
  });

  check(res, { 'ws handshake 101': (r) => r && r.status === 101 });
  if (droppedUnexpectedly) cmWsErrors.add(1);

  killCodemodeSession(sid);
}
