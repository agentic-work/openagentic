/**
 * FrameRendererRegistry — Phase 4 / Task 4.5.
 *
 * Maps `_meta.outputTemplate` slug → React component for tool-result
 * rendering. UI's `useChatStream` tool_result reducer arm reads
 * `_meta.outputTemplate` from the NDJSON envelope and looks up the
 * concrete component here. Unknown templates fall back to a
 * `StreamingMarkdown` placeholder that simply renders the
 * `structuredContent.summary`.
 *
 * Template→component mapping per Spec §6.3. Phase 11 added DcMap, Gate,
 * Gap, VizHead — see Phase 11 section below. Still deferred:
 * `architecture_diagram` (compose_app variant) and `sankey_cost`
 * (compose_visual variant) — these are widget-renderer surfaces, not
 * primitives, and route through WidgetRenderer instead of this registry.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §6.3
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 4, Task 4.5.
 */

import type { ComponentType } from 'react';
import { UnknownVizFallback } from './UnknownVizFallback.js';

import { StreamingTable } from './StreamingTable.js';
import { Findings } from './Findings.js';
import { SavingsCard } from './SavingsCard.js';
import { KpiGrid } from './KpiGrid.js';
import { Runbook } from './Runbook.js';
import { WaveTimeline } from './WaveTimeline.js';
import { AgentTree } from './AgentTree.js';
import { StackGrid } from './StackGrid.js';
import { DcMap } from './DcMap.js';
import { Gate } from './Gate.js';
import { Gap } from './Gap.js';
import { VizHead } from './VizHead.js';
import { SankeyRenderer } from './templates/SankeyRenderer.js';
import { BuildProgressRenderer } from './templates/BuildProgressRenderer.js';
import { CloudRunGridRenderer } from './templates/CloudRunGridRenderer.js';
import { MultiRegionEksDashboardRenderer } from './templates/MultiRegionEksDashboardRenderer.js';
import { SavingsGridRenderer } from './templates/SavingsGridRenderer.js';
import { IncidentTimelineRenderer } from './templates/IncidentTimelineRenderer.js';
import { LatencyHeatmapRenderer } from './templates/LatencyHeatmapRenderer.js';
import { IncidentCardRenderer } from './templates/IncidentCardRenderer.js';
import { ComplianceDashboardRenderer } from './templates/ComplianceDashboardRenderer.js';
import { RemediationPlanRenderer } from './templates/RemediationPlanRenderer.js';
import { MigrationPlanRenderer } from './templates/MigrationPlanRenderer.js';
import { DependencyGraphRenderer } from './templates/DependencyGraphRenderer.js';
import { FlamegraphRenderer } from './templates/FlamegraphRenderer.js';
import { RootCauseCardRenderer } from './templates/RootCauseCardRenderer.js';
import { PermissionMatrixRenderer } from './templates/PermissionMatrixRenderer.js';
import { RiskScoreCardRenderer } from './templates/RiskScoreCardRenderer.js';
import { ClusterInventoryRenderer } from './templates/ClusterInventoryRenderer.js';
import { VersionMatrixRenderer } from './templates/VersionMatrixRenderer.js';
import { BreakingChangesListRenderer } from './templates/BreakingChangesListRenderer.js';
import { LogAnomalyChartRenderer } from './templates/LogAnomalyChartRenderer.js';
import { RotationCalendarRenderer } from './templates/RotationCalendarRenderer.js';
import { RiskPriorityQueueRenderer } from './templates/RiskPriorityQueueRenderer.js';
import { TrainingRunsDashboardRenderer } from './templates/TrainingRunsDashboardRenderer.js';
import { GpuUtilizationChartRenderer } from './templates/GpuUtilizationChartRenderer.js';
import { AwChartRenderer } from './templates/AwChartRenderer.js';
import { makeGenericTemplate } from './templates/GenericTemplate.js';

/**
 * Fallback renderer for unknown / unmapped outputTemplates.
 *
 * Phase 11 replaces this stub with the real `StreamingMarkdown` component
 * (which renders `structuredContent.summary` through SharedMarkdownRenderer).
 * The displayName is the contract the registry's lookup-fallback test pins.
 *
 * Sprint Z.7: when a NAMED (non-undefined) slug is unknown, `lookup()` returns
 * `UnknownVizFallback` (see UnknownVizFallback.tsx) instead of this stub.
 * `UnknownVizFallback` renders a visible "unknown viz: <slug>" warning pill
 * and fires console.warn. `StreamingMarkdownFallback` is still returned for
 * undefined/null templates.
 */
function StreamingMarkdownFallback(_props: unknown) {
  return null;
}
StreamingMarkdownFallback.displayName = 'StreamingMarkdown';

/**
 * The registry table. Mutable via `register()` so feature flags or
 * downstream extensions (e.g. customer-specific outputTemplates in
 * openagentic-your-deployment) can override entries at boot.
 */
