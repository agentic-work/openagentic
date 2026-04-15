/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * DLP Configuration — Rules management, tool exemptions, and audit log.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, Search, RefreshCw, Plus, Trash2, Check,
  ChevronDown, ChevronRight, Eye, EyeOff, Download, Filter, Sparkles,
} from '@/shared/icons';
import { AdminButton } from '../Shared/AdminButton';
import { AdminBadge } from '../Shared/AdminBadge';
import { AdminToast, useAdminToast } from '../Shared/AdminToast';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { apiRequest } from '@/utils/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DLPRule {
  id: string;
  category: string;
  name: string;
  description: string;
  pattern: string;
  flags: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  hits: number;
}

interface DLPExemption {
  id: string;
  toolPattern: string;
  scanPoint: string;
  exemptCategories: string[];
  reason: string;
  enabled: boolean;
}

interface AuditEvent {
  id: string;
  timestamp: string;
  toolName: string;
  scanPoint: string;
  action: string;
  severity: string;
  category: string;
  ruleName: string;
  ruleId: string;
  matchSnippet: string;
  userId: string;
  userName: string;
  sessionId: string;
  model?: string;
}

type TabId = 'rules' | 'exemptions' | 'audit';

const SEVERITY_COLORS: Record<string, string> = {
  low: 'var(--tier-economy, #10b981)',
  medium: 'var(--cap-tools, #f59e0b)',
  high: 'var(--toast-error, #FF453A)',
  critical: 'var(--cap-thinking, #ec4899)',
};

const CATEGORY_COLORS: Record<string, string> = {
  credential: 'var(--cap-tools, #f59e0b)',
  pii: 'var(--cap-chat, #3b82f6)',
  infrastructure: 'var(--cap-streaming, #6366f1)',
  compliance: 'var(--cap-embeddings, #8b5cf6)',
  injection: 'var(--toast-error, #FF453A)',
};

const ACTION_COLORS: Record<string, string> = {
  allow: 'var(--color-success, #10b981)',
  redact: 'var(--cap-tools, #f59e0b)',
  block: 'var(--toast-error, #FF453A)',
};

const CATEGORIES = ['credential', 'pii', 'infrastructure', 'compliance', 'injection'];

// ─── RULES TAB ────────────────────────────────────────────────────────────────

