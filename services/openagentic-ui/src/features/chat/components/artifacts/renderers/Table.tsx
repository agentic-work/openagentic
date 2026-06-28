/**
 * #781 Phase C4 — Table renderer.
 *
 * Sortable HTML table for resource-inventory / cost-table artifact
 * payloads. CSV export via `toCsv` helper (also reused by the action
 * bar's Download-source button). Editorial-prestige aesthetic: cream
 * paper, JetBrains-Mono column data, serif title, accent rail on sort
 * indicator.
 */
import React, { useMemo, useState } from 'react';

export interface TableColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface TableProps {
  rows: Array<Record<string, unknown>>;
  columns: TableColumn[];
  title?: string;
}

type SortDir = 'none' | 'asc' | 'desc';

const COLORS = {
  ink: 'var(--ink, #0d0d0c)',
  graphite: 'var(--graphite, rgba(13,13,12,0.55))',
  accent: 'var(--accent, #c1440e)',
  rule: 'var(--ink-on-paper, rgba(13,13,12,0.12))',
  paper2: 'var(--paper-2, rgba(13,13,12,0.04))',
};

function escapeCsv(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(
  rows: Array<Record<string, unknown>>,
  columns: TableColumn[],
): string {
  const header = columns.map((c) => escapeCsv(c.label)).join(',');
  const body = rows
    .map((r) => columns.map((c) => escapeCsv(r[c.key])).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

export const Table: React.FC<TableProps> = ({ rows, columns, title }) => {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('none');

  const sortedRows = useMemo(() => {
    if (!sortKey || sortDir === 'none') return rows;
    const col = columns.find((c) => c.key === sortKey);
    const mul = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (col?.numeric) {
        return ((Number(av) || 0) - (Number(bv) || 0)) * mul;
      }
      return String(av ?? '').localeCompare(String(bv ?? '')) * mul;
    });
  }, [rows, sortKey, sortDir, columns]);

  if (!rows || rows.length === 0) {
    return (
      <div
        data-testid="table-empty"
        style={{
          padding: '40px 20px',
          textAlign: 'center',
          color: COLORS.graphite,
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 12,
          letterSpacing: 0.04,
        }}
      >
        No rows to display.
      </div>
    );
  }

  const headerCellStyle: React.CSSProperties = {
    padding: '10px 12px',
    textAlign: 'left',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.16,
    fontWeight: 600,
    color: COLORS.accent,
    borderBottom: `1px solid ${COLORS.ink}`,
    background: COLORS.paper2,
    cursor: 'pointer',
    userSelect: 'none',
  };

  const cellStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: 11.5,
    color: COLORS.ink,
    borderBottom: `1px solid ${COLORS.rule}`,
    fontVariantNumeric: 'tabular-nums',
  };

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
      return;
    }
    setSortDir((prev) => (prev === 'none' ? 'asc' : prev === 'asc' ? 'desc' : 'none'));
  };

  return (
    <div data-testid="table-root" style={{ width: '100%' }}>
      {title && (
        <div
          style={{
            fontFamily: 'var(--font-serif, ui-serif, Georgia, serif)',
            fontSize: 14,
            fontWeight: 600,
            color: COLORS.ink,
            marginBottom: 12,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((c) => {
              const dir = sortKey === c.key ? sortDir : 'none';
              return (
                <th
                  key={c.key}
                  data-testid={`table-col-${c.key}`}
                  data-sort={dir}
                  onClick={() => toggleSort(c.key)}
                  style={headerCellStyle}
                >
                  {c.label}
                  {dir === 'asc' && <span style={{ marginLeft: 6, color: COLORS.accent }}>↑</span>}
                  {dir === 'desc' && <span style={{ marginLeft: 6, color: COLORS.accent }}>↓</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = r[c.key];
                return (
                  <td key={c.key} style={cellStyle}>
                    {c.numeric && typeof v === 'number' ? v.toFixed(2) : String(v ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
