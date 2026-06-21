import React, { useMemo, useState } from 'react';

/**
 * P1-6 streaming-table primitive — mock 01:385-462 anatomy:
 *
 *   .streaming-table
 *     .tt-hdr           (icon + title + .tt-count + optional filter pill)
 *     .st-wrap          (max-height scroll surface — mock-07 line 100)
 *       <table>
 *         <thead><tr><th> per column, sticky, sortable (mock-07 line 102-104)
 *         <tbody><tr><td> per row, with .mono/.tnum cell classes and
 *                         .sev.sev-{ok|warn|err} pills inside <td> when
 *                         the cell is a SevCell.
 *
 * Mock-07 feature pass:
 *   - Sticky thead (CSS only).
 *   - Sortable columns — clicking a <th> toggles asc/desc sort by that
 *     column. Active column shows ▼/▲; other columns show a faint ▼.
 *   - Filter pill — when `table.filter` is set, render a <select> in the
 *     header that filters rows to the chosen value of `filter.column`.
 *   - Max-height scroll wrap (.st-wrap, 360px).
 *   - Cloud-badge cells — when a column key is `Cloud` or `cloud` (or
 *     when the cell value is one of {aws,azure,gcp}), render via
 *     CloudBadge.
 *   - Threshold colors — when a column has `colorize: 'delta-currency'`,
 *     parse the cell's numeric magnitude and apply cm-red/-amber/-green.
 *
 * The CSS animation keys off `tbody tr:nth-child(N)` for staggered
 * row-in fade — already declared in chatmode-v2.css. This component
 * only emits the markup; visual polish is pure CSS.
 */

import type {
  StreamingTable as StreamingTableData,
  StreamingTableCell,
  StreamingTableColumn,
  SevSeverity,
} from '../../hooks/useChatStream.js';
import { CloudBadge } from './CloudBadge.js';

export interface StreamingTableProps {
  table: StreamingTableData;
}

const SEV_CLASS: Record<SevSeverity, string> = {
  ok: 'sev sev-ok',
  warn: 'sev sev-warn',
  err: 'sev sev-err',
};

function isSevCell(
  c: StreamingTableCell,
): c is { kind: 'sev'; value: string; severity: SevSeverity } {
  return typeof c === 'object' && c !== null && (c as any).kind === 'sev';
}

const CLOUD_KEYS: ReadonlySet<string> = new Set(['cloud', 'Cloud', 'CLOUD']);
const CLOUD_VALUES: ReadonlySet<string> = new Set(['aws', 'azure', 'gcp']);

function cellScalarString(c: StreamingTableCell): string {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (typeof c === 'number' || typeof c === 'boolean') return String(c);
  if (isSevCell(c)) return c.value;
  return '';
}

/**
 * Strip out non-numeric chars except - + . so currency strings like
 * "+$8,420" parse to 8420. Returns null on no numeric content.
 */