const RulesTab: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const [rules, setRules] = useState<DLPRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useAdminToast();

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiRequest('/admin/dlp/rules');
      const data = await res.json();
      setRules(data.rules || []);
    } catch (err: any) {
      showToast('error', 'Failed to load DLP rules');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const toggleRule = useCallback(async (rule: DLPRule) => {
    try {
      await apiRequest(`/admin/dlp/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      showToast('success', `${rule.name} ${rule.enabled ? 'disabled' : 'enabled'}`);
      fetchRules();
    } catch {
      showToast('error', 'Failed to toggle rule');
    }
  }, [fetchRules, showToast]);

  const updateSeverity = useCallback(async (ruleId: string, severity: string) => {
    try {
      await apiRequest(`/admin/dlp/rules/${ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ severity }),
      });
      showToast('success', 'Severity updated');
      fetchRules();
    } catch {
      showToast('error', 'Failed to update severity');
    }
  }, [fetchRules, showToast]);

  const categories = useMemo(() => [...new Set(rules.map(r => r.category))].sort(), [rules]);

  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      if (search && !r.name.toLowerCase().includes(search.toLowerCase())
        && !r.description.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterCategory !== 'all' && r.category !== filterCategory) return false;
      return true;
    });
  }, [rules, search, filterCategory]);

  const totalHits = useMemo(() => rules.reduce((sum, r) => sum + r.hits, 0), [rules]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--ap-accent)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminToast toast={toast} onDismiss={dismissToast} />

      {/* Summary metrics */}
      <div className="grid grid-cols-4 gap-3">
        <AdminMetricCard label="Total Rules" value={String(rules.length)} icon={<Shield size={16} />} />
        <AdminMetricCard label="Enabled" value={String(rules.filter(r => r.enabled).length)} icon={<Check size={16} />} />
        <AdminMetricCard label="Categories" value={String(categories.length)} icon={<Filter size={16} />} />
        <AdminMetricCard label="Total Hits" value={totalHits.toLocaleString()} icon={<Eye size={16} />} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search rules..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border outline-none"
            style={{
              background: 'var(--color-surfaceSecondary)',
              borderColor: 'var(--color-border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border outline-none"
          style={{
            background: 'var(--color-surfaceSecondary)',
            borderColor: 'var(--color-border)',
            color: 'var(--text-primary)',
          }}
        >
          <option value="all">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Rules table */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <div
          className="grid grid-cols-[1fr_120px_90px_70px_60px_80px] gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
          style={{ background: 'var(--color-surfaceSecondary)', color: 'var(--text-muted)' }}
        >
          <span>Rule</span>
          <span>Category</span>
          <span>Severity</span>
          <span>Hits</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {filteredRules.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            No rules match your filters.
          </div>
        ) : (
          filteredRules.map((rule, i) => (
            <div key={rule.id}>
              <div
                className={`grid grid-cols-[1fr_120px_90px_70px_60px_80px] gap-2 px-4 py-2.5 items-center text-xs cursor-pointer hover:bg-white/[0.02] transition-colors ${i > 0 ? 'border-t' : ''}`}
                style={{ borderColor: 'var(--color-border)', opacity: rule.enabled ? 1 : 0.5 }}
                onClick={() => setExpandedRule(expandedRule === rule.id ? null : rule.id)}
              >
                <div>
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{rule.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{rule.description}</div>
                </div>
                <AdminBadge color={CATEGORY_COLORS[rule.category] || 'var(--text-muted)'} label={rule.category} size="sm" />
                <AdminBadge color={SEVERITY_COLORS[rule.severity] || 'var(--text-muted)'} label={rule.severity} size="sm" />
                <span style={{ color: rule.hits > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {rule.hits}
                </span>
                <span>
                  <button
                    onClick={e => { e.stopPropagation(); toggleRule(rule); }}
                    className={`relative w-8 h-4 rounded-full transition-colors ${rule.enabled ? 'bg-emerald-500/60' : 'bg-gray-600'}`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${rule.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {expandedRule === rule.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </div>

              {expandedRule === rule.id && (
                <div
                  className="px-6 py-3 border-t"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surfaceSecondary)' }}
                >
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Pattern (Regex)</span>
                      <code
                        className="font-mono text-xs px-2 py-1 rounded block"
                        style={{ background: 'var(--color-surface)', color: 'var(--text-primary)' }}
                      >
                        /{rule.pattern}/{rule.flags}
                      </code>
                    </div>
                    <div>
                      <span className="font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Severity</span>
                      <div className="flex gap-1">
                        {['low', 'medium', 'high', 'critical'].map(s => (
                          <button
                            key={s}
                            onClick={() => updateSeverity(rule.id, s)}
                            className="px-2 py-1 text-xs rounded-md border transition-all"
                            style={{
                              background: rule.severity === s ? SEVERITY_COLORS[s] : 'transparent',
                              color: rule.severity === s ? 'white' : 'var(--text-muted)',
                              borderColor: rule.severity === s ? SEVERITY_COLORS[s] : 'var(--color-border)',
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ─── EXEMPTIONS TAB ───────────────────────────────────────────────────────────

const ExemptionsTab: React.FC = () => {
  const [exemptions, setExemptions] = useState<DLPExemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newExemption, setNewExemption] = useState({
    toolPattern: 'web_*',
    scanPoint: 'tool_result',
    exemptCategories: ['pii'] as string[],
    reason: '',
  });
  const { toast, showToast, dismissToast } = useAdminToast();

  const fetchExemptions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiRequest('/admin/dlp/exemptions');
      const data = await res.json();
      setExemptions(data.exemptions || []);
    } catch {
      showToast('error', 'Failed to load exemptions');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchExemptions(); }, [fetchExemptions]);

  const addExemption = useCallback(async () => {
    try {
      await apiRequest('/admin/dlp/exemptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newExemption),
      });
      showToast('success', 'Exemption added');
      setShowAdd(false);
      fetchExemptions();
    } catch {
      showToast('error', 'Failed to add exemption');
    }
  }, [newExemption, fetchExemptions, showToast]);

  const deleteExemption = useCallback(async (id: string) => {
    if (!confirm('Delete this exemption?')) return;
    try {
      await apiRequest(`/admin/dlp/exemptions/${id}`, { method: 'DELETE' });
      showToast('success', 'Exemption removed');
      fetchExemptions();
    } catch {
      showToast('error', 'Failed to delete exemption');
    }
  }, [fetchExemptions, showToast]);

  return (
    <div className="space-y-4">
      <AdminToast toast={toast} onDismiss={dismissToast} />

      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {exemptions.length} exemption{exemptions.length !== 1 ? 's' : ''} configured
        </p>
        <AdminButton variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => setShowAdd(true)}>
          Add Exemption
        </AdminButton>
      </div>

      {/* Add form */}
      {showAdd && (
        <div
          className="p-4 rounded-xl border space-y-3"
          style={{ borderColor: 'var(--ap-accent)', background: 'var(--color-surfaceSecondary)' }}
        >
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Tool Pattern</label>
              <input
                type="text"
                value={newExemption.toolPattern}
                onChange={e => setNewExemption(n => ({ ...n, toolPattern: e.target.value }))}
                placeholder="web_*"
                className="w-full px-3 py-1.5 text-xs rounded-lg border outline-none font-mono"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Scan Point</label>
              <select
                value={newExemption.scanPoint}
                onChange={e => setNewExemption(n => ({ ...n, scanPoint: e.target.value }))}
                className="w-full px-3 py-1.5 text-xs rounded-lg border outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
              >
                <option value="tool_input">Tool Input</option>
                <option value="tool_result">Tool Result</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Reason</label>
              <input
                type="text"
                value={newExemption.reason}
                onChange={e => setNewExemption(n => ({ ...n, reason: e.target.value }))}
                placeholder="Why this exemption?"
                className="w-full px-3 py-1.5 text-xs rounded-lg border outline-none"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Exempt Categories</label>
            <div className="flex gap-2">
              {CATEGORIES.map(cat => {
                const active = newExemption.exemptCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => setNewExemption(n => ({
                      ...n,
                      exemptCategories: active
                        ? n.exemptCategories.filter(c => c !== cat)
                        : [...n.exemptCategories, cat],
                    }))}
                    className="px-2.5 py-1 text-xs font-medium rounded-lg border transition-all"
                    style={{
                      background: active ? CATEGORY_COLORS[cat] : 'transparent',
                      color: active ? 'white' : 'var(--text-muted)',
                      borderColor: active ? CATEGORY_COLORS[cat] : 'var(--color-border)',
                    }}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <AdminButton variant="primary" size="sm" onClick={addExemption}>Save</AdminButton>
            <AdminButton size="sm" onClick={() => setShowAdd(false)}>Cancel</AdminButton>
          </div>
        </div>
      )}

      {/* Exemptions list */}
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--ap-accent)' }} />
        </div>
      ) : exemptions.length === 0 ? (
        <div className="text-center py-8 text-xs" style={{ color: 'var(--text-muted)' }}>
          No exemptions configured.
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div
            className="grid grid-cols-[1fr_120px_1fr_1fr_60px] gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
            style={{ background: 'var(--color-surfaceSecondary)', color: 'var(--text-muted)' }}
          >
            <span>Tool Pattern</span>
            <span>Scan Point</span>
            <span>Exempt Categories</span>
            <span>Reason</span>
            <span></span>
          </div>
          {exemptions.map((ex, i) => (
            <div
              key={ex.id}
              className={`grid grid-cols-[1fr_120px_1fr_1fr_60px] gap-2 px-4 py-3 items-center text-xs ${i > 0 ? 'border-t' : ''}`}
              style={{ borderColor: 'var(--color-border)' }}
            >
              <code className="font-mono" style={{ color: 'var(--text-primary)' }}>{ex.toolPattern}</code>
              <AdminBadge color="var(--cap-streaming, #6366f1)" label={ex.scanPoint} size="sm" />
              <div className="flex gap-1 flex-wrap">
                {ex.exemptCategories.map(cat => (
                  <AdminBadge key={cat} color={CATEGORY_COLORS[cat] || 'var(--text-muted)'} label={cat} size="sm" />
                ))}
              </div>
              <span style={{ color: 'var(--text-muted)' }}>{ex.reason}</span>
              <button
                onClick={() => deleteExemption(ex.id)}
                className="p-1 rounded hover:bg-red-500/20 transition-colors"
              >
                <Trash2 size={13} className="text-red-400/60" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── AUDIT LOG TAB ────────────────────────────────────────────────────────────

const AuditLogTab: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('7');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  const fetchLog = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: '100', days });
      if (filterSeverity) params.set('severity', filterSeverity);
      if (filterAction) params.set('action', filterAction);
      const res = await apiRequest(`/admin/dlp/audit-log?${params}`);
      const data = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
    } catch {
      // silent — empty state handles display
    } finally {
      setLoading(false);
    }
  }, [days, filterSeverity, filterAction]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  const exportLog = useCallback(async () => {
    const params = new URLSearchParams({ limit: '10000', days });
    if (filterSeverity) params.set('severity', filterSeverity);
    if (filterAction) params.set('action', filterAction);
    const res = await apiRequest(`/admin/dlp/audit-log?${params}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data.events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dlp-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [days, filterSeverity, filterAction]);

  const blocked = events.filter(e => e.action === 'block').length;
  const redacted = events.filter(e => e.action === 'redact').length;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={days}
          onChange={e => setDays(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border outline-none"
          style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
        >
          <option value="1">Last 24h</option>
          <option value="7">Last 7d</option>
          <option value="30">Last 30d</option>
          <option value="90">Last 90d</option>
        </select>
        <select
          value={filterSeverity}
          onChange={e => setFilterSeverity(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border outline-none"
          style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
        >
          <option value="">All Severities</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border outline-none"
          style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
        >
          <option value="">All Actions</option>
          <option value="allow">Allow</option>
          <option value="redact">Redact</option>
          <option value="block">Block</option>
        </select>
        <div className="ml-auto flex gap-2">
          <AdminButton size="sm" icon={<Download size={12} />} onClick={exportLog}>Export JSON</AdminButton>
          <AdminButton size="sm" icon={<RefreshCw size={12} />} onClick={fetchLog} loading={loading}>Refresh</AdminButton>
        </div>
      </div>

      {/* Activity diagram */}
      {events.length > 0 && (() => {
        const allowed = events.filter(e => e.action === 'allow').length;
        const totalEvts = events.length;
        const blockedPct = totalEvts > 0 ? (blocked / totalEvts * 100) : 0;
        const redactedPct = totalEvts > 0 ? (redacted / totalEvts * 100) : 0;
        const allowedPct = totalEvts > 0 ? (allowed / totalEvts * 100) : 0;
        // Category breakdown
        const catCounts: Record<string, number> = {};
        events.forEach(e => { catCounts[e.category] = (catCounts[e.category] || 0) + 1; });
        const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

        return (
          <div className="p-3 rounded-xl border space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: 'var(--text-primary)' }}>{totalEvts} events</span>
              <div className="flex gap-3">
                <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: 'var(--toast-error)' }} />{blocked} blocked</span>
                <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: 'var(--cap-tools)' }} />{redacted} redacted</span>
                <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: 'var(--color-success)' }} />{allowed} allowed</span>
              </div>
            </div>
            {/* Stacked bar */}
            <div className="flex h-3 rounded-full overflow-hidden" style={{ background: 'var(--color-surface)' }}>
              {blockedPct > 0 && <div style={{ width: `${blockedPct}%`, background: 'var(--toast-error)' }} title={`${blocked} blocked`} />}
              {redactedPct > 0 && <div style={{ width: `${redactedPct}%`, background: 'var(--cap-tools)' }} title={`${redacted} redacted`} />}
              {allowedPct > 0 && <div style={{ width: `${allowedPct}%`, background: 'var(--color-success)' }} title={`${allowed} allowed`} />}
            </div>
            {/* Category chips */}
            <div className="flex gap-2 text-xs">
              {topCats.map(([cat, count]) => (
                <span key={cat} className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_COLORS[cat] || 'var(--text-muted)' }} />
                  {cat}: {count}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Events list */}
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--ap-accent)' }} />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-8 text-xs" style={{ color: 'var(--text-muted)' }}>
          No DLP events in the selected time range.
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden max-h-[600px] overflow-y-auto" style={{ borderColor: 'var(--color-border)' }}>
          {events.map((evt, i) => (
            <div key={evt.id} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--color-border)' }}>
              <div
                className="flex items-center justify-between px-4 py-2.5 text-xs cursor-pointer hover:bg-white/[0.02] transition-colors"
                onClick={() => setExpandedEvent(expandedEvent === evt.id ? null : evt.id)}
              >
                <div className="flex items-center gap-3">
                  <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                  <code className="font-mono" style={{ color: 'var(--text-primary)' }}>{evt.toolName}</code>
                  <AdminBadge color={ACTION_COLORS[evt.action] || 'var(--text-muted)'} label={evt.action} size="sm" />
                  <AdminBadge color={SEVERITY_COLORS[evt.severity] || 'var(--text-muted)'} label={evt.severity} size="sm" />
                  <AdminBadge color={CATEGORY_COLORS[evt.category] || 'var(--text-muted)'} label={evt.category} size="sm" />
                </div>
                <span style={{ color: 'var(--text-muted)' }}>
                  {evt.userName || 'unknown'}
                </span>
              </div>

              {expandedEvent === evt.id && (
                <div
                  className="px-6 py-3 border-t text-xs space-y-1"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surfaceSecondary)' }}
                >
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Rule:</span>{' '}
                    <span style={{ color: 'var(--text-primary)' }}>{evt.ruleName}</span> ({evt.ruleId})
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Scan Point:</span>{' '}
                    <span style={{ color: 'var(--text-primary)' }}>{evt.scanPoint}</span>
                  </div>
                  {evt.matchSnippet && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Match:</span>{' '}
                      <code
                        className="font-mono px-1 py-0.5 rounded"
                        style={{ background: 'var(--color-surface)', color: 'var(--text-primary)' }}
                      >
                        {evt.matchSnippet}
                      </code>
                    </div>
                  )}
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>User:</span>{' '}
                    <span style={{ color: 'var(--text-primary)' }}>{evt.userName}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({evt.userId})</span>
                  </div>
                  {evt.model && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Model:</span>{' '}
                      <code className="font-mono" style={{ color: 'var(--text-primary)' }}>{evt.model}</code>
                    </div>
                  )}
                  {evt.sessionId && (
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Session:</span> {evt.sessionId}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

interface DLPConfigViewProps {
  theme: string;
}

export const DLPConfigView: React.FC<DLPConfigViewProps> = ({ theme }) => {
  const [activeTab, setActiveTab] = useState<TabId>('rules');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    setAiSummary(null);
    try {
      const res = await apiRequest('/admin/dlp/ai-summary');
      const data = await res.json();
      setAiSummary(data.summary || 'No summary available.');
    } catch {
      setAiSummary('Failed to generate summary.');
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const TABS: { id: TabId; label: string }[] = [
    { id: 'rules', label: 'Rules' },
    { id: 'exemptions', label: 'Exemptions' },
    { id: 'audit', label: 'Audit Log' },
  ];

  return (
    <div className="space-y-5">
      {/* Tabs + Summary button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-surfaceSecondary)' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === tab.id ? 'shadow-sm' : 'hover:opacity-80'}`}
              style={{
                background: activeTab === tab.id ? 'var(--ap-accent)' : 'transparent',
                color: activeTab === tab.id ? 'white' : 'var(--text-muted)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <AdminButton
          size="sm"
          variant={aiSummary ? 'secondary' : 'primary'}
          icon={<Sparkles size={12} />}
          loading={loadingSummary}
          onClick={fetchSummary}
        >
          {aiSummary ? 'Refresh Summary' : 'AI Summary'}
        </AdminButton>
      </div>

      {/* AI Summary card */}
      {aiSummary && (
        <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--cap-streaming, #6366f1)', background: 'color-mix(in srgb, var(--cap-streaming, #6366f1) 5%, transparent)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} style={{ color: 'var(--cap-streaming, #6366f1)' }} />
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>DLP Status Summary</span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{aiSummary}</p>
        </div>
      )}

      {activeTab === 'rules' && <RulesTab onRefresh={() => {}} />}
      {activeTab === 'exemptions' && <ExemptionsTab />}
      {activeTab === 'audit' && <AuditLogTab />}
    </div>
  );
};

export default DLPConfigView;
