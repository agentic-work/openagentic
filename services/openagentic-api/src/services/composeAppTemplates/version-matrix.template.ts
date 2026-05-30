/**
 * version-matrix — package × environment grid showing installed vs latest,
 * color-coded by drift (major/minor/patch/equal).
 *
 * Phase 6 mocks-parity work. Audit slug: `version_matrix`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const EntrySchema = z.object({
  package: z.string(),
  environment: z.string(),
  installed: z.string(),
  latest: z.string(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  packages: z.array(z.string()).min(1),
  environments: z.array(z.string()).min(1),
  entries: z.array(EntrySchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'npm package drift — chat-pipeline workspace',
  subtitle: 'installed vs latest by environment',
  packages: ['typescript', 'vitest', 'fastify', 'zod', '@anthropic-ai/sdk'],
  environments: ['dev', 'staging', 'prod'],
  entries: [
    { package: 'typescript', environment: 'dev',     installed: '5.4.5', latest: '5.6.2' },
    { package: 'typescript', environment: 'staging', installed: '5.4.5', latest: '5.6.2' },
    { package: 'typescript', environment: 'prod',    installed: '5.3.3', latest: '5.6.2' },
    { package: 'vitest',     environment: 'dev',     installed: '1.6.0', latest: '2.1.3' },
    { package: 'vitest',     environment: 'staging', installed: '1.6.0', latest: '2.1.3' },
    { package: 'vitest',     environment: 'prod',    installed: '1.6.0', latest: '2.1.3' },
    { package: 'fastify',    environment: 'dev',     installed: '4.28.1', latest: '4.28.1' },
    { package: 'fastify',    environment: 'staging', installed: '4.28.1', latest: '4.28.1' },
    { package: 'fastify',    environment: 'prod',    installed: '4.27.0', latest: '4.28.1' },
    { package: 'zod',        environment: 'dev',     installed: '3.23.8', latest: '3.23.8' },
    { package: 'zod',        environment: 'staging', installed: '3.23.8', latest: '3.23.8' },
    { package: 'zod',        environment: 'prod',    installed: '3.23.8', latest: '3.23.8' },
    { package: '@anthropic-ai/sdk', environment: 'dev',     installed: '0.30.0', latest: '0.34.1' },
    { package: '@anthropic-ai/sdk', environment: 'staging', installed: '0.30.0', latest: '0.34.1' },
    { package: '@anthropic-ai/sdk', environment: 'prod',    installed: '0.27.0', latest: '0.34.1' },
  ],
};

function classifyDrift(installed: string, latest: string): 'equal' | 'patch' | 'minor' | 'major' | 'invalid' {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const a = parse(installed);
  const b = parse(latest);
  if (!a || !b) return 'invalid';
  if (a[0] !== b[0]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  if (a[2] !== b[2]) return 'patch';
  return 'equal';
}

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const map = new Map<string, { installed: string; latest: string }>();
  for (const e of params.entries) {
    map.set(e.package + '\x00' + e.environment, { installed: e.installed, latest: e.latest });
  }

  const css = `
.vm-host { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow-x: auto; }
table.vm { border-collapse: collapse; min-width: 100%; font-size: 12px; }
table.vm th { padding: 8px 12px; background: var(--cm-bg-3); color: var(--cm-fg-dim); font-weight: 600; text-align: left; font-family: var(--cm-mono); border-bottom: 1px solid var(--cm-border); }
table.vm td { padding: 6px 12px; border-bottom: 1px solid var(--cm-border); font-family: var(--cm-mono); }
table.vm td.pkg { color: var(--cm-fg); }
.vm-cell { display: inline-flex; flex-direction: column; gap: 2px; padding: 4px 8px; border-radius: 6px; min-width: 100px; }
.vm-cell .v-installed { font-size: 12px; color: var(--cm-fg); }
.vm-cell .v-latest { font-size: 10px; color: var(--cm-fg-muted); }
.vm-cell.equal   { background: color-mix(in srgb, var(--cm-success) 10%, transparent);  border: 1px solid color-mix(in srgb, var(--cm-success) 30%, transparent); }
.vm-cell.patch   { background: color-mix(in srgb, var(--cm-info) 10%, transparent); border: 1px solid color-mix(in srgb, var(--cm-info) 30%, transparent); }
.vm-cell.minor   { background: color-mix(in srgb, var(--cm-warn) 10%, transparent); border: 1px solid color-mix(in srgb, var(--cm-warn) 30%, transparent); }
.vm-cell.major   { background: color-mix(in srgb, var(--cm-error) 10%, transparent);  border: 1px solid color-mix(in srgb, var(--cm-error) 30%, transparent); }
.vm-cell.invalid { background: var(--cm-bg-3); color: var(--cm-fg-muted); }
.vm-cell.missing { color: var(--cm-fg-muted); }
.vm-legend { display: flex; gap: 12px; padding: 10px 14px; font-size: 11px; font-family: var(--cm-mono); color: var(--cm-fg-dim); border-top: 1px solid var(--cm-border); flex-wrap: wrap; }
.vm-legend .vm-cell { min-width: 0; }
`;

  const headRow = ['<th>package</th>']
    .concat(params.environments.map((e) => `<th>${escHtml(e)}</th>`))
    .join('');

  const bodyRows = params.packages.map((p) => {
    const cells = params.environments.map((env) => {
      const e = map.get(p + '\x00' + env);
      if (!e) return `<td><span class="vm-cell missing">—</span></td>`;
      const drift = classifyDrift(e.installed, e.latest);
      return `<td><span class="vm-cell ${drift}">
        <span class="v-installed">${escHtml(e.installed)}</span>
        <span class="v-latest">→ ${escHtml(e.latest)}</span>
      </span></td>`;
    }).join('');
    return `<tr><td class="pkg">${escHtml(p)}</td>${cells}</tr>`;
  }).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="vm-host">
  <table class="vm">
    <thead><tr>${headRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="vm-legend">
    <span><span class="vm-cell equal">equal</span></span>
    <span><span class="vm-cell patch">patch</span></span>
    <span><span class="vm-cell minor">minor</span></span>
    <span><span class="vm-cell major">major</span></span>
  </div>
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'vm-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const VERSION_MATRIX_TEMPLATE: ComposeAppTemplate = {
  slug: 'version-matrix',
  title: 'Version matrix (package × environment drift)',
  description:
    'Package × environment grid showing installed version + latest available, color-coded by semver drift (equal/patch/minor/major). Supply { packages[], environments[], entries[{package,environment,installed,latest}] }. Use for dependency-drift visualizations across envs. Also accepts the alias slug "version_matrix".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