function parseDeltaCurrency(c: StreamingTableCell): number | null {
  const s = cellScalarString(c);
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function deltaCurrencyClass(c: StreamingTableCell): string | null {
  const n = parseDeltaCurrency(c);
  if (n == null) return null;
  const abs = Math.abs(n);
  if (abs >= 5000) return 'cm-red';
  if (abs >= 2000) return 'cm-amber';
  return 'cm-green';
}

function renderCell(c: StreamingTableCell, col?: StreamingTableColumn): React.ReactNode {
  if (c == null) return '';
  // Cloud-badge cells (mock-07 line 219). Two routes: column key matches
  // /cloud/i OR the value itself is aws/azure/gcp. The second route is
  // permissive — if the model emits a row where the cloud lives under a
  // differently-named column, we still paint the badge.
  if (col && CLOUD_KEYS.has(col.key)) {
    const v = cellScalarString(c).toLowerCase();
    if (CLOUD_VALUES.has(v)) {
      return <CloudBadge cloud={v as 'aws' | 'azure' | 'gcp'} />;
    }
  }
  if (typeof c === 'string' && CLOUD_VALUES.has(c.toLowerCase())) {
    // Only auto-promote when column has no explicit cellClass — otherwise
    // we'd repaint legitimate string cells that happen to read "aws".
    if (!col?.cellClass && !col?.colorize) {
      return <CloudBadge cloud={c.toLowerCase() as 'aws' | 'azure' | 'gcp'} />;
    }
  }
  if (isSevCell(c)) {
    return <span className={SEV_CLASS[c.severity]}>{c.value}</span>;
  }
  // #874 (2026-05-15) — defend against runtime objects (Azure tag dicts:
  // `{env, owner}`, resource metadata: `{created, created-by, ...}`) that
  // slip past the declared scalar `StreamingTableCell` type at runtime.
  // Without this guard React throws #31 ("Objects are not valid as a
  // React child") and StreamErrorBoundary unmounts the whole turn.
  if (typeof c === 'object') {
    try {
      const entries = Object.entries(c as Record<string, unknown>);
      if (entries.length === 0) return '—';
      return (
        <span className="cm-cell-obj" title={JSON.stringify(c)}>
          {entries
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(', ')}
        </span>
      );
    } catch {
      return '[object]';
    }
  }
  // scalars (string, number, boolean) — React renders these natively.
  return c as React.ReactNode;
}

function compareCells(
  a: StreamingTableCell,
  b: StreamingTableCell,
  colorize?: 'delta-currency',
): number {
  // Numeric sort when colorize hints at currency-deltas; otherwise sort by
  // parsed-number fallback then by lexicographic string.
  if (colorize === 'delta-currency') {
    const na = parseDeltaCurrency(a);
    const nb = parseDeltaCurrency(b);
    if (na != null && nb != null) return na - nb;
    if (na != null) return -1;
    if (nb != null) return 1;
  }
  const sa = cellScalarString(a);
  const sb = cellScalarString(b);
  // Try numeric first (last-30d cells like "$11,840").
  const fa = parseDeltaCurrency(a);
  const fb = parseDeltaCurrency(b);
  if (fa != null && fb != null) return fa - fb;
  return sa.localeCompare(sb);
}

/**
 * P3 #940 (2026-05-18) — content-derived stable row key. Replaces the
 * pre-fix index key (`row-${ri}`) that remounted every row on filter or
 * sort, re-firing the 400ms cm-rowIn animation from scratch and producing
 * a visible "glitch out" mid-stream (user feedback verbatim: "the table
 * data still glitch out when they are loading- they need to cleanly
 * stream out without glitching").
 *
 * Strategy: hash every column cell's scalar string. Same cells → same
 * key → React preserves the row across re-render. New row arriving
 * mid-stream gets a brand-new key → mounts → fires cm-rowIn ONCE on
 * the first paint. We deliberately mix in `ri` only as a final tie-break
 * for the degenerate case where two rows happen to have identical
 * scalar payloads (extremely unlikely in a structured table, but
 * keeps key uniqueness invariant from the React reconciler's POV).
 */
function rowKey(row: Record<string, StreamingTableCell>, ri: number): string {
  let h = 5381;
  // Deterministic order: Object.keys insertion order is stable per V8 spec
  // for string keys, and StreamingTable column ordering uses string keys.
  for (const k of Object.keys(row)) {
    const s = `${k}=${cellScalarString(row[k])};`;
    for (let i = 0; i < s.length; i++) {
      // djb2-like
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
  }
  return `r${h >>> 0}_${ri.toString(36)}`;
}

export function StreamingTable({ table }: StreamingTableProps) {
  const { title, countText, columns, rows, filter } = table;

  // Mock-07 sortable. Default sort is by the FIRST column that carries
  // `colorize: 'delta-currency'` (descending) so cost-spike tables open
  // with the largest spikes on top. Callers can click any column to
  // re-sort. Absent any colorize column → no default sort (rows in
  // wire order, preserving model output).
  const defaultSortKey = useMemo(() => {
    const col = columns.find((c) => c.colorize === 'delta-currency');
    return col ? col.key : null;
  }, [columns]);
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Filter pill state — defaults to "all" (no filter applied).
  const filterCol = useMemo(() => {
    if (!filter) return null;
    const col = columns.find((c) => c.key === filter.column);
    return col ?? null;
  }, [filter, columns]);
  const filterOptions = useMemo(() => {
    if (!filterCol) return [] as string[];
    const set = new Set<string>();
    for (const row of rows) {
      const v = cellScalarString(row[filterCol.key]);
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [filterCol, rows]);
  const filterDefaultLabel = filter?.default ?? 'all';
  const [filterValue, setFilterValue] = useState<string>('');

  // Filter then sort. Pure derivations — no side-effects.
  const visibleRows = useMemo(() => {
    let out = rows;
    if (filterCol && filterValue) {
      out = out.filter((r) => cellScalarString(r[filterCol.key]) === filterValue);
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      const sorted = [...out].sort((a, b) => compareCells(a[sortKey], b[sortKey], col?.colorize));
      if (sortDir === 'desc') sorted.reverse();
      out = sorted;
    }
    return out;
  }, [rows, sortKey, sortDir, columns, filterCol, filterValue]);

  function onHeaderClick(col: StreamingTableColumn) {
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('desc');
    }
  }

  return (
    <div className="streaming-table cm-streaming-table" aria-label={title} data-testid="streaming-table">
      <div className="tt-hdr">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{ color: 'var(--accent, var(--cm-accent))' }}
          aria-hidden
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
        <span>{title}</span>
        {countText && <span className="tt-count">{countText}</span>}
        {filterCol && (
          <select
            data-testid="streaming-table-filter"
            className="tt-filter"
            aria-label={`Filter by ${filterCol.label}`}
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
          >
            <option value="">{filterDefaultLabel}</option>
            {filterOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="st-wrap" data-testid="streaming-table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                const arrow = isSorted ? (sortDir === 'desc' ? '▼' : '▲') : '▼';
                return (
                  <th
                    key={col.key}
                    className={`cm-sortable${isSorted ? ' cm-sorted' : ''}`}
                    style={col.align === 'right' ? { textAlign: 'right' } : undefined}
                    onClick={() => onHeaderClick(col)}
                    aria-sort={
                      isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                    data-testid={`streaming-table-th-${col.key}`}
                  >
                    {col.label}
                    <span className="cm-arr" aria-hidden>
                      {arrow}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, ri) => (
              // P3 #940 (2026-05-18) — row remount glitch fix.
              // Was: key={`row-${ri}`} index-based → every filter/sort
              //   change remounted EVERY row and refired the 400ms
              //   cm-rowIn keyframe from frame 0 → visible jitter on
              //   each user interaction.
              // Now: key derived from the row's cell signature so rows
              //   keep their React identity across sort/filter.
              // The data-row-settled attribute is stamped on the first
              //   render-frame after mount (rAF) by the CSS scope; the
              //   companion CSS gates `cm-rowIn` to `:not([data-row-settled])`
              //   so the animation only fires on the row's actual
              //   first-mount, not on later re-renders.
              <tr key={rowKey(row, ri)}>
                {columns.map((col) => {
                  const cell = row[col.key];
                  const classes: string[] = [];
                  if (col.cellClass) classes.push(col.cellClass);
                  if (col.dim) classes.push('dim');
                  if (col.colorize === 'delta-currency') {
                    const c = deltaCurrencyClass(cell);
                    if (c) classes.push(c);
                  }
                  const tdClass = classes.join(' ');
                  const tdStyle = col.align === 'right' ? { textAlign: 'right' as const } : undefined;
                  return (
                    <td
                      key={col.key}
                      className={tdClass || undefined}
                      style={tdStyle}
                    >
                      {renderCell(cell, col)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
