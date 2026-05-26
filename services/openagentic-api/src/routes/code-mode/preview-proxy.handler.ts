import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { validateAnyToken } from '../../auth/tokenValidator.js';
import { getInternalKey } from '../../utils/internalKeyReader.js';
import { getSessionEntry } from './relay-ws.handler.js';
import WebSocket from 'ws';

/**
 * Minimal shape the proxy needs from Redis. Same interface relay-ws
 * uses — drop-in compatible with UnifiedRedisClient.
 */
export interface PreviewProxyRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
}

const PORT_KEY = (sid: string) => `codemode:preview-ports:${sid}`;
const PORT_TTL_SECONDS = 86_400;

/**
 * Optional per-port pod IP override. The daemon includes its own pod IP
 * (via `hostname -i`) in the announce so the proxy can forward straight
 * to the pod-IP — the codemode pod's k8s Service only multiplexes the
 * daemon's fixed ports (3070, 3200), NOT the user's arbitrary dev-server
 * ports. Without the IP override, the proxy would 502 trying to dial
 * `<service>.svc.cluster.local:<random-port>`.
 */
export interface AnnouncedPortEntry {
  port: number;
  /** Pod IP the proxy should dial. Optional — falls back to entry.podHost. */
  podHost?: string;
}

/**
 * Read the announced port whitelist for a session. Stored as a JSON
 * array of {port, podHost?} entries in Redis. Returns `[]` if the
 * key is missing or malformed (forces 403 on unknown ports — fail-closed).
 *
 * Backwards compatible: legacy `number[]` entries still parse — they
 * just lack the per-port podHost override and the proxy falls through
 * to the session-level podHost (which fails for arbitrary ports, but
 * preserves the old shape).
 */
export async function getAnnouncedPorts(
  redis: PreviewProxyRedis,
  sessionId: string,
): Promise<number[]> {
  const entries = await getAnnouncedPortEntries(redis, sessionId);
  return entries.map((e) => e.port);
}

export async function getAnnouncedPortEntries(
  redis: PreviewProxyRedis,
  sessionId: string,
): Promise<AnnouncedPortEntry[]> {
  const raw = await redis.get(PORT_KEY(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): AnnouncedPortEntry | null => {
        if (typeof item === 'number') {
          return Number.isInteger(item) && item >= 1 && item <= 65535
            ? { port: item }
            : null;
        }
        if (item && typeof item === 'object') {
          const o = item as { port?: unknown; podHost?: unknown };
          if (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535) return null;
          const podHost = typeof o.podHost === 'string' && o.podHost.length > 0 ? o.podHost : undefined;
          return { port: o.port, ...(podHost ? { podHost } : {}) };
        }
        return null;
      })
      .filter((e): e is AnnouncedPortEntry => e !== null);
  } catch {
    return [];
  }
}

/**
 * Add a port to the session's whitelist. Idempotent. Called by the
 * daemon via /api/internal/code-mode/preview-port whenever a dev-
 * server boot URL is detected. `podHost` is optional but strongly
 * recommended — without it the proxy can only reach the session's
 * service-DNS host on its fixed ports.
 */
export async function announcePort(
  redis: PreviewProxyRedis,
  sessionId: string,
  port: number,
  podHost?: string,
): Promise<number[]> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('port out of range');
  }
  const existing = await getAnnouncedPortEntries(redis, sessionId);
  const idx = existing.findIndex((e) => e.port === port);
  let updated: AnnouncedPortEntry[];
  if (idx >= 0) {
    // Update existing entry only if podHost is now provided.
    if (podHost && existing[idx].podHost !== podHost) {
      updated = [...existing];
      updated[idx] = { port, podHost };
    } else {
      return existing.map((e) => e.port);
    }
  } else {
    updated = [...existing, podHost ? { port, podHost } : { port }];
  }
  updated.sort((a, b) => a.port - b.port);
  await redis.set(PORT_KEY(sessionId), JSON.stringify(updated), PORT_TTL_SECONDS);
  return updated.map((e) => e.port);
}

/**
 * Pure auth-gate decision. Extracted so unit tests can pin the
 * "user A can't reach user B's pod" rule without spinning a real
 * Fastify server. Returns either `{ ok: true, podHost }` (proxy
 * forwards), or `{ ok: false, status, reason }` (proxy short-circuits).
 */
export interface ProxyAuthDecision {
  authedUserId: string;
  sessionEntryUserId: string | undefined;
  port: number;
  announcedPorts: number[];
}

