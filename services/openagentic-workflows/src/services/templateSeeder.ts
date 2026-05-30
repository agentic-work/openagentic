/**
 * templateSeeder.ts — runtime callable that upserts the canonical AIOps
 * template flows into the Workflow table on every workflows-svc boot.
 *
 * PERMANENCE CONTRACT (added 2026-05-14):
 *   - Templates ship in the image at `/app/templates/*.json` (Dockerfile
 *     copies `services/openagentic-workflows/seed/templates/` → `/app/templates`)
 *   - On boot, `seedTemplatesOnBoot()` runs idempotently (find-by-name +
 *     upsert). New tenants automatically see them because rows are written
 *     with `is_template=true + is_public=true` which the OR-predicate in
 *     `routes/workflows.ts:539-543` exposes to all tenants.
 *   - Non-fatal: failure is logged and start() continues. We never want
 *     a bad seed JSON to gate the API.
 *   - Safe to re-run: the idempotency key is `name + is_template=true`.
 *     Re-runs UPDATE existing rows in-place so authors can fix seed JSON
 *     and a rollout will reconcile.
 *
 * Replaces the one-shot `seed/scripts/seed-templates.ts` CLI for the
 * permanent path. The CLI still works for dev-loop / ad-hoc seeding.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { withSystemTenant } from '../utils/tenantPrismaExtension.js';

const logger = loggers.services;

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

/**
 * Resolve the templates directory. In the Docker runtime image they live
 * at `/app/templates`. In local dev (tsx + repo cwd) they live alongside
 * the source under `seed/templates/`. Falls back gracefully to a no-op
 * when neither path exists (e.g. unit tests that don't ship templates).
 */
function resolveTemplatesDir(): string | null {
  // Allow override via env for tests / CI / customer mirrors.
  if (process.env.WORKFLOW_TEMPLATES_DIR) {
    return existsSync(process.env.WORKFLOW_TEMPLATES_DIR)
      ? process.env.WORKFLOW_TEMPLATES_DIR
      : null;
  }
  const candidates = [
    '/app/templates', // Runtime image (Dockerfile COPY)
    resolve(process.cwd(), 'templates'),
    resolve(process.cwd(), 'seed/templates'),
    resolve(process.cwd(), 'services/openagentic-workflows/seed/templates'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

const SEED_USER = process.env.SEED_USER_ID || 'system-00000000-0000-0000-0000-000000000000';

export interface SeedResult {
  slug: string;
  id: string;
  action: 'create' | 'update' | 'error';
  error?: string;
}

/**
 * Read + upsert every `*.json` under the resolved templates dir.
 * Idempotent. Non-throwing on individual failures (logs + continues).
 * Returns the per-file result list so callers / tests can assert.
 */
export async function seedTemplatesOnBoot(): Promise<SeedResult[]> {
  const dir = resolveTemplatesDir();
  if (!dir) {
    logger.warn(
      '[templateSeeder] no templates directory found; skipping seed step ' +
        '(set WORKFLOW_TEMPLATES_DIR or ship /app/templates)',
    );
    return [];
  }

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (err: any) {
    logger.error({ err: err.message, dir }, '[templateSeeder] readdir failed');
    return [];
  }
  if (files.length === 0) {
    logger.info({ dir }, '[templateSeeder] no template JSON files found');
    return [];
  }

  const results: SeedResult[] = [];

  await withSystemTenant(async () => {
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), 'utf-8');
        const tpl = JSON.parse(raw) as TemplateDefinitionFile;

        const existing = await prisma.workflow.findFirst({
          where: { name: tpl.name, is_template: true },
          select: { id: true },
        });

        const settingsBlock: Record<string, unknown> = { defaultInputs: tpl.defaultInputs };
        // Include slug in the meta block so the api projection can surface
        // it for UI deep-linking (2026-05-14: api transformWorkflow now reads
        // meta.slug and projects it as top-level `slug` on /templates).
        if (tpl.meta || tpl.slug) {
          settingsBlock.meta = { ...(tpl.meta ?? {}), slug: tpl.slug } as Record<string, unknown>;
        }

        const tagSet = new Set<string>([tpl.category, ...(tpl.meta?.tags ?? [])]);

        const payload = {
          name: tpl.name,
          description: tpl.description,
          definition: tpl.definition as any,
          triggers: [] as any,
          settings: settingsBlock as any,
          variables: {} as any,
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
      } catch (err: any) {
        logger.error(
          { err: err.message, file },
          '[templateSeeder] upsert failed for one file; continuing',
        );
        results.push({ slug: file, id: '', action: 'error', error: err.message });
      }
    }
  });

  const creates = results.filter((r) => r.action === 'create').length;
  const updates = results.filter((r) => r.action === 'update').length;
  const errors = results.filter((r) => r.action === 'error').length;
  logger.info(
    { dir, total: results.length, creates, updates, errors },
    '[templateSeeder] permanent template seed complete',
  );

  return results;
}
