import React, { useRef, useMemo, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Excel-style table components for Admin Console
 * Uses CSS variables for theming - no hardcoded colors
 *
 * Features:
 * - Virtual scrolling for large datasets (only renders visible rows)
 * - Solid accent color headers (using --color-primary)
 * - Alternating row colors (5%/10% primary tint)
 * - Cell borders (10% primary)
 * - Hover highlighting (15% primary)
 * - Optional pagination
 * - Column sorting
 * - Same API as before -- drop-in replacement
 */

export interface AdminTableColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
}

export interface AdminTableProps<T> {
  columns: AdminTableColumn<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
  emptyMessage?: string;
  loading?: boolean;
  compact?: boolean;
  stickyHeader?: boolean;
  maxHeight?: string;
  // New: optional pagination
  pageSize?: number;
  // New: sort state
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
}

// Threshold: virtualize when data exceeds this many rows
const VIRTUALIZE_THRESHOLD = 50;
const ROW_HEIGHT_COMPACT = 36;
const ROW_HEIGHT_NORMAL = 44;

export function AdminTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = 'No data available',
  loading = false,
  compact = false,
  stickyHeader = false,
  maxHeight,
  pageSize,
  defaultSort,
}: AdminTableProps<T>) {
  const cellPadding = compact ? 'px-3 py-2' : 'px-4 py-3';
  const rowHeight = compact ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_NORMAL;
  const parentRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [sortState, setSortState] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(defaultSort || null);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortState) return data;
    const { key, direction } = sortState;
    return [...data].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[key];
      const bVal = (b as Record<string, unknown>)[key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return direction === 'asc' ? cmp : -cmp;
    });
  }, [data, sortState]);

  // Paginate
  const pagedData = useMemo(() => {
    if (!pageSize) return sortedData;
    const start = page * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, page, pageSize]);

  const totalPages = pageSize ? Math.ceil(sortedData.length / pageSize) : 1;
  const shouldVirtualize = pagedData.length > VIRTUALIZE_THRESHOLD && !!maxHeight;

  const handleSort = useCallback((key: string) => {
    setSortState(prev => {
      if (prev?.key === key) {
        return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
      }
      return { key, direction: 'asc' };
    });
  }, []);

  // Virtual row renderer
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? pagedData.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const renderRow = useCallback((row: T, rowIndex: number) => (
    <tr
      key={keyExtractor(row, rowIndex)}
      onClick={() => onRowClick?.(row, rowIndex)}
      className="transition-colors"
      style={{
        backgroundColor: rowIndex % 2 === 0
          ? 'color-mix(in srgb, var(--color-primary) 5%, var(--color-surface))'
          : 'color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))',
        cursor: onRowClick ? 'pointer' : undefined,
        height: rowHeight,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor =
          'color-mix(in srgb, var(--color-primary) 15%, var(--color-surface))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = rowIndex % 2 === 0
          ? 'color-mix(in srgb, var(--color-primary) 5%, var(--color-surface))'
          : 'color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))';
      }}
    >
      {columns.map((col) => (
        <td
          key={col.key}
          className={cellPadding}
          style={{
            textAlign: col.align || 'left',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-sm)',
            borderRight: '1px solid color-mix(in srgb, var(--color-primary) 10%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--color-primary) 10%, transparent)',
          }}
        >
          {col.render
            ? col.render((row as Record<string, unknown>)[col.key], row, rowIndex)
            : String((row as Record<string, unknown>)[col.key] ?? '')}
        </td>
      ))}
    </tr>
  ), [columns, cellPadding, onRowClick, keyExtractor, rowHeight]);

  return (
    <div>
      <div
        ref={parentRef}
        className="w-full rounded-lg overflow-hidden"
        style={{
          border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
          maxHeight: maxHeight,
          overflowY: maxHeight ? 'auto' : undefined,
        }}
      >
        <table className="w-full border-collapse" style={{ tableLayout: shouldVirtualize ? 'fixed' : undefined }}>
          {/* Header */}
          <thead>
            <tr
              style={{
                backgroundColor: 'var(--color-primary)',
                position: stickyHeader || shouldVirtualize ? 'sticky' : undefined,
                top: 0,
                zIndex: 10,
              }}
            >
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${cellPadding} text-left font-semibold`}
                  style={{
                    width: col.width,
                    textAlign: col.align || 'left',
                    color: '#FFFFFF',
                    fontSize: 'var(--text-sm)',
                    borderRight: '1px solid rgba(255, 255, 255, 0.1)',
                    cursor: col.sortable !== false ? 'pointer' : undefined,
                    userSelect: 'none',
                  }}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  {col.header}
                  {sortState?.key === col.key && (
                    <span style={{ marginLeft: 4, opacity: 0.7 }}>
                      {sortState.direction === 'asc' ? '\u25B2' : '\u25BC'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-primary)' }} />
                    Loading...
                  </div>
                </td>
              </tr>
            ) : pagedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : shouldVirtualize ? (
              <>
                {/* Spacer for virtual scroll */}
                <tr style={{ height: virtualizer.getVirtualItems()[0]?.start || 0 }}><td colSpan={columns.length} style={{ padding: 0, border: 'none' }} /></tr>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = pagedData[virtualRow.index];
                  return renderRow(row, virtualRow.index);
                })}
                <tr style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end || 0) }}><td colSpan={columns.length} style={{ padding: 0, border: 'none' }} /></tr>
              </>
            ) : (
              pagedData.map((row, rowIndex) => renderRow(row, rowIndex))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageSize && totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, sortedData.length)} of {sortedData.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded text-xs transition-colors"
              style={{
                color: page === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                cursor: page === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Prev
            </button>
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)', padding: '0 8px' }}>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded text-xs transition-colors"
              style={{
                color: page >= totalPages - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Table action button for row actions
 */
export const TableActionButton: React.FC<{
  onClick: (e: React.MouseEvent) => void;
  variant?: 'default' | 'danger' | 'success';
  title?: string;
  children: React.ReactNode;
}> = ({ onClick, variant = 'default', title, children }) => {
  const getColor = () => {
    switch (variant) {
      case 'danger': return 'var(--color-error)';
      case 'success': return 'var(--color-success)';
      default: return 'var(--color-primary)';
    }
  };

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      title={title}
      className="p-1.5 rounded transition-colors"
      style={{ color: getColor(), backgroundColor: 'transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `color-mix(in srgb, ${getColor()} 15%, transparent)`; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {children}
    </button>
  );
};

/**
 * Status badge for table cells
 */
export const TableBadge: React.FC<{
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  children: React.ReactNode;
}> = ({ variant, children }) => {
  const styles = useMemo(() => {
    const base = { padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)', fontWeight: '500', display: 'inline-flex' as const, alignItems: 'center' as const, gap: '4px' };
    switch (variant) {
      case 'success': return { ...base, backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' };
      case 'warning': return { ...base, backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)', color: 'var(--color-warning)' };
      case 'error': return { ...base, backgroundColor: 'color-mix(in srgb, var(--color-error) 15%, transparent)', color: 'var(--color-error)' };
      case 'info': return { ...base, backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)' };
      default: return { ...base, backgroundColor: 'var(--color-surfaceTertiary)', color: 'var(--text-secondary)' };
    }
  }, [variant]);

  return <span style={styles}>{children}</span>;
};

export default AdminTable;
