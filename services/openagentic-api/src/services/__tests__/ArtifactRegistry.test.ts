/**
 * ArtifactRegistry — single SoT for mapping `tool_result._meta.outputTemplate`
 * (or `compose_app` template slug) to one of 5 first-class artifact kinds.
 *
 * Replaces the implicit "HTML-fence-or-bust" path that silently failed when
 * outputTemplate was missing or unrecognized.
 *
 * Plan: docs/superpowers/plans/2026-05-13-next-gen-artifact-slideouts.md
 * Phase A.1 (#781)
 */
import { describe, it, expect } from 'vitest';
import {
  ArtifactRegistry,
  classifyArtifact,
  exportableMimesFor,
  type ArtifactKind,
  _SLUG_COVERAGE_FOR_TESTS,
} from '../ArtifactRegistry.js';
import { listTemplateSlugs } from '../composeAppTemplates.js';

describe('ArtifactRegistry.classify', () => {
  it('classifies Python report templates as python-report', () => {
    expect(ArtifactRegistry.classify('python-report')).toBe<ArtifactKind>('python-report');
    expect(ArtifactRegistry.classify('markdown-report')).toBe<ArtifactKind>('python-report');
    expect(ArtifactRegistry.classify('analysis-report')).toBe<ArtifactKind>('python-report');
  });

  it('classifies compose_app templates as react-app', () => {
    expect(ArtifactRegistry.classify('compose_app')).toBe<ArtifactKind>('react-app');
    expect(ArtifactRegistry.classify('react-app')).toBe<ArtifactKind>('react-app');
    expect(ArtifactRegistry.classify('cloud-cost-dashboard')).toBe<ArtifactKind>('react-app');
  });

  it('classifies chart slugs as chart', () => {
    expect(ArtifactRegistry.classify('sankey')).toBe<ArtifactKind>('chart');
    expect(ArtifactRegistry.classify('bar-chart')).toBe<ArtifactKind>('chart');
    expect(ArtifactRegistry.classify('line-chart')).toBe<ArtifactKind>('chart');
    expect(ArtifactRegistry.classify('pie-chart')).toBe<ArtifactKind>('chart');
    expect(ArtifactRegistry.classify('traffic-flow-diagram')).toBe<ArtifactKind>('chart');
  });

  it('classifies table-style slugs as table', () => {
    expect(ArtifactRegistry.classify('cost-table')).toBe<ArtifactKind>('table');
    expect(ArtifactRegistry.classify('vm-inventory')).toBe<ArtifactKind>('table');
    expect(ArtifactRegistry.classify('cloud-run-grid')).toBe<ArtifactKind>('table');
    expect(ArtifactRegistry.classify('data-table')).toBe<ArtifactKind>('table');
  });

  it('classifies runbook/step slugs as runbook', () => {
    expect(ArtifactRegistry.classify('runbook')).toBe<ArtifactKind>('runbook');
    expect(ArtifactRegistry.classify('runbook-steps')).toBe<ArtifactKind>('runbook');
    expect(ArtifactRegistry.classify('cut-checklist')).toBe<ArtifactKind>('runbook');
    expect(ArtifactRegistry.classify('multi-region-eks-dashboard')).toBe<ArtifactKind>('runbook');
  });

  it('returns "unknown" — NOT "html" — for unrecognized slugs', () => {
    // Key contract: unknown templates do NOT silently fall through to HTML.
    // The UI surfaces a structured "unknown artifact kind" state with a
    // Retry button + the raw payload available for inspection.
    expect(ArtifactRegistry.classify('some-bespoke-thing')).toBe<ArtifactKind>('unknown');
    expect(ArtifactRegistry.classify('html')).toBe<ArtifactKind>('unknown');
    expect(ArtifactRegistry.classify('svg')).toBe<ArtifactKind>('unknown');
    expect(ArtifactRegistry.classify('iframe')).toBe<ArtifactKind>('unknown');
  });

  it('returns "unknown" for undefined / empty / null inputs', () => {
    expect(ArtifactRegistry.classify(undefined)).toBe<ArtifactKind>('unknown');
    expect(ArtifactRegistry.classify('')).toBe<ArtifactKind>('unknown');
    expect(ArtifactRegistry.classify(null as unknown as string)).toBe<ArtifactKind>('unknown');
  });

  it('is case-insensitive on the input slug', () => {
    expect(ArtifactRegistry.classify('Python-Report')).toBe<ArtifactKind>('python-report');
    expect(ArtifactRegistry.classify('SANKEY')).toBe<ArtifactKind>('chart');
    expect(ArtifactRegistry.classify('RunBook')).toBe<ArtifactKind>('runbook');
  });
});

describe('ArtifactRegistry.exportableMimes', () => {
  it('python-report exports PDF + markdown source', () => {
    const mimes = ArtifactRegistry.exportableMimes('python-report');
    expect(mimes).toContain('application/pdf');
    expect(mimes).toContain('text/markdown');
  });

  it('chart exports PNG + SVG + JSON spec', () => {
    const mimes = ArtifactRegistry.exportableMimes('chart');
    expect(mimes).toContain('image/png');
    expect(mimes).toContain('image/svg+xml');
    expect(mimes).toContain('application/json');
  });

  it('table exports CSV + JSON', () => {
    const mimes = ArtifactRegistry.exportableMimes('table');
    expect(mimes).toContain('text/csv');
    expect(mimes).toContain('application/json');
  });

  it('runbook exports markdown + PDF', () => {
    const mimes = ArtifactRegistry.exportableMimes('runbook');
    expect(mimes).toContain('text/markdown');
    expect(mimes).toContain('application/pdf');
  });

  it('react-app exports source TS/TSX bundle', () => {
    const mimes = ArtifactRegistry.exportableMimes('react-app');
    expect(mimes).toContain('text/typescript');
  });

  it('unknown returns empty array (no exports offered)', () => {
    expect(ArtifactRegistry.exportableMimes('unknown')).toEqual([]);
  });
});

describe('ArtifactRegistry — back-compat + named-export parity', () => {
  it('classifyArtifact named export mirrors ArtifactRegistry.classify', () => {
    expect(classifyArtifact('sankey')).toBe(ArtifactRegistry.classify('sankey'));
    expect(classifyArtifact('unknown-thing')).toBe(ArtifactRegistry.classify('unknown-thing'));
  });

  it('exportableMimesFor named export mirrors ArtifactRegistry.exportableMimes', () => {
    expect(exportableMimesFor('chart')).toEqual(ArtifactRegistry.exportableMimes('chart'));
  });

  it('exportableMimesFor returns the same reference across calls (no per-call allocation)', () => {
    expect(exportableMimesFor('chart')).toBe(exportableMimesFor('chart'));
  });
});

describe('ArtifactRegistry — SoT coverage vs compose_app registry', () => {
  // Pins ArtifactRegistry against the COMPOSE_APP_TEMPLATES registry so a
  // new template added to composeAppTemplates.ts can't silently classify as
  // 'unknown' in the slide-out renderer.
  it('every compose_app template slug is classified to a real kind', () => {
    const templateSlugs = listTemplateSlugs();
    const missing: string[] = [];
    for (const slug of templateSlugs) {
      const kind = classifyArtifact(slug);
      if (kind === 'unknown') missing.push(slug);
    }
    expect(missing, `compose_app template slugs missing from ArtifactRegistry: ${missing.join(', ')}`).toEqual([]);
  });

  it('every classified slug is unique (no duplicate keys)', () => {
    const slugs = Array.from(_SLUG_COVERAGE_FOR_TESTS.keys());
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
