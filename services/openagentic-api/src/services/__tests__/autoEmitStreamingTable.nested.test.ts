/**
 * Phase 32 — autoEmitStreamingTable nested-array lift.
 *
 * When a tool result is a plain object and exactly one top-level field
 * is an array of flat objects, lift that array and emit a table from it.
 *
 * Real-world case: MCP tool wrappers return
 *   { resource_groups: [...], executed_as: {...} }
 *   { subscriptions: [...] }
 *   { rows: [...], meta: {...} }
 * The heuristic must pick the array field, use its key as the table
 * title, and leave scalar-only objects alone.
 */

import { describe, it, expect, vi } from 'vitest';
import { autoEmitStreamingTable } from '../autoEmitStreamingTable';

describe('autoEmitStreamingTable nested-array lift (Phase 32)', () => {
  it('lifts the array from a single-array-field object', () => {
    const write = vi.fn();
    const ok = autoEmitStreamingTable({
      toolCallId: 'call-1',
      toolName: 'azure_list_resource_groups',
      result: {
        resource_groups: [
          { name: 'rg-a', location: 'eastus', state: 'Succeeded' },
          { name: 'rg-b', location: 'westus', state: 'Succeeded' },
          { name: 'rg-c', location: 'eastus2', state: 'Succeeded' },
        ],
      },
      write,
    });
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const frame = write.mock.calls[0][0];
    expect(frame.type).toBe('streaming_table');
    expect(frame.rows).toHaveLength(3);
    expect(frame.columns.map((c: any) => c.key)).toEqual(['name', 'location', 'state']);
    expect(frame.count_text).toBe('3 rows');
  });

  it('ignores scalar/object-only sibling fields', () => {
    const write = vi.fn();
    const ok = autoEmitStreamingTable({
      toolCallId: 'call-x',
      toolName: 'azure_list_rgs',
      result: {
        resource_groups: [
          { name: 'rg-a', location: 'eastus' },
          { name: 'rg-b', location: 'westus' },
        ],
        executed_as: { upn: 'mcp-tester@example.com', name: 'tester' },
        fetched_at: '2026-04-30T18:00:00Z',
      },
      write,
    });
    expect(ok).toBe(true);
    const frame = write.mock.calls[0][0];
    expect(frame.rows).toHaveLength(2);
    expect(frame.columns.map((c: any) => c.key)).toEqual(['name', 'location']);
  });

  it('picks the FIRST array field when multiple arrays exist', () => {
    const write = vi.fn();
    const ok = autoEmitStreamingTable({
      toolCallId: 'call-y',
      toolName: 'multi',
      result: {
        subs: [
          { id: '1', name: 'prod' },
          { id: '2', name: 'dev' },
        ],
        rgs: [
          { name: 'a', location: 'eastus' },
          { name: 'b', location: 'westus' },
        ],
      },
      write,
    });
    // First array field (`subs`) has 2 cols, passes; emits from that.
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    const frame = write.mock.calls[0][0];
    expect(frame.columns.map((c: any) => c.key)).toEqual(['id', 'name']);
  });

  it('skips when the single array field has non-object rows', () => {
    const write = vi.fn();
    const ok = autoEmitStreamingTable({
      toolCallId: 'call-z',
      toolName: 'str_list',
      result: {
        names: ['rg-a', 'rg-b', 'rg-c'],
      },
      write,
    });
    expect(ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips when no top-level field is an array', () => {
    const write = vi.fn();
    const ok = autoEmitStreamingTable({
      toolCallId: 'call-w',
      toolName: 'scalar_obj',
      result: {
        name: 'rg-a',
        location: 'eastus',
        state: 'Succeeded',
      },
      write,
    });
    expect(ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('works via JSON-stringified wrapper (sub-agent marshalls to string)', () => {
    const write = vi.fn();
    const ok = autoEmitStreamingTable({
      toolCallId: 'call-s',
      toolName: 'azure_list_rgs',
      result: JSON.stringify({
        resource_groups: [
          { name: 'a', location: 'eastus', state: 'Succeeded' },
          { name: 'b', location: 'westus', state: 'Succeeded' },
        ],
      }),
      write,
    });
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
