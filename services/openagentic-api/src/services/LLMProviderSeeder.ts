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

/**
 * Priority assigned to the secondary Ollama provider + its chat role row.
 * Strictly GREATER than the Bedrock bootstrap chat row (priority 10) so that
 * ModelConfigurationService.getDefaultChatModel() — which orders role='chat'
 * rows by priority ASC — keeps Claude Sonnet 4.6 as the platform default.
 * The Ollama row is still a fully-enabled, selectable chat model in the /model
 * picker; it is simply lower-precedence.
 */
const SECONDARY_OLLAMA_PRIORITY = 50;

/**
 * seedSecondaryOllamaProvider — additive, env-driven seed for a SECOND chat
 * provider alongside the single helm/wizard bootstrap provider.
 *
 * Registry SoT v1 ships EXACTLY ONE bootstrap provider (the Bedrock row under
 * the wizard's "Both" path). The seeder architecture has no plural-bootstrap
 * mechanism, and ProviderConfigService loads providers from the DB only — so
 * OLLAMA_ENABLED/OLLAMA_CHAT_MODEL alone never land an Ollama provider row.
 * This function is the narrow, idempotent path that does, WITHOUT disturbing
 * the bootstrap default: it lands the Ollama provider + a role='chat'
 * assignment at SECONDARY_OLLAMA_PRIORITY (> bootstrap's 10), so Bedrock stays
 * the default while gpt-oss:20b becomes a second selectable chat model.
 *
 * Trigger conditions (ALL must hold; otherwise no-op):
 *   - OLLAMA_ENABLED === 'true'
 *   - OLLAMA_CHAT_MODEL is set (the local chat tag, e.g. gpt-oss:20b)
 *   - a DIFFERENT-type bootstrap provider exists (i.e. the "Both" scenario —
 *     Bedrock is the chat default and Ollama is the secondary). When Ollama is
 *     the ONLY provider (ollama-only strategy) we do NOT run here: that path
 *     has no bootstrap provider and relies on the env-fallback config in
 *     ModelConfigurationService.loadFromEnvironment().
 *
 * Idempotent: re-creates neither the provider row nor the chat assignment when
 * they already exist. Admin-managed rows are never touched.
 */
export async function seedSecondaryOllamaProvider(): Promise<void> {
  const log = logger.child({ service: 'LLMProviderSeeder', seed: 'secondary-ollama' });

  if (process.env.OLLAMA_ENABLED !== 'true') return;
  const chatModel = (process.env.OLLAMA_CHAT_MODEL ?? '').trim();
  if (!chatModel) return;

  // Only run in the "Both" scenario: a bootstrap provider of a DIFFERENT type
  // must own the chat default. Without a bootstrap provider this is the
  // ollama-only path (env-fallback config handles chat) — leave it alone.
  let bootstrap: BootstrapProviderSeed | null = null;
  try {
    bootstrap = parseBootstrapProviderEnv();
  } catch {
    bootstrap = null;
  }
  if (!bootstrap || bootstrap.providerType === 'ollama') {
    log.info('[SecondaryOllama] no non-Ollama bootstrap provider — skipping (ollama-only or unconfigured)');
    return;
  }

  const baseUrl =
    (process.env.OLLAMA_BASE_URL ?? '').trim() ||
    (process.env.OLLAMA_HOST ?? '').trim() ||
    'http://ollama:11434';
  const providerName = 'ollama';

  try {
    // ── 1. Provider row ────────────────────────────────────────────────
    // Create the Ollama provider row when absent. If an admin already added
    // an Ollama provider, leave it untouched (admin wins).
    let providerRow = await prisma.lLMProvider.findFirst({
      where: { name: providerName },
      select: { id: true },
    });

    if (!providerRow) {
      const embeddingModel =
        (process.env.OLLAMA_EMBED_MODEL ?? '').trim() ||
        (process.env.OLLAMA_EMBEDDING_MODEL ?? '').trim() ||
        null;

      const created = await prisma.lLMProvider.create({
        data: {
          name: providerName,
          display_name: 'Ollama (local)',
          provider_type: 'ollama',
          enabled: true,
          // Lower precedence than the bootstrap provider (priority 1).
          priority: SECONDARY_OLLAMA_PRIORITY,
          auth_config: encryptAuthConfig({ baseUrl }),
          provider_config: {
            baseUrl,
            modelId: chatModel,
            seeder_managed: true,
            seeder_version: SEEDER_VERSION,
            models: [],
          },
          model_config: {
            defaultModel: chatModel,
            chatModel,
            ...(embeddingModel ? { embeddingModel } : {}),
            maxTokens: 4096,
            temperature: 0.7,
          },
          capabilities: { chat: true, tools: true, streaming: true, embeddings: !!embeddingModel },
          description: 'Secondary local chat provider (seeded from OLLAMA_* env under the "Both" strategy)',
          tags: ['secondary', 'local'],
        } as any,
      });
      providerRow = { id: created.id };
      log.info({ baseUrl, chatModel }, '[SecondaryOllama] seeded Ollama provider row (secondary, lower precedence than bootstrap)');
    } else {
      log.info('[SecondaryOllama] Ollama provider row already present — leaving untouched');
    }

    // ── 2. Resolve admin user for the created_by FK ────────────────────
    const adminEmail = (process.env.ADMIN_USER_EMAIL ?? '').trim();
    let adminUserId: string | null = null;
    if (adminEmail) {
      const adminRow = await (prisma as any).user?.findUnique?.({ where: { email: adminEmail } });
      if (adminRow?.id) adminUserId = adminRow.id as string;
    }
    if (!adminUserId) {
      log.warn({ adminEmail: adminEmail || '<unset>' },
        '[SecondaryOllama] admin user not resolvable — deferring chat-role insert; retries on next boot');
      return;
    }

    // ── 3. Chat role assignment (lower precedence than Bedrock) ────────
    const existing = await prisma.modelRoleAssignment.findFirst({
      where: { role: 'chat', model: chatModel, provider: providerName },
      select: { id: true, managed_by: true },
    });
    if (existing) {
      log.info({ chatModel, existingId: existing.id },
        '[SecondaryOllama] chat-role row already present — no-op (Bedrock remains default)');
      return;
    }

    const created = await prisma.modelRoleAssignment.create({
      data: {
        role: 'chat',
        model: chatModel,
        provider: providerName,
        priority: SECONDARY_OLLAMA_PRIORITY,
        enabled: true,
        temperature: 0.7,
        managed_by: 'bootstrap',
        capabilities: { chat: true, tools: true, streaming: true, embeddings: false },
        options: { auto: true, secondary: true, seededAt: new Date().toISOString() },
        description: chatModel,
        created_by: adminUserId,
      },
    });
    log.info({ chatModel, rowId: created?.id, priority: SECONDARY_OLLAMA_PRIORITY },
      '[SecondaryOllama] chat-role row seeded — selectable second chat model; Bedrock (priority 10) stays default');
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : err },
      '[SecondaryOllama] secondary Ollama seed failed (non-fatal) — admin can add it via the UI');
  }
}
