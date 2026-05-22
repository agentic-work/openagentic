/**
 * #502 P0 mock-parity rebuild — inline_widget primitive reducer.
 *
 * One unified NDJSON frame `inline_widget` carries a discriminated union
 * over the v2 primitives that aren't already wired through dedicated
 * frames (StreamingTable / Findings / WidgetRenderer / AppRenderer):
 *
 *   inline_widget:
 *     {
 *       type: 'inline_widget',
 *       artifact_id: string,                      // React key + hot-swap
 *       kind:
 *         | 'kpi_grid'        // mock 02:124-152 metric tiles
 *         | 'savings_card'    // mock 01:466-496 savings summary
 *         | 'stages_strip'    // multi-stage progress
 *         | 'wave_timeline'   // mocks 06/08 wave bars
 *         | 'runbook'         // mocks 04/05/08 step list
 *         | 'stack_grid'      // mock 09 tech stack grid
 *         | 'annotated_code', // mocks 03/07 code highlights
 *       title?: string,
 *       data: <kind-specific payload>,
 *     }
 *
 * Each `data` payload mirrors the corresponding v2 primitive's prop
 * shape (KpiTile[], SavingsCardCell[], StageItem[],
 * { rows: WaveRow[] }, { steps: RunbookStep[]; budget?: string },
 * StackLayer[], { lines: string[]; annotatedLines: number[]; language?: string }).
 *
 * Reducer invariants:
 *   - empty messageId  → drop
 *   - empty artifact_id → drop
 *   - unknown kind     → drop (defense in depth)
 *   - matching artifact_id → hot-swap in place
 *   - distinct artifact_id → append
 *   - per-message map; other messageIds untouched
 */

import { describe, it, expect } from 'vitest';
import {
  applyInlineWidgetFrame,
  type InlineWidget,
  type InlineWidgetFrame,
} from '../useChatStream';

const kpiFrame = (overrides: Partial<InlineWidgetFrame> = {}): InlineWidgetFrame => ({
  type: 'inline_widget',
  artifact_id: 'kpi-1',
  kind: 'kpi_grid',
  title: 'Cluster health',
  data: {
    tiles: [
      { title: 'Cluster CPU', value: '73%', delta: '+12% vs 1h', deltaTone: 'r', severity: 'warn' },
      { title: 'Pods Ready', value: '142/148', deltaTone: 'n' },
      { title: 'Latency p95', value: '218ms', delta: '-4%', deltaTone: 'g', severity: 'ok' },
    ],
  },
  ...overrides,
});

const savingsFrame = (): InlineWidgetFrame => ({
  type: 'inline_widget',
  artifact_id: 'sav-1',
  kind: 'savings_card',
  title: 'Right-sizing impact',
  data: {
    cells: [
      { label: 'Monthly savings', value: '$2,847', suffix: '.12', tone: 'g' },
      { label: 'Annual savings', value: '$34,165' },
      { label: 'Risk', value: '0', suffix: 'high', tone: 'n' },
    ],
  },
});

const runbookFrame = (): InlineWidgetFrame => ({
  type: 'inline_widget',
  artifact_id: 'rb-1',
  kind: 'runbook',
  title: 'Failover playbook',
  data: {
    budget: '15min budget · 12min actual',
    steps: [
      { tag: 'T+0', title: 'Detect', body: 'Pager fires on p95 > 500ms', owner: 'oncall', duration: '0:15', severity: 'warn' },
      { tag: 'T+1', title: 'Drain', body: 'Drain primary AZ', owner: 'sre', duration: '4:30' },
    ],
  },
});

