/**
 * ArtifactRegistry — classify a `tool_result._meta.outputTemplate` (or
 * compose_app template slug) into one of 5 first-class artifact kinds.
 *
 * the design notes
 * Phase A.1 (#781)
 *
 * Contract:
 *   - Unknown slugs return `'unknown'` (NOT `'html'`). The UI surfaces a
 *     structured "unknown artifact kind" state with a Retry + raw-payload
 *     inspector — never a silently-empty iframe.
 *   - Classification is case-insensitive and stable. Adding a new slug
 *     means adding it to `KIND_BY_SLUG` below; the arch test in
 *     `__tests__/ArtifactRegistry.test.ts` pins coverage against the
 *     compose_app template registry so the two never drift.
 *   - `exportableMimesFor(kind)` is the only place renderers ask "what
 *     file formats can I offer to the user?" — keeps PDF/PNG/CSV mapping
 *     consistent across all 5 renderers.
 */

export type ArtifactKind =
  | 'python-report'
  | 'react-app'
  | 'chart'
  | 'table'
  | 'runbook'
  | 'unknown';

const KIND_BY_SLUG: ReadonlyMap<string, ArtifactKind> = new Map([
  // python-report: stdout-as-markdown payloads (no compose_app template —
  // these slugs are stamped by the report-shape detector).
  ['python-report', 'python-report'],
  ['markdown-report', 'python-report'],
  ['analysis-report', 'python-report'],
  ['cost-report', 'python-report'],
  ['audit-report', 'python-report'],
  // react-app: compose_app iframe via AppRenderer.
  ['compose_app', 'react-app'],
  ['react-app', 'react-app'],
  ['cloud-cost-dashboard', 'react-app'],
  ['multi-tenant-audit-dashboard', 'react-app'],
  // chart: ECharts/d3 single-figure renderers.
  ['sankey', 'chart'],
  ['cost-sankey-savings', 'chart'],
  ['bar-chart', 'chart'],
  ['line-chart', 'chart'],
  ['pie-chart', 'chart'],
  ['area-chart', 'chart'],
  ['scatter-plot', 'chart'],
  ['traffic-flow-diagram', 'chart'],
  ['aws-cloud-architecture', 'chart'],
  ['k8s-cluster-topology', 'chart'],
  // table: TanStack Table sortable + CSV export.
  ['cost-table', 'table'],
  ['vm-inventory', 'table'],
  ['cloud-run-grid', 'table'],
  ['data-table', 'table'],
  ['savings-card', 'table'],
  // runbook: numbered steps + persistent checkboxes.
  ['runbook', 'runbook'],
  ['runbook-steps', 'runbook'],
  ['cut-checklist', 'runbook'],
  ['multi-region-eks-dashboard', 'runbook'],
  ['build-progress', 'runbook'],
]);

const EXPORTABLE_MIMES: Record<ArtifactKind, ReadonlyArray<string>> = {
  'python-report': ['application/pdf', 'text/markdown'],
  'react-app': ['text/typescript', 'text/tsx'],
  chart: ['image/png', 'image/svg+xml', 'application/json'],
  table: ['text/csv', 'application/json'],
  runbook: ['text/markdown', 'application/pdf'],
  unknown: [],
};

export function classifyArtifact(outputTemplate: string | undefined | null): ArtifactKind {
  if (!outputTemplate) return 'unknown';
  const slug = outputTemplate.toLowerCase().trim();
  if (!slug) return 'unknown';
  return KIND_BY_SLUG.get(slug) ?? 'unknown';
}

export function exportableMimesFor(kind: ArtifactKind): ReadonlyArray<string> {
  return EXPORTABLE_MIMES[kind];
}

// Back-compat aggregate export — keep until callers migrate to the named
// functions above. Will be ripped after Phase D2 wires through dispatchTool.
export const ArtifactRegistry = {
  classify: classifyArtifact,
  exportableMimes: exportableMimesFor,
} as const;

// Internal escape hatch for the arch test that diffs slug coverage against
// the compose_app template registry.
export const _SLUG_COVERAGE_FOR_TESTS: ReadonlyMap<string, ArtifactKind> = KIND_BY_SLUG;
