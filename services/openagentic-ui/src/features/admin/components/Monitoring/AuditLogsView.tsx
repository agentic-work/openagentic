import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Filter, Download, ChevronDown, ChevronRight, Calendar,
  Code, Terminal, Play, Activity, Shield, CheckCircle, XCircle,
  Timer as Clock, RefreshCw, User, AlertTriangle, Database,
  Eye, GitBranch
} from '../Shared/AdminIcons';
import { apiRequest } from '../../../../utils/api';
import { PageHeader, LogRow, type LogSeverity } from '../../primitives-v2';

// ─── Types ───────────────────────────────────────────────────────────────────

type AuditTab = 'chat' | 'code' | 'flows';
type DateRange = '1h' | '24h' | '7d' | '30d' | 'all';

interface SessionLog {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  title: string;
  summary?: string;
  messageCount: number;
  userQueries: number;
  aiResponses: number;
  firstQuery: string;
  model: string;
  totalTokens: number | string | null;
  totalCost: number | string | null;
  mcpCallsCount: number;
  toolExecutionsCount: number;
  conversation: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  tokens?: number | string | null;
  cost?: number | string | null;
  hasMcpCalls: boolean;
  hasToolCalls: boolean;
  timestamp: string;
}

interface CodeSession {
  id: string;
  user_id: string;
  status: string;
  pod_name?: string;
  created_at: string;
  last_activity?: string;
  updated_at?: string;
  user?: { email: string; name: string };
}

interface FlowExecution {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  trigger_type: string;
  total_nodes: number;
  completed_nodes: number;
  execution_time_ms: number | null;
  cost: number | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

interface TabStats {
  primary: { label: string; value: number | string; sub?: string };
  secondary: { label: string; value: number | string; sub?: string };
  tertiary: { label: string; value: number | string; sub?: string };
  quaternary: { label: string; value: number | string; sub?: string };
}

interface AuditLogsViewProps {
  theme: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = {
  cost: (v?: number | string | null) => {
    if (v === null || v === undefined) return '$0.00';
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return isNaN(n) ? '$0.00' : `$${n.toFixed(4)}`;
  },
  tokens: (v?: number | string | null) => {
    if (v === null || v === undefined) return '0';
    const n = typeof v === 'string' ? parseInt(v, 10) : v;
    return isNaN(n) ? '0' : n.toLocaleString();
  },
  ts: (v: string) => {
    const d = new Date(v);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  },
  tsShort: (v: string) => {
    const d = new Date(v);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  dur: (ms: number | null) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  },
  ago: (v: string) => {
    const diff = Date.now() - new Date(v).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }
};

function statusToSeverity(status: string): LogSeverity {
  const s = status.toLowerCase();
  if (['completed', 'succeeded', 'success', 'active'].includes(s)) return 'ok';
  if (['failed', 'error'].includes(s)) return 'err';
  if (['running', 'suspended', 'pending'].includes(s)) return 'warn';
  return 'info';
}

function statusDot(status: string) {
  const map: Record<string, string> = {
    active: 'var(--color-success)', running: 'var(--ap-warn)', completed: 'var(--color-success)', succeeded: 'var(--color-success)',
    success: 'var(--color-success)', failed: 'var(--ap-err)', error: 'var(--ap-err)', pending: 'var(--color-textMuted)',
    suspended: 'var(--ap-warn)', deleted: 'var(--color-textMuted)', cancelled: 'var(--color-textMuted)',
  };
  const color = map[status.toLowerCase()] || 'var(--color-textMuted)';
  return (
    <span
      style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: color, boxShadow: `0 0 6px color-mix(in srgb, ${color} 50%, transparent)` }}
    />
  );
}

