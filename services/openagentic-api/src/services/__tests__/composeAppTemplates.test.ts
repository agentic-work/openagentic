/**
 * compose_app template registry — RED-first tests.
 *
 * the design notes
 *
 * Each template:
 *   - resolves via findTemplate(slug)
 *   - listTemplateSlugs() includes its slug
 *   - paramsSchema.parse(exampleParams) succeeds
 *   - paramsSchema.parse({}) FAILS (typed-safe)
 *   - htmlTemplate(exampleParams) returns a non-empty string
 *   - that string passes composeAppValidator
 *   - every cdnLib referenced is on the same-origin /api/cdn/lib/ allow-list
 *
 * Trust boundary remains the validator + CdnAllowList. Templates aren't a
 * privilege escalation — they pass through the same gate as freestyle HTML.
 */

import { describe, test, expect } from 'vitest';
import {
  COMPOSE_APP_TEMPLATES,
  findTemplate,
  listTemplateSlugs,
  type ComposeAppTemplate,
} from '../composeAppTemplates.js';
import { validateComposeAppPayload } from '../composeAppValidator.js';
import { validateScriptUrls } from '../CdnAllowList.js';

const EXPECTED_SLUGS = [
  'aws-cloud-architecture',
  'k8s-cluster-topology',
  'cost-sankey-savings',
  'multi-tenant-audit-dashboard',
  'traffic-flow-diagram',
  'cloud-run-grid',
  'build-progress',
  'multi-region-eks-dashboard',
  'runbook',
  // #655 — generic chart primitives (bar/line/pie).
  'bar-chart',
  'line-chart',
  'pie-chart',
  // Phase 6 mocks-parity (the design notes).
  'savings-grid',
  'incident-timeline',
  'latency-heatmap',
  'incident-card',
  'compliance-dashboard',
  'remediation-plan',
  'migration-plan',
  'dependency-graph',
  'flamegraph',
  'root-cause-card',
  'permission-matrix',
  'risk-score-card',
  'cluster-inventory',
  'version-matrix',
  'breaking-changes-list',
  'log-anomaly-chart',
  'rotation-calendar',
  'risk-priority-queue',
  'training-runs-dashboard',
  'gpu-utilization-chart',
];

describe('composeAppTemplates — registry shape', () => {
  test('exports a non-empty COMPOSE_APP_TEMPLATES array', () => {
    expect(Array.isArray(COMPOSE_APP_TEMPLATES)).toBe(true);
    expect(COMPOSE_APP_TEMPLATES.length).toBe(EXPECTED_SLUGS.length);
  });

  test('listTemplateSlugs returns every slug, deduped', () => {
    const slugs = listTemplateSlugs();
    expect(slugs).toEqual(expect.arrayContaining(EXPECTED_SLUGS));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test('findTemplate returns undefined for an unknown slug', () => {
    expect(findTemplate('this-slug-does-not-exist')).toBeUndefined();
  });

  // Phase 6 alias mechanism: audit slugs are written with underscores
  // (savings_grid, incident_timeline, …) but the canonical registry uses
  // hyphens (enforced by the slug regex). findTemplate must accept the
  // underscored form transparently so model output stays compatible with
  // the audit wording.
  test('findTemplate resolves underscored aliases to the canonical hyphenated template', () => {
    const cases: Array<[string, string]> = [
      ['savings_grid', 'savings-grid'],
      ['incident_timeline', 'incident-timeline'],
      ['latency_heatmap', 'latency-heatmap'],
      ['compliance_dashboard', 'compliance-dashboard'],
      ['root_cause_card', 'root-cause-card'],
      ['permission_matrix', 'permission-matrix'],
      ['version_matrix', 'version-matrix'],
      ['log_anomaly_chart', 'log-anomaly-chart'],
      ['training_runs_dashboard', 'training-runs-dashboard'],
      ['gpu_utilization_chart', 'gpu-utilization-chart'],
    ];
    for (const [alias, canonical] of cases) {
      const t = findTemplate(alias);
      expect(t, `alias "${alias}" should resolve to "${canonical}"`).toBeDefined();
      expect(t!.slug).toBe(canonical);
    }
  });

  test('every template has a unique slug, title, description, schema, htmlTemplate, and exampleParams', () => {
    const seen = new Set<string>();
    for (const t of COMPOSE_APP_TEMPLATES) {
      expect(t.slug).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(seen.has(t.slug)).toBe(false);
      seen.add(t.slug);

      expect(typeof t.title).toBe('string');
      expect(t.title.length).toBeGreaterThan(0);

      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(20);

      expect(typeof t.htmlTemplate).toBe('function');
      expect(t.paramsSchema).toBeDefined();
      expect(t.exampleParams).toBeDefined();
      expect(Array.isArray(t.cdnLibs)).toBe(true);
    }
  });
});

// Per-template suite — every template must pass the same six contracts.
for (const slug of EXPECTED_SLUGS) {
  describe(`composeAppTemplates — ${slug}`, () => {
    let template: ComposeAppTemplate;

    test('resolves via findTemplate', () => {
      const t = findTemplate(slug);
      expect(t).toBeDefined();
      template = t!;
      expect(template.slug).toBe(slug);
    });

    test('paramsSchema.parse(exampleParams) succeeds', () => {
      const t = findTemplate(slug)!;
      expect(() => t.paramsSchema.parse(t.exampleParams)).not.toThrow();
    });

    test('paramsSchema.parse({}) fails (schema requires real input)', () => {
      const t = findTemplate(slug)!;
      // Acceptable behavior: either throws OR succeeds + then htmlTemplate
      // throws / produces invalid output. We require a schema that has at
      // least one required field, so {} should throw.
      expect(() => t.paramsSchema.parse({})).toThrow();
    });

    test('htmlTemplate returns a non-empty HTML document string', () => {
      const t = findTemplate(slug)!;
      const html = t.htmlTemplate(t.exampleParams);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(200);
      // Must be a full document; common heuristic: contains <html or <!doctype.
      expect(html.toLowerCase()).toMatch(/<!doctype|<html/);
    });

    test('hydrated HTML passes composeAppValidator (CSP + CDN + size + no-eval + no-iframe)', () => {
      const t = findTemplate(slug)!;
      const html = t.htmlTemplate(t.exampleParams);
      const r = validateComposeAppPayload(html);
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.error(`[${slug}] validator violations`, r.errors);
      }
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    });

    test('all <script src> URLs in hydrated HTML are on the /api/cdn/lib/ allow-list', () => {
      const t = findTemplate(slug)!;
      const html = t.htmlTemplate(t.exampleParams);
      const r = validateScriptUrls(html);
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.error(`[${slug}] cdn-allowlist violations`, r.violations);
      }
      expect(r.ok).toBe(true);
    });

    test('declared cdnLibs are referenced inside the hydrated HTML', () => {
      const t = findTemplate(slug)!;
      const html = t.htmlTemplate(t.exampleParams);
      // Every declared cdnLib must appear at least once. If the lib isn't
      // referenced in the template, the declaration is misleading.
      for (const lib of t.cdnLibs) {
        expect(html.includes(lib)).toBe(true);
      }
    });
  });
}
