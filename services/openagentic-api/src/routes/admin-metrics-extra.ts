/**
 * Admin Extra Metrics Routes — dashboard tiles that were 404'ing.
 *
 * Backs the Tier-1 admin dashboard tiles that showed "failed to load":
 *   GET /metrics/llm/performance         — LLM perf KPI summary (LLMRequestLog)
 *   GET /metrics/llm/performance-trends  — same metrics, time-bucketed series
 *   GET /metrics/redis                   — live Redis INFO probe (RedisMetrics)
 *   GET /metrics/milvus                  — live Milvus SDK probe (MilvusMetrics)
 *
 * The prompt-effectiveness tile lives in its own file
 * (routes/admin-prompt-analytics.ts) because it has a pre-existing test
 * contract; it is mounted alongside these by the mount agent.
 *
 * Pattern mirrors routes/admin-audit-log.ts: per-route `onRequest:
 * adminMiddleware`, `import { prisma }` from utils, registered with prefix
 * `/api/admin` so the wire paths are `/api/admin/metrics/*`. All sources are
 * REAL (Prisma `LLMRequestLog`, live Redis, live Milvus) — no synthetic data.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../utils/prisma.js';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { getRedisClient } from '../utils/redis-client.js';
import { getMilvusClient } from '../utils/MilvusConnectionManager.js';
import { loggers } from '../utils/logger.js';

const log = loggers.routes;

// ── helpers ────────────────────────────────────────────────────────────────

/** Clamp+parse the `hours` window (default 24h, max 90d). */
function parseHours(raw: string | undefined): number {
  const h = Number(raw);
  if (!Number.isFinite(h) || h <= 0) return 24;
  return Math.min(h, 24 * 90);
}

/** Nearest-rank percentile over a numeric array. Returns 0 for empty input. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[idx];
}

const avg = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Subset of LLMRequestLog columns the perf rollup needs. */
const PERF_SELECT = {
  time_to_first_token_ms: true,
  total_duration_ms: true,
  latency_ms: true,
  tokens_per_second: true,
  prompt_tokens: true,
  completion_tokens: true,
  total_tokens: true,
  total_cost: true,
  queue_wait_ms: true,
  concurrent_requests: true,
  cache_hit: true,
  status: true,
  model: true,
  request_started_at: true,
} as const;

type PerfRow = {
  time_to_first_token_ms: number | null;
  total_duration_ms: number | null;
  latency_ms: number | null;
  tokens_per_second: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  total_cost: unknown;
  queue_wait_ms: number | null;
  concurrent_requests: number | null;
  cache_hit: boolean;
  status: string;
  model: string;
  request_started_at: Date;
};