function getDateStart(range: DateRange): Date | null {
  const now = Date.now();
  switch (range) {
    case '1h': return new Date(now - 3600000);
    case '24h': return new Date(now - 86400000);
    case '7d': return new Date(now - 7 * 86400000);
    case '30d': return new Date(now - 30 * 86400000);
    default: return null;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ theme }) => {
  const isDark = theme === 'dark';

  // Global state
  const [activeTab, setActiveTab] = useState<AuditTab>('chat');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Tab counts
  const [chatCount, setChatCount] = useState(0);
  const [codeCount, setCodeCount] = useState(0);
  const [flowsCount, setFlowsCount] = useState(0);

  // Chat state
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [chatStats, setChatStats] = useState<any>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  // Code state
  const [codeSessions, setCodeSessions] = useState<CodeSession[]>([]);
  const [codeStats, setCodeStats] = useState<any>(null);

  // Flows state
  const [flowExecutions, setFlowExecutions] = useState<FlowExecution[]>([]);
  const [flowStats, setFlowStats] = useState<any>(null);

  // ── Fetch: Chat ──────────────────────────────────────────────────────────

  const fetchChat = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: currentPage.toString(), limit: '25' });
      const start = getDateStart(dateRange);
      if (start) params.append('startDate', start.toISOString());
      if (searchTerm) params.append('searchTerm', searchTerm);

      const [sessRes, statsRes] = await Promise.all([
        apiRequest(`/admin/audit-logs/sessions?${params}`),
        apiRequest('/admin/audit-logs/stats'),
      ]);
      if (!sessRes.ok) throw new Error('Failed to fetch chat sessions');
      const sessData = await sessRes.json();
      const statsData = statsRes.ok ? await statsRes.json() : null;

      setSessions(sessData.sessions || []);
      setTotalPages(sessData.pagination?.totalPages || 1);
      setChatCount(sessData.pagination?.total || sessData.sessions?.length || 0);
      setChatStats(statsData);
    } catch (err: any) {
      throw err;
    }
  }, [currentPage, dateRange, searchTerm]);

  // ── Fetch: Code ──────────────────────────────────────────────────────────

  const fetchCode = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      const [sessRes, statsRes] = await Promise.all([
        apiRequest(`/admin/code/sessions?${params}`),
        apiRequest('/admin/code/stats'),
      ]);
      if (!sessRes.ok) throw new Error('Failed to fetch code sessions');
      const sessData = await sessRes.json();
      const statsData = statsRes.ok ? await statsRes.json() : null;

      let cSessions = sessData.sessions || [];

      // Filter by date range
      const start = getDateStart(dateRange);
      if (start) {
        cSessions = cSessions.filter((s: CodeSession) => new Date(s.created_at) >= start);
      }

      // Filter by search
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        cSessions = cSessions.filter((s: CodeSession) =>
          s.id.toLowerCase().includes(q) ||
          s.user_id.toLowerCase().includes(q) ||
          (s.pod_name || '').toLowerCase().includes(q) ||
          s.status.toLowerCase().includes(q) ||
          (s.user?.email || '').toLowerCase().includes(q)
        );
      }

      setCodeSessions(cSessions);
      setCodeCount(cSessions.length);
      setCodeStats(statsData);
      setTotalPages(Math.ceil(cSessions.length / 25) || 1);
    } catch (err: any) {
      throw err;
    }
  }, [dateRange, searchTerm]);

  // ── Fetch: Flows ─────────────────────────────────────────────────────────

  const fetchFlows = useCallback(async () => {
    try {
      // Fetch all workflows first
      const wfRes = await apiRequest('/workflows?limit=100');
      if (!wfRes.ok) throw new Error('Failed to fetch workflows');
      const wfData = await wfRes.json();
      const workflows = wfData.workflows || [];

      // Fetch executions for each workflow
      const allExecs: FlowExecution[] = [];
      const execPromises = workflows.slice(0, 20).map(async (wf: any) => {
        try {
          const exRes = await apiRequest(`/workflows/${wf.id}/executions?limit=20`);
          if (!exRes.ok) return;
          const exData = await exRes.json();
          for (const ex of exData.executions || []) {
            allExecs.push({ ...ex, workflow_name: wf.name, workflow_id: wf.id });
          }
        } catch { /* skip workflow */ }
      });
      await Promise.all(execPromises);

      // Sort by most recent
      allExecs.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

      // Filter by date range
      const start = getDateStart(dateRange);
      let filtered = start ? allExecs.filter(e => new Date(e.started_at) >= start) : allExecs;

      // Filter by search
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        filtered = filtered.filter(e =>
          e.workflow_name.toLowerCase().includes(q) ||
          e.status.toLowerCase().includes(q) ||
          e.trigger_type.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q)
        );
      }

      // Stats
      const completed = filtered.filter(e => e.status === 'completed').length;
      const failed = filtered.filter(e => e.status === 'failed').length;
      const running = filtered.filter(e => e.status === 'running').length;
      const avgDur = filtered.filter(e => e.execution_time_ms).reduce((a, e) => a + (e.execution_time_ms || 0), 0) / (filtered.filter(e => e.execution_time_ms).length || 1);

      setFlowExecutions(filtered);
      setFlowsCount(filtered.length);
      setFlowStats({ total: filtered.length, completed, failed, running, workflows: workflows.length, avgDuration: avgDur });
      setTotalPages(Math.ceil(filtered.length / 25) || 1);
    } catch (err: any) {
      throw err;
    }
  }, [dateRange, searchTerm]);

  // ── Master fetch ─────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'chat') await fetchChat();
      else if (activeTab === 'code') await fetchCode();
      else await fetchFlows();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeTab, fetchChat, fetchCode, fetchFlows]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch all counts on mount
  const countsLoaded = useRef(false);
  useEffect(() => {
    if (countsLoaded.current) return;
    countsLoaded.current = true;
    // Fire-and-forget count fetches for non-active tabs
    apiRequest('/admin/audit-logs/sessions?limit=1')
      .then(r => r.json()).then(d => setChatCount(d.pagination?.total || 0)).catch(() => {});
    apiRequest('/admin/code/stats')
      .then(r => r.json()).then(d => setCodeCount(d.sessions?.total || 0)).catch(() => {});
    apiRequest('/workflows?limit=1')
      .then(r => r.json()).then(d => setFlowsCount(d.total || d.workflows?.length || 0)).catch(() => {});
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(fetchData, 30000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchData]);

  // Tab change resets page
  const switchTab = (tab: AuditTab) => {
    setActiveTab(tab);
    setCurrentPage(1);
    setExpandedSessions(new Set());
  };

  // ── Export ───────────────────────────────────────────────────────────────

  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    try {
      if (activeTab === 'chat') {
        const params = new URLSearchParams({ format });
        const start = getDateStart(dateRange);
        if (start) params.append('startDate', start.toISOString());
        const res = await apiRequest(`/admin/audit-logs/export?${params}`);
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-${activeTab}-${new Date().toISOString().split('T')[0]}.${format}`;
        document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); document.body.removeChild(a);
      } else {
        // Client-side export for code/flows
        const data = activeTab === 'code' ? codeSessions : flowExecutions;
        const blob = format === 'json'
          ? new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          : new Blob([toCSV(data)], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-${activeTab}-${new Date().toISOString().split('T')[0]}.${format}`;
        document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); document.body.removeChild(a);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  // ── Stats per tab ────────────────────────────────────────────────────────

  const getStats = (): TabStats | null => {
    if (activeTab === 'chat' && chatStats) {
      return {
        primary: { label: 'Sessions', value: chatStats.user?.totalQueries || sessions.length, sub: `${chatStats.user?.recent24h || 0} today` },
        secondary: { label: 'Admin Actions', value: chatStats.admin?.recent7d || 0, sub: `${chatStats.admin?.recent24h || 0} today` },
        tertiary: { label: 'Failed', value: chatStats.user?.failedQueries24h || 0, sub: 'last 24h' },
        quaternary: { label: 'Total Records', value: (chatStats.admin?.totalActions || 0) + (chatStats.user?.totalQueries || 0), sub: 'all time' },
      };
    }
    if (activeTab === 'code' && codeStats) {
      return {
        primary: { label: 'Active Sessions', value: codeStats.sessions?.active || 0, sub: `of ${codeStats.sessions?.total || 0}` },
        secondary: { label: 'Enabled Users', value: codeStats.users?.enabled || 0, sub: `${codeStats.users?.enabledPercentage || 0}%` },
        tertiary: { label: 'Executions (24h)', value: codeStats.executions?.last24h || 0, sub: `${codeStats.executions?.total || 0} total` },
        quaternary: { label: 'Storage', value: `${codeStats.storage?.totalMb || 0} MB`, sub: 'workspace snapshots' },
      };
    }
    if (activeTab === 'flows' && flowStats) {
      return {
        primary: { label: 'Executions', value: flowStats.total, sub: `${flowStats.workflows} workflows` },
        secondary: { label: 'Completed', value: flowStats.completed, sub: `${flowStats.total ? ((flowStats.completed / flowStats.total) * 100).toFixed(0) : 0}% success` },
        tertiary: { label: 'Failed', value: flowStats.failed, sub: `${flowStats.running} running` },
        quaternary: { label: 'Avg Duration', value: fmt.dur(flowStats.avgDuration), sub: 'per execution' },
      };
    }
    return null;
  };

  // ── Pagination helpers ───────────────────────────────────────────────────

  const paginatedCode = codeSessions.slice((currentPage - 1) * 25, currentPage * 25);
  const paginatedFlows = flowExecutions.slice((currentPage - 1) * 25, currentPage * 25);

  // ── Styles ───────────────────────────────────────────────────────────────

  const s = {
    surface: { backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' },
    surfaceSec: { backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' },
    border: { borderColor: 'var(--color-border)' },
    muted: { color: 'var(--color-textSecondary)' },
    faint: { color: 'var(--color-textMuted, var(--color-textSecondary))' },
    input: {
      backgroundColor: 'var(--color-surface)',
      borderColor: 'var(--color-border)',
      color: 'var(--color-text)',
    },
  };

  const tabDef: { id: AuditTab; label: string; icon: any; count: number }[] = [
    { id: 'chat', label: 'Chat Sessions', icon: Activity, count: chatCount },
    { id: 'code', label: 'Code Mode', icon: Terminal, count: codeCount },
    { id: 'flows', label: 'Flows', icon: GitBranch, count: flowsCount },
  ];

  const stats = getStats();

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Monitoring', 'Audit']}
        title="Audit Logs"
        explainer="SOC2-compliant activity logging across chat sessions, code mode, and flow executions. Filter, search, and export for compliance review."
        actions={[
          { label: autoRefresh ? 'Pause Live' : 'Live', onClick: () => setAutoRefresh(!autoRefresh) },
          { label: 'Export CSV', onClick: () => handleExport('csv'), disabled: exporting },
          { label: 'Export JSON', onClick: () => handleExport('json'), primary: true, disabled: exporting },
        ]}
        sticky
      />

      {/* ─── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 rounded-lg" style={s.surfaceSec}>
        {tabDef.map(tab => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center"
              style={{
                backgroundColor: active ? 'var(--color-surface)' : 'transparent',
                color: active ? 'var(--color-text)' : 'var(--color-textSecondary)',
                boxShadow: active ? (isDark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 3px rgba(0,0,0,0.08)') : 'none',
              }}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
              {tab.count > 0 && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-xs tabular-nums"
                  style={{
                    backgroundColor: active ? 'var(--ap-accent-soft)' : 'var(--ap-bg-2)',
                    color: active ? 'var(--ap-accent)' : 'var(--color-textSecondary)',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    minWidth: 20,
                    textAlign: 'center',
                  }}
                >
                  {tab.count > 999 ? `${(tab.count / 1000).toFixed(1)}k` : tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Toolbar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
            style={s.faint}
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchData()}
            placeholder={`Search ${activeTab === 'chat' ? 'sessions, users, models...' : activeTab === 'code' ? 'sessions, pods, users...' : 'workflows, executions...'}`}
            className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
            style={s.input}
          />
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg border" style={{ ...s.surface, ...s.border }}>
          {(['1h', '24h', '7d', '30d', 'all'] as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => { setDateRange(r); setCurrentPage(1); }}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                backgroundColor: dateRange === r ? 'color-mix(in srgb, var(--ap-accent) 20%, transparent)' : 'transparent',
                color: dateRange === r ? 'var(--ap-accent)' : 'var(--color-textSecondary)',
              }}
            >
              {r === 'all' ? 'All' : r.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={fetchData}
          className="p-2 rounded-lg border transition-colors hover:opacity-80"
          style={{ ...s.surface, ...s.border }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} style={s.muted} />
        </button>
      </div>

      {/* ─── Stats Cards ────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[stats.primary, stats.secondary, stats.tertiary, stats.quaternary].map((card, i) => (
            <div
              key={i}
              className="px-4 py-3 rounded-lg border"
              style={{ ...s.surface, ...s.border }}
            >
              <div className="text-xs font-medium mb-1" style={s.muted}>{card.label}</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-text)', letterSpacing: '-0.02em' }}>
                {card.value}
              </div>
              {card.sub && <div className="text-xs mt-0.5" style={s.faint}>{card.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* ─── Error Banner ───────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border" style={{ backgroundColor: 'var(--ap-err-soft)', borderColor: 'color-mix(in srgb, var(--ap-err) 25%, transparent)', color: 'var(--ap-err)' }}>
          <XCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* ─── Content ────────────────────────────────────────────────────── */}
      <div className="rounded-lg border overflow-hidden" style={{ ...s.surface, ...s.border }}>
        {loading && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-6 h-6 animate-spin" style={s.muted} />
          </div>
        )}

        {!loading && activeTab === 'chat' && <ChatTable sessions={sessions} expanded={expandedSessions} setExpanded={setExpandedSessions} s={s} isDark={isDark} />}
        {!loading && activeTab === 'code' && <CodeTable sessions={paginatedCode} s={s} isDark={isDark} />}
        {!loading && activeTab === 'flows' && <FlowsTable executions={paginatedFlows} s={s} isDark={isDark} />}
      </div>

      {/* ─── Pagination ─────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs tabular-nums" style={s.muted}>
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-2.5 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-30"
              style={{ ...s.surface, ...s.border }}
            >
              First
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-30"
              style={{ ...s.surface, ...s.border }}
            >
              Prev
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-30"
              style={{ ...s.surface, ...s.border }}
            >
              Next
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-2.5 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-30"
              style={{ ...s.surface, ...s.border }}
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

interface TableProps {
  s: Record<string, React.CSSProperties>;
  isDark: boolean;
}

// ── Chat Table ───────────────────────────────────────────────────────────────

const ChatTable: React.FC<TableProps & {
  sessions: SessionLog[];
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
}> = ({ sessions, expanded, setExpanded, s, isDark }) => {
  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (sessions.length === 0) {
    return <EmptyState icon={Activity} label="No chat sessions found" />;
  }

  return (
    <div>
      {sessions.map(sess => {
        const isOpen = expanded.has(sess.id);
        const modelLabel = (sess.model || '—').replace('anthropic/', '').replace('openai/', '');
        const message = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, color: 'var(--ap-fg-1, var(--fg-1))' }}>
              {sess.title || 'Untitled Session'}
            </span>
            <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {modelLabel}</span>
            <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {sess.messageCount} msg ({sess.userQueries}u/{sess.aiResponses}ai)</span>
          </span>
        );
        const meta = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt.tokens(sess.totalTokens)} tok</span>
            <span style={{ color: 'var(--ap-ok, var(--ok))', fontFamily: 'var(--font-mono)' }}>
              {fmt.cost(sess.totalCost)}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{sess.mcpCallsCount + sess.toolExecutionsCount} tools</span>
            {isOpen
              ? <ChevronDown className="w-4 h-4" />
              : <ChevronRight className="w-4 h-4" />}
          </span>
        );
        return (
          <div key={sess.id}>
            <div
              onClick={() => toggle(sess.id)}
              role="button"
              aria-expanded={isOpen}
              style={{
                cursor: 'pointer',
                backgroundColor: isOpen ? 'var(--ap-bg-2)' : 'transparent',
              }}
            >
              <LogRow
                severity="info"
                timestamp={fmt.tsShort(sess.createdAt)}
                source={sess.userEmail || sess.userName || 'system'}
                sourceAccent={!!sess.userEmail || !!sess.userName}
                message={message}
                meta={meta}
              />
            </div>

            {/* Expanded conversation */}
            {isOpen && sess.conversation && (
              <div className="px-6 py-4 border-b" style={{ ...s.border, backgroundColor: 'var(--ap-bg-1)' }}>
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {sess.conversation.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${msg.role === 'user' ? 'pl-8' : 'pr-8'}`}
                    >
                      <div className="flex-shrink-0 mt-1">
                        {msg.role === 'user'
                          ? <User className="w-4 h-4" style={{ color: 'var(--ap-accent)' }} />
                          : <Activity className="w-4 h-4" style={{ color: 'var(--color-success)' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold uppercase" style={s.muted}>
                            {msg.role}
                          </span>
                          <span className="text-xs" style={s.faint}>{fmt.ts(msg.timestamp)}</span>
                          {msg.model && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--ap-bg-2)', ...s.muted }}>
                              {msg.model}
                            </span>
                          )}
                          {msg.hasMcpCalls && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--ap-info-soft)', color: 'var(--ap-accent)' }}>
                              MCP
                            </span>
                          )}
                          {msg.hasToolCalls && (
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--ap-accent-soft)', color: 'var(--ap-accent)' }}>
                              Tools
                            </span>
                          )}
                        </div>
                        <div
                          className="text-sm whitespace-pre-wrap break-words"
                          style={{ color: 'var(--color-text)', lineHeight: 1.6 }}
                        >
                          {msg.content.length > 800 ? msg.content.substring(0, 800) + '...' : msg.content}
                        </div>
                        {msg.role === 'assistant' && (msg.tokens || msg.cost) && (
                          <div className="flex items-center gap-3 mt-1.5 text-xs" style={s.faint}>
                            {msg.tokens && <span>{fmt.tokens(msg.tokens)} tokens</span>}
                            {msg.cost && <span style={{ color: 'var(--color-success)' }}>{fmt.cost(msg.cost)}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ── Code Mode Table ──────────────────────────────────────────────────────────

const CodeTable: React.FC<TableProps & { sessions: CodeSession[] }> = ({ sessions, s, isDark }) => {
  if (sessions.length === 0) {
    return <EmptyState icon={Terminal} label="No code sessions found" />;
  }

  return (
    <div>
      {sessions.map(sess => {
        const userLabel = sess.user?.email || sess.user?.name || sess.user_id.substring(0, 8);
        const podShort = sess.pod_name ? sess.pod_name.replace('openagentic-runner-', '').substring(0, 12) : '';
        const message = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <code style={{ color: 'var(--ap-fg-1, var(--fg-1))' }}>{sess.id.substring(0, 12)}…</code>
            <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {sess.status}</span>
            {podShort && (
              <code style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· pod:{podShort}</code>
            )}
          </span>
        );
        const meta = (
          <span>
            {sess.last_activity
              ? fmt.ago(sess.last_activity)
              : sess.updated_at
                ? fmt.ago(sess.updated_at)
                : '—'}
          </span>
        );
        return (
          <LogRow
            key={sess.id}
            severity={statusToSeverity(sess.status)}
            timestamp={fmt.tsShort(sess.created_at)}
            source={userLabel}
            sourceAccent={!!sess.user?.email}
            message={message}
            meta={meta}
          />
        );
      })}
    </div>
  );
};

// ── Flows Table ──────────────────────────────────────────────────────────────

const FlowsTable: React.FC<TableProps & { executions: FlowExecution[] }> = ({ executions, s, isDark }) => {
  if (executions.length === 0) {
    return <EmptyState icon={GitBranch} label="No workflow executions found" />;
  }

  return (
    <div>
      {executions.map(ex => {
        const message = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, color: 'var(--ap-fg-1, var(--fg-1))' }}>{ex.workflow_name}</span>
            <code style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>{ex.id.substring(0, 8)}</code>
            <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {ex.status}</span>
            <span
              style={{
                color: ex.trigger_type === 'manual' ? 'var(--ap-warn, var(--warn))' : 'var(--ap-accent, var(--accent))',
              }}
            >
              · {ex.trigger_type}
            </span>
            <span style={{ color: 'var(--ap-fg-3, var(--fg-3))' }}>· {ex.completed_nodes}/{ex.total_nodes} nodes</span>
          </span>
        );
        const meta = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt.dur(ex.execution_time_ms)}</span>
            {ex.cost && (
              <span style={{ color: 'var(--ap-ok, var(--ok))', fontFamily: 'var(--font-mono)' }}>
                {fmt.cost(ex.cost)}
              </span>
            )}
          </span>
        );
        return (
          <LogRow
            key={ex.id}
            severity={statusToSeverity(ex.status)}
            timestamp={fmt.tsShort(ex.started_at)}
            source={ex.trigger_type}
            sourceAccent={ex.trigger_type !== 'manual'}
            message={message}
            meta={meta}
          />
        );
      })}
    </div>
  );
};

// ── Empty State ──────────────────────────────────────────────────────────────

const EmptyState: React.FC<{ icon: React.FC<any>; label: string }> = ({ icon: Icon, label }) => (
  <div className="flex flex-col items-center justify-center py-16 gap-3">
    <Icon className="w-10 h-10" style={{ color: 'var(--color-textSecondary)', opacity: 0.4 }} />
    <span className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>{label}</span>
  </div>
);

// ── CSV Helper ───────────────────────────────────────────────────────────────

function toCSV(data: any[]): string {
  if (data.length === 0) return '';
  const keys = Object.keys(data[0]);
  const header = keys.join(',');
  const rows = data.map(row =>
    keys.map(k => {
      const v = row[k];
      if (v === null || v === undefined) return '';
      const str = String(v);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}
