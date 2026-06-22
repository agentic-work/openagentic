/**
 * Prometheus Reverse Proxy for Admin Console
 *
 * Proxies admin PromQL queries to the in-cluster Prometheus so the React UI
 * can fetch same-origin (no CORS) without leaking the monitoring-stack
 * service URL to the browser.
 *
 * Routes:
 *   POST /api/admin/prom/query          { query, time? }
 *   POST /api/admin/prom/query_range    { query, start, end, step }
 *   GET  /api/admin/prom/labels
 *   GET  /api/admin/prom/health         — single-shot reachability probe
 *
 * Destructive-query guard blocks obvious abuse vectors before forwarding.
 *
 * Error handling: when the upstream Prometheus is unreachable (DNS, refused,
 * timeout) we return 503 with a structured `{ error: 'prometheus_unreachable',
 * message: ... }` body so the UI can render a clearer "Cluster Health
 * unavailable — Prometheus unreachable" banner instead of a generic 502.
 * NetworkPolicy egress to monitoring-stack/prometheus is required for the
 * proxy to reach Prom.
 */

import { FastifyPluginAsync } from 'fastify';
import http from 'node:http';
import { requireAdminFastify } from '../../middleware/adminGuard.js';

type QueryBody = { query: string; time?: string | number };
type RangeBody = { query: string; start: string | number; end: string | number; step: string | number };

const DEFAULT_HOST = 'prometheus.monitoring-stack.svc.cluster.local';
const DEFAULT_PORT = 9090;
const UPSTREAM_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 4_000;

/** Block queries that scan all series / touch internal metrics / look obviously malicious. */
function isAllowedQuery(raw: string): boolean {
  const q = raw.trim();
  if (!q) return false;
  // Catch-all scans: {__name__=~".+"} or {__name__=~".*"}
  if (/\{__name__=~"\.\+"\}/.test(q)) return false;
  if (/\{__name__=~"\.\*"\}/.test(q)) return false;
  // Internal / destructive-sounding name prefixes
  if (/^\s*(drop|delete|admin_|clean_|prometheus_tsdb_)/i.test(q)) return false;
  return true;
}

function upstreamBase() {
  return {
    host: process.env.PROMETHEUS_HOST || DEFAULT_HOST,
    port: Number.parseInt(process.env.PROMETHEUS_PORT || String(DEFAULT_PORT), 10),
  };
}

/**
 * Recognize the common "upstream unreachable" Node.js error codes so we can
 * surface 503 + a clear NetworkPolicy hint instead of a generic 502.
 *   ECONNREFUSED — host reachable, port closed (Prom not listening / down)
 *   ENOTFOUND    — DNS lookup failed (in-cluster service not registered)
 *   EAI_AGAIN    — transient DNS failure
 *   ETIMEDOUT    — connection timed out (NetworkPolicy egress denied / partition)
 *   ECONNRESET   — peer closed mid-flight
 *   EHOSTUNREACH — no route to host (NetworkPolicy / route table)
 *   upstream timeout — our manual timeout (also = unreachable)
 */
function isUnreachableError(err: any): boolean {
  if (!err) return false;
  const code = String(err?.code ?? '').toUpperCase();
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH'
  ) {
    return true;
  }
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes('timeout') || msg.includes('unreachable');
}

interface ForwardResult {
  statusCode: number;
  body: string;
  contentType: string;
}

function forward(path: string, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<ForwardResult> {
  const { host, port } = upstreamBase();
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: host, port, path, method: 'GET', headers: { accept: 'application/json' } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 502,
            body: Buffer.concat(chunks).toString('utf8'),
            contentType: String(res.headers['content-type'] || 'application/json'),
          });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('upstream timeout'));
    });
    req.end();
  });
}

/** Returns a 503 reply that names the upstream so operators can act on it. */
function unreachableReply(reply: any, err: any) {
  const { host, port } = upstreamBase();
  return reply.code(503).send({
    error: 'prometheus_unreachable',
    message: `Prometheus at ${host}:${port} is unreachable. Check that monitoring-stack/prometheus is healthy and the api NetworkPolicy allows egress.`,
    code: err?.code ?? null,
    detail: err?.message ?? null,
  });
}