export interface ProxyAuthResult {
  ok: boolean;
  status?: 401 | 403 | 404;
  reason?: string;
}

export function decideProxyAuth(d: ProxyAuthDecision): ProxyAuthResult {
  if (!d.authedUserId) return { ok: false, status: 401, reason: 'unauthenticated' };
  if (!d.sessionEntryUserId) return { ok: false, status: 404, reason: 'session_not_found' };
  if (d.sessionEntryUserId !== d.authedUserId) {
    return { ok: false, status: 403, reason: 'session_owner_mismatch' };
  }
  if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535) {
    return { ok: false, status: 403, reason: 'invalid_port' };
  }
  if (!d.announcedPorts.includes(d.port)) {
    return { ok: false, status: 403, reason: 'port_not_announced' };
  }
  return { ok: true };
}

/**
 * Build the upstream pod URL the proxy should forward to. Pure helper
 * so unit tests pin the path-rewriting contract.
 */
export function buildUpstreamUrl(
  scheme: 'http' | 'ws',
  podHost: string,
  port: number,
  /** Path tail after `/api/code/preview/:sid/:port/` — may include `?query`. */
  rest: string,
): string {
  // rest may begin with `/` or not; coerce to leading `/`.
  let trail = rest || '';
  if (!trail.startsWith('/')) trail = '/' + trail;
  return `${scheme}://${podHost}:${port}${trail}`;
}

/** Headers we strip when forwarding to the pod (hop-by-hop + auth). */
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'cookie',
  'authorization',
  // Don't leak the openagentic session token to the user's dev server.
]);

/** Headers we strip from the pod's response (hop-by-hop + framing).
 *
 * `x-frame-options` and `content-security-policy` are stripped so we can
 * INJECT our own SAMEORIGIN-only versions below — the user's dev server
 * might emit any value (or none), but the proxy MUST guarantee no
 * third-party site can iframe the preview. User feedback 2026-05-07:
 * 'these preview apps should ONLY open within codemode inline or
 * iframe and completely authed ONLY for the user'. Per-user auth is
 * already enforced in decideProxyAuth (403 session_owner_mismatch);
 * frame-ancestors closes the cross-site embed loophole. */
const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length', // Fastify recomputes
  'content-encoding', // Node has already decoded
  'x-frame-options', // Replaced by SAMEORIGIN below
  'content-security-policy', // Replaced by frame-ancestors 'self' below
]);

/**
 * Headers we ADD to every proxy response to lock the preview into the
 * codemode UI. `frame-ancestors 'self'` rejects any other origin trying
 * to embed the iframe; `X-Frame-Options: SAMEORIGIN` is the legacy
 * fallback for browsers that don't honor CSP frame-ancestors.
 *
 * `Referrer-Policy: same-origin` keeps any outbound navigation from the
 * preview from leaking the proxy URL (which encodes the session id).
 */
const FRAME_LOCK_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'Referrer-Policy': 'same-origin',
};

export function filterRequestHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

export function filterResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    out[key] = value;
  });
  // Inject the frame-lock headers AFTER stripping so they can't be
  // overridden by a misbehaving upstream. Any user dev server's own
  // X-Frame-Options/CSP is already stripped above.
  for (const [k, v] of Object.entries(FRAME_LOCK_HEADERS)) {
    out[k] = v;
  }
  return out;
}

/**
 * Extract the bearer token the same way authMiddleware does. WS upgrade
 * iframes can't easily set Authorization, so we accept ?token= too.
 * Cookies flow naturally for same-origin HTTP iframes.
 */
function extractToken(req: FastifyRequest): string | undefined {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const q = (req.query as { token?: string } | undefined)?.token;
  if (typeof q === 'string' && q.length > 0) return q;
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (cookies?.openagentic_token) return cookies.openagentic_token;
  if (cookies?.accessToken) return cookies.accessToken;
  return undefined;
}

export interface PreviewProxyDeps {
  logger: Logger;
  redis: PreviewProxyRedis;
}

/**
 * Register both the HTTP path-proxy AND the matching WS upgrade handler.
 *
 * Path: `/api/code/preview/:sid/:port/*`
 *
 *   - HTTP requests forward via fetch to `http://<podHost>:<port>/<rest>`.
 *   - WS upgrades open a new ws to `ws://<podHost>:<port>/<rest>` and
 *     bidirectionally pipe frames (HMR canary).
 */
