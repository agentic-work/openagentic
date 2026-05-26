/**
 * Scenario 01 — burst-spawn (10 users)
 *
 * 10 VUs each POST /api/code/sessions inside a 30-second window. Stresses:
 *   - code-manager's session register-and-spawn throttle
 *   - kube-scheduler's pod admission rate
 *   - harbor pull throughput (image is 1.2GB+; first-time pulls can throttle)
 *   - the per-user PVC + geesefs CSI mount race
 *   - the daemon's readiness probe (manager waits on ready before responding)
 *
 * Failure modes we want to catch:
 *   - Spawn timeouts (manager → kubelet → ready) > 60s
 *   - Manager 5xx under burst (e.g. redis-lock contention)
 *   - Kubelet ImagePullBackOff if Harbor chokes
 *   - PVC mount stalls (geesefs unresponsive)
 *
 * Run:
 *   BASE_URL=https://chat-dev.openagentic.io API_KEY=awc_xxx \
 *   k6 run tests/load/scenarios/codemode/01-burst-spawn.js
 */
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import {
  preflight,
  spawnCodemodeSession,
  killCodemodeSession,
} from './_lib.js';

const cmSpawnLatency = new Trend('cm_burst_spawn_latency', true);
const cmSpawnErrors = new Rate('cm_burst_spawn_errors');
const cmSpawnSuccess = new Counter('cm_burst_spawn_success');
const cmSpawnFailures = new Counter('cm_burst_spawn_failures');

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 10 }, // arrive in 5s — burst, not ramp
        { duration: '60s', target: 10 }, // hold to give pods time to spawn
        { duration: '15s', target: 0 }, // drain
      ],
      gracefulStop: '60s',
    },
  },
  thresholds: {
    // 95th percentile spawn under 60s — anything slower means scheduler
    // pressure or image-pull saturation.
    cm_burst_spawn_latency: ['p(95)<60000'],
    cm_burst_spawn_errors: ['rate<0.1'],
    cm_burst_spawn_success: ['count>=8'], // expect ≥8 of 10 to succeed
  },
};

export function setup() {
  return preflight();
}

export default function () {
  const start = Date.now();
  const { ok, status, sessionId } = spawnCodemodeSession('burst');
  cmSpawnLatency.add(Date.now() - start);
  check(ok, { 'spawn ok': (v) => v === true });
  if (!ok) {
    cmSpawnErrors.add(1);
    cmSpawnFailures.add(1);
    console.error(`VU${__VU}: spawn failed ${status}`);
    return;
  }
  cmSpawnErrors.add(0);
  cmSpawnSuccess.add(1);
  // Hold the session briefly so the cleanup below races against the
  // manager's idle-prune (real users wouldn't tear down in 1s).
  sleep(2);
  killCodemodeSession(sessionId);
}
