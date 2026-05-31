/**
 * LLM Provider Seeder — narrow bootstrap PROVIDER-ROW seeder (Registry SoT v1, F2.5)
 *
 * Contract (Registry SoT v1, supersedes the bulldozer pattern 2026-05-01):
 *   Helm ships EXACTLY ONE provider (the "bootstrap provider"). This seeder's
 *   only job is to create that row in admin.llm_providers when the table is
 *   empty. Registry rows (model_role_assignments) and default_models are NO
 *   LONGER written here — RegistryBootstrapSeeder (seedRegistryFromHelm)
 *   owns those, and discovery into the Add-Model wizard is supplied by
 *   RegistrySyncJob (periodic) — not by this seeder.
 *
 * Behavior:
 *   - BOOTSTRAP_PROVIDER_NAME unset/empty → skip seeder entirely (no-op).
 *   - NAME set + admin.llm_providers empty → create ONE provider row from
 *     BOOTSTRAP_PROVIDER_{NAME,DISPLAY_NAME,TYPE,CONFIG,DEFAULTS} env vars.
 *   - NAME set + admin.llm_providers has any rows → skip (admin changes win).
 *
 * This module intentionally does NOT reach into per-provider env vars
 * (AWS_BEDROCK_ENABLED, OLLAMA_ENABLED, VERTEX_AI_ENABLED, etc.). Those were
 * ripped from the helm chart — Registry SoT + admin UI is the path for
 * anything beyond the one bootstrap row.
 *
 * Boot order (04-providers.ts):
 *   1. seedLLMProviders()          — this file (provider row only)
 *   2. seedRegistryFromHelm()      — RegistryBootstrapSeeder (Registry rows + audit)
 *   3. CodeRoleBackfillService     — role=code parity for the codemode default
 *
 * See feedback_embedding_only_env.md + docs/rules/no-hardcoded-models.md.
 */

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { encryptAuthConfig } from './llm-providers/CredentialEncryptionService.js';
import { parseBootstrapProviderEnv, type BootstrapProviderSeed } from './llm-providers/bootstrapProviderEnv.js';

/**
 * Seeder version — bumped only when the bootstrap-provider row schema itself
 * changes. Does NOT gate re-sync of per-provider model lists anymore (Registry
 * is SoT for models). Keep as an audit trail on the provider_config so
 * operators can tell when a row was last touched by the boot path.
 */
const SEEDER_VERSION = 5; // v5 = bootstrap-provider architecture (task #294)

/**
 * Convert a bootstrap seed payload into the per-provider capabilities block.
 * Defaults are intentionally broad — the ProviderManager will refine these
 * via discoverModels() as part of its own init.
 */
function capabilitiesFor(providerType: string, seed: BootstrapProviderSeed): Record<string, boolean> {
  const hasEmbedding = !!seed.defaults.embedding;
  // Reasonable starting capabilities per provider type. These get overwritten
  // by discoverModels() as soon as the first real model exchange happens.
  switch (providerType) {
    case 'ollama':
      return { chat: true, tools: true, streaming: true, embeddings: hasEmbedding };
    case 'aws-bedrock':
      return { chat: true, tools: true, vision: true, streaming: true, thinking: true, embeddings: hasEmbedding };
    case 'vertex-ai':
      return { chat: true, tools: true, vision: true, streaming: true, thinking: true, embeddings: hasEmbedding, grounding: true };
    case 'azure-ai-foundry':
      return { chat: true, tools: true, vision: true, streaming: true, thinking: true, embeddings: hasEmbedding };
    case 'azure-openai':
      return { chat: true, tools: true, vision: true, streaming: true, embeddings: hasEmbedding };
    case 'anthropic':
      return { chat: true, tools: true, vision: true, streaming: true, thinking: true };
    case 'openai':
      return { chat: true, tools: true, vision: true, streaming: true, embeddings: hasEmbedding };
    default:
      return { chat: true, streaming: true };
  }
}

/**
 * Insert the chat-role row in admin.model_role_assignments for the freshly
 * created bootstrap provider when (a) helm shipped a chat default,
 * (b) the admin user FK is resolvable, and (c) no row already exists for
 * (provider, model). Best-effort + idempotent; failure is non-fatal.
 *
 * This is the Sev-0 hot-fix path for "fresh install → 0 chat rows →
 * ModelConfigurationService.getDefaultChatModel() throws on every chat POST."
 */
