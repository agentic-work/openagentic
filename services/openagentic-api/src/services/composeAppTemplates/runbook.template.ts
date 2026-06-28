/**
 * runbook — numbered steps with code blocks + copy-button + run-now button
 * (visual only; the run-now is non-functional in templates).
 *
 * the design notes
 *       (mock 06: aws-k8s-aiops finishes with a runbook)
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const StepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  code: z.string().optional(),
  language: z.enum(['bash', 'sh', 'yaml', 'json', 'ts', 'js', 'py', 'sql', 'hcl']).default('bash'),
  approxDurationMin: z.number().nonnegative().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  steps: z.array(StepSchema).min(1),
  preamble: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'EKS right-sizing runbook',
  preamble: 'Apply the right-sizing recommendations across us-east-1, us-west-2, eu-west-1. Run during the maintenance window.',
  steps: [
    { id: 's1', title: 'Snapshot current state', code: 'kubectl get nodes -o wide -A > nodes.before.txt\nkubectl top nodes >> nodes.before.txt', language: 'bash', approxDurationMin: 2 },
    { id: 's2', title: 'Drain candidate nodes', description: 'One AZ at a time; --grace-period=120.', code: 'for n in $(kubectl get nodes -l candidate=rightsize -o name); do\n  kubectl drain "$n" --ignore-daemonsets --delete-emptydir-data --grace-period=120\ndone', language: 'bash', approxDurationMin: 12 },
    { id: 's3', title: 'Update node group', code: 'aws eks update-nodegroup-config \\\n  --cluster-name prod-eks \\\n  --nodegroup-name workers \\\n  --scaling-config minSize=4,maxSize=10,desiredSize=6', language: 'bash', approxDurationMin: 8 },
    { id: 's4', title: 'Wait for cluster autoscaler to stabilize', code: 'kubectl -n kube-system rollout status deploy/cluster-autoscaler --timeout=10m', language: 'bash', approxDurationMin: 10 },
    { id: 's5', title: 'Verify cost & utilization', code: 'aws ce get-cost-and-usage --time-period Start=2026-05-04,End=2026-05-05 \\\n  --granularity DAILY --metrics UnblendedCost', language: 'bash', approxDurationMin: 3 },
    { id: 's6', title: 'Promote to other regions', description: 'Repeat steps 1–5 against us-west-2 and eu-west-1. Stop and rollback if any region fails verification.' },
    { id: 's7', title: 'Rollback (if needed)', code: 'aws eks update-nodegroup-config --cluster-name prod-eks \\\n  --nodegroup-name workers \\\n  --scaling-config minSize=8,maxSize=16,desiredSize=12', language: 'bash' },
    { id: 's8', title: 'Close out', description: 'Update Confluence runbook page with actuals; record savings in cost dashboard.' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.rb-wrap { display: grid; gap: 12px; }
.rb-preamble { background: var(--cm-bg-2); border-left: 3px solid var(--cm-accent); padding: 10px 14px; color: var(--cm-fg-dim); font-size: 13px; border-radius: 0 var(--cm-radius) var(--cm-radius) 0; }
.rb-step { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 14px; }
.rb-step-head { display: grid; grid-template-columns: 32px 1fr auto; gap: 12px; align-items: start; }
.rb-step-num { width: 28px; height: 28px; border-radius: 50%; background: var(--cm-bg-3); color: var(--cm-accent); font-family: var(--cm-mono); display: grid; place-items: center; font-size: 13px; border: 1px solid var(--cm-border); }
.rb-step-title { color: var(--cm-fg); font-size: 14px; font-weight: 600; }
.rb-step-meta { color: var(--cm-fg-dim); font-size: 11px; font-family: var(--cm-mono); margin-top: 2px; }
.rb-step-desc { color: var(--cm-fg-dim); font-size: 13px; margin: 8px 0 0 44px; line-height: 1.4; }
.rb-step-actions { display: flex; gap: 6px; }
.rb-btn { padding: 4px 10px; background: var(--cm-bg-3); border: 1px solid var(--cm-border); color: var(--cm-fg); border-radius: var(--cm-radius); cursor: pointer; font-size: 11px; font-family: var(--cm-mono); }
.rb-btn.run { background: color-mix(in srgb, var(--cm-accent) 10%, transparent); border-color: color-mix(in srgb, var(--cm-accent) 40%, transparent); color: var(--cm-accent); }
.rb-code { background: var(--cm-bg); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 10px 12px; margin: 10px 0 0 44px; font-family: var(--cm-mono); font-size: 12px; color: var(--cm-fg); overflow-x: auto; white-space: pre; }
`;

  const stepsHtml = params.steps.map((s, i) => `
    <article class="rb-step" data-step="${esc(s.id)}">
      <div class="rb-step-head">
        <div class="rb-step-num">${i + 1}</div>
        <div>
          <div class="rb-step-title">${esc(s.title)}</div>
          ${s.approxDurationMin != null ? `<div class="rb-step-meta">~${s.approxDurationMin} min</div>` : ''}
        </div>
        <div class="rb-step-actions">
          ${s.code ? `<button class="rb-btn rb-copy" data-copy-target="rb-code-${esc(s.id)}">copy</button>` : ''}
          ${s.code ? `<button class="rb-btn run" data-run="${esc(s.id)}">run now</button>` : ''}
        </div>
      </div>
      ${s.description ? `<div class="rb-step-desc">${esc(s.description)}</div>` : ''}
      ${s.code ? `<pre class="rb-code" id="rb-code-${esc(s.id)}"><code class="lang-${esc(s.language)}">${esc(s.code)}</code></pre>` : ''}
    </article>
  `).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${esc(params.title)}</span>
  <span class="cm-tag info">runbook · ${params.steps.length} steps</span>
</div>
<div class="rb-wrap">
  ${params.preamble ? `<div class="rb-preamble">${esc(params.preamble)}</div>` : ''}
  ${stepsHtml}
</div>`;

  const script = `
document.querySelectorAll('.rb-copy').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const id = btn.getAttribute('data-copy-target');
    const node = document.getElementById(id);
    if (!node) return;
    const text = node.textContent || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'copied';
        setTimeout(function () { btn.textContent = 'copy'; }, 1500);
      });
    } else {
      btn.textContent = 'copy unavailable';
    }
  });
});
document.querySelectorAll('[data-run]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    btn.textContent = 'queued';
    btn.disabled = true;
  });
});
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'rb-data': params },
    inlineScripts: [script],
  });
}

function esc(s: string): string {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

void CDN_LIB;

export const RUNBOOK_TEMPLATE: ComposeAppTemplate = {
  slug: 'runbook',
  title: 'Operational runbook',
  description:
    'Numbered runbook of operational steps, each with title, optional description, optional code block (with copy button + non-functional run-now button) and optional duration estimate. Use when the user asks for a runbook, change-window plan, or step-by-step procedure. Supply steps[{id,title,description?,code?,language?,approxDurationMin?}].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
