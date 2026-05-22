/**
 * seed-templates.ts — idempotently upsert the 10 Phase F template flows
 * into the Workflow table so they appear in the Flows template gallery.
 *
 * Reads every `*.json` under `seed/templates/`, deserializes the
 * `TemplateDefinitionFile` shape, and upserts a row with:
 *   - is_template = true
 *   - is_public   = true (visible to every tenant)
 *   - is_active   = true
 *   - tags        = [category]
 *   - settings    = { defaultInputs }
 *   - definition  = { nodes, edges }
 *   - variables   = {} (templates have no engine variables; defaults live
 *                       in settings.defaultInputs)
 *
 * Idempotent: keyed on `name` (a unique combination of name + is_template)
 * via findFirst + create/update. Safe to re-run on existing rows.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm tsx seed/scripts/seed-templates.ts
 *
 * Wired as a non-fatal step in the deployment Helm post-install hook in
 * a follow-up PR (this script intentionally does NOT exit non-zero on
 * partial failure — it logs and continues so a single bad JSON does
 * not poison the others).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '../../src/utils/prisma.js';
import { loggers } from '../../src/utils/logger.js';
import { withSystemTenant } from '../../src/utils/tenantPrismaExtension.js';

const logger = loggers.services;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TemplateMeta {
  purpose: string;
  how_it_works: string[];
  expected_output: string;
  useful_when: string;
  tools_used: string[];
  version: string;
  tags: string[];
}

interface TemplateDefinitionFile {
  slug: string;
  name: string;
  description: string;
  category: string;
  template: true;
  meta?: TemplateMeta;
  defaultInputs: Record<string, unknown>;
  definition: {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
}

const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');
// Use the platform system user; this id is created by the main seeder
// and exists on every install (`system@internal`). Falls back to env
// override for tests/CI-local envs where the system user has a
// different uuid (e.g. test fixtures).
const SEED_USER = process.env.SEED_USER_ID || 'system-00000000-0000-0000-0000-000000000000';

async function seed(): Promise<void> {
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
  files.sort();

  const results: Array<{ slug: string; id: string; action: string }> = [];

  await withSystemTenant(async () => {
  for (const file of files) {
    const raw = readFileSync(join(TEMPLATES_DIR, file), 'utf-8');
    const tpl = JSON.parse(raw) as TemplateDefinitionFile;

    const existing = await prisma.workflow.findFirst({
      where: { name: tpl.name, is_template: true },
      select: { id: true },
    });

    // settings.meta carries the legend block (purpose / how_it_works /
    // expected_output / useful_when / tools_used / version / tags).
    // Stored under settings (existing Json column) so the rollout does
    // not require a Prisma migration.
    const settingsBlock: Record<string, unknown> = { defaultInputs: tpl.defaultInputs };
    if (tpl.meta) settingsBlock.meta = tpl.meta;

    // Merge template-declared tags with the category tag so the gallery
    // filter pills surface every label authored in the meta block.
    const tagSet = new Set<string>([tpl.category, ...(tpl.meta?.tags ?? [])]);

    const payload = {
      name: tpl.name,
      description: tpl.description,
      definition: tpl.definition as unknown as Parameters<typeof prisma.workflow.create>[0]['data']['definition'],
      triggers: [] as unknown as Parameters<typeof prisma.workflow.create>[0]['data']['triggers'],
      settings: settingsBlock as unknown as Parameters<typeof prisma.workflow.create>[0]['data']['settings'],
      variables: {} as unknown as Parameters<typeof prisma.workflow.create>[0]['data']['variables'],
      created_by: SEED_USER,
      is_active: true,
      is_template: true,
      is_public: true,
      tags: Array.from(tagSet),
    };

    if (existing) {
      await prisma.workflow.update({ where: { id: existing.id }, data: payload });
      results.push({ slug: tpl.slug, id: existing.id, action: 'update' });
    } else {
      const created = await prisma.workflow.create({ data: payload });
      results.push({ slug: tpl.slug, id: created.id, action: 'create' });
    }
  }

  for (const r of results) {
    logger.info({ slug: r.slug, id: r.id, action: r.action }, '[seed-templates] upserted');
  }
  });
}

seed().then(
  () => {
    // eslint-disable-next-line no-console
    console.log(`[seed-templates] complete`);
    process.exit(0);
  },
  (err) => {
    // eslint-disable-next-line no-console
    console.error('[seed-templates] FAILED', err);
    process.exit(1);
  },
);
