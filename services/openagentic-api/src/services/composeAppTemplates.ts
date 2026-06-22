/**
 * compose_app template registry.
 *
 * the design notes
 *
 * Mirrors the shape of `compose_visual.templates` — model picks a slug +
 * supplies typed params, server hydrates the HTML deterministically. Every
 * payload still flows through `composeAppValidator` + `CdnAllowList` + the
 * iframe srcdoc CSP — templates are NOT a privilege escalation, they're a
 * quality-floor convenience.
 *
 * Adding a template:
 *   1. Drop a new file in `composeAppTemplates/<slug>.template.ts` exporting
 *      a `ComposeAppTemplate`.
 *   2. Import it here and append to COMPOSE_APP_TEMPLATES.
 *   3. Add a vitest case in __tests__/composeAppTemplates.test.ts (the
 *      generic loop will pick it up automatically once it's in the array).
 */

import type { ZodSchema } from 'zod';

import { AWS_CLOUD_ARCHITECTURE_TEMPLATE } from './composeAppTemplates/aws-cloud-architecture.template.js';
import { K8S_CLUSTER_TOPOLOGY_TEMPLATE } from './composeAppTemplates/k8s-cluster-topology.template.js';
import { COST_SANKEY_SAVINGS_TEMPLATE } from './composeAppTemplates/cost-sankey-savings.template.js';
import { MULTI_TENANT_AUDIT_DASHBOARD_TEMPLATE } from './composeAppTemplates/multi-tenant-audit-dashboard.template.js';
import { TRAFFIC_FLOW_DIAGRAM_TEMPLATE } from './composeAppTemplates/traffic-flow-diagram.template.js';
import { CLOUD_RUN_GRID_TEMPLATE } from './composeAppTemplates/cloud-run-grid.template.js';
import { BUILD_PROGRESS_TEMPLATE } from './composeAppTemplates/build-progress.template.js';
import { MULTI_REGION_EKS_DASHBOARD_TEMPLATE } from './composeAppTemplates/multi-region-eks-dashboard.template.js';
import { RUNBOOK_TEMPLATE } from './composeAppTemplates/runbook.template.js';
// #655 — generic chart primitives (bar/line/pie). Domain-specific
// templates above are still preferred when one fits; these handle the
// long tail "render a bar chart" / "show a line chart" asks where the
// model would otherwise pick a non-existent slug.
import { BAR_CHART_TEMPLATE } from './composeAppTemplates/bar-chart.template.js';
import { LINE_CHART_TEMPLATE } from './composeAppTemplates/line-chart.template.js';
import { PIE_CHART_TEMPLATE } from './composeAppTemplates/pie-chart.template.js';
// Phase 6 — mocks-parity templates landing as the biggest single unlock
// per the design notes.
import { SAVINGS_GRID_TEMPLATE } from './composeAppTemplates/savings-grid.template.js';
import { INCIDENT_TIMELINE_TEMPLATE } from './composeAppTemplates/incident-timeline.template.js';
import { LATENCY_HEATMAP_TEMPLATE } from './composeAppTemplates/latency-heatmap.template.js';
import { INCIDENT_CARD_TEMPLATE } from './composeAppTemplates/incident-card.template.js';
import { COMPLIANCE_DASHBOARD_TEMPLATE } from './composeAppTemplates/compliance-dashboard.template.js';
import { REMEDIATION_PLAN_TEMPLATE } from './composeAppTemplates/remediation-plan.template.js';
import { MIGRATION_PLAN_TEMPLATE } from './composeAppTemplates/migration-plan.template.js';
import { DEPENDENCY_GRAPH_TEMPLATE } from './composeAppTemplates/dependency-graph.template.js';
import { FLAMEGRAPH_TEMPLATE } from './composeAppTemplates/flamegraph.template.js';
import { ROOT_CAUSE_CARD_TEMPLATE } from './composeAppTemplates/root-cause-card.template.js';
import { PERMISSION_MATRIX_TEMPLATE } from './composeAppTemplates/permission-matrix.template.js';
import { RISK_SCORE_CARD_TEMPLATE } from './composeAppTemplates/risk-score-card.template.js';
import { CLUSTER_INVENTORY_TEMPLATE } from './composeAppTemplates/cluster-inventory.template.js';
import { VERSION_MATRIX_TEMPLATE } from './composeAppTemplates/version-matrix.template.js';
import { BREAKING_CHANGES_LIST_TEMPLATE } from './composeAppTemplates/breaking-changes-list.template.js';
import { LOG_ANOMALY_CHART_TEMPLATE } from './composeAppTemplates/log-anomaly-chart.template.js';
import { ROTATION_CALENDAR_TEMPLATE } from './composeAppTemplates/rotation-calendar.template.js';
import { RISK_PRIORITY_QUEUE_TEMPLATE } from './composeAppTemplates/risk-priority-queue.template.js';
import { TRAINING_RUNS_DASHBOARD_TEMPLATE } from './composeAppTemplates/training-runs-dashboard.template.js';
import { GPU_UTILIZATION_CHART_TEMPLATE } from './composeAppTemplates/gpu-utilization-chart.template.js';

