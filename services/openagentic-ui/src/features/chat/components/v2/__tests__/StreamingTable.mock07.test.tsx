/**
 * StreamingTable mock-07 feature pass — sticky thead, sortable arrows,
 * filter pill, max-height scroll wrap, CloudBadge cells, threshold colors.
 * Pinned to mocks/UX/AI/Chatmode/end-state-07 lines 218-234.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StreamingTable } from '../StreamingTable';
import type { StreamingTable as StreamingTableData } from '../../../hooks/useChatStream';

const buildCostSpikeTable = (
  overrides: Partial<StreamingTableData> = {},
): StreamingTableData => ({
  artifactId: 'tbl-cost-spike',
  title: 'streaming_table',
  countText: '10 rows · top spikes',
  columns: [
    { key: 'delta', label: 'Δ Spend', cellClass: 'tnum', align: 'right', colorize: 'delta-currency' },
    { key: 'cloud', label: 'Cloud' },
    { key: 'service', label: 'Service', cellClass: 'mono' },
    { key: 'cause', label: 'Root cause', dim: true },
  ],
  rows: [
    { delta: '+$8,420', cloud: 'aws', service: 'EC2 NAT Gateway', cause: 'cross-AZ chatter' },
    { delta: '+$6,118', cloud: 'azure', service: 'Azure OpenAI', cause: 'gpt token spike' },
    { delta: '+$3,420', cloud: 'gcp', service: 'Vertex AI', cause: 'RAG re-index 3x' },
    { delta: '+$1,820', cloud: 'azure', service: 'App Gateway WAF', cause: 'v2 SKU upgrade' },
  ],
  filter: { column: 'cloud', default: 'all clouds' },
  ...overrides,
});

describe('StreamingTable mock-07 — sticky / sortable / filter', () => {
  it('wraps the table in a .st-wrap scroll surface (max-height)', () => {
    const { getByTestId } = render(<StreamingTable table={buildCostSpikeTable()} />);
    expect(getByTestId('streaming-table-wrap')).toBeInTheDocument();
  });

  it('marks each <th> as cm-sortable with an arrow glyph', () => {
    const { container } = render(<StreamingTable table={buildCostSpikeTable()} />);
    const ths = container.querySelectorAll('thead th');
    ths.forEach((th) => {
      expect(th.className).toMatch(/cm-sortable/);
      expect(th.querySelector('.cm-arr')).toBeInTheDocument();
    });
  });

  it('defaults to descending sort on the colorize=delta-currency column', () => {
    const { container } = render(<StreamingTable table={buildCostSpikeTable()} />);
    const deltaTh = container.querySelector('[data-testid="streaming-table-th-delta"]');
    expect(deltaTh).toHaveClass('cm-sorted');
    expect(deltaTh?.getAttribute('aria-sort')).toBe('descending');
    // First data row should be +$8,420 (largest)
    const firstCell = container.querySelector('tbody tr:first-child td');
    expect(firstCell?.textContent).toContain('+$8,420');
  });

  it('clicking a header toggles sort direction asc/desc', () => {
    const { container } = render(<StreamingTable table={buildCostSpikeTable()} />);
    const deltaTh = container.querySelector('[data-testid="streaming-table-th-delta"]') as HTMLElement;
    fireEvent.click(deltaTh);
    expect(deltaTh.getAttribute('aria-sort')).toBe('ascending');
    // smallest delta first now
    const firstCell = container.querySelector('tbody tr:first-child td');
    expect(firstCell?.textContent).toContain('+$1,820');
  });

  it('renders Cloud-column cells via CloudBadge', () => {
    const { container } = render(<StreamingTable table={buildCostSpikeTable()} />);
    const badges = container.querySelectorAll('[data-testid="cloud-badge"]');
    expect(badges.length).toBeGreaterThanOrEqual(4);
    const cloudValues = Array.from(badges).map((b) => b.getAttribute('data-cloud'));
    expect(cloudValues).toContain('aws');
    expect(cloudValues).toContain('azure');
    expect(cloudValues).toContain('gcp');
  });

  it('applies cm-red on cells |Δ| ≥ 5000', () => {
    const { container } = render(<StreamingTable table={buildCostSpikeTable()} />);
    // First row default-sorted is +$8,420 → cm-red
    const firstDeltaCell = container.querySelector('tbody tr:first-child td');
    expect(firstDeltaCell?.className).toMatch(/cm-red/);
  });

  it('applies cm-amber on cells 2000 ≤ |Δ| < 5000', () => {
    const { container } = render(<StreamingTable table={buildCostSpikeTable()} />);
    const cells = Array.from(container.querySelectorAll('tbody tr td:first-child'));
    const amber = cells.find((c) => c.className.includes('cm-amber'));
    expect(amber?.textContent).toContain('+$3,420');
  });

  it('applies cm-green on cells |Δ| < 2000', () => {
    const { container } = render(<StreamingTable table={buildCostSpikeTable()} />);
    const cells = Array.from(container.querySelectorAll('tbody tr td:first-child'));
    const green = cells.find((c) => c.className.includes('cm-green'));
    expect(green?.textContent).toContain('+$1,820');
  });

  it('renders a filter pill <select> when table.filter is set', () => {
    const { getByTestId } = render(<StreamingTable table={buildCostSpikeTable()} />);
    const select = getByTestId('streaming-table-filter') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    // Default option label is "all clouds" from filter.default
    expect(select.querySelectorAll('option')[0].textContent).toBe('all clouds');
    // Then one option per distinct cloud value
    const opts = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(opts).toContain('aws');
    expect(opts).toContain('azure');
    expect(opts).toContain('gcp');
  });

  it('filtering hides non-matching rows', () => {
    const { container, getByTestId } = render(<StreamingTable table={buildCostSpikeTable()} />);
    const select = getByTestId('streaming-table-filter') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'azure' } });
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2); // 2 azure rows
    rows.forEach((r) => {
      expect(r.textContent).toContain('azure');
    });
  });

  it('omits filter pill when table.filter is absent', () => {
    const { queryByTestId } = render(
      <StreamingTable table={buildCostSpikeTable({ filter: undefined })} />,
    );
    expect(queryByTestId('streaming-table-filter')).toBeNull();
  });

  it('applies dim class to dim-flagged columns', () => {
    const { container } = render(<StreamingTable table={buildCostSpikeTable()} />);
    // 4th column has dim:true (Root cause)
    const dimTds = container.querySelectorAll('tbody tr td:nth-child(4)');
    expect(dimTds.length).toBeGreaterThan(0);
    dimTds.forEach((td) => {
      expect(td.className).toMatch(/dim/);
    });
  });
});

describe('StreamingTable mock-07 — backward-compat (no colorize/no filter)', () => {
  it('skips coloring + sorting when no colorize column present', () => {
    const t: StreamingTableData = {
      artifactId: 't1',
      title: 'plain',
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'val', label: 'Value' },
      ],
      rows: [
        { name: 'b', val: '2' },
        { name: 'a', val: '1' },
      ],
    };
    const { container } = render(<StreamingTable table={t} />);
    // No th gets cm-sorted on first render (no defaultSortKey).
    expect(container.querySelector('th.cm-sorted')).toBeNull();
    // Rows render in wire order (no auto-sort).
    const firstCell = container.querySelector('tbody tr:first-child td');
    expect(firstCell?.textContent).toBe('b');
  });
});
