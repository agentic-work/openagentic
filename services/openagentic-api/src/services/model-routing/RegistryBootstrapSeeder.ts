/**
 * RegistryBootstrapSeeder — Registry SoT v1 non-bulldozer bootstrap seeder.
 *
 * the design notes
 * the design notes
 *
 * Contract:
 *   1. Gate on SEEDER_VERSION (env int). If last-applied === SEEDER_VERSION → no-op.
 *   2. Parse BOOTSTRAP_PROVIDER_* env to get (provider, defaults). If absent → mark
 *      version + return early.
 *   3. For each bootstrap role (chat, code, embedding) derived from defaults:
 *      a. Check tombstone — skip if present.
 *      b. Look up existing row. If managed_by='admin' → skip (admin wins).
 *      c. INSERT (new) or UPDATE bootstrap_version (existing bootstrap row).
 *      d. Emit BOOTSTRAP_SEED audit event, hash-chained to prior event.
 *   4. Write SEEDER_VERSION to admin.system_configuration['registry_seeder_version'].
 *
 * This replaces the BULLDOZER pattern in LLMProviderSeeder: pod restarts
 * after the initial cold-start are now true no-ops and admin edits are
 * preserved across helm upgrades.
 */

import crypto from 'node:crypto';
import { parseBootstrapProviderEnv } from '../llm-providers/bootstrapProviderEnv.js';
import { normalizeAddModelCapabilities } from './addModelCapabilities.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RegistryBootstrapSeederDeps {
  prisma: any;
  logger?: {
    info(o: any, m?: string): void;
    warn(o: any, m?: string): void;
    error(o: any, m?: string): void;
  };
  env?: NodeJS.ProcessEnv;
}

