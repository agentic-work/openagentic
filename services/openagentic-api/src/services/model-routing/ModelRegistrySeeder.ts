/**
 * ModelRegistrySeeder — discovery-list utilities for the Add-Model wizard.
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F2.4)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * F2.4 NARROWING: this file is now informational-only. It provides:
 *   - discoverFromProvider() — fetch a provider's model catalog for the UI
 *     Add-Model wizard picker without writing anything to the DB.
 *   - Types (ModelRegistryProviderFactory, DiscoveredModel wrappers) used by
 *     the wizard and RegistrySyncJob.
 *
 * What was removed:
 *   - ModelRegistrySeeder.seed() — the boot-time loop that called
 *     prisma.lLMProvider.update() to stamp provider_config.models[] and
 *     model_config on every restart. This was the "bulldozer" identified in
 *     the Registry SoT v1 forensic (2026-05-01).
 *
 * Write paths that replaced it:
 *   - RegistryBootstrapSeeder (seedRegistryFromHelm) — idempotent cold-start
 *     seeding into admin.model_role_assignments, gated by SEEDER_VERSION.
 *   - RegistrySyncJob — periodic discovery → model_role_assignments writes
 *     (Ollama + AIF only, 30s interval), already running from 04-providers.ts.
 *   - AzureAIFoundryProvider.persistDiscoveredModelsToDb + OllamaModelSyncService
 *     — event-driven paths that call upsertDiscoveredModels directly.
 */
import type { Logger } from 'pino';
import type { DiscoveredModel, ILLMProvider } from '../llm-providers/ILLMProvider.js';
import { normalizeAddModelCapabilities, type CapabilitiesInput } from './addModelCapabilities.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ModelRegistrySeederPrismaLike {
  lLMProvider: {
    findMany(args: {
      where?: { enabled?: boolean; deleted_at?: null };
      orderBy?: { priority: 'asc' | 'desc' };
    }): Promise<RawProviderRow[]>;
  };
}

/**
 * Factory that resolves a provider name to something with a `discoverModels`
 * (or `listModels`) method. In production this is backed by
 * ProviderManager.getProvider(). Returning null/undefined causes the caller
 * to skip that provider without erroring.
 */
export interface ModelRegistryProviderFactory {
  getProvider(name: string): Pick<ILLMProvider, 'discoverModels' | 'listModels'> | null | undefined;
}

// ── Internal types ────────────────────────────────────────────────────────

interface RawProviderRow {
  id: string;
  name: string;
  provider_type: string;
  enabled: boolean;
  priority: number;
  provider_config: any;
  model_config: any;
  capabilities: any;
  deleted_at: Date | null;
}

// ── Utilities ─────────────────────────────────────────────────────────────

function coerceCapabilities(
  caps: DiscoveredModel['capabilities'] | Record<string, boolean | undefined> | undefined,
): CapabilitiesInput {
  if (!caps || typeof caps !== 'object') return {};
  return caps as CapabilitiesInput;
}

function normalizeDiscovered(model: any): DiscoveredModel | null {
  if (!model) return null;
  const id = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : null;
  if (!id) return null;
  const caps = coerceCapabilities(model.capabilities);
  return {
    id,
    name: typeof model.name === 'string' ? model.name : id,
    provider: typeof model.provider === 'string' ? model.provider : '',
    description: typeof model.description === 'string' ? model.description : undefined,
    capabilities: normalizeAddModelCapabilities(caps) as DiscoveredModel['capabilities'],
    maxOutputTokens: typeof model.maxOutputTokens === 'number' ? model.maxOutputTokens : undefined,
    contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : undefined,
    family: typeof model.family === 'string' ? model.family : undefined,
    costTier: model.costTier,
    configured: model.configured,
    pullRequired: model.pullRequired,
  };
}

/**
 * Discovery — tries `discoverModels()` first, then falls back to `listModels()`.
 * Returns null on throw so the caller can log + continue.
 *
 * Used by the Add-Model wizard to populate the discovery picker without
 * writing anything to the DB.
 */
export async function discoverFromProvider(
  instance: Pick<ILLMProvider, 'discoverModels' | 'listModels'>,
): Promise<DiscoveredModel[] | null> {
  try {
    if (typeof instance.discoverModels === 'function') {
      const result = await instance.discoverModels();
      return (result || []).map(normalizeDiscovered).filter((m): m is DiscoveredModel => m !== null);
    }
    if (typeof instance.listModels === 'function') {
      const list = await instance.listModels();
      return (list || [])
        .map((m) =>
          normalizeDiscovered({
            id: m.id,
            name: m.name,
            provider: m.provider,
            capabilities: {},
          }),
        )
        .filter((m): m is DiscoveredModel => m !== null);
    }
    return [];
  } catch {
    // Return null so callers can mark the provider as errored without aborting.
    return null;
  }
}

/**
 * Discover models from all enabled providers and return the combined list
 * without writing anything to the DB.
 *
 * This is the informational path used by:
 *   - Admin UI "Add Model" wizard — fetches catalog for the picker.
 *   - Diagnostic endpoints — surface what each provider currently reports.
 *
 * For write paths see RegistrySyncJob (periodic) and
 * RegistryBootstrapSeeder (cold-start idempotent).
 */
export async function discoverAllProviderModels(
  prisma: ModelRegistrySeederPrismaLike,
  factory: ModelRegistryProviderFactory,
  logger?: Pick<Logger, 'debug' | 'warn' | 'error' | 'info'>,
): Promise<Array<{ providerName: string; models: DiscoveredModel[] }>> {
  const rows = await prisma.lLMProvider.findMany({
    where: { enabled: true, deleted_at: null },
    orderBy: { priority: 'asc' },
  });

  const results: Array<{ providerName: string; models: DiscoveredModel[] }> = [];

  for (const row of rows) {
    const instance = factory.getProvider(row.name);
    if (!instance) {
      logger?.debug({ provider: row.name }, '[ModelRegistrySeeder] factory returned no instance — skipping');
      continue;
    }

    const discovered = await discoverFromProvider(instance);
    if (discovered === null) {
      logger?.warn({ provider: row.name }, '[ModelRegistrySeeder] provider discoverModels threw — skipping');
      continue;
    }

    results.push({ providerName: row.name, models: discovered });
  }

  return results;
}
