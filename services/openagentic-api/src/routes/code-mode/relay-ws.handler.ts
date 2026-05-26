import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { validateAnyToken } from '../../auth/tokenValidator.js';
import { UserPermissionsService } from '../../services/UserPermissionsService.js';
import { prisma } from '../../utils/prisma.js';
import { getInternalKey } from '../../utils/internalKeyReader.js';
import { featureFlags } from '../../config/featureFlags.js';
import { interceptSlashCommand } from './slash-dispatcher.js';
import WebSocket from 'ws';

/** Wire-timeout and buffering constants, pulled to constants for easy tuning. */
const POD_CONNECT_TIMEOUT_MS = 15_000;
const BROWSER_BUFFER_DURING_PROVISION_MS = 20_000;
const KEEPALIVE_INTERVAL_MS = 25_000;

/** Redis session entry — mirrors what code-manager writes. */
export interface SessionEntry {
  sessionId: string;
  userId: string;
  podName: string;
  /** Internal DNS name of the pod's openagentic daemon listener. */
  podHost: string;
  /** Port the openagentic --remote-session daemon listens on inside the pod. */
  daemonPort: number;
  /** `provisioning` → pod being spawned; `ready` → daemon accepting WS; `draining` → pending upgrade. */
  status: 'provisioning' | 'ready' | 'draining';
  lastActivity: number;
  createdAt: number;
}

const SESSION_KEY = (sid: string) => `codemode:session:${sid}`;
const USER_SESSION_KEY = (uid: string) => `codemode:user:${uid}:session`;

/**
 * Minimal interface the relay needs. Matches UnifiedRedisClient's simpler
 * `set(key, value, ttl?)` shape so `getRedisClient()` drops in without a
 * cast. Ioredis native `.set(..., 'EX', ttl)` callers can still satisfy
 * this by adapting; we use the unified client here.
 */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
}

export async function getSessionEntry(redis: RedisLike, sessionId: string): Promise<SessionEntry | null> {
  const raw = await redis.get(SESSION_KEY(sessionId));
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionEntry; } catch { return null; }
}

export async function writeSessionEntry(redis: RedisLike, entry: SessionEntry, ttlSeconds = 86_400): Promise<void> {
  await redis.set(SESSION_KEY(entry.sessionId), JSON.stringify(entry), ttlSeconds);
  await redis.set(USER_SESSION_KEY(entry.userId), entry.sessionId, ttlSeconds);
}

export async function touchSession(redis: RedisLike, sessionId: string): Promise<void> {
  const entry = await getSessionEntry(redis, sessionId);
  if (!entry) return;
  entry.lastActivity = Date.now();
  await writeSessionEntry(redis, entry);
}

/**
 * Provision a pod for this session via openagentic-manager. Separated so
 * the relay can call without coupling to the manager's SDK shape.
 * Uses the manager's POST /sessions which spawns a user-scoped pod
 * (permanent-pod architecture — same user always gets same pod name).
 * The pod exposes the remote-session daemon on port 3070, reached via
 * its cluster-internal Service DNS (added in Phase 4B).
 */
