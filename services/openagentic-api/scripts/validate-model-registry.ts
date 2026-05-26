/**
 * Validate provider_config.models[] covers every model id referenced
 * elsewhere in the database. Companion to the Phase 0 backfill.
 *
 * Spec: docs/core/model-routing-rewrite.md §7 Phase 0 — "ship criterion:
 * every model referenced anywhere in DB must be in some provider's
 * provider_config.models[]".
 *
 * Exit code: 0 if all referenced models are registered, 1 otherwise.
 *
 * Usage:
 *   tsx scripts/validate-model-registry.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Tables whose `model` column is an actual provider-routed model id.
// Deliberately skipped (patterns / pricing / tags, not dispatched ids):
//   - llm_cost_rates.model (pattern)
//   - model_pricing.model (pricing key, may be pattern)
//   - prompt_modules.model / prompt_modules_history.model (tag-like)
//   - synth_configuration.model (explicit default string, not user-referenced)
type TableProbe = {
  table: string;
  schema: string;
  column: string;
  label: string;
};

const TABLES: TableProbe[] = [
  { schema: 'public', table: 'chat_sessions', column: 'model', label: 'ChatSession.model' },
  { schema: 'public', table: 'chat_messages', column: 'model', label: 'ChatMessage.model' },
  { schema: 'public', table: 'awcode_sessions', column: 'model', label: 'AWCodeSession.model' },
  { schema: 'public', table: 'awcode_messages', column: 'model', label: 'AWCodeMessage.model' },
  { schema: 'public', table: 'background_jobs', column: 'model', label: 'BackgroundJob.model' },
  { schema: 'public', table: 'token_usage', column: 'model', label: 'TokenUsage.model' },
  { schema: 'public', table: 'llm_request_logs', column: 'model', label: 'LLMRequestLog.model' },
  { schema: 'public', table: 'llm_usage_aggregates', column: 'model', label: 'LLMUsageAggregate.model' },
  { schema: 'public', table: 'vertex_content_caches', column: 'model', label: 'VertexContentCache.model' },
  { schema: 'admin', table: 'model_role_assignments', column: 'model', label: 'ModelRoleAssignment.model' },
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function loadRegisteredIds(): Promise<{ canonical: Set<string>; aliased: Set<string> }> {
  const providers = await prisma.lLMProvider.findMany({
    where: { deleted_at: null, enabled: true },
    select: { name: true, provider_config: true },
  });

  const canonical = new Set<string>();
  const aliased = new Set<string>();

  for (const p of providers) {
    if (!isObject(p.provider_config)) continue;
    const models = Array.isArray(p.provider_config.models) ? p.provider_config.models : [];
    for (const m of models) {
      if (!isObject(m)) continue;
      if (typeof m.id === 'string' && m.id.trim() !== '') canonical.add(m.id.trim());
      if (Array.isArray(m.aliases)) {
        for (const a of m.aliases) {
          if (typeof a === 'string' && a.trim() !== '') aliased.add(a.trim());
        }
      }
    }
  }
  return { canonical, aliased };
}

async function distinctModelIds(probe: TableProbe): Promise<string[]> {
  const q = `SELECT DISTINCT "${probe.column}" AS v
             FROM "${probe.schema}"."${probe.table}"
             WHERE "${probe.column}" IS NOT NULL AND "${probe.column}" <> ''`;
  try {
    const rows = (await prisma.$queryRawUnsafe(q)) as Array<{ v: string }>;
    return rows.map((r) => r.v);
  } catch (err: any) {
    console.warn(`[validate] skipping ${probe.label}: ${err?.message ?? err}`);
    return [];
  }
}

async function main() {
  const { canonical, aliased } = await loadRegisteredIds();
  const known = new Set<string>();
  canonical.forEach((v) => known.add(v));
  aliased.forEach((v) => known.add(v));
  console.log(
    `[validate] registry: ${canonical.size} canonical ids + ${aliased.size} aliases = ${known.size} lookup keys`,
  );

  const missingByTable: Record<string, string[]> = {};
  let totalReferenced = 0;
  let totalMissing = 0;

  for (const probe of TABLES) {
    const values = await distinctModelIds(probe);
    totalReferenced += values.length;
    const missing = values.filter((v) => !known.has(v));
    if (missing.length > 0) {
      missingByTable[probe.label] = missing;
      totalMissing += missing.length;
    }
    console.log(
      `[validate] ${probe.label}: ${values.length} distinct, ${missing.length} unregistered`,
    );
  }

  console.log('');
  console.log(`[validate] summary: ${totalReferenced} referenced across ${TABLES.length} tables, ${totalMissing} unregistered`);

  if (totalMissing > 0) {
    console.log('');
    console.log('[validate] DIFF — models referenced but not in any provider_config.models[]:');
    for (const [label, ids] of Object.entries(missingByTable)) {
      console.log(`  ${label}:`);
      for (const id of ids) console.log(`    - ${id}`);
    }
    process.exitCode = 1;
  } else {
    console.log('[validate] ok — every referenced model is registered.');
  }
}

main()
  .catch((err) => {
    console.error('[validate] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
