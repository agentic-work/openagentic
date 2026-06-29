/**
 * Admin tenant default-models + per-provider cost-history routes.
 *
 *   GET    /llm-providers/default-models
 *   PUT    /llm-providers/default-models
 *   POST   /llm-providers/default-models/reset
 *   GET    /llm-providers/default-models/conflicts
 *   GET    /llm-providers/default-models/usage
 *   GET    /llm-providers/:id/cost-history
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import { Prisma } from '@prisma/client';
import { ProviderManager, invalidateAllModelCaches } from '../../../services/llm-providers/ProviderManager.js';
import { ProviderConfigService } from '../../../services/llm-providers/ProviderConfigService.js';
import { encryptAuthConfig, decryptAuthConfig } from '../../../services/llm-providers/CredentialEncryptionService.js';
import { AuditTrail, AuditEventType, AuditSeverity } from '../../../utils/auditTrail.js';
import { credentialAuditService } from '../../../services/CredentialAuditService.js';
import { OllamaProvider } from '../../../services/llm-providers/OllamaProvider.js';
import { AWSBedrockProvider } from '../../../services/llm-providers/AWSBedrockProvider.js';
import { AzureOpenAIProvider } from '../../../services/llm-providers/AzureOpenAIProvider.js';
import { GoogleVertexProvider } from '../../../services/llm-providers/GoogleVertexProvider.js';
import { AnthropicProvider } from '../../../services/llm-providers/AnthropicProvider.js';
import { OpenAIProvider } from '../../../services/llm-providers/OpenAIProvider.js';
import { AzureAIFoundryProvider } from '../../../services/llm-providers/AzureAIFoundryProvider.js';
import type { ProviderDefaultConfig } from '../../../services/llm-providers/ILLMProvider.js';
import type { ModelDiscoveryRecord } from '../../../services/llm-providers/discovery/ModelDiscoveryRecord.js';
import {
  upsertDiscoveredModels,
  type RegistryUpsertPrismaLike,
} from '../../../services/model-routing/RegistryUpsertService.js';
import { shouldAutoSyncRegistry } from '../../../services/model-routing/registryAutoSyncPolicy.js';
import { PricingService } from '../../../services/pricing/PricingService.js';
import {
  validateDiscriminator,
  isGenericName,
  buildAutoDisplayName,
} from '../../../services/llm-providers/ProviderDiscriminatorSchema.js';
import { asJson, asRecord } from './shared.js';
import type {
  ProviderRoutesOptions,
  ProviderConfigBag,
  AuthConfigBag,
  ModelConfigBag,
} from './types.js';
import type { AdminPrismaLike } from '../../../services/model-routing/defaultModelsAdmin.js';


export const defaultModelsRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;
  const auditTrail = new AuditTrail();


  // ==========================================================================
  // Tenant default_models (admin.system_configuration.default_models)
  //
  // Reads/writes the single tenant-default model per mode that ModelRouter
  // falls back to when a chat request has no per-session pin. Source of
  // truth is the DB; helm values seed this on first boot via
  // LLMProviderSeeder, but the admin UI owns live edits.
  // ==========================================================================


  fastify.get('/llm-providers/default-models', async (_request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const { getDefaults } = await import('../../../services/model-routing/defaultModelsAdmin.js');
      const defaults = await getDefaults(prisma as unknown as AdminPrismaLike);
      return reply.send({ defaults });
    } catch (error) {
      logger.error({ error }, '[admin] failed to read default_models');
      return reply.code(500).send({
        error: 'Failed to read default models',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });


  fastify.put<{
    Querystring: { force?: string };
    Body: { chat?: string | null; code?: string | null; embedding?: string | null; vision?: string | null; imageGen?: string | null };
  }>('/llm-providers/default-models', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const { putDefaults } = await import('../../../services/model-routing/defaultModelsAdmin.js');
      const force = (request.query as Record<string, string | undefined>)?.force === 'true';

      const result = await putDefaults(prisma as unknown as AdminPrismaLike, logger, request.body || {}, {
        allowUnregistered: force,
      });

      if (result.ok !== true) {
        return reply.code(result.code).send({ error: result.error, message: result.message, details: result.details });
      }

      // Hot-reload the registry so new chats see the change immediately.
      if (result.changed.length > 0 && providerManager) {
        await invalidateAllModelCaches(logger);
      }

      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: request.user?.id,
        userEmail: request.user?.email,
        action: 'UPDATE_DEFAULT_MODELS',
        resource: 'SystemConfiguration',
        resourceId: 'default_models',
        details: { changed: result.changed, defaults: result.defaults, force },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      return reply.send({ ok: true, defaults: result.defaults, changed: result.changed });
    } catch (error) {
      logger.error({ error }, '[admin] failed to update default_models');
      return reply.code(500).send({
        error: 'Failed to update default models',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });


  // ==========================================================================
  // POST /api/admin/llm-providers/default-models/reset
  //
  // Reset every role → model assignment back to the helm seed values. The
  // seed is whatever the LLMProviderSeeder derived from the deployment env
  // (DEFAULT_MODEL / DEFAULT_CODE_MODEL / DEFAULT_EMBEDDING_MODEL / …) — NOT
  // a hardcoded list. We re-derive that env-default map and persist it as the
  // single tenant default_models row, then hot-reload the model caches so the
  // chat path sees the change immediately.
  //
  // UI: DefaultModelsPage.tsx onReset() → invalidates ['default-models'] and
  // re-reads GET /default-models, which returns { defaults }. Mirror that shape.
  // ==========================================================================
  fastify.post('/llm-providers/default-models/reset', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const { buildDefaultModelsFromEnv } = await import('../../../services/model-routing/defaultModelsEnv.js');
      const { putDefaults } = await import('../../../services/model-routing/defaultModelsAdmin.js');

      // Helm/env-seeded defaults (no hardcoded model ids — sourced from env).
      const seed = buildDefaultModelsFromEnv(process.env);

      // Persist via the same validated path the PUT handler uses. allowUnregistered
      // because the seed may name a model that isn't (yet) in the registry on a
      // fresh cluster — a reset should never fail the operator with a 422.
      const result = await putDefaults(prisma as unknown as AdminPrismaLike, logger, seed, {
        allowUnregistered: true,
        userId: request.user?.id,
      });

      if (result.ok !== true) {
        return reply.code(result.code).send({ error: result.error, message: result.message, details: result.details });
      }

      if (result.changed.length > 0 && providerManager) {
        await invalidateAllModelCaches(logger);
      }

      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: request.user?.id,
        userEmail: request.user?.email,
        action: 'RESET_DEFAULT_MODELS',
        resource: 'SystemConfiguration',
        resourceId: 'default_models',
        details: { changed: result.changed, defaults: result.defaults },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      return reply.send({ ok: true, defaults: result.defaults, changed: result.changed });
    } catch (error) {
      logger.error({ error }, '[admin] failed to reset default_models');
      return reply.code(500).send({
        error: 'Failed to reset default models',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });


  // ==========================================================================
  // GET /api/admin/llm-providers/default-models/conflicts
  //
  // Surface role → model assignments that point at a model NOT present in the
  // enabled Registry (admin.model_role_assignments where enabled=true). These
  // are "stale pins" — the chat path will fall back / error when it can't
  // resolve the pinned model. The Registry membership set is the same SoT used
  // by the PUT validator (loadRegisteredIds).
  //
  // UI: ConflictsPane ConflictRow = { role, model, reason }. We return
  // { conflicts: ConflictRow[] }.
  // ==========================================================================
  fastify.get('/llm-providers/default-models/conflicts', async (_request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const { getDefaults, loadRegisteredIds, MODES } = await import('../../../services/model-routing/defaultModelsAdmin.js');

      const [defaults, registered] = await Promise.all([
        getDefaults(prisma as unknown as AdminPrismaLike),
        loadRegisteredIds(prisma as unknown as AdminPrismaLike),
      ]);

      const conflicts: Array<{ role: string; model: string; reason: string }> = [];
      for (const role of MODES) {
        const model = (defaults as unknown as Record<string, string | null>)[role] as string | null;
        if (typeof model === 'string' && model.trim() !== '') {
          if (!registered.has(model.trim())) {
            conflicts.push({
              role,
              model,
              reason: 'pinned model not in enabled registry',
            });
          }
        }
      }

      return reply.send({ conflicts });
    } catch (error) {
      logger.error({ error }, '[admin] failed to compute default_models conflicts');
      return reply.code(500).send({
        error: 'Failed to compute default-model conflicts',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });


  // ==========================================================================
  // GET /api/admin/llm-providers/default-models/usage?hours=24
  //
  // Per-role usage rollup over the last `hours` (default 24). For each role we
  // resolve its currently-pinned model, then aggregate the LLMRequestLog rows
  // for THAT model id into { model, count, tokens, cost } — the ModelUsageRow
  // shape the RoleDetail UsageTab already consumes.
  //
  // UI: RoleDetail.UsageTab reads row.usage = { count, tokens, cost }. We
  // return { usage: { [role]: ModelUsageRow | null }, windowHours }.
  // ==========================================================================
  fastify.get<{ Querystring: { hours?: string } }>(
    '/llm-providers/default-models/usage',
    async (request, reply) => {
      try {
        const { prisma } = await import('../../../utils/prisma.js');
        const { getDefaults, MODES } = await import('../../../services/model-routing/defaultModelsAdmin.js');

        const hoursRaw = Number.parseInt(String((request.query as Record<string, string | undefined>)?.hours ?? '24'), 10);
        const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= 24 * 90 ? hoursRaw : 24;
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

        const defaults = await getDefaults(prisma as unknown as AdminPrismaLike);

        // Collect the distinct model ids actually pinned to a role, then
        // aggregate the request log once per model.
        const pinnedByRole = new Map<string, string>();
        for (const role of MODES) {
          const m = (defaults as unknown as Record<string, string | null>)[role] as string | null;
          if (typeof m === 'string' && m.trim() !== '') pinnedByRole.set(role, m.trim());
        }

        const distinctModels = Array.from(new Set(pinnedByRole.values()));
        const aggByModel = new Map<string, { count: number; tokens: number; cost: number }>();

        if (distinctModels.length > 0) {
          const grouped = await prisma.lLMRequestLog.groupBy({
            by: ['model'],
            where: {
              model: { in: distinctModels },
              created_at: { gte: cutoff },
            },
            _count: { _all: true },
            _sum: { total_tokens: true, total_cost: true },
          });
          for (const g of grouped as Array<{ model: string; _count?: { _all?: number }; _sum?: { total_tokens?: number; total_cost?: unknown } }>) {
            aggByModel.set(g.model, {
              count: g._count?._all ?? 0,
              tokens: g._sum?.total_tokens ?? 0,
              cost: g._sum?.total_cost != null ? Number(g._sum.total_cost) : 0,
            });
          }
        }

        const usage: Record<string, { model: string; count: number; tokens: number; cost: number } | null> = {};
        for (const role of MODES) {
          const model = pinnedByRole.get(role);
          if (!model) {
            usage[role] = null;
            continue;
          }
          const agg = aggByModel.get(model);
          usage[role] = {
            model,
            count: agg?.count ?? 0,
            tokens: agg?.tokens ?? 0,
            cost: agg?.cost ?? 0,
          };
        }

        return reply.send({ usage, windowHours: hours });
      } catch (error) {
        logger.error({ error }, '[admin] failed to compute default_models usage');
        return reply.code(500).send({
          error: 'Failed to compute default-model usage',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );


  // ==========================================================================
  // GET /api/admin/llm-providers/:id/cost-history?window=30d&groupBy=day
  //
  // Cost / request / token time-series for ONE provider, sourced from
  // LLMRequestLog. :id is the LLMProvider uuid; we resolve it to the provider
  // `name` (and provider_type) and filter the request log by provider_name
  // (falling back to provider_type for older rows written before provider_name
  // was populated). Bucketed by day (default) or hour.
  //
  // UI: llm-providers/CostPane attributes spend per provider; this gives the
  // per-provider series it asks for. Returns
  // { providerId, providerName, groupBy, windowHours, series:[{timestamp,cost,requests,tokens}] }.
  // ==========================================================================
  fastify.get<{ Params: { id: string }; Querystring: { window?: string; groupBy?: string } }>(
    '/llm-providers/:id/cost-history',
    async (request, reply) => {
      try {
        const { prisma } = await import('../../../utils/prisma.js');
        const { id } = request.params;
        if (!id || typeof id !== 'string') {
          return reply.code(400).send({ error: 'id is required' });
        }

        const query = request.query as Record<string, string>;
        const groupBy = (query.groupBy ?? 'day').toLowerCase();
        if (groupBy !== 'day' && groupBy !== 'hour') {
          return reply.code(400).send({ error: 'groupBy must be "day" or "hour"' });
        }
        const hours = windowToHours(query.window, 30 * 24);
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

        const provider = await prisma.lLMProvider.findUnique({
          where: { id },
          select: { id: true, name: true, provider_type: true, display_name: true },
        });
        if (!provider) {
          return reply.code(404).send({ error: 'Provider not found', id });
        }

        // Match by provider_name primarily; provider_type catches legacy rows
        // that predate provider_name population.
        const rows = await prisma.lLMRequestLog.findMany({
          where: {
            created_at: { gte: cutoff },
            OR: [
              { provider_name: provider.name },
              { provider_name: null, provider_type: provider.provider_type },
            ],
          },
          select: {
            created_at: true,
            total_cost: true,
            total_tokens: true,
          },
          orderBy: { created_at: 'asc' },
        });

        const buckets = new Map<string, { cost: number; requests: number; tokens: number }>();
        for (const r of rows as Array<{ created_at: Date; total_cost: unknown; total_tokens: number | null }>) {
          const key = groupBy === 'day' ? dayBucketUTC(r.created_at) : hourBucketUTC(r.created_at);
          const cur = buckets.get(key) ?? { cost: 0, requests: 0, tokens: 0 };
          cur.cost += r.total_cost != null ? Number(r.total_cost) : 0;
          cur.requests += 1;
          cur.tokens += r.total_tokens ?? 0;
          buckets.set(key, cur);
        }

        const series = Array.from(buckets.entries())
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([timestamp, agg]) => ({
            timestamp,
            cost: Number.parseFloat(agg.cost.toFixed(6)),
            requests: agg.requests,
            tokens: agg.tokens,
          }));

        return reply.send({
          providerId: provider.id,
          providerName: provider.display_name || provider.name,
          groupBy,
          windowHours: hours,
          series,
        });
      } catch (error) {
        logger.error({ error }, '[admin] failed to compute provider cost-history');
        return reply.code(500).send({
          error: 'Failed to compute provider cost history',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );

};


// ── Local time-bucket + window helpers (self-contained so this module does not
//    depend on v3-extras.ts internals). UTC day/hour keys, ISO-ish strings. ──
function windowToHours(raw: unknown, def = 24): number {
  if (typeof raw !== 'string') return def;
  const m = raw.trim().toLowerCase().match(/^(\d+)\s*([hdw])$/);
  if (!m) return def;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  const unit = m[2];
  const hours = unit === 'h' ? n : unit === 'd' ? n * 24 : n * 24 * 7;
  // Clamp to a sane ceiling (1 year) so a hostile window can't blow up the query.
  return Math.min(hours, 24 * 365);
}

function dayBucketUTC(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function hourBucketUTC(d: Date): string {
  return `${d.toISOString().slice(0, 13)}:00`; // YYYY-MM-DDTHH:00
}


export default defaultModelsRoutes;
