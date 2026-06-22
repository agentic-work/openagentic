/**
 * Admin V3 Extras (misc) — six additional read-only endpoints DashboardV3
 * still references but that didn't have a server-side handler.
 *
 * Mirrors the pattern in v3-extras.ts:
 *   - validate inputs
 *   - real Prisma query first; fall back to scanning AdminAuditLog when
 *     no purpose-built model exists; flag the fallback inline.
 *   - 503 when an external dependency (Prometheus, Milvus, Redis) is
 *     unreachable; 500 only on DB error from a Prisma path.
 *   - Always return `{ success: true, ... }` on the happy path so the v3
 *     useAdminQuery hook can consume the envelope without per-page glue.
 *
 * Endpoint map (all read-only, all under `/api/admin`):
 *   1. GET /cluster/health                       — k8s nodes/pods/cpu/memory roll-up
 *   2. GET /storage                              — milvus/pgvector/redis usage summary
 *   3. GET /mcp-logs/histogram?window=24h        — MCP execution-time histogram
 *   4. GET /api-requests/throttles?window=24h    — rate-limit hit counts + top users
 *   5. GET /perf/throughput?window=24h           — tok/s + concurrency rollup
 *   6. GET /router/escalation-triggers?window=24h— what caused router escalations
 *
 * Notes:
 *   - cluster/health uses the same Prometheus host/port convention as
 *     prom-proxy.ts: `PROM_URL` (full URL) wins, then PROMETHEUS_HOST +
 *     PROMETHEUS_PORT. If no PromQL endpoint is reachable we 503.
 *   - storage/Milvus uses `@zilliz/milvus2-sdk-node`; a connection failure
 *     (or missing env) makes that one sub-section null with `error` set,
 *     not a 503 for the whole endpoint — the UI renders the available
 *     halves.
 *   - storage/redis uses the unified Redis client. Memory_mb is sourced
 *     from `INFO memory` via a fresh node-redis client (the unified
 *     wrapper doesn't expose INFO); when that fails we surface
 *     `memory_mb: null`.
 *   - throughput is purely backed by LLMRequestLog (no Prom dependency).
 *   - escalation-triggers reads ModelRoutingDecision; the trigger string
 *     is taken from `context.trigger` first (preferred), `reason` (if it
 *     looks like a slug), or `escalation` synthesized from model_from →
 *     model_to.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';
import { getRedisClient } from '../../utils/redis-client.js';

const logger = loggers.routes.child({ component: 'AdminV3ExtrasMisc' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(Math.floor(n), max));
}

function windowToHours(raw: unknown, def = 24): number {
  if (typeof raw !== 'string') return def;
  const m = raw.trim().toLowerCase().match(/^(\d+)\s*(h|d)?$/);
  if (!m) return def;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  const unit = m[2] ?? 'h';
  return unit === 'd' ? n * 24 : n;
}

function windowCutoff(raw: unknown, def = 24): Date {
  return new Date(Date.now() - windowToHours(raw, def) * 60 * 60 * 1000);
}

function isAdminUser(req: FastifyRequest): boolean {
  const user = (req as any).user;
  return Boolean(user?.isAdmin || user?.role === 'admin');
}

/**
 * Resolve the Prometheus base URL.
 * Priority: process.env.PROM_URL → process.env.PROMETHEUS_URL →
 *           http://${PROMETHEUS_HOST}:${PROMETHEUS_PORT}.
 * Returns null if no env var is set (caller surfaces 503).
 */
function resolvePromBase(): string | null {
  const explicit = process.env.PROM_URL || process.env.PROMETHEUS_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/+$/, '');
  const host = process.env.PROMETHEUS_HOST;
  if (!host) return null;
  const port = process.env.PROMETHEUS_PORT || '9090';
  return `http://${host}:${port}`;
}

interface PromInstantResult {
  resultType: string;
  result: Array<{ metric: Record<string, string>; value: [number, string] }>;
}

interface PromQueryEnvelope {
  status: 'success' | 'error';
  data?: PromInstantResult;
  error?: string;
}

