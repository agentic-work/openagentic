/**
 * RegistryUpsertService — persists each discovered model from a provider
 * into admin.model_role_assignments (the Model Registry).
 *
 * This is the write-side of the Registry SoT contract established in
 * docs/superpowers/plans/2026-04-22-model-registry-sot.md. Called by the
 * POST /api/admin/llm-providers handler immediately after a provider is
 * created and `provider.discoverModels()` has returned its catalog.
 *
 * Contract:
 *   - fresh row  → INSERT with options.auto=true + sensible defaults
 *   - seeder-owned row (options.auto === true) → UPDATE (refresh caps)
 *   - admin-edited row (options.auto === false) → PRESERVE admin config;
 *       refresh only `capabilities` and `description` so the UI stays honest
 */
import type { DiscoveredModel } from '../llm-providers/ILLMProvider.js';

/**
 * Subset of Prisma client surface the service uses. Keeping the surface
 * narrow makes unit tests tolerable; the integration test passes a real
 * PrismaClient cast to this type.
 *
 * NOTE: `create` returns a row-shaped object. Task #342 unit 3 now reads
 * the returned `.id` so it can dispatch a fire-and-forget pricing fetch
 * against the new Registry row. The real PrismaClient already returns
 * the inserted row; mocks must too.
 */
export interface RegistryUpsertPrismaLike {
  modelRoleAssignment: {
    findMany(args: { where: { provider: string } }): Promise<RegistryRow[]>;
    create(args: { data: any }): Promise<{ id: string } & Record<string, any>>;
    update(args: { where: { id: string }; data: any }): Promise<any>;
  };
}

/**
 * Optional pricing-service dependency. Structurally typed so tests can
 * pass a bare vi.fn() without pulling the real PricingService into the
 * in-memory upsert unit tests. When omitted entirely, the upserter
 * skips pricing — preserves back-compat for callers that don't care
 * about cost ledger data (seed jobs, some CLI flows).
 */
export interface PricingServiceLike {
  fetchAndStorePricing(input: {
    providerType: string;
    modelId: string;
    region: string | null;
    registryRowId: string;
  }): Promise<void>;
}

/**
 * Shape of a row in admin.model_role_assignments that the service cares about.
 * Matches the live column set — nullable where the DB is nullable.
 */
export interface RegistryRow {
  id: string;
  role: string;
  model: string;
  provider: string;
  priority: number;
  enabled: boolean;
  temperature: number | null;
  max_tokens: number | null;
  capabilities: Record<string, any> | null;
  options: Record<string, any> | null;
  description: string | null;
  created_by: string;
  /**
   * #508 Phase 1 lifecycle state. `disposed` and `deprecated` rows are
   * tombstones: planRegistryUpsert MUST NOT recreate or update them. This
   * is the fix for #509 (api restart resurrected admin-deleted rows).
   * Defaults to `active` for rows pre-Phase-1 (backfill ensured this).
   */
  state?: 'proposed' | 'approved' | 'active' | 'deprecated' | 'disposed';
}

export interface RegistryUpsertPlan {
  action: 'insert' | 'update';
  /** For 'update', this is the target row's id; for 'insert', undefined. */
  existingId?: string;
  row: Omit<RegistryRow, 'id'>;
}

export interface RegistryUpsertResult {
  inserted: number;
  updated: number;
}

const DEFAULT_PRIORITY = 100;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * Pick the role for a discovered model — embeddings-capable models route
 * to the `embeddings` role; everything else lands in `chat`. (Admins can
 * still reprioritize to the existing reasoning/tool_execution/synthesis/
 * fallback roles via the admin UI — we just pick a non-conflicting default.)
 */
function pickRole(capabilities?: DiscoveredModel['capabilities']): string {
  return capabilities?.embeddings ? 'embeddings' : 'chat';
}

/**
 * Plan generator — pure function taking provider name + discovered list +
 * currently-stored rows (for that provider) and returning one plan entry
 * per discovered model. This is what we unit-test without a DB.
 */