export interface SeedRegistryResult {
  /** Rows inserted or updated by this run. */
  applied: number;
  /** Rows skipped due to tombstone or admin-managed ownership. */
  skipped: number;
  /** True if registry_seeder_version advanced to SEEDER_VERSION. */
  versionBumped: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No-op logger used when deps.logger is omitted. */
const NOOP_LOGGER = {
  info: (_o: any, _m?: string) => {},
  warn: (_o: any, _m?: string) => {},
  error: (_o: any, _m?: string) => {},
};

/**
 * Compute sha256 of the concatenated string payload.
 * Used to build the audit event hash-chain.
 */
function sha256(payload: string): string {
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Read the last-applied seeder version from admin.system_configuration.
 * Returns 0 if the row is absent or the version field is missing/NaN.
 */
async function readLastAppliedVersion(prisma: any): Promise<number> {
  const row = await prisma.systemConfiguration.findUnique({
    where: { key: 'registry_seeder_version' },
  });
  if (!row || !row.value) return 0;
  const v = (row.value as any).version;
  const parsed = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Write the new seeder version to admin.system_configuration.
 */
async function markSeederVersion(prisma: any, version: number): Promise<void> {
  await prisma.systemConfiguration.upsert({
    where: { key: 'registry_seeder_version' },
    create: {
      key: 'registry_seeder_version',
      value: { version },
      description: 'Last applied RegistryBootstrapSeeder SEEDER_VERSION. Used to gate warm-restart no-ops.',
      is_active: true,
    },
    update: {
      value: { version },
    },
  });
}

/**
 * Fetch the hash of the most-recently-written audit event (for chain init).
 * Returns empty string if no events exist yet.
 */
async function getLastEventHash(prisma: any): Promise<string> {
  const row = await prisma.modelRegistryEvent.findFirst({
    orderBy: { id: 'desc' },
  });
  return row?.hash ?? '';
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Seed admin.model_role_assignments from the bootstrap provider env block.
 *
 * Idempotent: running twice with the same SEEDER_VERSION is a no-op after the
 * first application (warm-restart gate).
 */
export async function seedRegistryFromHelm(
  deps: RegistryBootstrapSeederDeps,
): Promise<SeedRegistryResult> {
  const { prisma } = deps;
  const log = deps.logger ?? NOOP_LOGGER;
  const env = deps.env ?? process.env;

  // ── 1. Parse SEEDER_VERSION ──────────────────────────────────────────────
  const rawVersion = (env as any).SEEDER_VERSION ?? '';
  const SEEDER_VERSION = Number.parseInt(String(rawVersion), 10);
  const currentVersion = Number.isFinite(SEEDER_VERSION) ? SEEDER_VERSION : 0;

  // ── 2. Gate: warm-restart no-op ──────────────────────────────────────────
  const lastApplied = await readLastAppliedVersion(prisma);
  if (lastApplied >= currentVersion) {
    log.info(
      { lastApplied, currentVersion },
      '[RegistryBootstrapSeeder] warm-restart no-op — SEEDER_VERSION already applied',
    );
    return { applied: 0, skipped: 0, versionBumped: false };
  }

  // ── 3. Parse bootstrap provider env ────────────────────────────────────
  let seed: ReturnType<typeof parseBootstrapProviderEnv>;
  try {
    seed = parseBootstrapProviderEnv(env);
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : err },
      '[RegistryBootstrapSeeder] BOOTSTRAP_PROVIDER env parse failed — bumping version, skipping rows',
    );
    await markSeederVersion(prisma, currentVersion);
    return { applied: 0, skipped: 0, versionBumped: true };
  }

  if (!seed) {
    log.info(
      { currentVersion },
      '[RegistryBootstrapSeeder] BOOTSTRAP_PROVIDER_NAME unset — no bootstrap rows to seed; bumping version marker',
    );
    await markSeederVersion(prisma, currentVersion);
    return { applied: 0, skipped: 0, versionBumped: true };
  }

  // ── 4. Verify bootstrap provider row exists ─────────────────────────────
  const providerRow = await prisma.lLMProvider.findUnique({
    where: { name: seed.name },
  });
  if (!providerRow) {
    log.warn(
      { providerName: seed.name },
      '[RegistryBootstrapSeeder] bootstrap provider row not found in admin.llm_providers — ' +
      'LLMProviderSeeder must run first. Bumping version, skipping registry rows.',
    );
    await markSeederVersion(prisma, currentVersion);
    return { applied: 0, skipped: 0, versionBumped: true };
  }

  // ── 4b. Resolve admin user for created_by FK ──────────────────────────
  // model_role_assignments.created_by is a non-nullable FK to users(id).
  // At boot time there's no request user — resolve admin via ADMIN_USER_EMAIL
  // env (same pattern as LLMProviderSeeder.ts:96). If admin user row doesn't
  // exist yet (cold-install before user-bootstrap), bump version + skip rows
  // — next pod restart after admin user lands will rerun successfully.
  const adminEmail = ((env as any).ADMIN_USER_EMAIL ?? '').trim();
  let adminUserId: string | null = null;
  if (adminEmail) {
    const adminRow = await prisma.user?.findUnique?.({ where: { email: adminEmail } });
    if (adminRow?.id) adminUserId = adminRow.id as string;
  }
  if (!adminUserId) {
    log.warn(
      { adminEmail: adminEmail || '<unset>' },
      '[RegistryBootstrapSeeder] ADMIN_USER_EMAIL unset or admin user row missing — ' +
      'cannot INSERT model_role_assignments without created_by FK. Skipping registry rows; ' +
      'will retry next restart once admin user is seeded.',
    );
    // Do NOT bump version — we want this to retry on next restart.
    return { applied: 0, skipped: 0, versionBumped: false };
  }

  // ── 5. Build role → model mapping from bootstrap defaults ───────────────
  // Bootstrap seeds four canonical registry roles:
  //   • 'chat'      ← seed.defaults.chat
  //   • 'code'      ← seed.defaults.codemode (falls back to chat if equal or null)
  //   • 'vision'    ← seed.defaults.vision   (added 2026-05-21 — gpt-oss:20b
  //                   on Ollama supports image input; admin can override)
  //   • 'embedding' ← seed.defaults.embedding
  //
  // Each (role, model) pair produces a distinct registry row. When codemode
  // and chat point to the same model we still create separate role rows so
  // Smart Router can filter by role independently. Same for vision.
  const roleEntries: Array<{ role: string; model: string }> = [];

  if (seed.defaults.chat) {
    roleEntries.push({ role: 'chat', model: seed.defaults.chat });
  }
  if (seed.defaults.codemode) {
    roleEntries.push({ role: 'code', model: seed.defaults.codemode });
  }
  if (seed.defaults.vision) {
    roleEntries.push({ role: 'vision', model: seed.defaults.vision });
  }
  // 'imageGen' ← seed.defaults.imageGen (added 2026-06-17 — sev0: without an
  // imageGen role row + default_models.imageGen, the chat generate_image tool
  // resolves request.model=undefined → ProviderManager skips the registry
  // short-circuit and the legacy capability scan finds no image model → throws
  // before any provider call). The role spelling 'imageGen' matches
  // ProviderManager's imageGeneration capability filter.
  if (seed.defaults.imageGen) {
    roleEntries.push({ role: 'imageGen', model: seed.defaults.imageGen });
  }
  if (seed.defaults.embedding) {
    roleEntries.push({ role: 'embedding', model: seed.defaults.embedding });
  }

  // De-duplicate: if codemode === chat the code row would be a strict
  // duplicate of the chat row. Keep them separate — they have different roles.

  // ── 6. Iterate roles ────────────────────────────────────────────────────
  let applied = 0;
  let skipped = 0;
  let prevHash = await getLastEventHash(prisma);

  for (const { role, model } of roleEntries) {
    const providerName = seed.name;

    // 6a. Tombstone check
    const tombstone = await prisma.modelRoleAssignmentTombstone.findUnique({
      where: {
        provider_name_model_role: { provider_name: providerName, model, role },
      },
    });
    if (tombstone) {
      log.info(
        { role, model, providerName },
        '[RegistryBootstrapSeeder] tombstone found — skipping row',
      );
      skipped += 1;
      continue;
    }

    // 6b. Look up existing row by unique key (role, model, provider)
    const existing = await prisma.modelRoleAssignment.findUnique({
      where: {
        role_model_provider: { role, model, provider: providerName },
      },
    });

    // 6c. Admin-owned → skip
    if (existing && existing.managed_by === 'admin') {
      log.info(
        { role, model, providerName, existingId: existing.id },
        '[RegistryBootstrapSeeder] admin-managed row found — leaving untouched',
      );
      skipped += 1;
      continue;
    }

    // Per role: build the row-write and audit-event operations as a pair,
    // then execute them in a single prisma.$transaction([…]) call.
    // Both operations live or die together — if the audit chain breaks
    // we must NOT have a stale registry row drifting unaudited.
    let rowWriteOp: any;
    let projectedRowId: string;
    let projectedAfterState: any;

    if (existing) {
      // 6d-i. Bootstrap-owned row → update bootstrap_version only
      projectedRowId = existing.id;
      projectedAfterState = {
        ...existing,
        bootstrap_version: currentVersion,
        version: (existing.version ?? 1) + 1,
      };
      rowWriteOp = prisma.modelRoleAssignment.update({
        where: { id: existing.id },
        data: {
          bootstrap_version: currentVersion,
          version: (existing.version ?? 1) + 1,
          updated_at: new Date(),
        },
      });
    } else {
      // 6d-ii. New row → INSERT
      // Project the UUID up front so we can chain the audit-event row_id
      // inside the same $transaction([…]) array.
      projectedRowId = crypto.randomUUID();
      const insertData = {
        id: projectedRowId,
        role,
        model,
        provider: providerName,
        provider_id: providerRow.id ?? null,
        priority: 10,
        enabled: true,
        temperature: 0.7,
        managed_by: 'bootstrap',
        bootstrap_version: currentVersion,
        version: 1,
        capabilities: buildCapabilities(role, seed.defaults.embedding === model),
        options: { auto: true, seededAt: new Date().toISOString() },
        description: model,
        created_by: adminUserId,
      };
      projectedAfterState = insertData;
      rowWriteOp = prisma.modelRoleAssignment.create({ data: insertData });
    }

    // 6e. Build audit event op — hash-chained to prior event
    const hashPayload = `${prevHash}|BOOTSTRAP_SEED|${projectedRowId}|${JSON.stringify(projectedAfterState)}`;
    const newHash = sha256(hashPayload);
    const auditOp = prisma.modelRegistryEvent.create({
      data: {
        action: 'BOOTSTRAP_SEED',
        row_id: projectedRowId,
        after_state: projectedAfterState,
        prev_hash: prevHash || null,
        hash: newHash,
        reason: `RegistryBootstrapSeeder v${currentVersion}`,
      },
    });

    // Atomically execute row-write + audit event. If either fails, the
    // transaction rolls back — the loop terminates, markSeederVersion is
    // NOT called (caller can retry on next boot) and the registry stays
    // consistent with the audit chain.
    const [, eventResult] = await prisma.$transaction([rowWriteOp, auditOp]);

    applied += 1;

    // Chain: next event uses this event's hash
    prevHash = (eventResult as any)?.hash ?? newHash;
  }

  // ── 6b. Seed default_models.imageGen ───────────────────────────────────
  // The chat generate_image path resolves its model id ONLY from the
  // system_configuration['default_models'].imageGen field (runChat.ts via
  // defaultModelsAdmin.getDefaults) — NOT from a role row. Unlike
  // chat/code/embedding (which the Smart Router resolves via the role rows we
  // just seeded), image-gen has no router; without this entry request.model is
  // undefined and ProviderManager's registry short-circuit is skipped. Write
  // it here, preserving any admin-set value (admin wins) and only filling the
  // imageGen slot the bootstrap owns. Best-effort: a failure here is non-fatal
  // (the role row above is still written; admin can wire the default via UI).
  if (seed.defaults.imageGen) {
    try {
      await ensureDefaultImageModel(prisma, seed.defaults.imageGen, log);
    } catch (dmErr) {
      log.warn(
        { error: dmErr instanceof Error ? dmErr.message : dmErr, model: seed.defaults.imageGen },
        '[RegistryBootstrapSeeder] default_models.imageGen seed failed (non-fatal) — admin can set via UI',
      );
    }
  }

  // ── 7. Mark version as applied ─────────────────────────────────────────
  await markSeederVersion(prisma, currentVersion);

  log.info(
    { applied, skipped, currentVersion, providerName: seed.name },
    '[RegistryBootstrapSeeder] seed complete',
  );

  return { applied, skipped, versionBumped: true };
}

/**
 * Upsert system_configuration['default_models'].imageGen to the bootstrap
 * image model id, WITHOUT clobbering any admin-set imageGen or sibling
 * (chat/code/embedding/vision) fields. The chat generate_image path reads this
 * row directly (defaultModelsAdmin.getDefaults) to populate request.model, so
 * it must exist for the ProviderManager registry short-circuit to fire.
 *
 * Bootstrap ownership rule: only fill the imageGen slot when it's currently
 * unset (null/empty) — an admin who already chose an image model wins. All
 * other fields are passed through untouched.
 */
async function ensureDefaultImageModel(
  prisma: any,
  imageModelId: string,
  log: { info(o: any, m?: string): void; warn(o: any, m?: string): void },
): Promise<void> {
  const existing = await prisma.systemConfiguration.findUnique({
    where: { key: 'default_models' },
  });
  const current = (existing?.value && typeof existing.value === 'object'
    ? existing.value
    : {}) as Record<string, unknown>;

  const adminImageGen =
    typeof current.imageGen === 'string' && current.imageGen.trim() !== ''
      ? (current.imageGen as string)
      : null;

  if (adminImageGen) {
    log.info(
      { existing: adminImageGen, bootstrap: imageModelId },
      '[RegistryBootstrapSeeder] default_models.imageGen already set (admin wins) — leaving untouched',
    );
    return;
  }

  const next = { ...current, imageGen: imageModelId };

  await prisma.systemConfiguration.upsert({
    where: { key: 'default_models' },
    create: {
      key: 'default_models',
      value: next,
      description: 'Tenant-default model per mode. imageGen seeded by RegistryBootstrapSeeder; editable via admin UI.',
      is_active: true,
    },
    update: { value: next, is_active: true },
  });

  log.info(
    { model: imageModelId },
    '[RegistryBootstrapSeeder] default_models.imageGen seeded — chat generate_image can now resolve request.model',
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical capabilities envelope for a bootstrap row.
 *
 * Gap #913 — routes through `normalizeAddModelCapabilities`, the SAME
 * normalizer the admin Add-Model wizard uses. This guarantees the bootstrap
 * row's shape matches the row an admin would have created from the UI:
 * six canonical boolean keys — chat, vision, tools, streaming, embeddings,
 * imageGeneration. Hand-built `{chat,tools,streaming,embeddings}` masks
 * `vision` + `imageGeneration` as `undefined` and creates two SoT shapes
 * (helm-seeded rows vs admin-created rows) that downstream consumers must
 * branch on.
 */
function buildCapabilities(role: string, isEmbedding: boolean): Record<string, boolean | undefined> {
  if (role === 'embedding' || isEmbedding) {
    return normalizeAddModelCapabilities({ embeddings: true, chat: false }) as unknown as Record<string, boolean | undefined>;
  }
  if (role === 'vision') {
    // Vision role pins the row at chat+tools+streaming+vision. gpt-oss:20b
    // is the default bootstrap vision model and DOES accept image input on
    // Ollama; admins point this at a different multimodal tag via the helm
    // values if they prefer (e.g. llama3.2-vision:11b).
    return normalizeAddModelCapabilities({ chat: true, vision: true, tools: true, streaming: true }) as unknown as Record<string, boolean | undefined>;
  }
  if (role === 'imageGen') {
    // Image-generation role is image-OUT only (text-to-image): chat=false so
    // normalizeAddModelCapabilities classifies it image-only and pins
    // imageGeneration=true. This is the capability ProviderManager.generateImage
    // filters on and what feeds modelToProviderMap for the registry short-circuit.
    return normalizeAddModelCapabilities({ chat: false, imageGeneration: true }) as unknown as Record<string, boolean | undefined>;
  }
  return normalizeAddModelCapabilities({ chat: true }) as unknown as Record<string, boolean | undefined>;
}
