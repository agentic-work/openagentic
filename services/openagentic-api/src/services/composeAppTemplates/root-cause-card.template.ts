/**
 * root-cause-card — single root-cause analysis card.
 *
 * Phase 6 mocks-parity work. Audit slug: `root_cause_card`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const EvidenceSchema = z.object({
  source: z.string(),
  detail: z.string(),
  link: z.string().optional(),
});

const StepSchema = z.object({
  action: z.string(),
  owner: z.string().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  hypothesis: z.string().min(1),
  evidence: z.array(EvidenceSchema).min(1),
  confidence: z.number().min(0).max(100),
  next_steps: z.array(StepSchema).default([]),
  scope: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'RCA — payment-gateway 5xx storm',
  scope: 'eu-west-1 · INC-4827',
  hypothesis:
    'stripe-proxy connection pool exhaustion caused cascading 5xx in payment-gateway during checkout peak.',
  confidence: 85,
  evidence: [
    { source: 'datadog-trace', detail: 'pool waiting=212 max=64 at 14:48' },
    { source: 'cloudwatch-logs', detail: '"ConnectionAcquireTimeout" first appears 14:24:30' },
    { source: 'git-blame', detail: 'pool max=64 set in PR #4119 (2025-11-22, untouched since)' },
    { source: 'load-test-history', detail: 'p99 traffic doubled WoW (Black Friday window)' },
  ],
  next_steps: [
    { action: 'Raise pool max 64 → 256 (config-only, no deploy)', owner: 'platform' },
    { action: 'Add pool-saturation alert before exhaustion', owner: 'sre' },
    { action: 'Add load-test budget for Black Friday', owner: 'qa' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const confCls = params.confidence >= 80 ? 'good' : params.confidence >= 60 ? 'ok' : 'bad';

  const css = `
.rc-card { display: grid; gap: 12px; }
.rc-head { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 14px 16px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); align-items: center; }
.rc-h-title { color: var(--cm-fg); font-size: 16px; font-weight: 600; }
.rc-h-scope { font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-dim); margin-top: 2px; }
.rc-conf { display: grid; gap: 4px; min-width: 130px; text-align: right; }
.rc-conf-num { font-size: 22px; font-weight: 700; font-family: var(--cm-mono); }
.rc-conf-num.good { color: var(--cm-success); }
.rc-conf-num.ok   { color: var(--cm-warn); }
.rc-conf-num.bad  { color: var(--cm-error); }
.rc-conf-label { font-size: 11px; color: var(--cm-fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.rc-hypothesis { padding: 14px 16px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); color: var(--cm-fg); font-size: 14px; line-height: 1.5; }
.rc-hypothesis-label { font-size: 11px; color: var(--cm-fg-dim); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.rc-section { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow: hidden; }
.rc-section-head { padding: 10px 14px; background: var(--cm-bg-3); color: var(--cm-fg); font-weight: 600; font-size: 13px; }
.rc-evidence { padding: 10px 14px; border-top: 1px solid var(--cm-border); display: grid; grid-template-columns: 160px 1fr; gap: 12px; }
.rc-evidence-source { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-accent); }
.rc-evidence-detail { color: var(--cm-fg); font-size: 13px; }
.rc-step { padding: 10px 14px; border-top: 1px solid var(--cm-border); display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; }
.rc-step-bullet { width: 6px; height: 6px; border-radius: 50%; background: var(--cm-accent); }
.rc-step-action { color: var(--cm-fg); font-size: 13px; }
.rc-step-owner { font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-dim); }
`;

  const evidenceRows = params.evidence.map((e) => `
    <div class="rc-evidence">
      <div class="rc-evidence-source">${escHtml(e.source)}</div>
      <div class="rc-evidence-detail">${escHtml(e.detail)}</div>
    </div>
  `).join('');

  const stepRows = params.next_steps.map((s) => `
    <div class="rc-step">
      <span class="rc-step-bullet"></span>
      <span class="rc-step-action">${escHtml(s.action)}</span>
      <span class="rc-step-owner">${s.owner ? escHtml(s.owner) : ''}</span>
    </div>
  `).join('');

  const body = `
<div class="viz-head"><span class="viz-title">${escHtml(params.title)}</span><span class="cm-tag info">root-cause-card</span></div>
<div class="rc-card">
  <div class="rc-head">
    <div>
      <div class="rc-h-title">${escHtml(params.title)}</div>
      ${params.scope ? `<div class="rc-h-scope">${escHtml(params.scope)}</div>` : ''}
    </div>
    <div class="rc-conf">
      <span class="rc-conf-num ${confCls}">${params.confidence}%</span>
      <span class="rc-conf-label">Confidence</span>
    </div>
  </div>
  <div class="rc-hypothesis">
    <div class="rc-hypothesis-label">Hypothesis</div>
    ${escHtml(params.hypothesis)}
  </div>
  <section class="rc-section">
    <div class="rc-section-head">Evidence (${params.evidence.length})</div>
    ${evidenceRows}
  </section>
  ${params.next_steps.length > 0 ? `
    <section class="rc-section">
      <div class="rc-section-head">Next steps</div>
      ${stepRows}
    </section>` : ''}
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

export const ROOT_CAUSE_CARD_TEMPLATE: ComposeAppTemplate = {
  slug: 'root-cause-card',
  title: 'Root-cause analysis card',
  description:
    'Single root-cause analysis card { title, hypothesis, evidence[{source,detail,link?}], confidence (0-100), next_steps[{action,owner?}] }. Use when the user asks for an RCA summary, why-did-X-fail explanation, or post-mortem hypothesis. Also accepts the alias slug "root_cause_card".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
