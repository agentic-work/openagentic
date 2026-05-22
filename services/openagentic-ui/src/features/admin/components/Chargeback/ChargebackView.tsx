/**
 * ChargebackView - Enterprise Chargeback & Cost Management Dashboard
 *
 * Comprehensive admin panel for tracking AI platform costs, managing budgets,
 * generating chargeback reports, and monitoring per-group/user spending.
 *
 * Tabs:
 *  1. Overview  - Cost summary, budget health, top users, cost-by-model charts
 *  2. Budgets   - CRUD for cost budgets with usage bars and action-on-limit config
 *  3. Reports   - Chargeback report lifecycle (draft -> finalized -> exported -> paid)
 *  4. Groups    - User groups with billing info and per-group cost totals
 *
 * All data fetched from /api/admin/chargeback/* and /api/admin/dashboard/metrics endpoints.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DollarSign, TrendingUp, Users, Activity, RefreshCw, Search,
  Plus, Edit, Trash2, Eye, CheckCircle, AlertCircle,
  Download, ChevronDown, ChevronRight, X, Building2, BarChart2,
} from '../Shared/AdminIcons';
import { apiRequest } from '../../../../utils/api';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { PageHeader } from '../../primitives-v2';
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostBudget {
  id: string;
  userId?: string;
  groupId?: string;
  budgetType: 'daily' | 'weekly' | 'monthly' | 'annual';
  limitCents: number;
  alertThresholds: number[];
  actionOnLimit: 'warn' | 'throttle' | 'block';
  throttleToModel?: string;
  currentSpendCents: number;
  usagePercent: number;
  notifications: { email: boolean; slack: boolean };
  // display helpers from server
  userName?: string;
  userEmail?: string;
  groupName?: string;
}

interface ChargebackReport {
  id: string;
  period: string;
  userId?: string;
  groupId?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalThinkingTokens: number;
  totalLlmCost: number;
  totalMcpCost: number;
  totalComputeCost: number;
  totalStorageCost: number;
  totalCost: number;
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  requestCount: number;
  status: 'draft' | 'finalized' | 'exported' | 'paid';
  userName?: string;
  userEmail?: string;
  groupName?: string;
  createdAt?: string;
}

interface ChargebackGroup {
  id: string;
  name: string;
  costCenter?: string;
  userCount: number;
  totalTokens: number;
  totalCost: number;
  budgetLimitCents?: number;
  budgetUsagePercent?: number;
  members?: { userId: string; email: string; name: string; cost: number; tokens: number }[];
}

interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  byUser?: { userId: string; email: string; name: string; cost: number; tokens: number; requests: number }[];
  byGroup?: { groupId: string; name: string; cost: number; tokens: number }[];
  byProvider?: Record<string, number>;
  byModel?: Record<string, number>;
}

interface DashboardMetrics {
  summary?: {
    totalCost: number;
    totalTokens: number;
    totalMessages: number;
    totalUsers: number;
    activeUsers: number;
  };
  perUserUsage?: { userId: string; email: string; name: string; cost: number; tokens: number }[];
  costByModel?: { model: string; data: { timestamp: string; value: number }[] }[];
  modelUsage?: { model: string; count: number; tokens: number; cost: number }[];
  timeSeries?: {
    tokenUsage: { timestamp: string; value: number }[];
  };
}

interface ChargebackViewProps {
  theme: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Chart palette fallback (Recharts series colors). Teal #14b8a6 has no semantic
// --ap-* equivalent — it's an extended-palette slot for cost-by-category bars.
const CHART_PALETTE_FALLBACKS = [
  'var(--ap-accent)', 'var(--ap-accent)', 'var(--ap-accent)', 'var(--ap-accent)',
  'var(--ap-accent)', 'var(--ap-err)', 'var(--ap-warn)', 'var(--ap-warn)',
  // eslint-disable-next-line admin-tokens/no-hardcoded-admin-color
  'var(--ap-ok)', '#14b8a6', 'var(--ap-info)', 'var(--ap-accent)',
];

const CSS_COLOR_VARS = [
  '--color-primary',
  '--color-secondary',
  '--color-accent',
  '--color-error',
  '--color-warning',
  '--color-success',
  '--color-info',
  '--ap-chart-1',
  '--ap-chart-2',
  '--ap-chart-3',
  '--ap-chart-4',
  '--ap-chart-5',
];

function getChartPalette(): string[] {
  if (typeof document === 'undefined') return CHART_PALETTE_FALLBACKS;
  const style = getComputedStyle(document.documentElement);
  return CHART_PALETTE_FALLBACKS.map((fallback, i) => {
    const cssVar = CSS_COLOR_VARS[i];
    if (!cssVar) return fallback;
    const val = style.getPropertyValue(cssVar).trim();
    return val || fallback;
  });
}

const CHART_PALETTE = typeof document !== 'undefined' ? getChartPalette() : CHART_PALETTE_FALLBACKS;

function formatCurrency(cents: number): string {
  const dollars = cents / 100;
  if (dollars === 0) return '$0.00';
  if (Math.abs(dollars) < 1) {
    return `$${dollars.toFixed(4)}`;
  }
  return `$${dollars.toFixed(2)}`;
}

function formatDollars(amount: number): string {
  if (amount === 0) return '$0.00';
  if (Math.abs(amount) < 1) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString('en-US');
}

function budgetBarColor(pct: number): string {
  if (pct >= 90) return 'var(--ap-err)';
  if (pct >= 75) return 'var(--ap-warn)';
  if (pct >= 50) return 'var(--ap-warn)';
  return 'var(--ap-ok)';
}

function statusColor(status: string): string {
  switch (status) {
    case 'draft': return 'var(--ap-info)';
    case 'finalized': return 'var(--ap-warn)';
    case 'exported': return 'var(--ap-accent)';
    case 'paid': return 'var(--ap-ok)';
    default: return 'var(--color-textSecondary)';
  }
}

const STATUS_ORDER: ChargebackReport['status'][] = ['draft', 'finalized', 'exported', 'paid'];

function nextStatus(current: ChargebackReport['status']): ChargebackReport['status'] | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx < 0 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
    style={{
      background: active ? 'var(--color-primary)' : 'transparent',
      color: active ? 'var(--ap-fg-0)' : 'var(--color-textSecondary)',
      border: active ? 'none' : '1px solid var(--color-border)',
    }}
  >
    {children}
  </button>
);

const StatCard: React.FC<{
  icon: React.FC<any>;
  label: string;
  value: string;
  subValue?: string;
}> = ({ icon: Icon, label, value, subValue }) => (
  <div
    className="glass-card rounded-xl p-4 transition-all hover:shadow-lg"
    style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
    }}
  >
    <div className="flex items-center justify-between mb-3">
      <div
        className="p-2 rounded-lg"
        style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}
      >
        <Icon size={18} style={{ color: 'var(--color-primary)' }} />
      </div>
    </div>
    <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{value}</div>
    <div className="text-xs mt-1" style={{ color: 'var(--color-textSecondary)' }}>{label}</div>
    {subValue && (
      <div className="text-xs mt-0.5" style={{ color: 'var(--color-primary)' }}>{subValue}</div>
    )}
  </div>
);

const BudgetUsageBar: React.FC<{ percent: number }> = ({ percent }) => {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'var(--color-surfaceHover)' }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${clamped}%`,
          background: `linear-gradient(90deg, var(--color-success, var(--ap-ok)) 0%, ${budgetBarColor(clamped)} 100%)`,
        }}
      />
    </div>
  );
};

// Modal overlay
const Modal: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="rounded-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70 transition-opacity">
            <X size={18} style={{ color: 'var(--color-textSecondary)' }} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// Reusable form field
const FormField: React.FC<{
  label: string;
  children: React.ReactNode;
  hint?: string;
}> = ({ label, children, hint }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-textSecondary)' }}>{label}</label>
    {children}
    {hint && <p className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>{hint}</p>}
  </div>
);

const inputStyle: React.CSSProperties = {
  background: 'var(--color-surfaceHover)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  borderRadius: '0.5rem',
  padding: '0.5rem 0.75rem',
  width: '100%',
  fontSize: '0.875rem',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const ChargebackView: React.FC<ChargebackViewProps> = ({ theme: _theme }) => {
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<'overview' | 'budgets' | 'reports' | 'groups'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [budgets, setBudgets] = useState<CostBudget[]>([]);
  const [reports, setReports] = useState<ChargebackReport[]>([]);
  const [groups, setGroups] = useState<ChargebackGroup[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);

  // UI state
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<CostBudget | null>(null);
  const [reportDetailId, setReportDetailId] = useState<string | null>(null);
  const [reportDetail, setReportDetail] = useState<ChargebackReport | null>(null);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState('');
  const [reportFilterStatus, setReportFilterStatus] = useState<string>('all');
  const [reportFilterPeriod, setReportFilterPeriod] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Budget form state
  const [budgetForm, setBudgetForm] = useState({
    userId: '',
    groupId: '',
    budgetType: 'monthly' as CostBudget['budgetType'],
    limitDollars: '',
    alertThresholds: '50,75,90,100',
    actionOnLimit: 'warn' as CostBudget['actionOnLimit'],
    throttleToModel: '',
    notifyEmail: true,
    notifySlack: false,
  });

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const results = await Promise.allSettled([
        apiRequest('/admin/chargeback/budgets').then(r => r.ok ? r.json() : []),
        apiRequest('/admin/chargeback/reports').then(r => r.ok ? r.json() : []),
        apiRequest('/admin/chargeback/groups').then(r => r.ok ? r.json() : []),
        apiRequest('/admin/chargeback/usage').then(r => r.ok ? r.json() : null),
        apiRequest('/admin/dashboard/metrics?timeRange=30d').then(r => r.ok ? r.json() : null),
      ]);

      if (results[0].status === 'fulfilled') setBudgets(Array.isArray(results[0].value) ? results[0].value : results[0].value?.budgets || []);
      if (results[1].status === 'fulfilled') setReports(Array.isArray(results[1].value) ? results[1].value : results[1].value?.reports || []);
      if (results[2].status === 'fulfilled') setGroups(Array.isArray(results[2].value) ? results[2].value : results[2].value?.groups || []);
      if (results[3].status === 'fulfilled') setUsage(results[3].value);
      if (results[4].status === 'fulfilled') setDashboardMetrics(results[4].value);
    } catch (err: any) {
      console.error('Failed to fetch chargeback data:', err);
      setError(err.message || 'Failed to load chargeback data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Fetch report detail
  useEffect(() => {
    if (!reportDetailId) { setReportDetail(null); return; }
    apiRequest(`/admin/chargeback/reports/${reportDetailId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setReportDetail(data))
      .catch(() => setReportDetail(null));
  }, [reportDetailId]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const handleSaveBudget = async () => {
    setActionLoading(true);
    const body = {
      userId: budgetForm.userId || undefined,
      groupId: budgetForm.groupId || undefined,
      budgetType: budgetForm.budgetType,
      limitCents: Math.round(parseFloat(budgetForm.limitDollars || '0') * 100),
      alertThresholds: budgetForm.alertThresholds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)),
      actionOnLimit: budgetForm.actionOnLimit,
      throttleToModel: budgetForm.throttleToModel || undefined,
      notifications: { email: budgetForm.notifyEmail, slack: budgetForm.notifySlack },
    };

    try {
      if (editingBudget) {
        await apiRequest(`/admin/chargeback/budgets/${editingBudget.id}`, {
          method: 'PUT', body: JSON.stringify(body),
        });
      } else {
        await apiRequest('/admin/chargeback/budgets', {
          method: 'POST', body: JSON.stringify(body),
        });
      }
      setBudgetModalOpen(false);
      setEditingBudget(null);
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to save budget');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteBudget = async (id: string) => {
    if (!(await confirm('Delete this budget? This action cannot be undone.', { variant: 'danger', title: 'Delete Budget' }))) return;
    setActionLoading(true);
    try {
      await apiRequest(`/admin/chargeback/budgets/${id}`, { method: 'DELETE' });
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to delete budget');
    } finally {
      setActionLoading(false);
    }
  };

  const openCreateBudget = () => {
    setEditingBudget(null);
    setBudgetForm({
      userId: '', groupId: '', budgetType: 'monthly', limitDollars: '',
      alertThresholds: '50,75,90,100', actionOnLimit: 'warn',
      throttleToModel: '', notifyEmail: true, notifySlack: false,
    });
    setBudgetModalOpen(true);
  };

  const openEditBudget = (b: CostBudget) => {
    setEditingBudget(b);
    setBudgetForm({
      userId: b.userId || '',
      groupId: b.groupId || '',
      budgetType: b.budgetType,
      limitDollars: (b.limitCents / 100).toString(),
      alertThresholds: (b.alertThresholds || [50, 75, 90, 100]).join(','),
      actionOnLimit: b.actionOnLimit,
      throttleToModel: b.throttleToModel || '',
      notifyEmail: b.notifications?.email ?? true,
      notifySlack: b.notifications?.slack ?? false,
    });
    setBudgetModalOpen(true);
  };

  const handleGenerateReport = async () => {
    if (!generatePeriod) return;
    setActionLoading(true);
    try {
      await apiRequest('/admin/chargeback/reports/generate', {
        method: 'POST', body: JSON.stringify({ period: generatePeriod }),
      });
      setGenerateModalOpen(false);
      setGeneratePeriod('');
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdvanceReportStatus = async (report: ChargebackReport) => {
    const next = nextStatus(report.status);
    if (!next) return;
    setActionLoading(true);
    try {
      await apiRequest(`/admin/chargeback/reports/${report.id}`, {
        method: 'PUT', body: JSON.stringify({ status: next }),
      });
      if (reportDetailId === report.id) {
        setReportDetailId(report.id); // re-trigger detail fetch
      }
      await fetchAll();
    } catch (err: any) {
      setError(err.message || 'Failed to update report status');
    } finally {
      setActionLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const totalSpendThisMonth = useMemo(() => {
    if (usage?.totalCost != null) return usage.totalCost;
    if (dashboardMetrics?.summary?.totalCost != null) return dashboardMetrics.summary.totalCost;
    return 0;
  }, [usage, dashboardMetrics]);

  const avgBudgetUsage = useMemo(() => {
    if (budgets.length === 0) return 0;
    return budgets.reduce((sum, b) => sum + (b.usagePercent || 0), 0) / budgets.length;
  }, [budgets]);

  const topUsersByCost = useMemo(() => {
    const users = usage?.byUser || dashboardMetrics?.perUserUsage || [];
    return [...users].sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, 8);
  }, [usage, dashboardMetrics]);

  const costByModelData = useMemo(() => {
    const raw = usage?.byModel || {};
    const modelUsage = dashboardMetrics?.modelUsage;
    if (Object.keys(raw).length > 0) {
      return Object.entries(raw).map(([model, cost]) => ({
        name: model.length > 25 ? model.slice(0, 22) + '...' : model,
        fullName: model,
        value: cost,
      }));
    }
    if (modelUsage && modelUsage.length > 0) {
      return modelUsage.map(m => ({
        name: m.model.length > 25 ? m.model.slice(0, 22) + '...' : m.model,
        fullName: m.model,
        value: m.cost,
      }));
    }
    return [];
  }, [usage, dashboardMetrics]);

  const dailyCostTimeSeries = useMemo(() => {
    const costByModel = dashboardMetrics?.costByModel;
    if (!costByModel || costByModel.length === 0) return [];
    const merged = new Map<string, { date: string; cost: number }>();
    for (const series of costByModel) {
      for (const pt of series.data) {
        const existing = merged.get(pt.timestamp);
        if (existing) {
          existing.cost += pt.value;
        } else {
          merged.set(pt.timestamp, { date: pt.timestamp, cost: pt.value });
        }
      }
    }
    return Array.from(merged.values()).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [dashboardMetrics]);

  const filteredReports = useMemo(() => {
    let filtered = [...reports];
    if (reportFilterStatus !== 'all') {
      filtered = filtered.filter(r => r.status === reportFilterStatus);
    }
    if (reportFilterPeriod) {
      filtered = filtered.filter(r => r.period?.includes(reportFilterPeriod));
    }
    return filtered;
  }, [reports, reportFilterStatus, reportFilterPeriod]);

  const filteredGroups = useMemo(() => {
    if (!searchTerm) return groups;
    const lower = searchTerm.toLowerCase();
    return groups.filter(g =>
      g.name.toLowerCase().includes(lower) ||
      (g.costCenter || '').toLowerCase().includes(lower)
    );
  }, [groups, searchTerm]);

  // -----------------------------------------------------------------------
  // Chart tooltip
  // -----------------------------------------------------------------------

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div
        style={{
          background: 'var(--color-surfaceTertiary, var(--color-surface))',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '8px 12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
      >
        <p style={{ color: 'var(--color-textSecondary)', fontSize: 'var(--text-xs)', marginBottom: '4px' }}>
          {typeof label === 'string' && label.includes('T')
            ? new Date(label).toLocaleDateString([], { month: 'short', day: 'numeric' })
            : label}
        </p>
        {payload.map((entry: any, i: number) => (
          <p key={i} style={{ color: 'var(--color-text)', fontSize: '13px', fontWeight: 600 }}>
            {entry.name}: {typeof entry.value === 'number' ? formatDollars(entry.value) : entry.value}
          </p>
        ))}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Loading / Error
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          crumbs={['Admin', 'Chargeback', 'Cost Management']}
          title="Cost Management"
          explainer="Track spending, manage budgets, and generate chargeback reports across users, groups, and providers."
        />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: 'var(--color-primary)' }} />
          <span className="ml-4 text-lg" style={{ color: 'var(--color-textSecondary)' }}>Loading chargeback data...</span>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'Chargeback', 'Cost Management']}
        title="Cost Management"
        explainer="Track spending, manage budgets, and generate chargeback reports across users, groups, and providers."
        actions={[
          { label: 'Refresh', onClick: () => fetchAll() },
        ]}
      />

      {/* Error banner */}
      {error && (
        <div
          className="rounded-lg p-3 flex items-center gap-2 text-sm"
          style={{
            background: 'var(--ap-err-soft)',
            border: '1px solid color-mix(in srgb, var(--ap-err) 30%, transparent)',
            color: 'var(--ap-err)',
          }}
        >
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      {/* Self-hosted note */}
      <div
        className="rounded-lg px-4 py-2 text-xs flex items-center gap-2"
        style={{
          background: 'color-mix(in srgb, var(--ap-info) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--ap-info) 20%, transparent)',
          color: 'var(--ap-info)',
        }}
      >
        <Activity size={14} />
        Ollama/local model costs: $0.00 (self-hosted) -- only cloud API provider usage is billed.
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 flex-wrap">
        <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Overview</TabButton>
        <TabButton active={activeTab === 'budgets'} onClick={() => setActiveTab('budgets')}>Budgets</TabButton>
        <TabButton active={activeTab === 'reports'} onClick={() => setActiveTab('reports')}>Reports</TabButton>
        <TabButton active={activeTab === 'groups'} onClick={() => setActiveTab('groups')}>Groups</TabButton>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'budgets' && renderBudgets()}
      {activeTab === 'reports' && renderReports()}
      {activeTab === 'groups' && renderGroups()}

      {/* Budget modal */}
      <Modal
        open={budgetModalOpen}
        onClose={() => { setBudgetModalOpen(false); setEditingBudget(null); }}
        title={editingBudget ? 'Edit Budget' : 'Create Budget'}
      >
        {renderBudgetForm()}
      </Modal>

      {/* Generate report modal */}
      <Modal open={generateModalOpen} onClose={() => setGenerateModalOpen(false)} title="Generate Chargeback Report">
        <FormField label="Period (YYYY-MM)" hint="e.g. 2026-02">
          <input
            type="text"
            value={generatePeriod}
            onChange={e => setGeneratePeriod(e.target.value)}
            placeholder="2026-02"
            style={inputStyle}
          />
        </FormField>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => setGenerateModalOpen(false)}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: 'var(--color-textSecondary)', border: '1px solid var(--color-border)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerateReport}
            disabled={actionLoading || !generatePeriod}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--color-primary)', opacity: actionLoading ? 0.6 : 1 }}
          >
            {actionLoading ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </Modal>

      {/* Report detail modal */}
      <Modal
        open={!!reportDetailId}
        onClose={() => setReportDetailId(null)}
        title={reportDetail ? `Report: ${reportDetail.period}` : 'Report Details'}
      >
        {reportDetail ? renderReportDetail(reportDetail) : (
          <div className="text-center py-6" style={{ color: 'var(--color-textSecondary)' }}>Loading...</div>
        )}
      </Modal>
    </div>
  );

  // =====================================================================
  // TAB 1 - Overview
  // =====================================================================

  function renderOverview() {
    return (
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={DollarSign}
            label="Total Spend (This Month)"
            value={formatDollars(totalSpendThisMonth)}
            subValue={usage?.totalRequests ? `${formatNumber(usage.totalRequests)} requests` : undefined}
          />
          <StatCard
            icon={TrendingUp}
            label="Avg Budget Utilization"
            value={`${avgBudgetUsage.toFixed(1)}%`}
            subValue={`${budgets.length} active budget${budgets.length !== 1 ? 's' : ''}`}
          />
          <StatCard
            icon={Users}
            label="Active Users"
            value={formatNumber(dashboardMetrics?.summary?.activeUsers || 0)}
            subValue={dashboardMetrics?.summary?.totalUsers ? `of ${formatNumber(dashboardMetrics.summary.totalUsers)} total` : undefined}
          />
          <StatCard
            icon={Activity}
            label="Total Tokens"
            value={formatNumber(usage?.totalTokens || dashboardMetrics?.summary?.totalTokens || 0)}
          />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cost by model - Pie/Bar */}
          <div
            className="glass-card rounded-xl p-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--color-textSecondary)' }}>
              Cost by Model
            </h3>
            {costByModelData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={costByModelData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                    >
                      {costByModelData.map((_, i) => (
                        <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      formatter={(value: string) => (
                        <span style={{ color: 'var(--color-textSecondary)', fontSize: 'var(--text-xs)' }}>{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center" style={{ color: 'var(--color-textMuted)' }}>
                No model cost data available
              </div>
            )}
          </div>

          {/* Daily cost trend - Area chart */}
          <div
            className="glass-card rounded-xl p-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--color-textSecondary)' }}>
              Daily Cost Trend (30d)
            </h3>
            {dailyCostTimeSeries.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyCostTimeSeries}>
                    <defs>
                      <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--ap-accent)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--ap-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--ap-chart-grid, color-mix(in srgb, var(--color-text) 8%, transparent))"
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      tick={{ fill: 'var(--color-textSecondary)', fontSize: 10 }}
                      axisLine={{ stroke: 'var(--color-textMuted)' }}
                      tickLine={{ stroke: 'var(--color-textMuted)' }}
                    />
                    <YAxis
                      tickFormatter={(v) => `$${v.toFixed(2)}`}
                      tick={{ fill: 'var(--color-textSecondary)', fontSize: 10 }}
                      axisLine={{ stroke: 'var(--color-textMuted)' }}
                      tickLine={{ stroke: 'var(--color-textMuted)' }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="var(--ap-accent)"
                      strokeWidth={2}
                      fill="url(#costGradient)"
                      name="Daily Cost"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center" style={{ color: 'var(--color-textMuted)' }}>
                No time-series data available
              </div>
            )}
          </div>
        </div>

        {/* Top users by cost */}
        <div
          className="glass-card rounded-xl p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--color-textSecondary)' }}>
            Top Users by Cost
          </h3>
          {topUsersByCost.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topUsersByCost.map(u => ({
                    name: (u.name || u.email || 'Unknown').slice(0, 20),
                    cost: u.cost || 0,
                  }))}
                  layout="vertical"
                  margin={{ left: 100 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--ap-chart-grid, color-mix(in srgb, var(--color-text) 8%, transparent))"
                  />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `$${v.toFixed(2)}`}
                    tick={{ fill: 'var(--color-textSecondary)', fontSize: 10 }}
                    axisLine={{ stroke: 'var(--color-textMuted)' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: 'var(--color-textSecondary)', fontSize: 11 }}
                    axisLine={{ stroke: 'var(--color-textMuted)' }}
                    width={95}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="cost" name="Cost" fill="var(--ap-accent)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center" style={{ color: 'var(--color-textMuted)' }}>
              No per-user cost data available
            </div>
          )}
        </div>

        {/* Budget health overview */}
        {budgets.length > 0 && (
          <div
            className="glass-card rounded-xl p-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--color-textSecondary)' }}>
              Budget Health
            </h3>
            <div className="space-y-3">
              {budgets.slice(0, 6).map(b => (
                <div key={b.id} className="flex items-center gap-3">
                  <div className="w-40 text-sm truncate" style={{ color: 'var(--color-text)' }}>
                    {b.groupName || b.userName || b.userEmail || b.groupId || b.userId || 'Global'}
                  </div>
                  <div className="flex-1">
                    <BudgetUsageBar percent={b.usagePercent || 0} />
                  </div>
                  <div className="w-24 text-right text-sm font-medium" style={{ color: budgetBarColor(b.usagePercent || 0) }}>
                    {(b.usagePercent || 0).toFixed(1)}%
                  </div>
                  <div className="w-28 text-right text-xs" style={{ color: 'var(--color-textSecondary)' }}>
                    {formatCurrency(b.currentSpendCents)} / {formatCurrency(b.limitCents)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // =====================================================================
  // TAB 2 - Budgets
  // =====================================================================

  function renderBudgets() {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            Cost Budgets ({budgets.length})
          </h3>
          <button
            onClick={openCreateBudget}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: 'var(--color-primary)' }}
          >
            <Plus size={14} />
            Create Budget
          </button>
        </div>

        {budgets.length === 0 ? (
          <div
            className="glass-card rounded-xl p-8 text-center"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <DollarSign size={40} style={{ color: 'var(--color-textMuted)', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--color-textSecondary)' }}>No budgets configured yet.</p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-textMuted)' }}>
              Create a budget to track and control AI spending.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {budgets.map(b => (
              <div
                key={b.id}
                className="glass-card rounded-xl p-4 transition-all hover:shadow-md"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {b.groupName || b.userName || b.userEmail || b.groupId || b.userId || 'Global Budget'}
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                          color: 'var(--color-primary)',
                        }}
                      >
                        {b.budgetType}
                      </span>
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--color-textSecondary)' }}>
                      Action on limit: <span className="font-medium" style={{
                        color: b.actionOnLimit === 'block' ? 'var(--ap-error)' :
                               b.actionOnLimit === 'throttle' ? 'var(--ap-warning)' : 'var(--ap-info)',
                      }}>
                        {b.actionOnLimit}
                      </span>
                      {b.throttleToModel && (
                        <span style={{ color: 'var(--color-textMuted)' }}> (throttle to {b.throttleToModel})</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditBudget(b)}
                      className="p-1.5 rounded-lg transition-all hover:opacity-70"
                      style={{ background: 'var(--color-surfaceHover)' }}
                    >
                      <Edit size={14} style={{ color: 'var(--color-textSecondary)' }} />
                    </button>
                    <button
                      onClick={() => handleDeleteBudget(b.id)}
                      className="p-1.5 rounded-lg transition-all hover:opacity-70"
                      style={{ background: 'var(--color-surfaceHover)' }}
                    >
                      <Trash2 size={14} style={{ color: 'var(--ap-err)' }} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1">
                    <BudgetUsageBar percent={b.usagePercent || 0} />
                  </div>
                  <span className="text-sm font-bold" style={{ color: budgetBarColor(b.usagePercent || 0) }}>
                    {(b.usagePercent || 0).toFixed(1)}%
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-textSecondary)' }}>
                  <span>Spent: {formatCurrency(b.currentSpendCents)}</span>
                  <span>Limit: {formatCurrency(b.limitCents)}</span>
                  <span>
                    Alerts: {(b.alertThresholds || []).join('%, ')}%
                  </span>
                  <span className="flex items-center gap-1">
                    Notify:
                    {b.notifications?.email && <span>Email</span>}
                    {b.notifications?.slack && <span>Slack</span>}
                    {!b.notifications?.email && !b.notifications?.slack && <span>None</span>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // =====================================================================
  // TAB 3 - Reports
  // =====================================================================

  function renderReports() {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            Chargeback Reports ({filteredReports.length})
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={reportFilterStatus}
              onChange={e => setReportFilterStatus(e.target.value)}
              style={selectStyle}
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="finalized">Finalized</option>
              <option value="exported">Exported</option>
              <option value="paid">Paid</option>
            </select>
            <input
              type="text"
              value={reportFilterPeriod}
              onChange={e => setReportFilterPeriod(e.target.value)}
              placeholder="Filter by period..."
              style={{ ...inputStyle, width: '160px' }}
            />
            <button
              onClick={() => setGenerateModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
              style={{ background: 'var(--color-primary)' }}
            >
              <Plus size={14} />
              Generate Report
            </button>
          </div>
        </div>

        {filteredReports.length === 0 ? (
          <div
            className="glass-card rounded-xl p-8 text-center"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <BarChart2 size={40} style={{ color: 'var(--color-textMuted)', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--color-textSecondary)' }}>No reports found.</p>
            <p className="text-sm mt-1" style={{ color: 'var(--color-textMuted)' }}>
              Generate a chargeback report for a billing period.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Period', 'Scope', 'Requests', 'Total Cost', 'LLM Cost', 'Status', 'Actions'].map(h => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-medium"
                      style={{ color: 'var(--color-textSecondary)', borderBottom: '1px solid var(--color-border)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredReports.map(r => (
                  <tr
                    key={r.id}
                    className="transition-colors hover:opacity-90"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                  >
                    <td className="px-3 py-3 font-medium" style={{ color: 'var(--color-text)' }}>{r.period}</td>
                    <td className="px-3 py-3 text-xs" style={{ color: 'var(--color-textSecondary)' }}>
                      {r.groupName || r.userName || r.userEmail || 'All'}
                    </td>
                    <td className="px-3 py-3" style={{ color: 'var(--color-text)' }}>
                      {formatNumber(r.requestCount)}
                    </td>
                    <td className="px-3 py-3 font-medium" style={{ color: 'var(--color-text)' }}>
                      {formatDollars(r.totalCost)}
                    </td>
                    <td className="px-3 py-3" style={{ color: 'var(--color-textSecondary)' }}>
                      {formatDollars(r.totalLlmCost)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          color: statusColor(r.status),
                          background: `color-mix(in srgb, ${statusColor(r.status)} 15%, transparent)`,
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setReportDetailId(r.id)}
                          className="p-1 rounded hover:opacity-70"
                          title="View details"
                        >
                          <Eye size={14} style={{ color: 'var(--color-textSecondary)' }} />
                        </button>
                        {nextStatus(r.status) && (
                          <button
                            onClick={() => handleAdvanceReportStatus(r)}
                            disabled={actionLoading}
                            className="p-1 rounded hover:opacity-70"
                            title={`Advance to ${nextStatus(r.status)}`}
                          >
                            <CheckCircle size={14} style={{ color: 'var(--ap-ok)' }} />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            // Trigger browser download via API
                            apiRequest(`/admin/chargeback/reports/${r.id}`)
                              .then(res => res.json())
                              .then(data => {
                                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `chargeback-${r.period}-${r.id.slice(0, 8)}.json`;
                                a.click();
                                URL.revokeObjectURL(url);
                              });
                          }}
                          className="p-1 rounded hover:opacity-70"
                          title="Download JSON"
                        >
                          <Download size={14} style={{ color: 'var(--color-textSecondary)' }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // =====================================================================
  // TAB 4 - Groups
  // =====================================================================

  function renderGroups() {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            User Groups ({filteredGroups.length})
          </h3>
          <div className="relative">
            <Search size={14} style={{ color: 'var(--color-textMuted)', position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search groups..."
              style={{ ...inputStyle, paddingLeft: '2rem', width: '220px' }}
            />
          </div>
        </div>

        {filteredGroups.length === 0 ? (
          <div
            className="glass-card rounded-xl p-8 text-center"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <Building2 size={40} style={{ color: 'var(--color-textMuted)', margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--color-textSecondary)' }}>No user groups found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredGroups.map(g => (
              <div
                key={g.id}
                className="glass-card rounded-xl overflow-hidden transition-all"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                {/* Group header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:opacity-90"
                  onClick={() => setExpandedGroupId(expandedGroupId === g.id ? null : g.id)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="p-2 rounded-lg"
                      style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}
                    >
                      <Building2 size={18} style={{ color: 'var(--color-primary)' }} />
                    </div>
                    <div>
                      <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{g.name}</div>
                      {g.costCenter && (
                        <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>Cost Center: {g.costCenter}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{formatDollars(g.totalCost)}</div>
                      <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>{formatNumber(g.totalTokens)} tokens</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm" style={{ color: 'var(--color-text)' }}>{g.userCount} users</div>
                      {g.budgetLimitCents != null && g.budgetUsagePercent != null && (
                        <div className="text-xs" style={{ color: budgetBarColor(g.budgetUsagePercent) }}>
                          Budget: {g.budgetUsagePercent.toFixed(1)}%
                        </div>
                      )}
                    </div>
                    {expandedGroupId === g.id
                      ? <ChevronDown size={16} style={{ color: 'var(--color-textSecondary)' }} />
                      : <ChevronRight size={16} style={{ color: 'var(--color-textSecondary)' }} />
                    }
                  </div>
                </div>

                {/* Budget bar */}
                {g.budgetLimitCents != null && g.budgetUsagePercent != null && (
                  <div className="px-4 pb-2">
                    <BudgetUsageBar percent={g.budgetUsagePercent} />
                    <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>
                      <span>{formatDollars(g.totalCost)} spent</span>
                      <span>{formatCurrency(g.budgetLimitCents)} limit</span>
                    </div>
                  </div>
                )}

                {/* Expanded members */}
                {expandedGroupId === g.id && g.members && g.members.length > 0 && (
                  <div
                    className="px-4 pb-4"
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <div className="pt-3 space-y-2">
                      {g.members.map(m => (
                        <div
                          key={m.userId}
                          className="flex items-center justify-between py-2 px-3 rounded-lg"
                          style={{ background: 'var(--color-surfaceHover)' }}
                        >
                          <div>
                            <div className="text-sm" style={{ color: 'var(--color-text)' }}>{m.name || m.email}</div>
                            {m.name && <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>{m.email}</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{formatDollars(m.cost)}</div>
                            <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>{formatNumber(m.tokens)} tokens</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {expandedGroupId === g.id && (!g.members || g.members.length === 0) && (
                  <div className="px-4 pb-4 text-sm" style={{ color: 'var(--color-textMuted)', borderTop: '1px solid var(--color-border)' }}>
                    <div className="pt-3">No member details available.</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // =====================================================================
  // Budget Form (inside modal)
  // =====================================================================

  function renderBudgetForm() {
    return (
      <div>
        <FormField label="User ID (optional)" hint="Leave blank for group or global budget">
          <input
            type="text"
            value={budgetForm.userId}
            onChange={e => setBudgetForm(f => ({ ...f, userId: e.target.value }))}
            placeholder="User UUID"
            style={inputStyle}
          />
        </FormField>
        <FormField label="Group ID (optional)" hint="Leave blank for user or global budget">
          <input
            type="text"
            value={budgetForm.groupId}
            onChange={e => setBudgetForm(f => ({ ...f, groupId: e.target.value }))}
            placeholder="Group UUID"
            style={inputStyle}
          />
        </FormField>
        <FormField label="Budget Period">
          <select
            value={budgetForm.budgetType}
            onChange={e => setBudgetForm(f => ({ ...f, budgetType: e.target.value as CostBudget['budgetType'] }))}
            style={selectStyle}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </FormField>
        <FormField label="Limit (USD)" hint="Dollar amount for this budget period">
          <input
            type="number"
            step="0.01"
            min="0"
            value={budgetForm.limitDollars}
            onChange={e => setBudgetForm(f => ({ ...f, limitDollars: e.target.value }))}
            placeholder="100.00"
            style={inputStyle}
          />
        </FormField>
        <FormField label="Alert Thresholds (%)" hint="Comma-separated percentages">
          <input
            type="text"
            value={budgetForm.alertThresholds}
            onChange={e => setBudgetForm(f => ({ ...f, alertThresholds: e.target.value }))}
            placeholder="50,75,90,100"
            style={inputStyle}
          />
        </FormField>
        <FormField label="Action on Limit">
          <select
            value={budgetForm.actionOnLimit}
            onChange={e => setBudgetForm(f => ({ ...f, actionOnLimit: e.target.value as CostBudget['actionOnLimit'] }))}
            style={selectStyle}
          >
            <option value="warn">Warn (notification only)</option>
            <option value="throttle">Throttle (downgrade model)</option>
            <option value="block">Block (deny requests)</option>
          </select>
        </FormField>
        {budgetForm.actionOnLimit === 'throttle' && (
          <FormField label="Throttle To Model" hint="Model to downgrade to when budget exceeded">
            <input
              type="text"
              value={budgetForm.throttleToModel}
              onChange={e => setBudgetForm(f => ({ ...f, throttleToModel: e.target.value }))}
              placeholder="claude-haiku-3.5"
              style={inputStyle}
            />
          </FormField>
        )}
        <div className="flex items-center gap-4 mb-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-textSecondary)' }}>
            <input
              type="checkbox"
              checked={budgetForm.notifyEmail}
              onChange={e => setBudgetForm(f => ({ ...f, notifyEmail: e.target.checked }))}
            />
            Email notifications
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-textSecondary)' }}>
            <input
              type="checkbox"
              checked={budgetForm.notifySlack}
              onChange={e => setBudgetForm(f => ({ ...f, notifySlack: e.target.checked }))}
            />
            Slack notifications
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={() => { setBudgetModalOpen(false); setEditingBudget(null); }}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: 'var(--color-textSecondary)', border: '1px solid var(--color-border)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSaveBudget}
            disabled={actionLoading || !budgetForm.limitDollars}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--color-primary)', opacity: (actionLoading || !budgetForm.limitDollars) ? 0.6 : 1 }}
          >
            {actionLoading ? 'Saving...' : editingBudget ? 'Update Budget' : 'Create Budget'}
          </button>
        </div>
      </div>
    );
  }

  // =====================================================================
  // Report Detail (inside modal)
  // =====================================================================

  function renderReportDetail(r: ChargebackReport) {
    const costByProviderData = Object.entries(r.costByProvider || {}).map(([name, value]) => ({
      name: name.length > 20 ? name.slice(0, 17) + '...' : name,
      value,
    }));
    const costByModelDetailData = Object.entries(r.costByModel || {}).map(([name, value]) => ({
      name: name.length > 25 ? name.slice(0, 22) + '...' : name,
      value,
    }));

    return (
      <div className="space-y-5">
        {/* Status + workflow */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="text-sm px-3 py-1 rounded-full font-medium"
              style={{
                color: statusColor(r.status),
                background: `color-mix(in srgb, ${statusColor(r.status)} 15%, transparent)`,
              }}
            >
              {r.status}
            </span>
            {r.groupName && <span className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>Group: {r.groupName}</span>}
            {r.userName && <span className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>User: {r.userName}</span>}
          </div>
          {nextStatus(r.status) && (
            <button
              onClick={() => { handleAdvanceReportStatus(r); }}
              disabled={actionLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90"
              style={{ background: 'var(--ap-ok)' }}
            >
              <CheckCircle size={12} />
              Advance to {nextStatus(r.status)}
            </button>
          )}
        </div>

        {/* Status pipeline */}
        <div className="flex items-center gap-1">
          {STATUS_ORDER.map((s, i) => {
            const isActive = STATUS_ORDER.indexOf(r.status) >= i;
            return (
              <React.Fragment key={s}>
                <div
                  className="flex-1 h-2 rounded-full"
                  style={{
                    background: isActive ? statusColor(s) : 'var(--color-surfaceHover)',
                  }}
                />
                {i < STATUS_ORDER.length - 1 && <div className="w-1" />}
              </React.Fragment>
            );
          })}
        </div>
        <div className="flex justify-between text-xs" style={{ color: 'var(--color-textMuted)' }}>
          {STATUS_ORDER.map(s => <span key={s}>{s}</span>)}
        </div>

        {/* Token breakdown */}
        <div>
          <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--color-textSecondary)' }}>Token Breakdown</h4>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Input Tokens', value: r.totalInputTokens },
              { label: 'Output Tokens', value: r.totalOutputTokens },
              { label: 'Cached Tokens', value: r.totalCachedTokens },
              { label: 'Thinking Tokens', value: r.totalThinkingTokens },
            ].map(item => (
              <div
                key={item.label}
                className="p-2 rounded-lg"
                style={{ background: 'var(--color-surfaceHover)' }}
              >
                <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>{item.label}</div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{formatNumber(item.value)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Cost breakdown */}
        <div>
          <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--color-textSecondary)' }}>Cost Breakdown</h4>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'LLM Cost', value: r.totalLlmCost },
              { label: 'MCP Cost', value: r.totalMcpCost },
              { label: 'Compute Cost', value: r.totalComputeCost },
              { label: 'Storage Cost', value: r.totalStorageCost },
            ].map(item => (
              <div
                key={item.label}
                className="p-2 rounded-lg"
                style={{ background: 'var(--color-surfaceHover)' }}
              >
                <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>{item.label}</div>
                <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{formatDollars(item.value)}</div>
              </div>
            ))}
          </div>
          <div
            className="mt-2 p-3 rounded-lg flex items-center justify-between"
            style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}
          >
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Total Cost</span>
            <span className="text-lg font-bold" style={{ color: 'var(--color-primary)' }}>{formatDollars(r.totalCost)}</span>
          </div>
        </div>

        {/* Cost by provider mini-chart */}
        {costByProviderData.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--color-textSecondary)' }}>Cost by Provider</h4>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costByProviderData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ap-chart-grid, color-mix(in srgb, var(--color-text) 8%, transparent))" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--color-textSecondary)', fontSize: 10 }} />
                  <YAxis tickFormatter={(v) => `$${v.toFixed(2)}`} tick={{ fill: 'var(--color-textSecondary)', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name="Cost" fill="var(--ap-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Cost by model mini-chart */}
        {costByModelDetailData.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--color-textSecondary)' }}>Cost by Model</h4>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costByModelDetailData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ap-chart-grid, color-mix(in srgb, var(--color-text) 8%, transparent))" />
                  <XAxis type="number" tickFormatter={(v) => `$${v.toFixed(2)}`} tick={{ fill: 'var(--color-textSecondary)', fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fill: 'var(--color-textSecondary)', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" name="Cost" fill="var(--ap-accent)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Request count */}
        <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
          Total requests: {formatNumber(r.requestCount)}
          {r.createdAt && <span> | Generated: {new Date(r.createdAt).toLocaleString()}</span>}
        </div>
      </div>
    );
  }
};

export default ChargebackView;
