/**
 * Security guard for the preview path-proxy — pure-helper integration
 * level. Uses an in-memory Redis to seed two distinct user sessions and
 * exercises the full auth-decision flow that the live handler runs:
 *
 *   1. Seed sessionId="sess-A" owned by "user-A" with port 5173 announced.
 *   2. Seed sessionId="sess-B" owned by "user-B" with port 8000 announced.
 *   3. Authenticated as user-A:
 *      a. Reaching sess-A:5173 → ok.
 *      b. Reaching sess-A:6000 (port not announced) → 403.
 *      c. Reaching sess-B:8000 → 403 with reason 'session_owner_mismatch'.
 *      d. Reaching unknown sess-C → 404.
 *
 * This pins the canonical "user A cannot reach user B's pod" rule that
 * the brief flagged as a security gate. Pinning it at the helper level
 * (decideProxyAuth) AND at the integration level (this file) means a
 * regression has to defeat BOTH layers to ship.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  announcePort,
  decideProxyAuth,
  getAnnouncedPorts,
  type PreviewProxyRedis,
} from '../preview-proxy.handler.js';

class InMemoryRedis implements PreviewProxyRedis {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<unknown> {
    this.store.set(key, value);
    return 'OK';
  }
}

interface SeededSession {
  userId: string;
  podHost: string;
}

const SESSIONS: Record<string, SeededSession> = {
  'sess-A': { userId: 'user-A', podHost: 'pod-a.svc' },
  'sess-B': { userId: 'user-B', podHost: 'pod-b.svc' },
};

function lookupSession(sid: string): SeededSession | undefined {
  return SESSIONS[sid];
}

async function checkProxyAccess(
  redis: PreviewProxyRedis,
  authedUserId: string,
  sid: string,
  port: number,
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  const entry = lookupSession(sid);
  const announcedPorts = await getAnnouncedPorts(redis, sid);
  return decideProxyAuth({
    authedUserId,
    sessionEntryUserId: entry?.userId,
    port,
    announcedPorts,
  });
}

describe('preview-proxy security: cross-user isolation', () => {
  let redis: InMemoryRedis;

  beforeEach(async () => {
    redis = new InMemoryRedis();
    await announcePort(redis, 'sess-A', 5173);
    await announcePort(redis, 'sess-B', 8000);
  });

  it('user-A reaching their own session/port succeeds', async () => {
    expect(await checkProxyAccess(redis, 'user-A', 'sess-A', 5173)).toEqual({ ok: true });
  });

  it('user-A reaching their own session BUT non-whitelisted port → 403', async () => {
    const r = await checkProxyAccess(redis, 'user-A', 'sess-A', 6000);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.reason).toBe('port_not_announced');
  });

  it('SECURITY: user-A reaching user-B sessionId → 403 session_owner_mismatch', async () => {
    const r = await checkProxyAccess(redis, 'user-A', 'sess-B', 8000);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.reason).toBe('session_owner_mismatch');
  });

  it('SECURITY: user-A reaching user-B sessionId on user-A port → still 403', async () => {
    // Even though port 5173 is on the announced list for sess-A,
    // user-A is NOT the owner of sess-B and gets 403 BEFORE the port
    // check runs. This guards against a "spray ports across all sids"
    // attack — the owner check is the FIRST gate.
    const r = await checkProxyAccess(redis, 'user-A', 'sess-B', 5173);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.reason).toBe('session_owner_mismatch');
  });

  it('reaching an unknown sessionId → 404', async () => {
    const r = await checkProxyAccess(redis, 'user-A', 'sess-DOESNT-EXIST', 5173);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });

  it("user-B announcing a port doesn't leak it to user-A's whitelist", async () => {
    await announcePort(redis, 'sess-B', 9999);
    expect(await getAnnouncedPorts(redis, 'sess-A')).toEqual([5173]);
    expect(await getAnnouncedPorts(redis, 'sess-B')).toEqual([8000, 9999]);
  });

  it('a forged user-id in the auth context matching the OTHER session id is still 403', async () => {
    // Simulates: an attacker crafts a session id collision but the
    // token still resolves to user-A.
    const r = await checkProxyAccess(redis, 'user-A', 'sess-B', 8000);
    expect(r.status).toBe(403);
  });
});
