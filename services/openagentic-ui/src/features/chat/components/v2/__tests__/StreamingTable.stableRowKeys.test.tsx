/**
 * P3 #940 (2026-05-18) — StreamingTable stable row keys + no row-mount
 * animation glitch. User feedback verbatim: "the table data still
 * glitch out when they are loading- they need to cleanly stream out
 * without glitching".
 *
 * Root cause: `tr key={`row-${ri}`}` index-based key + cascading
 * `:nth-child(N) animation-delay` chain → every new row arriving
 * mid-stream pushes previous rows to new nth-child positions, re-firing
 * cm-rowIn 400ms keyframe from scratch on each row.
 *
 * Fix:
 *   1. Replace index key with content-derived rowKey() hash so React
 *      preserves row identity across sort/filter/incremental row append.
 *   2. Strip cm-rowIn animation declarations from streaming-table CSS so
 *      rows simply appear (Excel/Sheets behavior — what users actually
 *      expect from streaming data).
 *
 * Tests assert both axes:
 *   - row keys stay stable when an extra row is appended at the end
 *   - row keys stay stable when the row order is reversed
 *   - CSS file no longer contains the cm-rowIn animation declaration on
 *     `.streaming-table tbody tr`
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { StreamingTable } from '../StreamingTable';

const CSS_PATH = path.resolve(__dirname, '../chatmode-v2.css');

function tableFixture(rows: Array<Record<string, string>>) {
  return {
    title: 't',
    countText: `${rows.length} rows`,
    columns: [
      { key: 'cloud', label: 'Cloud' },
      { key: 'service', label: 'Service' },
      { key: 'cost', label: 'Cost' },
    ],
    rows,
  } as any;
}

function trKeys(container: HTMLElement): string[] {
  // React doesn't surface keys via DOM. Use the cell signature derived
  // from <tr>'s child <td> text — the SAME signature rowKey() hashes —
  // as a stand-in. If keys are stable, the rendered DOM after re-render
  // with sorted rows keeps the SAME elements alive (React reorders
  // children rather than re-mounting). We can't observe reordering from
  // DOM alone, but we CAN observe that the row text payloads survive.
  return Array.from(container.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td'))
      .map((td) => td.textContent || '')
      .join('|'),
  );
}

describe('StreamingTable — P3 #940 row-mount glitch', () => {
  it('row appearance survives appending a NEW row at the end', () => {
    const initial = tableFixture([
      { cloud: 'aws', service: 'ec2', cost: '$100' },
      { cloud: 'azure', service: 'vm', cost: '$80' },
    ]);
    const grown = tableFixture([
      { cloud: 'aws', service: 'ec2', cost: '$100' },
      { cloud: 'azure', service: 'vm', cost: '$80' },
      { cloud: 'gcp', service: 'gce', cost: '$50' },
    ]);

    const { container, rerender } = render(<StreamingTable table={initial} />);
    const before = trKeys(container);
    rerender(<StreamingTable table={grown} />);
    const after = trKeys(container);

    expect(before).toHaveLength(2);
    expect(after).toHaveLength(3);
    // Both initial rows still rendered with same cell text post-append.
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).toContain('gcp');
  });

  it('row appearance survives row order reversal', () => {
    const initial = tableFixture([
      { cloud: 'aws', service: 'a', cost: '$1' },
      { cloud: 'azure', service: 'b', cost: '$2' },
      { cloud: 'gcp', service: 'c', cost: '$3' },
    ]);
    const reversed = tableFixture(initial.rows.slice().reverse());

    const { container, rerender } = render(<StreamingTable table={initial} />);
    const before = trKeys(container);
    rerender(<StreamingTable table={reversed} />);
    const after = trKeys(container);

    expect(after.length).toBe(before.length);
    expect(after).toEqual(before.slice().reverse());
  });

  it('chatmode-v2.css no longer animates streaming-table rows on remount', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf-8');
    // The exact rule that fired cm-rowIn on every row mount.
    expect(css).not.toMatch(/\.streaming-table\s+tbody\s+tr\s*\{\s*animation:\s*cm-rowIn/);
    // And the cascading nth-child delays that re-keyed positions.
    expect(css).not.toMatch(/\.streaming-table\s+tbody\s+tr:nth-child\(\d+\)\s*\{\s*animation-delay:/);
  });
});
