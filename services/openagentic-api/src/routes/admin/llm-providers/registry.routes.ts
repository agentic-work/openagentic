/**
 * Admin Model-Registry (admin.model_role_assignments) routes.
 *
 *   DELETE /llm-providers/registry/:id
 *   GET    /llm-providers/registry
 *   PATCH  /llm-providers/registry/:id
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


export const registryRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;
  const auditTrail = new AuditTrail();


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
      const { prisma } = await import('../../../utils/prisma.js');
      const { id } = request.params;
      const adminUserId = request.user?.id ?? null;

      const existing = await prisma.modelRoleAssignment.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Registry row not found', id });
      }

      // Atomic: tombstone + delete in a single transaction. If the tombstone
      // upsert fails (e.g. unique-constraint race), the row stays — admin
      // can retry. If the row delete fails after the tombstone was inserted,
      // the transaction rolls back and the registry is unchanged.
      await prisma.$transaction(async (tx) => {
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
    } catch (error) {
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
      const { prisma } = await import('../../../utils/prisma.js');
      const role = request.query.role;
      const enabledOnlyRaw = request.query.enabledOnly;
      // Default = true unless explicitly 'false'
      const enabledOnly = enabledOnlyRaw === undefined ? true : enabledOnlyRaw !== 'false';
      // Phase H: by default, hide rows whose provider is soft-deleted
      // (deleted_at != null). The `?includeDeleted=true` escape hatch keeps
      // them visible for forensic / cleanup workflows.
      const includeDeleted = request.query.includeDeleted === 'true';

      const where: Record<string, unknown> = {};
      if (role) where.role = role;
      if (enabledOnly) where.enabled = true;

      const rows = await prisma.modelRoleAssignment.findMany({
        where: where as unknown as Prisma.ModelRoleAssignmentWhereInput,
        orderBy: [{ provider: 'asc' }, { priority: 'asc' }, { model: 'asc' }],
      });
      const providerNames = Array.from(new Set(rows.map((r) => r.provider)));
      const providers = providerNames.length
        ? await prisma.lLMProvider.findMany({
            where: { name: { in: providerNames } },
            select: { name: true, display_name: true, enabled: true, deleted_at: true },
          })
        : [];
      const providerByName = new Map(providers.map(p => [p.name, p] as const));

      // Phase H: drop registry rows whose joined provider is soft-deleted.
      // The Registry table has no FK to LLMProvider, so this filter has to
      // happen in the application layer. Skipped when ?includeDeleted=true
      // so admins can still inspect orphans for cleanup.
      const filteredRows = includeDeleted
        ? rows
        : rows.filter((r) => {
            const prov = providerByName.get(r.provider);
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
      const { getModelCapabilityRegistry } = await import('../../../services/ModelCapabilityRegistry.js');
      const capabilityRegistry = getModelCapabilityRegistry();

      const result = filteredRows.map((r) => {
        const mcrCaps = capabilityRegistry.getCapabilities(r.model);

        // Registry-row cost columns are USD per 1M tokens (CSP-SDK populated,
        // authoritative when present). Convert to /1k for UI ergonomics.
        // Fall back to MCR estimates when CSP hasn't populated yet so the
        // Lab scoring and Smart Router have SOMETHING to score against.
        // The response exposes one cost field per direction; callers don't
        // have to disambiguate SoT.
        const rCost = r as Record<string, unknown>;
        const regInputPer1M = rCost.cost_per_input_token_usd != null ? Number(rCost.cost_per_input_token_usd) : null;
        const regOutputPer1M = rCost.cost_per_output_token_usd != null ? Number(rCost.cost_per_output_token_usd) : null;
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
    } catch (error) {
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
      const { prisma } = await import('../../../utils/prisma.js');
      const { id } = request.params;
      const existing = await prisma.modelRoleAssignment.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Registry row not found', id });
      }

      const body = request.body || {};
      const data: Record<string, unknown> = {};
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
        data.options = { ...((existing.options as Record<string, unknown>) || {}), auto: false };
      }

      const updated = await prisma.modelRoleAssignment.update({ where: { id }, data: data as unknown as Prisma.ModelRoleAssignmentUpdateInput });
      return reply.send({ ok: true, row: updated });
    } catch (error) {
      logger.error({ error: error?.message, id: request.params.id }, 'Failed to patch registry row');
      return reply.code(500).send({
        error: 'Failed to update registry row',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

};


export default registryRoutes;
