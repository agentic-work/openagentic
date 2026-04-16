/**
 * ToolUsagePanel - Sidebar section showing personal tool usage analytics
 *
 * Displays the authenticated user's MCP tool call statistics:
 * - Total tool calls and overall success rate
 * - Top tools by usage with per-tool success rates
 * - Recent tool activity timeline
 *
 * Data fetched from GET /api/v1/me/tool-usage on first expand.
 * Follows the same collapsible pattern as MemoryPanel.
 *
 * @copyright 2026 Openagentic LLC
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ChevronRight, ChevronDown, Loader2, AlertCircle, CheckCircle, XCircle, Wrench } from '@/shared/icons';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';

interface ToolStat {
  name: string;
  count: number;
  successRate: number;
}

interface RecentCall {
  tool: string;
  timestamp: string;
  success: boolean;
}

interface ToolUsageData {
  totalToolCalls: number;
  successRate: number;
  topTools: ToolStat[];
  recentActivity: RecentCall[];
  periodDays: number;
}

interface ToolUsagePanelProps {
  isExpanded: boolean;
  theme: string;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export const ToolUsagePanel: React.FC<ToolUsagePanelProps> = ({ isExpanded, theme }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [data, setData] = useState<ToolUsageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const { getAccessToken } = useAuth();
  const hasFetchedRef = useRef(false);

  const fetchUsage = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let token;
      try {
        token = await getAccessToken(['User.Read']);
      } catch {
        token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
      }

      if (!token) {
        setError('Not authenticated');
        setIsLoading(false);
        return;
      }

      const response = await fetch(apiEndpoint('/v1/me/tool-usage?days=30'), {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result: ToolUsageData = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load tool usage');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken]);

  // Fetch data when section is expanded for the first time
  useEffect(() => {
    if (!isCollapsed && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchUsage();
    }
  }, [isCollapsed, fetchUsage]);

  // Don't render when sidebar is collapsed
  if (!isExpanded) return null;

  return (
    <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(prev => !prev)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {isCollapsed ? (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        ) : (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        )}
        <Activity size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
        <span className="text-xs font-medium uppercase tracking-wide flex-1">Tool Usage</span>
        {data && data.totalToolCalls > 0 && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-muted)',
            }}
          >
            {data.totalToolCalls}
          </span>
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 max-h-[320px] overflow-y-auto">
              {/* Loading state */}
              {isLoading && (
                <div className="flex items-center justify-center py-4 gap-2">
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    Loading tool usage...
                  </span>
                </div>
              )}

              {/* Error state */}
              {error && !isLoading && (
                <div className="flex items-center gap-2 py-3 px-2">
                  <AlertCircle size={14} style={{ color: 'var(--color-error)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {error}
                  </span>
                  <button
                    onClick={() => {
                      hasFetchedRef.current = false;
                      fetchUsage();
                    }}
                    className="text-xs underline ml-auto"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Empty state */}
              {!isLoading && !error && data && data.totalToolCalls === 0 && (
                <div className="flex flex-col items-center py-4 gap-1">
                  <Wrench size={18} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    No tool calls yet
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
                    Tool usage will appear here as you interact with MCP tools
                  </span>
                </div>
              )}

              {/* Stats cards */}
              {!isLoading && data && data.totalToolCalls > 0 && (
                <>
                  {/* Summary row */}
                  <div className="flex gap-2 mb-3">
                    {/* Total calls */}
                    <div
                      className="flex-1 rounded-lg px-3 py-2"
                      style={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <div className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        {data.totalToolCalls}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        Total Calls
                      </div>
                    </div>

                    {/* Success rate */}
                    <div
                      className="flex-1 rounded-lg px-3 py-2"
                      style={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <div
                        className="text-lg font-semibold"
                        style={{
                          color: data.successRate >= 0.9
                            ? '#22C55E'
                            : data.successRate >= 0.7
                              ? '#F97316'
                              : '#FF375F',
                        }}
                      >
                        {formatPercent(data.successRate)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        Success
                      </div>
                    </div>
                  </div>

                  {/* Top tools */}
                  <div className="mb-2">
                    <div
                      className="text-[10px] uppercase tracking-wide font-medium px-1 mb-1.5"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      Top Tools ({data.periodDays}d)
                    </div>
                    {data.topTools.slice(0, 5).map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-center gap-2 py-1.5 px-2 rounded-md mb-0.5 transition-colors hover:bg-[var(--color-bg-secondary)]"
                      >
                        {/* Tool name */}
                        <span
                          className="flex-1 text-xs truncate"
                          style={{ color: 'var(--color-text-secondary)' }}
                          title={tool.name}
                        >
                          {tool.name}
                        </span>

                        {/* Count */}
                        <span
                          className="text-[10px] font-medium tabular-nums"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {tool.count}
                        </span>

                        {/* Success rate bar */}
                        <div
                          className="w-10 h-1.5 rounded-full overflow-hidden"
                          style={{ background: 'var(--color-bg-tertiary)' }}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.round(tool.successRate * 100)}%`,
                              background: tool.successRate >= 0.9
                                ? '#22C55E'
                                : tool.successRate >= 0.7
                                  ? '#F97316'
                                  : '#FF375F',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Recent activity toggle */}
                  <button
                    onClick={() => setShowRecent(prev => !prev)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-[var(--color-bg-secondary)]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {showRecent ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                    <span className="text-[10px] uppercase tracking-wide font-medium">
                      Recent Activity
                    </span>
                  </button>

                  {/* Recent activity list */}
                  <AnimatePresence>
                    {showRecent && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        {data.recentActivity.slice(0, 10).map((call, idx) => (
                          <div
                            key={`${call.tool}-${idx}`}
                            className="flex items-center gap-2 py-1 px-2"
                          >
                            {call.success ? (
                              <CheckCircle size={11} style={{ color: '#22C55E', flexShrink: 0 }} />
                            ) : (
                              <XCircle size={11} style={{ color: '#FF375F', flexShrink: 0 }} />
                            )}
                            <span
                              className="flex-1 text-[11px] truncate"
                              style={{ color: 'var(--color-text-secondary)' }}
                              title={call.tool}
                            >
                              {call.tool}
                            </span>
                            <span
                              className="text-[10px] flex-shrink-0"
                              style={{ color: 'var(--color-text-muted)' }}
                            >
                              {formatTimeAgo(call.timestamp)}
                            </span>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Refresh button */}
                  <button
                    onClick={fetchUsage}
                    className="w-full text-center text-[10px] py-1.5 mt-1 rounded transition-colors hover:bg-[var(--color-bg-secondary)]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Refresh
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ToolUsagePanel;