export const promProxyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: QueryBody }>(
    '/query',
    { preHandler: [requireAdminFastify] },
    async (request, reply) => {
      const { query, time } = request.body ?? ({} as QueryBody);
      if (!isAllowedQuery(query ?? '')) {
        return reply.code(400).send({ error: 'bad_request', message: 'empty or disallowed query' });
      }
      const params = new URLSearchParams({ query });
      if (time !== undefined) params.set('time', String(time));
      try {
        const up = await forward(`/api/v1/query?${params.toString()}`);
        if (up.statusCode >= 500) return reply.code(502).send({ error: 'bad_gateway', status: up.statusCode });
        return reply.code(up.statusCode).header('content-type', up.contentType).send(up.body);
      } catch (err: any) {
        request.log.error({ err }, 'prom-proxy /query upstream error');
        if (isUnreachableError(err)) return unreachableReply(reply, err);
        return reply.code(502).send({ error: 'bad_gateway', message: err?.message ?? 'upstream error' });
      }
    },
  );

  fastify.post<{ Body: RangeBody }>(
    '/query_range',
    { preHandler: [requireAdminFastify] },
    async (request, reply) => {
      const { query, start, end, step } = request.body ?? ({} as RangeBody);
      if (!isAllowedQuery(query ?? '')) {
        return reply.code(400).send({ error: 'bad_request', message: 'empty or disallowed query' });
      }
      if (start === undefined || end === undefined || step === undefined) {
        return reply.code(400).send({ error: 'bad_request', message: 'start/end/step required' });
      }
      const params = new URLSearchParams({
        query,
        start: String(start),
        end: String(end),
        step: String(step),
      });
      try {
        const up = await forward(`/api/v1/query_range?${params.toString()}`);
        if (up.statusCode >= 500) return reply.code(502).send({ error: 'bad_gateway', status: up.statusCode });
        return reply.code(up.statusCode).header('content-type', up.contentType).send(up.body);
      } catch (err: any) {
        request.log.error({ err }, 'prom-proxy /query_range upstream error');
        if (isUnreachableError(err)) return unreachableReply(reply, err);
        return reply.code(502).send({ error: 'bad_gateway', message: err?.message ?? 'upstream error' });
      }
    },
  );

  fastify.get(
    '/labels',
    { preHandler: [requireAdminFastify] },
    async (request, reply) => {
      try {
        const up = await forward(`/api/v1/labels`);
        if (up.statusCode >= 500) return reply.code(502).send({ error: 'bad_gateway', status: up.statusCode });
        return reply.code(up.statusCode).header('content-type', up.contentType).send(up.body);
      } catch (err: any) {
        request.log.error({ err }, 'prom-proxy /labels upstream error');
        if (isUnreachableError(err)) return unreachableReply(reply, err);
        return reply.code(502).send({ error: 'bad_gateway', message: err?.message ?? 'upstream error' });
      }
    },
  );

  /**
   * GET /api/admin/prom/health — single-shot Prometheus reachability probe.
   * Mirrors the failure surface of /query but uses /-/healthy with a tighter
   * timeout. UI calls this once on InfraPane mount to decide whether to show
   * the "Prometheus unreachable" banner with NetworkPolicy hint.
   *
   * 200 { ok: true, base, latencyMs }
   * 503 { ok: false, base, error, code }
   */
  fastify.get(
    '/health',
    { preHandler: [requireAdminFastify] },
    async (request, reply) => {
      const { host, port } = upstreamBase();
      const base = `${host}:${port}`;
      const t0 = Date.now();
      try {
        const up = await forward(`/-/healthy`, HEALTH_TIMEOUT_MS);
        const latencyMs = Date.now() - t0;
        if (up.statusCode >= 200 && up.statusCode < 400) {
          return reply.send({ ok: true, base, latencyMs, statusCode: up.statusCode });
        }
        return reply.code(503).send({
          ok: false,
          base,
          latencyMs,
          error: 'prometheus_unhealthy',
          message: `Prometheus at ${base} returned ${up.statusCode}. Check monitoring-stack/prometheus pod status.`,
          statusCode: up.statusCode,
        });
      } catch (err: any) {
        const latencyMs = Date.now() - t0;
        request.log.warn({ err }, 'prom-proxy /health probe failed');
        return reply.code(503).send({
          ok: false,
          base,
          latencyMs,
          error: 'prometheus_unreachable',
          message: `Prometheus at ${base} is unreachable. Check that monitoring-stack/prometheus is healthy and the api NetworkPolicy allows egress.`,
          code: err?.code ?? null,
          detail: err?.message ?? null,
        });
      }
    },
  );
};
