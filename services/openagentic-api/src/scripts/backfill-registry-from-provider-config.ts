/**
 * One-time backfill — provider_config.models[] → admin.model_role_assignments
 *
 * Phase-1 reader migration (#69) flipped every consumer to query the
 * Registry table. AIF + Ollama writers now upsert into the Registry on
 * discovery (per AIF Phase-2 cut). But legacy admin-added rows (Bedrock,
 * Vertex, manually-added AIF models) live only in the JSON
 * provider_config.models[] field on llm_providers. After write removal
 * (#71) those rows would be orphaned. This script walks every provider,
 * reads its provider_config.models[], and upserts each into the Registry
 * via the same upsertDiscoveredModels() the runtime uses.
 *
 * IDEMPOTENT — safe to re-run. Existing Registry rows with options.auto=false
 * (admin-edited) are preserved. Rows with options.auto=true get refreshed.
 *
 * Usage: ts-node-esm src/scripts/backfill-registry-from-provider-config.ts
 *   or:  pnpm --filter openagentic-api exec node --loader ts-node/esm src/scripts/backfill-registry-from-provider-config.ts
 */
import { prisma } from '../utils/prisma.js';
import { upsertDiscoveredModels } from '../services/model-routing/RegistryUpsertService.js';

interface LegacyModelEntry {
  id?: string;
  name?: string;
  capabilities?: any;
  contextWindow?: number;
  maxOutputTokens?: number;
  config?: { maxOutputTokens?: number; enabled?: boolean };
}

async function main(): Promise<void> {
  const providers = await prisma.lLMProvider.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true, provider_type: true, provider_config: true, created_by: true },
  });

  let totalProviders = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const p of providers) {
    const cfg = (p.provider_config as any) ?? {};
    const legacyModels: LegacyModelEntry[] = Array.isArray(cfg.models) ? cfg.models : [];
    if (legacyModels.length === 0) {
      console.log(`[backfill] ${p.name} (${p.provider_type}): no legacy models[] — skip`);
      totalSkipped++;
      continue;
    }

    const discovered = legacyModels
      .filter(m => m && (typeof m.id === 'string' || typeof m.name === 'string'))
      .map(m => {
        const id = (m.id || m.name)!;
        return {
          id,
          name: m.name || id,
          provider: p.provider_type,
          description: undefined as string | undefined,
          capabilities: m.capabilities ?? { chat: true },
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens ?? m.config?.maxOutputTokens,
        } as any;
      });

    if (discovered.length === 0) {
      console.log(`[backfill] ${p.name}: legacy models[] had no usable rows — skip`);
      totalSkipped++;
      continue;
    }

    const result = await upsertDiscoveredModels(
      {
        providerName: p.name,
        discovered,
        createdBy: p.created_by ?? '00000000-0000-0000-0000-000000000000',
        providerType: p.provider_type,
        region: null,
      },
      prisma as any,
    );

    totalProviders++;
    totalInserted += result.inserted;
    totalUpdated += result.updated;
    console.log(
      `[backfill] ${p.name} (${p.provider_type}): legacy=${legacyModels.length} ` +
      `inserted=${result.inserted} updated=${result.updated}`,
    );
  }

  console.log('---');
  console.log(`[backfill] DONE — providers_with_legacy=${totalProviders} ` +
    `inserted=${totalInserted} updated=${totalUpdated} skipped=${totalSkipped}`);
}

main()
  .catch((err) => {
    console.error('[backfill] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
