/**
 * rotation-calendar — month calendar grid showing on-call rotations.
 *
 * Phase 6 mocks-parity work. Audit slug: `rotation_calendar`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const ShiftSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  primary: z.string(),
  secondary: z.string().optional(),
  team: z.string().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  shifts: z.array(ShiftSchema).min(1),
  rotation_name: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'On-call rotation — platform team',
  rotation_name: 'platform-oncall',
  month: '2026-05',
  shifts: [
    { date: '2026-05-01', primary: 'trent', secondary: 'sam' },
    { date: '2026-05-02', primary: 'trent', secondary: 'sam' },
    { date: '2026-05-03', primary: 'sam',   secondary: 'priya' },
    { date: '2026-05-04', primary: 'sam',   secondary: 'priya' },
    { date: '2026-05-05', primary: 'priya', secondary: 'maya' },
    { date: '2026-05-06', primary: 'priya', secondary: 'maya' },
    { date: '2026-05-07', primary: 'maya',  secondary: 'leo' },
    { date: '2026-05-08', primary: 'maya',  secondary: 'leo' },
    { date: '2026-05-09', primary: 'leo',   secondary: 'trent' },
    { date: '2026-05-10', primary: 'leo',   secondary: 'trent' },
    { date: '2026-05-11', primary: 'trent', secondary: 'sam' },
    { date: '2026-05-12', primary: 'trent', secondary: 'sam' },
    { date: '2026-05-13', primary: 'sam',   secondary: 'priya' },
    { date: '2026-05-14', primary: 'sam',   secondary: 'priya' },
    { date: '2026-05-15', primary: 'priya', secondary: 'maya' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const [year, month] = params.month.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // First column = Sunday (0). UTC-stable.
  const firstWeekday = first.getUTCDay();

  // Stable palette per primary owner. Use var(--cm-*) strings — these
  // resolve at paint time so light/dark/accent overrides flow through.
  // Order picks the most-distinct tokens first (accent/accent-2/info/warn)
  // then falls back to derived tints (success, error, fg-dim) for larger
  // rotations. All references go through the iframe's theme preamble.
  const primaries = Array.from(new Set(params.shifts.map((s) => s.primary)));
  const palette = [
    'var(--cm-accent)',
    'var(--cm-accent-2)',
    'var(--cm-info)',
    'var(--cm-warn)',
    'var(--cm-success)',
    'var(--cm-error)',
    'var(--cm-fg-dim)',
    'var(--cm-fg-muted)',
  ];
  const colorFor = new Map<string, string>();
  primaries.forEach((p, i) => colorFor.set(p, palette[i % palette.length]));

  // Use the zod-inferred element type directly so `date` doesn't widen the
  // assignment target under strict mode.
  const shiftByDate = new Map<string, z.infer<typeof ShiftSchema>>();
  for (const s of params.shifts) shiftByDate.set(s.date, s);

  const monthName = first.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const css = `
.rc-wrap { display: grid; gap: 12px; }
.rc-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.rc-dow { padding: 6px 8px; font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-dim); text-align: center; text-transform: uppercase; letter-spacing: 0.04em; }
.rc-cell { min-height: 84px; padding: 6px 8px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); display: grid; align-content: start; gap: 4px; }
.rc-cell.blank { background: transparent; border: none; }
.rc-date { font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-dim); }
.rc-primary { font-size: 12px; color: var(--cm-fg); display: flex; align-items: center; gap: 6px; }
.rc-primary .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.rc-secondary { font-size: 11px; color: var(--cm-fg-muted); font-family: var(--cm-mono); }
.rc-legend { display: flex; flex-wrap: wrap; gap: 10px; padding: 10px 0 0; }
.rc-legend-item { display: flex; align-items: center; gap: 6px; font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-dim); }
.rc-legend-item .dot { width: 10px; height: 10px; border-radius: 50%; }
`;

  const dowHtml = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .map((d) => `<div class="rc-dow">${d}</div>`).join('');

  const cells: string[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push('<div class="rc-cell blank"></div>');
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const s = shiftByDate.get(iso);
    const dot = s ? colorFor.get(s.primary) || 'var(--cm-fg-dim)' : 'var(--cm-border)';
    cells.push(`
      <div class="rc-cell">
        <div class="rc-date">${d}</div>
        ${s ? `
          <div class="rc-primary"><span class="dot" style="background:${dot};"></span>${escHtml(s.primary)}</div>
          ${s.secondary ? `<div class="rc-secondary">+ ${escHtml(s.secondary)}</div>` : ''}
        ` : ''}
      </div>
    `);
  }
  // Pad trailing to keep grid lines even.
  const trail = (7 - ((firstWeekday + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trail; i++) cells.push('<div class="rc-cell blank"></div>');

  const legendHtml = primaries.map((p) => `
    <span class="rc-legend-item"><span class="dot" style="background:${colorFor.get(p)};"></span>${escHtml(p)}</span>
  `).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  <span>${escHtml(monthName)}${params.rotation_name ? ' · ' + escHtml(params.rotation_name) : ''}</span>
</div>
<div class="rc-wrap">
  <div class="rc-grid">${dowHtml}${cells.join('')}</div>
  <div class="rc-legend">${legendHtml}</div>
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'rc-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const ROTATION_CALENDAR_TEMPLATE: ComposeAppTemplate = {
  slug: 'rotation-calendar',
  title: 'On-call rotation calendar',
  description:
    'Month calendar grid showing on-call rotations. Supply { month: "YYYY-MM", shifts[{date: "YYYY-MM-DD", primary, secondary?, team?}], rotation_name? }. Each primary gets a stable color dot; legend at bottom. Use for on-call schedules, support rotations, escalation calendars. Also accepts the alias slug "rotation_calendar".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