async function ensureBootstrapChatRoleAssignment(
  seed: BootstrapProviderSeed,
  createdProvider: { id?: string } | null,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const chatModel = seed.defaults.chat?.trim();
  if (!chatModel) {
    log.info({ bootstrap: seed.name },
      '[Bootstrap] BOOTSTRAP_PROVIDER_DEFAULTS.chat unset — skipping chat-role auto-seed');
    return;
  }

  const adminEmail = (process.env.ADMIN_USER_EMAIL ?? '').trim();
  let adminUserId: string | null = null;
  if (adminEmail) {
    const adminRow = await (prisma as any).user?.findUnique?.({ where: { email: adminEmail } });
    if (adminRow?.id) adminUserId = adminRow.id as string;
  }
  if (!adminUserId) {
    log.warn({ adminEmail: adminEmail || '<unset>', bootstrap: seed.name },
      '[Bootstrap] ADMIN_USER_EMAIL unset or admin user row missing — deferring chat-role insert; ' +
      'RegistryBootstrapSeeder / next boot will retry once admin user lands');
    return;
  }

  // Idempotency check — don't duplicate if a prior boot (or
  // RegistryBootstrapSeeder running first) already wrote the row.
  const existing = await (prisma as any).modelRoleAssignment.findFirst({
    where: { role: 'chat', model: chatModel, provider: seed.name },
  });
  if (existing) {
    log.info({ bootstrap: seed.name, model: chatModel, existingId: existing.id },
      '[Bootstrap] chat-role row already present — no-op');
    return;
  }

  const created = await (prisma as any).modelRoleAssignment.create({
    data: {
      role: 'chat',
      model: chatModel,
      provider: seed.name,
      priority: 10,
      enabled: true,
      temperature: 0.7,
      managed_by: 'bootstrap',
      capabilities: { chat: true, tools: true, streaming: true, embeddings: false },
      options: { auto: true, bootstrap: true, seededAt: new Date().toISOString() },
      description: chatModel,
      created_by: adminUserId,
    },
  });

  log.info({
    bootstrap: seed.name,
    model: chatModel,
    rowId: created?.id,
  }, '[Bootstrap] chat-role row seeded — ModelConfigurationService.getDefaultChatModel() will resolve');
}

/**
 * Entry point — called once from server.ts at API startup. Idempotent: safe
 * to call N times, state only changes on the fresh-install leg.
 *
 * Registry SoT v1 (F2.5): this function ONLY writes to admin.llm_providers
 * (the bootstrap provider row). Registry-row writes belong to
 * RegistryBootstrapSeeder; the legacy code-role backfill belongs to
 * CodeRoleBackfillService — both are wired in 04-providers.ts.
 */
