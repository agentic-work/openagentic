/**
 * /api/admin/feedback-advisories/* — Phase 13 admin REST.
 *
 * Returns ADVISORY recommendations from FeedbackLearningService.analyze()
 * over a rolling window. Read-only this phase — Apply lives behind a
 * feature flag and is not implemented in Phase 13 (advisory only).
 *
 * Endpoints (mounted at prefix /api/admin/feedback-advisories):
 *   GET ?window=24h|7d|30d&minEvidence=10  → list AdvisoryRecommendation[]
 *
 * Security: requireAdminFastify on every route.
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireAdminFastify } from '../../middleware/adminGuard.js';
import {
  FeedbackLearningService,
  type AdvisoryRecommendation,
  type AdvisoryWindow,
} from '../../services/FeedbackLearningService.js';
import { FeedbackService } from '../../services/FeedbackService.js';
import { loggers } from '../../utils/logger.js';
import { enterpriseOnly } from '../../middleware/enterpriseOnly.js';

const VALID_WINDOWS: AdvisoryWindow[] = ['24h', '7d', '30d'];

interface ListQuery {
  window?: string;
  minEvidence?: string;
}

export const feedbackAdvisoryRoutes: FastifyPluginAsync = async (fastify) => {

  // OSS gate — all routes in this plugin return 402 with upgrade_url.
  fastify.addHook('preHandler', enterpriseOnly);
  const logger = loggers.routes.child({ module: 'feedback-advisories' });
  const prisma = (fastify as any).prisma;

  fastify.get<{ Querystring: ListQuery }>(
    '/',
    { preHandler: requireAdminFastify },
    async (request, reply) => {
      try {
        const w = (request.query.window ?? '7d') as AdvisoryWindow;
        if (!VALID_WINDOWS.includes(w)) {
          return reply.code(400).send({
            error: `invalid window — must be one of ${VALID_WINDOWS.join(', ')}`,
          });
        }
        const minEvidenceRaw = request.query.minEvidence;
        const minEvidence = minEvidenceRaw ? Math.max(1, Number(minEvidenceRaw) | 0) : 10;

        const feedback = new FeedbackService(prisma);
        const svc = new FeedbackLearningService(
          prisma,
          logger as any,
          feedback,
          // Read-only — analyze() doesn't mutate RouterTuning. Pass null.
          null,
        );

        const recommendations: AdvisoryRecommendation[] = await svc.analyze({
          window: w,
          minEvidence,
        });

        return reply.send({
          window: w,
          minEvidence,
          recommendations,
          generatedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        logger.error({ err: err?.message }, 'Failed to compute feedback advisories');
        return reply
          .code(500)
          .send({ error: 'Failed to compute advisories', details: err?.message });
      }
    },
  );
};
