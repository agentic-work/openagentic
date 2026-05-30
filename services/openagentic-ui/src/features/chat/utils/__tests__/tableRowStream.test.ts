/**
 * Tests for the Phase F.3 table-row stream detector.
 */

import { describe, it, expect } from 'vitest';
import {
  detectTableData,
  revealedSlice,
  formatCell,
} from '../tableRowStream';

describe('detectTableData', () => {
  it('returns null for non-object input', () => {
    expect(detectTableData(null)).toBeNull();
    expect(detectTableData(undefined)).toBeNull();
    expect(detectTableData(42)).toBeNull();
    expect(detectTableData('some string')).toBeNull();
  });

  it('returns null for a single-row array (not worth streaming)', () => {
    expect(detectTableData([{ id: 1 }])).toBeNull();
  });

  it('returns null for non-object array members', () => {
    expect(detectTableData([1, 2, 3])).toBeNull();
    expect(detectTableData(['a', 'b'])).toBeNull();
    expect(detectTableData([{ id: 1 }, 2])).toBeNull(); // mixed
  });

  it('unwraps a top-level array of ≥2 row objects', () => {
    const out = detectTableData([
      { name: 'pod-a', status: 'Running' },
      { name: 'pod-b', status: 'Pending' },
    ]);
    expect(out).not.toBeNull();
    expect(out!.rows.length).toBe(2);
    expect(out!.columns).toEqual(['name', 'status']);
  });

  it('unwraps from common container keys (rows / items / data / results / records)', () => {
    for (const key of ['rows', 'items', 'data', 'results', 'records']) {
      const src = { [key]: [{ a: 1 }, { a: 2 }] } as Record<string, unknown>;
      const out = detectTableData(src);
      expect(out, `failed on key ${key}`).not.toBeNull();
      expect(out!.rows.length).toBe(2);
    }
  });

  it('unions columns across sparse rows (first-seen order preserved)', () => {
    const out = detectTableData([
      { id: 1, name: 'a' },
      { id: 2, status: 'ok' },
      { id: 3, name: 'c', extra: 'x' },
    ]);
    expect(out!.columns).toEqual(['id', 'name', 'status', 'extra']);
  });

  it('caps column count at 20 to avoid runaway wide tables', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 40; i++) wide[`col_${i}`] = i;
    const out = detectTableData([wide, { ...wide, extra: 1 }]);
    expect(out!.columns.length).toBe(20);
  });

  it('returns null when rows have no enumerable columns (empty objects)', () => {
    expect(detectTableData([{}, {}])).toBeNull();
  });

  it('does not pick up arrays of arrays', () => {
    expect(detectTableData([[1, 2], [3, 4]])).toBeNull();
  });
});

describe('revealedSlice', () => {
  const rows = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }];

  it('returns [] when nothing is revealed yet', () => {
    expect(revealedSlice(rows, 0)).toEqual([]);
    expect(revealedSlice(rows, -5)).toEqual([]);
  });

  it('returns the prefix when partial', () => {
    expect(revealedSlice(rows, 2)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('returns the whole array once revealed >= length', () => {
    expect(revealedSlice(rows, 4)).toEqual(rows);
    expect(revealedSlice(rows, 999)).toEqual(rows);
  });
});

describe('formatCell', () => {
  it('passes strings through unchanged', () => {
    expect(formatCell('hello')).toBe('hello');
  });

  it('stringifies numbers and booleans', () => {
    expect(formatCell(42)).toBe('42');
    expect(formatCell(true)).toBe('true');
  });

  it('returns empty string for null / undefined', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('JSON-stringifies short objects', () => {
    expect(formatCell({ id: 1 })).toBe('{"id":1}');
  });

  it('truncates long JSON with an ellipsis', () => {
    const big = { blob: 'a'.repeat(200) };
    const out = formatCell(big);
    expect(out.length).toBe(78); // 77 + ellipsis
    expect(out.endsWith('\u2026')).toBe(true);
  });

  it('gracefully handles un-stringifiable objects (circular ref)', () => {
    const cyclic: any = { self: null };
    cyclic.self = cyclic;
    // Should not throw; falls back to String(value)
    expect(() => formatCell(cyclic)).not.toThrow();
  });
});
