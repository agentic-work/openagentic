/**
 * Shared helpers for the codemode k6 scenarios.
 *
 * Auth: scenarios authenticate via an API key (`Authorization: Bearer awc_…`)
 * — same path the existing `tests/load/scenarios/load.js` uses. The key needs
 * `code:read`, `code:write`, and `chat:write` scopes.
 *
 * Conventions:
 * - Every scenario reads `BASE_URL` (defaults to chat-dev) + `API_KEY` from env.
 * - Every scenario uses `__VU` to derive a per-virtual-user identity so 10
 *   concurrent VUs don't collide on session names.
 * - Custom metrics names are `cm_<scenario>_<metric>` so the dashboards can
 *   tell scenarios apart at a glance.
 */
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'https://chat.example.com';
export const API_KEY = __ENV.API_KEY || '';

export function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
    ...extra,
  };
}

export function preflight() {
  if (!API_KEY) throw new Error('API_KEY env var is required');
  const r = http.get(`${BASE_URL}/api/health`);
  if (r.status !== 200) throw new Error(`API health failed: ${r.status}`);
  return { baseUrl: BASE_URL };
}

/**
 * Spawn a codemode session for the current VU. Returns the sessionId on
 * success or null on failure. Callers should add their own metric writes;
 * this helper just wraps the POST + JSON parse.
 */
export function spawnCodemodeSession(label) {
  const body = JSON.stringify({
    title: `k6-${label}-vu${__VU}-${Date.now()}`,
    workspaceId: `k6-vu${__VU}`,
  });
  const res = http.post(`${BASE_URL}/api/code/sessions`, body, {
    headers: authHeaders(),
    timeout: '60s',
  });
  if (res.status !== 200 && res.status !== 201) return { ok: false, status: res.status, sessionId: null };
  let sid = null;
  try {
    const j = res.json();
    sid = j.session?.id || j.sessionId || j.id;
  } catch {
    /* ignore */
  }
  return { ok: !!sid, status: res.status, sessionId: sid };
}

/**
 * Tear down a codemode session. Best-effort — we don't fail the test if
 * cleanup 404s (session may have been auto-pruned by the manager's
 * idle-cleanup before the DELETE arrived).
 */
export function killCodemodeSession(sessionId) {
  if (!sessionId) return;
  http.del(`${BASE_URL}/api/code/sessions/${sessionId}`, null, {
    headers: authHeaders(),
    timeout: '10s',
  });
}