export async function seedLLMProviders(): Promise<void> {
  const log = logger.child({ service: 'LLMProviderSeeder' });

  let seed: BootstrapProviderSeed | null;
  try {
    seed = parseBootstrapProviderEnv();
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : err },
      '[Bootstrap] BOOTSTRAP_PROVIDER env parse failed — check values.yaml');
    return;
  }

  if (!seed) {
    log.info('[Bootstrap] BOOTSTRAP_PROVIDER_NAME unset — skipping provider seeder (admin UI owns provider CRUD)');
    return;
  }

  try {
    // Admin ownership check — if ANY provider row exists, admin has taken
    // ownership of this tenant. Don't clobber.
    let existingCount = 0;
    try {
      existingCount = await (prisma as any).lLMProvider.count?.() ?? 0;
      if (typeof existingCount !== 'number') {
        // Some Prisma mock shapes return { count: n }
        existingCount = (existingCount as any).count ?? 0;
      }
    } catch (countErr) {
      // Fall back: if .count() isn't available, use findMany length.
      const rows = await prisma.lLMProvider.findMany({});
      existingCount = rows.length;
    }

    if (existingCount > 0) {
      log.info({
        bootstrap: seed.name,
        existingProviders: existingCount,
      }, '[Bootstrap] admin.llm_providers has existing rows — skipping bootstrap seed (admin UI wins)');
      // Sev-0 retroactive heal — when an existing pod has the bootstrap
      // provider but missing the chat-role row (e.g. fresh deploy where the
      // provider lands but the role assignment didn't), still call the
      // ensure helper. It's idempotent — no-op when row already exists.
      // This makes redeploys self-healing instead of requiring manual SQL.
      try {
        const existingBootstrap = await prisma.lLMProvider.findFirst({
          where: { name: seed.name },
          select: { id: true },
        }).catch(() => null);
        await ensureBootstrapChatRoleAssignment(seed, existingBootstrap, log);
      } catch (chatErr) {
        log.warn({
          error: chatErr instanceof Error ? chatErr.message : chatErr,
          bootstrap: seed.name,
        }, '[Bootstrap] retroactive chat-role heal failed (non-fatal) — admin can wire via UI');
      }
      // Note: code-role parity (task #360) is now handled by
      // CodeRoleBackfillService running independently in 04-providers.ts —
      // it covers BOTH this admin-existing-rows branch and the fresh-install
      // branch via the same boot-step, so we don't need to fire it here.
      return;
    }

    // Fresh install — seed the ONE row.
    const providerConfig: Record<string, any> = {
      ...(seed.authConfig.endpoint ? { baseUrl: (seed.authConfig as any).endpoint } : {}),
      ...(seed.authConfig.region ? { region: (seed.authConfig as any).region } : {}),
      ...(seed.authConfig.projectId ? { projectId: (seed.authConfig as any).projectId } : {}),
      ...(seed.authConfig.location ? { location: (seed.authConfig as any).location } : {}),
      ...(seed.authConfig.endpoint ? { endpoint: (seed.authConfig as any).endpoint } : {}),
      ...(seed.authConfig.deploymentName ? { deployment: (seed.authConfig as any).deploymentName, deploymentName: (seed.authConfig as any).deploymentName } : {}),
      ...(seed.authConfig.apiVersion ? { apiVersion: (seed.authConfig as any).apiVersion } : {}),
      ...(seed.defaults.chat ? { modelId: seed.defaults.chat } : {}),
      seeder_managed: true,
      seeder_version: SEEDER_VERSION,
      models: [],
    };

    const modelConfig: Record<string, any> = {
      ...(seed.defaults.chat ? { defaultModel: seed.defaults.chat, chatModel: seed.defaults.chat } : {}),
      ...(seed.defaults.codemode ? { codeModel: seed.defaults.codemode } : {}),
      ...(seed.defaults.embedding ? { embeddingModel: seed.defaults.embedding } : {}),
      ...(seed.defaults.embeddingDimension ? { embeddingDimension: seed.defaults.embeddingDimension } : {}),
      maxTokens: 16000,
      temperature: 0.7,
    };

    const capabilities = capabilitiesFor(seed.providerType, seed);

    const createdProvider = await prisma.lLMProvider.create({
      data: {
        name: seed.name,
        display_name: seed.displayName,
        provider_type: seed.providerType,
        enabled: true,
        priority: 1,
        auth_config: encryptAuthConfig(seed.authConfig),
        provider_config: providerConfig,
        model_config: modelConfig,
        capabilities,
        description: `Bootstrap provider (seeded from helm bootstrapProvider: block)`,
        tags: ['bootstrap'],
      } as any,
    });

    log.info({
      bootstrap: seed.name,
      providerType: seed.providerType,
      defaults: seed.defaults,
    }, '[Bootstrap] seeded the bootstrap provider row — RegistryBootstrapSeeder will land Registry rows next');

    // Sev-0 fix (2026-05-09) — fresh install with bootstrap provider but no
    // chat-role row blocked every chat session POST because
    // ModelConfigurationService.getDefaultChatModel() throws "No chat model
    // configured. Enable at least one row with role='chat' in
    // admin.model_role_assignments…". RegistryBootstrapSeeder runs after this
    // step but defers when ADMIN_USER_EMAIL is unset OR the admin user row
    // hasn't landed yet (seed-race), and CodeRoleBackfillService only seeds
    // role='code' (it requires an existing chat row to clone from).
    //
    // We therefore directly insert the bootstrap chat-role row here when:
    //   - BOOTSTRAP_PROVIDER_DEFAULTS.chat is set (helm shipped a chat model)
    //   - admin user FK can be resolved (ADMIN_USER_EMAIL → users row)
    //   - no chat row already exists for (provider, model) — idempotent
    //
    // Skipping all three conditions is non-fatal: the provider row still
    // landed, and admin can wire role assignments via the UI. This block
    // is a best-effort first-boot operability guarantee, not a SoT shift —
    // RegistryBootstrapSeeder remains the canonical Registry seeder for
    // hash-chained audit + tombstone honoring on subsequent runs.
    try {
      await ensureBootstrapChatRoleAssignment(seed, createdProvider, log);
    } catch (chatErr) {
      log.warn({
        error: chatErr instanceof Error ? chatErr.message : chatErr,
        bootstrap: seed.name,
      }, '[Bootstrap] chat-role assignment insert failed (non-fatal) — RegistryBootstrapSeeder will retry on next boot');
    }

    // Registry SoT v1 (F2.5): LLMProviderSeeder is now narrow to provider-row
    // only. RegistryBootstrapSeeder (seedRegistryFromHelm) owns Registry-row
    // writes (model_role_assignments). DefaultModelsSeeder was deleted in
    // F2.3 — system_configuration.default_models is no longer a SoT, so we
    // do NOT upsert it here either. CodeRoleBackfillService handles the
    // role=code parity for pre-existing deploys.
  } catch (err) {
    log.error({
      error: err instanceof Error ? err.message : err,
      stack: err instanceof Error ? err.stack : undefined,
      bootstrap: seed.name,
    }, '[Bootstrap] provider seed failed — API will boot without a bootstrap row. Admin must create one via UI.');
  }
}
