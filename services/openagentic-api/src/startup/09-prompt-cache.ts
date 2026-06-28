import { RbacSystemPromptService, type RbacRedisLike } from '../services/prompt/RbacSystemPromptService.js';
import { seedRbacSystemPromptsFromFiles } from '../services/prompt/seedRbacSystemPrompts.js';
import { ServicePromptService, seedServicePromptsFromDefaults } from '../services/prompt/ServicePromptService.js';
import { getRedisClient } from '../utils/redis-client.js';
import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

/**
 * Layer-1 of the three-layer prompt architecture (RBAC + dynamic
 * overlay). Loads role-keyed prompts from `rbac_system_prompts`,
 * with file-based seeds in `services/openagentic-api/prompts/chat-system-
 * {admin,member}.md` as source of truth on cold-DB / fresh-deploy.
 *
 * The legacy `CachedPromptService` (DB-backed `PromptTemplate` +
 * `UserPromptAssignment` machinery) was ripped 2026-05-11 along with
 * the schema models, admin UI, and the `11-validate-admin-portal`
 * boot gate that depended on it. Compliance boundary: prompt edits
 * are PR + redeploy, NOT an admin-UI feature (spec Layer-1 hard rule).
 */
export const INIT_PROMPT_CACHE: BootstrapStep = {
  name: 'prompt-cache-init',
  critical: false,
  async run({ ctx }) {
    try {
      const redis = getRedisClient();
      const redisLike: RbacRedisLike | undefined = redis?.isConnected?.()
        ? {
            publish: (channel: string, message: string) => redis.publish(channel, message),
            subscribe: (channel: string, cb) => redis.subscribe(channel, cb),
          }
        : undefined;

      const svc = new RbacSystemPromptService(ctx.deps.prisma, redisLike);
      ctx.rbacSystemPromptService = svc;

      const seedResult = await seedRbacSystemPromptsFromFiles(ctx.deps.prisma);
      loggers.services.info(
        { created: seedResult.created, skipped: seedResult.skipped },
        '✅ RbacSystemPromptService initialized (DB-backed RBAC prompts)',
      );

      if (redisLike) {
        await svc.subscribeInvalidations();
        loggers.services.info('RbacSystemPromptService subscribed to prompt:invalidate redis channel');
      } else {
        loggers.services.warn(
          'RbacSystemPromptService: redis not connected at boot — cache invalidation degrades to TTL-only single-pod',
        );
      }
    } catch (error) {
      loggers.services.warn(
        { err: error },
        '⚠️ RbacSystemPromptService initialization failed (non-critical) — file-based prompt path remains active',
      );
    }

    // -----------------------------------------------------------------------
    // Sprint W (2026-05-19) — ServicePromptService (named service keys)
    // -----------------------------------------------------------------------
    try {
      const redis = getRedisClient();
      const redisLike: RbacRedisLike | undefined = redis?.isConnected?.()
        ? {
            publish: (channel: string, message: string) => redis.publish(channel, message),
            subscribe: (channel: string, cb) => redis.subscribe(channel, cb),
          }
        : undefined;

      const svcPromptSvc = new ServicePromptService(ctx.deps.prisma, redisLike);
      ctx.servicePromptService = svcPromptSvc;

      const seedResult = await seedServicePromptsFromDefaults(ctx.deps.prisma);
      loggers.services.info(
        { created: seedResult.created, skipped: seedResult.skipped },
        '✅ ServicePromptService initialized (DB-backed named service prompts)',
      );

      if (redisLike) {
        await svcPromptSvc.subscribeInvalidations();
        loggers.services.info('ServicePromptService subscribed to service-prompt:invalidate redis channel');
      }
    } catch (error) {
      loggers.services.warn(
        { err: error },
        '⚠️ ServicePromptService initialization failed (non-critical) — inline defaults remain active',
      );
    }
  },
};
