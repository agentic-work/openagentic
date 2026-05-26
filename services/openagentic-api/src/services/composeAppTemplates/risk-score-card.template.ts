/**
 * risk-score-card — single 0-100 score + category breakdown bars + trend
 * sparkline.
 *
 * Phase 6 mocks-parity work. Audit slug: `risk_score_card`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const CategorySchema = z.object({
  name: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().positive().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  score: z.number().min(0).max(100),
  categories: z.array(CategorySchema).min(1),
  trend: z.array(z.number().min(0).max(100)).min(2),
  subtitle: z.string().optional(),
  /** Optional label for the trend axis. Default "last 12 scans". */
  trend_label: z.string().default('last 12 scans'),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'omhs-prod — overall risk score',
  subtitle: 'higher is worse · weekly scan',
  score: 42,
  categories: [
    { name: 'IAM exposure',         score: 28 },
    { name: 'Public ingress',       score: 12 },
    { name: 'Crypto / FIPS',        score: 78 },
    { name: 'Audit gaps',           score: 35 },
    { name: 'Patch lag',            score: 62 },
    { name: 'Data exfil pathways',  score: 18 },
  ],
  trend: [55, 52, 49, 50, 47, 45, 44, 43, 42, 41, 42, 42],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  // For the trend sparkline, build polyline points + fill polygon.
  const W = 220, H = 56, PAD = 4;
  const max = Math.max(...params.trend, 1);
  const pts = params.trend.map((v, i) => {
    const x = PAD + (i / (params.trend.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (v / max) * (H - PAD * 2);
    return [x, y] as const;
  });
  const polyline = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = `${PAD},${H - PAD} ${polyline} ${W - PAD},${H - PAD}`;
  const last = params.trend[params.trend.length - 1];
  const prev = params.trend[0];
  const delta = last - prev;
  const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1);
  const trendCls = delta < 0 ? 'down' : delta > 0 ? 'up' : 'flat';

  const scoreCls = params.score >= 70 ? 'bad' : params.score >= 40 ? 'ok' : 'good';

  const css = `
.rs-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.rs-hero { padding: 16px 18px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); display: grid; gap: 6px; align-content: start; }
.rs-num { font-size: 56px; font-weight: 700; font-family: var(--cm-mono); line-height: 1; }
.rs-num.good { color: var(--cm-success); }
.rs-num.ok   { color: var(--cm-warn); }
.rs-num.bad  { color: var(--cm-error); }
.rs-num-suffix { font-size: 18px; color: var(--cm-fg-dim); font-weight: 500; }
.rs-spark { margin-top: 8px; }
.rs-spark svg { display: block; }
.rs-spark-label { font-size: 11px; color: var(--cm-fg-dim); font-family: var(--cm-mono); display: flex; gap: 10px; align-items: center; }
.rs-delta.down { color: var(--cm-success); }
.rs-delta.up   { color: var(--cm-error); }
.rs-delta.flat { color: var(--cm-fg-dim); }
.rs-cats { padding: 16px 18px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.rs-cat { display: grid; grid-template-columns: 1fr 60px; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--cm-border); align-items: center; }
.rs-cat:last-child { border-bottom: none; }
.rs-cat-row { display: grid; gap: 4px; }
.rs-cat-name { color: var(--cm-fg); font-size: 13px; }
.rs-cat-bar { height: 6px; background: var(--cm-bg-3); border-radius: 3px; overflow: hidden; }
.rs-cat-fill { height: 100%; background: linear-gradient(90deg, var(--cm-success), var(--cm-warn), var(--cm-error)); }
.rs-cat-score { font-family: var(--cm-mono); font-size: 13px; color: var(--cm-fg); text-align: right; }
@media (max-width: 700px) { .rs-wrap { grid-template-columns: 1fr; } }
`;

  const catRows = params.categories.map((c) => `
    <div class="rs-cat">
      <div class="rs-cat-row">
        <div class="rs-cat-name">${escHtml(c.name)}</div>
        <div class="rs-cat-bar"><div class="rs-cat-fill" style="width:${c.score}%"></div></div>
      </div>
      <div class="rs-cat-score">${c.score.toFixed(0)}</div>
    </div>
  `).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="rs-wrap">
  <div class="rs-hero">
    <div><span class="rs-num ${scoreCls}">${params.score.toFixed(0)}</span><span class="rs-num-suffix">/100</span></div>
    <div style="color:var(--cm-fg-dim);font-size:13px;">Composite risk score</div>
    <div class="rs-spark">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${area}" fill="color-mix(in srgb, var(--cm-accent) 18%, transparent)" />
        <polyline points="${polyline}" fill="none" stroke="var(--cm-accent)" stroke-width="1.5" />
      </svg>
      <div class="rs-spark-label">
        <span>${escHtml(params.trend_label)}</span>
        <span class="rs-delta ${trendCls}">${deltaStr}</span>
      </div>
    </div>
  </div>
  <div class="rs-cats">
    <div style="color:var(--cm-fg-dim);font-size:11px;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Breakdown</div>
    ${catRows}
  </div>
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'rs-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const RISK_SCORE_CARD_TEMPLATE: ComposeAppTemplate = {
  slug: 'risk-score-card',
  title: 'Risk score card (composite + breakdown + trend)',
  description:
    'Composite 0-100 risk score card with category breakdown bars and a trend sparkline. Supply { score, categories[{name,score,weight?}], trend[number] (≥2 points), trend_label? }. Use for security risk views, SLO health composites, posture summaries. Also accepts the alias slug "risk_score_card".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
