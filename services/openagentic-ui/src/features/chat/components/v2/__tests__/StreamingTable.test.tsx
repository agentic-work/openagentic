import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StreamingTable } from '../StreamingTable';
import type { StreamingTable as StreamingTableData } from '../../../hooks/useChatStream';

const buildTable = (overrides: Partial<StreamingTableData> = {}): StreamingTableData => ({
  artifactId: 'tbl-1',
  title: 'Right-sizing candidates',
  countText: '17 analysed · 8 oversized',
  columns: [
    { key: 'vmName', label: 'VM name', cellClass: 'mono' },
    { key: 'cpu', label: 'Avg CPU %', align: 'right', cellClass: 'tnum' },
    { key: 'rec', label: 'Recommendation' },
  ],
  rows: [
    { vmName: 'vm-api-blue-01', cpu: '6.1', rec: { kind: 'sev', value: 'D4s_v5', severity: 'warn' } },
    { vmName: 'vm-redis-cache-01', cpu: '2.1', rec: { kind: 'sev', value: 'E2s_v5', severity: 'err' } },
    { vmName: 'vm-grafana-01', cpu: '8.3', rec: { kind: 'sev', value: 'keep', severity: 'ok' } },
  ],
  ...overrides,
});

describe('StreamingTable component (P1-6, mock 01:385-462)', () => {
  it('renders the .streaming-table wrapper with aria-label = title', () => {
    const { getByTestId } = render(<StreamingTable table={buildTable()} />);
    const root = getByTestId('streaming-table');
    expect(root).toHaveClass('streaming-table');
    expect(root.getAttribute('aria-label')).toBe('Right-sizing candidates');
  });

  it('renders header with title text + .tt-count when countText is present', () => {
    const { container } = render(<StreamingTable table={buildTable()} />);
    expect(container.querySelector('.tt-hdr')?.textContent).toContain('Right-sizing candidates');
    expect(container.querySelector('.tt-count')?.textContent).toBe('17 analysed · 8 oversized');
  });

  it('omits .tt-count when countText is undefined', () => {
    const { container } = render(<StreamingTable table={buildTable({ countText: undefined })} />);
    expect(container.querySelector('.tt-count')).toBeNull();
  });

  it('renders one <th> per column with the label text', () => {
    // Mock-07 — sortable headers carry a sort-arrow glyph (▼/▲) in a
    // .cm-arr child span. We assert the label text is CONTAINED in the
    // <th> textContent rather than exact-match so the arrow chrome is
    // free to evolve without rewriting the column-count guard.
    const { container } = render(<StreamingTable table={buildTable()} />);
    const ths = container.querySelectorAll('thead th');
    expect(ths).toHaveLength(3);
    expect(ths[0].textContent).toContain('VM name');
    expect(ths[1].textContent).toContain('Avg CPU %');
    expect(ths[2].textContent).toContain('Recommendation');
  });

  it('right-aligns columns marked align="right"', () => {
    const { container } = render(<StreamingTable table={buildTable()} />);
    const ths = container.querySelectorAll('thead th');
    expect((ths[1] as HTMLElement).style.textAlign).toBe('right');
    const tds = container.querySelectorAll('tbody tr:first-child td');
    expect((tds[1] as HTMLElement).style.textAlign).toBe('right');
  });

  it('applies .mono / .tnum cell classes per column to <td>', () => {
    const { container } = render(<StreamingTable table={buildTable()} />);
    const tds = container.querySelector('tbody tr')?.querySelectorAll('td');
    expect(tds?.[0].className).toBe('mono');
    expect(tds?.[1].className).toBe('tnum');
    expect(tds?.[2].className).toBe('');
  });

  it('renders sev cells as <span class="sev sev-warn|err|ok"> with the value', () => {
    const { container } = render(<StreamingTable table={buildTable()} />);
    const sevSpans = container.querySelectorAll('.sev');
    expect(sevSpans).toHaveLength(3);
    expect(sevSpans[0]).toHaveClass('sev-warn');
    expect(sevSpans[0].textContent).toBe('D4s_v5');
    expect(sevSpans[1]).toHaveClass('sev-err');
    expect(sevSpans[2]).toHaveClass('sev-ok');
  });

  it('renders one row per data entry', () => {
    const { container } = render(<StreamingTable table={buildTable()} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('handles plain string cells as text content (no .sev wrapper)', () => {
    const { container } = render(<StreamingTable table={buildTable()} />);
    const firstRow = container.querySelector('tbody tr');
    expect(firstRow?.querySelectorAll('td')[0].textContent).toBe('vm-api-blue-01');
    expect(firstRow?.querySelectorAll('td')[1].textContent).toBe('6.1');
  });

  it('renders 0 rows gracefully (header + thead, empty tbody)', () => {
    const { container } = render(<StreamingTable table={buildTable({ rows: [] })} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(container.querySelectorAll('thead th')).toHaveLength(3);
  });
});

describe('StreamingTable — #874 object-cell defense (React #31 prevention)', () => {
  it('renders raw object cells as key:value text instead of throwing React #31', () => {
    // Live regression 2026-05-15: azure_get_resource_group_inventory returned
    // resource_groups with a `tags` field shaped `{env: prod, owner: team}`.
    // StreamingTable rendered the object directly → React #31 crash.
    const table = buildTable({
      columns: [
        { key: 'name', label: 'RG' },
        { key: 'tags', label: 'Tags' },
      ],
      rows: [
        { name: 'rg-prod', tags: { env: 'prod', owner: 'team' } as any },
        { name: 'rg-meta', tags: { created: '2024-01-01', 'created-by': 'admin', owner: 'sre', purpose: 'platform' } as any },
        { name: 'rg-empty', tags: {} as any },
      ],
    });

    // The actual gate: render() must not throw.
    expect(() => render(<StreamingTable table={table} />)).not.toThrow();
  });

  it('object-cell flattens to key: value, key: value pairs', () => {
    const table = buildTable({
      columns: [{ key: 'name', label: 'X' }, { key: 'tags', label: 'Tags' }],
      rows: [{ name: 'a', tags: { env: 'prod', owner: 'team' } as any }],
    });
    const { container } = render(<StreamingTable table={table} />);
    const txt = container.textContent ?? '';
    expect(txt).toMatch(/env: prod/);
    expect(txt).toMatch(/owner: team/);
  });

  it('empty object renders as em-dash, not blank', () => {
    const table = buildTable({
      columns: [{ key: 'name', label: 'X' }, { key: 'tags', label: 'Tags' }],
      rows: [{ name: 'a', tags: {} as any }],
    });
    const { container } = render(<StreamingTable table={table} />);
    expect(container.textContent).toMatch(/—/);
  });
});