const registry: Record<string, ComponentType<any>> = {
  // ── Tabular ────────────────────────────────────────────────────────
  azure_vm_list: StreamingTable,
  k8s_pod_list: StreamingTable,
  streaming_table: StreamingTable,

  // ── Findings (severity / compliance variants) ──────────────────────
  findings_severity: Findings,
  compliance_gap: Findings,

  // ── Single-card metrics ────────────────────────────────────────────
  cost_savings: SavingsCard,
  kpi_grid: KpiGrid,

  // ── Multi-step / timeline ──────────────────────────────────────────
  runbook_steps: Runbook,
  wave_timeline: WaveTimeline,

  // ── Trees / grids ──────────────────────────────────────────────────
  agent_tree: AgentTree,
  stack_grid: StackGrid,

  // ── Phase 11 primitives ────────────────────────────────────────────
  dc_map: DcMap,
  gate: Gate,
  gap_list: Gap,
  viz_head: VizHead,

  // ── Phase A2 mock-format templates (compose_visual / compose_app) ──
  // Slugs intentionally use hyphens to match the wire-format slugs
  // emitted by api's compose_visual / compose_app meta-tools (see
  // mock contract JSONs in mocks/UX/AI/Chatmode/end-state-*.contract.json).
  sankey: SankeyRenderer,
  'build-progress': BuildProgressRenderer,
  'cloud-run-grid': CloudRunGridRenderer,
  'multi-region-eks-dashboard': MultiRegionEksDashboardRenderer,

  // ── Phase 7 mocks-parity batch — polished React renderers replace
  // makeGenericTemplate fallbacks (mocks 07..16). Each component owns
  // its own zod-style defensive prop shape and falls back to a minimal
  // "no data" placeholder when the payload is missing/malformed.
  savings_grid: SavingsGridRenderer,
  incident_timeline: IncidentTimelineRenderer,
  latency_heatmap: LatencyHeatmapRenderer,
  incident_card: IncidentCardRenderer,
  compliance_dashboard: ComplianceDashboardRenderer,
  remediation_plan: RemediationPlanRenderer,
  migration_plan: MigrationPlanRenderer,
  dependency_graph: DependencyGraphRenderer,
  flamegraph: FlamegraphRenderer,
  root_cause_card: RootCauseCardRenderer,
  permission_matrix: PermissionMatrixRenderer,
  risk_score_card: RiskScoreCardRenderer,
  cluster_inventory: ClusterInventoryRenderer,
  version_matrix: VersionMatrixRenderer,
  breaking_changes_list: BreakingChangesListRenderer,
  log_anomaly_chart: LogAnomalyChartRenderer,
  rotation_calendar: RotationCalendarRenderer,
  risk_priority_queue: RiskPriorityQueueRenderer,
  training_runs_dashboard: TrainingRunsDashboardRenderer,
  gpu_utilization_chart: GpuUtilizationChartRenderer,

  // ── 2026-05-13 shared chart library (src/lib/charts/) ─────────────
  // One slot, 14 templates. compose_visual emits { _meta.outputTemplate:
  // 'awchart' } and the inner `template` (sankey/line/bar/donut/network/
  // ...) lives in the structured payload. See AwChartRenderer + ChartArtifact.
  // This is also the path admin uses for any chart rendered through the
  // tool-result wire format (e.g. when compose_visual is the source).
  awchart: AwChartRenderer,
};

// Keep makeGenericTemplate import referenced for future fallbacks /
// downstream forks; the registry can call it at runtime via register().
void makeGenericTemplate;

export const FrameRendererRegistry = {
  /**
   * Look up the component for a given template slug.
   *
   * - undefined/null/empty → returns StreamingMarkdownFallback silently.
   * - known slug → returns the registered component.
   * - unknown NON-EMPTY slug → fires console.warn with the slug + all
   *   registered slugs for easy debugging, then returns UnknownVizFallback
   *   so the user sees "unknown viz: <slug>" rather than empty output.
   *   Sprint Z.7.
   */
  lookup(template?: string): ComponentType<any> {
    if (!template) return StreamingMarkdownFallback;
    const component = registry[template];
    if (component) return component;
    // Unknown named slug — warn and return visible error component.
    console.warn(
      `[FrameRendererRegistry] Unknown outputTemplate: "${template}". ` +
      `Available slugs: ${Object.keys(registry).join(', ')}`,
      { unknownSlug: template, available: Object.keys(registry) },
    );
    return UnknownVizFallback;
  },

  /** True iff a concrete (non-fallback) component is registered. */
  has(template: string): boolean {
    return template in registry;
  },

  /**
   * Register / override a template→component mapping at runtime. Used by
   * Phase 11 to wire late-arriving primitives (DcMap, Gate, Gap, etc.)
   * without re-importing this module everywhere.
   */
  register(template: string, component: ComponentType<any>): void {
    registry[template] = component;
  },
};