export function planRegistryUpsert(
  providerName: string,
  discovered: DiscoveredModel[],
  existingRowsAnyProvider: RegistryRow[],
  createdBy: string,
  now: () => Date = () => new Date(),
): RegistryUpsertPlan[] {
  // The (role, model, provider) tuple is the unique constraint in
  // admin.model_role_assignments. A single discovered model can occupy
  // multiple rows under the same provider — the bootstrap seeder may
  // pin one model id to several roles (e.g. chat + code) at different
  // priorities. Key the lookup map on (role, model) so we don't lose
  // those siblings; a model-only key would silently overwrite, and the
  // planner would later try to re-derive the role of the surviving row,
  // hitting the unique constraint when a sibling row already occupies
  // the new role.
  const existingByRoleModel = new Map<string, RegistryRow>();
  const existingModels = new Set<string>();
  // #509 — admin-tombstoned models. Any row for (model, provider) in
  // `disposed` or `deprecated` state means the admin retired this model;
  // discovery MUST NOT recreate it. Per-model granularity (not per-role)
  // because admins typically dispose by model, not by role-slot.
  const tombstonedModels = new Set<string>();
  for (const row of existingRowsAnyProvider) {
    if (row.provider !== providerName) continue;
    existingByRoleModel.set(`${row.role}:${row.model}`, row);
    existingModels.add(row.model);
    if (row.state === 'disposed' || row.state === 'deprecated') {
      tombstonedModels.add(row.model);
    }
  }

  const plans: RegistryUpsertPlan[] = [];
  for (const m of discovered) {
    // #509 — skip discovery resurrection of admin-disposed/deprecated models.
    if (tombstonedModels.has(m.id)) {
      continue;
    }
    const role = pickRole(m.capabilities);
    const existing = existingByRoleModel.get(`${role}:${m.id}`);
    const caps = m.capabilities ?? {};
    const description = m.name || m.id;

    // Sibling row exists at a different role for this same model. Don't
    // insert (would 500 on the unique constraint) and don't update the
    // sibling's role (would also 500 against the OTHER sibling). Skip
    // entirely — admins can rebalance via the UI; discovery just refreshes
    // capability metadata on the rows that already match the derived role.
    if (!existing && existingModels.has(m.id)) {
      continue;
    }

    if (!existing) {
      plans.push({
        action: 'insert',
        row: {
          role,
          model: m.id,
          provider: providerName,
          priority: DEFAULT_PRIORITY,
          enabled: true,
          temperature: DEFAULT_TEMPERATURE,
          max_tokens: m.maxOutputTokens ?? null,
          capabilities: caps as Record<string, any>,
          options: { auto: true, discoveredAt: now().toISOString() },
          description,
          created_by: createdBy,
        },
      });
      continue;
    }

    // Existing row. Inspect options.auto to decide whether this is a
    // seeder-owned row (full refresh) or an admin-edited one (preserve).
    const isAdminEdited = existing.options?.auto === false;
    if (isAdminEdited) {
      plans.push({
        action: 'update',
        existingId: existing.id,
        row: {
          // Preserve admin-editable fields
          role: existing.role,
          model: existing.model,
          provider: existing.provider,
          priority: existing.priority,
          enabled: existing.enabled,
          temperature: existing.temperature,
          max_tokens: existing.max_tokens,
          options: existing.options,
          created_by: existing.created_by,
          // Refresh discovery-derived fields
          capabilities: caps as Record<string, any>,
          description,
        },
      });
    } else {
      // Lookup is now keyed on (role, model), so the existing row already
      // matches the discovered role. Don't re-derive role here — we'd risk
      // colliding with a sibling row at the same (model) under a different
      // role. The sibling-detection branch above prevents the duplicate-key
      // path; this update only refreshes capability + metadata fields.
      plans.push({
        action: 'update',
        existingId: existing.id,
        row: {
          role: existing.role,
          model: existing.model,
          provider: existing.provider,
          priority: existing.priority, // keep whatever priority was stored
          enabled: existing.enabled,
          temperature: existing.temperature,
          max_tokens: existing.max_tokens ?? (m.maxOutputTokens ?? null),
          options: {
            ...(existing.options ?? {}),
            auto: true,
            discoveredAt: now().toISOString(),
          },
          capabilities: caps as Record<string, any>,
          description,
          created_by: existing.created_by,
        },
      });
    }
  }
  return plans;
}