export async function registerPreviewProxyRoute(
  fastify: FastifyInstance,
  deps: PreviewProxyDeps,
): Promise<void> {
  const { logger, redis } = deps;

  // ── Internal port-announce route (X-Internal-API-Key) ─────────────────
  // The daemon's previewReadyEmitter calls this whenever it detects a new
  // dev-server boot URL. Idempotent.
  fastify.post('/api/internal/code-mode/preview-port', async (req, reply) => {
    const internalKey = getInternalKey();
    const provided = req.headers['x-internal-api-key'];
    if (!internalKey || provided !== internalKey) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const body = req.body as { sessionId?: string; port?: number; podHost?: string } | undefined;
    if (!body || typeof body.sessionId !== 'string' || typeof body.port !== 'number') {
      return reply.code(400).send({ error: 'sessionId+port required' });
    }
    const podHost =
      typeof body.podHost === 'string' && body.podHost.length > 0 ? body.podHost : undefined;
    try {
      const ports = await announcePort(redis, body.sessionId, body.port, podHost);
      logger.info(
        { sessionId: body.sessionId, port: body.port, podHost, ports },
        '[preview-proxy] port announced',
      );
      return reply.send({ ok: true, ports });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // ── HTTP path-proxy + WS upgrade ─────────────────────────────────────
  // @fastify/websocket v11's `wsHandler` only ships on GET-method routes
  // (the plugin checks `method === 'GET'` in addNewRoute). So we register
  // the GET-with-wsHandler entry separately, then a non-GET method-array
  // entry to cover the other verbs the iframe might fire (POST/PUT for
  // dev-server APIs). When the inbound request has Upgrade: websocket,
  // wsHandler runs instead of the GET handler — Vite HMR works.
  const wsHandlerFn = async (connection: any, req: FastifyRequest) => {
    await handleWsProxy(connection, req, { logger, redis });
  };
  const httpHandlerFn = async (req: FastifyRequest, reply: FastifyReply) => {
    await handleHttpProxy(req, reply, { logger, redis });
  };
  const registerPath = (path: string) => {
    fastify.route({
      method: 'GET',
      url: path,
      handler: httpHandlerFn,
      // Cast as any: the @fastify/websocket runtime augmentation isn't
      // surfaced in the @types we resolve here.
      wsHandler: wsHandlerFn,
    } as any);
    // HEAD intentionally omitted — Fastify auto-registers HEAD when GET
    // is declared (find-my-way: 'HEAD already declared for route ...').
    fastify.route({
      method: ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      url: path,
      handler: httpHandlerFn,
    });
  };
  registerPath('/api/code/preview/:sid/:port/*');
  registerPath('/api/code/preview/:sid/:port');

  logger.info('[preview-proxy] routes registered at /api/code/preview/:sid/:port/* (HTTP + WS)');
}

async function handleHttpProxy(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: PreviewProxyDeps,
): Promise<void> {
  const { logger, redis } = deps;
  const params = req.params as { sid: string; port: string; '*'?: string };
  const sid = params.sid;
  const port = parseInt(params.port, 10);
  const rest = params['*'] ?? '';

  // 1. Auth
  const token = extractToken(req);
  if (!token) {
    return void reply.code(401).send({ error: 'authentication required' });
  }
  const tokenResult = await validateAnyToken(token, { logger });
  if (!tokenResult.isValid || !tokenResult.user) {
    return void reply.code(401).send({ error: 'invalid token' });
  }
  const authedUserId = tokenResult.user.userId;

  // 2. Session ownership
  const entry = await getSessionEntry(redis, sid);

  // 3. Port whitelist (with optional per-port podHost override)
  const announcedEntries = await getAnnouncedPortEntries(redis, sid);
  const announcedPorts = announcedEntries.map((e) => e.port);

  const decision = decideProxyAuth({
    authedUserId,
    sessionEntryUserId: entry?.userId,
    port,
    announcedPorts,
  });
  if (!decision.ok) {
    logger.warn(
      { sid, port, authedUserId, reason: decision.reason },
      '[preview-proxy] denied',
    );
    return void reply.code(decision.status ?? 403).send({ error: decision.reason });
  }

  // 4. Forward — prefer the per-port podHost override (the daemon
  //    includes the pod IP in its announce so we can dial arbitrary
  //    user-server ports) and fall back to the session-level podHost
  //    (the k8s Service DNS, which only multiplexes the daemon's
  //    fixed ports — included for compat with legacy entries).
  const portEntry = announcedEntries.find((e) => e.port === port);
  const podHost = portEntry?.podHost ?? entry!.podHost;
  const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstream = buildUpstreamUrl('http', podHost, port, rest + queryString);

  try {
    const headers = filterRequestHeaders(req.headers as Record<string, string | string[] | undefined>);
    const init: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Fastify exposes the parsed body — re-serialize to a Buffer.
      const body = req.body;
      if (body !== undefined && body !== null) {
        if (typeof body === 'string' || body instanceof Uint8Array) {
          init.body = body as any;
        } else {
          init.body = JSON.stringify(body);
          headers['content-type'] = headers['content-type'] || 'application/json';
        }
      }
    }
    const upstreamResp = await fetch(upstream, init);
    const respHeaders = filterResponseHeaders(upstreamResp.headers);
    reply.code(upstreamResp.status);
    for (const [k, v] of Object.entries(respHeaders)) reply.header(k, v);
    const buf = Buffer.from(await upstreamResp.arrayBuffer());
    return void reply.send(buf);
  } catch (err) {
    logger.error({ err: (err as Error).message, sid, port, upstream }, '[preview-proxy] upstream failed');
    return void reply.code(502).send({ error: 'upstream unreachable' });
  }
}

async function handleWsProxy(
  connection: any,
  req: FastifyRequest,
  deps: PreviewProxyDeps,
): Promise<void> {
  const { logger, redis } = deps;
  const browserWs: WebSocket = (connection?.socket as WebSocket) ?? (connection as WebSocket);
  if (!browserWs || typeof browserWs.send !== 'function') {
    logger.warn('[preview-proxy] invalid browser ws on upgrade');
    return;
  }
  const params = req.params as { sid: string; port: string; '*'?: string };
  const sid = params.sid;
  const port = parseInt(params.port, 10);
  const rest = params['*'] ?? '';

  const token = extractToken(req);
  if (!token) {
    browserWs.close(4001, 'authentication required');
    return;
  }
  const tokenResult = await validateAnyToken(token, { logger });
  if (!tokenResult.isValid || !tokenResult.user) {
    browserWs.close(4001, 'invalid token');
    return;
  }
  const authedUserId = tokenResult.user.userId;

  const entry = await getSessionEntry(redis, sid);
  const announcedEntries = await getAnnouncedPortEntries(redis, sid);
  const announcedPorts = announcedEntries.map((e) => e.port);
  const decision = decideProxyAuth({
    authedUserId,
    sessionEntryUserId: entry?.userId,
    port,
    announcedPorts,
  });
  if (!decision.ok) {
    logger.warn({ sid, port, authedUserId, reason: decision.reason }, '[preview-proxy] ws denied');
    browserWs.close(decision.status === 401 ? 4001 : 4003, decision.reason ?? 'denied');
    return;
  }

  const portEntry = announcedEntries.find((e) => e.port === port);
  const podHost = portEntry?.podHost ?? entry!.podHost;
  const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstream = buildUpstreamUrl('ws', podHost, port, rest + queryString);

  let podWs: WebSocket;
  try {
    podWs = new WebSocket(upstream, {
      // Forward request headers so HMR auth (Vite passes the secWebSocketProtocol)
      // makes it through; strip Host since we're targeting the pod directly.
      headers: filterRequestHeaders(req.headers as Record<string, string | string[] | undefined>),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, upstream }, '[preview-proxy] ws upstream connect failed');
    browserWs.close(4502, 'upstream unreachable');
    return;
  }

  podWs.on('open', () => {
    logger.info({ sid, port }, '[preview-proxy] ws bridged');
  });

  // Bidirectional binary-safe pipe — required for HMR (Vite uses binary frames).
  podWs.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
    if (browserWs.readyState !== WebSocket.OPEN) return;
    try { browserWs.send(data, { binary: isBinary }); } catch { /* drop */ }
  });
  browserWs.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
    if (podWs.readyState !== WebSocket.OPEN) return;
    try { podWs.send(data, { binary: isBinary }); } catch { /* drop */ }
  });
  const cleanup = () => {
    try { podWs.close(); } catch { /* tolerant */ }
    try { if (browserWs.readyState === WebSocket.OPEN) browserWs.close(); } catch { /* tolerant */ }
  };
  podWs.on('close', cleanup);
  podWs.on('error', (err: Error) => {
    logger.warn({ err: err.message }, '[preview-proxy] ws upstream error');
    cleanup();
  });
  browserWs.on('close', cleanup);
  browserWs.on('error', cleanup);
}
