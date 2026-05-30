/**
 * LLM Provider Management API Routes
 *
 * Admin routes for monitoring and managing LLM providers
 * Requires admin authentication
 */

import { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import { ProviderManager, invalidateAllModelCaches } from '../../services/llm-providers/ProviderManager.js';
import { ProviderConfigService } from '../../services/llm-providers/ProviderConfigService.js';
import { encryptAuthConfig, decryptAuthConfig } from '../../services/llm-providers/CredentialEncryptionService.js';
import { AuditTrail, AuditEventType, AuditSeverity } from '../../utils/auditTrail.js';
import { credentialAuditService } from '../../services/CredentialAuditService.js';
import { OllamaProvider } from '../../services/llm-providers/OllamaProvider.js';
import { AWSBedrockProvider } from '../../services/llm-providers/AWSBedrockProvider.js';
import { AzureOpenAIProvider } from '../../services/llm-providers/AzureOpenAIProvider.js';
import { GoogleVertexProvider } from '../../services/llm-providers/GoogleVertexProvider.js';
import { AnthropicProvider } from '../../services/llm-providers/AnthropicProvider.js';
import { OpenAIProvider } from '../../services/llm-providers/OpenAIProvider.js';
import { AzureAIFoundryProvider } from '../../services/llm-providers/AzureAIFoundryProvider.js';
import type { ProviderDefaultConfig } from '../../services/llm-providers/ILLMProvider.js';
import type { ModelDiscoveryRecord } from '../../services/llm-providers/discovery/ModelDiscoveryRecord.js';
import {
  upsertDiscoveredModels,
  type RegistryUpsertPrismaLike,
} from '../../services/model-routing/RegistryUpsertService.js';
import { shouldAutoSyncRegistry } from '../../services/model-routing/registryAutoSyncPolicy.js';
import { PricingService } from '../../services/pricing/PricingService.js';
import {
  validateDiscriminator,
  isGenericName,
  buildAutoDisplayName,
} from '../../services/llm-providers/ProviderDiscriminatorSchema.js';

interface ProviderRoutesOptions {
  providerManager?: ProviderManager;
}

/**
 * Strip model-list fields from inbound `modelConfig` before persisting.
 *
 * Why: the Add-Provider wizard's Test-Connection step runs `discoverModels()`
 * and (incorrectly) stuffs the catalog into modelConfig.{chatModel,
 * embeddingModel, additionalModels, codeModel, defaultModel}. Storing that
 * verbatim violates the FedRAMP "Registry == explicit add" rule (#459) — a
 * freshly-added provider then appears to "have" 88 phantom models the user
 * never selected.
 *
 * Provider-create persists creds + non-model config only. Models enter the
 * Registry via:
 *   - Admin "Add Model" wizard (POST /llm-providers/:id/models), OR
 *   - Curated-upstream auto-sync (AIF, Ollama) → `upsertDiscoveredModels`,
 *     which writes Registry rows directly (NOT model_config).
 *
 * Exported so the regression test can unit-check it without spinning up the
 * Fastify route module.
 */
/**
 * Recognise embedding-only models so Test Connection doesn't try to run
 * a chat completion against them.
 *
 * Live regression (2026-05-01): user adds the in-cluster ollama-embedding
 * provider — it serves only `nomic-embed-text:latest`. Test Connection
 * picks `models[0]` and calls /api/chat → Ollama returns 400 "model does
 * not support generate." UX surfaces a misleading "400 Bad Request"
 * instead of "this is an embedding-only host."
 *
 * Detection signals (any one is sufficient):
 *   - name / id contains "embed" (case-insensitive)
 *   - family is one of the well-known embedding families (nomic-bert,
 *     mxbai, bge, e5, gte, jina-embed)
 *
 * Capability flags alone are insufficient: Ollama's tag listing returns
 * `capabilities: { chat: true, embeddings: true }` for nomic-embed-text
 * (the chat:true is wrong; the model genuinely doesn't support /api/chat).
 * The name/family heuristic is the load-bearing signal.
 */
export function isEmbeddingOnlyModel(model: any): boolean {
  if (!model || typeof model !== 'object') return false;
  const id = String(model.id ?? model.name ?? '').toLowerCase();
  if (!id) return false;
  if (id.includes('embed')) return true;
  const family = String(model.family ?? model.metadata?.family ?? '').toLowerCase();
  const EMBEDDING_FAMILIES = ['nomic-bert', 'mxbai', 'bge', 'e5', 'gte', 'jina-embed'];
  if (EMBEDDING_FAMILIES.some(f => family === f || family.startsWith(f))) return true;
  return false;
}

export function sanitizeProviderModelConfig(input: any): Record<string, any> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const {
    chatModel: _chatModel,
    embeddingModel: _embeddingModel,
    additionalModels: _additionalModels,
    codeModel: _codeModel,
    defaultModel: _defaultModel,
    ...rest
  } = input;
  return rest;
}

const llmProviderRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;
  const auditTrail = new AuditTrail();

  if (!providerManager) {
    logger.warn('ProviderManager not provided - LLM provider routes will return mock data');
  }

  /**
   * GET /api/admin/llm-providers
   * List all configured providers from database (single source of truth)
   *
   * ARCHITECTURE: Database is the ONLY source of provider configuration.
   * Environment variables are seeded to DB at startup by LLMProviderSeeder.
   */
  fastify.get('/llm-providers', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');

      // Get providers from database ONLY - database is the single source of truth
      // Deduplicate by provider_type — if same type appears multiple times,
      // each gets a contextual display name (hostname, deployment, region)
      const dbProviders = await prisma.lLMProvider.findMany({
        where: { deleted_at: null },
        orderBy: [
          { priority: 'asc' },
          { created_at: 'desc' }
        ]
      });

      // Count providers per type to detect duplicates
      const typeCounts = new Map<string, number>();
      dbProviders.forEach(p => typeCounts.set(p.provider_type, (typeCounts.get(p.provider_type) || 0) + 1));

      // For duplicate types, enrich display_name with context
      for (const p of dbProviders) {
        if ((typeCounts.get(p.provider_type) || 0) > 1) {
          const pc = p.provider_config as any || {};
          const ac = p.auth_config as any || {};
          let ctx = '';
          if (p.provider_type === 'ollama') ctx = pc.host || pc.endpoint || 'localhost';
          else if (p.provider_type.includes('azure')) ctx = pc.deployment || pc.endpoint?.split('.')?.[0] || ac.tenantId || '';
          else if (p.provider_type === 'aws-bedrock') ctx = ac.region || pc.region || 'us-east-1';
          else if (p.provider_type === 'vertex-ai') ctx = pc.projectId || pc.location || '';
          if (ctx) {
            // Bug-fix 2026-05-06: keep `:` in the slug so `host:port`
            // doesn't collapse to `host port` (became `10.0.0.13611434`
            // for the new ollama-dev-win11 provider — confusing). Strip
            // protocol prefix first, then strip everything except a-z,
            // 0-9, and the punctuation that has structural meaning in a
            // URL host (`. - :`).
            const slug = ctx.replace(/https?:\/\//, '').replace(/[^a-z0-9.\-:]/gi, '').slice(0, 40);
            p.display_name = `${p.display_name} (${slug})`;
          }
        }
      }

      // Pull every Registry row in one query so each provider can be
      // enriched with its currently-enabled model list. This replaces
      // the legacy provider_config.models[] iteration (the field is
      // being deleted in favor of admin.model_role_assignments).
      const allRegistryRows = await prisma.modelRoleAssignment.findMany({
        where: { enabled: true },
        select: { provider: true, model: true, capabilities: true, max_tokens: true, description: true },
      });
      const rowsByProvider = new Map<string, typeof allRegistryRows>();
      for (const r of allRegistryRows) {
        const arr = rowsByProvider.get(r.provider) ?? [];
        arr.push(r);
        rowsByProvider.set(r.provider, arr);
      }

      // Convert database providers to consistent format
      const providers = dbProviders.map(p => {
        const providerConfig = p.provider_config as any || {};
        const modelConfig = p.model_config as any || {};
        const authConfig = p.auth_config as any || {};

        // Build models array from model_config
        const models = [];

        // Primary model from modelId or chatModel
        const primaryModel = providerConfig.modelId || modelConfig.chatModel || modelConfig.defaultModel;
        if (primaryModel) {
          models.push({
            id: primaryModel,
            name: primaryModel,
            provider: p.name,
            capabilities: p.capabilities || { chat: true, tools: true, vision: false, embeddings: false },
            maxTokens: modelConfig.maxTokens || modelConfig.contextWindow || modelConfig.maxOutputTokens || 8192
          });
        }

        // Add Registry-enabled rows for this provider (Registry SoT replaces
        // legacy provider_config.models[]).
        const registryRows = rowsByProvider.get(p.name) ?? [];
        for (const r of registryRows) {
          if (!models.find(existing => existing.id === r.model)) {
            models.push({
              id: r.model,
              name: r.description || r.model,
              provider: p.name,
              capabilities: (r.capabilities as any) || {},
              maxTokens: r.max_tokens ?? 8192,
            });
          }
        }

        return {
          id: p.id,
          name: p.name,
          displayName: p.display_name,
          type: p.provider_type,
          enabled: p.enabled,
          priority: p.priority,
          // §11.5 — clients POST this back on edit so we can detect
          // concurrent saves and 409 instead of clobbering.
          version: typeof (p as any).version === 'bigint' ? Number((p as any).version) : Number((p as any).version ?? 1),
          updated_by: p.updated_by ?? null,
          updated_at: p.updated_at,
          config: {
            ...providerConfig,
            ...modelConfig,
            region: authConfig.region
          },
          authConfig: {
            type: authConfig.type || 'none',
            // Don't expose sensitive credentials
            hasApiKey: !!authConfig.apiKey,
            hasCredentials: !!(authConfig.accessKeyId || authConfig.clientId || authConfig.credentials || authConfig.clientSecret || authConfig.serviceAccountKey)
          },
          capabilities: p.capabilities || { chat: true, tools: true, vision: false, streaming: true },
          models
        };
      });

      const totalModels = providers.reduce((sum, p) => sum + (p.models?.length || 0), 0);

      return reply.send({
        providers: providers.map(p => ({
          ...p,
          models: (p.models || []).map((model: any) => ({
            ...model,
            capabilities: model.capabilities || { chat: true, embeddings: false, tools: true, vision: false },
            maxTokens: model.maxTokens || model.contextWindow || model.maxOutputTokens || 8192
          }))
        })),
        totalProviders: providers.length,
        totalModels
      });

    } catch (error) {
      logger.error({ error }, 'Failed to list LLM providers');
      return reply.code(500).send({
        error: 'Failed to list providers',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/health
   * Get health status for all providers
   */
  fastify.get('/llm-providers/health', async (request, reply) => {
    try {
      // Get health from ProviderManager (in-memory initialized providers)
      const healthStatus = providerManager ? await providerManager.getHealthStatus() : new Map();

      const results = Array.from(healthStatus.entries()).map(([name, health]) => ({
        provider: name,
        status: health.status,
        healthy: health.status === 'healthy',
        endpoint: health.endpoint,
        error: health.error,
        lastChecked: health.lastChecked
      }));

      // Also include DB providers not in the ProviderManager
      // This ensures providers with credentials configured show proper status
      try {
        const { prisma } = await import('../../utils/prisma.js');
        const dbProviders = await prisma.lLMProvider.findMany({
          where: { deleted_at: null, enabled: true },
          select: { name: true, provider_type: true, auth_config: true, status: true, provider_config: true }
        });
  
        const knownNames = new Set(results.map(r => r.provider));
        for (const dbp of dbProviders) {
          if (!knownNames.has(dbp.name)) {
            // Provider is in DB but not initialized in ProviderManager
            // Use DB status field as primary indicator (set by test endpoint)
            const dbStatus = dbp.status as string;
            const provConfig = dbp.provider_config as any || {};
            const authConfig = dbp.auth_config as any || {};
            const hasCredentials = !!(authConfig.apiKey || authConfig.key || authConfig.accessKeyId ||
              authConfig.clientId || authConfig.credentials || authConfig.serviceAccountKey ||
              authConfig.endpoint || dbp.provider_type === 'ollama' ||
              authConfig.type === 'service-account' || authConfig.serviceAccountPath);

            // DB status 'active' = healthy (set by successful test)
            const isHealthy = dbStatus === 'active' || (hasCredentials && dbStatus !== 'error');
            const statusLabel = dbStatus === 'active' ? 'healthy' :
                               dbStatus === 'error' ? 'unhealthy' :
                               hasCredentials ? 'healthy' : 'not_initialized';

            results.push({
              provider: dbp.name,
              status: statusLabel,
              healthy: isHealthy,
              endpoint: undefined as any,
              error: !hasCredentials ? 'Provider credentials not configured' :
                     dbStatus === 'error' ? 'Last test failed' : undefined,
              lastChecked: provConfig.lastTestAt || new Date().toISOString()
            });
          }
        }
      } catch (dbErr) {
        logger.warn({ error: dbErr }, 'Failed to augment health with DB providers');
      }

      const allHealthy = results.every(r => r.healthy);

      // The handler successfully assembled the report — that's a 200 even
      // when downstream providers are unhealthy. The `overall` field carries
      // degraded/healthy semantics in the body. 503 is reserved for the
      // catch-block (handler genuinely failed). Returning 503 on degraded
      // made the UI's `if (response.ok)` discard the body and lie "0 healthy"
      // even when 3/4 cards were green. (#367)
      return reply.code(200).send({
        overall: allHealthy ? 'healthy' : 'degraded',
        providers: results,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to check provider health');
      return reply.code(500).send({
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/metrics
   * Get performance metrics for all providers
   */
  fastify.get('/llm-providers/metrics', async (request, reply) => {
    try {
      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider metrics are not available'
        });
      }

      const metrics = providerManager.getMetrics();

      const results = Array.from(metrics.entries()).map(([name, metric]) => ({
        provider: name,
        requests: {
          total: metric.totalRequests,
          successful: metric.successfulRequests,
          failed: metric.failedRequests,
          successRate: metric.totalRequests > 0
            ? ((metric.successfulRequests / metric.totalRequests) * 100).toFixed(2)
            : '0.00'
        },
        performance: {
          averageLatency: Math.round(metric.averageLatency),
          uptime: metric.uptime.toFixed(2)
        },
        usage: {
          totalTokens: metric.totalTokens,
          estimatedCost: metric.totalCost.toFixed(4)
        },
        lastHealthCheck: metric.lastHealthCheck
      }));

      // Calculate aggregate metrics
      const aggregate = {
        totalRequests: results.reduce((sum, r) => sum + r.requests.total, 0),
        totalSuccessful: results.reduce((sum, r) => sum + r.requests.successful, 0),
        totalFailed: results.reduce((sum, r) => sum + r.requests.failed, 0),
        averageLatency: results.length > 0
          ? Math.round(results.reduce((sum, r) => sum + r.performance.averageLatency, 0) / results.length)
          : 0,
        totalTokens: results.reduce((sum, r) => sum + r.usage.totalTokens, 0),
        totalCost: results.reduce((sum, r) => sum + parseFloat(r.usage.estimatedCost), 0).toFixed(4)
      };

      return reply.send({
        providers: results,
        aggregate,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get provider metrics');
      return reply.code(500).send({
        error: 'Failed to get metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/admin/llm-providers/registry/:id
   * #507 — hard-delete a Registry row. Today PATCH only flips enabled, so
   * orphan rows from soft-deleted providers persist forever, polluting the
   * Models page. Surfaced by the painfully scrutinous CRUD UAT (#505).
   *
   * Registry SoT v1 (F2 C-4): the delete is wrapped in a transaction with a
   * tombstone INSERT/UPSERT into model_role_assignment_tombstones so that
   * RegistryBootstrapSeeder + RegistrySyncJob will NOT resurrect the row
   * on the next boot or discovery cycle. Tombstones can be reset via
   * POST /api/admin/registry/tombstones/reset.
   *
   * Returns 204 on success, 404 when the row does not exist.
   */
  fastify.delete<{
    Params: { id: string };
  }>('/llm-providers/registry/:id', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const { id } = request.params;
      const adminUserId = (request as any).user?.id ?? null;

      const existing = await prisma.modelRoleAssignment.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Registry row not found', id });
      }

      // Atomic: tombstone + delete in a single transaction. If the tombstone
      // upsert fails (e.g. unique-constraint race), the row stays — admin
      // can retry. If the row delete fails after the tombstone was inserted,
      // the transaction rolls back and the registry is unchanged.
      await prisma.$transaction(async (tx: any) => {
        // Upsert because admin may have re-added then re-deleted; the second
        // delete must overwrite the older tombstone, not 500 on the
        // (provider_name, model, role) primary-key constraint.
        await tx.modelRoleAssignmentTombstone.upsert({
          where: {
            provider_name_model_role: {
              provider_name: existing.provider,
              model: existing.model,
              role: existing.role,
            },
          },
          create: {
            provider_name: existing.provider,
            model: existing.model,
            role: existing.role,
            deleted_by: adminUserId,
            reason: 'admin_delete_registry_row',
          },
          update: {
            deleted_at: new Date(),
            deleted_by: adminUserId,
            reason: 'admin_delete_registry_row',
          },
        });
        await tx.modelRoleAssignment.delete({ where: { id } });
      });

      return reply.code(204).send();
    } catch (error: any) {
      logger.error({ error: error?.message, id: request.params.id }, 'Failed to delete registry row');
      return reply.code(500).send({
        error: 'Failed to delete registry row',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/registry
   * Task #3: the Model Registry read endpoint. Returns curated rows from
   * admin.model_role_assignments joined with admin.llm_providers so callers
   * (chat toolbar, admin Models page, Smart Router candidate pool) have a
   * single source of truth without reading discoveredCapabilities.
   *
   * Query params:
   *   role=chat|embeddings|reasoning|tool_execution|synthesis|fallback
   *   enabledOnly=true|false (default: true)
   */
  fastify.get<{
    Querystring: { role?: string; enabledOnly?: string; includeDeleted?: string };
  }>('/llm-providers/registry', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const role = request.query.role;
      const enabledOnlyRaw = request.query.enabledOnly;
      // Default = true unless explicitly 'false'
      const enabledOnly = enabledOnlyRaw === undefined ? true : enabledOnlyRaw !== 'false';
      // Phase H: by default, hide rows whose provider is soft-deleted
      // (deleted_at != null). The `?includeDeleted=true` escape hatch keeps
      // them visible for forensic / cleanup workflows.
      const includeDeleted = request.query.includeDeleted === 'true';

      const where: any = {};
      if (role) where.role = role;
      if (enabledOnly) where.enabled = true;

      const rows = await prisma.modelRoleAssignment.findMany({
        where,
        orderBy: [{ provider: 'asc' }, { priority: 'asc' }, { model: 'asc' }],
      });
      const providerNames = Array.from(new Set(rows.map((r: any) => r.provider)));
      const providers = providerNames.length
        ? await prisma.lLMProvider.findMany({
            where: { name: { in: providerNames } },
            select: { name: true, display_name: true, enabled: true, deleted_at: true },
          })
        : [];
      const providerByName = new Map(providers.map(p => [p.name, p as any]));

      // Phase H: drop registry rows whose joined provider is soft-deleted.
      // The Registry table has no FK to LLMProvider, so this filter has to
      // happen in the application layer. Skipped when ?includeDeleted=true
      // so admins can still inspect orphans for cleanup.
      const filteredRows = includeDeleted
        ? rows
        : rows.filter((r: any) => {
            const prov = providerByName.get(r.provider) as any;
            // If we don't have provider metadata, the row is an orphan with
            // no LLMProvider counterpart at all — drop it the same as a
            // soft-deleted one so the registry response is always self-consistent.
            if (!prov) return false;
            return prov.deleted_at == null;
          });

      // Enrichment for Live Scoring Lab / other callers that need routing
      // hints without a second round-trip. Respect SoT rules:
      //   - FCA: from ModelCapabilityRegistry (hand-maintained, is the SoT
      //     for function-calling accuracy scores — registry DB has no
      //     column for this).
      //   - cost: from the Registry row's cost_per_input_token_usd / …_output
      //     (CSP-SDK populated, authoritative). Converted from USD/1M →
      //     USD/1k for UI consumers that think in per-1k terms.
      //   - latency / tokensPerSecond / context window: from MCR (no DB
      //     column today).
      // We do NOT mirror MCR's cost estimates onto the response — the
      // Registry row is SoT for cost, and reviewers flagged the
      // dual-cost-field bug in commit 59a623eb.
      const { getModelCapabilityRegistry } = await import('../../services/ModelCapabilityRegistry.js');
      const capabilityRegistry = getModelCapabilityRegistry();

      const result = filteredRows.map((r: any) => {
        const mcrCaps = capabilityRegistry.getCapabilities(r.model);

        // Registry-row cost columns are USD per 1M tokens (CSP-SDK populated,
        // authoritative when present). Convert to /1k for UI ergonomics.
        // Fall back to MCR estimates when CSP hasn't populated yet so the
        // Lab scoring and Smart Router have SOMETHING to score against.
        // The response exposes one cost field per direction; callers don't
        // have to disambiguate SoT.
        const regInputPer1M = r.cost_per_input_token_usd != null ? Number(r.cost_per_input_token_usd) : null;
        const regOutputPer1M = r.cost_per_output_token_usd != null ? Number(r.cost_per_output_token_usd) : null;
        const inputCostPer1k = regInputPer1M != null ? regInputPer1M / 1000 : (mcrCaps.inputCostPer1k ?? null);
        const outputCostPer1k = regOutputPer1M != null ? regOutputPer1M / 1000 : (mcrCaps.outputCostPer1k ?? null);
        const costSource: 'registry' | 'mcr-estimate' | 'unknown' =
          regInputPer1M != null ? 'registry' : mcrCaps.inputCostPer1k != null ? 'mcr-estimate' : 'unknown';

        return {
          id: r.id,
          model: r.model,
          provider: r.provider,
          role: r.role,
          priority: r.priority,
          enabled: r.enabled,
          temperature: r.temperature,
          max_tokens: r.max_tokens,
          capabilities: r.capabilities ?? {},
          description: r.description,
          options: r.options ?? {},
          provider_display_name: providerByName.get(r.provider)?.display_name ?? r.provider,
          provider_enabled: providerByName.get(r.provider)?.enabled ?? false,
          // Enriched routing hints (see block comment above for SoT split)
          functionCallingAccuracy: mcrCaps.functionCallingAccuracy,
          inputCostPer1k,
          outputCostPer1k,
          costSource,
          avgLatencyMs: mcrCaps.avgLatencyMs,
          tokensPerSecond: mcrCaps.tokensPerSecond,
          maxContextTokens: mcrCaps.maxContextTokens,
          family: mcrCaps.family,
          providerType: mcrCaps.providerType,
          thinking: mcrCaps.thinking,
        };
      });

      return reply.send(result);
    } catch (error: any) {
      logger.error({ error: error?.message }, 'Failed to list registry rows');
      return reply.code(500).send({
        error: 'Failed to list registry',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * PATCH /api/admin/llm-providers/registry/:id
   * Task #5: admin Models page edits a Registry row.
   * Supported body fields: enabled, priority, role, temperature, max_tokens.
   * Any role/priority/temperature/max_tokens edit also flips options.auto=false
   * so the next provider-create sync doesn't clobber the admin's choice.
   */
  fastify.patch<{
    Params: { id: string };
    Body: {
      enabled?: boolean;
      priority?: number;
      role?: string;
      temperature?: number | null;
      max_tokens?: number | null;
    };
  }>('/llm-providers/registry/:id', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const { id } = request.params;
      const existing = await prisma.modelRoleAssignment.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Registry row not found', id });
      }

      const body = request.body || {};
      const data: any = {};
      if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
      if (typeof body.priority === 'number') data.priority = body.priority;
      if (typeof body.role === 'string') data.role = body.role;
      if (body.temperature === null || typeof body.temperature === 'number') data.temperature = body.temperature;
      if (body.max_tokens === null || typeof body.max_tokens === 'number') data.max_tokens = body.max_tokens;

      // Any edit to a config field (role/priority/temp/max_tokens) marks the
      // row as admin-owned so ProviderCreate doesn't overwrite on next sync.
      const structuralEdit =
        typeof body.priority === 'number' ||
        typeof body.role === 'string' ||
        typeof body.temperature !== 'undefined' ||
        typeof body.max_tokens !== 'undefined';
      if (structuralEdit) {
        data.options = { ...((existing.options as any) || {}), auto: false };
      }

      const updated = await prisma.modelRoleAssignment.update({ where: { id }, data });
      return reply.send({ ok: true, row: updated });
    } catch (error: any) {
      logger.error({ error: error?.message, id: request.params.id }, 'Failed to patch registry row');
      return reply.code(500).send({
        error: 'Failed to update registry row',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/:name
   * Get details for a specific provider
   */
  fastify.get<{ Params: { name: string } }>('/llm-providers/:name', async (request, reply) => {
    try {
      const { name } = request.params;

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider details are not available'
        });
      }

      if (!providerManager.hasProvider(name)) {
        return reply.code(404).send({
          error: 'Provider not found',
          message: `Provider '${name}' is not configured`
        });
      }

      const provider = providerManager.getProvider(name);
      const metrics = providerManager.getProviderMetrics(name);
      const health = await provider?.getHealth();
      const models = await provider?.listModels();

      return reply.send({
        provider: name,
        health,
        metrics,
        models,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Failed to get provider details');
      return reply.code(500).send({
        error: 'Failed to get provider details',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/config
   * Get current provider configuration
   */
  fastify.get('/llm-providers/config', async (request, reply) => {
    try {
      const configService = new ProviderConfigService(logger);
      const config = await configService.loadProviderConfig();
      const validation = configService.validateConfig(config);
      const summary = configService.getConfigSummary(config);

      return reply.send({
        config: {
          defaultProvider: config.defaultProvider,
          enableFailover: config.enableFailover,
          failoverTimeout: config.failoverTimeout,
          enableLoadBalancing: config.enableLoadBalancing,
          loadBalancingStrategy: config.loadBalancingStrategy,
          providers: config.providers.map(p => ({
            name: p.name,
            type: p.type,
            enabled: p.enabled,
            priority: p.priority,
            maxTokens: p.config.maxTokens,
            temperature: p.config.temperature
          }))
        },
        validation,
        summary,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get provider configuration');
      return reply.code(500).send({
        error: 'Failed to get configuration',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/:nameOrId/discover-models
   * Discover available models from a provider's SDK/API
   * Accepts either provider name or database UUID
   */
  fastify.get<{
    Params: { nameOrId: string };
  }>('/llm-providers/:nameOrId/discover-models', async (request, reply) => {
    const { nameOrId } = request.params;
    try {
      // Resolve provider by name or ID
      const { prisma } = await import('../../utils/prisma.js');

      // Try by UUID first, then by name
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);
      const dbRecord = isUuid
        ? await prisma.lLMProvider.findFirst({ where: { id: nameOrId, deleted_at: null } })
        : await prisma.lLMProvider.findFirst({ where: { name: nameOrId, deleted_at: null } });

      if (!dbRecord) {
        return reply.code(404).send({ error: 'Provider not found', message: `Provider '${nameOrId}' not found` });
      }

      // Try to use the in-memory provider first
      let models: Array<{ id: string; name: string; provider: string }> = [];

      if (providerManager?.hasProvider(dbRecord.name)) {
        const provider = (providerManager as any).providers?.get(dbRecord.name);
        if (provider) {
          // Prefer discoverModels() for Model Garden (returns full catalog), fall back to listModels()
          if (typeof provider.discoverModels === 'function') {
            models = await provider.discoverModels();
          } else if (typeof provider.listModels === 'function') {
            models = await provider.listModels();
          }
        }
      } else {
        // Create a temp provider instance
        const providerType = dbRecord.provider_type;
        const authConfig = decryptAuthConfig(dbRecord.auth_config as any) || {};
        const providerConfig = (dbRecord.provider_config as any) || {};

        let tempProvider: any = null;
        if (providerType === 'ollama') {
          tempProvider = new OllamaProvider(logger);
        } else if (providerType === 'aws-bedrock') {
          tempProvider = new AWSBedrockProvider(logger);
        } else if (providerType === 'vertex-ai' || providerType === 'google-vertex') {
          tempProvider = new GoogleVertexProvider(logger);
        } else if (providerType === 'azure-openai') {
          tempProvider = new AzureOpenAIProvider(logger);
        } else if (providerType === 'anthropic') {
          tempProvider = new AnthropicProvider(logger);
        } else if (providerType === 'openai') {
          tempProvider = new OpenAIProvider(logger);
        } else if (providerType === 'azure-ai-foundry') {
          tempProvider = new AzureAIFoundryProvider(logger);
        }

        if (tempProvider) {
          try {
            await tempProvider.initialize({ ...authConfig, ...providerConfig });
            // Prefer discoverModels() for Model Garden, fall back to listModels()
            if (typeof tempProvider.discoverModels === 'function') {
              models = await tempProvider.discoverModels();
            } else {
              models = await tempProvider.listModels();
            }
          } catch (initErr) {
            logger.warn({ error: initErr, provider: dbRecord.name }, 'Failed to initialize temp provider for model discovery');
          }
        }
      }

      // (#73) STALENESS FIX: only merge SystemConfiguration stored models when
      // live SDK discovery returned ZERO results. The previous behavior
      // ALWAYS appended stored models, which caused models the admin removed
      // from the provider's own console (Azure portal, AWS console) to keep
      // appearing here forever — because they were also stored via the
      // legacy POST /models flow.
      //
      // For providers with working discoverModels() (which is now all of
      // them: AIF, Bedrock, Vertex, OpenAI, Anthropic, Ollama), the SDK is
      // the single source of truth. SystemConfiguration is only consulted
      // as a defensive fallback when discovery returns empty (e.g., transient
      // 5xx from the provider).
      if (models.length === 0) {
        try {
          const { prisma: prisma2 } = await import('../../utils/prisma.js');
          const configKey = `llm_provider_${dbRecord.name}_models`;
          const storedConfig = await prisma2.systemConfiguration.findFirst({ where: { key: configKey } });
          if (storedConfig?.value) {
            const storedModels = (storedConfig.value as any).models || [];
            for (const sm of storedModels) {
              if (sm.id) {
                models.push({
                  id: sm.id,
                  name: sm.name || sm.id,
                  provider: dbRecord.name,
                  ...(sm.capabilities && { capabilities: sm.capabilities }),
                  ...(sm.maxTokens && { maxTokens: sm.maxTokens }),
                  ...(sm.contextWindow && { contextWindow: sm.contextWindow }),
                  ...(sm.description && { description: sm.description }),
                } as any);
              }
            }
            logger.warn(
              { provider: dbRecord.name, fellBackToStored: storedModels.length },
              'Live discovery returned empty — fell back to SystemConfiguration. Provider may be unreachable.'
            );
          }
        } catch (mergeErr) {
          logger.debug({ error: mergeErr }, 'Failed to load SystemConfiguration fallback (non-fatal)');
        }
      }

      // Enrich models with tier classification
      function guessTier(modelId: string): 'economy' | 'balanced' | 'premium' {
        const m = modelId.toLowerCase();
        if (m.includes('opus') || m.includes('o1') || m.includes('o3') || m.includes('ultra') || m.includes('pro')) return 'premium';
        if (m.includes('haiku') || m.includes('mini') || m.includes('flash') || m.includes('lite') || m.includes('nano') || m.includes('small') || m.includes('embed') || m.includes('titan-text-lite')) return 'economy';
        return 'balanced';
      }

      const enrichedModels = models.map((m: any) => ({
        ...m,
        tier: m.tier || guessTier(m.id || m.name || ''),
      }));

      // Registry policy (user-directed): ONLY admin-added models live in
      // provider_config.models[]. The /discover response is a READ-ONLY
      // catalog view for the UI's Add-Model dropdown — it MUST NOT write
      // back to the registry. Previously this endpoint auto-persisted the
      // full discovered catalog (117 entries for Bedrock alone) which
      // bypassed the explicit-add gate. Registry remains authoritative.
      //
      // Stamp a lastDiscoveryAt so the UI can show "catalog refreshed X
      // min ago" without touching the models array itself.
      (async () => {
        try {
          const existingConfig = (dbRecord.provider_config as any) || {};
          await prisma.lLMProvider.update({
            where: { id: dbRecord.id },
            data: {
              provider_config: {
                ...existingConfig,
                lastDiscoveryAt: new Date().toISOString(),
              },
            },
          });
        } catch (persistErr) {
          logger.warn({ error: persistErr, provider: dbRecord.name }, 'Failed to stamp lastDiscoveryAt (non-fatal)');
        }
      })();

      return reply.send({
        provider: dbRecord.name,
        providerId: dbRecord.id,
        providerType: dbRecord.provider_type,
        models: enrichedModels.map((m: any) => m.id || m.name),
        modelDetails: enrichedModels,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, provider: nameOrId }, 'Failed to discover models');
      return reply.code(500).send({
        error: 'Model discovery failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/:name/test
   * Comprehensive test of provider capabilities
   */
  fastify.post<{
    Params: { name: string };
    Body: {
      testType?: 'basic' | 'streaming' | 'tools' | 'vision' | 'all';
      prompt?: string;
      imageUrl?: string;
      maxTokens?: number;
      model?: string;
    };
  }>('/llm-providers/:name/test', async (request, reply) => {
    try {
      const { name } = request.params;
      const {
        testType = 'basic',
        prompt = 'Say "Hello, World!" and nothing else.',
        imageUrl,
        maxTokens: userMaxTokens,
        model: userModel,
      } = request.body || {};

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider testing is not available'
        });
      }

      // Check if provider is loaded in memory; if not, try reload
      let providerInMemory = providerManager.hasProvider(name);
      if (!providerInMemory) {
        logger.info({ provider: name }, 'Provider not found in memory, reloading from database');
        await invalidateAllModelCaches(logger);
        providerInMemory = providerManager.hasProvider(name);
      }

      // If still not in memory, check DB directly — provider may have failed initialization
      // but admin should still be able to test connectivity
      let tempProvider: any = null;
      let initError: string | null = null;
      if (!providerInMemory) {
        try {
          const { prisma } = await import('../../utils/prisma.js');
          const dbRecord = await prisma.lLMProvider.findFirst({
            where: { name, deleted_at: null }
          });
    
          if (!dbRecord) {
            return reply.code(404).send({
              error: 'Provider not found',
              message: `Provider '${name}' does not exist in the database.`
            });
          }

          // Provider exists in DB but failed to initialize — try creating a temp instance
          logger.info({ provider: name, type: dbRecord.provider_type }, 'Provider exists in DB but not in memory. Creating temp instance for test...');
          const configService = new ProviderConfigService(logger);
          const providerConfig = (configService as any).convertDatabaseProvider(dbRecord);

          // Create provider instance without full ProviderManager
          const providerType = providerConfig.type;
          if (providerType === 'ollama') {
            const { OllamaProvider } = await import('../../services/llm-providers/OllamaProvider.js');
            tempProvider = new OllamaProvider(logger);
          } else if (providerType === 'aws-bedrock') {
            const { AWSBedrockProvider } = await import('../../services/llm-providers/AWSBedrockProvider.js');
            tempProvider = new AWSBedrockProvider(logger);
          } else if (providerType === 'vertex-ai' || providerType === 'google-vertex') {
            const { GoogleVertexProvider } = await import('../../services/llm-providers/GoogleVertexProvider.js');
            tempProvider = new GoogleVertexProvider(logger);
          } else if (providerType === 'azure-openai') {
            const { AzureOpenAIProvider } = await import('../../services/llm-providers/AzureOpenAIProvider.js');
            tempProvider = new AzureOpenAIProvider(logger);
          } else if (providerType === 'anthropic') {
            const { AnthropicProvider } = await import('../../services/llm-providers/AnthropicProvider.js');
            tempProvider = new AnthropicProvider(logger);
          } else if (providerType === 'openai') {
            const { OpenAIProvider } = await import('../../services/llm-providers/OpenAIProvider.js');
            tempProvider = new OpenAIProvider(logger);
          } else if (providerType === 'azure-ai-foundry') {
            const { AzureAIFoundryProvider } = await import('../../services/llm-providers/AzureAIFoundryProvider.js');
            tempProvider = new AzureAIFoundryProvider(logger, {
              endpointUrl: providerConfig.config?.endpointUrl || providerConfig.config?.endpoint,
              apiKey: providerConfig.config?.apiKey,
              apiVersion: providerConfig.config?.apiVersion,
              model: providerConfig.config?.chatModel || providerConfig.config?.model || providerConfig.config?.deploymentName,
              tenantId: providerConfig.config?.tenantId,
              clientId: providerConfig.config?.clientId,
              clientSecret: providerConfig.config?.clientSecret,
            });
          }

          if (tempProvider) {
            try {
              await tempProvider.initialize(providerConfig.config);
            } catch (err) {
              initError = err instanceof Error ? err.message : String(err);
              logger.warn({ provider: name, error: initError }, 'Temp provider initialization failed during test');
            }
          }
        } catch (dbError) {
          logger.error({ provider: name, error: dbError }, 'Failed to load provider from database for test');
          return reply.code(500).send({
            error: 'Database error',
            message: `Failed to load provider '${name}' from database: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`
          });
        }
      }

      const provider = providerInMemory ? providerManager.getProvider(name) : tempProvider;
      let models: any[] = [];
      try {
        models = (await provider?.listModels()) || [];
      } catch {
        // listModels may fail if provider init failed
      }
      // Test model resolution: admin picks explicitly (?model= or body.model).
      // No heuristics — auto-picking "first in catalog" caused Bedrock tests
      // to fire at Nemotron with Anthropic body shape and return a cryptic
      // "Failed to deserialize" from AWS. If no model is picked AND the
      // provider has a DB-registered default, use it; otherwise surface a
      // clear "please pick a model" error instead of a confusing SDK error.
      const testModel = userModel
        || (models?.[0] as any)?.id
        || (models?.[0] as any)?.name
        || process.env.VERTEX_AI_MODEL
        || process.env.AZURE_OPENAI_MODEL
        || process.env.DEFAULT_MODEL;
      const capabilities = (models.find((m: any) => (m.id || m.name) === testModel) || models?.[0] as any)?.capabilities || {};
      const testMaxTokens = userMaxTokens || 100;

      const testResults: any = {
        provider: name,
        timestamp: new Date().toISOString(),
        initializationError: initError,
        inMemory: providerInMemory,
        tests: {}
      };

      // If provider couldn't initialize at all, report it but don't 404
      if (initError && !providerInMemory) {
        testResults.tests.initialization = {
          success: false,
          error: initError,
          hint: 'Provider exists in database but failed to initialize. Check credentials and connectivity.'
        };
      }

      // Basic completion test
      if ((testType === 'basic' || testType === 'all') && provider) {
        try {
          const startTime = Date.now();
          let response;
          if (providerInMemory) {
            response = await providerManager.createCompletion({
              model: testModel,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: testMaxTokens,
              stream: false
            }, name);
          } else {
            // Use temp provider directly
            response = await tempProvider.createCompletion({
              model: testModel,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: testMaxTokens,
              stream: false
            });
          }

          const latency = Date.now() - startTime;
          const content = (response as any).choices?.[0]?.message?.content || '';

          testResults.tests.basic = {
            success: true,
            latency,
            response: content,
            tokenCount: content.split(/\s+/).length
          };
        } catch (error) {
          testResults.tests.basic = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Streaming test
      if ((testType === 'streaming' || testType === 'all') && capabilities.chat && provider) {
        try {
          const startTime = Date.now();
          const completionArgs = {
            model: testModel,
            messages: [{ role: 'user' as const, content: 'Count from 1 to 5.' }],
            max_tokens: 50,
            stream: true
          };
          const stream = providerInMemory
            ? await providerManager.createCompletion(completionArgs, name)
            : await tempProvider.createCompletion(completionArgs);

          let chunks = 0;
          let firstChunkLatency = 0;
          let content = '';

          if (Symbol.asyncIterator in Object(stream)) {
            for await (const chunk of stream as AsyncGenerator) {
              if (chunks === 0) {
                firstChunkLatency = Date.now() - startTime;
              }
              chunks++;
              const delta = (chunk as any).choices?.[0]?.delta?.content || '';
              content += delta;
            }
          }

          const totalLatency = Date.now() - startTime;

          testResults.tests.streaming = {
            success: true,
            chunks,
            firstChunkLatency,
            totalLatency,
            response: content
          };
        } catch (error) {
          testResults.tests.streaming = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Tool calling test
      if ((testType === 'tools' || testType === 'all') && capabilities.tools && provider) {
        try {
          const startTime = Date.now();
          const toolArgs = {
            model: testModel,
            messages: [{ role: 'user' as const, content: 'What is the weather in San Francisco?' }],
            tools: [{
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get the current weather in a location',
                parameters: {
                  type: 'object',
                  properties: {
                    location: { type: 'string', description: 'City name' },
                    unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                  },
                  required: ['location']
                }
              }
            }],
            max_tokens: 100,
            stream: false
          };
          const response = providerInMemory
            ? await providerManager.createCompletion(toolArgs, name)
            : await tempProvider.createCompletion(toolArgs);

          const latency = Date.now() - startTime;
          const toolCalls = (response as any).choices?.[0]?.message?.tool_calls || [];

          testResults.tests.tools = {
            success: toolCalls.length > 0,
            latency,
            toolCalls: toolCalls.map((tc: any) => ({
              name: tc.function?.name,
              arguments: tc.function?.arguments
            }))
          };
        } catch (error) {
          testResults.tests.tools = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Vision test
      if ((testType === 'vision' || testType === 'all') && capabilities.vision && imageUrl && provider) {
        try {
          const startTime = Date.now();
          const visionArgs = {
            model: testModel,
            messages: [{
              role: 'user' as const,
              content: [
                { type: 'text', text: 'What do you see in this image?' },
                { type: 'image_url', image_url: { url: imageUrl } }
              ] as any
            }],
            max_tokens: 200,
            stream: false
          };
          const response = providerInMemory
            ? await providerManager.createCompletion(visionArgs, name)
            : await tempProvider.createCompletion(visionArgs);

          const latency = Date.now() - startTime;
          const content = (response as any).choices?.[0]?.message?.content || '';

          testResults.tests.vision = {
            success: true,
            latency,
            response: content
          };
        } catch (error) {
          testResults.tests.vision = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Calculate overall success
      const tests = Object.values(testResults.tests);
      const successfulTests = tests.filter((t: any) => t.success).length;
      testResults.summary = {
        totalTests: tests.length,
        successfulTests,
        successRate: tests.length > 0 ? (successfulTests / tests.length * 100).toFixed(1) + '%' : '0%',
        capabilities: capabilities
      };

      // Persist test results and update provider status in DB
      try {
        const { prisma } = await import('../../utils/prisma.js');
        const newStatus = successfulTests > 0 ? 'active' : 'error';
        const dbProvider = await prisma.lLMProvider.findFirst({ where: { name } });
        if (dbProvider) {
          await prisma.lLMProvider.update({
            where: { id: dbProvider.id },
            data: {
              status: newStatus,
              provider_config: {
                ...(dbProvider.provider_config as any || {}),
                lastTestAt: new Date().toISOString(),
                lastTestSuccess: successfulTests > 0,
                lastTestResults: testResults.summary,
              },
            },
          });
          logger.info({ provider: name, status: newStatus, successfulTests }, 'Provider test results persisted to database');
        }
        } catch (dbError) {
        logger.warn({ error: dbError, provider: name }, 'Failed to persist test results (non-fatal)');
      }

      return reply.send(testResults);

    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Provider test failed');
      return reply.code(500).send({
        provider: request.params.name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/test-config — pre-save form-data test (#287)
   *
   * The Add-Provider wizard's "Test Connection" button needs to validate
   * credentials BEFORE the user clicks Save. The /:name/test endpoint above
   * looks up the provider by name in the DB and 404s if not found, which
   * is correct for saved rows but wrong for the wizard.
   *
   * This endpoint accepts the full provider config in the body, instantiates
   * a temp provider, runs a basic completion, and returns the same response
   * shape (so the UI can reuse its result-rendering code). It NEVER touches
   * the LLMProvider table.
   */
  const SUPPORTED_PROVIDER_TYPES = new Set([
    'azure-openai',
    'azure-ai-foundry',
    'vertex-ai',
    'aws-bedrock',
    'ollama',
    'openai',
    'anthropic',
  ]);

  function instantiateProviderForType(providerType: string, log: Logger, providerConfig: any) {
    if (providerType === 'ollama') return new OllamaProvider(log);
    if (providerType === 'aws-bedrock' || providerType === 'bedrock') return new AWSBedrockProvider(log);
    if (providerType === 'vertex-ai' || providerType === 'google-vertex') return new GoogleVertexProvider(log);
    if (providerType === 'azure-openai') return new AzureOpenAIProvider(log);
    if (providerType === 'anthropic') return new AnthropicProvider(log);
    if (providerType === 'openai') return new OpenAIProvider(log);
    if (providerType === 'azure-ai-foundry') {
      return new AzureAIFoundryProvider(log, {
        endpointUrl: providerConfig?.endpointUrl || providerConfig?.endpoint,
        apiKey: providerConfig?.apiKey,
        apiVersion: providerConfig?.apiVersion,
        model: providerConfig?.chatModel || providerConfig?.model || providerConfig?.deploymentName,
        tenantId: providerConfig?.tenantId,
        clientId: providerConfig?.clientId,
        clientSecret: providerConfig?.clientSecret,
      });
    }
    return null;
  }

  fastify.post<{
    Body: {
      providerType?: string;
      name?: string;
      authConfig?: any;
      providerConfig?: any;
      modelConfig?: any;
      testType?: 'basic';
      prompt?: string;
      model?: string;
      maxTokens?: number;
    };
  }>('/llm-providers/test-config', async (request, reply) => {
    const {
      providerType,
      name = 'unsaved',
      authConfig = {},
      providerConfig = {},
      modelConfig = {},
      prompt = 'Say "Hello, World!" and nothing else.',
      model: userModel,
      maxTokens: userMaxTokens,
    } = request.body || {};

    if (!providerType) {
      return reply.code(400).send({
        error: 'Missing providerType',
        message: 'providerType is required (e.g. aws-bedrock, vertex-ai, azure-ai-foundry).',
      });
    }
    if (!SUPPORTED_PROVIDER_TYPES.has(providerType) && providerType !== 'bedrock' && providerType !== 'google-vertex') {
      return reply.code(400).send({
        error: 'Unsupported providerType',
        message: `Unknown provider type '${providerType}'. Supported: ${Array.from(SUPPORTED_PROVIDER_TYPES).join(', ')}.`,
      });
    }

    // Build a synthetic dbProvider-shaped object so we can run it through
    // the same auth-config normalization pipeline as a saved row. We do NOT
    // encrypt — the body fields are already plaintext from the form.
    const syntheticDbProvider = {
      name,
      provider_type: providerType,
      enabled: true,
      priority: 1,
      auth_config: authConfig,           // already plaintext; decryptAuthConfig is a no-op for plaintext
      provider_config: providerConfig,
      model_config: modelConfig,
    };

    let normalized: any;
    try {
      const configService = new ProviderConfigService(logger);
      normalized = configService.convertDatabaseProvider(syntheticDbProvider);
    } catch (err) {
      logger.warn({ err, providerType }, 'test-config: convertDatabaseProvider failed');
      return reply.code(400).send({
        error: 'Invalid config',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const tempProvider = instantiateProviderForType(normalized.type, logger, normalized.config);
    if (!tempProvider) {
      return reply.code(400).send({
        error: 'Unsupported providerType',
        message: `Could not instantiate provider for type '${normalized.type}'.`,
      });
    }

    let initError: string | null = null;
    try {
      await (tempProvider as any).initialize(normalized.config);
    } catch (err) {
      initError = err instanceof Error ? err.message : String(err);
      logger.info({ providerType: normalized.type, error: initError }, 'test-config: initialize failed (expected for bad creds)');
    }

    const testResults: any = {
      provider: name,
      providerType: normalized.type,
      timestamp: new Date().toISOString(),
      initializationError: initError,
      inMemory: false,
      tests: {} as Record<string, any>,
    };

    let models: any[] = [];
    if (!initError) {
      try {
        models = ((await (tempProvider as any).listModels?.()) || []) as any[];
      } catch {
        // listModels failure is not fatal for a basic completion test
      }
    }

    // #577 follow-up #2: filter embedding-only models out of the candidate
    // pool BEFORE picking models[0]. The gpu-node ollama-embedding pod only
    // serves nomic-embed-text:latest — picking it then calling /api/chat
    // returns 400 ("model does not support generate"). Surface that as a
    // skipped-inference soft success (auth+region OK, no chat-capable
    // model on this host) instead of a misleading 400.
    const chatCandidateModels = (models || []).filter(m => !isEmbeddingOnlyModel(m));
    const testModel = userModel
      || (chatCandidateModels?.[0] as any)?.id
      || (chatCandidateModels?.[0] as any)?.name
      || normalized.config?.model
      || normalized.config?.chatModel
      || normalized.config?.deploymentName;
    const testMaxTokens = userMaxTokens || 100;

    if (initError) {
      testResults.tests.basic = {
        success: false,
        error: initError,
        hint: 'Provider failed to initialize. Check credentials and connectivity.',
      };
    } else if (!testModel) {
      // #577 follow-up: when no test model can be derived (no userModel,
      // listModels returned nothing, no model in form), DO NOT call
      // createCompletion — the #577 guard would throw "No Bedrock model
      // configured" which is misleading: auth + region already validated
      // via initialize(). Surface a soft-success result so the wizard can
      // show "Test passed; pick a model in the next step to validate
      // inference."
      testResults.tests.basic = {
        success: true,
        inferenceSkipped: true,
        skippedInference: true,
        message:
          'Credentials and region validated. No model selected — pick a model in the Add-Model step to validate inference end-to-end.',
        latency: 0,
      };
    } else {
      try {
        const startTime = Date.now();
        const response = await (tempProvider as any).createCompletion({
          model: testModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: testMaxTokens,
          stream: false,
        });
        const latency = Date.now() - startTime;
        const content = (response as any).choices?.[0]?.message?.content || '';
        testResults.tests.basic = {
          success: true,
          latency,
          response: content,
          tokenCount: content.split(/\s+/).length,
        };
      } catch (err) {
        testResults.tests.basic = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    const tests = Object.values(testResults.tests);
    const successfulTests = tests.filter((t: any) => t.success).length;
    testResults.summary = {
      totalTests: tests.length,
      successfulTests,
      successRate: tests.length > 0 ? (successfulTests / tests.length * 100).toFixed(1) + '%' : '0%',
    };

    return reply.send(testResults);
  });

  /**
   * POST /api/admin/llm-providers
   * Create a new LLM provider configuration
   *
   * #459 follow-up (2026-04-30): inbound `modelConfig` MUST have its
   * model-list fields stripped via `sanitizeProviderModelConfig` before
   * persistence. The Add-Provider wizard's Test-Connection step runs
   * `discoverModels()` and (incorrectly) stuffs the catalog into
   * `modelConfig.{chatModel, embeddingModel, additionalModels}`. Storing
   * that verbatim violates the FedRAMP "Registry == explicit add" rule —
   * the user sees phantom models on a provider they never added.
   *
   * Provider creation = creds + non-model config only.
   * Models enter the Registry via:
   *   - Admin "Add Model" wizard (POST /llm-providers/:id/models), OR
   *   - Curated-upstream auto-sync (AIF, Ollama) handled below by
   *     `discoverModels()` → `upsertDiscoveredModels()`, which writes
   *     Registry rows directly (NOT model_config).
   */
  fastify.post<{
    Body: {
      name: string;
      displayName: string;
      providerType: 'azure-openai' | 'vertex-ai' | 'aws-bedrock' | 'ollama' | 'openai' | 'anthropic';
      enabled?: boolean;
      priority?: number;
      authConfig: any;
      providerConfig: any;
      modelConfig?: any;
      capabilities?: any;
      description?: string;
      tags?: string[];
    };
  }>('/llm-providers', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');

      const {
        name,
        displayName,
        providerType,
        enabled = true,
        priority = 1,
        authConfig,
        providerConfig,
        modelConfig = {},
        capabilities = {},
        description,
        tags = []
      } = request.body;

      // Validate required fields
      if (!name || !displayName || !providerType || !authConfig || !providerConfig) {
        return reply.code(400).send({
          error: 'Missing required fields',
          required: ['name', 'displayName', 'providerType', 'authConfig', 'providerConfig']
        });
      }

      // Discriminator enforcement (FedRAMP origin metadata): reject generic
      // names + require per-type origin fields (env + per-type identifiers).
      // Existing rows are grandfathered; only new POSTs are validated here.
      // Tunable via PROVIDER_DISCRIMINATOR_ENFORCED=false (admin escape hatch
      // during the rolling migration window).
      if (process.env.PROVIDER_DISCRIMINATOR_ENFORCED !== 'false') {
        if (isGenericName(displayName) || isGenericName(name)) {
          return reply.code(400).send({
            success: false,
            error: 'Provider name is too generic. Add an environment + identifier (e.g. "bedrock-prod-1234-us-east-1").',
            code: 'GENERIC_NAME_REJECTED',
          });
        }
        const origin = (providerConfig?.origin as Record<string, string | undefined> | undefined) || {};
        const validation = validateDiscriminator(providerType, origin);
        if (validation.ok === false) {
          const missing = validation.missing;
          return reply.code(400).send({
            success: false,
            error: `Missing required origin fields: ${missing.join(', ')}`,
            code: 'DISCRIMINATOR_MISSING',
            missing,
            suggestedDisplayName: buildAutoDisplayName(providerType, origin),
          });
        }
      }

      // SECURITY: Encrypt sensitive credential fields before storage
      const encryptedAuthConfig = encryptAuthConfig(authConfig);

      // #289: clear any soft-deleted row that holds this name. The unique
      // constraint is on the raw `name` column (not `(name, deleted_at IS
      // NULL)`), so a previously-soft-deleted provider blocks re-add with
      // the same name. Treating "delete then re-add" as a clean restart is
      // the simplest UX — hard-delete the soft-deleted ghost first.
      try {
        const soft = await prisma.lLMProvider.deleteMany({
          where: { name, deleted_at: { not: null } },
        });
        if (soft.count > 0) {
          logger.info({ name, removed: soft.count }, 'Cleared soft-deleted provider rows before re-add (#289)');
        }
      } catch (cleanupErr) {
        logger.warn({ name, error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) }, 'Soft-delete cleanup failed; proceeding to create — duplicate-name error may follow');
      }

      // Create provider
      // #459 follow-up: `sanitizeProviderModelConfig` strips the wizard's
      // discovery-result pollution (chatModel/embeddingModel/additionalModels)
      // from inbound modelConfig. Provider creation = creds + non-model
      // config only.
      const provider = await prisma.lLMProvider.create({
        data: {
          name,
          display_name: displayName,
          provider_type: providerType,
          enabled,
          priority,
          auth_config: encryptedAuthConfig,
          provider_config: providerConfig,
          model_config: sanitizeProviderModelConfig(modelConfig),
          capabilities,
          description,
          tags,
          created_by: (request as any).user?.id
        }
      });

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider created');

      // Audit: credential creation (generic admin audit)
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_CREATE,
        severity: AuditSeverity.INFO,
        userId: (request as any).user?.id,
        userEmail: (request as any).user?.email,
        action: 'CREATE_LLM_PROVIDER',
        resource: 'LLMProvider',
        resourceId: provider.id,
        details: { providerName: name, providerType },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      // Credential-specific audit trail (dedicated table)
      credentialAuditService.log({
        userId: (request as any).user?.id || 'unknown',
        userEmail: (request as any).user?.email,
        action: 'create',
        entityType: 'llm_provider',
        entityId: provider.id,
        entityName: name,
        changes: {
          providerType: { new: providerType },
          enabled: { new: enabled },
          priority: { new: priority },
        },
        request,
      }).catch(() => {});

      // Trigger hot-reload if providerManager exists. After reload the new
      // provider is in the live map and discoverModels() has populated
      // discoveredCapabilities — we then auto-persist those discovered models
      // into provider_config.models[] so admins don't have to manually add
      // each one. This is the AIF auto-discovery flow (#49) but works for
      // every provider type that implements discoverModels().
      let autoDiscoveredCount = 0;
      let registryUpserted = 0;
      let autoSyncSkipped = false;
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        logger.info('Provider manager reloaded with new provider');

        try {
          const liveProvider = (providerManager as any).providers?.get(name);
          if (liveProvider && typeof liveProvider.discoverModels === 'function') {
            const discovered = await liveProvider.discoverModels();
            if (Array.isArray(discovered) && discovered.length > 0) {
              // Pull provider defaults so each auto-added model row has sensible
              // temperature/topP/maxTokens/capabilities populated from the
              // provider's own getModelDefaults() (so admins see real values
              // in the registry instead of zeros).
              const getDefaults = typeof liveProvider.getModelDefaults === 'function'
                ? (id: string) => liveProvider.getModelDefaults(id).catch(() => null)
                : async () => null;

              const models = await Promise.all(discovered.map(async (m: any) => {
                const defaults = await getDefaults(m.id);
                return {
                  id: m.id,
                  displayName: m.name || m.id,
                  config: {
                    enabled: true,
                    roles: m.capabilities?.embeddings ? ['embeddings'] : ['chat'],
                    temperature: defaults?.temperature ?? 0.7,
                    topP: defaults?.topP ?? 1.0,
                    maxInputTokens: m.contextWindow ?? 128000,
                    maxOutputTokens: m.maxOutputTokens ?? defaults?.maxTokens ?? 4096,
                    rateLimitRequestsPerHour: 0,
                    rateLimitTokensPerHour: 0,
                  },
                  capabilities: m.capabilities ?? { chat: true, streaming: true },
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  autoDiscovered: true,
                };
              }));

              // Legacy provider_config.models[] merge removed — Registry SoT
              // owns the model list now. The Registry upsert immediately
              // below populates admin.model_role_assignments with the
              // discovered set; that's where every reader looks.
              autoDiscoveredCount = models.length;
              logger.info({
                providerName: name,
                autoDiscoveredCount,
              }, '[ProviderCreate] Discovered models — handing off to Registry upsert');

              // Registry SoT (task #2): populate admin.model_role_assignments
              // for each discovered model so chat toolbar + Smart Router +
              // admin Models page have a single source of truth instead of
              // reading discoveredCapabilities.
              //
              // #311 GATE: only auto-upsert for curated-upstream providers
              // (AIF deployments, Ollama host pulls). Bulk-catalog providers
              // (Bedrock/Vertex/OpenAI/Anthropic/AzureOpenAI) must go through
              // the admin "Add Model" UI so Registry stays curated.
              // See feedback_registry_explicit_add.md for the full rationale.
              if (shouldAutoSyncRegistry(providerType)) {
                try {
                  // Task #342: instantiate PricingService per-request.
                  // Cheap (just a Map); avoids holding a long-lived PrismaClient
                  // handle at module scope. Fetcher caching is per-instance so
                  // the @aws-sdk/client-pricing SDK load only happens when the
                  // first Bedrock row is priced inside fetchAndStorePricing().
                  const pricingService = new PricingService(prisma);
                  // region comes from auth_config.region first (Bedrock stores
                  // it there post-encryption-decrypt); fallback to
                  // provider_config.region for providers that keep it outside
                  // the credential blob.
                  const region =
                    (authConfig?.region as string | undefined) ??
                    (providerConfig?.region as string | undefined) ??
                    null;

                  const registryResult = await upsertDiscoveredModels(
                    {
                      providerName: name,
                      discovered,
                      createdBy: (request as any).user?.id ?? 'seeder',
                      providerType,
                      region,
                      pricingService,
                    },
                    prisma as unknown as RegistryUpsertPrismaLike,
                  );
                  registryUpserted = (registryResult.inserted || 0) + (registryResult.updated || 0);
                  logger.info({
                    providerName: name,
                    providerType,
                    region,
                    registryInserted: registryResult.inserted,
                    registryUpdated: registryResult.updated,
                  }, '[ProviderCreate] Registry rows upserted (auto-sync allowed); pricing fetch dispatched in background');
                } catch (registryErr: any) {
                  logger.warn({
                    error: registryErr?.message,
                    providerName: name,
                  }, '[ProviderCreate] Registry upsert failed (non-fatal)');
                }
              } else {
                autoSyncSkipped = true;
                logger.info({
                  providerName: name,
                  providerType,
                  discoveredCount: discovered.length,
                }, '[ProviderCreate] Registry auto-sync skipped — explicit Add Model required for this provider type');
              }

              // Bust caches again so the freshly persisted model list is
              // reflected in /chat/models and the chat dropdown signal.
              await invalidateAllModelCaches(logger);
            }
          }
        } catch (discoveryErr: any) {
          logger.warn({
            error: discoveryErr.message,
            providerName: name
          }, '[ProviderCreate] Auto-discovery failed (non-fatal — admin can add models manually)');
        }
      }

      // Disconnect the prisma client now that all writes are done.

      // #459: be explicit about what landed in the Registry vs what was just
      // discovered in the catalog. Bedrock/Vertex/OpenAI/Anthropic/AzureOpenAI
      // skip auto-sync (#311 policy) so `autoDiscoveredCount` says "we saw 32
      // models" but `registryUpserted: 0` says "nothing was added to the
      // Registry — admin must use Models → Add Model to register specific
      // ones". The Provider Management page banner says the same thing.
      let message: string;
      if (registryUpserted > 0) {
        message = `Provider created. ${registryUpserted} model(s) added to the Registry from auto-sync.`;
      } else if (autoSyncSkipped && autoDiscoveredCount > 0) {
        message = `Provider created. Discovered ${autoDiscoveredCount} catalog model(s) — use Models → Add Model to register specific ones (auto-sync intentionally disabled for this provider type).`;
      } else if (autoDiscoveredCount > 0) {
        message = `Provider created. Discovered ${autoDiscoveredCount} model(s) from the provider; 0 added to the Registry.`;
      } else {
        message = 'Provider created successfully';
      }

      // §11.5 — normalize the BigInt `version` column before send. Fastify's
      // JSON serializer can't handle BigInt natively. Same pattern as GET
      // and the 409 conflict path.
      const providerOut = {
        ...provider,
        version: typeof (provider as any).version === 'bigint'
          ? Number((provider as any).version)
          : Number((provider as any).version ?? 1),
      };

      // Hot-reload providerManager so the new provider is routable in this
      // pod immediately — without it the modelToProviderMap is stale until
      // the next pod restart, and any model registered against the new
      // provider gets routed to the wrong provider (or none). Live repro
      // 2026-05-06 (gemma4:latest mis-routed to `hal`). reloadProviders()
      // is atomic — old map keeps serving while the new one builds, then
      // swaps in (#74). Best-effort: if reload throws we still return 201
      // because the DB write succeeded; the next reload (next CRUD or pod
      // restart) will pick it up.
      if (providerManager) {
        try {
          await providerManager.reloadProviders();
        } catch (reloadErr) {
          logger.warn(
            { err: (reloadErr as Error).message, providerId: provider.id },
            '[admin] post-create reloadProviders() failed — provider in DB but routing not yet refreshed',
          );
        }
      }

      return reply.code(201).send({
        provider: providerOut,
        autoDiscoveredCount,
        registryUpserted,
        autoSyncSkipped,
        message,
      });

    } catch (error: any) {
      // Prisma P2002 = unique-constraint violation. The `name` column is
      // the only unique constraint we expose to admins, so surface a clean
      // 409 message instead of leaking the raw Prisma stacktrace into the
      // toast (#100 — user reported "Save failed: Invalid prisma.lLMProvider
      // .create() invocation: Unique constraint failed on the fields:
      // (`name`)" appearing verbatim in the UI).
      if (error?.code === 'P2002') {
        const target = Array.isArray(error?.meta?.target)
          ? error.meta.target.join(', ')
          : String(error?.meta?.target ?? 'name');
        logger.warn({ target, providerName: (request.body as any)?.name }, 'P2002 on LLM provider create');
        return reply.code(409).send({
          error: 'A provider with this name already exists',
          message: `Field "${target}" must be unique. Pick a different name (e.g. add an env / region suffix).`,
          field: target,
        });
      }
      logger.error({ error }, 'Failed to create LLM provider');
      return reply.code(500).send({
        error: 'Failed to create provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * PUT /api/admin/llm-providers/:id
   * Update an existing LLM provider
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      displayName?: string;
      enabled?: boolean;
      priority?: number;
      authConfig?: any;
      providerConfig?: any;
      modelConfig?: any;
      capabilities?: any;
      description?: string;
      tags?: string[];
      /** §11.5 optimistic-concurrency token. The version the client just GET'd. */
      version?: number;
    };
  }>('/llm-providers/:id', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const { id } = request.params;

      // §11.5 — version is required on every write so concurrent admins
      // can't silently clobber each other.
      const clientVersion = (request.body as any)?.version;
      if (typeof clientVersion !== 'number' || !Number.isInteger(clientVersion) || clientVersion < 0) {
        return reply.code(400).send({
          error: 'version must be a non-negative integer (POST the version you GET\'d back to confirm no other admin has saved since).',
        });
      }

      // Fetch existing provider for change diffing
      const existingProvider = await prisma.lLMProvider.findUnique({ where: { id } });
      if (!existingProvider) {
          return reply.code(404).send({ error: 'Provider not found' });
      }

      const currentVersion = typeof (existingProvider as any).version === 'bigint'
        ? Number((existingProvider as any).version)
        : Number((existingProvider as any).version ?? 0);
      if (clientVersion !== currentVersion) {
        const conflictingFields: string[] = [];
        const b = request.body as any;
        if (b.displayName !== undefined && b.displayName !== existingProvider.display_name) conflictingFields.push('displayName');
        if (b.enabled !== undefined && b.enabled !== existingProvider.enabled) conflictingFields.push('enabled');
        if (b.priority !== undefined && b.priority !== existingProvider.priority) conflictingFields.push('priority');
        if (b.description !== undefined && b.description !== existingProvider.description) conflictingFields.push('description');
        return reply.code(409).send({
          error: 'Conflict: another admin saved this provider before your save landed.',
          currentRow: { ...existingProvider, version: currentVersion },
          conflictingFields,
        });
      }

      // Discriminator enforcement on UPDATE: only validate fields the caller is
      // actually changing — pre-existing rows are grandfathered. Same env flag
      // and same error codes as POST.
      if (process.env.PROVIDER_DISCRIMINATOR_ENFORCED !== 'false') {
        if (request.body.displayName !== undefined && isGenericName(request.body.displayName)) {
          return reply.code(400).send({
            success: false,
            error: 'Provider name is too generic. Add an environment + identifier (e.g. "bedrock-prod-1234-us-east-1").',
            code: 'GENERIC_NAME_REJECTED',
          });
        }
        const incomingOrigin = (request.body.providerConfig as Record<string, any> | undefined)?.origin;
        if (incomingOrigin !== undefined) {
          const validation = validateDiscriminator(
            existingProvider.provider_type,
            incomingOrigin as Record<string, string | undefined>,
          );
          if (validation.ok === false) {
            const missing = validation.missing;
            return reply.code(400).send({
              success: false,
              error: `Missing required origin fields: ${missing.join(', ')}`,
              code: 'DISCRIMINATOR_MISSING',
              missing,
              suggestedDisplayName: buildAutoDisplayName(
                existingProvider.provider_type,
                incomingOrigin as Record<string, string>,
              ),
            });
          }
        }
      }

      const updateData: any = {};

      if (request.body.displayName !== undefined) updateData.display_name = request.body.displayName;
      if (request.body.enabled !== undefined) updateData.enabled = request.body.enabled;
      if (request.body.priority !== undefined) updateData.priority = request.body.priority;

      // MERGE auth_config: don't wipe existing credentials when UI sends partial update
      // (the GET /database endpoint strips credential values, so edit form starts empty)
      if (request.body.authConfig !== undefined) {
        const existingAuth = decryptAuthConfig(existingProvider.auth_config as any) || {};
        const newAuth = request.body.authConfig || {};
        // Keep existing credential values for any field that is empty/missing in the update
        const merged: Record<string, any> = { ...existingAuth };
        for (const [key, value] of Object.entries(newAuth)) {
          if (value !== undefined && value !== null && value !== '') {
            merged[key] = value;
          }
        }
        updateData.auth_config = encryptAuthConfig(merged);
      }

      // MERGE provider_config: preserve existing models array and other fields not in the update
      if (request.body.providerConfig !== undefined) {
        const existingPC = existingProvider.provider_config as Record<string, any> || {};
        const newPC = request.body.providerConfig || {};
        // Merge: new fields overwrite existing, but preserve models array if not in update
        const mergedPC: Record<string, any> = { ...existingPC, ...newPC };
        if (!newPC.models && existingPC.models) {
          mergedPC.models = existingPC.models; // Preserve manually-added models
        }
        updateData.provider_config = mergedPC;
      }

      // Mark as admin-owned so seeder won't overwrite admin's manual changes
      if (!updateData.provider_config) {
        const existingPC = existingProvider.provider_config as Record<string, any> || {};
        updateData.provider_config = { ...existingPC, seeder_managed: false };
      } else {
        updateData.provider_config.seeder_managed = false;
      }

      // MERGE model_config: preserve disabledModels and other fields, but
      // strip wizard-side model-list pollution (chatModel / embeddingModel /
      // additionalModels / codeModel / defaultModel) from the inbound side
      // so PUT can never reintroduce phantom model state. The Registry is
      // the single SoT for which models a provider exposes.
      if (request.body.modelConfig !== undefined) {
        const existingMC = existingProvider.model_config as Record<string, any> || {};
        const sanitizedNewMC = sanitizeProviderModelConfig(request.body.modelConfig);
        updateData.model_config = { ...existingMC, ...sanitizedNewMC };
      }
      if (request.body.capabilities !== undefined) updateData.capabilities = request.body.capabilities;
      if (request.body.description !== undefined) updateData.description = request.body.description;
      if (request.body.tags !== undefined) updateData.tags = request.body.tags;

      updateData.updated_by = (request as any).user?.id;

      // Version-gated update. updateMany permits a non-unique WHERE
      // (id + version), and tells us count=0 if the version is stale —
      // which we treat as a 409 race condition rather than a 500.
      const updateResult = await prisma.lLMProvider.updateMany({
        where: { id, version: clientVersion as any },
        data: { ...updateData, version: { increment: 1 } as any },
      });
      if (updateResult.count === 0) {
        // Race: someone else saved between our findUnique and updateMany.
        const fresh = await prisma.lLMProvider.findUnique({ where: { id } });
        const freshVersion = fresh && typeof (fresh as any).version === 'bigint'
          ? Number((fresh as any).version)
          : Number((fresh as any)?.version ?? 0);
        return reply.code(409).send({
          error: 'Conflict: provider was updated between read and write.',
          currentRow: fresh ? { ...fresh, version: freshVersion } : null,
          conflictingFields: [],
        });
      }
      const refetched = await prisma.lLMProvider.findUnique({ where: { id } });
      const provider = refetched
        ? { ...refetched, version: typeof (refetched as any).version === 'bigint' ? Number((refetched as any).version) : Number((refetched as any).version ?? 0) }
        : null;
      if (!provider) {
        return reply.code(500).send({ error: 'Provider update succeeded but row vanished on refetch' });
      }

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider updated');

      // Audit: credential update (generic admin audit)
      if (request.body.authConfig !== undefined) {
        auditTrail.log({
          timestamp: new Date(),
          eventType: AuditEventType.CREDENTIAL_UPDATE,
          severity: AuditSeverity.INFO,
          userId: (request as any).user?.id,
          userEmail: (request as any).user?.email,
          action: 'UPDATE_LLM_PROVIDER_CREDENTIALS',
          resource: 'LLMProvider',
          resourceId: provider.id,
          details: { providerName: provider.name },
          success: true,
          ipAddress: request.ip,
        }).catch(() => {});
      }

      // Credential-specific audit trail (dedicated table) -- log ALL updates, not just auth changes
      const changes: Record<string, { old?: unknown; new?: unknown }> = {};
      if (request.body.displayName !== undefined) {
        changes.displayName = { old: existingProvider.display_name, new: request.body.displayName };
      }
      if (request.body.enabled !== undefined) {
        changes.enabled = { old: existingProvider.enabled, new: request.body.enabled };
      }
      if (request.body.priority !== undefined) {
        changes.priority = { old: existingProvider.priority, new: request.body.priority };
      }
      if (request.body.authConfig !== undefined) {
        // Do NOT log raw credential values -- just note that auth config changed
        changes.authConfig = { old: '[redacted]', new: '[redacted]' };
      }
      if (request.body.providerConfig !== undefined) {
        changes.providerConfig = { old: '[previous]', new: '[updated]' };
      }
      if (request.body.description !== undefined) {
        changes.description = { old: existingProvider.description, new: request.body.description };
      }

      credentialAuditService.log({
        userId: (request as any).user?.id || 'unknown',
        userEmail: (request as any).user?.email,
        action: 'update',
        entityType: 'llm_provider',
        entityId: provider.id,
        entityName: provider.name,
        changes,
        request,
      }).catch(() => {});

      // Trigger hot-reload if providerManager exists. The cache-invalidate
      // alone (pre-2026-05-06) didn't rebuild the providerManager.providers
      // map or modelToProviderMap → routing stayed pinned to the OLD
      // provider config (e.g. baseUrl change didn't take effect until pod
      // restart). reloadProviders() is atomic per #74 — old map serves
      // traffic until the new one is fully built and swapped.
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        try {
          await providerManager.reloadProviders();
          logger.info({ providerId: provider.id }, 'Provider manager reloaded with updated configuration');
        } catch (reloadErr) {
          logger.warn(
            { err: (reloadErr as Error).message, providerId: provider.id },
            '[admin] post-update reloadProviders() failed — provider DB row updated but routing not yet refreshed',
          );
        }
      }

      return reply.send({
        provider,
        message: 'Provider updated successfully'
      });

    } catch (error) {
      logger.error({ error, providerId: request.params.id }, 'Failed to update LLM provider');
      return reply.code(500).send({
        error: 'Failed to update provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/admin/llm-providers/:id
   * Soft delete an LLM provider
   */
  fastify.delete<{
    Params: { id: string };
    Querystring: { force?: string };
  }>('/llm-providers/:id', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const { id } = request.params;
      const force = (request.query as any)?.force === 'true';

      // Check if provider exists
      const existing = await prisma.lLMProvider.findUnique({ where: { id } });
      if (!existing) {
          return reply.code(404).send({ error: 'Provider not found' });
      }

      // Guard: check if provider's models are currently in use
      if (!force) {
        const usages: string[] = [];
        const provName = existing.name;

        // Check model role assignments referencing this provider
        const roleAssignments = await prisma.modelRoleAssignment.count({
          where: { provider: provName, enabled: true }
        });
        if (roleAssignments > 0) {
          usages.push(`${roleAssignments} active model role assignment(s)`);
        }

        // Check active chat sessions using models from this provider (last 24h)
        const mc = existing.model_config as any || {};
        const pc = existing.provider_config as any || {};
        const providerModelIds = new Set<string>();
        for (const f of ['chatModel', 'defaultModel', 'embeddingModel', 'visionModel', 'imageModel']) {
          if (mc[f]) providerModelIds.add(mc[f]);
        }
        if (pc.modelId) providerModelIds.add(pc.modelId);
        if (Array.isArray(pc.models)) {
          for (const m of pc.models) { if (m.id) providerModelIds.add(m.id); }
        }

        if (providerModelIds.size > 0) {
          const recentSessions = await prisma.chatSession.count({
            where: {
              model: { in: Array.from(providerModelIds) },
              updated_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }
          });
          if (recentSessions > 0) {
            usages.push(`${recentSessions} active chat session(s) in the last 24h`);
          }
        }

        if (usages.length > 0) {
              return reply.code(409).send({
            error: 'Provider is currently in use',
            message: `Cannot delete "${existing.display_name || existing.name}": ${usages.join(', ')}. Use ?force=true to override.`,
            usages,
          });
        }
      }

      // Soft delete by setting deleted_at timestamp + cascade-disable any
      // ModelRoleAssignment rows that reference this provider by name
      // (Phase G of docs/superpowers/specs/2026-04-30-ollama-split-topology.md).
      //
      // Why cascade in a transaction:
      //   ModelRoleAssignment.provider is a string column with no FK to
      //   LLMProvider.name, so Prisma's relational cascade can't help.
      //   Without this updateMany, deleted-provider rows linger as orphan
      //   "enabled" Registry entries → SmartModelRouter picks them →
      //   dispatch fails with "no enabled provider serves it" UNKNOWN_ERROR.
      //   Wrapping both writes in $transaction means a failure on EITHER
      //   step rolls back BOTH, so we never leave the registry in a
      //   half-deleted state.
      const [provider] = await prisma.$transaction(async (tx: any) => {
        const updatedProvider = await tx.lLMProvider.update({
          where: { id },
          data: {
            deleted_at: new Date(),
            enabled: false, // Also disable it
            updated_by: (request as any).user?.id
          }
        });
        const cascade = await tx.modelRoleAssignment.updateMany({
          where: { provider: updatedProvider.name, enabled: true },
          data: { enabled: false },
        });
        return [updatedProvider, cascade] as const;
      });

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider soft deleted');

      // Audit: credential deletion (generic admin audit)
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_DELETE,
        severity: AuditSeverity.WARNING,
        userId: (request as any).user?.id,
        userEmail: (request as any).user?.email,
        action: 'DELETE_LLM_PROVIDER',
        resource: 'LLMProvider',
        resourceId: provider.id,
        details: { providerName: provider.name },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      // Credential-specific audit trail (dedicated table)
      credentialAuditService.log({
        userId: (request as any).user?.id || 'unknown',
        userEmail: (request as any).user?.email,
        action: 'delete',
        entityType: 'llm_provider',
        entityId: provider.id,
        entityName: provider.name,
        request,
      }).catch(() => {});

      // Trigger hot-reload if providerManager exists
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        logger.info('Provider manager reloaded after provider deletion');
      }

      return reply.send({
        message: 'Provider deleted successfully',
        providerId: id
      });

    } catch (error) {
      logger.error({ error, providerId: request.params.id }, 'Failed to delete LLM provider');
      return reply.code(500).send({
        error: 'Failed to delete provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // ─── Model CRUD on provider_config.models (by provider name or ID) ────────────

  /**
   * Resolve provider by name or UUID.
   * All model endpoints accept either format.
   */
  async function resolveProvider(prisma: any, nameOrId: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);
    return isUuid
      ? await prisma.lLMProvider.findFirst({ where: { id: nameOrId, deleted_at: null } })
      : await prisma.lLMProvider.findFirst({ where: { name: nameOrId, deleted_at: null } });
  }

  /**
   * GET /api/admin/llm-providers/:providerId/models
   * List configured models for a provider from the Registry SoT
   * (admin.model_role_assignments). Replaces the legacy
   * provider_config.models[] read.
   */
  fastify.get<{ Params: { providerId: string } }>('/llm-providers/:providerId/models', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const { prisma } = await import('../../utils/prisma.js');

      const provider = await resolveProvider(prisma, providerId);

      if (!provider) {
        return reply.code(404).send({ error: 'Provider not found', message: `Provider '${providerId}' not found` });
      }

      const registryRows = await prisma.modelRoleAssignment.findMany({
        where: { provider: provider.name, enabled: true },
        orderBy: [{ priority: 'asc' }],
      });
      // #650 follow-up — surface discovery-time provenance + cost rates +
      // generation params so the UI can render "where does this number
      // come from?" badges and Smart Router has live cost data. Pre-fix
      // we dropped pricing_source/pricing_fetched_at/cost_per_*/temperature/
      // thinking_budget from the response shape. Decimal columns coerce
      // to JS number for clean JSON serialization.
      const toNum = (v: any): number | undefined => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === 'number') return v;
        const n = Number(v.toString());
        return Number.isFinite(n) ? n : undefined;
      };
      const models = registryRows.map(r => {
        const m: any = {
          id: r.model,
          name: r.description || r.model,
          capabilities: r.capabilities || {},
          config: { maxOutputTokens: r.max_tokens ?? undefined, enabled: r.enabled, role: r.role },
        };
        if (r.pricing_source) m.pricing_source = r.pricing_source;
        if (r.pricing_fetched_at) {
          m.pricing_fetched_at = r.pricing_fetched_at instanceof Date
            ? r.pricing_fetched_at.toISOString()
            : r.pricing_fetched_at;
        }
        const cIn = toNum((r as any).cost_per_input_token_usd);
        if (cIn !== undefined) m.cost_per_input_token_usd = cIn;
        const cOut = toNum((r as any).cost_per_output_token_usd);
        if (cOut !== undefined) m.cost_per_output_token_usd = cOut;
        const cCacheR = toNum((r as any).cost_per_cache_read_usd);
        if (cCacheR !== undefined) m.cost_per_cache_read_usd = cCacheR;
        const cCacheW = toNum((r as any).cost_per_cache_write_usd);
        if (cCacheW !== undefined) m.cost_per_cache_write_usd = cCacheW;
        const cThink = toNum((r as any).cost_per_thinking_token_usd);
        if (cThink !== undefined) m.cost_per_thinking_token_usd = cThink;
        const cEmb = toNum((r as any).cost_per_embedding_token_usd);
        if (cEmb !== undefined) m.cost_per_embedding_token_usd = cEmb;
        if (r.temperature !== null && r.temperature !== undefined) m.temperature = r.temperature;
        if (r.thinking_budget !== null && r.thinking_budget !== undefined) {
          m.thinking_budget = r.thinking_budget;
        }
        return m;
      });

      return reply.send({
        providerId: provider.id,
        providerName: provider.name,
        models,
        totalModels: models.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId }, 'Failed to list provider models');
      return reply.code(500).send({
        error: 'Failed to list provider models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/:providerId/models
   * Add a model to a provider. Appends to provider_config.models array.
   */
  fastify.post<{
    Params: { providerId: string };
    Querystring: { force?: string };
    Body: {
      modelId: string;
      displayName?: string;
      capabilities?: { chat?: boolean; vision?: boolean; tools?: boolean; streaming?: boolean; embeddings?: boolean };
      config?: {
        maxOutputTokens?: number;
        maxInputTokens?: number;
        rateLimitRequestsPerHour?: number;
        rateLimitTokensPerHour?: number;
        temperature?: number;
        topP?: number;
        enabled?: boolean;
        roles?: string[];
      };
      /**
       * Azure AI Foundry: when present, the admin backend will PUT a
       * CognitiveServices deployment with these parameters before the
       * DB write. Required for AIF models that aren't already deployed.
       */
      deployment?: {
        modelName: string;
        modelVersion: string;
        modelFormat?: string;
        sku?: string;
        capacity?: number;
      };
    };
  }>('/llm-providers/:providerId/models', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const { modelId, displayName } = request.body;
      // Body fields `capabilities` and `config.*` are accepted at the type
      // boundary for backward-compat, but they are NOT consumed here — live
      // discovery is the SoT (#650). Admin overrides go via the dedicated
      // PUT /llm-providers/:id/models/:modelId/override endpoint.

      if (!modelId) {
        return reply.code(400).send({ error: 'modelId is required' });
      }

      const { prisma } = await import('../../utils/prisma.js');

      const provider = await resolveProvider(prisma, providerId);

      if (!provider) {
          return reply.code(404).send({ error: 'Provider not found', message: `Provider '${providerId}' not found` });
      }

      // Azure AI Foundry: if caller supplied deployment{ modelName,modelVersion,... }
      // in the body, ensure the Azure CognitiveServices deployment exists BEFORE
      // the DB write so the background ARM-discovery sync (which treats Azure as
      // authoritative) doesn't prune the row. Callers that don't need provisioning
      // (model is already deployed) simply omit the field. The dedicated
      // /deploy-model endpoint remains the primary path used by the UI; this
      // branch is a safety net for clients that POST /models directly.
      if (provider.provider_type === 'azure-ai-foundry' && providerManager) {
        const meta = (request.body as any)?.deployment;
        if (meta && meta.modelVersion) {
          try {
            const providerInstance: any = providerManager.getProvider(provider.name);
            if (providerInstance?.ensureArmDeployment) {
              await providerInstance.ensureArmDeployment({
                deploymentName: modelId,
                modelName: meta.modelName || modelId,
                modelVersion: meta.modelVersion,
                modelFormat: meta.modelFormat || 'OpenAI',
                sku: meta.sku || 'GlobalStandard',
                capacity: meta.capacity ?? 1,
              });
            }
          } catch (err: any) {
            logger.error({ err: err?.message, modelId, providerId }, '[admin] ensureArmDeployment failed — aborting add');
            return reply.code(502).send({
              error: 'Azure deployment create failed',
              message: err?.message || String(err),
            });
          }
        }
      }

      const providerConfig = (provider.provider_config as any) || {};
      // Registry SoT: query admin.model_role_assignments to detect existing
      // model rows, not the legacy provider_config.models[]. The Registry
      // write below replaces the legacy field entirely.
      const existingRegistryRow = await prisma.modelRoleAssignment.findFirst({
        where: { provider: provider.name, model: modelId },
      });
      const existingIdx = existingRegistryRow ? 0 : -1;
      let isUpdate = false;
      // List of currently-registered model ids (Registry rows for this provider)
      // for family-conflict detection. Replaces the legacy
      // provider_config.models[].map(m=>m.id) approach.
      const existingRegistryRows = await prisma.modelRoleAssignment.findMany({
        where: { provider: provider.name },
        select: { model: true },
      });
      const models = existingRegistryRows; // alias used by family-conflict block below

      // Family-level dedupe: if the provider already has a model in the same
      // model family (e.g. user tries to add Sonnet 4.5 when 4.6 is already
      // registered), refuse with 409 unless the client passes ?force=true.
      // Root cause of the 2026-04-21 "TWO sonnets in registry" incident.
      if (existingIdx < 0) {
        const force = (request.query as any)?.force === 'true';
        if (!force) {
          const { findFamilyConflict } = await import('../../services/model-routing/modelFamily.js');
          const existingIds = models.map((m: any) => typeof m?.model === 'string' ? m.model : '').filter(Boolean);
          const conflict = findFamilyConflict(modelId, existingIds);
          if (conflict) {
            return reply.code(409).send({
              error: 'MODEL_FAMILY_CONFLICT',
              message: `Provider "${provider.name}" already has "${conflict}" in the same model family as "${modelId}". ` +
                       `Remove the existing model first, or pass ?force=true to add both.`,
              existingModelId: conflict,
              candidateModelId: modelId,
            });
          }
        }
      }

      // #650 — LIVE PROVIDER DISCOVERY is the SoT for capabilities, limits,
      // defaults, and pricing. Body is admin-overrides only (displayName for
      // description). Without live discovery the Registry's RouterTuning math
      // (cost-per-token, ctx-fit gates, FCA floors) operates on stale defaults.
      if (!providerManager) {
        return reply.code(503).send({ error: 'ProviderManager not initialized' });
      }
      const providerInstanceForDiscovery: any = providerManager.getProvider(provider.name);
      if (!providerInstanceForDiscovery?.discoverModelDetails) {
        return reply.code(501).send({
          error: 'Provider does not support live model discovery',
          message: `Provider '${provider.provider_type}' has no discoverModelDetails implementation`,
        });
      }
      const discoveryRegion = (provider.provider_config as any)?.region
                           ?? (provider.provider_config as any)?.location;
      let discovered: ModelDiscoveryRecord;
      try {
        const result = await providerInstanceForDiscovery.discoverModelDetails(modelId, discoveryRegion);
        if (!result) {
          return reply.code(502).send({ error: 'Live discovery returned null', modelId });
        }
        discovered = result;
      } catch (err: any) {
        logger.error({ providerId, modelId, err: err?.message }, '[admin] Live model discovery failed');
        return reply.code(502).send({
          error: 'Live model discovery failed',
          message: err?.message || String(err),
          modelId,
        });
      }

      if (existingRegistryRow) {
        isUpdate = true;
      }
      // Registry write happens at the bottom of this handler (already there);
      // legacy provider_config.models[] mutation removed — Registry is SoT.

      // Always register chat-capable models in model_config so /chat/models
      // and the Registry tab can see them. This runs on BOTH add and upsert
      // to fix models stuck in provider_config but missing from model_config.
      // #650 — Slot decision uses discovered capabilities, not body fields.
      const effectiveCaps = discovered.capabilities;
      const modelConfig = (provider.model_config as any) || {};
      const isChatCapable = (effectiveCaps?.chat !== false);
      const isEmbeddingOnly = effectiveCaps?.embeddings && !effectiveCaps?.chat;
      const updatedModelConfig = { ...modelConfig };

      if (isEmbeddingOnly) {
        // Embedding models go into embeddingModel slot
        if (!updatedModelConfig.embeddingModel) {
          updatedModelConfig.embeddingModel = modelId;
        }
      } else if (isChatCapable) {
        if (!updatedModelConfig.chatModel) {
          updatedModelConfig.chatModel = modelId;
        } else if (updatedModelConfig.chatModel !== modelId) {
          // Already has a chatModel — add to additionalModels so it shows in selector
          const additional: string[] = Array.isArray(updatedModelConfig.additionalModels) ? [...updatedModelConfig.additionalModels] : [];
          if (!additional.includes(modelId)) additional.push(modelId);
          updatedModelConfig.additionalModels = additional;
        }
      }

      // Update only model_config (routing-hint fields). The legacy
      // provider_config.models[] write is removed — Registry is SoT.
      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: {
          model_config: updatedModelConfig,
          updated_by: (request as any).user?.id
        }
      });

      // Registry upsert — the admin Models table reads from ModelRoleAssignment,
      // NOT from provider_config.models[]. Skipping this was the "Add Model → UI
      // shows nothing" bug: the POST wrote to provider_config + model_config but
      // the Registry view queries ModelRoleAssignment, so newly added models
      // never appeared.
      //
      // Derive ONE primary role per model. vision/tools/thinking/streaming are
      // capability flags preserved in the capabilities JSON on the row — they
      // are NOT separate roles. (Compare to gpt-oss:20b which has tools +
      // thinking + streaming but only a single role=chat row.)
      const caller = (request as any).user?.id;
      if (caller) {
        // #650 — Registry write sources EVERY column from discovered. Body's
        // displayName wins as admin override for description; everything else
        // (max_tokens, temperature, capabilities, options jsonb, all 7 cost
        // columns, pricing_source, pricing_fetched_at) comes from the live
        // discovery record. body.config.* is NOT consulted here — it would be
        // a silent override of provider truth.
        const caps = discovered.capabilities;
        const primaryRole = caps.embeddings && !caps.chat
          ? 'embeddings'
          : caps.imageGeneration ? 'image-generation' : 'chat';
        const optionsBlob = {
          contextWindow: discovered.contextWindow,
          family: discovered.family,
          topP: discovered.topP,
          topK: discovered.topK,
          providerType: discovered.providerType,
          pricingRegion: discovered.pricing.region,
          nativeToolCalling: caps.nativeToolCalling,
        };
        const dataCommon: any = {
          enabled: true,
          capabilities: caps as any,
          options: optionsBlob as any,
          max_tokens: discovered.maxOutputTokens ?? undefined,
          temperature: discovered.temperature ?? 0.5,
          thinking_budget: discovered.thinkingBudget ?? undefined,
          // OSS schema only tracks a single cost_per_request column for now;
          // detailed per-token pricing is enterprise-tier.
          cost_per_request: discovered.pricing.perRequestUsd ?? null,
          pricing_source: discovered.pricing.source,
          pricing_fetched_at: new Date(discovered.pricing.fetchedAt),
          description: displayName || discovered.displayName,
        };
        const existing = await prisma.modelRoleAssignment.findFirst({
          where: { role: primaryRole, model: modelId, provider: provider.name },
        });
        if (existing) {
          await prisma.modelRoleAssignment.update({
            where: { id: existing.id },
            data: dataCommon,
          });
        } else {
          await prisma.modelRoleAssignment.create({
            data: {
              ...dataCommon,
              role: primaryRole,
              model: modelId,
              provider: provider.name,
              priority: 10,
              created_by: caller,
            },
          });
        }
        logger.info({
          providerId: provider.id,
          modelId,
          role: primaryRole,
          pricingSource: discovered.pricing.source,
          contextWindow: discovered.contextWindow,
        }, '[admin] ModelRoleAssignment upserted from live discovery (#650)');
      }

      logger.info({ providerId: provider.id, modelId, isUpdate }, isUpdate ? 'Model upserted (was stuck in provider_config, now in model_config too)' : 'Model added to provider');

      // Audit log
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: (request as any).user?.id,
        userEmail: (request as any).user?.email,
        action: isUpdate ? 'UPSERT_PROVIDER_MODEL' : 'ADD_PROVIDER_MODEL',
        resource: 'LLMProvider',
        resourceId: providerId,
        details: { modelId, providerName: provider.name, isUpdate },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      // Trigger hot-reload so the new model appears in
      // modelToProviderMap immediately and is routable for the next
      // turn — without it the model exists in DB but the running
      // ProviderManager's lookup is stale until pod restart. Live
      // 2026-05-06 incident: gemma4:latest registered successfully but
      // routed to the wrong ollama provider for ~3 min until manual
      // restart. reloadProviders() is atomic (#74) so traffic isn't
      // interrupted.
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        try {
          await providerManager.reloadProviders();
          logger.info(
            { providerId: provider.id, modelId },
            'Provider manager reloaded after model registration',
          );
        } catch (reloadErr) {
          logger.warn(
            { err: (reloadErr as Error).message, providerId: provider.id, modelId },
            '[admin] post-model-add reloadProviders() failed — Registry row written but routing may be stale',
          );
        }
      }

      return reply.code(isUpdate ? 200 : 201).send({
        message: isUpdate ? 'Model updated and registered' : 'Model added successfully',
        model: models[existingIdx >= 0 ? existingIdx : models.length - 1],
        totalModels: models.length,
        isUpdate,
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId }, 'Failed to add model to provider');
      return reply.code(500).send({
        error: 'Failed to add model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/:providerId/models/:modelId/refresh
   *
   * #650 U7 — Re-runs live provider discovery for an existing Registry row
   * and atomically replaces capabilities, limits, defaults, and pricing.
   * The daily re-sync cron (U8) calls this exact code path per row.
   *
   * Returns 200 on success, 404 if provider/row missing, 501 if provider
   * has no discoverModelDetails (older provider class), 502 on upstream
   * discovery error, 503 if ProviderManager not initialized.
   */
  fastify.post<{
    Params: { providerId: string; modelId: string };
  }>('/llm-providers/:providerId/models/:modelId/refresh', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const modelId = decodeURIComponent(request.params.modelId);

      const { prisma } = await import('../../utils/prisma.js');
      const provider = await resolveProvider(prisma, providerId);
      if (!provider) {
        return reply.code(404).send({ error: 'Provider not found' });
      }

      const existing = await prisma.modelRoleAssignment.findFirst({
        where: { provider: provider.name, model: modelId },
      });
      if (!existing) {
        return reply.code(404).send({
          error: 'Registry row not found',
          message: `No ModelRoleAssignment for provider='${provider.name}' model='${modelId}'`,
        });
      }

      if (!providerManager) {
        return reply.code(503).send({ error: 'ProviderManager not initialized' });
      }
      const providerInstance: any = providerManager.getProvider(provider.name);
      if (!providerInstance?.discoverModelDetails) {
        return reply.code(501).send({
          error: 'Provider does not support live model discovery',
          message: `Provider '${provider.provider_type}' has no discoverModelDetails implementation`,
        });
      }

      const region = (provider.provider_config as any)?.region
                  ?? (provider.provider_config as any)?.location;
      let discovered: ModelDiscoveryRecord;
      try {
        const result = await providerInstance.discoverModelDetails(modelId, region);
        if (!result) {
          return reply.code(502).send({ error: 'Refresh discovery returned null', modelId });
        }
        discovered = result;
      } catch (err: any) {
        logger.error({ providerId, modelId, err: err?.message }, '[admin] Refresh discovery failed');
        return reply.code(502).send({
          error: 'Refresh from provider failed',
          message: err?.message || String(err),
          modelId,
        });
      }

      const caps = discovered.capabilities;
      await prisma.modelRoleAssignment.update({
        where: { id: existing.id },
        data: {
          max_tokens: discovered.maxOutputTokens ?? undefined,
          temperature: discovered.temperature ?? 0.5,
          thinking_budget: discovered.thinkingBudget ?? undefined,
          capabilities: caps as any,
          options: {
            contextWindow: discovered.contextWindow,
            family: discovered.family,
            topP: discovered.topP,
            topK: discovered.topK,
            providerType: discovered.providerType,
            pricingRegion: discovered.pricing.region,
            nativeToolCalling: caps.nativeToolCalling,
          } as any,
          // OSS schema only tracks a single cost_per_request column for now;
          // detailed per-token pricing is enterprise-tier.
          cost_per_request: discovered.pricing.perRequestUsd ?? null,
          pricing_source: discovered.pricing.source,
          pricing_fetched_at: new Date(discovered.pricing.fetchedAt),
        },
      });

      logger.info({
        providerId: provider.id,
        modelId,
        pricingSource: discovered.pricing.source,
        pricingFetchedAt: discovered.pricing.fetchedAt,
      }, '[admin] Registry row refreshed from provider (#650)');

      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: (request as any).user?.id,
        userEmail: (request as any).user?.email,
        action: 'REFRESH_PROVIDER_MODEL',
        resource: 'LLMProvider',
        resourceId: providerId,
        details: { modelId, providerName: provider.name, pricingSource: discovered.pricing.source },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      return reply.send({
        message: 'Refreshed from provider',
        modelId,
        provider: provider.name,
        pricing_source: discovered.pricing.source,
        pricing_fetched_at: discovered.pricing.fetchedAt,
        contextWindow: discovered.contextWindow,
        maxOutputTokens: discovered.maxOutputTokens,
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId, modelId: request.params.modelId },
        'Failed to refresh model from provider');
      return reply.code(500).send({
        error: 'Failed to refresh model',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/refresh-all
   *
   * #650 U8 — Walks every Active Registry row and re-runs live discovery
   * via RefreshModelDetailsJob. Per-row failures are isolated. Logs price
   * deltas. The k8s CronJob hits this endpoint daily at 03:00 UTC; admin
   * UI may surface a manual "Refresh All" button later.
   *
   * Auth: inherits the admin middleware on this plugin's parent.
   */
  fastify.post('/llm-providers/refresh-all', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      if (!providerManager) {
        return reply.code(503).send({ error: 'ProviderManager not initialized' });
      }
      const { RefreshModelDetailsJob } = await import('../../jobs/RefreshModelDetailsJob.js');
      const job = new RefreshModelDetailsJob(prisma as any, providerManager, logger as any);
      const result = await job.run();
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: (request as any).user?.id,
        userEmail: (request as any).user?.email,
        action: 'REFRESH_ALL_MODELS',
        resource: 'LLMProvider',
        resourceId: 'all',
        details: result,
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});
      return reply.send({ message: 'Refresh sweep complete', ...result });
    } catch (error) {
      logger.error({ error }, 'Refresh-all sweep failed');
      return reply.code(500).send({
        error: 'Refresh-all sweep failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/:providerId/models/:modelId/test
   * Low-token "is this model alive?" check from the Model Registry UI.
   * Sends a tiny prompt asking the model to reply with "ok" + its self-reported
   * id, returns pass/fail + latency + token usage + the model's own response.
   * Goal: one-click validation that the model is reachable, configured
   * correctly, and IS the model the admin thinks it is (catches provider-side
   * aliasing/fallbacks).
   */
  fastify.post<{
    Params: { providerId: string; modelId: string };
  }>('/llm-providers/:providerId/models/:modelId/test', async (request, reply) => {
    const { providerId, modelId: rawModelId } = request.params;
    const modelId = decodeURIComponent(rawModelId);
    const startedAt = Date.now();
    try {
      if (!providerManager) {
        return reply.code(503).send({ ok: false, error: 'ProviderManager not initialized' });
      }

      // Resolve provider name. providerId can be the DB id OR the provider name.
      let providerName = providerId;
      try {
        const { prisma: p } = await import('../../utils/prisma.js');
        const row = await p.lLMProvider.findFirst({ where: { OR: [{ id: providerId }, { name: providerId }] } });
        if (row) providerName = row.name;
      } catch { /* fall through */ }

      // Verify the provider is enabled in the live map (#59 cascade rule)
      if (!providerManager.hasProvider(providerName)) {
        return reply.code(409).send({
          ok: false,
          error: `Provider "${providerName}" is not enabled. Enable it in admin LLM Providers first.`,
          latencyMs: Date.now() - startedAt,
        });
      }

      // Fire a minimal completion. Cap at ~80 output tokens — this is a
      // health probe, not a generation. We deliberately ask the model to
      // self-identify so the admin can compare against the configured id.
      const probe = `Reply with EXACTLY this format and nothing else:\nOK | <your model id and version>`;
      const completionRequest: any = {
        model: modelId,
        messages: [{ role: 'user', content: probe }],
        temperature: 0,
        max_tokens: 80,
        stream: false,
      };
      const result: any = await providerManager.createCompletion(completionRequest, providerName);

      // Drain async generator if needed (some providers return a stream even when stream:false)
      let content = '';
      let usage: any = null;
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        for await (const chunk of result as any) {
          if (chunk?.choices?.[0]?.delta?.content) content += chunk.choices[0].delta.content;
          if (chunk?.usage) usage = chunk.usage;
        }
      } else if (result?.choices?.[0]?.message?.content) {
        content = result.choices[0].message.content;
        usage = result.usage;
      } else if (typeof result?.content === 'string') {
        content = result.content;
        usage = result.usage;
      }

      const latencyMs = Date.now() - startedAt;
      const success = content.trim().length > 0;
      const reportedModel = (() => {
        const m = content.match(/OK\s*\|\s*(.+)/i);
        return m ? m[1].trim().slice(0, 200) : null;
      })();

      logger.info({
        providerName,
        configuredModelId: modelId,
        latencyMs,
        success,
        reportedModel,
        usage,
      }, '[Model Test] Completed');

      return reply.send({
        ok: success,
        latencyMs,
        configuredModelId: modelId,
        reportedModel,
        responsePreview: content.slice(0, 200),
        usage: usage ? {
          prompt: usage.prompt_tokens ?? usage.promptTokens,
          completion: usage.completion_tokens ?? usage.completionTokens,
          total: usage.total_tokens ?? usage.totalTokens,
        } : null,
        provider: providerName,
      });
    } catch (err: any) {
      const latencyMs = Date.now() - startedAt;
      logger.warn({ providerId, modelId, error: err?.message, latencyMs }, '[Model Test] Failed');
      return reply.code(200).send({
        ok: false,
        latencyMs,
        configuredModelId: modelId,
        error: err?.message || 'Test failed',
      });
    }
  });

  /**
   * PUT /api/admin/llm-providers/:providerId/models/:modelId
   * Update a model's config. modelId is URL-encoded.
   */
  fastify.put<{
    Params: { providerId: string; modelId: string };
    Body: {
      displayName?: string;
      capabilities?: { chat?: boolean; vision?: boolean; tools?: boolean; streaming?: boolean; embeddings?: boolean };
      config?: {
        maxOutputTokens?: number;
        maxInputTokens?: number;
        rateLimitRequestsPerHour?: number;
        rateLimitTokensPerHour?: number;
        temperature?: number;
        topP?: number;
        enabled?: boolean;
        roles?: string[];
      };
    };
  }>('/llm-providers/:providerId/models/:modelId', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const decodedModelId = decodeURIComponent(request.params.modelId);

      const { prisma } = await import('../../utils/prisma.js');

      const provider = await resolveProvider(prisma, providerId);

      if (!provider) {
          return reply.code(404).send({ error: 'Provider not found', message: `Provider '${providerId}' not found` });
      }

      // Registry SoT — look up the row in admin.model_role_assignments.
      // Legacy provider_config.models[] is no longer the source.
      const registryRow = await prisma.modelRoleAssignment.findFirst({
        where: { provider: provider.name, model: decodedModelId },
      });

      // Model might also be referenced via model_config (chatModel, embeddingModel, etc.)
      // model_config can be stored as JSON string in some providers — parse it
      let modelConfig = (provider.model_config as any) || {};
      if (typeof modelConfig === 'string') {
        try { modelConfig = JSON.parse(modelConfig); } catch { modelConfig = {}; }
      }
      const modelConfigFields = ['chatModel', 'embeddingModel', 'visionModel', 'imageModel', 'compactionModel', 'defaultModel'];
      const isInModelConfig = modelConfigFields.some(f => modelConfig[f] === decodedModelId);
      const isInDisabled = (Array.isArray(modelConfig.disabledModels) && modelConfig.disabledModels.includes(decodedModelId)) ||
        (modelConfig._disabled && Object.values(modelConfig._disabled).includes(decodedModelId));

      if (!registryRow && !isInModelConfig && !isInDisabled) {
          return reply.code(404).send({ error: 'Model not found', message: `Model '${decodedModelId}' not found on this provider` });
      }

      const updateData: any = { updated_by: (request as any).user?.id };

      if (registryRow) {
        // Update the Registry row directly.
        await prisma.modelRoleAssignment.update({
          where: { id: registryRow.id },
          data: {
            description: request.body.displayName ?? registryRow.description,
            capabilities: request.body.capabilities ? { ...(registryRow.capabilities as any || {}), ...request.body.capabilities } : (registryRow.capabilities as any),
            max_tokens: request.body.config?.maxOutputTokens ?? registryRow.max_tokens,
            temperature: request.body.config?.temperature ?? registryRow.temperature,
            enabled: request.body.config?.enabled !== undefined ? request.body.config.enabled : registryRow.enabled,
            options: { ...((registryRow.options as any) || {}), auto: false },
          },
        });
      }

      // Update disabledModels array for ANY model source (model_config fields OR provider_config.models)
      // The smart router uses disabledModels as the single source of truth for filtering
      if (request.body.config?.enabled !== undefined) {
        const updatedModelConfig = { ...(updateData.model_config || modelConfig) };
        const disabledModels: string[] = Array.isArray(updatedModelConfig.disabledModels) ? [...updatedModelConfig.disabledModels] : [];

        if (!request.body.config.enabled) {
          // Add to disabled list
          if (!disabledModels.includes(decodedModelId)) {
            disabledModels.push(decodedModelId);
          }
        } else {
          // Remove from disabled list
          const idx = disabledModels.indexOf(decodedModelId);
          if (idx >= 0) disabledModels.splice(idx, 1);
        }
        updatedModelConfig.disabledModels = disabledModels;

        // Clean up any legacy _disabled data
        delete updatedModelConfig._disabled;

        updateData.model_config = updatedModelConfig;
      }

      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: updateData,
      });

      logger.info({ providerId, modelId: decodedModelId }, 'Model updated on provider');

      // Trigger hot-reload
      if (providerManager) {
        await invalidateAllModelCaches(logger);
      }

      return reply.send({
        message: 'Model updated successfully',
        model: registryRow ? { id: registryRow.model, displayName: request.body.displayName ?? registryRow.description } : { id: decodedModelId },
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId, modelId: request.params.modelId }, 'Failed to update model');
      return reply.code(500).send({
        error: 'Failed to update model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/admin/llm-providers/:providerId/models/:modelId
   * Remove a model from a provider's provider_config.models array.
   */
  fastify.delete<{
    Params: { providerId: string; modelId: string };
    Querystring: { force?: string };
  }>('/llm-providers/:providerId/models/:modelId', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const decodedModelId = decodeURIComponent(request.params.modelId);
      const force = (request.query as any)?.force === 'true';

      const { prisma } = await import('../../utils/prisma.js');

      const provider = await resolveProvider(prisma, providerId);

      if (!provider) {
          return reply.code(404).send({ error: 'Provider not found', message: `Provider '${providerId}' not found` });
      }

      // Use computeDeletePlan() to classify references:
      //   - Self-referencing fields on THIS provider → auto-clear (was a 409 pre-2026-04-21)
      //   - Cross-provider refs / role assignments → real 409 (unless force)
      //   - Chat session pins → cascade-null (never blocks)
      const { computeDeletePlan } = await import('../../services/model-routing/deleteModelPlan.js');

      const [roleAssignmentCount, recentSessionCount, otherProvidersRaw] = await Promise.all([
        prisma.modelRoleAssignment.count({ where: { model: decodedModelId, enabled: true } }),
        prisma.chatSession.count({
          where: { model: decodedModelId, updated_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
        prisma.lLMProvider.findMany({
          where: { deleted_at: null, enabled: true, id: { not: provider.id } },
          select: { id: true, name: true, model_config: true, provider_config: true },
        }),
      ]);

      const plan = computeDeletePlan({
        targetProviderId: provider.id,
        modelId: decodedModelId,
        targetProvider: {
          id: provider.id,
          name: provider.name,
          model_config: provider.model_config as any,
          provider_config: provider.provider_config as any,
        },
        otherEnabledProviders: otherProvidersRaw.map((p: any) => ({
          id: p.id, name: p.name,
          model_config: p.model_config as any,
          provider_config: p.provider_config as any,
        })),
        roleAssignmentCount,
        recentSessionCount,
        force,
      });

      if (!plan.canDelete) {
        return reply.code(409).send({
          error: 'MODEL_IN_USE',
          message: `Cannot delete "${decodedModelId}": ${plan.blockers.map(b => b.description).join('; ')}. Use ?force=true to override.`,
          blockers: plan.blockers,
          selfReferenceFields: plan.selfReferenceFields,
          recentSessionCount: plan.recentSessionCount,
        });
      }

      // Registry SoT — delete the row from admin.model_role_assignments
      // (the new SoT) instead of mutating provider_config.models[]. Model
      // existence is checked against Registry + model_config slots only.
      const registryRows = await prisma.modelRoleAssignment.findMany({
        where: { provider: provider.name, model: decodedModelId },
      });
      // model_config can be stored as JSON string — parse it
      let modelConfig = (provider.model_config as any) || {};
      if (typeof modelConfig === 'string') {
        try { modelConfig = JSON.parse(modelConfig); } catch { modelConfig = {}; }
      }

      const wasInRegistry = registryRows.length > 0;

      // Check model_config fields
      const modelConfigFields = ['chatModel', 'embeddingModel', 'visionModel', 'imageModel', 'compactionModel', 'defaultModel'];
      const wasInModelConfig = modelConfigFields.some(f => modelConfig[f] === decodedModelId);
      const wasInDisabled = Array.isArray(modelConfig.disabledModels) && modelConfig.disabledModels.includes(decodedModelId);
      const wasInAdditional = Array.isArray(modelConfig.additionalModels) && modelConfig.additionalModels.includes(decodedModelId);

      if (!wasInRegistry && !wasInModelConfig && !wasInDisabled && !wasInAdditional) {
          return reply.code(404).send({ error: 'Model not found', message: `Model '${decodedModelId}' not found on this provider` });
      }

      // Clean up model_config fields that reference this model
      const updatedModelConfig = { ...modelConfig };
      for (const field of modelConfigFields) {
        if (updatedModelConfig[field] === decodedModelId) {
          delete updatedModelConfig[field];
        }
      }
      // Also remove from additionalModels
      if (Array.isArray(updatedModelConfig.additionalModels)) {
        updatedModelConfig.additionalModels = updatedModelConfig.additionalModels.filter((m: string) => m !== decodedModelId);
      }
      // Remove from disabledModels if present (prevents dead references)
      if (Array.isArray(updatedModelConfig.disabledModels)) {
        updatedModelConfig.disabledModels = updatedModelConfig.disabledModels.filter((m: string) => m !== decodedModelId);
      }

      // Delete Registry rows for this (provider, model) pair.
      if (wasInRegistry) {
        await prisma.modelRoleAssignment.deleteMany({
          where: { provider: provider.name, model: decodedModelId },
        });
      }
      // Update model_config only (no provider_config.models[] write — Registry is SoT).
      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: {
          model_config: updatedModelConfig,
          updated_by: (request as any).user?.id
        }
      });

      // Cascade: null chat_sessions.model for any session pinned to the deleted model
      // so the next send falls through to the tenant default (or the router's "unknown
      // model" error) instead of silently trying to route a dangling pin.
      let sessionsCleared = 0;
      try {
        const r = await prisma.chatSession.updateMany({
          where: { model: decodedModelId },
          data: { model: null },
        });
        sessionsCleared = r.count;
      } catch (cascadeErr: any) {
        logger.warn({ error: cascadeErr?.message, modelId: decodedModelId }, '[admin] chat session cascade failed — non-fatal');
      }

      logger.info({ providerId: provider.id, modelId: decodedModelId, sessionsCleared }, 'Model removed from provider');

      // Audit log
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.WARNING,
        userId: (request as any).user?.id,
        userEmail: (request as any).user?.email,
        action: 'REMOVE_PROVIDER_MODEL',
        resource: 'LLMProvider',
        resourceId: providerId,
        details: { modelId: decodedModelId, providerName: provider.name },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      // Trigger hot-reload
      if (providerManager) {
        await invalidateAllModelCaches(logger);
      }

      const remainingRegistryRows = await prisma.modelRoleAssignment.count({
        where: { provider: provider.name },
      });
      return reply.send({
        message: 'Model removed successfully',
        modelId: decodedModelId,
        remainingModels: remainingRegistryRows,
        selfReferencesCleared: plan.selfReferenceFields,
        sessionsCleared,
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId, modelId: request.params.modelId }, 'Failed to remove model');
      return reply.code(500).send({
        error: 'Failed to remove model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/database
   * List all providers from database (including disabled/deleted)
   * Also includes environment-based providers as read-only system providers
   */
  fastify.get('/llm-providers/database', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');

      const dbProviders = await prisma.lLMProvider.findMany({
        orderBy: [
          { priority: 'asc' },
          { created_at: 'desc' }
        ],
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          updater: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      // Get environment-based providers from ProviderConfigService
      let envProviders: any[] = [];
      try {
        const { ProviderConfigService } = await import('../../services/llm-providers/ProviderConfigService.js');
        const configService = new ProviderConfigService(logger);
        const config = await configService.loadProviderConfig();

        // Convert environment providers to database format
        envProviders = config.providers.map((p: any) => ({
          id: `env-${p.name}`,
          name: p.name,
          display_name: p.name === 'azure-openai' ? 'Azure OpenAI' :
                        p.name === 'aws-bedrock' ? 'AWS Bedrock' :
                        p.name === 'google-vertex' ? 'Google Vertex AI' : p.name,
          provider_type: p.type,
          enabled: p.enabled,
          priority: p.priority,
          description: `Environment-configured ${p.type} provider (read-only)`,
          tags: ['system', 'environment'],
          auth_config: { type: 'environment' },
          provider_config: (() => {
            // SECURITY: Strip credential fields from provider_config before sending to client
            const cfg = { ...(p.config || {}) };
            const credFields = ['apiKey', 'key', 'clientSecret', 'secretAccessKey', 'credentials', 'accessKeyId', 'password', 'token'];
            for (const f of credFields) {
              if (f in cfg) delete cfg[f];
            }
            return cfg;
          })(),
          model_config: {
            maxTokens: p.config?.maxTokens,
            temperature: p.config?.temperature
          },
          capabilities: {
            chat: true,
            embeddings: false,
            tools: true,
            vision: false,
            streaming: true
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          created_by: 'system',
          updated_by: 'system',
          isEnvironmentProvider: true // Flag to indicate it's from env
        }));
      } catch (envError) {
        logger.warn({ error: envError }, 'Failed to load environment providers');
      }

      // Merge database and environment providers
      // SECURITY: Redact credential values but keep non-sensitive config fields
      // so the edit form can display them (endpoint URLs, regions, project IDs)
      const credentialFields = new Set([
        'apiKey', 'key', 'clientSecret', 'secretAccessKey', 'awsSecretAccessKey',
        'accessKeyId', 'awsAccessKeyId', 'credentials', 'serviceAccountCredentials',
        'password', 'token', 'serviceAccountKey'
      ]);
      const sanitizedDbProviders = dbProviders.map((p: any) => {
        const rawAuth = decryptAuthConfig(p.auth_config as any) || {};
        const sanitized: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawAuth)) {
          if (credentialFields.has(k)) {
            // Replace credential values with boolean flag
            sanitized[`has_${k}`] = !!v;
          } else {
            // Pass through non-sensitive fields (type, region, endpoint, projectId, etc.)
            sanitized[k] = v;
          }
        }
        // Normalize BigInt → Number so the response JSON-serializes cleanly,
        // and the UI's §11.5 useOptimisticVersion gets an integer it can POST back.
        const version = typeof p.version === 'bigint' ? Number(p.version) : Number(p.version ?? 1);
        return { ...p, auth_config: sanitized, version };
      });
      // SINGLE SOURCE OF TRUTH: Database is authoritative.
      // Env providers only shown if NOT already in DB (to avoid duplicates).
      // DB providers that originated from env get an 'isEnvironmentProvider' flag.
      const dbNames = new Set(sanitizedDbProviders.map((p: any) => p.name));
      const uniqueEnvProviders = envProviders.filter((p: any) => !dbNames.has(p.name));

      // Mark DB providers that have a matching env provider
      for (const dbp of sanitizedDbProviders) {
        if (envProviders.some((ep: any) => ep.name === (dbp as any).name)) {
          (dbp as any).isEnvironmentProvider = true;
        }
      }

      // Filter out deleted and test providers
      const allProviders = [...sanitizedDbProviders, ...uniqueEnvProviders]
        .filter((p: any) => !p.deleted_at && !p.name?.startsWith('e2e-test'));

      // Enrich display_name with provider context (host, deployment, region, project)
      for (const p of allProviders) {
        const pc = (p as any).provider_config || {};
        const ac = (p as any).auth_config || {};
        let ctx = '';
        const type = (p as any).provider_type;
        if (type === 'ollama') ctx = pc.host || pc.endpoint || pc.ollamaHost || '';
        else if (type?.includes('azure')) ctx = pc.deployment || pc.endpoint?.split?.('.')?.[0]?.replace?.('https://', '') || ac.tenantId || '';
        else if (type === 'aws-bedrock') ctx = ac.region || pc.region || '';
        else if (type === 'vertex-ai') ctx = pc.projectId || pc.location || '';
        if (ctx && !(p as any).display_name?.includes(ctx.slice(0, 10))) {
          // Keep `:` so host:port stays readable (see same pattern at line ~149)
          const slug = ctx.replace(/https?:\/\//, '').replace(/[^a-z0-9.\-:]/gi, '').slice(0, 30);
          if (slug) (p as any).display_name = `${(p as any).display_name} (${slug})`;
        }
      }

      return reply.send({
        providers: allProviders,
        total: allProviders.length,
        enabled: allProviders.filter((p: any) => p.enabled && !p.deleted_at).length,
        disabled: allProviders.filter((p: any) => !p.enabled || p.deleted_at).length,
        environmentProviders: allProviders.filter((p: any) => p.isEnvironmentProvider).length,
        databaseProviders: sanitizedDbProviders.length
      });

    } catch (error) {
      logger.error({ error }, 'Failed to list database providers');
      return reply.code(500).send({
        error: 'Failed to list providers',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/ollama-instance/models
   * List all models currently available in Ollama
   */
  fastify.get('/llm-providers/ollama-instance/models', async (request, reply) => {
    try {
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (!res.ok) throw new Error('Failed to fetch Ollama models');

      const data = await res.json();

      return reply.send({
        models: data.models || [],
        totalModels: data.models?.length || 0
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list Ollama models');
      return reply.code(500).send({
        error: 'Failed to list Ollama models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/ollama/models/pull
   * Pull (download) a new model from Ollama registry
   * Returns streaming progress updates
   */
  fastify.post<{
    Body: {
      model: string;
    };
  }>('/llm-providers/ollama-instance/models/pull', async (request, reply): Promise<void> => {
    try {
      const { model } = request.body;

      if (!model) {
        reply.code(400).send({
          error: 'Missing model name',
          message: 'Please provide a model name to pull'
        });
        return;
      }

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      logger.info({ model }, 'Pulling Ollama model');

      // Start the pull (this is async and streams progress)
      const res = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: model })
      });

      if (!res.ok) {
        throw new Error(`Ollama API error: ${res.statusText}`);
      }

      // Stream progress back to client
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked'
      });

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        reply.raw.write(chunk);
      }

      reply.raw.end();

      logger.info({ model }, 'Ollama model pull completed');
    } catch (error) {
      logger.error({ error, model: request.body?.model }, 'Failed to pull Ollama model');

      if (!reply.sent) {
        reply.code(500).send({
          error: 'Failed to pull model',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });

  /**
   * DELETE /api/admin/llm-providers/ollama/models/:model
   * Delete a model from Ollama
   */
  fastify.delete<{
    Params: { model: string };
  }>('/llm-providers/ollama/models/:model', async (request, reply) => {
    try {
      const { model } = request.params;

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      logger.info({ model }, 'Deleting Ollama model');

      const res = await fetch(`${ollamaUrl}/api/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: model })
      });

      if (!res.ok) {
        throw new Error(`Ollama API error: ${res.statusText}`);
      }

      logger.info({ model }, 'Ollama model deleted');

      return reply.send({
        message: 'Model deleted successfully',
        model
      });
    } catch (error) {
      logger.error({ error, model: request.params.model }, 'Failed to delete Ollama model');
      return reply.code(500).send({
        error: 'Failed to delete model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Legacy GET /llm-providers/:name/models route removed — replaced by new CRUD routes above

  // Legacy POST /llm-providers/:name/models route removed — replaced by new CRUD routes above

  // Legacy DELETE /llm-providers/:name/models/:modelId route removed — replaced by new CRUD routes above

  /**
   * POST /api/admin/llm-providers/:name/models/add-from-catalog
   * Add a model from the catalog to the provider's configuration
   */
  fastify.post<{
    Params: { name: string };
    Body: { modelId: string };
  }>('/llm-providers/:name/models/add-from-catalog', async (request, reply) => {
    try {
      const { name: providerName } = request.params;
      const { modelId } = request.body;

      if (!modelId) {
        return reply.code(400).send({ error: 'modelId is required' });
      }

      // Get model info from catalog
      const catalogResponse = await fastify.inject({
        method: 'GET',
        url: '/admin/llm-providers/vertex-ai/catalog',
        headers: request.headers as any
      });

      const catalog = JSON.parse(catalogResponse.payload);
      let modelInfo: any = null;

      // Search in all categories
      for (const category of ['chat', 'imageGeneration', 'embeddings']) {
        const found = catalog.catalog?.[category]?.find((m: any) => m.id === modelId);
        if (found) {
          modelInfo = found;
          break;
        }
      }

      if (!modelInfo) {
        return reply.code(404).send({ error: `Model ${modelId} not found in catalog` });
      }

      // Add to provider configuration
      const addResponse = await fastify.inject({
        method: 'POST',
        url: `/admin/llm-providers/${providerName}/models`,
        headers: request.headers as any,
        payload: {
          id: modelInfo.id,
          name: modelInfo.name,
          capabilities: modelInfo.capabilities,
          maxTokens: modelInfo.maxTokens,
          contextWindow: modelInfo.contextWindow,
          description: modelInfo.description,
          pricing: modelInfo.pricing
        }
      });

      return reply.code(addResponse.statusCode).send(JSON.parse(addResponse.payload));
    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Failed to add model from catalog');
      return reply.code(500).send({
        error: 'Failed to add model from catalog',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/:name/deploy-model
   * Create an AIF deployment for a catalog model via ARM API.
   * This is the AIF equivalent of "adding a model" — it provisions a deployment
   * in the CognitiveServices account so the model becomes usable for inference.
   */
  fastify.post<{
    Params: { name: string };
    Body: { modelName: string; modelVersion?: string; modelFormat?: string; sku?: string; capacity?: number; deploymentName?: string };
  }>('/llm-providers/:name/deploy-model', async (request, reply) => {
    const { name: providerName } = request.params;
    const { modelName, modelVersion, modelFormat, sku = 'GlobalStandard', capacity = 1, deploymentName } = request.body;

    if (!modelName) return reply.code(400).send({ error: 'modelName is required' });

    try {
      const { prisma } = await import('../../utils/prisma.js');
      const dbRecord = await prisma.lLMProvider.findFirst({
        where: { name: providerName, deleted_at: null },
      });
      if (!dbRecord || dbRecord.provider_type !== 'azure-ai-foundry') {
        return reply.code(400).send({ error: 'Provider not found or not AIF type' });
      }

      const authConfig = decryptAuthConfig(dbRecord.auth_config as any) || {};
      const providerConfig = (dbRecord.provider_config as any) || {};
      const tenantId = authConfig.tenantId;
      const clientId = authConfig.clientId;
      const clientSecret = authConfig.clientSecret;
      const endpointUrl = authConfig.endpointUrl || providerConfig.endpointUrl || '';

      if (!tenantId || !clientId || !clientSecret || !endpointUrl) {
        return reply.code(400).send({ error: 'AIF provider missing Entra credentials or endpoint' });
      }

      // Get ARM token
      const tokenResp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret,
          scope: 'https://management.azure.com/.default',
        }).toString(),
      });
      if (!tokenResp.ok) return reply.code(500).send({ error: 'Failed to get ARM token' });
      const { access_token: armToken } = await tokenResp.json() as any;

      // Find the CognitiveServices account
      const hostname = new URL(endpointUrl).hostname;
      const accountName = hostname.split('.')[0];
      const subsResp = await fetch('https://management.azure.com/subscriptions?api-version=2022-12-01', {
        headers: { Authorization: `Bearer ${armToken}` },
      });
      const subsData = await subsResp.json() as any;

      let subId = '', rg = '';
      for (const sub of (subsData.value || [])) {
        const acctResp = await fetch(
          `https://management.azure.com/subscriptions/${sub.subscriptionId}/providers/Microsoft.CognitiveServices/accounts?api-version=2024-10-01`,
          { headers: { Authorization: `Bearer ${armToken}` } }
        );
        if (!acctResp.ok) continue;
        const acctData = await acctResp.json() as any;
        const account = (acctData.value || []).find((a: any) => a.name === accountName);
        if (account) {
          subId = sub.subscriptionId;
          const rgMatch = account.id?.match(/resourceGroups\/([^/]+)/i);
          rg = rgMatch?.[1] || '';
          break;
        }
      }
      if (!subId || !rg) return reply.code(404).send({ error: `Could not find AIF account ${accountName}` });

      // Create the deployment via ARM PUT
      const deplName = deploymentName || modelName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const deplUrl = `https://management.azure.com/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.CognitiveServices/accounts/${accountName}/deployments/${deplName}?api-version=2024-10-01`;

      // Determine model format — if not provided, infer from model name
      let format = modelFormat || 'OpenAI';
      if (!modelFormat) {
        const ml = modelName.toLowerCase();
        if (ml.includes('claude')) format = 'Anthropic';
        else if (ml.includes('llama') || ml.includes('meta-llama')) format = 'Meta';
        else if (ml.includes('mistral') || ml.includes('codestral')) format = 'Mistral AI';
        else if (ml.includes('deepseek')) format = 'DeepSeek';
        else if (ml.includes('phi')) format = 'Microsoft';
        else if (ml.includes('cohere')) format = 'Cohere';
        else if (ml.includes('grok')) format = 'xAI';
        else if (ml.includes('jamba') || ml.includes('ai21')) format = 'AI21 Labs';
        else if (ml.includes('qwen')) format = 'Alibaba';
      }

      const deplBody = {
        sku: { name: sku, capacity },
        properties: {
          model: {
            format,
            name: modelName,
            version: modelVersion || '',
          },
        },
      };

      logger.info({ accountName, deplName, modelName, sku, capacity }, 'Creating AIF deployment via ARM');

      const createResp = await fetch(deplUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${armToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(deplBody),
      });

      if (!createResp.ok) {
        const errText = await createResp.text().catch(() => '');
        logger.error({ status: createResp.status, error: errText }, 'AIF deployment creation failed');
        return reply.code(createResp.status).send({ error: `Deployment failed: ${createResp.status}`, details: errText });
      }

      const result = await createResp.json() as any;

      // Also add to provider_config.models[] in DB
      const existingModels = Array.isArray(providerConfig.models) ? providerConfig.models : [];
      if (!existingModels.some((m: any) => m.id === deplName)) {
        existingModels.push({
          id: deplName,
          name: modelName,
          capabilities: { chat: true, tools: true, streaming: true },
          config: {},
        });
        const { prisma: prisma2 } = await import('../../utils/prisma.js');
        await prisma2.lLMProvider.update({
          where: { id: dbRecord.id },
          data: { provider_config: { ...providerConfig, models: existingModels } },
        });
      }

      return reply.send({
        success: true,
        deployment: deplName,
        model: modelName,
        status: result.properties?.provisioningState || 'Creating',
        message: `Deployment "${deplName}" created. It may take 1-2 minutes to become active.`,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'deploy-model failed');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/admin/llm-providers/vertex-ai/catalog
   * Get full Gemini model catalog with capabilities
   */
  fastify.get('/llm-providers/vertex-ai/catalog', async (request, reply) => {
    try {
      // Comprehensive Gemini model catalog
      const catalog = {
        chat: [
          {
            id: 'gemini-2.5-pro-preview-06-05',
            name: 'Gemini 2.5 Pro Preview',
            description: 'Most capable model for complex reasoning, coding, and multimodal tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 65536,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.5-flash-preview-05-20',
            name: 'Gemini 2.5 Flash Preview',
            description: 'Fast and efficient model with strong reasoning capabilities',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 65536,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.0-flash',
            name: 'Gemini 2.0 Flash',
            description: 'Fast multimodal model for everyday tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.0-flash-lite',
            name: 'Gemini 2.0 Flash Lite',
            description: 'Cost-effective model for high-volume tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-1.5-pro',
            name: 'Gemini 1.5 Pro',
            description: 'Powerful model with 2M token context window',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 2097152
          },
          {
            id: 'gemini-1.5-flash',
            name: 'Gemini 1.5 Flash',
            description: 'Fast and versatile multimodal model',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-1.5-flash-8b',
            name: 'Gemini 1.5 Flash-8B',
            description: 'Compact and efficient for high-frequency tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-3-flash-preview',
            name: 'Gemini 3 Flash Preview',
            description: 'Next-gen Flash preview with improved capabilities',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 32768,
            contextWindow: 1048576
          },
          {
            id: 'gemini-3-pro-preview',
            name: 'Gemini 3 Pro Preview',
            description: 'Next-gen Pro preview with advanced reasoning',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 32768,
            contextWindow: 1048576
          }
        ],
        imageGeneration: [
          {
            id: 'imagen-3.0-generate-002',
            name: 'Imagen 3.0',
            description: 'High-quality image generation model',
            capabilities: { imageGeneration: true }
          },
          {
            id: 'imagen-3.0-fast-generate-001',
            name: 'Imagen 3.0 Fast',
            description: 'Fast image generation for rapid iteration',
            capabilities: { imageGeneration: true }
          },
          {
            id: 'gemini-2.0-flash-preview-image-generation',
            name: 'Gemini 2.0 Flash Image Gen',
            description: 'Multimodal with native image generation',
            capabilities: { chat: true, vision: true, imageGeneration: true }
          }
        ],
        embeddings: [
          {
            id: 'text-embedding-004',
            name: 'Text Embedding 004',
            description: 'Latest text embedding model for semantic search',
            dimensions: 768
          },
          {
            id: 'text-embedding-005',
            name: 'Text Embedding 005',
            description: 'Improved text embedding with better performance',
            dimensions: 768
          },
          {
            id: 'text-multilingual-embedding-002',
            name: 'Multilingual Embedding 002',
            description: 'Multilingual embedding supporting 100+ languages',
            dimensions: 768
          }
        ]
      };

      return reply.send({
        catalog,
        totalModels: catalog.chat.length + catalog.imageGeneration.length + catalog.embeddings.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get Vertex AI model catalog');
      return reply.code(500).send({
        error: 'Failed to get model catalog',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/playground
   * Universal model playground - test any model with full configuration
   * Supports ALL SDK options for each provider type
   */
  fastify.post<{
    Body: {
      provider: string;
      model: string;
      testType: 'chat' | 'vision' | 'tools' | 'embedding' | 'image-generation' | 'thinking';
      config?: {
        // Universal options
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        topK?: number;
        stopSequences?: string[];
        stream?: boolean;

        // OpenAI/Azure OpenAI specific
        frequencyPenalty?: number;       // -2.0 to 2.0
        presencePenalty?: number;        // -2.0 to 2.0
        seed?: number;                   // For reproducibility
        responseFormat?: {
          type: 'text' | 'json_object' | 'json_schema';
          jsonSchema?: object;
        };
        logprobs?: boolean;
        topLogprobs?: number;            // 0-20
        logitBias?: Record<string, number>;

        // Anthropic/Claude specific (via Bedrock/Foundry)
        thinkingBudget?: number;         // Extended thinking token budget
        enableThinking?: boolean;        // Enable extended thinking mode

        // Google Vertex AI specific
        safetySettings?: Array<{
          category: 'HARM_CATEGORY_HARASSMENT' | 'HARM_CATEGORY_HATE_SPEECH' | 'HARM_CATEGORY_SEXUALLY_EXPLICIT' | 'HARM_CATEGORY_DANGEROUS_CONTENT';
          threshold: 'BLOCK_NONE' | 'BLOCK_LOW_AND_ABOVE' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_ONLY_HIGH';
        }>;
        groundingConfig?: {
          googleSearchRetrieval?: {
            dynamicRetrievalConfig?: {
              mode: 'MODE_DYNAMIC';
              dynamicThreshold?: number;
            };
          };
        };

        // Ollama specific
        numCtx?: number;                 // Context length
        repeatPenalty?: number;          // 1.0 = no penalty
        numPredict?: number;             // Max tokens to predict
        mirostat?: number;               // 0, 1, or 2
        mirostatEta?: number;
        mirostatTau?: number;
      };
      input: {
        prompt?: string;
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        imageUrl?: string;
        imagePrompt?: string;
        textToEmbed?: string;
        tools?: Array<any>;
      };
    };
  }>('/llm-providers/playground', async (request, reply) => {
    try {
      const { provider, model, testType, config, input } = request.body;

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'Model playground is not available'
        });
      }

      const startTime = Date.now();
      let result: any = { success: false };

      switch (testType) {
        case 'chat': {
          const messages = input.messages || [
            ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
            { role: 'user' as const, content: input.prompt || 'Hello!' }
          ];

          // Build comprehensive completion request with all SDK options
          const completionRequest: any = {
            model,
            messages: messages as any,
            temperature: config?.temperature,
            max_tokens: config?.maxTokens || 1024,
            top_p: config?.topP,
            stream: config?.stream ?? false,
          };

          // Universal options
          if (config?.topK !== undefined) completionRequest.top_k = config.topK;
          if (config?.stopSequences) completionRequest.stop_sequences = config.stopSequences;

          // OpenAI/Azure specific options
          if (config?.frequencyPenalty !== undefined) completionRequest.frequency_penalty = config.frequencyPenalty;
          if (config?.presencePenalty !== undefined) completionRequest.presence_penalty = config.presencePenalty;
          if (config?.seed !== undefined) completionRequest.seed = config.seed;
          if (config?.responseFormat) completionRequest.response_format = config.responseFormat;
          if (config?.logprobs !== undefined) completionRequest.logprobs = config.logprobs;
          if (config?.topLogprobs !== undefined) completionRequest.top_logprobs = config.topLogprobs;
          if (config?.logitBias) completionRequest.logit_bias = config.logitBias;

          // Anthropic/Claude thinking options
          if (config?.enableThinking) {
            completionRequest.thinking = {
              type: 'enabled',
              budget_tokens: config.thinkingBudget || 8000
            };
          }

          // Google Vertex AI options
          if (config?.safetySettings) completionRequest.safety_settings = config.safetySettings;
          if (config?.groundingConfig) completionRequest.grounding_config = config.groundingConfig;

          // Ollama specific options
          if (config?.numCtx !== undefined) completionRequest.num_ctx = config.numCtx;
          if (config?.repeatPenalty !== undefined) completionRequest.repeat_penalty = config.repeatPenalty;
          if (config?.numPredict !== undefined) completionRequest.num_predict = config.numPredict;
          if (config?.mirostat !== undefined) completionRequest.mirostat = config.mirostat;
          if (config?.mirostatEta !== undefined) completionRequest.mirostat_eta = config.mirostatEta;
          if (config?.mirostatTau !== undefined) completionRequest.mirostat_tau = config.mirostatTau;

          const response = await providerManager.createCompletion(completionRequest, provider);

          const content = (response as any).choices?.[0]?.message?.content || '';
          const thinkingContent = (response as any).thinking || (response as any).choices?.[0]?.message?.thinking || null;

          result = {
            success: true,
            type: 'chat',
            response: content,
            thinking: thinkingContent,
            usage: (response as any).usage,
            latency: Date.now() - startTime,
            configApplied: {
              temperature: config?.temperature,
              maxTokens: config?.maxTokens,
              topP: config?.topP,
              topK: config?.topK,
              frequencyPenalty: config?.frequencyPenalty,
              presencePenalty: config?.presencePenalty,
              thinkingEnabled: config?.enableThinking,
              thinkingBudget: config?.thinkingBudget,
            }
          };
          break;
        }

        case 'thinking': {
          // Specialized extended thinking test for Claude/Gemini models
          const messages = input.messages || [
            { role: 'user' as const, content: input.prompt || 'Explain the implications of quantum computing on modern cryptography. Think through this step by step.' }
          ];

          const thinkingBudget = config?.thinkingBudget || 16000;

          const completionRequest: any = {
            model,
            messages: messages as any,
            temperature: config?.temperature || 1,
            max_tokens: config?.maxTokens || 4096,
            stream: false,
            thinking: {
              type: 'enabled',
              budget_tokens: thinkingBudget
            }
          };

          const response = await providerManager.createCompletion(completionRequest, provider);

          const content = (response as any).choices?.[0]?.message?.content || '';
          const thinkingContent = (response as any).thinking ||
                                  (response as any).choices?.[0]?.message?.thinking ||
                                  (response as any).thinkingContent || null;

          result = {
            success: true,
            type: 'thinking',
            response: content,
            thinking: thinkingContent,
            thinkingBudget,
            usage: (response as any).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'vision': {
          if (!input.imageUrl) {
            return reply.code(400).send({ error: 'imageUrl required for vision test' });
          }

          const response = await providerManager.createCompletion({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: input.prompt || 'What do you see in this image?' },
                { type: 'image_url', image_url: { url: input.imageUrl } }
              ] as any
            }],
            max_tokens: config?.maxTokens || 1024,
            stream: false
          }, provider);

          const content = (response as any).choices?.[0]?.message?.content || '';
          result = {
            success: true,
            type: 'vision',
            response: content,
            usage: (response as any).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'tools': {
          const tools = input.tools || [{
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather in a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                  unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                },
                required: ['location']
              }
            }
          }];

          const response = await providerManager.createCompletion({
            model,
            messages: [{ role: 'user', content: input.prompt || 'What is the weather in San Francisco?' }],
            tools,
            max_tokens: config?.maxTokens || 1024,
            stream: false
          }, provider);

          const toolCalls = (response as any).choices?.[0]?.message?.tool_calls || [];
          result = {
            success: toolCalls.length > 0,
            type: 'tools',
            toolCalls: toolCalls.map((tc: any) => ({
              name: tc.function?.name,
              arguments: tc.function?.arguments
            })),
            response: (response as any).choices?.[0]?.message?.content,
            usage: (response as any).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'image-generation': {
          // Image generation via Vertex AI Imagen
          const projectId = process.env.GOOGLE_CLOUD_PROJECT;
          const location = process.env.GCP_REGION || 'us-central1';

          if (!projectId) {
            return reply.code(400).send({ error: 'GOOGLE_CLOUD_PROJECT not configured' });
          }

          try {
            // Use the Vertex AI REST API for image generation
            const { GoogleAuth } = await import('google-auth-library');
            const auth = new GoogleAuth({
              scopes: ['https://www.googleapis.com/auth/cloud-platform']
            });
            const client = await auth.getClient();
            const accessToken = await client.getAccessToken();

            const imageGenEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

            const imageResponse = await fetch(imageGenEndpoint, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken.token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                instances: [{
                  prompt: input.imagePrompt || input.prompt || 'A beautiful sunset over mountains'
                }],
                parameters: {
                  sampleCount: 1,
                  aspectRatio: '1:1',
                  safetyFilterLevel: 'block_few'
                }
              })
            });

            if (!imageResponse.ok) {
              const errorText = await imageResponse.text();
              throw new Error(`Image generation failed: ${imageResponse.status} - ${errorText}`);
            }

            const imageData = await imageResponse.json();
            const predictions = imageData.predictions || [];

            result = {
              success: predictions.length > 0,
              type: 'image-generation',
              images: predictions.map((p: any) => ({
                base64: p.bytesBase64Encoded,
                mimeType: p.mimeType || 'image/png'
              })),
              latency: Date.now() - startTime
            };
          } catch (imageError) {
            logger.error({ error: imageError, model }, 'Image generation failed');
            result = {
              success: false,
              type: 'image-generation',
              error: imageError instanceof Error ? imageError.message : 'Image generation failed',
              latency: Date.now() - startTime
            };
          }
          break;
        }

        case 'embedding': {
          // Embedding test
          const textToEmbed = input.textToEmbed || input.prompt || 'Hello, world!';

          try {
            const providerInstance = providerManager.getProvider(provider);
            if (providerInstance && 'generateEmbedding' in providerInstance) {
              const embedding = await (providerInstance as any).generateEmbedding(textToEmbed);
              result = {
                success: true,
                type: 'embedding',
                dimensions: embedding.length,
                preview: embedding.slice(0, 10),
                latency: Date.now() - startTime
              };
            } else {
              result = {
                success: false,
                type: 'embedding',
                error: 'Provider does not support embeddings'
              };
            }
          } catch (embError) {
            result = {
              success: false,
              type: 'embedding',
              error: embError instanceof Error ? embError.message : 'Embedding failed',
              latency: Date.now() - startTime
            };
          }
          break;
        }

        default:
          return reply.code(400).send({ error: `Unknown test type: ${testType}` });
      }

      return reply.send({
        ...result,
        provider,
        model,
        config,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Playground test failed');
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/model-capabilities
   * Get model capabilities from the centralized ModelCapabilityRegistry
   * Returns context windows, provider types, and capabilities for all known models
   * This endpoint allows the UI to fetch model info dynamically instead of hardcoding
   */
  fastify.get('/llm-providers/model-capabilities', async (request, reply) => {
    try {
      const { getModelCapabilityRegistry } = await import('../../services/ModelCapabilityRegistry.js');
      const registry = getModelCapabilityRegistry();

      if (!registry) {
        return reply.code(503).send({
          error: 'ModelCapabilityRegistry not initialized',
          message: 'The model capability registry is not available'
        });
      }

      // Get all registered models with their capabilities
      const allModels = registry.getAllModelCapabilities();

      // Group by provider type for easier UI consumption
      const modelsByProvider: Record<string, any[]> = {};
      for (const model of allModels) {
        const provider = model.providerType || 'unknown';
        if (!modelsByProvider[provider]) {
          modelsByProvider[provider] = [];
        }
        modelsByProvider[provider].push(model);
      }

      return reply.send({
        models: allModels,
        modelsByProvider,
        totalModels: allModels.length,
        providers: Object.keys(modelsByProvider),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get model capabilities');
      return reply.code(500).send({
        error: 'Failed to get model capabilities',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/model-capabilities/:modelId
   * Get capabilities for a specific model
   */
  fastify.get<{ Params: { modelId: string } }>('/llm-providers/model-capabilities/:modelId', async (request, reply) => {
    try {
      const { modelId } = request.params;
      const { getModelCapabilityRegistry } = await import('../../services/ModelCapabilityRegistry.js');
      const registry = getModelCapabilityRegistry();

      if (!registry) {
        return reply.code(503).send({
          error: 'ModelCapabilityRegistry not initialized',
          message: 'The model capability registry is not available'
        });
      }

      const capabilities = registry.getCapabilities(modelId);
      const providerType = registry.detectProviderType(modelId);
      const contextWindow = registry.getContextWindow(modelId);

      return reply.send({
        modelId,
        providerType,
        contextWindow,
        capabilities,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, modelId: request.params.modelId }, 'Failed to get model capabilities');
      return reply.code(500).send({
        error: 'Failed to get model capabilities',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // /llm-providers/slider-tiers endpoint removed in 0.6.7 — slider rip
  // (task #144 + umbrella #210). Was only consumed by SystemSettingsView's
  // tier recommendation strip; removed along with the rest of slider
  // residue. registry.getSliderTierRecommendations() may still exist
  // in ModelCapabilityRegistry but is unreferenced after this edit.

  /**
   * GET /api/admin/llm-providers/discovery/status
   * Get status of model capability discovery service
   * Returns discovery mode, rate limit status, and cached model count
   */
  fastify.get('/llm-providers/discovery/status', async (request, reply) => {
    try {
      const { getModelCapabilityDiscoveryService } = await import('../../services/ModelCapabilityDiscoveryService.js');
      const discoveryService = getModelCapabilityDiscoveryService();

      if (!discoveryService) {
        return reply.send({
          mode: process.env.CAPABILITY_DISCOVERY_MODE || 'lazy',
          isDiscovering: false,
          lastDiscovery: null,
          cachedModels: 0,
          providers: [],
          message: 'Discovery service not initialized (DISABLE_MODEL_DISCOVERY=true or startup in progress)',
          timestamp: new Date().toISOString()
        });
      }

      const status = discoveryService.getDiscoveryStatus();

      return reply.send({
        ...status,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get discovery status');
      return reply.code(500).send({
        error: 'Failed to get discovery status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/sdk-options
   * Get all available SDK configuration options for each provider type
   * Used by UI to dynamically render provider-specific configuration controls
   */
  fastify.get('/llm-providers/sdk-options', async (request, reply) => {
    const sdkOptions = {
      // Common options available to all providers
      common: {
        temperature: { type: 'number', min: 0, max: 2, step: 0.1, default: 1, description: 'Controls randomness in responses' },
        maxTokens: { type: 'number', min: 1, max: 200000, default: 4096, description: 'Maximum tokens to generate' },
        topP: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, description: 'Nucleus sampling threshold' },
        stopSequences: { type: 'array', itemType: 'string', maxItems: 4, description: 'Stop generation on these sequences' },
        stream: { type: 'boolean', default: true, description: 'Enable streaming responses' },
      },

      // Azure OpenAI / OpenAI specific
      'azure-openai': {
        frequencyPenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize repeated tokens based on frequency' },
        presencePenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize tokens that have appeared at all' },
        seed: { type: 'number', min: 0, max: 2147483647, description: 'Seed for deterministic sampling (beta)' },
        responseFormat: {
          type: 'object',
          properties: {
            type: { type: 'enum', values: ['text', 'json_object', 'json_schema'], default: 'text', description: 'Response format type' },
            jsonSchema: { type: 'object', optional: true, description: 'JSON schema when type is json_schema' }
          },
          description: 'Output format (JSON mode)'
        },
        logprobs: { type: 'boolean', default: false, description: 'Return log probabilities of tokens' },
        topLogprobs: { type: 'number', min: 0, max: 20, default: 0, description: 'Number of top logprobs to return per token' },
        logitBias: { type: 'object', description: 'Token ID to bias value (-100 to 100) mapping' },
      },

      // AWS Bedrock (Anthropic Claude)
      'aws-bedrock': {
        topK: { type: 'number', min: 1, max: 500, default: 40, description: 'Only sample from top K tokens' },
        enableThinking: { type: 'boolean', default: false, description: 'Enable extended thinking mode' },
        thinkingBudget: { type: 'number', min: 1024, max: 128000, default: 8000, description: 'Token budget for thinking (requires enableThinking)' },
        stopSequences: { type: 'array', itemType: 'string', maxItems: 8191, description: 'Custom stop sequences' },
      },

      // Google Vertex AI (Gemini)
      'google-vertex': {
        topK: { type: 'number', min: 1, max: 40, default: 40, description: 'Only sample from top K tokens' },
        safetySettings: {
          type: 'array',
          itemType: 'object',
          properties: {
            category: {
              type: 'enum',
              values: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'],
              description: 'Content safety category'
            },
            threshold: {
              type: 'enum',
              values: ['BLOCK_NONE', 'BLOCK_LOW_AND_ABOVE', 'BLOCK_MEDIUM_AND_ABOVE', 'BLOCK_ONLY_HIGH'],
              default: 'BLOCK_MEDIUM_AND_ABOVE',
              description: 'Block threshold'
            }
          },
          description: 'Content safety filter settings'
        },
        enableThinking: { type: 'boolean', default: false, description: 'Enable Gemini thinking mode' },
        thinkingBudget: { type: 'number', min: 0, max: 24576, default: 8000, description: 'Token budget for thinking' },
        groundingConfig: {
          type: 'object',
          properties: {
            googleSearchRetrieval: {
              type: 'object',
              optional: true,
              description: 'Enable Google Search grounding'
            }
          },
          description: 'Configure grounding with Google Search'
        },
      },

      // Ollama (local models)
      'ollama': {
        numCtx: { type: 'number', min: 128, max: 131072, default: 4096, description: 'Context window size' },
        repeatPenalty: { type: 'number', min: 0, max: 2, step: 0.1, default: 1.1, description: 'Penalize repeated tokens' },
        numPredict: { type: 'number', min: -2, max: 131072, default: 128, description: 'Number of tokens to predict (-1 = infinite, -2 = fill context)' },
        mirostat: { type: 'enum', values: [0, 1, 2], default: 0, description: 'Mirostat sampling mode (0=disabled, 1=v1, 2=v2)' },
        mirostatEta: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, description: 'Mirostat learning rate' },
        mirostatTau: { type: 'number', min: 0, max: 10, step: 0.1, default: 5.0, description: 'Mirostat target entropy' },
        seed: { type: 'number', min: 0, default: 0, description: 'Random seed (0 = random)' },
        topK: { type: 'number', min: 1, max: 100, default: 40, description: 'Reduces the probability of generating nonsense' },
        tfsZ: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, description: 'Tail-free sampling (1=disabled)' },
      },

      // Anthropic direct
      'anthropic': {
        topK: { type: 'number', min: 1, max: 500, default: 40, description: 'Only sample from top K tokens' },
        enableThinking: { type: 'boolean', default: true, description: 'Enable extended thinking mode' },
        thinkingBudget: { type: 'number', min: 1024, max: 128000, default: 10000, description: 'Token budget for thinking' },
        stopSequences: { type: 'array', itemType: 'string', maxItems: 8191, description: 'Custom stop sequences' },
      },

      // OpenAI direct
      'openai': {
        frequencyPenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize repeated tokens based on frequency' },
        presencePenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize tokens that have appeared at all' },
        seed: { type: 'number', min: 0, max: 2147483647, description: 'Seed for deterministic sampling (beta)' },
        logprobs: { type: 'boolean', default: false, description: 'Return log probabilities of tokens' },
        topLogprobs: { type: 'number', min: 0, max: 20, default: 0, description: 'Number of top logprobs to return per token' },
      },

      // Azure AI Foundry (supports both Anthropic and OpenAI formats)
      'azure-ai-foundry': {
        // Inherits from both azure-openai and aws-bedrock
        frequencyPenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize repeated tokens (OpenAI models)' },
        presencePenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize token presence (OpenAI models)' },
        topK: { type: 'number', min: 1, max: 500, default: 40, description: 'Top-K sampling (Claude models)' },
        enableThinking: { type: 'boolean', default: false, description: 'Enable extended thinking (Claude models)' },
        thinkingBudget: { type: 'number', min: 1024, max: 128000, default: 8000, description: 'Thinking budget (Claude models)' },
      },
    };

    // Pull defaults dynamically from each provider's static getDefaultConfig() method
    // These values come from the actual provider implementations, not hardcoded here
    const providerDefaults: Record<string, ProviderDefaultConfig> = {
      'anthropic': AnthropicProvider.getDefaultConfig(),
      'openai': OpenAIProvider.getDefaultConfig(),
      'azure-openai': AzureOpenAIProvider.getDefaultConfig(),
      'vertex-ai': GoogleVertexProvider.getDefaultConfig(),
      'aws-bedrock': AWSBedrockProvider.getDefaultConfig(),
      'ollama': OllamaProvider.getDefaultConfig(),
      'azure-ai-foundry': AzureAIFoundryProvider.getDefaultConfig(),
    };

    return reply.send({
      options: sdkOptions,
      defaults: providerDefaults,
      providerTypes: Object.keys(sdkOptions).filter(k => k !== 'common'),
      timestamp: new Date().toISOString()
    });
  });

  /**
   * GET /api/admin/llm-providers/:providerName/model-defaults/:modelId
   * Query a specific configured provider's SDK for a model's actual capabilities.
   * Falls back to ModelCapabilityRegistry if the provider doesn't support live queries.
   */
  fastify.get<{
    Params: { providerName: string; modelId: string };
  }>('/llm-providers/:providerName/model-defaults/:modelId', async (request, reply) => {
    const { providerName, modelId } = request.params;

    if (!providerManager) {
      return reply.status(503).send({ error: 'ProviderManager not available' });
    }

    try {
      // Try to get live defaults from the provider's SDK
      const providersMap = providerManager.getProviders();
      const provider = providersMap.get(providerName);

      let sdkDefaults: Partial<ProviderDefaultConfig> | null = null;

      if (provider && typeof provider.getModelDefaults === 'function') {
        sdkDefaults = await provider.getModelDefaults(modelId);
      }

      // Also check ModelCapabilityRegistry for pattern-matched capabilities
      let registryDefaults: Record<string, any> | null = null;
      try {
        const { ModelCapabilityRegistry } = await import('../../services/ModelCapabilityRegistry.js');
        const registry = new ModelCapabilityRegistry(logger);
        const caps = registry.getCapabilities(modelId);
        if (caps && caps.maxOutputTokens) {
          registryDefaults = {
            maxTokens: caps.maxOutputTokens,
            maxTokensRange: [256, caps.maxOutputTokens],
            supportsThinking: caps.thinking || false,
          };
          if (caps.thinkingCapabilities) {
            registryDefaults.thinkingBudget = caps.thinkingCapabilities.defaultBudgetTokens;
            registryDefaults.supportsThinking = true;
          }
        }
      } catch (e) {
        // ModelCapabilityRegistry may not be available
      }

      // Merge: SDK response takes priority, then registry, then provider static defaults
      const providerType = provider?.type;
      const staticDefaults = providerType ? (() => {
        const classMap: Record<string, any> = {
          'ollama': OllamaProvider,
          'aws-bedrock': AWSBedrockProvider,
          'azure-openai': AzureOpenAIProvider,
          'google-vertex': GoogleVertexProvider,
          'anthropic': AnthropicProvider,
          'openai': OpenAIProvider,
          'azure-ai-foundry': AzureAIFoundryProvider,
        };
        return classMap[providerType]?.getDefaultConfig?.() || {};
      })() : {};

      const merged = {
        ...staticDefaults,
        ...(registryDefaults || {}),
        ...(sdkDefaults || {}),
      };

      return reply.send({
        modelId,
        providerName,
        defaults: merged,
        source: sdkDefaults ? 'sdk' : registryDefaults ? 'registry' : 'provider-static',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ providerName, modelId, error }, 'Failed to get model defaults');
      return reply.status(500).send({
        error: 'Failed to get model defaults',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/discover
   * Trigger manual model capability discovery
   * Respects rate limiting unless force=true is passed
   *
   * Query params:
   *   - force: boolean - Bypass rate limiting (use with caution)
   *   - provider: string - Only discover from specific provider
   */
  fastify.post<{
    Querystring: { force?: string; provider?: string };
  }>('/llm-providers/discover', async (request, reply) => {
    try {
      const { getModelCapabilityDiscoveryService } = await import('../../services/ModelCapabilityDiscoveryService.js');
      const discoveryService = getModelCapabilityDiscoveryService();

      if (!discoveryService) {
        return reply.code(503).send({
          error: 'Discovery service not initialized',
          message: 'Model capability discovery is not available. Check if DISABLE_MODEL_DISCOVERY=true',
          suggestion: 'Set CAPABILITY_DISCOVERY_MODE=lazy (default) to enable lazy discovery'
        });
      }

      const force = request.query.force === 'true';

      // Check rate limiting status before discovery
      const statusBefore = discoveryService.getDiscoveryStatus();
      const rateLimitedProviders = statusBefore.providers.filter(p => !p.canDiscover);

      if (!force && rateLimitedProviders.length > 0 && rateLimitedProviders.length === statusBefore.providers.length) {
        return reply.code(429).send({
          error: 'Rate limited',
          message: 'All providers are rate limited. Wait or use force=true to bypass',
          providers: rateLimitedProviders.map(p => ({
            name: p.name,
            waitTimeMs: p.waitTimeMs,
            waitTimeHuman: `${Math.ceil(p.waitTimeMs / 1000)}s`
          })),
          suggestion: 'Wait for the cooldown period or use ?force=true to bypass rate limiting'
        });
      }

      logger.info({ force, user: (request as any).user?.email }, 'Starting manual model discovery');

      const startTime = Date.now();
      const models = await discoveryService.discoverAllModels(force);
      const duration = Date.now() - startTime;

      const statusAfter = discoveryService.getDiscoveryStatus();

      return reply.send({
        success: true,
        modelsDiscovered: models.length,
        totalCached: statusAfter.cachedModels,
        durationMs: duration,
        providers: statusAfter.providers,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Manual discovery failed');
      return reply.code(500).send({
        error: 'Discovery failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * GET /api/admin/llm-providers/available-models
   * Fetch live list of available models from all configured providers
   * This allows admins to search and add models without knowing exact model IDs
   *
   * Query params:
   *   - provider: Filter by specific provider (aws-bedrock, google-vertex, azure-openai, ollama)
   *   - search: Search term to filter models by name
   *   - category: Filter by category (chat, embedding, image, code)
   *   - limit: Max number of models to return (default 50)
   */
  fastify.get<{
    Querystring: {
      provider?: string;
      search?: string;
      category?: string;
      limit?: string;
    };
  }>('/llm-providers/available-models', async (request, reply) => {
    try {
      const { provider, search, category, limit: limitStr } = request.query;
      const limit = parseInt(limitStr || '50', 10);

      const allModels: Array<{
        id: string;
        name: string;
        provider: string;
        category: string;
        description?: string;
        inputCostPer1M?: number;
        outputCostPer1M?: number;
        maxTokens?: number;
        capabilities?: string[];
      }> = [];

      // Fetch from AWS Bedrock if enabled and matches filter
      if ((!provider || provider === 'aws-bedrock') && process.env.AWS_BEDROCK_ENABLED === 'true') {
        try {
          const { BedrockClient, ListFoundationModelsCommand } = await import('@aws-sdk/client-bedrock');
          const client = new BedrockClient({ region: process.env.AWS_REGION || 'us-east-1' });
          const response = await client.send(new ListFoundationModelsCommand({}));

          for (const model of response.modelSummaries || []) {
            const modelId = model.modelId || '';
            const modelName = model.modelName || modelId;
            const providerName = model.providerName || 'Unknown';

            // Determine category
            let modelCategory = 'chat';
            if (modelId.includes('embed')) modelCategory = 'embedding';
            else if (modelId.includes('image') || modelId.includes('stable')) modelCategory = 'image';

            // Get pricing from BedrockPricingService
            const { bedrockPricingService } = await import('../../services/BedrockPricingService.js');
            const pricing = bedrockPricingService.getModelPricing(modelId);

            allModels.push({
              id: modelId,
              name: `${providerName} ${modelName}`,
              provider: 'aws-bedrock',
              category: modelCategory,
              description: `${providerName} model via AWS Bedrock`,
              inputCostPer1M: pricing.inputPricePer1k * 1000,
              outputCostPer1M: pricing.outputPricePer1k * 1000,
              capabilities: [
                ...(model.outputModalities || []),
                ...(model.inputModalities || []),
                model.responseStreamingSupported ? 'streaming' : ''
              ].filter(Boolean)
            });
          }
          logger.info({ count: response.modelSummaries?.length }, 'Fetched Bedrock models');
        } catch (bedrockError) {
          logger.warn({ error: bedrockError }, 'Failed to fetch Bedrock models');
        }
      }

      // Fetch from Google Vertex AI if enabled
      if ((!provider || provider === 'google-vertex') && process.env.GOOGLE_CLOUD_PROJECT) {
        try {
          // Use the Vertex AI publisher models API
          const accessToken = await getGoogleAccessToken();
          if (accessToken) {
            const project = process.env.GOOGLE_CLOUD_PROJECT;
            const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

            // Fetch Gemini models
            const geminiModels = [
              { id: 'gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', category: 'chat', inputCost: 0.10, outputCost: 0.40 },
              { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', category: 'chat', inputCost: 0.15, outputCost: 0.60 },
              { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', category: 'chat', inputCost: 0.075, outputCost: 0.30 },
              { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', category: 'chat', inputCost: 1.25, outputCost: 5.00 },
              { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash (Preview)', category: 'chat', inputCost: 0.15, outputCost: 0.60 },
              { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro (Preview)', category: 'chat', inputCost: 1.25, outputCost: 5.00 },
              { id: 'text-embedding-005', name: 'Text Embedding 005', category: 'embedding', inputCost: 0.025, outputCost: 0 },
              { id: 'text-embedding-004', name: 'Text Embedding 004', category: 'embedding', inputCost: 0.025, outputCost: 0 },
              { id: 'imagen-3.0-generate-001', name: 'Imagen 3.0', category: 'image', inputCost: 0, outputCost: 0 },
              { id: 'imagen-3.0-fast-generate-001', name: 'Imagen 3.0 Fast', category: 'image', inputCost: 0, outputCost: 0 },
            ];

            for (const model of geminiModels) {
              allModels.push({
                id: model.id,
                name: model.name,
                provider: 'google-vertex',
                category: model.category,
                description: `Google ${model.name} via Vertex AI`,
                inputCostPer1M: model.inputCost,
                outputCostPer1M: model.outputCost,
                capabilities: ['streaming', 'json-mode', model.category === 'chat' ? 'function-calling' : ''].filter(Boolean)
              });
            }
            logger.info({ count: geminiModels.length }, 'Added Vertex AI models');
          }
        } catch (vertexError) {
          logger.warn({ error: vertexError }, 'Failed to fetch Vertex AI models');
        }
      }

      // Fetch from Azure OpenAI if enabled
      if ((!provider || provider === 'azure-openai') && process.env.AZURE_OPENAI_ENDPOINT) {
        try {
          const { AzureOpenAI } = await import('openai');
          const client = new AzureOpenAI({
            endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
          });

          // Azure doesn't have a list models API, so we use known deployments
          const deployments = (process.env.AZURE_OPENAI_DEPLOYMENTS || '').split(',').filter(Boolean);
          for (const deployment of deployments) {
            allModels.push({
              id: deployment,
              name: deployment,
              provider: 'azure-openai',
              category: 'chat',
              description: `Azure OpenAI deployment: ${deployment}`,
              capabilities: ['streaming', 'function-calling']
            });
          }
          logger.info({ count: deployments.length }, 'Added Azure OpenAI models');
        } catch (azureError) {
          logger.warn({ error: azureError }, 'Failed to fetch Azure OpenAI models');
        }
      }

      // Fetch from Ollama if enabled
      if ((!provider || provider === 'ollama') && process.env.OLLAMA_BASE_URL) {
        try {
          const response = await fetch(`${process.env.OLLAMA_BASE_URL}/api/tags`);
          if (response.ok) {
            const data = await response.json() as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
            for (const model of data.models || []) {
              allModels.push({
                id: model.name,
                name: model.name,
                provider: 'ollama',
                category: 'chat',
                description: `Local Ollama model (${Math.round((model.size || 0) / 1e9)}GB)`,
                inputCostPer1M: 0, // Free
                outputCostPer1M: 0,
                capabilities: ['streaming']
              });
            }
            logger.info({ count: data.models?.length }, 'Added Ollama models');
          }
        } catch (ollamaError) {
          logger.warn({ error: ollamaError }, 'Failed to fetch Ollama models');
        }
      }

      // Apply filters
      let filtered = allModels;

      // Category filter
      if (category) {
        filtered = filtered.filter(m => m.category === category);
      }

      // Search filter (case-insensitive)
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(m =>
          m.id.toLowerCase().includes(searchLower) ||
          m.name.toLowerCase().includes(searchLower) ||
          m.description?.toLowerCase().includes(searchLower)
        );
      }

      // Sort by provider, then name
      filtered.sort((a, b) => {
        if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
        return a.name.localeCompare(b.name);
      });

      // Apply limit
      const limited = filtered.slice(0, limit);

      return reply.send({
        models: limited,
        total: filtered.length,
        providers: [...new Set(allModels.map(m => m.provider))],
        categories: [...new Set(allModels.map(m => m.category))],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to fetch available models');
      return reply.code(500).send({
        error: 'Failed to fetch available models',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * POST /api/admin/llm-providers/sync-from-env
   * Sync LLM providers from environment variables to database
   * This creates database entries for any environment-configured providers
   * that don't already exist in the database.
   * 
   * Use this to migrate from env-based config to database-based config.
   */
  fastify.post<{
    Body: {
      overwrite?: boolean; // If true, update existing providers; if false, skip them
    };
  }>('/llm-providers/sync-from-env', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const { overwrite = false } = request.body || {};

      // Load environment providers
      const { ProviderConfigService } = await import('../../services/llm-providers/ProviderConfigService.js');
      const configService = new ProviderConfigService(logger);
      const config = await configService.loadProviderConfig();

      const results = {
        created: [] as string[],
        updated: [] as string[],
        skipped: [] as string[],
        errors: [] as { provider: string; error: string }[]
      };

      for (const envProvider of config.providers) {
        try {
          // Check if provider already exists in database
          const existing = await prisma.lLMProvider.findFirst({
            where: { name: envProvider.name }
          });

          // Build auth_config based on provider type
          let authConfig: any = { type: 'environment' };
          const providerConfig: any = {};
          const modelConfig: any = {};

          if (envProvider.type === 'azure-openai') {
            authConfig = {
              type: 'entra-id',
              tenantId: envProvider.config.tenantId,
              clientId: envProvider.config.clientId,
              clientSecret: envProvider.config.clientSecret
            };
            providerConfig.endpoint = envProvider.config.endpoint;
            providerConfig.apiVersion = envProvider.config.apiVersion;
            modelConfig.chatModel = envProvider.config.deployment;
            modelConfig.maxTokens = envProvider.config.maxTokens;
            modelConfig.temperature = envProvider.config.temperature;
          } else if (envProvider.type === 'aws-bedrock') {
            authConfig = {
              type: envProvider.config.accessKeyId ? 'iam-keys' : 'irsa',
              region: envProvider.config.region,
              ...(envProvider.config.accessKeyId && {
                accessKeyId: envProvider.config.accessKeyId,
                secretAccessKey: envProvider.config.secretAccessKey
              })
            };
            if (envProvider.config.endpoint) {
              providerConfig.endpoint = envProvider.config.endpoint;
            }
            modelConfig.chatModel = envProvider.config.chatModel;
            modelConfig.embeddingModel = envProvider.config.embeddingModel;
            modelConfig.visionModel = envProvider.config.visionModel;
            modelConfig.imageModel = envProvider.config.imageModel;
            modelConfig.compactionModel = envProvider.config.compactionModel;
            modelConfig.maxTokens = envProvider.config.maxTokens;
            modelConfig.temperature = envProvider.config.temperature;
          } else if (envProvider.type === 'google-vertex') {
            authConfig = {
              type: 'service-account',
              credentials: envProvider.config.serviceAccountJson
            };
            providerConfig.projectId = envProvider.config.projectId;
            providerConfig.location = envProvider.config.location;
            modelConfig.chatModel = envProvider.config.chatModel;
            modelConfig.embeddingModel = envProvider.config.embeddingModel;
            modelConfig.visionModel = envProvider.config.visionModel;
            modelConfig.imageModel = envProvider.config.imageModel;
            modelConfig.maxTokens = envProvider.config.maxTokens;
            modelConfig.temperature = envProvider.config.temperature;
          } else if (envProvider.type === 'ollama') {
            authConfig = { type: 'none' };
            providerConfig.baseUrl = envProvider.config.baseUrl;
            modelConfig.chatModel = envProvider.config.chatModel;
            modelConfig.embeddingModel = envProvider.config.embeddingModel;
            modelConfig.visionModel = envProvider.config.visionModel;
          } else if (envProvider.type === 'azure-ai-foundry') {
            authConfig = envProvider.config.apiKey 
              ? { type: 'api-key', key: envProvider.config.apiKey }
              : {
                  type: 'entra-id',
                  tenantId: envProvider.config.tenantId,
                  clientId: envProvider.config.clientId,
                  clientSecret: envProvider.config.clientSecret
                };
            providerConfig.endpointUrl = envProvider.config.endpointUrl;
            modelConfig.chatModel = envProvider.config.chatModel;
            modelConfig.embeddingModel = envProvider.config.embeddingModel;
            modelConfig.visionModel = envProvider.config.visionModel;
          }

          const displayName = {
            'azure-openai': 'Azure OpenAI',
            'aws-bedrock': 'AWS Bedrock',
            'google-vertex': 'Google Vertex AI',
            'ollama': 'Ollama (Local)',
            'azure-ai-foundry': 'Azure AI Foundry'
          }[envProvider.type] || envProvider.name;

          const data = {
            name: envProvider.name,
            display_name: displayName,
            provider_type: envProvider.type,
            enabled: envProvider.enabled,
            priority: envProvider.priority,
            auth_config: encryptAuthConfig(authConfig),
            provider_config: providerConfig,
            model_config: modelConfig,
            capabilities: {
              chat: true,
              tools: true,
              streaming: true,
              vision: envProvider.type !== 'ollama',
              embeddings: true
            },
            description: `Synced from environment variables`,
            tags: ['synced', 'environment'],
            created_by: (request as any).user?.id,
            updated_by: (request as any).user?.id
          };

          if (existing) {
            if (overwrite) {
              await prisma.lLMProvider.update({
                where: { id: existing.id },
                data: {
                  ...data,
                  updated_at: new Date()
                }
              });
              results.updated.push(envProvider.name);
            } else {
              results.skipped.push(envProvider.name);
            }
          } else {
            await prisma.lLMProvider.create({ data });
            results.created.push(envProvider.name);
          }
        } catch (err) {
          results.errors.push({
            provider: envProvider.name,
            error: err instanceof Error ? err.message : 'Unknown error'
          });
        }
      }

      // Reload provider manager if available
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        logger.info('Provider manager reloaded after sync');
      }

      logger.info(results, 'Environment providers synced to database');

      return reply.send({
        success: true,
        message: 'Environment providers synced to database',
        results,
        total: config.providers.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to sync providers from environment');
      return reply.code(500).send({
        error: 'Failed to sync providers',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // NOTE: discover-models endpoint is defined earlier in this file (line ~356)
  // using the unified approach via provider.listModels()

  // ──────────────────────────────────────────────────────────────────────────────
  // Provider pause/resume endpoints
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/admin/llm-providers/:id/pause
   * Pause a provider with an optional duration (provider continues serving in-flight requests)
   */
  fastify.post<{ Params: { id: string }; Body: { durationMs?: number } }>(
    '/llm-providers/:id/pause',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { durationMs } = request.body || {};
        const { prisma } = await import('../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        const pausedUntil = durationMs ? new Date(Date.now() + durationMs) : null;

        await prisma.lLMProvider.update({
          where: { id },
          data: {
            status: 'paused',
            paused_until: pausedUntil,
            updated_by: (request as any).user?.id || null
          }
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'provider_paused',
          userId: (request as any).user?.id || 'admin',
          details: { providerId: id, providerName: provider.name, durationMs, pausedUntil },
          severity: AuditSeverity.WARNING,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, providerName: provider.name, pausedUntil }, 'Provider paused');

        return reply.send({
          success: true,
          message: `Provider ${provider.display_name} paused${pausedUntil ? ` until ${pausedUntil.toISOString()}` : ' indefinitely'}`,
          providerId: id,
          status: 'paused',
          pausedUntil
        });
      } catch (error) {
        logger.error({ error }, 'Failed to pause provider');
        return reply.code(500).send({
          error: 'Failed to pause provider',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  /**
   * POST /api/admin/llm-providers/:id/resume
   * Resume a paused provider
   */
  fastify.post<{ Params: { id: string } }>(
    '/llm-providers/:id/resume',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { prisma } = await import('../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        await prisma.lLMProvider.update({
          where: { id },
          data: {
            status: 'active',
            paused_until: null,
            updated_by: (request as any).user?.id || null
          }
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'provider_resumed',
          userId: (request as any).user?.id || 'admin',
          details: { providerId: id, providerName: provider.name },
          severity: AuditSeverity.INFO,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, providerName: provider.name }, 'Provider resumed');

        return reply.send({
          success: true,
          message: `Provider ${provider.display_name} resumed`,
          providerId: id,
          status: 'active'
        });
      } catch (error) {
        logger.error({ error }, 'Failed to resume provider');
        return reply.code(500).send({
          error: 'Failed to resume provider',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────────
  // Per-model disable/enable endpoints
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * PUT /api/admin/llm-providers/:id/models/:modelId/disable
   * Disable a specific model within a provider
   */
  fastify.put<{ Params: { id: string; modelId: string } }>(
    '/llm-providers/:id/models/:modelId/disable',
    async (request, reply) => {
      try {
        const { id, modelId } = request.params;
        const decodedModelId = decodeURIComponent(modelId);
        const { prisma } = await import('../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        const disabledModels = provider.disabled_models || [];
        if (!disabledModels.includes(decodedModelId)) {
          disabledModels.push(decodedModelId);
        }

        await prisma.lLMProvider.update({
          where: { id },
          data: {
            disabled_models: disabledModels,
            updated_by: (request as any).user?.id || null
          }
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'model_disabled',
          userId: (request as any).user?.id || 'admin',
          details: { providerId: id, providerName: provider.name, modelId: decodedModelId },
          severity: AuditSeverity.WARNING,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, modelId: decodedModelId }, 'Model disabled');

        return reply.send({
          success: true,
          message: `Model ${decodedModelId} disabled on provider ${provider.display_name}`,
          providerId: id,
          modelId: decodedModelId,
          disabledModels
        });
      } catch (error) {
        logger.error({ error }, 'Failed to disable model');
        return reply.code(500).send({
          error: 'Failed to disable model',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  /**
   * PUT /api/admin/llm-providers/:id/models/:modelId/enable
   * Enable a previously disabled model within a provider
   */
  fastify.put<{ Params: { id: string; modelId: string } }>(
    '/llm-providers/:id/models/:modelId/enable',
    async (request, reply) => {
      try {
        const { id, modelId } = request.params;
        const decodedModelId = decodeURIComponent(modelId);
        const { prisma } = await import('../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        const disabledModels = (provider.disabled_models || []).filter(
          (m: string) => m !== decodedModelId
        );

        await prisma.lLMProvider.update({
          where: { id },
          data: {
            disabled_models: disabledModels,
            updated_by: (request as any).user?.id || null
          }
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'model_enabled',
          userId: (request as any).user?.id || 'admin',
          details: { providerId: id, providerName: provider.name, modelId: decodedModelId },
          severity: AuditSeverity.INFO,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, modelId: decodedModelId }, 'Model enabled');

        return reply.send({
          success: true,
          message: `Model ${decodedModelId} enabled on provider ${provider.display_name}`,
          providerId: id,
          modelId: decodedModelId,
          disabledModels
        });
      } catch (error) {
        logger.error({ error }, 'Failed to enable model');
        return reply.code(500).send({
          error: 'Failed to enable model',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────────
  // Capability management endpoints
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * PUT /api/admin/llm-providers/:id/capabilities
   * Update capability assignments for a provider
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      is_chat_provider?: boolean;
      is_embedding_provider?: boolean;
      is_vision_provider?: boolean;
      is_image_provider?: boolean;
      is_compaction_provider?: boolean;
    };
  }>(
    '/llm-providers/:id/capabilities',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const {
          is_chat_provider,
          is_embedding_provider,
          is_vision_provider,
          is_image_provider,
          is_compaction_provider
        } = request.body || {};

        const { prisma } = await import('../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        // Build update data - only include fields that were provided
        const updateData: Record<string, any> = {
          updated_by: (request as any).user?.id || null
        };
        if (is_chat_provider !== undefined) updateData.is_chat_provider = is_chat_provider;
        if (is_embedding_provider !== undefined) updateData.is_embedding_provider = is_embedding_provider;
        if (is_vision_provider !== undefined) updateData.is_vision_provider = is_vision_provider;
        if (is_image_provider !== undefined) updateData.is_image_provider = is_image_provider;
        if (is_compaction_provider !== undefined) updateData.is_compaction_provider = is_compaction_provider;

        const updated = await prisma.lLMProvider.update({
          where: { id },
          data: updateData
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'provider_capabilities_updated',
          userId: (request as any).user?.id || 'admin',
          details: {
            providerId: id,
            providerName: provider.name,
            capabilities: {
              is_chat_provider: updated.is_chat_provider,
              is_embedding_provider: updated.is_embedding_provider,
              is_vision_provider: updated.is_vision_provider,
              is_image_provider: updated.is_image_provider,
              is_compaction_provider: updated.is_compaction_provider
            }
          },
          severity: AuditSeverity.INFO,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, providerName: provider.name }, 'Provider capabilities updated');

        return reply.send({
          success: true,
          message: `Capabilities updated for provider ${provider.display_name}`,
          providerId: id,
          capabilities: {
            is_chat_provider: updated.is_chat_provider,
            is_embedding_provider: updated.is_embedding_provider,
            is_vision_provider: updated.is_vision_provider,
            is_image_provider: updated.is_image_provider,
            is_compaction_provider: updated.is_compaction_provider
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to update provider capabilities');
        return reply.code(500).send({
          error: 'Failed to update provider capabilities',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  /**
   * GET /api/admin/capability-matrix
   * Returns a matrix of all providers and their capability assignments
   */
  fastify.get('/capability-matrix', async (request, reply) => {
    try {
      const { prisma } = await import('../../utils/prisma.js');

      const providers = await prisma.lLMProvider.findMany({
        where: { deleted_at: null },
        orderBy: [{ priority: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          display_name: true,
          provider_type: true,
          enabled: true,
          status: true,
          priority: true,
          is_chat_provider: true,
          is_embedding_provider: true,
          is_vision_provider: true,
          is_image_provider: true,
          is_compaction_provider: true,
          disabled_models: true,
          capabilities: true,
          paused_until: true
        }
      });

      const capabilityTypes = [
        'chat', 'embedding', 'vision', 'image', 'compaction'
      ] as const;

      // Build the matrix
      const matrix = providers.map(p => ({
        id: p.id,
        name: p.name,
        displayName: p.display_name,
        providerType: p.provider_type,
        enabled: p.enabled,
        status: p.status,
        priority: p.priority,
        pausedUntil: p.paused_until,
        disabledModelCount: p.disabled_models.length,
        capabilities: {
          chat: p.is_chat_provider,
          embedding: p.is_embedding_provider,
          vision: p.is_vision_provider,
          image: p.is_image_provider,
          compaction: p.is_compaction_provider
        },
        legacyCapabilities: p.capabilities
      }));

      // Summarize which capabilities have coverage
      const coverage: Record<string, { assigned: number; active: number; providers: string[] }> = {};
      for (const cap of capabilityTypes) {
        const capKey = `is_${cap}_provider` as keyof typeof providers[0];
        const assigned = providers.filter(p => p[capKey] === true);
        const active = assigned.filter(p => p.enabled && p.status === 'active');
        coverage[cap] = {
          assigned: assigned.length,
          active: active.length,
          providers: active.map(p => p.name)
        };
      }

      return reply.send({
        matrix,
        coverage,
        totalProviders: providers.length,
        activeProviders: providers.filter(p => p.enabled && p.status === 'active').length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get capability matrix');
      return reply.code(500).send({
        error: 'Failed to get capability matrix',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Credential rotation endpoint
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/admin/llm-providers/:id/rotate-credentials
   * Hot credential rotation - update credentials without downtime
   */
  fastify.post<{ Params: { id: string }; Body: { auth_config: Record<string, any>; credentials_expires_at?: string } }>(
    '/llm-providers/:id/rotate-credentials',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { auth_config, credentials_expires_at } = request.body || {};

        if (!auth_config || typeof auth_config !== 'object') {
          return reply.code(400).send({ error: 'auth_config object is required' });
        }

        const { prisma } = await import('../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        // Encrypt credentials before storing
        let encryptedConfig: any;
        try {
          encryptedConfig = encryptAuthConfig(auth_config);
        } catch {
          // If encryption is not configured, store as-is (development mode)
          encryptedConfig = auth_config;
          logger.warn({ providerId: id }, 'Credential encryption not configured - storing credentials in plaintext');
        }

        const updateData: Record<string, any> = {
          auth_config: encryptedConfig,
          updated_by: (request as any).user?.id || null
        };

        if (credentials_expires_at) {
          updateData.credentials_expires_at = new Date(credentials_expires_at);
        }

        await prisma.lLMProvider.update({
          where: { id },
          data: updateData
        });
  
        // Log credential rotation to credential audit service
        try {
          await credentialAuditService.log({
            userId: (request as any).user?.id || 'admin',
            userEmail: (request as any).user?.email,
            action: 'update',
            entityType: 'llm_provider',
            entityId: id,
            entityName: provider.name,
            changes: { auth_config: { old: '***redacted***', new: '***rotated***' } },
            request: request
          });
        } catch {
          // Non-critical: don't fail rotation if audit logging fails
        }

        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'credentials_rotated',
          userId: (request as any).user?.id || 'admin',
          details: {
            providerId: id,
            providerName: provider.name,
            credentialType: auth_config.type || 'unknown',
            expiresAt: credentials_expires_at || null
          },
          severity: AuditSeverity.WARNING,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, providerName: provider.name }, 'Credentials rotated successfully');

        return reply.send({
          success: true,
          message: `Credentials rotated for provider ${provider.display_name}`,
          providerId: id,
          credentialType: auth_config.type || 'unknown',
          expiresAt: credentials_expires_at || null,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to rotate credentials');
        return reply.code(500).send({
          error: 'Failed to rotate credentials',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  // ==========================================================================
  // CRUD: Provider Management (PUT, DELETE — POST already exists above)
  // ==========================================================================

  // NOTE: PUT, DELETE, and model CRUD routes already defined above (lines 983-1622)

  // (CRUD PUT/DELETE/model routes are defined above in the main block)

  // NOTE: Ollama multi-host admin endpoints are in admin-ollama.ts,
  // registered at /api/admin/ollama/* via admin.plugin.ts.

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
      const { prisma } = await import('../../utils/prisma.js');
      const { getDefaults } = await import('../../services/model-routing/defaultModelsAdmin.js');
      const defaults = await getDefaults(prisma as any);
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
      const { prisma } = await import('../../utils/prisma.js');
      const { putDefaults } = await import('../../services/model-routing/defaultModelsAdmin.js');
      const force = (request.query as any)?.force === 'true';

      const result = await putDefaults(prisma as any, logger, request.body || {}, {
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
        userId: (request as any).user?.id,
        userEmail: (request as any).user?.email,
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

};

// Helper function to get Google access token
async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token || null;
  } catch {
    return null;
  }
}

export default llmProviderRoutes;
