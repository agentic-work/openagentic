/**
 * Router Tuning Admin Routes
 *
 * Admin routes for reading and updating live-configurable SmartModelRouter
 * scoring weights. Mirrors the pattern of admin/pipeline-config.ts.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';
import { prisma } from '../../utils/prisma.js';
import { getRedisClient } from '../../utils/redis-client.js';
import { getRouterTuningService } from '../../services/RouterTuningService.js';
import { getSmartModelRouter } from '../../services/SmartModelRouter.js';

// ---------------------------------------------------------------------------
// Zod schema — strict (no unknown keys), range-checked per spec
// ---------------------------------------------------------------------------

const FloorField = z.number().min(0).max(1);
const MultiplierField = z.number().min(0).max(1000);
const WeightField = z.number().min(0).max(1);

const RouterTuningPatchSchema = z
  .object({
    // FCA floors
    fcaQualityFloor: FloorField.optional(),
    fcaChatPoolFloor: FloorField.optional(),
    fcaSimpleToolFloor: FloorField.optional(),
    fcaComplexToolFloor: FloorField.optional(),
    fcaDestructiveFloor: FloorField.optional(),
    fcaInfraOpsFloor: FloorField.optional(),
    fcaCloudListFloor: FloorField.optional(),
    fcaComplexityBiasFloor: FloorField.optional(),
    // Multipliers / bonus points
    fcaQualityMultiplier: MultiplierField.optional(),
    costBonusMaxPoints: MultiplierField.optional(),
    latencyBonusMaxPoints: MultiplierField.optional(),
    toolCallingBonusMaxPoints: MultiplierField.optional(),
    reasoningBonusMaxPoints: MultiplierField.optional(),
    // Weights
    costWeight: WeightField.optional(),
    qualityWeight: WeightField.optional(),
    // Normalization ceiling: (0, 1]
    costNormalizationCeiling: z.number().gt(0).max(1).optional(),
    // Boolean
    fcaQualityGatedByComplexity: z.boolean().optional(),
    // T2 (#427-#432) — intent classifier toggle + per-intent top-K
    // (consumed by the legacy ranker service). The per-intent FCA floor
    // field that briefly lived alongside these was ripped 2026-05-02 with
    // the viz-tier ladder — the FCA-escalation branches in SmartModelRouter
    // that consumed it are gone.
    intentClassifierEnabled: z.boolean().optional(),
    intentClassifierModelId: z.string().min(1).optional(),
    // Phase E.10 (2026-05-10) — per-intent top-K schema ripped alongside
    // the legacy ranker service (Phase E.2). Discovery via tool_search
    // replaces the per-intent subsetting.
  })
  .strict(); // reject unknown keys

type RouterTuningPatchInput = z.infer<typeof RouterTuningPatchSchema>;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const routerTuningRoutes: FastifyPluginAsync = async (fastify, _opts) => {
  const logger = fastify.log as Logger;

  const redis = getRedisClient();
  const service = getRouterTuningService(prisma, redis);

  /**
   * GET /api/admin/router-tuning
   * Return current router tuning as JSON.
   */
  fastify.get('/router-tuning', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tuning = await service.getTuning();
      return reply.send({
        success: true,
        tuning,
        lastUpdatedAt: (tuning.updated_at instanceof Date ? tuning.updated_at : new Date(tuning.updated_at as any)).toISOString(),
        lastUpdatedBy: tuning.updated_by,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get router tuning');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch router tuning',
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/admin/router-tuning
   * Apply a partial patch. Admin-only (403 for non-admins).
   */
  fastify.put<{ Body: RouterTuningPatchInput }>(
    '/router-tuning',
    async (request: FastifyRequest<{ Body: RouterTuningPatchInput }>, reply: FastifyReply) => {
      // Admin guard
      const user = (request as any).user;
      if (!user?.isAdmin && user?.role !== 'admin') {
        return reply.code(403).send({
          success: false,
          error: 'Forbidden',
          message: 'Admin access required',
        });
      }

      // Validate body with strict Zod schema
      const parsed = RouterTuningPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid router tuning patch',
          message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        });
      }

      try {
        const updatedBy = user?.id || user?.email || 'admin';
        const tuning = await service.updateTuning(parsed.data, updatedBy);

        logger.info({ updatedBy, patch: parsed.data }, 'Router tuning updated');

        return reply.send({
          success: true,
          tuning,
          lastUpdatedAt: (tuning.updated_at instanceof Date ? tuning.updated_at : new Date(tuning.updated_at as any)).toISOString(),
          lastUpdatedBy: tuning.updated_by,
          message: 'Router tuning updated successfully',
        });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update router tuning');
        return reply.code(400).send({
          success: false,
          error: 'Failed to update router tuning',
          message: error.message,
        });
      }
    }
  );

  /**
   * POST /api/admin/router-tuning/reset
   * Restore all tunables to hardcoded defaults. Admin-only.
   */
  fastify.post('/router-tuning/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    // Admin guard
    const user = (request as any).user;
    if (!user?.isAdmin && user?.role !== 'admin') {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    try {
      const updatedBy = user?.id || user?.email || 'admin';
      const tuning = await service.resetToDefaults(updatedBy);

      logger.info({ updatedBy }, 'Router tuning reset to defaults');

      return reply.send({
        success: true,
        tuning,
        lastUpdatedAt: (tuning.updated_at instanceof Date ? tuning.updated_at : new Date(tuning.updated_at as any)).toISOString(),
        lastUpdatedBy: tuning.updated_by,
        message: 'Router tuning reset to defaults',
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to reset router tuning');
      return reply.code(500).send({
        success: false,
        error: 'Failed to reset router tuning',
        message: error.message,
      });
    }
  });
  /**
   * POST /api/admin/router-tuning/simulate
   * Live Scoring Lab — runs the real SmartModelRouter scoring pipeline for a
   * given prompt against the current tuning values and returns the full
   * ranked candidate list + exclusions. No LLM dispatch.
   */
  fastify.post<{ Body: { prompt: string } }>(
    '/router-tuning/simulate',
    async (request: FastifyRequest<{ Body: { prompt: string } }>, reply: FastifyReply) => {
      const user = (request as any).user;
      if (!user?.isAdmin && user?.role !== 'admin') {
        return reply.code(403).send({ success: false, error: 'Forbidden', message: 'Admin access required' });
      }

      const prompt = (request.body?.prompt || '').toString().trim();
      if (!prompt) {
        return reply.code(400).send({ success: false, error: 'Bad request', message: 'prompt is required' });
      }
      if (prompt.length > 20000) {
        return reply.code(400).send({ success: false, error: 'Bad request', message: 'prompt too long (max 20k chars)' });
      }

      try {
        const router = getSmartModelRouter();
        if (!router) {
          return reply.code(503).send({
            success: false,
            error: 'SmartModelRouter unavailable',
            message: 'Router not initialized yet — try again in a moment',
          });
        }

        const result = await router.simulatePrompt(prompt);
        return reply.send({ success: true, ...result });
      } catch (error: any) {
        logger.error({ error: error?.message }, 'Simulate prompt failed');
        return reply.code(500).send({
          success: false,
          error: 'Simulation failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );
};

export default routerTuningRoutes;
