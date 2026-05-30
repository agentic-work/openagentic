/**
 * P1-6 of chatmode UX parity — streaming-table primitive (mock 01:385-462).
 *
 * Wire shape (snake_case on the wire, camelCase in the reducer state):
 *
 *   streaming_table:
 *     {
 *       type: 'streaming_table',
 *       artifact_id: string,         // required — used as React key + for hot-swap
 *       title: string,
 *       count_text?: string,
 *       columns: Array<{ key, label, align?, cell_class? }>,
 *       rows: Array<Record<string, string | SevCell>>,
 *     }
 *
 * Mock anatomy: `.streaming-table` with `.tt-hdr` (icon + title + .tt-count),
 * a regular `<table>` inside, with `.mono` / `.tnum` cell classes and a
 * `<span class="sev sev-ok|sev-warn|sev-err">…</span>` for severity pills.
 *
 * Mirrors `applyAppRenderFrame` (commit-by-artifact append + hot-swap by
 * group/artifact id). Keyed by the active assistant messageId.
 */

import { describe, it, expect } from 'vitest';
import {
  applyStreamingTableFrame,
  type StreamingTable,
  type StreamingTableFrame,
} from '../useChatStream';

const sampleFrame = (overrides: Partial<StreamingTableFrame> = {}): StreamingTableFrame => ({
  type: 'streaming_table',
  artifact_id: 'tbl-1',
  title: 'Right-sizing candidates',
  count_text: '17 analysed · 8 oversized',
  columns: [
    { key: 'vmName', label: 'VM name', cell_class: 'mono' },
    { key: 'cpu', label: 'Avg CPU %', align: 'right', cell_class: 'tnum' },
    { key: 'rec', label: 'Recommendation' },
  ],
  rows: [
    { vmName: 'vm-api-blue-01', cpu: '6.1', rec: { kind: 'sev', value: 'D4s_v5', severity: 'warn' } },
    { vmName: 'vm-redis-cache-01', cpu: '2.1', rec: { kind: 'sev', value: 'E2s_v5', severity: 'err' } },
    { vmName: 'vm-grafana-01', cpu: '8.3', rec: { kind: 'sev', value: 'keep', severity: 'ok' } },
  ],
  ...overrides,
});

describe('applyStreamingTableFrame — P1-6 streaming-table reducer', () => {
  it('appends a new table under the active messageId', () => {
    const before: Record<string, StreamingTable[]> = {};
    const next = applyStreamingTableFrame(before, 'msg-1', sampleFrame());
    expect(next['msg-1']).toBeDefined();
    expect(next['msg-1']).toHaveLength(1);
    expect(next['msg-1'][0]).toMatchObject({
      artifactId: 'tbl-1',
      title: 'Right-sizing candidates',
      countText: '17 analysed · 8 oversized',
    });
    expect(next['msg-1'][0].columns).toHaveLength(3);
    expect(next['msg-1'][0].rows).toHaveLength(3);
  });

  it('does not mutate the input map (returns a new object)', () => {
    const before: Record<string, StreamingTable[]> = {};
    const next = applyStreamingTableFrame(before, 'msg-1', sampleFrame());
    expect(next).not.toBe(before);
    expect(before['msg-1']).toBeUndefined();
  });

  it('hot-swaps an existing table by artifact_id (in place by index)', () => {
    let m: Record<string, StreamingTable[]> = {};
    m = applyStreamingTableFrame(m, 'msg-1', sampleFrame({ rows: [{ vmName: 'a' }] }));
    m = applyStreamingTableFrame(m, 'msg-1', sampleFrame({
      rows: [{ vmName: 'a' }, { vmName: 'b' }, { vmName: 'c' }],
    }));
    expect(m['msg-1']).toHaveLength(1);
    expect(m['msg-1'][0].rows).toHaveLength(3);
  });

  it('appends a second table under the same messageId when artifact_id differs', () => {
    let m: Record<string, StreamingTable[]> = {};
    m = applyStreamingTableFrame(m, 'msg-1', sampleFrame({ artifact_id: 'tbl-1' }));
    m = applyStreamingTableFrame(m, 'msg-1', sampleFrame({ artifact_id: 'tbl-2', title: 'Cost summary' }));
    expect(m['msg-1']).toHaveLength(2);
    expect(m['msg-1'][0].artifactId).toBe('tbl-1');
    expect(m['msg-1'][1].artifactId).toBe('tbl-2');
  });

  it('keeps tables for other messageIds untouched', () => {
    let m: Record<string, StreamingTable[]> = {};
    m = applyStreamingTableFrame(m, 'msg-1', sampleFrame({ artifact_id: 'tbl-1' }));
    m = applyStreamingTableFrame(m, 'msg-2', sampleFrame({ artifact_id: 'tbl-99' }));
    expect(m['msg-1'][0].artifactId).toBe('tbl-1');
    expect(m['msg-2'][0].artifactId).toBe('tbl-99');
  });

  it('drops the frame silently when messageId is empty (defensive)', () => {
    const before: Record<string, StreamingTable[]> = {};
    const next = applyStreamingTableFrame(before, '', sampleFrame());
    expect(Object.keys(next)).toHaveLength(0);
  });

  it('drops the frame silently when artifact_id is empty', () => {
    const before: Record<string, StreamingTable[]> = {};
    const next = applyStreamingTableFrame(before, 'msg-1', sampleFrame({ artifact_id: '' }));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('drops the frame silently when columns is empty (no useful render possible)', () => {
    const before: Record<string, StreamingTable[]> = {};
    const next = applyStreamingTableFrame(before, 'msg-1', sampleFrame({ columns: [] }));
    expect((next['msg-1'] ?? []).length).toBe(0);
  });

  it('preserves cell-class + align on each column (consumer needs both)', () => {
    const next = applyStreamingTableFrame({}, 'msg-1', sampleFrame());
    expect(next['msg-1'][0].columns[0]).toMatchObject({ key: 'vmName', label: 'VM name', cellClass: 'mono' });
    expect(next['msg-1'][0].columns[1]).toMatchObject({ key: 'cpu', label: 'Avg CPU %', align: 'right', cellClass: 'tnum' });
  });

  it('preserves sev cells with their severity tag (component drives the .sev-ok|warn|err class)', () => {
    const next = applyStreamingTableFrame({}, 'msg-1', sampleFrame());
    const row0 = next['msg-1'][0].rows[0];
    expect(row0.rec).toEqual({ kind: 'sev', value: 'D4s_v5', severity: 'warn' });
  });

  it('coerces missing count_text to undefined (header still renders title-only)', () => {
    const next = applyStreamingTableFrame({}, 'msg-1', sampleFrame({ count_text: undefined }));
    expect(next['msg-1'][0].countText).toBeUndefined();
  });
});
