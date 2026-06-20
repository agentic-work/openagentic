/**
 * Phase 4 / Task 4.5 — FrameRendererRegistry (RED → GREEN).
 *
 * Maps `_meta.outputTemplate` slug → React component for tool-result
 * rendering. UI's useChatStream tool_result reducer arm reads the
 * outputTemplate and looks up the component here.
 *
 * the design notes
 * the design notes
 *       Phase 4, Task 4.5.
 */
import { describe, it, expect, vi } from 'vitest';
import { FrameRendererRegistry } from '../FrameRendererRegistry.js';
import { StreamingTable } from '../StreamingTable.js';
import { Findings } from '../Findings.js';
import { SavingsCard } from '../SavingsCard.js';
import { KpiGrid } from '../KpiGrid.js';
import { Runbook } from '../Runbook.js';
import { WaveTimeline } from '../WaveTimeline.js';
import { AgentTree } from '../AgentTree.js';
import { StackGrid } from '../StackGrid.js';
import { DcMap } from '../DcMap.js';
import { Gate } from '../Gate.js';
import { Gap } from '../Gap.js';
import { VizHead } from '../VizHead.js';
import { SankeyRenderer } from '../templates/SankeyRenderer.js';

describe('FrameRendererRegistry', () => {
  it('maps tabular outputTemplates to StreamingTable', () => {
    expect(FrameRendererRegistry.lookup('azure_vm_list')).toBe(StreamingTable);
    expect(FrameRendererRegistry.lookup('k8s_pod_list')).toBe(StreamingTable);
    expect(FrameRendererRegistry.lookup('streaming_table')).toBe(StreamingTable);
  });

  it('maps findings + compliance_gap to Findings', () => {
    expect(FrameRendererRegistry.lookup('findings_severity')).toBe(Findings);
    expect(FrameRendererRegistry.lookup('compliance_gap')).toBe(Findings);
  });

  it('maps cost_savings to SavingsCard', () => {
    expect(FrameRendererRegistry.lookup('cost_savings')).toBe(SavingsCard);
  });

  it('maps kpi_grid to KpiGrid', () => {
    expect(FrameRendererRegistry.lookup('kpi_grid')).toBe(KpiGrid);
  });

  it('maps runbook_steps to Runbook + wave_timeline to WaveTimeline', () => {
    expect(FrameRendererRegistry.lookup('runbook_steps')).toBe(Runbook);
    expect(FrameRendererRegistry.lookup('wave_timeline')).toBe(WaveTimeline);
  });

  it('maps agent_tree to AgentTree + stack_grid to StackGrid', () => {
    expect(FrameRendererRegistry.lookup('agent_tree')).toBe(AgentTree);
    expect(FrameRendererRegistry.lookup('stack_grid')).toBe(StackGrid);
  });

  it('maps Phase-11 primitives (dc_map / gate / gap_list / viz_head)', () => {
    expect(FrameRendererRegistry.lookup('dc_map')).toBe(DcMap);
    expect(FrameRendererRegistry.lookup('gate')).toBe(Gate);
    expect(FrameRendererRegistry.lookup('gap_list')).toBe(Gap);
    expect(FrameRendererRegistry.lookup('viz_head')).toBe(VizHead);
  });

  it('maps Phase-A2 sankey template', () => {
    expect(FrameRendererRegistry.lookup('sankey')).toBe(SankeyRenderer);
    expect(FrameRendererRegistry.has('sankey')).toBe(true);
  });

  it('falls back to UnknownVizFallback for an unknown NAMED template (Z.7)', () => {
    // Sprint Z.7: named unknown slugs return UnknownVizFallback (visible error pill)
    // rather than StreamingMarkdownFallback (silent null). console.warn is suppressed
    // in tests but would fire in production.
    vi.spyOn(console, 'warn').mockImplementationOnce(() => {});
    const fallback = FrameRendererRegistry.lookup('unknown_template_xyz');
    expect(fallback).toBeDefined();
    expect((fallback as any).displayName).toBe('UnknownVizFallback');
  });

  it('falls back to StreamingMarkdown when template is undefined', () => {
    const fallback = FrameRendererRegistry.lookup(undefined);
    expect((fallback as any).displayName).toBe('StreamingMarkdown');
  });

  it('has() returns true for known + false for unknown', () => {
    expect(FrameRendererRegistry.has('azure_vm_list')).toBe(true);
    expect(FrameRendererRegistry.has('cost_savings')).toBe(true);
    expect(FrameRendererRegistry.has('definitely_not_here')).toBe(false);
  });

  it('register() adds new template at runtime', () => {
    const Custom = () => null;
    (Custom as any).displayName = 'CustomTest';
    FrameRendererRegistry.register('test_custom_runtime', Custom);
    expect(FrameRendererRegistry.lookup('test_custom_runtime')).toBe(Custom);
    expect(FrameRendererRegistry.has('test_custom_runtime')).toBe(true);
  });

  // Audit §10 step 14 — every template slug surfaced in
  // mocks/UX/AI/Chatmode/end-state-07..16.contract.json must resolve
  // to a registered component (currently GenericTemplate for the
  // not-yet-polished slugs; replaced one-at-a-time without changing
  // dispatch). Without this pin, a model emitting any of these slugs
  // would silently drop into the StreamingMarkdown fallback and the UI
  // would render nothing where the mock shows a card/iframe.
  describe('mocks 07..16 template slug coverage', () => {
    const slugs = [
      'sankey',
      'savings_grid',
      'incident_timeline',
      'latency_heatmap',
      'incident_card',
      'compliance_dashboard',
      'remediation_plan',
      'migration_plan',
      'dependency_graph',
      'flamegraph',
      'root_cause_card',
      'permission_matrix',
      'risk_score_card',
      'cluster_inventory',
      'version_matrix',
      'breaking_changes_list',
      'log_anomaly_chart',
      'rotation_calendar',
      'risk_priority_queue',
      'training_runs_dashboard',
      'gpu_utilization_chart',
    ];
    it.each(slugs)('registers slug %s with a non-fallback component', (slug) => {
      expect(FrameRendererRegistry.has(slug)).toBe(true);
      const c = FrameRendererRegistry.lookup(slug);
      expect((c as any).displayName).not.toBe('StreamingMarkdown');
    });
  });
});
