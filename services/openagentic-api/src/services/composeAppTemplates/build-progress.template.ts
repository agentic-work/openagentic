/**
 * build-progress — live build-log tail with phase indicators (build → push
 * → deploy → verify), each phase animated as it lands.
 *
 * Spec: docs/superpowers/specs/2026-05-03-chatmode-end-state-design.md
 *       (mock 05: troubleshoot-fix-build-validate)
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const PhaseSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).default('pending'),
  durationMs: z.number().nonnegative().optional(),
});

const LogLineSchema = z.object({
  phaseId: z.string(),
  ts: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  text: z.string(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  phases: z.array(PhaseSchema).min(1),
  logs: z.array(LogLineSchema).min(1),
  imageRef: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'staging-api — fix → build → deploy → verify',
  imageRef: 'agentic/api:v0.7.1-c4a8e2',
  phases: [
    { id: 'p1', label: 'patch Dockerfile', status: 'done', durationMs: 1200 },
    { id: 'p2', label: 'docker build', status: 'done', durationMs: 184000 },
    { id: 'p3', label: 'docker push', status: 'done', durationMs: 22000 },
    { id: 'p4', label: 'helm upgrade', status: 'done', durationMs: 7200 },
    { id: 'p5', label: 'verify pods', status: 'running' },
  ],
  logs: [
    { phaseId: 'p1', ts: '12:00:01', level: 'info', text: '> apply patch: Dockerfile +1 -0' },
    { phaseId: 'p1', ts: '12:00:02', level: 'info', text: '✓ patch applied' },
    { phaseId: 'p2', ts: '12:00:05', level: 'info', text: '> docker build --platform=linux/amd64 -t agentic/api:v0.7.1 .' },
    { phaseId: 'p2', ts: '12:01:14', level: 'info', text: 'Step 4/12: COPY package*.json ./' },
    { phaseId: 'p2', ts: '12:02:31', level: 'info', text: 'Step 9/12: RUN npm ci --omit=dev' },
    { phaseId: 'p2', ts: '12:03:09', level: 'info', text: '✓ build complete · sha256:c4a8e2…' },
    { phaseId: 'p3', ts: '12:03:11', level: 'info', text: '> docker push localhost:5000/agentic/api:v0.7.1-c4a8e2' },
    { phaseId: 'p3', ts: '12:03:33', level: 'info', text: '✓ pushed (4 layers, 92 MiB)' },
    { phaseId: 'p4', ts: '12:03:35', level: 'info', text: '> helm upgrade openagentic ./helm/openagentic -f values-k3s-local.yaml' },
    { phaseId: 'p4', ts: '12:03:42', level: 'info', text: 'Release "openagentic" has been upgraded. Happy Helming!' },
    { phaseId: 'p5', ts: '12:03:43', level: 'info', text: '> kubectl rollout status deploy/api -n agentic-dev' },
    { phaseId: 'p5', ts: '12:04:01', level: 'info', text: 'deployment "api" successfully rolled out' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.bp-wrap { display: grid; gap: 12px; }
.bp-phases { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.bp-phase { display: grid; grid-template-rows: auto auto; gap: 4px; padding: 10px 14px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); min-width: 140px; }
.bp-phase.done { border-color: var(--cm-success); }
.bp-phase.running { border-color: var(--cm-accent); animation: bp-pulse 1.6s ease-in-out infinite; }
.bp-phase.failed { border-color: var(--cm-error); }
.bp-phase-label { font-size: 12px; color: var(--cm-fg); font-family: var(--cm-mono); }
.bp-phase-meta { font-size: 11px; color: var(--cm-fg-dim); }
@keyframes bp-pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cm-accent) 45%, transparent); } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--cm-accent) 0%, transparent); } }
.bp-log { background: var(--cm-bg); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 12px 14px; max-height: 320px; overflow-y: auto; font-family: var(--cm-mono); font-size: 12px; }
.bp-line { display: grid; grid-template-columns: 70px 60px 1fr; gap: 8px; padding: 1px 0; }
.bp-ts { color: var(--cm-fg-muted); }
.bp-level { color: var(--cm-fg-dim); }
.bp-level-warn { color: var(--cm-warn); }
.bp-level-error { color: var(--cm-error); }
.bp-text { color: var(--cm-fg); white-space: pre-wrap; word-break: break-all; }
.bp-image { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-accent); }
`;

  const phasesHtml = params.phases.map((p) => `
    <div class="bp-phase ${esc(p.status)}">
      <span class="bp-phase-label">${p.status === 'done' ? '✓ ' : p.status === 'running' ? '· ' : p.status === 'failed' ? '✗ ' : ''}${esc(p.label)}</span>
      <span class="bp-phase-meta">${p.durationMs != null ? humanMs(p.durationMs) : esc(p.status)}</span>
    </div>
  `).join('');

  const logsHtml = params.logs.map((l) => `
    <div class="bp-line">
      <span class="bp-ts">${esc(l.ts)}</span>
      <span class="bp-level bp-level-${esc(l.level)}">${esc(l.level)}</span>
      <span class="bp-text">${esc(l.text)}</span>
    </div>
  `).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${esc(params.title)}</span>
  ${params.imageRef ? `<span class="bp-image">${esc(params.imageRef)}</span>` : ''}
</div>
<div class="bp-wrap">
  <div class="bp-phases">${phasesHtml}</div>
  <div class="bp-log" id="bp-log">${logsHtml}</div>
</div>`;

  const script = `
const log = document.getElementById('bp-log');
if (log) log.scrollTop = log.scrollHeight;
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'bp-data': params },
    inlineScripts: [script],
  });
}

function humanMs(ms: number): string {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m + 'm ' + s + 's';
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

void CDN_LIB;

export const BUILD_PROGRESS_TEMPLATE: ComposeAppTemplate = {
  slug: 'build-progress',
  title: 'Build progress with live log tail',
  description:
    'Live build-pipeline view: phase chips (build → push → deploy → verify) with status, plus a streamed log tail. Use when the user is troubleshooting / fixing / building / verifying a deploy. Supply phases[{id,label,status,durationMs?}] and logs[{phaseId,ts,level,text}].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
