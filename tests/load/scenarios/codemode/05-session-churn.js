/**
 * Scenario 05 — session-churn (spawn → idle → cleanup loop)
 *
 * 10 VUs cycle through the full session lifecycle: spawn, hold idle for
 * ~30s, force-cleanup, repeat. Over a 3-minute window each VU completes
 * 4-5 cycles, so the cluster sees ~40-50 spawn/teardown events. Stresses:
 *
 *   - PVC mount + unmount cycle (geesefs CSI is the historical weak spot —
 *     CSI driver crash on unmount under contention has bitten us before)
 *   - code-manager's session-state ledger consistency under churn
 *   - kube-scheduler eviction throughput (pods Terminating + new ones Pending)
 *   - Harbor pull cache (warm pulls should be sub-second; cold = 60s+)
 *   - Workspace symlink reuse (per-user PVC is shared across VU's sessions
 *     so the second cycle should be much faster than the first)
 *
 * Failure modes:
 *   - PVC mount stall (geesefs hung — pod stuck Pending → ContainerCreating)
 *   - Stale session record (manager thinks session exists but pod is gone)
 *   - "Workspace already in use" deadlock if two VUs share a userId+
 *     workspace (we set a per-VU workspaceId to avoid this — verify metric)
 *
 * Run:
 *   BASE_URL=https://chat.example.com API_KEY=awc_xxx \
 *   k6 run tests/load/scenarios/codemode/05-session-churn.js
 */
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import {
  preflight,
  spawnCodemodeSession,
  killCodemodeSession,
} from './_lib.js';

const cmChurnSpawnLatency = new Trend('cm_churn_spawn_latency', true);
const cmChurnCycles = new Counter('cm_churn_cycles_completed');
const cmChurnErrors = new Rate('cm_churn_errors');
const cmChurnFailures = new Counter('cm_churn_failures');

export const options = {
  scenarios: {
    churn: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '3m', target: 10 },
        { duration: '15s', target: 0 },
      ],
      gracefulStop: '60s',
    },
  },
  thresholds: {
    cm_churn_spawn_latency: ['p(50)<10000', 'p(95)<60000'],
    cm_churn_errors: ['rate<0.15'],
    cm_churn_cycles_completed: ['count>=20'], // ~2 cycles per VU minimum
  },
};

export function setup() {
  return preflight();
}

export default function () {
  const start = Date.now();
  const sess = spawnCodemodeSession('churn');
  cmChurnSpawnLatency.add(Date.now() - start);
  const ok = check(sess, { 'spawn ok': (s) => s.ok === true });
  if (!ok) {
    cmChurnFailures.add(1);
    cmChurnErrors.add(1);
    sleep(5); // back off on failure
    return;
  }
  cmChurnErrors.add(0);

  // Idle hold — simulates a user opening codemode, reading something, then
  // closing the tab without explicitly cleaning up. The manager's idle
  // pruner SHOULD eventually GC, but we're testing the fast-path explicit
  // delete.
  sleep(20 + Math.random() * 20);

  killCodemodeSession(sess.sessionId);
  cmChurnCycles.add(1);
  // Brief gap before next cycle — k6 will re-call default() based on VU
  // availability + remaining duration.
  sleep(3);
}
