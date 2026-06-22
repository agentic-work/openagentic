/**
 * Memory-AI Routes Plugin — Phase 3.5 of server.ts decomposition.
 *
 * This is the HIGH-LEVEL WRAPPER that groups all memory-ai-domain route
 * registrations behind a single Fastify plugin export.
 *
 * Sub-routes registered here:
 *  1. userMemoryRoutes          — Adaptive user memory system          → /api/user-memory/* (authMiddleware)
 *  2. promptTemplateRoutes      — Prompt template CRUD                 → /api/prompt-templates/*
 *  3. registerPromptComposeRoutes — Internal prompt composition        → /api/internal/prompt/compose
 *  4. memoryVectorPlugin        — Memory & vector database ops         → /api/memories/*
 *  5. advancedPromptingPlugin   — Advanced prompting services          → /api/prompts/*
 *  6. adminPromptingRoutes      — Admin prompting techniques           → /api/admin/prompting/* (adminMiddleware)
 *  7. adminTechniqueRoutes      — Admin AI technique management        → /api/admin/techniques/*
 *  8. (Phase E.4/E.6 RIP) Admin /api/admin/prompts/* removed with the legacy prompt-module registry.
 *  9. sharedKBRoutes            — Admin shared knowledge base          → /api/admin/shared-kb/* (adminMiddleware)
 *
 * Milvus + Redis injection pattern:
 *   Inside the plugin body: read from options first, fall back to AppContext.
 *   AppContext decoration ordering is caller-guaranteed (not Fastify-enforced).
 *
 * All sub-registrations are wrapped in individual try/catch blocks (lesson 4)
 * matching the style established in server.ts so a single failing sub-route never
 * blocks the others.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import type { AppContext } from '../context/AppContext.js';
import { authMiddleware, adminMiddleware } from '../middleware/unifiedAuth.js';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { UnifiedRedisClient } from '../utils/redis-client.js';
import { userMemoryRoutes } from '../routes/user-memory.js';
// prompt-templates + advanced-prompting routes RIPPED 2026-05-11 along with
// the PromptTemplate + UserPromptAssignment schema models (the chat-pipeline refactor Phase E
// final cleanup). RBAC prompts are admin-editable via /admin#rbac-system-prompts
// backed by the `rbac_system_prompts` table.
import { memoryVectorPlugin } from '../routes/memory-vector/index.js';
// adminPromptingRoutes + adminTechniqueRoutes RIPPED 2026-05-11 — depended
// on the legacy PromptTemplate Prisma model + (already-disabled) prompt-
// technique services. RBAC prompts have their own admin route.
// Phase E.4/E.6 (2026-05-10) — `/api/admin/prompts/*` admin route ripped.
// The legacy prompt-module registry + module seeder are deleted; no admin
// surface for editing prompt_modules rows remains. RBAC prompts are
// admin-editable via the `rbac_system_prompts` table
// (`/admin#rbac-system-prompts`).
import sharedKBRoutes from '../routes/admin/shared-kb.js';

// ---------------------------------------------------------------------------
// Plugin options (lesson 3: strongly typed, lesson 6: exported)
// ---------------------------------------------------------------------------

export interface MemoryAIRoutesPluginOptions {
  /**
   * Optional: override milvusClient from AppContext.
   * When undefined the plugin reads ctx.milvusClient from the decorated
   * Fastify instance (fastify.app.milvusClient).
   */
  milvusClient?: MilvusClient;

  /**
   * Optional: override redis from AppContext.
   * When undefined the plugin reads ctx.redis from the decorated
   * Fastify instance (fastify.app.redis). If neither is available,
   * routes that require Redis will degrade gracefully.
   */
  redis?: UnifiedRedisClient;
}

// ---------------------------------------------------------------------------
// The wrapper plugin
// ---------------------------------------------------------------------------

const memoryAIRoutesPluginImpl: FastifyPluginAsync<MemoryAIRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  options: MemoryAIRoutesPluginOptions,
) => {
  loggers.routes.info('Registering memory-ai routes plugin...');

  // Resolve Milvus + Redis — prefer explicit options, fall back to AppContext.
  // AppContext decoration ordering is caller-guaranteed, not Fastify-enforced.
  const ctx: AppContext | undefined = fastify.app;
  const _milvusClient = options.milvusClient ?? ctx?.milvusClient;
  const _redis = options.redis; // no redis on AppContext; fallback is noop

  // ── 1. User Memory routes ────────────────────────────────────────────────
  // Adaptive memory system. Protected by authMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await instance.register(userMemoryRoutes);
    }, { prefix: '/api/user-memory' });
    loggers.routes.info('User Memory routes registered at /api/user-memory/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register user memory routes');
  }

  // ── 2. Prompt Templates routes — RIPPED (the chat-pipeline refactor Phase E final, 2026-05-11) ─
  // The legacy `/api/prompt-templates/*` CRUD + assignment surface is gone
  // along with the `PromptTemplate` + `UserPromptAssignment` schema models.
  // RBAC prompts are admin-editable via the rbac_system_prompts table.

  // ── 3. Internal Prompt Compose routes — REMOVED (Phase E.3) ─────────────
  // The /api/internal/prompt/compose endpoint exposed the legacy DB-module
  // prompt assembler to openagentic-proxy + workflow engine. The RBAC path
  // renders the static prompt locally per chat turn, so no internal RPC
  // surface is needed.

  // ── 4. Memory & Vector Services routes ──────────────────────────────────
  // Manages user memories, contextual relationships, and vector management.
  try {
    await fastify.register(memoryVectorPlugin, { prefix: '/api/memories' });
    loggers.routes.info('Memory & Vector Services routes registered at /api/memories/*, /api/vectors/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register memory & vector services routes');
  }

  // ── 5. Advanced Prompting Services routes — RIPPED (the chat-pipeline refactor Phase E final, 2026-05-11) ─
  // The `/api/prompts/*` surface depended on CachedPromptService/PromptService
  // which are now deleted. RBAC prompts have their own admin route.

  // ── 6/7. Admin Prompting + Technique routes — RIPPED (the chat-pipeline refactor Phase E final, 2026-05-11) ─
  // Depended on the legacy PromptTemplate Prisma model + (already-disabled)
  // prompt-technique services (FewShot/ReAct/SelfConsistency/Directive). RBAC
  // prompts have their own admin route — see /admin#rbac-system-prompts.

  // ── 8. Admin Prompt Modules routes — REMOVED (Phase E.4 / E.6) ──────────
  // The composable prompt-module surface (DB-backed module CRUD + history
  // + preview at /api/admin/prompts/*) is ripped. The RBAC path renders
  // `chat-system-{admin,member}.md` directly; admins edit the base body
  // via the `rbac_system_prompts` table from `/admin#rbac-system-prompts`.

  // ── 9. Admin Shared KB routes ─────────────────────────────────────────────
  // Cluster-wide shared knowledge base CRUD + ingest. Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(sharedKBRoutes);
    }, { prefix: '/api/admin/shared-kb' });
    loggers.routes.info('Admin Shared KB routes registered at /api/admin/shared-kb/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin shared KB routes');
  }

  loggers.routes.info('Memory-AI routes plugin registered successfully');
};

export const memoryAIRoutesPlugin = fp(memoryAIRoutesPluginImpl, {
  name: 'memory-ai-routes',
  // AppContext decoration ordering is caller-guaranteed, not Fastify-enforced.
  dependencies: [],
});