export interface ComposeAppTemplate {
  /** Stable identifier used by the model (e.g. 'aws-cloud-architecture'). */
  slug: string;
  /** Human-readable title — also used as default app title if none provided. */
  title: string;
  /** Model-facing usage hint. Surfaced in the prompt module body. */
  description: string;
  /** Zod schema for `params` validation. Must reject `{}` for required-input
   *  templates so the server can return a structured error rather than render
   *  an empty UI. */
  paramsSchema: ZodSchema;
  /** Pure function: validated params → full self-contained HTML document.
   *  Implementations must call `paramsSchema.parse(raw)` themselves so the
   *  parsed shape is the only thing they consume. */
  htmlTemplate: (params: unknown) => string;
  /** Same-origin /api/cdn/lib/* URLs the template imports. Audited so the
   *  registry-level test catalog matches reality. */
  cdnLibs: string[];
  /** Deterministic example for tests + docs. Must satisfy `paramsSchema`. */
  exampleParams: unknown;
}

export const COMPOSE_APP_TEMPLATES: ComposeAppTemplate[] = [
  AWS_CLOUD_ARCHITECTURE_TEMPLATE,
  K8S_CLUSTER_TOPOLOGY_TEMPLATE,
  COST_SANKEY_SAVINGS_TEMPLATE,
  MULTI_TENANT_AUDIT_DASHBOARD_TEMPLATE,
  TRAFFIC_FLOW_DIAGRAM_TEMPLATE,
  CLOUD_RUN_GRID_TEMPLATE,
  BUILD_PROGRESS_TEMPLATE,
  MULTI_REGION_EKS_DASHBOARD_TEMPLATE,
  RUNBOOK_TEMPLATE,
  // #655 — generic chart primitives.
  BAR_CHART_TEMPLATE,
  LINE_CHART_TEMPLATE,
  PIE_CHART_TEMPLATE,
  // Phase 6 mocks-parity templates (the design notes).
  SAVINGS_GRID_TEMPLATE,
  INCIDENT_TIMELINE_TEMPLATE,
  LATENCY_HEATMAP_TEMPLATE,
  INCIDENT_CARD_TEMPLATE,
  COMPLIANCE_DASHBOARD_TEMPLATE,
  REMEDIATION_PLAN_TEMPLATE,
  MIGRATION_PLAN_TEMPLATE,
  DEPENDENCY_GRAPH_TEMPLATE,
  FLAMEGRAPH_TEMPLATE,
  ROOT_CAUSE_CARD_TEMPLATE,
  PERMISSION_MATRIX_TEMPLATE,
  RISK_SCORE_CARD_TEMPLATE,
  CLUSTER_INVENTORY_TEMPLATE,
  VERSION_MATRIX_TEMPLATE,
  BREAKING_CHANGES_LIST_TEMPLATE,
  LOG_ANOMALY_CHART_TEMPLATE,
  ROTATION_CALENDAR_TEMPLATE,
  RISK_PRIORITY_QUEUE_TEMPLATE,
  TRAINING_RUNS_DASHBOARD_TEMPLATE,
  GPU_UTILIZATION_CHART_TEMPLATE,
];

const SLUG_INDEX: Map<string, ComposeAppTemplate> = new Map(
  COMPOSE_APP_TEMPLATES.map((t) => [t.slug, t]),
);

/**
 * Phase 6 — accept the audit's underscored slug forms as aliases of the
 * canonical hyphenated slugs (which is what the test regex
 * `^[a-z][a-z0-9-]*$` enforces and what the registry actually stores).
 * The model is naturally inclined to emit underscores following the
 * audit's wording (e.g. `savings_grid`); we translate transparently.
 *
 * Build-time: derived from the hyphenated slug by `_`/`-` swap. We list
 * only the slugs where this distinction is needed (everything that uses
 * a hyphen).
 */
function underscoreAlias(slug: string): string {
  return slug.replaceAll('-', '_');
}

const ALIAS_INDEX: Map<string, ComposeAppTemplate> = new Map(
  COMPOSE_APP_TEMPLATES
    .filter((t) => t.slug.includes('-'))
    .map((t) => [underscoreAlias(t.slug), t]),
);

export function findTemplate(slug: string | undefined | null): ComposeAppTemplate | undefined {
  if (!slug) return undefined;
  return SLUG_INDEX.get(slug) ?? ALIAS_INDEX.get(slug);
}

export function listTemplateSlugs(): string[] {
  return COMPOSE_APP_TEMPLATES.map((t) => t.slug);
}
