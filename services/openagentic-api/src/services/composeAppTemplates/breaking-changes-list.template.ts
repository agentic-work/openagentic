/**
 * breaking-changes-list — vertical list of breaking changes per package.
 *
 * Phase 6 mocks-parity work. Audit slug: `breaking_changes_list`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const ChangeSchema = z.object({
  package: z.string(),
  version: z.string(),
  change_summary: z.string(),
  migration_hint: z.string().optional(),
  severity: z.enum(['critical', 'major', 'minor']).default('major'),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  changes: z.array(ChangeSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Breaking changes — Q3 2026 upgrade window',
  subtitle: 'sorted by severity',
  changes: [
    {
      package: 'fastify',
      version: '4.x → 5.0',
      change_summary: 'CommonJS export removed; ESM-only',
      migration_hint: 'Switch require → import, set "type": "module" in package.json.',
      severity: 'critical',
    },
    {
      package: '@anthropic-ai/sdk',
      version: '0.27 → 0.34',
      change_summary: 'messages.stream returns AsyncIterable<MessageStreamEvent>; events renamed',
      migration_hint: 'Replace text_delta listener with content_block_delta event handler.',
      severity: 'major',
    },
    {
      package: 'vitest',
      version: '1.x → 2.0',
      change_summary: 'globals removed by default; explicit imports required',
      migration_hint: 'Add globals: true to vitest.config.ts or import { describe, test, expect } per file.',
      severity: 'major',
    },
    {
      package: 'zod',
      version: '3.22 → 3.23',
      change_summary: 'z.string().email() now uses RFC 5321 regex; stricter validation',
      migration_hint: 'Audit fixtures for now-rejected addresses.',
      severity: 'minor',
    },
    {
      package: 'typescript',
      version: '5.3 → 5.6',
      change_summary: 'noPropertyAccessFromIndexSignature enforced under "strict"',
      migration_hint: 'Switch obj.foo → obj["foo"] where Foo lacks a declared property.',
      severity: 'minor',
    },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const counts = {
    critical: params.changes.filter((c) => c.severity === 'critical').length,
    major:    params.changes.filter((c) => c.severity === 'major').length,
    minor:    params.changes.filter((c) => c.severity === 'minor').length,
  };

  const css = `
.bc-wrap { display: grid; gap: 12px; }
.bc-summary { display: flex; gap: 8px; flex-wrap: wrap; }
.bc-sum-pill { padding: 6px 12px; border-radius: 999px; font-family: var(--cm-mono); font-size: 12px; border: 1px solid var(--cm-border); }
.bc-sum-pill.critical { background: color-mix(in srgb, var(--cm-error) 15%, transparent);  color: var(--cm-error);   border-color: color-mix(in srgb, var(--cm-error) 40%, transparent); }
.bc-sum-pill.major    { background: color-mix(in srgb, var(--cm-warn) 15%, transparent); color: var(--cm-warn);    border-color: color-mix(in srgb, var(--cm-warn) 40%, transparent); }
.bc-sum-pill.minor    { background: color-mix(in srgb, var(--cm-info) 15%, transparent); color: var(--cm-info);    border-color: color-mix(in srgb, var(--cm-info) 40%, transparent); }
.bc-item { padding: 12px 14px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); border-left: 4px solid var(--cm-fg-muted); }
.bc-item.critical { border-left-color: var(--cm-error); }
.bc-item.major    { border-left-color: var(--cm-warn); }
.bc-item.minor    { border-left-color: var(--cm-info); }
.bc-head { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 12px; margin-bottom: 4px; }
.bc-pkg { font-family: var(--cm-mono); color: var(--cm-fg); font-size: 14px; font-weight: 600; }
.bc-ver { font-family: var(--cm-mono); color: var(--cm-fg-dim); font-size: 12px; margin-left: 8px; }
.bc-sev { padding: 2px 8px; border-radius: 999px; font-family: var(--cm-mono); font-size: 11px; }
.bc-sev.critical { background: color-mix(in srgb, var(--cm-error) 18%, transparent); color: var(--cm-error); }
.bc-sev.major    { background: color-mix(in srgb, var(--cm-warn) 18%, transparent); color: var(--cm-warn); }
.bc-sev.minor    { background: color-mix(in srgb, var(--cm-info) 18%, transparent); color: var(--cm-info); }
.bc-summary-text { color: var(--cm-fg); font-size: 13px; }
.bc-migration { margin-top: 8px; padding: 8px 12px; background: var(--cm-bg-3); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); color: var(--cm-fg-dim); font-size: 12px; }
.bc-migration-label { color: var(--cm-accent); font-family: var(--cm-mono); font-size: 11px; margin-right: 6px; }
`;

  const severityOrder = { critical: 0, major: 1, minor: 2 };
  const sorted = [...params.changes].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const items = sorted.map((c) => `
    <article class="bc-item ${escHtml(c.severity)}">
      <div class="bc-head">
        <div>
          <span class="bc-pkg">${escHtml(c.package)}</span>
          <span class="bc-ver">${escHtml(c.version)}</span>
        </div>
        <span class="bc-sev ${escHtml(c.severity)}">${escHtml(c.severity)}</span>
      </div>
      <div class="bc-summary-text">${escHtml(c.change_summary)}</div>
      ${c.migration_hint ? `<div class="bc-migration"><span class="bc-migration-label">migration:</span>${escHtml(c.migration_hint)}</div>` : ''}
    </article>
  `).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="bc-wrap">
  <div class="bc-summary">
    <span class="bc-sum-pill critical">critical · ${counts.critical}</span>
    <span class="bc-sum-pill major">major · ${counts.major}</span>
    <span class="bc-sum-pill minor">minor · ${counts.minor}</span>
  </div>
  ${items}
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'bc-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const BREAKING_CHANGES_LIST_TEMPLATE: ComposeAppTemplate = {
  slug: 'breaking-changes-list',
  title: 'Breaking changes list',
  description:
    'Vertical list of breaking changes per package. Supply { changes[{package, version, change_summary, migration_hint?, severity: critical|major|minor}] }. Auto-sorted by severity. Use for upgrade impact-assessments, release-note summaries, migration playbooks. Also accepts the alias slug "breaking_changes_list".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
