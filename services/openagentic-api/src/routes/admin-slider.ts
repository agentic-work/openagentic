/**
 * Admin Slider Routes
 *
 * Provides endpoints for managing the intelligence slider:
 * - GET /api/admin/slider - Get current slider value and configuration
 * - PUT /api/admin/slider - Update global slider value
 * - GET /api/admin/slider/user/:userId - Get user-specific slider override
 * - PUT /api/admin/slider/user/:userId - Set user-specific slider override
 * - DELETE /api/admin/slider/user/:userId - Clear user-specific slider override
 *
 * UAT Requirements: P2-001, P2-002, P2-006
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { SliderService } from '../services/SliderService.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { enterpriseOnly } from '../middleware/enterpriseOnly.js';

interface SliderUpdateBody {
  value: number;
  setBy?: string;
}

interface UserIdParams {
  userId: string;
}

export const adminSliderRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // OSS gate — all routes in this plugin return 402 with upgrade_url.
  fastify.addHook('preHandler', enterpriseOnly);
  const logger = loggers.routes;
  const sliderService = new SliderService(prisma, logger);

  /**
   * GET /api/admin/slider
   * Get current global slider value and configuration
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sliderMeta = await sliderService.getGlobalSliderWithMeta();
      const value = sliderMeta?.value ?? 50;

      // Use getSliderConfig to get derived config (since deriveConfig is private)
      const config = await sliderService.getSliderConfig('system');

      return reply.send({
        value,
        setAt: sliderMeta?.setAt ?? new Date().toISOString(),
        setBy: sliderMeta?.setBy ?? 'default',
        config: {
          position: config.position,
          enableThinking: config.enableThinking,
          maxThinkingBudget: config.maxThinkingBudget,
          costWeight: config.costWeight,
          qualityWeight: config.qualityWeight,
          enableCascading: config.enableCascading,
          source: config.source
        },
        tiers: {
          economical: {
            range: '0-40%',
            // Models configured via ECONOMICAL_MODEL env var
            models: [process.env.ECONOMICAL_MODEL || 'See env config'].filter(Boolean),
            thinking: 'Disabled'
          },
          balanced: {
            range: '41-60%',
            // Models configured via BALANCED_MODEL env var
            models: [process.env.BALANCED_MODEL || process.env.DEFAULT_MODEL || 'See env config'].filter(Boolean),
            thinking: '4K-8K tokens'
          },
          premium: {
            range: '61-100%',
            // Models configured via PREMIUM_MODEL env var
            models: [process.env.PREMIUM_MODEL || 'See env config'].filter(Boolean),
            thinking: '8K-32K tokens'
          }
        }
      });
    } catch (error: any) {
      logger.error({ error }, '[Slider] Failed to get slider value');
      return reply.code(500).send({
        error: 'Failed to get slider value',
        message: error.message
      });
    }
  });

  /**
   * PUT /api/admin/slider
   * Update global slider value
   */
  fastify.put<{ Body: SliderUpdateBody }>('/', async (request, reply) => {
    try {
      const { value, setBy } = request.body;
      const user = (request as any).user;
      const adminId = setBy || user?.userId || user?.id || 'system';

      // Get previous value for audit
      const previousMeta = await sliderService.getGlobalSliderWithMeta();
      const previousValue = previousMeta?.value ?? 50;

      // Update slider
      await sliderService.setGlobalSlider(value, adminId);

      // Get new config
      const newMeta = await sliderService.getGlobalSliderWithMeta();
      const config = await sliderService.getSliderConfig('system');

      logger.info({
        previousValue,
        newValue: value,
        setBy: adminId
      }, '[Slider] Global slider updated');

      return reply.send({
        success: true,
        value,
        previousValue,
        setAt: newMeta?.setAt ?? new Date().toISOString(),
        setBy: newMeta?.setBy ?? adminId,
        config: {
          position: config.position,
          enableThinking: config.enableThinking,
          maxThinkingBudget: config.maxThinkingBudget,
          costWeight: config.costWeight,
          qualityWeight: config.qualityWeight
        }
      });
    } catch (error: any) {
      logger.error({ error }, '[Slider] Failed to update slider value');
      return reply.code(500).send({
        error: 'Failed to update slider value',
        message: error.message
      });
    }
  });

  /**
   * GET /api/admin/slider/user/:userId
   * Get user-specific slider override
   */
  fastify.get<{ Params: UserIdParams }>('/user/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      const userSlider = await sliderService.getUserSliderValue(userId);
      const globalMeta = await sliderService.getGlobalSliderWithMeta();
      const globalValue = globalMeta?.value ?? 50;

      const effectiveValue = userSlider.value ?? globalValue;
      const config = await sliderService.getSliderConfig(userId);

      return reply.send({
        userId,
        hasOverride: userSlider.source === 'user',
        userValue: userSlider.source === 'user' ? userSlider.value : null,
        globalValue,
        effectiveValue,
        source: userSlider.source,
        config: {
          position: config.position,
          enableThinking: config.enableThinking,
          maxThinkingBudget: config.maxThinkingBudget,
          source: config.source
        }
      });
    } catch (error: any) {
      logger.error({ error }, '[Slider] Failed to get user slider');
      return reply.code(500).send({
        error: 'Failed to get user slider',
        message: error.message
      });
    }
  });

  /**
   * PUT /api/admin/slider/user/:userId
   * Set user-specific slider override
   */
  fastify.put<{ Params: UserIdParams; Body: SliderUpdateBody }>('/user/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      const { value } = request.body;
      const user = (request as any).user;
      const adminId = user?.userId || user?.id || 'system';

      await sliderService.setUserSlider(userId, value, adminId);
      const config = await sliderService.getSliderConfig(userId);

      logger.info({ userId, value, adminId }, '[Slider] User slider override set');

      return reply.send({
        success: true,
        userId,
        value,
        config: {
          position: config.position,
          enableThinking: config.enableThinking,
          maxThinkingBudget: config.maxThinkingBudget
        }
      });
    } catch (error: any) {
      logger.error({ error }, '[Slider] Failed to set user slider');
      return reply.code(500).send({
        error: 'Failed to set user slider',
        message: error.message
      });
    }
  });

  /**
   * DELETE /api/admin/slider/user/:userId
   * Clear user-specific slider override
   */
  fastify.delete<{ Params: UserIdParams }>('/user/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      const user = (request as any).user;
      const adminId = user?.userId || user?.id || 'system';

      await sliderService.clearUserSlider(userId, adminId);
      const globalMeta = await sliderService.getGlobalSliderWithMeta();
      const globalValue = globalMeta?.value ?? 50;

      logger.info({ userId, adminId }, '[Slider] User slider override cleared');

      return reply.send({
        success: true,
        userId,
        message: 'User slider override cleared',
        globalValue
      });
    } catch (error: any) {
      logger.error({ error }, '[Slider] Failed to clear user slider');
      return reply.code(500).send({
        error: 'Failed to clear user slider',
        message: error.message
      });
    }
  });

  logger.info('Admin Slider routes registered');
};

export default adminSliderRoutes;