/** Decimal | number | null → number. */
function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number((v as any)?.toString?.() ?? v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute the LLM-performance KPI block over a set of rows. Returns the exact
 * `PerformanceKPIs` shape the UI (LLMPerformanceMetrics.tsx) reads.
 */
function computeKpis(rows: PerfRow[]) {
  const ttft = rows.map((r) => r.time_to_first_token_ms).filter((n): n is number => n != null).sort((a, b) => a - b);
  const resp = rows
    .map((r) => r.total_duration_ms ?? r.latency_ms)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const tps = rows.map((r) => r.tokens_per_second).filter((n): n is number => n != null).sort((a, b) => a - b);
  const queue = rows.map((r) => r.queue_wait_ms).filter((n): n is number => n != null).sort((a, b) => a - b);
  const concurrency = rows.map((r) => r.concurrent_requests).filter((n): n is number => n != null);

  const promptToks = rows.map((r) => r.prompt_tokens ?? 0);
  const completionToks = rows.map((r) => r.completion_tokens ?? 0);
  const totalToks = rows.map((r) => r.total_tokens ?? 0);

  const cacheHits = rows.filter((r) => r.cache_hit).length;
  const cacheMisses = rows.length - cacheHits;

  // Per-model rollups.
  const byModel = new Map<string, PerfRow[]>();
  for (const r of rows) {
    const m = r.model || 'unknown';
    if (!byModel.has(m)) byModel.set(m, []);
    byModel.get(m)!.push(r);
  }
  const modelLatencyByModel = [...byModel.entries()].map(([model, rs]) => {
    const lats = rs.map((r) => r.total_duration_ms ?? r.latency_ms).filter((n): n is number => n != null);
    return { model, avgLatency: round1(avg(lats)), count: rs.length };
  });
  const errorRateByModel = [...byModel.entries()].map(([model, rs]) => {
    const errs = rs.filter((r) => r.status !== 'success').length;
    return {
      model,
      errorRate: rs.length > 0 ? round1((errs / rs.length) * 100) : 0,
      totalRequests: rs.length,
    };
  });
  const costByModel = [...byModel.entries()].map(([model, rs]) => ({
    model,
    totalCost: round1(rs.reduce((s, r) => s + num(r.total_cost), 0)),
    count: rs.length,
  }));

  const totalCost = rows.reduce((s, r) => s + num(r.total_cost), 0);

  return {
    avgTTFT: round1(avg(ttft)),
    p50TTFT: round1(percentile(ttft, 50)),
    p95TTFT: round1(percentile(ttft, 95)),
    p99TTFT: round1(percentile(ttft, 99)),
    avgTokensPerSecond: round1(avg(tps)),
    p50TokensPerSecond: round1(percentile(tps, 50)),
    p95TokensPerSecond: round1(percentile(tps, 95)),
    avgResponseTime: round1(avg(resp)),
    p50ResponseTime: round1(percentile(resp, 50)),
    p95ResponseTime: round1(percentile(resp, 95)),
    p99ResponseTime: round1(percentile(resp, 99)),
    totalPromptTokens: promptToks.reduce((s, n) => s + n, 0),
    totalCompletionTokens: completionToks.reduce((s, n) => s + n, 0),
    totalTokens: totalToks.reduce((s, n) => s + n, 0),
    avgPromptTokens: round1(avg(promptToks)),
    avgCompletionTokens: round1(avg(completionToks)),
    modelLatencyByModel,
    errorRateByModel,
    totalCost: round1(totalCost),
    avgCostPerRequest: rows.length > 0 ? totalCost / rows.length : 0,
    costByModel,
    avgConcurrentRequests: round1(avg(concurrency)),
    maxConcurrentRequests: concurrency.length > 0 ? Math.max(...concurrency) : 0,
    avgQueueWait: round1(avg(queue)),
    p95QueueWait: round1(percentile(queue, 95)),
    cacheHitRate: rows.length > 0 ? round1((cacheHits / rows.length) * 100) : 0,
    totalCacheHits: cacheHits,
    totalCacheMisses: cacheMisses,
    requestCount: rows.length,
    errorCount: rows.filter((r) => r.status !== 'success').length,
  };
}

// ── plugin ───────────────────────────────────────────────────────────────

export default async function adminMetricsExtraRoutes(fastify: FastifyInstance) {
  // ── GET /metrics/llm/performance ─────────────────────────────────────────
  // Prisma LLMRequestLog aggregation → { success, timeRange, kpis }.
  fastify.get<{ Querystring: { hours?: string } }>(
    '/metrics/llm/performance',
    { onRequest: adminMiddleware },
    async (request, reply) => {
      const hours = parseHours(request.query.hours);
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      try {
        const rows = (await prisma.lLMRequestLog.findMany({
          where: { request_started_at: { gte: since } },
          select: PERF_SELECT,
        })) as unknown as PerfRow[];

        return reply.send({
          success: true,
          timeRange: { hours, since: since.toISOString() },
          kpis: computeKpis(rows),
        });
      } catch (error: any) {
        log.error({ err: error?.message }, 'Failed to compute LLM performance KPIs');
        return reply.code(500).send({ error: 'Failed to compute LLM performance metrics' });
      }
    },
  );

  // ── GET /metrics/llm/performance-trends ──────────────────────────────────
  // Same metrics, bucketed over time → { success, timeRange, bucketMinutes, trends }.
  fastify.get<{ Querystring: { hours?: string } }>(
    '/metrics/llm/performance-trends',
    { onRequest: adminMiddleware },
    async (request, reply) => {
      const hours = parseHours(request.query.hours);
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      // Aim for ~24-48 buckets across the window; round to a sane minute size.
      const targetBuckets = 24;
      const bucketMinutes = Math.max(1, Math.round((hours * 60) / targetBuckets));
      const bucketMs = bucketMinutes * 60 * 1000;

      try {
        const rows = (await prisma.lLMRequestLog.findMany({
          where: { request_started_at: { gte: since } },
          select: PERF_SELECT,
          orderBy: { request_started_at: 'asc' },
        })) as unknown as PerfRow[];

        const buckets = new Map<number, PerfRow[]>();
        for (const r of rows) {
          const t = r.request_started_at instanceof Date
            ? r.request_started_at.getTime()
            : new Date(r.request_started_at).getTime();
          const key = Math.floor(t / bucketMs) * bucketMs;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(r);
        }

        const trends = [...buckets.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([bucketStart, bRows]) => {
            const ttft = bRows.map((r) => r.time_to_first_token_ms).filter((n): n is number => n != null).sort((a, b) => a - b);
            const resp = bRows.map((r) => r.total_duration_ms ?? r.latency_ms).filter((n): n is number => n != null).sort((a, b) => a - b);
            const tps = bRows.map((r) => r.tokens_per_second).filter((n): n is number => n != null).sort((a, b) => a - b);
            const inputLat = bRows.map((r) => r.queue_wait_ms).filter((n): n is number => n != null);
            return {
              timestamp: new Date(bucketStart).toISOString(),
              requestCount: bRows.length,
              avgTTFT: ttft.length ? round1(avg(ttft)) : null,
              p95TTFT: ttft.length ? round1(percentile(ttft, 95)) : null,
              p99TTFT: ttft.length ? round1(percentile(ttft, 99)) : null,
              avgTokensPerSecond: tps.length ? round1(avg(tps)) : null,
              p95TokensPerSecond: tps.length ? round1(percentile(tps, 95)) : null,
              avgTotalLatency: resp.length ? round1(avg(resp)) : null,
              p95TotalLatency: resp.length ? round1(percentile(resp, 95)) : null,
              p99TotalLatency: resp.length ? round1(percentile(resp, 99)) : null,
              avgInputLatency: inputLat.length ? round1(avg(inputLat)) : null,
              promptTokens: bRows.reduce((s, r) => s + (r.prompt_tokens ?? 0), 0),
              completionTokens: bRows.reduce((s, r) => s + (r.completion_tokens ?? 0), 0),
              totalTokens: bRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0),
              errorCount: bRows.filter((r) => r.status !== 'success').length,
            };
          });

        return reply.send({
          success: true,
          timeRange: { hours, since: since.toISOString() },
          bucketMinutes,
          trends,
        });
      } catch (error: any) {
        log.error({ err: error?.message }, 'Failed to compute LLM performance trends');
        return reply.code(500).send({ error: 'Failed to compute LLM performance trends' });
      }
    },
  );

  // ── GET /metrics/redis ───────────────────────────────────────────────────
  // Live Redis INFO probe → RedisMetrics. Degrades to { connected:false }.
  fastify.get('/metrics/redis', { onRequest: adminMiddleware }, async (request, reply) => {
    try {
      const redis = getRedisClient();
      if (!redis.isConnected() || !(await redis.ping())) {
        return reply.send({ connected: false } satisfies Record<string, unknown>);
      }

      const info = await redis.info();
      const fields: Record<string, string> = {};
      for (const line of info.split(/\r?\n/)) {
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf(':');
        if (eq === -1) continue;
        fields[line.slice(0, eq)] = line.slice(eq + 1);
      }
      const numField = (k: string): number | undefined => {
        const v = fields[k];
        if (v == null) return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      };

      const dbSize = await redis.dbSize();
      const hits = numField('keyspace_hits') ?? 0;
      const misses = numField('keyspace_misses') ?? 0;
      const hitRate = hits + misses > 0 ? round1((hits / (hits + misses)) * 100) : 0;
      const rdbLast = numField('rdb_last_save_time');

      return reply.send({
        connected: true,
        version: fields['redis_version'],
        uptime_seconds: numField('uptime_in_seconds'),
        keys: dbSize ?? undefined,
        memory: {
          used: numField('used_memory'),
          peak: numField('used_memory_peak'),
          total: numField('maxmemory') || numField('total_system_memory'),
          fragmentation_ratio: numField('mem_fragmentation_ratio'),
        },
        hits,
        misses,
        hit_rate: hitRate,
        clients: numField('connected_clients'),
        commands_per_sec: numField('instantaneous_ops_per_sec'),
        evicted_keys: numField('evicted_keys'),
        eviction_policy: fields['maxmemory_policy'],
        aof_enabled: fields['aof_enabled'] === '1' ? true : fields['aof_enabled'] === '0' ? false : undefined,
        rdb_last_save: rdbLast ? new Date(rdbLast * 1000).toISOString() : null,
      });
    } catch (error: any) {
      log.error({ err: error?.message }, 'Failed to probe Redis metrics');
      return reply.send({ connected: false, error: error?.message });
    }
  });

  // ── GET /metrics/milvus ──────────────────────────────────────────────────
  // Live Milvus SDK probe → MilvusMetrics. Degrades to { connected:false }.
  fastify.get('/metrics/milvus', { onRequest: adminMiddleware }, async (request, reply) => {
    try {
      const client = getMilvusClient();
      if (!client) {
        return reply.send({ connected: false, mode: 'unconfigured' });
      }

      const health = await client.checkHealth().catch(() => ({ isHealthy: false }));
      const listResult = await client.listCollections();
      const data = (listResult as any).data || [];
      const names: string[] = data.map((item: any) => (typeof item === 'string' ? item : item.name));

      let totalRows = 0;
      for (const name of names) {
        try {
          const stats = await client.getCollectionStatistics({ collection_name: name });
          totalRows += parseInt((stats as any).data?.row_count || '0', 10) || 0;
        } catch {
          /* per-collection stat failure is non-fatal */
        }
      }

      return reply.send({
        connected: true,
        healthy: !!(health as any).isHealthy,
        collections: names.length,
        inserts: totalRows,
        mode: 'standalone',
      });
    } catch (error: any) {
      log.error({ err: error?.message }, 'Failed to probe Milvus metrics');
      return reply.send({ connected: false, error: error?.message });
    }
  });
}