describe('applyInlineWidgetFrame — #502 unified inline-widget reducer', () => {
  it('appends a kpi_grid widget under the active messageId', () => {
    const next = applyInlineWidgetFrame({}, 'msg-1', kpiFrame());
    expect(next['msg-1']).toBeDefined();
    expect(next['msg-1']).toHaveLength(1);
    expect(next['msg-1'][0].kind).toBe('kpi_grid');
    expect(next['msg-1'][0].artifactId).toBe('kpi-1');
    expect(next['msg-1'][0].title).toBe('Cluster health');
  });

  it('does not mutate the input map', () => {
    const before: Record<string, InlineWidget[]> = {};
    const next = applyInlineWidgetFrame(before, 'msg-1', kpiFrame());
    expect(next).not.toBe(before);
    expect(before['msg-1']).toBeUndefined();
  });

  it('appends a savings_card widget alongside the kpi_grid (different artifact_id)', () => {
    let m: Record<string, InlineWidget[]> = {};
    m = applyInlineWidgetFrame(m, 'msg-1', kpiFrame());
    m = applyInlineWidgetFrame(m, 'msg-1', savingsFrame());
    expect(m['msg-1']).toHaveLength(2);
    expect(m['msg-1'][0].kind).toBe('kpi_grid');
    expect(m['msg-1'][1].kind).toBe('savings_card');
  });

  it('hot-swaps an existing widget when artifact_id matches (same kind)', () => {
    let m: Record<string, InlineWidget[]> = {};
    m = applyInlineWidgetFrame(m, 'msg-1', kpiFrame());
    m = applyInlineWidgetFrame(m, 'msg-1', kpiFrame({
      data: { tiles: [{ title: 'Updated', value: '99%' }] },
    }));
    expect(m['msg-1']).toHaveLength(1);
    expect((m['msg-1'][0].data as { tiles: Array<{ title: string }> }).tiles).toHaveLength(1);
    expect((m['msg-1'][0].data as { tiles: Array<{ title: string }> }).tiles[0].title).toBe('Updated');
  });

  it('preserves a runbook widget data shape (steps + budget)', () => {
    const next = applyInlineWidgetFrame({}, 'msg-1', runbookFrame());
    const w = next['msg-1'][0];
    expect(w.kind).toBe('runbook');
    const data = w.data as { budget?: string; steps: Array<{ tag: string }> };
    expect(data.budget).toBe('15min budget · 12min actual');
    expect(data.steps).toHaveLength(2);
    expect(data.steps[0].tag).toBe('T+0');
  });

  it('drops frames silently when messageId is empty', () => {
    const next = applyInlineWidgetFrame({}, '', kpiFrame());
    expect(Object.keys(next)).toHaveLength(0);
  });

  it('drops frames silently when artifact_id is empty', () => {
    const next = applyInlineWidgetFrame({}, 'msg-1', kpiFrame({ artifact_id: '' }));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('drops frames silently for unknown kinds (defense in depth)', () => {
    const next = applyInlineWidgetFrame({}, 'msg-1', kpiFrame({
      // intentional: unknown kind through the wire
      kind: 'mystery_box' as InlineWidgetFrame['kind'],
    }));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('keeps widgets for other messageIds untouched', () => {
    let m: Record<string, InlineWidget[]> = {};
    m = applyInlineWidgetFrame(m, 'msg-1', kpiFrame({ artifact_id: 'k-1' }));
    m = applyInlineWidgetFrame(m, 'msg-2', savingsFrame());
    expect(m['msg-1'][0].artifactId).toBe('k-1');
    expect(m['msg-2'][0].artifactId).toBe('sav-1');
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-2']).toHaveLength(1);
  });

  it('rejects malformed kpi_grid (missing tiles array) silently', () => {
    const next = applyInlineWidgetFrame({}, 'msg-1', kpiFrame({
      data: { notTiles: 'oops' } as unknown as InlineWidgetFrame['data'],
    }));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('rejects malformed savings_card (missing cells array) silently', () => {
    const next = applyInlineWidgetFrame({}, 'msg-1', {
      type: 'inline_widget',
      artifact_id: 'sav-bad',
      kind: 'savings_card',
      data: {} as unknown as InlineWidgetFrame['data'],
    });
    expect((next['msg-1'] ?? []).length).toBe(0);
  });
});
