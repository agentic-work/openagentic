/**
 * Chat Loop Config Admin Routes
 *
 * GET  /api/admin/chat-loop-config   → current { maxTurns }
 * PUT  /api/admin/chat-loop-config   → admin updates maxTurns (range 4..100)
 *
 * Backed by ChatLoopConfigService (SoT: `admin.system_configuration` row
 * keyed `chat_loop`). The validation range here MUST match the service's
 * `MAX_TURNS_FLOOR` / `MAX_TURNS_CEILING` so admin gets a 400 before any
 * DB write attempt — defence in depth, the service also re-validates.
 *
 * Why this route exists: the 2026-05-11 multi-cloud capstone Sev-1
 * (gpt-5.4 hit the prior hardcoded 12-cap during 32-tool cascade
 * fanout) — operators need to lift the cap without a redeploy.
 */
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  getChatLoopConfigService,
  MAX_TURNS_FLOOR,
  MAX_TURNS_CEILING,
} from '../../services/ChatLoopConfigService.js';

const ChatLoopConfigPatchSchema = z
  .object({
    maxTurns: z
      .number()
      .int({ message: `maxTurns must be an integer in [${MAX_TURNS_FLOOR}, ${MAX_TURNS_CEILING}]` })
      .min(MAX_TURNS_FLOOR, {
        message: `maxTurns must be >= ${MAX_TURNS_FLOOR}`,
      })
      .max(MAX_TURNS_CEILING, {
        message: `maxTurns must be <= ${MAX_TURNS_CEILING}`,
      }),
  })
  .strict();

type ChatLoopConfigPatchInput = z.infer<typeof ChatLoopConfigPatchSchema>;

const chatLoopConfigRoutes: FastifyPluginAsync = async (fastify, _opts) => {
  const logger = fastify.log as Logger;
  const service = getChatLoopConfigService();

  // ── GET /api/admin/chat-loop-config ──────────────────────────────────────
  fastify.get('/chat-loop-config', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await service.getConfig();
      return reply.send({
        success: true,
        config,
        meta: {
          maxTurnsFloor: MAX_TURNS_FLOOR,
          maxTurnsCeiling: MAX_TURNS_CEILING,
        },
      });
    } catch (error: any) {
      logger.error({ err: error?.message }, 'Failed to read chat-loop-config');
      return reply.code(500).send({
        success: false,
        error: 'Failed to read chat-loop-config',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ── PUT /api/admin/chat-loop-config ──────────────────────────────────────
  fastify.put<{ Body: ChatLoopConfigPatchInput }>(
    '/chat-loop-config',
    async (
      request: FastifyRequest<{ Body: ChatLoopConfigPatchInput }>,
      reply: FastifyReply,
    ) => {
      const user = (request as any).user;
      if (!user?.isAdmin && user?.role !== 'admin') {
        return reply.code(403).send({
          success: false,
          error: 'Forbidden',
          message: 'Admin access required',
        });
      }

      const parsed = ChatLoopConfigPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid chat-loop-config patch',
          message: parsed.error.errors
            .map((e) => `${e.path.join('.') || '(body)'}: ${e.message}`)
            .join('; '),
        });
      }

      try {
        const updatedBy = user?.id || user?.email || 'admin';
        const config = await service.setMaxTurns(parsed.data.maxTurns, updatedBy);

        logger.info(
          { updatedBy, maxTurns: parsed.data.maxTurns },
          'Chat-loop-config updated',
        );

        return reply.send({
          success: true,
          config,
          message: 'Chat-loop-config updated successfully',
        });
      } catch (error: any) {
        logger.error({ err: error?.message }, 'Failed to update chat-loop-config');
        // The service throws RangeError on invalid input — surface as 400
        // even though the schema already filtered out-of-range values (defence
        // in depth: future validators may diverge).
        const status = error instanceof RangeError ? 400 : 500;
        return reply.code(status).send({
          success: false,
          error: 'Failed to update chat-loop-config',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );
};

export default chatLoopConfigRoutes;