async function provisionPod(
  userId: string,
  sessionId: string,
  internalKey: string,
  logger: Logger,
  /**
   * Cold-boot 401 fix 2026-04-30: forward the user's session bearer to
   * code-manager so the spawned pod's env carries a fresh
   * OPENAGENTIC_API_KEY. Without this, the pod's first /v1/models call
   * (e.g. when the user opens /model right after pod-create) sees only
   * the envless default and 401s. code-manager prefers an internal JWT
   * minted from the userId/email when JWT_SECRET is set, but it falls
   * back to whatever apiKey the relay forwarded. Optional — pre-existing
   * pods (already-warm path) ignore the field; only fresh-create uses it.
   */
  userBearerToken: string | undefined,
  userEmail: string | undefined,
): Promise<{ podHost: string; daemonPort: number; podName: string }> {
  const managerUrl = process.env.CODE_MANAGER_URL || 'http://openagentic-manager:3050';
  const daemonPort = parseInt(process.env.OPENAGENTIC_DAEMON_PORT || '3070', 10);
  const resp = await fetch(`${managerUrl}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': internalKey,
    },
    body: JSON.stringify({
      userId,
      sessionId,
      mode: 'remote-session',
      ...(userBearerToken ? { apiKey: userBearerToken } : {}),
      ...(userEmail ? { userEmail } : {}),
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    logger.error({ status: resp.status, body }, '[codemode-relay] pod provision failed');
    throw new Error(`pod provision failed: ${resp.status}`);
  }
  // Code-manager shape: { sessionId, status: 'created' | 'existing', session: K8sSession }
  // K8sSession has podName + serviceName. We resolve podHost via cluster DNS
  // on the Service so traffic routes via the Service's `remote-session`
  // targetPort (3070). This is stable across pod swaps (permanent-pod
  // architecture means serviceName outlives any individual pod).
  const data = await resp.json() as {
    sessionId: string;
    status?: string;
    session?: { podName?: string; serviceName?: string };
    // Direct shape the manager may switch to in Phase 4C
    podName?: string;
    podHost?: string;
  };
  const podName = data.session?.podName || data.podName;
  const serviceName = data.session?.serviceName;
  const directHost = data.podHost;
  const namespace = featureFlags.k8sNamespace;
  const podHost =
    directHost ||
    (serviceName ? `${serviceName}.${namespace}.svc.cluster.local` : undefined);
  if (!podName || !podHost) {
    throw new Error(
      `pod provision response missing podName/podHost: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  return { podName, podHost, daemonPort };
}

interface RelayDeps {
  logger: Logger;
  redis: RedisLike;
}

/**
 * Decode a ws RawData payload (Buffer | ArrayBuffer | Buffer[]) to UTF-8
 * text. The daemon emits stream-json NDJSON lines, and the browser hook
 * only processes `typeof event.data === 'string'` frames — so we MUST
 * forward as text. Returning a string and passing it to `ws.send()`
 * makes the `ws` library emit a text opcode frame (0x1) instead of the
 * binary opcode (0x2) it defaults to for Buffer inputs.
 */
function rawDataToString(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return Buffer.from(data as any).toString('utf8');
}

/**
 * Forward one frame from the pod daemon to the browser. Exported for
 * contract tests. See relay-ws.text-frame-contract.test.ts.
 */
export function forwardDaemonFrameToBrowser(
  data: WebSocket.RawData,
  browserWs: Pick<WebSocket, 'readyState' | 'send'>,
): void {
  try {
    if (browserWs.readyState !== WebSocket.OPEN) return;
    const text = rawDataToString(data);
    browserWs.send(text);
  } catch {
    // Best-effort: socket may have closed mid-write. Caller keeps the pipe
    // alive; the next frame (if any) will surface a more specific error.
  }
}

/**
 * Register GET /api/code/v2/ws/chat — the single codemode WS endpoint.
 * Replaces the v2 chat-pipeline-direct handler (being deleted in the
 * same sprint).
 */
export async function registerCodeModeRelayRoute(
  server: FastifyInstance,
  deps: RelayDeps,
): Promise<void> {
  const { logger, redis } = deps;

  server.get('/api/code/v2/ws/chat', { websocket: true } as any, async (connection: any, request: any) => {
    // Read fresh on every connection so projected-secret rotation
    // (#416) takes effect without a pod restart.
    const internalKey = getInternalKey();
    const browserWs: WebSocket = connection?.socket || connection;
    const sessionId = (request.query as any)?.sessionId as string | undefined;
    const authToken = (request.query as any)?.token as string | undefined;

    if (!browserWs || typeof browserWs.send !== 'function') {
      logger.error({ sessionId }, '[codemode-relay] invalid browser socket');
      return;
    }
    if (!sessionId || !authToken) {
      browserWs.close(4001, 'sessionId + token required');
      return;
    }

    // --- AAD / JWT validation (once, at upgrade) -------------------------
    const tokenResult = await validateAnyToken(authToken, { logger });
    if (!tokenResult.isValid || !tokenResult.user) {
      logger.warn({ sessionId, error: tokenResult.error }, '[codemode-relay] invalid token');
      browserWs.close(4001, 'invalid token');
      return;
    }
    const user = tokenResult.user;

    // v1 access gate: isAdmin only. AAD-group gate follows in #218 successor.
    const perms = new UserPermissionsService(prisma, logger);
    const canAccess = await perms.canAccessAwcode(user.userId, user.isAdmin, user.groups || []);
    if (!canAccess) {
      logger.warn({ sessionId, userId: user.userId }, '[codemode-relay] access denied');
      browserWs.close(4003, 'codemode access denied');
      return;
    }

    // --- Session registry lookup / pod provisioning ----------------------
    let entry = await getSessionEntry(redis, sessionId);
    const needsProvision = !entry || entry.status !== 'ready';

    if (needsProvision) {
      // Send immediate "provisioning" frame so the UI renders its single
      // boot screen, not a generic "reconnecting" spinner.
      try {
        browserWs.send(JSON.stringify({
          type: 'system',
          subtype: 'provisioning',
          session_id: sessionId,
        }));
      } catch { /* brief: socket may close before first frame */ }

      try {
        const { podHost, daemonPort, podName } = await provisionPod(
          user.userId,
          sessionId,
          internalKey,
          logger,
          authToken,
          (user as any).email,
        );
        entry = {
          sessionId,
          userId: user.userId,
          podName,
          podHost,
          daemonPort,
          status: 'ready',
          lastActivity: Date.now(),
          createdAt: Date.now(),
        };
        await writeSessionEntry(redis, entry);
      } catch (err: any) {
        logger.error({ err: err.message, sessionId, userId: user.userId }, '[codemode-relay] provision failed');
        try {
          browserWs.send(JSON.stringify({
            type: 'error',
            error: { type: 'pod_provision_failed', message: err.message || 'pod provision failed' },
          }));
        } catch { /* best-effort */ }
        browserWs.close(4500, 'pod provision failed');
        return;
      }
    }

    // --- Connect to pod's openagentic daemon WS ---------------------------
    const daemonWsUrl = `ws://${entry!.podHost}:${entry!.daemonPort}/openagentic/ws?sessionId=${encodeURIComponent(sessionId)}&internalKey=${encodeURIComponent(internalKey)}`;
    let podWs: WebSocket | null = null;
    const bufferDuringConnect: string[] = [];
    let podReady = false;

    const connectPod = (): Promise<void> => new Promise((resolve, reject) => {
      const w = new WebSocket(daemonWsUrl, { handshakeTimeout: POD_CONNECT_TIMEOUT_MS });
      const onOpen = () => { podWs = w; podReady = true; resolve(); };
      const onErr = (e: Error) => reject(e);
      w.once('open', onOpen);
      w.once('error', onErr);
    });

    try {
      await connectPod();
    } catch (err: any) {
      logger.error({ err: err.message, sessionId, daemonWsUrl }, '[codemode-relay] pod daemon connect failed');
      browserWs.close(4502, 'pod daemon unreachable');
      return;
    }

    logger.info({ sessionId, userId: user.userId, podName: entry!.podName }, '[codemode-relay] session connected');

    // --- Byte-pipe both directions ---------------------------------------
    // CRITICAL: we coerce RawData → UTF-8 string so the ws library emits a
    // TEXT frame, not binary. The browser hook's onmessage branches on
    // `typeof event.data === 'string'` and drops anything else — if we
    // forward a Buffer, ws sends it as binary and the browser gets a Blob
    // that the reducer silently discards. See relay-ws.text-frame-contract
    // test for the regression guard.
    podWs!.on('message', (data: WebSocket.RawData) => {
      forwardDaemonFrameToBrowser(data, browserWs);
    });

    browserWs.on('message', (data: WebSocket.RawData) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      // Drop browser-originated keepalive data frames at the relay so the
      // daemon never sees them in its stream-json input pipe (which would
      // otherwise log "unknown frame type" noise into the CLI). The
      // browser sends these every 25s to keep intermediate proxies from
      // closing browser→api as idle while the model is thinking.
      if (text.length < 80 && /"type"\s*:\s*"keepalive"/.test(text)) {
        return;
      }
      // Server-side slash-command interceptor. Recognized commands
      // (/help, /agents, /skills, /mcp, /status, /clear, /cost, /exit
      // and the P1 stubs) emit a synthetic stream-json response back to
      // the browser and DO NOT reach the pod daemon — otherwise they
      // would be sent to the LLM as regular prompts and hallucinated.
      // /model passes through (the daemon already handles it).
      try {
        const intercepted = interceptSlashCommand(text, {
          sessionId,
          userId: user.userId,
          browserWs: browserWs as any,
          logger,
        });
        if (intercepted) return;
      } catch (err) {
        logger.warn({ err, sessionId }, '[codemode-relay] slash interceptor threw, forwarding raw frame');
      }
      if (!podReady || !podWs || podWs.readyState !== WebSocket.OPEN) {
        // Pod not yet ready — buffer the frame for a bounded window.
        bufferDuringConnect.push(text);
        if (bufferDuringConnect.length > 100) {
          bufferDuringConnect.shift(); // protect memory; newest wins
        }
        return;
      }
      // Flush buffer first if we just became ready.
      if (bufferDuringConnect.length > 0) {
        for (const b of bufferDuringConnect.splice(0)) {
          try { podWs.send(b); } catch { /* drop */ }
        }
      }
      try { podWs.send(text); } catch (err) {
        logger.warn({ err }, '[codemode-relay] pod send failed');
      }
      // Sliding-TTL refresh.
      void touchSession(redis, sessionId).catch(() => {});
    });

    // --- Keepalive: pings + DATA-FRAME heartbeat to browser only ---------
    // Pings alone are not enough on the api→browser leg — k8s conntrack
    // `tcp_established` and some intermediate proxies treat WS control
    // frames (ping/pong) as idle and reset at ~5 minutes (observed
    // socket.closed code:1005 duration_ms:302275). Anthropic flags the
    // same pitfall with Cloudflare in openagentic/cli/transports/
    // WebSocketTransport.ts:94. The fix: send a real text DATA frame at
    // every keepalive tick — it counts as activity at every layer. The
    // api→pod leg is in-cluster, no proxies; pings suffice there. The
    // browser sends its own `{type:"keepalive"}` frame (filtered out in
    // browserWs.on('message') above) to keep browser→api alive too.
    const KEEPALIVE_FRAME = '{"type":"keepalive"}\n';
    const keepalive = setInterval(() => {
      try {
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.ping();
          browserWs.send(KEEPALIVE_FRAME);
        }
        if (podWs && podWs.readyState === WebSocket.OPEN) {
          podWs.ping();
        }
      } catch { /* tolerant */ }
    }, KEEPALIVE_INTERVAL_MS);

    // --- Close / error plumbing -----------------------------------------
    const cleanup = (reason: string) => {
      clearInterval(keepalive);
      try { podWs?.close(); } catch { /* tolerant */ }
      try { if (browserWs.readyState === WebSocket.OPEN) browserWs.close(1000, reason); } catch { /* tolerant */ }
    };

    browserWs.on('close', (code: number, reason: Buffer) => {
      logger.info({ sessionId, code, reason: reason.toString() }, '[codemode-relay] browser closed');
      cleanup('browser closed');
    });

    browserWs.on('error', (err: Error) => {
      logger.warn({ err: err.message, sessionId }, '[codemode-relay] browser ws error');
      cleanup('browser error');
    });

    podWs!.on('close', (code: number, reason: Buffer) => {
      // Forward pod close codes to the browser so it knows why.
      //   1000 normal; 4000 upgrade (client should reconnect immediately);
      //   1006 abnormal (network flap) — browser's reconnect backoff handles.
      logger.info({ sessionId, code, reason: reason.toString() }, '[codemode-relay] pod daemon closed');
      try {
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.close(code === 4000 ? 4000 : 1011, reason.toString() || 'pod closed');
        }
      } catch { /* tolerant */ }
      cleanup('pod closed');
    });

    podWs!.on('error', (err: Error) => {
      logger.warn({ err: err.message, sessionId }, '[codemode-relay] pod ws error');
      cleanup('pod error');
    });
  });

  logger.info('[codemode-relay] /api/code/v2/ws/chat registered — CCR-style passthrough');
}
