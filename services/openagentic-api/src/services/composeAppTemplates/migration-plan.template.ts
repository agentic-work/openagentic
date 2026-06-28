/**
 * migration-plan — waves of cohorts with completion-% bar + blocker list.
 *
 * Phase 6 mocks-parity work. Audit slug: `migration_plan`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['pending', 'in_progress', 'done', 'blocked']).default('pending'),
});

const WaveSchema = z.object({
  wave: z.string(),
  start: z.string().optional(),
  end: z.string().optional(),
  items: z.array(ItemSchema).min(1),
  complete_pct: z.number().min(0).max(100).optional(),
  blockers: z.array(z.string()).default([]),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  waves: z.array(WaveSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Azure → AWS migration plan',
  subtitle: '4 waves · 2026-05 → 2026-09',
  waves: [
    {
      wave: 'Wave 1 — non-prod (5 apps)',
      start: '2026-05-15', end: '2026-06-01',
      items: [
        { id: 'app-1', name: 'staging-api', status: 'done' },
        { id: 'app-2', name: 'staging-web', status: 'done' },
        { id: 'app-3', name: 'staging-worker', status: 'done' },
        { id: 'app-4', name: 'dev-tools', status: 'in_progress' },
        { id: 'app-5', name: 'qa-fixtures', status: 'pending' },
      ],
      blockers: [],
    },
    {
      wave: 'Wave 2 — internal prod (8 apps)',
      start: '2026-06-15', end: '2026-07-15',
      items: [
        { id: 'app-6', name: 'admin-portal', status: 'pending' },
        { id: 'app-7', name: 'reporting', status: 'pending' },
        { id: 'app-8', name: 'billing-sync', status: 'blocked' },
      ],
      blockers: ['billing-sync waiting on Stripe Connect cutover approval'],
    },
    {
      wave: 'Wave 3 — customer-facing prod (12 apps)',
      start: '2026-07-20', end: '2026-08-30',
      items: [
        { id: 'app-9', name: 'checkout-api', status: 'pending' },
        { id: 'app-10', name: 'catalog-api', status: 'pending' },
      ],
      blockers: ['DR plan sign-off pending', 'pen-test re-scope'],
    },
    {
      wave: 'Wave 4 — decommission Azure',
      start: '2026-09-01', end: '2026-09-30',
      items: [{ id: 'app-99', name: 'tear-down Azure RGs', status: 'pending' }],
      blockers: [],
    },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const css = `
.mp-wrap { display: grid; gap: 12px; }
.mp-wave { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow: hidden; }
.mp-head { padding: 10px 14px; background: var(--cm-bg-3); display: grid; grid-template-columns: 1fr auto; align-items: center; }
.mp-title { color: var(--cm-fg); font-weight: 600; font-size: 13px; }
.mp-window { font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-dim); }
.mp-bar-wrap { padding: 10px 14px 6px; }
.mp-bar { height: 8px; background: var(--cm-bg-3); border-radius: 4px; overflow: hidden; }
.mp-bar-fill { height: 100%; background: linear-gradient(90deg, var(--cm-accent), var(--cm-success)); }
.mp-bar-meta { font-size: 11px; color: var(--cm-fg-dim); margin-top: 4px; font-family: var(--cm-mono); }
.mp-items { padding: 0 14px 12px; display: flex; flex-wrap: wrap; gap: 6px; }
.mp-item { padding: 4px 10px; background: var(--cm-bg-3); border: 1px solid var(--cm-border); border-radius: 999px; font-family: var(--cm-mono); font-size: 11px; }
.mp-item.done        { color: var(--cm-success); border-color: color-mix(in srgb, var(--cm-success) 40%, transparent); }
.mp-item.in_progress { color: var(--cm-accent);  border-color: color-mix(in srgb, var(--cm-accent) 40%, transparent); }
.mp-item.blocked     { color: var(--cm-error);   border-color: color-mix(in srgb, var(--cm-error) 40%, transparent); }
.mp-item.pending     { color: var(--cm-fg-dim); }
.mp-blockers { padding: 10px 14px; border-top: 1px solid var(--cm-border); }
.mp-blocker-row { display: grid; grid-template-columns: 60px 1fr; gap: 8px; padding: 4px 0; }
.mp-blocker-label { color: var(--cm-error); font-family: var(--cm-mono); font-size: 11px; }
.mp-blocker-text { color: var(--cm-fg); font-size: 12px; }
`;

  const waves = params.waves.map((w) => {
    const total = w.items.length;
    const done = w.items.filter((i) => i.status === 'done').length;
    const pct = w.complete_pct ?? (total === 0 ? 0 : Math.round((done / total) * 100));
    const items = w.items.map((i) => `
      <span class="mp-item ${escHtml(i.status)}">${escHtml(i.name)}</span>
    `).join('');
    const blockers = w.blockers.length > 0 ? `
      <div class="mp-blockers">
        ${w.blockers.map((b) => `
          <div class="mp-blocker-row">
            <span class="mp-blocker-label">BLOCKER</span>
            <span class="mp-blocker-text">${escHtml(b)}</span>
          </div>
        `).join('')}
      </div>
    ` : '';
    return `
      <section class="mp-wave">
        <div class="mp-head">
          <span class="mp-title">${escHtml(w.wave)}</span>
          ${w.start || w.end ? `<span class="mp-window">${escHtml(w.start || '')} → ${escHtml(w.end || '')}</span>` : '<span></span>'}
        </div>
        <div class="mp-bar-wrap">
          <div class="mp-bar"><div class="mp-bar-fill" style="width:${pct}%"></div></div>
          <div class="mp-bar-meta">${done}/${total} complete · ${pct}%</div>
        </div>
        <div class="mp-items">${items}</div>
        ${blockers}
      </section>
    `;
  }).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="mp-wrap">${waves}</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'mp-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const MIGRATION_PLAN_TEMPLATE: ComposeAppTemplate = {
  slug: 'migration-plan',
  title: 'Migration plan (waves, items, blockers)',
  description:
    'Migration plan organized by wave/cohort. Each wave has items[{id,name,status}], complete_pct (auto-derived if absent), and blockers[]. Use for cloud migrations, app refactors, multi-quarter rollouts. Also accepts the alias slug "migration_plan".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
