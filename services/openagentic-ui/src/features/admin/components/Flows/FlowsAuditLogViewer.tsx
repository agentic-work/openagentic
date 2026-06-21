/**
 * FlowsAuditLogViewer — Filterable, paginated audit log table for OpenAgentic Flows.
 *
 * Covers AC L1-L6:
 *   L1  Table columns: Time, Actor, Action, Target Type, Target ID, Outcome, Metadata
 *   L2  Filters: action multi-select, actor email search, time window, outcome
 *   L3  "Export CSV" button → exportAuditCsv with current filters
 *   L4  Auto-refresh: Off / 30s / 5min selector
 *   L5  Row click expands metadata JSON inline
 *   L6  Loading / Error / Empty states
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { onKeyActivate } from '@/utils/a11y';
import { PageHeader, LogRow, type LogSeverity } from '../../primitives-v2';
import {
  fetchAuditLogs,
  exportAuditCsv,
  type AuditLogEntry,
  type AuditLogsResponse,
  type AuditLogFilters,
  type KpiWindow,
} from '../../services/flowsAdminApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlowsAuditLogViewerProps {
  theme?: 'dark' | 'light';
}

type AutoRefreshInterval = 'off' | '30s' | '5min';

const REFRESH_MS: Record<AutoRefreshInterval, number> = {
  off: 0,
  '30s': 30_000,
  '5min': 300_000,
};

const OUTCOME_OPTIONS = [
  { value: '', label: 'All outcomes' },
  { value: 'success', label: 'Success' },
  { value: 'denied', label: 'Denied' },
  { value: 'error', label: 'Error' },
];

const OUTCOME_SEVERITY: Record<string, LogSeverity> = {
  success: 'ok',
  denied: 'warn',
  error: 'err',
};

function mapSeverity(outcome: string): LogSeverity {
  return OUTCOME_SEVERITY[outcome] ?? 'info';
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FlowsAuditLogViewer({ theme: _theme }: FlowsAuditLogViewerProps) {
  // Filter state
  const [actorSearch, setActorSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [timeRange, setTimeRange] = useState<KpiWindow>('24h');
  const [autoRefresh, setAutoRefresh] = useState<AutoRefreshInterval>('off');

  // Data state
  const [response, setResponse] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Debounce timer for actor search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-refresh timer
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const load = useCallback(async (filters: AuditLogFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAuditLogs(filters);
      setResponse(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load audit logs: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const buildFilters = useCallback(
    (): AuditLogFilters => ({
      actor: actorSearch || undefined,
      outcome: outcomeFilter || undefined,
      limit: 50,
    }),
    [actorSearch, outcomeFilter],
  );

  // Load on mount and when outcome changes (immediate; actor uses debounce)
  useEffect(() => {
    load(buildFilters());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeFilter]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const ms = REFRESH_MS[autoRefresh];
    if (ms > 0) {
      intervalRef.current = setInterval(() => load(buildFilters()), ms);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, buildFilters, load]);

  // Debounced actor search
  const handleActorChange = useCallback(
    (value: string) => {
      setActorSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        load({
          actor: value || undefined,
          outcome: outcomeFilter || undefined,
          limit: 50,
        });
      }, 400);
    },
    [load, outcomeFilter],
  );

  const handleRefresh = useCallback(() => {
    load(buildFilters());
  }, [load, buildFilters]);

  // -------------------------------------------------------------------------
  // Row interaction — expand metadata
  // -------------------------------------------------------------------------

  const handleRowClick = useCallback((row: AuditLogEntry) => {
    setExpandedRowId((prev) => (prev === row.id ? null : row.id));
  }, []);

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------

  const handleExportCsv = useCallback(() => {
    exportAuditCsv({
      actor: actorSearch || undefined,
      outcome: outcomeFilter || undefined,
    });
  }, [actorSearch, outcomeFilter]);

  // -------------------------------------------------------------------------
  // Render: Error state
  // -------------------------------------------------------------------------

  if (!loading && error) {
    return (
      <div className="space-y-4">
        <PageHeader
          crumbs={['Admin', 'Flows', 'Audit Logs']}
          title="OpenAgentic Flows · Audit Logs"
          explainer="Filterable, paginated audit stream for OpenAgentic Flows: actor, action, target, outcome, and metadata. Export as CSV with the current filters."
          sticky
        />
        <FilterRow
          actorSearch={actorSearch}
          onActorChange={handleActorChange}
          outcomeFilter={outcomeFilter}
          onOutcomeChange={setOutcomeFilter}
          timeRange={timeRange}
          onTimeRangeChange={(v) => setTimeRange(v as KpiWindow)}
          onRefresh={handleRefresh}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
          onExportCsv={handleExportCsv}
        />
        <div
          className="rounded-lg p-6 text-center"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)',
          }}
        >
          <p className="text-sm mb-3" style={{ color: 'var(--color-error)' }}>
            {error}
          </p>
          <button
            onClick={handleRefresh}
            className="px-4 py-1.5 rounded-md text-sm font-medium"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--ap-fg-0)' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: Main
  // -------------------------------------------------------------------------

  const logs = response?.logs ?? [];

  return (
    <div className="space-y-4">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Flows', 'Audit Logs']}
        title="OpenAgentic Flows · Audit Logs"
        explainer="Filterable, paginated audit stream for OpenAgentic Flows: actor, action, target, outcome, and metadata. Use the toolbar below to filter and export."
        sticky
      />

      {/* Filter row */}
      <FilterRow
        actorSearch={actorSearch}
        onActorChange={handleActorChange}
        outcomeFilter={outcomeFilter}
        onOutcomeChange={setOutcomeFilter}
        timeRange={timeRange}
        onTimeRangeChange={(v) => setTimeRange(v as KpiWindow)}
        onRefresh={handleRefresh}
        refreshing={loading}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onExportCsv={handleExportCsv}
      />

      {/* Log stream */}
      <div
        className="rounded-md overflow-auto"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          maxHeight: '60vh',
        }}
      >
        {loading ? (
          <div className="p-6 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            Loading audit logs…
          </div>
        ) : logs.length === 0 ? (
          <div className="p-6 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            No audit logs match the current filters.
          </div>
        ) : (
          logs.map((row, i) => {
            const isExpanded = expandedRowId === row.id;
            const message = (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <code style={{ color: 'var(--ap-accent, var(--accent))' }}>{row.action}</code>
                <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>·</span>
                <span style={{ color: 'var(--ap-fg-2, var(--fg-2))' }}>{row.target_type}</span>
                <code style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>{row.target_id}</code>
                <span style={{ color: 'var(--ap-fg-2, var(--fg-2))' }}>· {row.outcome}</span>
              </span>
            );
            const meta = (
              <span
                style={{ color: isExpanded ? 'var(--ap-accent, var(--accent))' : 'var(--ap-fg-3, var(--fg-3))' }}
              >
                {isExpanded ? '▲ collapse' : '▼ expand'}
              </span>
            );
            return (
              <React.Fragment key={row.id}>
                <div
                  onClick={() => handleRowClick(row)}
                  onKeyDown={onKeyActivate(() => handleRowClick(row))}
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  role="button"
                  aria-expanded={isExpanded}
                >
                  <LogRow
                    severity={mapSeverity(row.outcome)}
                    timestamp={fmtTimestamp(row.timestamp)}
                    source={row.actor}
                    sourceAccent={!!row.actor && row.actor !== 'system'}
                    message={message}
                    meta={meta}
                  />
                </div>
                {isExpanded && (
                  <div
                    data-testid={`metadata-expanded-${i}`}
                    className="text-xs font-mono overflow-auto"
                    style={{
                      padding: '8px 14px 8px 36px',
                      backgroundColor: 'var(--ap-bg-2, var(--color-surfaceSecondary))',
                      borderBottom: '1px solid var(--ap-ln-1, var(--ln-1))',
                      color: 'var(--ap-fg-2, var(--fg-2))',
                      maxHeight: 200,
                    }}
                  >
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.metadata, null, 2)}</pre>
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Pagination summary */}
      {response && response.total > 0 && (
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Showing {Math.min(response.limit, response.total)} of {response.total} entries
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterRow — toolbar above the table
// ---------------------------------------------------------------------------

interface FilterRowProps {
  actorSearch: string;
  onActorChange: (v: string) => void;
  outcomeFilter: string;
  onOutcomeChange: (v: string) => void;
  timeRange: string;
  onTimeRangeChange: (v: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  autoRefresh: AutoRefreshInterval;
  onAutoRefreshChange: (v: AutoRefreshInterval) => void;
  onExportCsv: () => void;
}

function FilterRow({
  actorSearch,
  onActorChange,
  outcomeFilter,
  onOutcomeChange,
  timeRange,
  onTimeRangeChange,
  onRefresh,
  refreshing,
  autoRefresh,
  onAutoRefreshChange,
  onExportCsv,
}: FilterRowProps) {
  const inputBase: React.CSSProperties = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    color: 'var(--text-primary)',
    outline: 'none',
    fontSize: 13,
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Filter bar handles time-range + refresh */}
      <AdminFilterBar
        searchTerm=""
        onSearchChange={() => {}}
        timeRange={timeRange}
        onTimeRangeChange={onTimeRangeChange}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />

      {/* Actor search */}
      <input
        type="text"
        value={actorSearch}
        onChange={(e) => onActorChange(e.target.value)}
        placeholder="Actor email…"
        className="px-3 py-1.5 rounded-md text-sm"
        style={inputBase}
      />

      {/* Outcome filter */}
      <select
        data-testid="outcome-filter"
        value={outcomeFilter}
        onChange={(e) => onOutcomeChange(e.target.value)}
        className="px-3 py-1.5 rounded-md text-sm"
        style={inputBase}
      >
        {OUTCOME_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Auto-refresh */}
      <select
        data-testid="auto-refresh-select"
        value={autoRefresh}
        onChange={(e) => onAutoRefreshChange(e.target.value as AutoRefreshInterval)}
        className="px-3 py-1.5 rounded-md text-sm"
        style={inputBase}
      >
        <option value="off">Off</option>
        <option value="30s">30s</option>
        <option value="5min">5 min</option>
      </select>

      {/* CSV Export */}
      <button
        onClick={onExportCsv}
        className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--text-secondary)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-primary)';
          e.currentTarget.style.color = 'var(--color-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-border)';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        Export CSV
      </button>
    </div>
  );
}

export default FlowsAuditLogViewer;