/**
 * Run a single PromQL instant query against the resolved Prometheus
 * endpoint. Returns the parsed envelope or throws — callers decide whether
 * an upstream failure should bubble (503) or be treated as a soft miss.
 */
async function promQuery(base: string, query: string, signal?: AbortSignal): Promise<PromQueryEnvelope> {
  const url = `${base}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { method: 'GET', signal });
  if (!res.ok) {
    throw new Error(`prometheus ${res.status}`);
  }
  return (await res.json()) as PromQueryEnvelope;
}

/** Take the first scalar value from a PromQL instant vector, or null. */
function firstScalar(env: PromQueryEnvelope): number | null {
  if (env.status !== 'success' || !env.data || env.data.result.length === 0) return null;
  const v = env.data.result[0].value[1];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}

// MCP latency buckets per spec.
const MCP_LATENCY_BUCKETS: Array<{ lo: number; hi: number }> = [
  { lo: 0,     hi: 100   },
  { lo: 100,   hi: 500   },
  { lo: 500,   hi: 2_000 },
  { lo: 2_000, hi: 10_000 },
  { lo: 10_000, hi: Number.POSITIVE_INFINITY },
];

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const adminV3ExtrasMiscRoutes: FastifyPluginAsync = async (fastify) => {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. GET /cluster/health
  //    K8s cluster summary derived from Prometheus. Five PromQL instant
  //    queries fan out in parallel; if Prometheus is unreachable we 503
  //    with an explanatory message so the UI renders the empty-state
  //    instead of a fabricated number.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/cluster/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const base = resolvePromBase();
    if (!base) {
      return reply.code(503).send({
        success: false,
        error: 'Prometheus URL not configured',
        hint: 'Set PROM_URL or PROMETHEUS_HOST in the api environment',
      });
    }

    const queries = {
      // Node readiness: count of nodes with kube_node_status_condition{condition="Ready",status="true"}=1
      nodesReady:    'sum(kube_node_status_condition{condition="Ready",status="true"}==1)',
      nodesTotal:    'count(kube_node_info)',
      // Pod phase counts.
      podsRunning:   'sum(kube_pod_status_phase{phase="Running"})',
      podsPending:   'sum(kube_pod_status_phase{phase="Pending"})',
      podsFailed:    'sum(kube_pod_status_phase{phase="Failed"})',
      podsTotal:     'sum(kube_pod_status_phase)',
      // CPU: 1 - mean(rate(idle))
      cpuUsedPct:    '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))',
      cpuCapacity:   'sum(machine_cpu_cores)',
      // Memory: used/total
      memUsedPct:    '100 * (1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))',
      memCapacityGb: 'sum(node_memory_MemTotal_bytes) / 1024 / 1024 / 1024',
    };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    try {
      const entries = Object.entries(queries);
      const results = await Promise.all(
        entries.map(async ([k, q]) => {
          try {
            const env = await promQuery(base, q, ac.signal);
            return [k, firstScalar(env)] as const;
          } catch (err: any) {
            logger.debug({ err: err?.message, k, q }, 'promQuery sub-query failed');
            return [k, null] as const;
          }
        }),
      );
      clearTimeout(timer);

      const m = Object.fromEntries(results) as Record<string, number | null>;

      // If literally every PromQL sub-query failed we treat that as Prom
      // unreachable (503) — otherwise we surface partials.
      const allNull = results.every(([, v]) => v === null);
      if (allNull) {
        return reply.code(503).send({
          success: false,
          error: 'Prometheus unreachable or returned no data',
          base,
        });
      }

      return reply.send({
        success: true,
        nodes: {
          ready: m.nodesReady ?? 0,
          total: m.nodesTotal ?? 0,
        },
        pods: {
          running: m.podsRunning ?? 0,
          pending: m.podsPending ?? 0,
          failed:  m.podsFailed  ?? 0,
          total:   m.podsTotal   ?? 0,
        },
        cpu: {
          used_pct:       m.cpuUsedPct  != null ? Number(m.cpuUsedPct.toFixed(2))  : null,
          capacity_cores: m.cpuCapacity ?? null,
        },
        memory: {
          used_pct:    m.memUsedPct    != null ? Number(m.memUsedPct.toFixed(2))    : null,
          capacity_gb: m.memCapacityGb != null ? Number(m.memCapacityGb.toFixed(2)) : null,
        },
        source: 'prometheus',
      });
    } catch (error: any) {
      clearTimeout(timer);
      logger.error({ err: error }, 'cluster/health Prometheus query failed');
      return reply.code(503).send({
        success: false,
        error: 'Prometheus unreachable',
        message: error?.message ?? 'unknown',
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. GET /storage
  //    Storage summary across the three durable backends:
  //      - milvus   (vector store) — collection count + vector total
  //      - pgvector (in-postgres)  — table count + total rows w/ embeddings
  //      - redis    (cache)        — key count + memory_mb (best-effort INFO)
  //    Each sub-section is independently best-effort; on partial failure
  //    we still return 200 with `error` set on that section so the UI can
  //    render the parts that did work.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/storage', async (_request: FastifyRequest, reply: FastifyReply) => {

    // --- Milvus ----------------------------------------------------------
    const milvusOut: { collections: number; total_vectors: number; error?: string } =
      { collections: 0, total_vectors: 0 };

    try {
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      const milvusHost = process.env.MILVUS_HOST || 'milvus';
      const milvusPort = Number.parseInt(process.env.MILVUS_PORT || '19530', 10);
      const client = new MilvusClient({ address: `${milvusHost}:${milvusPort}`, timeout: 5_000 });
      const list = await (client as any).showCollections({});
      const collections: string[] = (list?.data ?? []).map((c: any) => c?.name).filter(Boolean);
      milvusOut.collections = collections.length;
      // Sum entity counts across collections via getCollectionStatistics.
      let total = 0;
      for (const name of collections) {
        try {
          const stats = await (client as any).getCollectionStatistics({ collection_name: name });
          // SDK returns { stats: [{ key: 'row_count', value: '123' }, ...] } OR
          // { data: { row_count: 123 } } depending on version. Accept both.
          let rowCount: number | null = null;
          if (Array.isArray(stats?.stats)) {
            const rc = stats.stats.find((s: any) => s.key === 'row_count');
            if (rc) rowCount = Number(rc.value);
          } else if (stats?.data?.row_count != null) {
            rowCount = Number(stats.data.row_count);
          }
          if (rowCount != null && Number.isFinite(rowCount)) total += rowCount;
        } catch (err: any) {
          logger.debug({ err: err?.message, name }, 'milvus per-collection stats failed');
        }
      }
      milvusOut.total_vectors = total;
    } catch (err: any) {
      milvusOut.error = err?.message ?? 'milvus unavailable';
      logger.debug({ err: err?.message }, 'milvus storage probe failed');
    }

    // --- pgvector --------------------------------------------------------
    const pgOut: { tables: number; total_rows: number; error?: string } =
      { tables: 0, total_rows: 0 };

    try {
      // Tables containing a halfvec or vector(N) column. Restricted to the
      // public schema (pgvector tables aren't exposed in the admin schema).
      const tableRows: Array<{ relname: string }> = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT c.relname
          FROM pg_attribute a
          JOIN pg_class      c ON a.attrelid = c.oid
          JOIN pg_namespace  n ON c.relnamespace = n.oid
          JOIN pg_type       t ON a.atttypid = t.oid
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND (t.typname = 'halfvec' OR t.typname = 'vector')
           AND NOT a.attisdropped
      `);
      pgOut.tables = tableRows.length;

      // Rough estimate of rows: pg_class.reltuples avoids COUNT(*) on huge tables.
      let totalRows = 0;
      for (const { relname } of tableRows) {
        try {
          const est: Array<{ reltuples: number }> = await prisma.$queryRawUnsafe(
            `SELECT reltuples::bigint AS reltuples FROM pg_class WHERE relname = $1`,
            relname,
          );
          if (est[0]?.reltuples != null) totalRows += Number(est[0].reltuples);
        } catch (err: any) {
          logger.debug({ err: err?.message, relname }, 'pg reltuples lookup failed');
        }
      }
      pgOut.total_rows = totalRows;
    } catch (err: any) {
      pgOut.error = err?.message ?? 'pgvector probe failed';
      logger.debug({ err: err?.message }, 'pgvector storage probe failed');
    }

    // --- Redis -----------------------------------------------------------
    const redisOut: { keys: number; memory_mb: number | null; error?: string } =
      { keys: 0, memory_mb: null };

    try {
      const r = getRedisClient();
      if (!r.isConnected()) {
        redisOut.error = 'redis not connected';
      } else {
        // The unified client doesn't expose INFO; we use its KEYS surface
        // (already namespace-prefixed) for the count and let memory_mb be
        // null until INFO is wired through.
        const keys = await r.keys('*');
        redisOut.keys = keys.length;
        // Best-effort memory: open a temporary plain client and call INFO.
        try {
          const url = process.env.REDIS_URL ||
            `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ''}${process.env.REDIS_HOST || 'openagentic-redis'}:${process.env.REDIS_PORT || '6379'}`;
          const { createClient } = await import('redis');
          const tmp = createClient({ url, socket: { connectTimeout: 3_000 } });
          await tmp.connect();
          try {
            const info = await tmp.info('memory');
            // Find `used_memory:<bytes>` line.
            const m = /^used_memory:(\d+)/m.exec(info);
            if (m) redisOut.memory_mb = Math.round(Number(m[1]) / 1024 / 1024 * 100) / 100;
          } finally {
            await tmp.quit().catch(() => undefined);
          }
        } catch (err: any) {
          logger.debug({ err: err?.message }, 'redis INFO memory probe failed');
        }
      }
    } catch (err: any) {
      redisOut.error = err?.message ?? 'redis probe failed';
      logger.debug({ err: err?.message }, 'redis storage probe failed');
    }

    return reply.send({
      success: true,
      milvus: milvusOut,
      pgvector: pgOut,
      redis: redisOut,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. GET /mcp-logs/histogram?window=24h&buckets=20
  //    Latency histogram of MCP tool calls. Bucket boundaries are fixed
  //    per spec: 0-100ms / 100-500 / 500-2k / 2k-10k / >10k. The `buckets`
  //    query param is honoured for extensibility (capped 1..50) but the
  //    current implementation always returns the 5 spec'd bands so the UI
  //    can render a stable layout.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/mcp-logs/histogram', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const cutoff = windowCutoff(query.window, 24);
    // Clamp `buckets` even though we don't currently subdivide, to keep the
    // contract honest if it ever gets wired up.
    const _buckets = clampInt(query.buckets, 20, 1, 50);
    void _buckets;

    try {
      const rows = await prisma.mCPUsage.findMany({
        where: {
          timestamp: { gte: cutoff },
          execution_time_ms: { not: null },
        },
        select: { execution_time_ms: true },
        take: 200_000,
      });

      const bucketCounts = MCP_LATENCY_BUCKETS.map((b) => ({ lo: b.lo, hi: b.hi, count: 0 }));
      for (const r of rows) {
        const v = r.execution_time_ms ?? 0;
        for (const b of bucketCounts) {
          if (v >= b.lo && v < b.hi) {
            b.count += 1;
            break;
          }
        }
      }

      // Replace +Infinity with null in the JSON response (JSON has no
      // Infinity literal — `Infinity` becomes `null` silently otherwise,
      // but explicit is better).
      const buckets = bucketCounts.map((b) => ({
        lo: b.lo,
        hi: Number.isFinite(b.hi) ? b.hi : null,
        count: b.count,
      }));

      return reply.send({ success: true, buckets, source: 'mcp_usage' });
    } catch (error: any) {
      logger.error({ err: error }, 'mcp-logs/histogram failed');
      return reply.code(500).send({ success: false, error: 'Failed to compute histogram' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. GET /api-requests/throttles?window=24h
  //    Rate-limit hits + top users at quota. Sources, in order of preference:
  //      - RateLimitViolation (purpose-built table)
  //      - LLMRequestLog where rate_limit_hit=true OR status='rate_limited'
  //      - AdminAuditLog where action LIKE '%rate-limit%' (audit fallback)
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/api-requests/throttles', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const cutoff = windowCutoff(query.window, 24);

    try {
      const [violations, llmHits, auditHits] = await Promise.all([
        prisma.rateLimitViolation.findMany({
          where: { created_at: { gte: cutoff } },
          select: { user_id: true, user_email: true, violation_type: true },
          take: 50_000,
        }),
        prisma.lLMRequestLog.findMany({
          where: {
            created_at: { gte: cutoff },
            OR: [
              { rate_limit_hit: true },
              { status: 'rate_limited' },
            ],
          },
          select: { user_id: true },
          take: 50_000,
        }),
        prisma.adminAuditLog.findMany({
          where: {
            created_at: { gte: cutoff },
            OR: [
              { action: { contains: 'rate-limit' } },
              { action: { contains: 'rate_limit' } },
              { action: { contains: 'throttle' } },
            ],
          },
          select: { user: { select: { id: true, email: true } }, details: true },
          take: 50_000,
        }),
      ]);

      // Aggregate hits per user (prefer the structured violation table).
      type UserAgg = { userId: string; email: string; hits: number };
      const map = new Map<string, UserAgg>();

      for (const v of violations) {
        if (!v.user_id) continue;
        const cur = map.get(v.user_id) ?? { userId: v.user_id, email: v.user_email ?? '', hits: 0 };
        cur.hits += 1;
        if (!cur.email && v.user_email) cur.email = v.user_email;
        map.set(v.user_id, cur);
      }
      for (const r of llmHits) {
        if (!r.user_id) continue;
        const cur = map.get(r.user_id) ?? { userId: r.user_id, email: '', hits: 0 };
        cur.hits += 1;
        map.set(r.user_id, cur);
      }
      for (const a of auditHits) {
        const uid = a.user?.id;
        if (!uid) continue;
        const cur = map.get(uid) ?? { userId: uid, email: a.user?.email ?? '', hits: 0 };
        cur.hits += 1;
        map.set(uid, cur);
      }

      // Backfill emails for users that came in via LLM hits without one.
      const missingEmail = [...map.values()].filter((u) => !u.email).map((u) => u.userId);
      if (missingEmail.length > 0) {
        const fetched = await prisma.user.findMany({
          where: { id: { in: missingEmail } },
          select: { id: true, email: true },
        });
        const emailMap = new Map(fetched.map((u) => [u.id, u.email]));
        for (const u of map.values()) {
          if (!u.email) u.email = emailMap.get(u.userId) ?? '';
        }
      }

      const usersAtQuota = [...map.values()]
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 50);

      const throttles      = violations.length + llmHits.length + auditHits.length;
      const rateLimitHits  = violations.length + llmHits.length;

      return reply.send({
        success: true,
        windowHours: windowToHours(query.window, 24),
        throttles,
        rateLimitHits,
        usersAtQuota,
        sources: {
          rateLimitViolation: violations.length,
          llmRequestLog:      llmHits.length,
          adminAuditLog:      auditHits.length,
        },
      });
    } catch (error: any) {
      logger.error({ err: error }, 'api-requests/throttles failed');
      return reply.code(500).send({ success: false, error: 'Failed to compute throttles' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. GET /perf/throughput?window=24h
  //    Tokens-per-second + concurrency rollup. Avg/p95 from the
  //    `tokens_per_second` column on LLMRequestLog; max_concurrency from
  //    `concurrent_requests` (which the LLM logger snapshots at request
  //    start) — falling back to a sliding-window estimate when the column
  //    is null on every row.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/perf/throughput', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const cutoff = windowCutoff(query.window, 24);

    try {
      const rows = await prisma.lLMRequestLog.findMany({
        where: { created_at: { gte: cutoff } },
        select: {
          tokens_per_second: true,
          concurrent_requests: true,
          request_started_at: true,
          request_completed_at: true,
        },
        take: 200_000,
      });

      const tps: number[] = [];
      let maxConcurrencyFromColumn = 0;
      for (const r of rows) {
        if (r.tokens_per_second != null && Number.isFinite(r.tokens_per_second) && r.tokens_per_second > 0) {
          tps.push(r.tokens_per_second);
        }
        if (r.concurrent_requests != null && r.concurrent_requests > maxConcurrencyFromColumn) {
          maxConcurrencyFromColumn = r.concurrent_requests;
        }
      }

      // Fallback: walk the timeline counting overlapping requests when the
      // column is uniformly null.
      let maxConcurrency = maxConcurrencyFromColumn;
      if (maxConcurrency === 0) {
        type Edge = { t: number; delta: number };
        const edges: Edge[] = [];
        for (const r of rows) {
          if (!r.request_started_at) continue;
          const end = r.request_completed_at ?? r.request_started_at;
          edges.push({ t: r.request_started_at.getTime(), delta: 1 });
          edges.push({ t: end.getTime(), delta: -1 });
        }
        edges.sort((a, b) => a.t - b.t);
        let running = 0;
        for (const e of edges) {
          running += e.delta;
          if (running > maxConcurrency) maxConcurrency = running;
        }
      }

      const sortedTps = tps.slice().sort((a, b) => a - b);
      const avg = sortedTps.length > 0
        ? sortedTps.reduce((s, v) => s + v, 0) / sortedTps.length
        : 0;
      const p95 = percentile(sortedTps, 95);

      return reply.send({
        success: true,
        windowHours: windowToHours(query.window, 24),
        tokens_per_sec_avg: Number(avg.toFixed(2)),
        tokens_per_sec_p95: Number(p95.toFixed(2)),
        max_concurrency: maxConcurrency,
        sample: tps.length,
        source: 'llm_request_logs',
      });
    } catch (error: any) {
      logger.error({ err: error }, 'perf/throughput failed');
      return reply.code(500).send({ success: false, error: 'Failed to compute throughput' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. GET /router/escalation-triggers?window=24h
  //    What caused the SmartModelRouter to escalate. We pull
  //    ModelRoutingDecision rows where the context json carries an
  //    explicit escalation flag (context.escalated=true) OR where
  //    model_from→model_to upgrades a tier (anything → claude-sonnet*,
  //    gpt-4*, gemini*-pro etc). The trigger string is taken from
  //    context.trigger first, then context.intent, then `reason`.
  //    For each trigger we report `count` and `avgDelta` (avg score
  //    delta carried in context.scoreDelta when present).
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get('/router/escalation-triggers', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const cutoff = windowCutoff(query.window, 24);

    try {
      const rows = await prisma.modelRoutingDecision.findMany({
        where: { created_at: { gte: cutoff } },
        select: {
          model_from: true,
          model_to:   true,
          reason:     true,
          context:    true,
        },
        take: 50_000,
      });

      type Agg = { count: number; deltaSum: number; deltaCount: number };
      const map = new Map<string, Agg>();

      for (const r of rows) {
        const ctx = (r.context ?? {}) as Record<string, any>;
        const escalated = ctx.escalated === true || (r.model_from && r.model_to && r.model_from !== r.model_to);
        if (!escalated) continue;

        const trigger = (typeof ctx.trigger === 'string' && ctx.trigger.length > 0)
          ? ctx.trigger
          : (typeof ctx.intent === 'string' && ctx.intent.length > 0)
            ? ctx.intent
            : (r.reason || 'unknown');

        const cur = map.get(trigger) ?? { count: 0, deltaSum: 0, deltaCount: 0 };
        cur.count += 1;
        const delta = typeof ctx.scoreDelta === 'number' ? ctx.scoreDelta : null;
        if (delta != null && Number.isFinite(delta)) {
          cur.deltaSum   += delta;
          cur.deltaCount += 1;
        }
        map.set(trigger, cur);
      }

      const triggers = [...map.entries()]
        .map(([trigger, agg]) => ({
          trigger,
          count: agg.count,
          avgDelta: agg.deltaCount > 0
            ? Number((agg.deltaSum / agg.deltaCount).toFixed(4))
            : null,
        }))
        .sort((a, b) => b.count - a.count);

      return reply.send({
        success: true,
        windowHours: windowToHours(query.window, 24),
        triggers,
        sample: rows.length,
        source: 'model_routing_decisions',
      });
    } catch (error: any) {
      logger.error({ err: error }, 'router/escalation-triggers failed');
      return reply.code(500).send({ success: false, error: 'Failed to compute escalation triggers' });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET /notifications — synthesised account-level notifications feed.
  // Phase C2: aggregates recent high-signal events from AdminAuditLog
  // (destructive admin actions) + DLPFinding (high/critical severity)
  // into a single envelope the NotificationsBell consumes. Read-only
  // synthesis — no dedicated `admin_notifications` table needed.
  // ────────────────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { limit?: string } }>(
    '/notifications',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      try {
        const cap = Math.min(50, Math.max(1, Number.parseInt(request.query.limit ?? '20', 10) || 20));
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7d window

        const [audit, dlp] = await Promise.all([
          prisma.adminAuditLog.findMany({
            where: {
              created_at: { gte: since },
              action: { in: ['delete', 'disable', 'kill-switch', 'rotate-secret', 'reset', 'force-logout'] },
            },
            orderBy: { created_at: 'desc' },
            take: cap,
          }).catch(() => []),
          prisma.dLPFinding.findMany({
            where: { timestamp: { gte: since }, severity: { in: ['high', 'critical'] } },
            orderBy: { timestamp: 'desc' },
            take: cap,
          }).catch(() => []),
        ]);

        const items: Array<{
          id: string;
          ts: string;
          level: 'info' | 'warn' | 'err';
          source: 'admin-audit' | 'dlp';
          title: string;
          detail: string;
        }> = [];

        for (const a of audit) {
          const level: 'info' | 'warn' | 'err' =
            a.action === 'kill-switch' || a.action === 'rotate-secret' ? 'warn' : 'info';
          items.push({
            id: `audit:${a.id}`,
            ts: a.created_at.toISOString(),
            level,
            source: 'admin-audit',
            title: `${a.action} · ${a.resource_type}`,
            detail: `${a.admin_email ?? a.admin_user_id ?? 'system'} → ${a.resource_id}`,
          });
        }
        for (const f of dlp) {
          items.push({
            id: `dlp:${f.id}`,
            ts: f.timestamp.toISOString(),
            level: f.severity === 'critical' ? 'err' : 'warn',
            source: 'dlp',
            title: `DLP ${f.severity} · ${f.category}`,
            detail: `rule ${f.rule_id} fired at ${f.scan_point}`,
          });
        }

        items.sort((a, b) => (a.ts < b.ts ? 1 : -1));

        return reply.send({
          success: true,
          window: '7d',
          counts: {
            total: items.length,
            err: items.filter((x) => x.level === 'err').length,
            warn: items.filter((x) => x.level === 'warn').length,
            info: items.filter((x) => x.level === 'info').length,
          },
          items: items.slice(0, cap),
        });
      } catch (error: any) {
        logger.error({ err: error }, 'notifications failed');
        return reply.code(500).send({ success: false, error: 'Failed to load notifications' });
      }
    },
  );

  // Defence-in-depth admin guard — same pattern as v3-extras.ts.
  fastify.addHook('preHandler', async (request, reply): Promise<void> => {
    const user = (request as any).user;
    if (!user) return;
    if (!isAdminUser(request)) {
      reply.code(403).send({ success: false, error: 'Admin access required' });
      return;
    }
  });
};

export default adminV3ExtrasMiscRoutes;
