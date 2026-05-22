/**
 * Contract tests for the preview path-proxy.
 *
 * The pure helpers (decideProxyAuth, buildUpstreamUrl,
 * filterRequestHeaders, getAnnouncedPorts, announcePort) carry the
 * security gate + URL-rewriting contract. We pin them here so future
 * refactors can't silently regress the "user A can't reach user B's
 * pod" rule or the HMR-keeping header passthrough.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  announcePort,
  buildUpstreamUrl,
  decideProxyAuth,
  filterRequestHeaders,
  filterResponseHeaders,
  getAnnouncedPorts,
  getAnnouncedPortEntries,
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

describe('decideProxyAuth — user-isolation gate', () => {
  it('denies with 401 when no authed user', () => {
    const r = decideProxyAuth({
      authedUserId: '',
      sessionEntryUserId: 'user-a',
      port: 5173,
      announcedPorts: [5173],
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it('denies with 404 when session not found', () => {
    const r = decideProxyAuth({
      authedUserId: 'user-a',
      sessionEntryUserId: undefined,
      port: 5173,
      announcedPorts: [5173],
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });

  it('SECURITY: denies user A trying to reach user B sessionId', () => {
    const r = decideProxyAuth({
      authedUserId: 'user-a',
      sessionEntryUserId: 'user-b',
      port: 5173,
      announcedPorts: [5173],
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.reason).toBe('session_owner_mismatch');
  });

  it('denies unknown ports with 403 (port not announced)', () => {
    const r = decideProxyAuth({
      authedUserId: 'user-a',
      sessionEntryUserId: 'user-a',
      port: 22,
      announcedPorts: [5173, 8000],
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.reason).toBe('port_not_announced');
  });

  it('denies invalid ports', () => {
    const r1 = decideProxyAuth({
      authedUserId: 'u',
      sessionEntryUserId: 'u',
      port: 0,
      announcedPorts: [],
    });
    expect(r1.status).toBe(403);
    const r2 = decideProxyAuth({
      authedUserId: 'u',
      sessionEntryUserId: 'u',
      port: 99999,
      announcedPorts: [],
    });
    expect(r2.status).toBe(403);
  });

  it('allows when user owns session AND port is whitelisted', () => {
    const r = decideProxyAuth({
      authedUserId: 'user-a',
      sessionEntryUserId: 'user-a',
      port: 5173,
      announcedPorts: [5173, 8000],
    });
    expect(r).toEqual({ ok: true });
  });
});

describe('buildUpstreamUrl', () => {
  it('builds http URL with leading slash on rest', () => {
    expect(buildUpstreamUrl('http', 'pod.svc', 5173, 'foo/bar')).toBe(
      'http://pod.svc:5173/foo/bar',
    );
  });
  it('preserves leading slash if already present', () => {
    expect(buildUpstreamUrl('http', 'pod.svc', 5173, '/assets/x.js')).toBe(
      'http://pod.svc:5173/assets/x.js',
    );
  });
  it('handles empty rest as root', () => {
    expect(buildUpstreamUrl('http', 'pod.svc', 5173, '')).toBe('http://pod.svc:5173/');
  });
  it('builds ws URL for upgrade requests', () => {
    expect(buildUpstreamUrl('ws', 'pod.svc', 5173, '@vite/client')).toBe(
      'ws://pod.svc:5173/@vite/client',
    );
  });
});

describe('filterRequestHeaders — strips hop-by-hop + auth', () => {
  it('strips Host, Cookie, Authorization', () => {
    const out = filterRequestHeaders({
      host: 'chat-dev.openagentic.io',
      cookie: 'openagentic_token=secret',
      authorization: 'Bearer secret',
      'user-agent': 'Mozilla/5.0',
      accept: 'text/html',
    });
    expect(out).not.toHaveProperty('host');
    expect(out).not.toHaveProperty('cookie');
    expect(out).not.toHaveProperty('authorization');
    expect(out['user-agent']).toBe('Mozilla/5.0');
    expect(out.accept).toBe('text/html');
  });

  it('preserves WS upgrade headers EXCEPT the Upgrade keyword itself (ws lib re-adds it)', () => {
    // We strip Upgrade because the `ws` library on the api re-adds it
    // on its own client handshake to the pod. Sec-WebSocket-* MUST pass
    // through so the pod knows it's still a WS request semantically (Vite
    // uses Sec-WebSocket-Protocol).
    const out = filterRequestHeaders({
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-key': 'abc==',
      'sec-websocket-protocol': 'vite-hmr',
      'sec-websocket-version': '13',
    });
    expect(out).not.toHaveProperty('upgrade');
    expect(out).not.toHaveProperty('connection');
    expect(out['sec-websocket-protocol']).toBe('vite-hmr');
  });

  it('handles array-valued headers', () => {
    const out = filterRequestHeaders({
      'x-forwarded-for': ['1.1.1.1', '2.2.2.2'],
    });
    expect(out['x-forwarded-for']).toBe('1.1.1.1, 2.2.2.2');
  });

  it('skips undefined values', () => {
    const out = filterRequestHeaders({ accept: undefined });
    expect(out).not.toHaveProperty('accept');
  });
});

describe('filterResponseHeaders — strips hop-by-hop + framing', () => {
  it('strips Content-Length, Content-Encoding, Transfer-Encoding', () => {
    const h = new Headers({
      'content-length': '12345',
      'content-encoding': 'gzip',
      'transfer-encoding': 'chunked',
      'content-type': 'text/html',
      'cache-control': 'no-cache',
    });
    const out = filterResponseHeaders(h);
    expect(out).not.toHaveProperty('content-length');
    expect(out).not.toHaveProperty('content-encoding');
    expect(out).not.toHaveProperty('transfer-encoding');
    expect(out['content-type']).toBe('text/html');
    expect(out['cache-control']).toBe('no-cache');
  });
});

describe('per-session port whitelist (Redis)', () => {
  let redis: InMemoryRedis;
  beforeEach(() => {
    redis = new InMemoryRedis();
  });

  it('returns [] when no ports announced', async () => {
    expect(await getAnnouncedPorts(redis, 'sess-1')).toEqual([]);
  });

  it('persists announced ports', async () => {
    await announcePort(redis, 'sess-1', 5173);
    await announcePort(redis, 'sess-1', 8000);
    expect(await getAnnouncedPorts(redis, 'sess-1')).toEqual([5173, 8000]);
  });

  it('is idempotent for repeat announcements', async () => {
    await announcePort(redis, 'sess-1', 5173);
    await announcePort(redis, 'sess-1', 5173);
    expect(await getAnnouncedPorts(redis, 'sess-1')).toEqual([5173]);
  });

  it('keeps whitelists isolated per session (key includes sid)', async () => {
    await announcePort(redis, 'sess-A', 5173);
    await announcePort(redis, 'sess-B', 8000);
    expect(await getAnnouncedPorts(redis, 'sess-A')).toEqual([5173]);
    expect(await getAnnouncedPorts(redis, 'sess-B')).toEqual([8000]);
  });

  it('rejects ports out of range', async () => {
    await expect(announcePort(redis, 'sess-1', 0)).rejects.toThrow();
    await expect(announcePort(redis, 'sess-1', 99999)).rejects.toThrow();
  });

  it('returns [] when stored value is malformed', async () => {
    await redis.set('codemode:preview-ports:sess-1', 'not-json');
    expect(await getAnnouncedPorts(redis, 'sess-1')).toEqual([]);
  });

  it('filters out invalid integers from a malformed array (defense in depth)', async () => {
    await redis.set(
      'codemode:preview-ports:sess-1',
      JSON.stringify([5173, 'bad', 99999, 0, 8000, 1.5]),
    );
    expect(await getAnnouncedPorts(redis, 'sess-1')).toEqual([5173, 8000]);
  });

  it('persists podHost alongside the port (used by proxy for pod-IP routing)', async () => {
    await announcePort(redis, 'sess-1', 8765, '10.42.7.56');
    const entries = await getAnnouncedPortEntries(redis, 'sess-1');
    expect(entries).toEqual([{ port: 8765, podHost: '10.42.7.56' }]);
  });

  it('updates podHost on re-announcement of the same port', async () => {
    await announcePort(redis, 'sess-1', 8765, '10.42.7.56');
    await announcePort(redis, 'sess-1', 8765, '10.42.7.99'); // pod IP changed (rolling update)
    const entries = await getAnnouncedPortEntries(redis, 'sess-1');
    expect(entries).toEqual([{ port: 8765, podHost: '10.42.7.99' }]);
  });

  it('legacy plain-number entries still parse (back-compat)', async () => {
    await redis.set('codemode:preview-ports:sess-1', JSON.stringify([5173, 8000]));
    const entries = await getAnnouncedPortEntries(redis, 'sess-1');
    expect(entries).toEqual([{ port: 5173 }, { port: 8000 }]);
  });
});
