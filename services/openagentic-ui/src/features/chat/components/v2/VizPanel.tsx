/**
 * VizPanel — unified .viz / .viz-head wrapper for FrameRendererRegistry frames.
 *
 * Sprint Z.5: every renderer dispatched from FrameRendererRegistry is wrapped
 * in this component so the output always has the mock-SoT chrome:
 *
 *   <div class="viz">
 *     <div class="viz-head">
 *       <div class="ico">📊</div>
 *       <span class="name">compose_visual</span>
 *       <span class="badge">sankey</span>
 *       <span class="caption">…optional subtitle…</span>
 *       <span class="timer">2.84s</span>  <!-- right-aligned -->
 *     </div>
 *     <!-- registered renderer output -->
 *   </div>
 *
 * Mock SoT: mocks/UX/AI/Chatmode/end-state-07-tri-cloud-cost-spikes.html §114-121.
 * CSS: chatmode-v2.css → .viz / .viz-head / .viz-head .{ico,name,badge,caption,timer}
 *
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase Z, Task Z.5
 */

import React from 'react';

/** Emoji icon mapped from common template slugs. Falls back to 📊 for unknowns. */
const SLUG_ICO: Record<string, string> = {
  sankey: '📊',
  'build-progress': '🔨',
  'cloud-run-grid': '☁',
  'multi-region-eks-dashboard': '⚓',
  savings_grid: '✂',
  incident_timeline: '⏱',
  latency_heatmap: '🌡',
  incident_card: '🚨',
  compliance_dashboard: '🛡',
  remediation_plan: '🔧',
  migration_plan: '🚀',
  dependency_graph: '🕸',
  flamegraph: '🔥',
  root_cause_card: '🔍',
  permission_matrix: '🔐',
  risk_score_card: '⚠',
  cluster_inventory: '🗄',
  version_matrix: '📋',
  breaking_changes_list: '💥',
  log_anomaly_chart: '📈',
  rotation_calendar: '📅',
  risk_priority_queue: '🎯',
  training_runs_dashboard: '🧪',
  gpu_utilization_chart: '🖥',
  awchart: '📊',
  azure_vm_list: '☁',
  k8s_pod_list: '⚓',
  streaming_table: '📋',
  findings_severity: '🔍',
  compliance_gap: '🛡',
  cost_savings: '✂',
  kpi_grid: '📊',
  runbook_steps: '📋',
  wave_timeline: '⏱',
  agent_tree: '🌲',
  stack_grid: '🗄',
  dc_map: '🗺',
  gate: '🚧',
  gap_list: '📋',
  viz_head: '📊',
};

function slugToIco(slug: string): string {
  return SLUG_ICO[slug] ?? '📊';
}

export interface VizPanelProps {
  /** The outputTemplate slug (e.g. "sankey", "savings_grid"). */
  slug: string;
  /** The display title — usually the tool name ("compose_visual", "compose_app"). */
  title: string;
  /** Optional subtitle / caption shown in grey below the badge. */
  caption?: string;
  /** Optional elapsed time label ("2.84s", "streaming…"). */
  timer?: string;
  /** The rendered frame content. */
  children: React.ReactNode;
}

export function VizPanel({ slug, title, caption, timer, children }: VizPanelProps) {
  return (
    <div className="viz" data-testid="viz-panel" data-viz-slug={slug}>
      <div className="viz-head">
        <div className="ico" aria-hidden>
          {slugToIco(slug)}
        </div>
        <span className="name">{title}</span>
        <span className="badge">{slug}</span>
        {caption && <span className="caption">{caption}</span>}
        {timer && <span className="timer">{timer}</span>}
      </div>
      {children}
    </div>
  );
}
