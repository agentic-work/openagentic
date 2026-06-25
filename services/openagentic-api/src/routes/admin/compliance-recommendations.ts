/**
 * Admin Compliance Findings + Recommendations routes (OSS).
 *
 * These two read-only endpoints back the v4 admin console HomePage KPIs
 * (FedRAMP Findings tile + the operator-advisory recommendations panel).
 * Neither has a backing data source in the OSS build today, so each returns
 * an HONEST EMPTY shape that exactly matches what the UI hooks expect
 * (useComplianceFindings / useRecommendations in useDashboardMetrics.ts) —
 * never a 404, never fabricated data.
 *
 *   GET /api/admin/compliance/findings  → { findings: [], summary: {...zeros} }
 *   GET /api/admin/recommendations      → { success: true, recommendations: [], count: 0 }
 *
 * The shapes are forward-compatible: when a control-evaluation engine /
 * advisory engine is wired in, these handlers can populate the same arrays
 * without any UI change.
 */

import type { FastifyPluginAsync } from 'fastify';

const complianceRecommendationsRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /api/admin/compliance/findings ──────────────────────────────────
  // Matches ComplianceFindingsResponse: { findings?, summary? }.
  fastify.get('/compliance/findings', async (_request, reply) => {
    return reply.send({
      findings: [],
      summary: {
        total: 0,
        open: 0,
        pass: 0,
        warn: 0,
        byStatus: {},
        bySeverity: {},
      },
    });
  });

  // ── GET /api/admin/recommendations ──────────────────────────────────────
  // Matches RecommendationsResponse: { success, recommendations?, count? }.
  fastify.get('/recommendations', async (_request, reply) => {
    return reply.send({
      success: true,
      recommendations: [],
      count: 0,
    });
  });
};

export default complianceRecommendationsRoutes;
