/**
 * /api/admin/slo/* — Phase 12 admin REST.
 *
 * CRUD on SLODefinition rows + live status evaluation against the
 * prom-client default register (where V3MetricsRegistry registered
 * its 21 metrics at module load time).
 *
 * Endpoints (mounted at prefix /api/admin/slo by the plugin):
 *   GET    /                       → list all SLOs
 *   GET    /:metric                → get one SLO
 *   POST   /                       → upsert SLO
 *   PATCH  /:metric/toggle         → flip enabled
 *   DELETE /:metric                → remove SLO
 *   GET    /:metric/status         → live evaluation
 *
 * SECURITY: protected by requireAdminFastify on every route.
 */

import type { FastifyPluginAsync } from 'fastify';
import { register } from 'prom-client';
import { requireAdminFastify } from '../../middleware/adminGuard.js';
import {
  getSLOService,
  type SLODefinition,
} from '../../services/SLOService.js';
import { enterpriseOnly } from '../../middleware/enterpriseOnly.js';

/**
 * Compute a live evaluation of an SLO against the default prom-client
 * registry. Returns `{ met, observation }`:
 *  - met: boolean — true if the SLO threshold is currently being met,
 *         false if breached, true if no observations yet (no data is
 *         not a breach).
 *  - observation: the raw value computed (p99 in seconds, error rate
 *                 0..1, RPS, or null if the metric hasn't been written
 *                 to yet).
 *
 * NOTE: prom-client doesn't expose true windowed quantiles for
 * histograms — `register.getSingleMetric(name).get()` returns the
 * cumulative bucket counts. For Phase 12 we approximate p99 by
 * picking the smallest bucket le that captures >= 99% of observations.
 * This is good enough for the admin status badge; precise windowed
 * quantile evaluation needs a Prometheus query proxy (see
 * /api/admin/prom/* — follow-up task).
 */
function evaluateSLO(slo: SLODefinition): { met: boolean; observation: number | null } {
  try {
    const metric: any = register.getSingleMetric(slo.metric);
    if (!metric) return { met: true, observation: null };

    // Synchronous accessor; prom-client returns a promise on .get() in
    // recent versions, so handle both.
    const snapshot: any = (metric as any).hashMap || metric;

    if (slo.type === 'p99') {
      // Histogram bucket scan.
      const buckets = (metric as any).bucketValues
        ? (metric as any).bucketValues
        : null;
      if (!buckets || Object.keys(buckets).length === 0) {
        return { met: true, observation: null };
      }
      // bucketValues is { '0.05': N, '0.1': N, ...,  '+Inf': N }
      const entries = Object.entries(buckets)
        .map(([k, v]) => [Number(k), Number(v)] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      const total = entries.length ? entries[entries.length - 1][1] : 0;
      if (total === 0) return { met: true, observation: null };
      // First bucket le whose cumulative count reaches >= 99% of total.
      const target = total * 0.99;
      const hit = entries.find(([, count]) => count >= target);
      const p99 = hit ? hit[0] : Number.POSITIVE_INFINITY;
      return {
        met: p99 <= slo.threshold,
        observation: Number.isFinite(p99) ? p99 : null,
      };
    }

    if (slo.type === 'error_rate') {
      const hash = (metric as any).hashMap || {};
      let errors = 0;
      let total = 0;
      for (const key of Object.keys(hash)) {
        const cell = hash[key];
        const labels = cell?.labels || {};
        const value = Number(cell?.value) || 0;
        total += value;
        if (labels.outcome === 'error' || labels.outcome === 'fail') {
          errors += value;
        }
      }
      if (total === 0) return { met: true, observation: null };
      const rate = errors / total;
      return { met: rate <= slo.threshold, observation: rate };
    }

    if (slo.type === 'rps_floor') {
      const hash = (metric as any).hashMap || {};
      let total = 0;
      for (const key of Object.keys(hash)) {
        total += Number(hash[key]?.value) || 0;
      }
      // We don't track exact window-rate; admin UI just gets total
      // count for the floor check. Still informative.
      return { met: total >= slo.threshold, observation: total };
    }

    // Unknown SLO type — be conservative.
    return { met: true, observation: null };
  } catch {
    // Never let metric evaluation break the admin endpoint.
    return { met: true, observation: null };
  }
}

function isValidSLOPayload(body: any): body is SLODefinition {
  return (
    body &&
    typeof body.metric === 'string' &&
    body.metric.length > 0 &&
    ['p99', 'error_rate', 'rps_floor'].includes(body.type) &&
    typeof body.threshold === 'number' &&
    ['1h', '6h', '24h', '7d'].includes(body.window) &&
    typeof body.description === 'string' &&
    typeof body.enabled === 'boolean'
  );
}

export const sloRoutes: FastifyPluginAsync = async (fastify) => {

  // OSS gate — all routes in this plugin return 402 with upgrade_url.
  fastify.addHook('preHandler', enterpriseOnly);
  fastify.get('/', { preHandler: [requireAdminFastify] }, async (_request, reply) => {
    const svc = getSLOService();
    return reply.send({ slos: svc.listSLOs() });
  });

  fastify.get<{ Params: { metric: string } }>(
    '/:metric',
    { preHandler: [requireAdminFastify] },
    async (request, reply) => {
      const svc = getSLOService();
      const slo = svc.getSLO(request.params.metric);
      if (!slo) return reply.code(404).send({ error: 'NotFound', message: 'SLO not found' });
      return reply.send({ slo });
    },
  );

  fastify.post('/', { preHandler: [requireAdminFastify] }, async (request, reply) => {
    const body = request.body as any;
    if (!isValidSLOPayload(body)) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'Invalid SLO payload — required: { metric, type, threshold, window, description, enabled }',
      });
    }
    const svc = getSLOService();
    const saved = svc.upsertSLO(body);
    return reply.send({ slo: saved });
  });

  fastify.patch<{ Params: { metric: string } }>(
    '/:metric/toggle',
    { preHandler: [requireAdminFastify] },
    async (request, reply) => {
      const svc = getSLOService();
      const out = svc.toggleSLO(request.params.metric);
      if (!out) return reply.code(404).send({ error: 'NotFound', message: 'SLO not found' });
      return reply.send({ slo: out });
    },
  );

  fastify.delete<{ Params: { metric: string } }>(
    '/:metric',
    { preHandler: [requireAdminFastify] },
    async (request, reply) => {
      const svc = getSLOService();
      const ok = svc.deleteSLO(request.params.metric);
      if (!ok) return reply.code(404).send({ error: 'NotFound', message: 'SLO not found' });
      return reply.code(204).send();
    },
  );

  fastify.get<{ Params: { metric: string } }>(
    '/:metric/status',
    { preHandler: [requireAdminFastify] },
    async (request, reply) => {
      const svc = getSLOService();
      const slo = svc.getSLO(request.params.metric);
      if (!slo) return reply.code(404).send({ error: 'NotFound', message: 'SLO not found' });
      const { met, observation } = evaluateSLO(slo);
      return reply.send({ slo, met, observation });
    },
  );
};

export default sloRoutes;
