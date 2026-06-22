/**
 * Phase 26 — autoEmitStreamingTable producer tests.
 *
 * Detects when a tool result is an array of homogeneous objects + emits
 * a streaming_table NDJSON frame so the UI's v2/StreamingTable renders
 * the rows inline. Mock 01:385-462 anatomy.
 *
 * Heuristics (no regex on tool name, all data-driven):
 *   - result is Array
 *   - result.length >= 2 AND <= 200
 *   - every element is a plain object with the SAME key set
 *   - >= 2 keys per row
 *
 * On success: emit one streaming_table frame keyed to the tool call id.
 * On reject (any check fails): no-op so prose-only / scalar / mixed
 * shapes don't get tabulated.
 */

import { describe, it, expect, vi } from 'vitest';
import { autoEmitStreamingTable } from '../autoEmitStreamingTable.js';

describe('autoEmitStreamingTable', () => {
  it('emits a streaming_table frame for array of homogeneous objects', () => {
    const writer = vi.fn();
    const fired = autoEmitStreamingTable({
      toolCallId: 'tc-1',
      toolName: 'azure_list_resource_groups',
      result: [
        { name: 'core-api', location: 'eastus2', state: 'Succeeded' },
        { name: 'data', location: 'eastus2', state: 'Succeeded' },
        { name: 'staging', location: 'westus2', state: 'Succeeded' },
      ],
      write: writer,
    });
    expect(fired).toBe(true);
    expect(writer).toHaveBeenCalledTimes(1);
    const [frame] = writer.mock.calls[0];
    expect(frame.type).toBe('streaming_table');
    expect(frame.artifact_id).toBe('tc-1');
    expect(frame.title).toBe('azure_list_resource_groups');
    expect(frame.columns.map((c: any) => c.key)).toEqual(['name', 'location', 'state']);
    expect(frame.rows).toHaveLength(3);
    expect(frame.rows[0].name).toBe('core-api');
  });

  it('returns false (no emit) when result is not an array', () => {
    const writer = vi.fn();
    const fired = autoEmitStreamingTable({
      toolCallId: 'tc-1',
      toolName: 'x',
      result: 'plain text',
      write: writer,
    });
    expect(fired).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });

  it('returns false when array < 2 rows', () => {
    const writer = vi.fn();
    const fired = autoEmitStreamingTable({
      toolCallId: 'tc-1', toolName: 'x',
      result: [{ a: 1, b: 2 }],
      write: writer,
    });
    expect(fired).toBe(false);
  });

  it('returns false when array > 200 rows (too big to tabulate inline)', () => {
    const writer = vi.fn();
    const big = Array.from({ length: 201 }, (_, i) => ({ name: `r-${i}`, val: i }));
    const fired = autoEmitStreamingTable({
      toolCallId: 'tc-1', toolName: 'x', result: big, write: writer,
    });
    expect(fired).toBe(false);
  });

  it('returns false when rows have heterogeneous shapes', () => {
    const writer = vi.fn();
    const fired = autoEmitStreamingTable({
      toolCallId: 'tc-1', toolName: 'x',
      result: [{ a: 1, b: 2 }, { a: 1, c: 3 }],
      write: writer,
    });
    expect(fired).toBe(false);
  });

  it('returns false when rows have only 1 column', () => {
    const writer = vi.fn();
    const fired = autoEmitStreamingTable({
      toolCallId: 'tc-1', toolName: 'x',
      result: [{ name: 'a' }, { name: 'b' }],
      write: writer,
    });
    expect(fired).toBe(false);
  });

  it('formats column labels as Title-Case from snake_case keys', () => {
    const writer = vi.fn();
    autoEmitStreamingTable({
      toolCallId: 'tc-1', toolName: 'x',
      result: [
        { resource_group: 'a', display_name: 'A', state: 'ok' },
        { resource_group: 'b', display_name: 'B', state: 'ok' },
      ],
      write: writer,
    });
    const [frame] = writer.mock.calls[0];
    const labels = frame.columns.map((c: any) => c.label);
    expect(labels).toContain('Resource Group');
    expect(labels).toContain('Display Name');
    expect(labels).toContain('State');
  });

  it('marks numeric columns with cell_class=tnum + align=right', () => {
    const writer = vi.fn();
    autoEmitStreamingTable({
      toolCallId: 'tc-1', toolName: 'x',
      result: [
        { name: 'a', cost: 1234.56 },
        { name: 'b', cost: 78.9 },
      ],
      write: writer,
    });
    const [frame] = writer.mock.calls[0];
    const cost = frame.columns.find((c: any) => c.key === 'cost');
    expect(cost.cell_class).toBe('tnum');
    expect(cost.align).toBe('right');
  });

  it('JSON-parses string results that look like a JSON array', () => {
    const writer = vi.fn();
    const fired = autoEmitStreamingTable({
      toolCallId: 'tc-1', toolName: 'x',
      result: JSON.stringify([
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ]),
      write: writer,
    });
    expect(fired).toBe(true);
    expect(writer).toHaveBeenCalled();
  });

  it('does not throw on null/undefined/missing result', () => {
    const writer = vi.fn();
    expect(autoEmitStreamingTable({ toolCallId: 't', toolName: 'x', result: null, write: writer })).toBe(false);
    expect(autoEmitStreamingTable({ toolCallId: 't', toolName: 'x', result: undefined, write: writer })).toBe(false);
    expect(writer).not.toHaveBeenCalled();
  });
});
