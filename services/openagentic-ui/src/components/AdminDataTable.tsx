/**
 * AdminDataTable - Clean, Professional Data Table Component
 *
 * Design principles (Vercel/Stripe/Linear inspired):
 * - Minimal borders, generous whitespace
 * - Subtle hover states
 * - Clear typography hierarchy
 * - Muted header, not bold colors
 */
import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, Search, ChevronLeft, ChevronRight } from '@/shared/icons';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  width?: string;
  minWidth?: string;
  sortable?: boolean;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

export interface AdminDataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyField: keyof T;
  title?: string;
  description?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyMessage?: string;
  loading?: boolean;
  onRowClick?: (row: T, index: number) => void;
  selectedRows?: Set<string | number>;
  onSelectionChange?: (selected: Set<string | number>) => void;
  actions?: React.ReactNode;
  stickyHeader?: boolean;
  maxHeight?: string;
  striped?: boolean;
  compact?: boolean;
}

type SortDirection = 'asc' | 'desc' | null;

function AdminDataTable<T extends Record<string, any>>({
  data,
  columns,
  keyField,
  title,
  description,
  searchable = false,
  searchPlaceholder = 'Search...',
  pageSize = 10,
  emptyMessage = 'No data available',
  loading = false,
  onRowClick,
  selectedRows,
  onSelectionChange,
  actions,
  stickyHeader = false,
  maxHeight,
  striped = false,
  compact = false,
}: AdminDataTableProps<T>) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter data based on search term
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const search = searchTerm.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const value = getNestedValue(row, col.key as string);
        return value?.toString().toLowerCase().includes(search);
      })
    );
  }, [data, searchTerm, columns]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortKey || !sortDirection) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = getNestedValue(a, sortKey);
      const bVal = getNestedValue(b, sortKey);

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime();
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortKey, sortDirection]);

  // Paginate data
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  // Handle sort
  const handleSort = (key: string) => {
    if (sortKey === key) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortKey(null);
      } else {
        setSortDirection('asc');
      }
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  // Handle row selection
  const handleSelectAll = (checked: boolean) => {
    if (!onSelectionChange) return;
    if (checked) {
      const allKeys = new Set(paginatedData.map((row) => row[keyField]));
      onSelectionChange(allKeys);
    } else {
      onSelectionChange(new Set());
    }
  };

  const handleSelectRow = (key: string | number, checked: boolean) => {
    if (!onSelectionChange || !selectedRows) return;
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(key);
    } else {
      newSelected.delete(key);
    }
    onSelectionChange(newSelected);
  };

  const isAllSelected = paginatedData.length > 0 &&
    paginatedData.every((row) => selectedRows?.has(row[keyField]));

  const cellPadding = compact ? 'px-4 py-2.5' : 'px-5 py-4';
  const headerPadding = compact ? 'px-4 py-2.5' : 'px-5 py-3';

  return (
    <div
      className="admin-table-container"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: '12px',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
      }}
    >
      {/* Header with title, search, and actions */}
      {(title || searchable || actions) && (
        <div
          className="flex items-center justify-between gap-4"
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div className="flex flex-col gap-1">
            {title && (
              <h3
                className="font-semibold"
                style={{
                  color: 'var(--color-text)',
                  fontSize: '16px',
                  letterSpacing: '-0.01em',
                }}
              >
                {title}
              </h3>
            )}
            {description && (
              <p style={{ color: 'var(--color-textMuted)', fontSize: '13px' }}>
                {description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {searchable && (
              <div className="relative">
                <Search
                  className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2"
                  style={{ color: 'var(--color-textMuted)' }}
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={searchPlaceholder}
                  className="admin-search-input"
                  style={{
                    width: '240px',
                    paddingLeft: '36px',
                    paddingRight: '12px',
                    paddingTop: '8px',
                    paddingBottom: '8px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surfaceSecondary)',
                    color: 'var(--color-text)',
                    fontSize: '13px',
                    outline: 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                />
              </div>
            )}
            {actions}
          </div>
        </div>
      )}

      {/* Table container */}
      <div
        className={stickyHeader ? 'overflow-auto' : ''}
        style={{ maxHeight: maxHeight || 'none' }}
      >
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead className={stickyHeader ? 'sticky top-0 z-10' : ''}>
            <tr
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              {/* Selection checkbox column */}
              {onSelectionChange && (
                <th className={headerPadding} style={{ width: '48px' }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="admin-checkbox"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key as string}
                  onClick={() => col.sortable && handleSort(col.key as string)}
                  className={`${headerPadding} text-${col.align || 'left'} ${col.sortable ? 'cursor-pointer select-none' : ''}`}
                  style={{
                    color: 'var(--color-textMuted)',
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    width: col.width,
                    minWidth: col.minWidth || '80px',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => col.sortable && (e.currentTarget.style.color = 'var(--color-text)')}
                  onMouseLeave={(e) => col.sortable && (e.currentTarget.style.color = 'var(--color-textMuted)')}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{col.header}</span>
                    {col.sortable && sortKey === col.key && (
                      <span className="flex items-center">
                        {sortDirection === 'asc' ? (
                          <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + (onSelectionChange ? 1 : 0)} className="text-center py-12">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div
                      className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                      style={{ borderColor: 'var(--color-border)', borderTopColor: 'transparent' }}
                    />
                    <span style={{ color: 'var(--color-textMuted)', fontSize: '13px' }}>Loading...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (onSelectionChange ? 1 : 0)}
                  className="text-center py-12"
                  style={{ color: 'var(--color-textMuted)', fontSize: '13px' }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((row, rowIndex) => {
                const rowKey = row[keyField];
                const isSelected = selectedRows?.has(rowKey);
                const isEvenRow = rowIndex % 2 === 0;
                const globalIndex = (currentPage - 1) * pageSize + rowIndex;

                return (
                  <tr
                    key={rowKey}
                    onClick={() => onRowClick?.(row, globalIndex)}
                    className="admin-table-row"
                    style={{
                      backgroundColor: isSelected
                        ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)'
                        : striped && !isEvenRow
                          ? 'var(--color-surfaceSecondary)'
                          : 'transparent',
                      borderBottom: '1px solid var(--color-border)',
                      cursor: onRowClick ? 'pointer' : 'default',
                      transition: 'background-color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = striped && !isEvenRow
                          ? 'var(--color-surfaceSecondary)'
                          : 'transparent';
                      }
                    }}
                  >
                    {/* Selection checkbox */}
                    {onSelectionChange && (
                      <td className={cellPadding} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => handleSelectRow(rowKey, e.target.checked)}
                          className="admin-checkbox"
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      const value = getNestedValue(row, col.key as string);
                      return (
                        <td
                          key={col.key as string}
                          className={`${cellPadding} text-${col.align || 'left'} ${col.className || ''}`}
                          style={{
                            color: 'var(--color-text)',
                            fontSize: '14px',
                          }}
                        >
                          {col.render ? col.render(value, row, globalIndex) : formatCellValue(value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-between"
          style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surfaceSecondary)',
          }}
        >
          <div style={{ color: 'var(--color-textMuted)', fontSize: '13px' }}>
            {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length}
            {searchTerm && ` (filtered)`}
          </div>
          <div className="flex items-center gap-1">
            <PaginationButton
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
              <ChevronLeft className="w-4 h-4 -ml-2.5" />
            </PaginationButton>
            <PaginationButton
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </PaginationButton>

            {/* Page numbers */}
            <div className="flex items-center gap-0.5 mx-1">
              {getPageNumbers(currentPage, totalPages).map((page, idx) => (
                page === '...' ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-2 py-1"
                    style={{ color: 'var(--color-textMuted)', fontSize: '13px' }}
                  >
                    ···
                  </span>
                ) : (
                  <PaginationButton
                    key={page}
                    onClick={() => setCurrentPage(page as number)}
                    active={currentPage === page}
                  >
                    {page}
                  </PaginationButton>
                )
              ))}
            </div>

            <PaginationButton
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </PaginationButton>
            <PaginationButton
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
              <ChevronRight className="w-4 h-4 -ml-2.5" />
            </PaginationButton>
          </div>
        </div>
      )}
    </div>
  );
}

// Pagination button component
interface PaginationButtonProps {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}

function PaginationButton({ onClick, disabled, active, children }: PaginationButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center"
      style={{
        padding: '6px 10px',
        borderRadius: '6px',
        fontSize: '13px',
        fontWeight: active ? 500 : 400,
        color: active ? 'white' : disabled ? 'var(--color-textMuted)' : 'var(--color-text)',
        backgroundColor: active ? 'var(--color-primary)' : 'transparent',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background-color 0.15s, color 0.15s',
        minWidth: '32px',
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
    >
      {children}
    </button>
  );
}

// Helper function to get nested object values using dot notation
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

// Helper function to format cell values
function formatCellValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Helper function to generate page numbers with ellipsis
function getPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | string)[] = [];

  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  } else if (current >= total - 3) {
    pages.push(1);
    pages.push('...');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    pages.push('...');
    for (let i = current - 1; i <= current + 1; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  }

  return pages;
}

export default AdminDataTable;