/**
 * Apply the plan to storage. Reads the provider's existing rows, plans
 * inserts + updates, and executes them. Safe to call multiple times for
 * the same provider — subsequent calls produce 0 inserts + N updates
 * (idempotent row count).
 *
 * ## Task #342 unit 3 — fire-and-forget pricing dispatch
 *
 * If `input.pricingService` is provided AND `providerType` + `region`
 * are plumbed through, every inserted/updated row triggers a background
 * `pricingService.fetchAndStorePricing(...)` call. The calls are NOT
 * awaited before this function returns — the upstream POST /llm-providers
 * response must stay snappy even when AWS Pricing throttles. Errors
 * are captured by `Promise.allSettled` so there are no unhandled
 * rejections escaping the event loop.
 */
export async function upsertDiscoveredModels(
  input: {
    providerName: string;
    discovered: DiscoveredModel[];
    createdBy: string;
    /** Provider type string from LLMProvider.provider_type — plumbed to PricingService for fetcher routing. */
    providerType?: string;
    /** Inference region from provider auth/config; passed to the fetcher. Null for Ollama etc. */
    region?: string | null;
    /** Optional — when set, each upserted row triggers a background pricing fetch. */
    pricingService?: PricingServiceLike;
  },
  prisma: RegistryUpsertPrismaLike,
  now: () => Date = () => new Date(),
): Promise<RegistryUpsertResult> {
  const { providerName, discovered, createdBy, providerType, region, pricingService } = input;

  if (!discovered.length) return { inserted: 0, updated: 0 };

  const existing = await prisma.modelRoleAssignment.findMany({ where: { provider: providerName } });
  const plans = planRegistryUpsert(providerName, discovered, existing, createdBy, now);

  let inserted = 0;
  let updated = 0;
  // IDs that should receive a background pricing fetch. We collect
  // them during the sync loop and dispatch AFTER the loop exits so
  // the mainline upsert completes on the hot path.
  const touchedRowIds: Array<{ id: string; modelId: string }> = [];

  for (const plan of plans) {
    if (plan.action === 'insert') {
      // Registry SoT v1 (F2 C-3): rows that arrive via discovery (RegistrySyncJob,
      // event-driven provider sync, Add-Model wizard) MUST be stamped
      // managed_by='discovered' so RegistryBootstrapSeeder's "leave admin alone"
      // contract works against the correct discriminator. The schema default
      // is 'admin' which would otherwise neutralize the seeder gate.
      const created = await prisma.modelRoleAssignment.create({
        data: { ...plan.row, managed_by: 'discovered' } as any,
      });
      inserted++;
      if (created?.id) touchedRowIds.push({ id: created.id, modelId: plan.row.model });
    } else {
      // Update path INTENTIONALLY does NOT touch managed_by. If admin has
      // edited a row (managed_by='admin'), discovery refreshing capabilities
      // must keep the row's ownership flag intact — flipping it to
      // 'discovered' would break the seeder's admin-skip contract.
      await prisma.modelRoleAssignment.update({
        where: { id: plan.existingId! },
        data: {
          role: plan.row.role,
          priority: plan.row.priority,
          enabled: plan.row.enabled,
          temperature: plan.row.temperature,
          max_tokens: plan.row.max_tokens,
          capabilities: plan.row.capabilities ?? {},
          options: plan.row.options ?? {},
          description: plan.row.description,
        },
      });
      updated++;
      if (plan.existingId) touchedRowIds.push({ id: plan.existingId, modelId: plan.row.model });
    }
  }

  // Fire-and-forget pricing fetches. The IIFE below is NOT awaited —
  // it runs on the microtask queue so the caller gets its insert/update
  // counts back immediately. `Promise.allSettled` ensures no individual
  // fetch rejection escapes as an unhandled promise rejection.
  if (pricingService && providerType && touchedRowIds.length) {
    void Promise.allSettled(
      touchedRowIds.map((r) =>
        pricingService.fetchAndStorePricing({
          providerType,
          modelId: r.modelId,
          region: region ?? null,
          registryRowId: r.id,
        }),
      ),
    );
  }

  return { inserted, updated };
}
