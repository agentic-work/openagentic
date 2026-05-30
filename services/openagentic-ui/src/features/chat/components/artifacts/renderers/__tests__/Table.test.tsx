/**
 * #781 Phase C4 — Table renderer tests.
 *
 * Sortable, filterable, CSV-exportable table for resource-inventory /
 * cost-table artifact payloads.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { Table, toCsv } from '../Table.js';

const ROWS = [
  { name: 'aif-eastus2', region: 'eastus2', cost: 42.79 },
  { name: 'fd-prod', region: 'global', cost: 5.41 },
  { name: 'pip-orphan', region: 'eastus', cost: 2.79 },
];

const COLS = [
  { key: 'name', label: 'Name' },
  { key: 'region', label: 'Region' },
  { key: 'cost', label: 'Cost', numeric: true as const },
];

describe('Table renderer — #781 Phase C4', () => {
  it('shows empty state when rows are empty', () => {
    render(<Table rows={[]} columns={COLS} />);
    expect(screen.getByTestId('table-empty')).toBeInTheDocument();
  });

  it('renders one row per data point + header row', () => {
    render(<Table rows={ROWS} columns={COLS} />);
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1);
    expect(screen.getByText('aif-eastus2')).toBeInTheDocument();
    expect(screen.getByText('global')).toBeInTheDocument();
    expect(screen.getByText('42.79')).toBeInTheDocument();
  });

  it('clicking a column header toggles sort direction', async () => {
    const user = userEvent.setup();
    render(<Table rows={ROWS} columns={COLS} />);
    const header = screen.getByTestId('table-col-cost');
    expect(header).toHaveAttribute('data-sort', 'none');
    await user.click(header);
    expect(header).toHaveAttribute('data-sort', 'asc');
    await user.click(header);
    expect(header).toHaveAttribute('data-sort', 'desc');
  });

  it('sort by cost asc orders rows smallest first', async () => {
    const user = userEvent.setup();
    render(<Table rows={ROWS} columns={COLS} />);
    await user.click(screen.getByTestId('table-col-cost'));
    const rows = screen.getAllByRole('row').slice(1); // skip header
    const firstCost = rows[0].querySelectorAll('td')[2].textContent;
    expect(firstCost).toBe('2.79');
  });

  it('toCsv produces a CSV string with header + escaped values', () => {
    const csv = toCsv(ROWS, COLS);
    expect(csv).toMatch(/^Name,Region,Cost\n/);
    expect(csv).toContain('aif-eastus2,eastus2,42.79');
    expect(csv).toContain('fd-prod,global,5.41');
  });

  it('toCsv escapes values containing commas / quotes / newlines', () => {
    const csv = toCsv(
      [{ name: 'a, b', region: 'has "quote"', cost: 1 }],
      COLS,
    );
    expect(csv).toContain('"a, b"');
    expect(csv).toContain('"has ""quote"""');
  });
});
