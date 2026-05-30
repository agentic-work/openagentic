/**
 * Integrations View - Slack & Teams Integration Management
 *
 * Features:
 * - Integration cards grid with status, webhook URL, channel/workflow counts
 * - Add/Edit integration dialog with platform-specific config
 * - Detail panel with masked secrets, logs table, enable/disable toggle
 * - Metric cards row: total, active, messages today, workflows triggered
 * - Rich test connection diagnostics (workspace, user, botId, scopes for Slack;
 *   tokenType/expiresIn for Teams)
 * - Per-field error highlighting when format validation fails
 * - "Send test message" button for Slack after a successful auth test
 * - Last-test status stored in config.lastTest JSON (no migration needed)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Copy, Check, Plus, Trash2, Eye, Send, Search } from '@/shared/icons';
import {
  RefreshIcon, ActivityIcon, ServerIcon, EditIcon, CloseIcon,
  ToggleOnIcon, ToggleOffIcon, Loader2
} from '../Shared/AdminIcons';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { AdminStatusBadge } from '../Shared/AdminStatusBadge';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { apiRequest } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appId: string;
}

interface TeamsConfig {
  appId: string;
  appPassword: string;
  tenantId: string;
}

interface Integration {
  id: string;
  name: string;
  platform: 'slack' | 'teams';
  status: 'active' | 'inactive' | 'error' | 'pending';
  webhookUrl: string;
  config: SlackConfig | TeamsConfig;
  channels: string[];
  workflowIds: string[];
  channelCount: number;
  workflowCount: number;
  lastActivity: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  user: string;
  status: 'success' | 'error' | 'dropped';
  messagePreview: string;
}

interface IntegrationsViewProps {
  theme: string;
}

// Test result with rich diagnostics
interface TestResult {
  ok: boolean;
  message: string;
  details?: {
    // Slack
    team?: string;
    teamId?: string;
    user?: string;
    userId?: string;
    botId?: string;
    url?: string;
    scopes?: string[];
    // Teams
    tokenType?: string;
    expiresIn?: number;
    appDisplayName?: string;
    // Errors
    error?: string;
    field?: string;
  };
  testStatus?: 'active' | 'error' | 'untested';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskSecret(value: string): string {
  if (!value || value.length < 8) return '********';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function buildTestResultMessage(platform: string, data: any): TestResult {
  if (!data.success) {
    const error = data.details?.error ?? 'unknown_error';
    const field = data.details?.field;
    return {
      ok: false,
      message: error,
      details: { error, field },
      testStatus: 'error',
    };
  }

  if (platform === 'slack') {
    const d = data.details ?? {};
    const scopes = d.scopes?.join(', ');
    const msg = [
      `Connected to workspace **${d.team}** as **@${d.user}** (bot id ${d.botId}).`,
      scopes ? `Scopes: ${scopes}` : '',
    ].filter(Boolean).join(' ');

    return { ok: true, message: msg, details: d, testStatus: 'active' };
  }

  if (platform === 'teams') {
    const d = data.details ?? {};
    const msg = `Authenticated against Bot Framework. Token type: ${d.tokenType}, expires in ${d.expiresIn}s.`;
    return { ok: true, message: msg, details: d, testStatus: 'active' };
  }

  return { ok: true, message: 'Connection successful', testStatus: 'active' };
}

// ---------------------------------------------------------------------------
// Platform Icons
// ---------------------------------------------------------------------------
// Hex literals below are vendor BRAND IDENTITY colors (Slack #E01E5A/#36C5F0/
// #2EB67D/#ECB22E, Teams #5059C9/#7B83EB/#4F52B2). Non-themeable by design —
// see Shared/ProviderIcons.tsx for the same pattern.
/* eslint-disable admin-tokens/no-hardcoded-admin-color */

const SlackIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313z" fill="#E01E5A"/>
    <path d="M8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 012.521 2.521 2.527 2.527 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312z" fill="#36C5F0"/>
    <path d="M18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.163 0a2.528 2.528 0 012.523 2.522v6.312z" fill="#2EB67D"/>
    <path d="M15.163 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.163 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 01-2.52-2.523 2.527 2.527 0 012.52-2.52h6.315A2.528 2.528 0 0124 15.163a2.528 2.528 0 01-2.522 2.523h-6.315z" fill="#ECB22E"/>
  </svg>
);

const TeamsIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M20.625 6.547h-5.156c.098.32.156.66.156 1.015v8.438a3.188 3.188 0 01-3.188 3.188H9.75v.374A2.438 2.438 0 0012.188 22h6.187l2.688 2v-2h.187A2.438 2.438 0 0023.688 19.562v-5.578a2.438 2.438 0 00-2.438-2.437h-.625z" fill="#5059C9"/>
    <path d="M21 5.25a2.25 2.25 0 10-4.5 0 2.25 2.25 0 004.5 0z" fill="#5059C9"/>
    <path d="M15.375 7.563a2.438 2.438 0 00-2.438-2.438H4.5A2.438 2.438 0 002.063 7.562V14a3.188 3.188 0 003.187 3.188h4.125v3.374l3.375-3.374h.188A2.438 2.438 0 0015.375 14.75V7.562z" fill="#7B83EB"/>
    <path d="M17.25 4.5a2.625 2.625 0 10-5.25 0 2.625 2.625 0 005.25 0z" fill="#7B83EB"/>
    <circle cx="8.625" cy="4.5" r="3" fill="#4F52B2"/>
  </svg>
);

/* eslint-enable admin-tokens/no-hardcoded-admin-color */

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({ theme }) => {
  // State
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [timeRange, setTimeRange] = useState('24h');

  // Detail panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLogs, setDetailLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Add/Edit dialog
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formPlatform, setFormPlatform] = useState<'slack' | 'teams'>('slack');
  const [formName, setFormName] = useState('');
  const [formSlack, setFormSlack] = useState<SlackConfig>({ botToken: '', signingSecret: '', appId: '' });
  const [formTeams, setFormTeams] = useState<TeamsConfig>({ appId: '', appPassword: '', tenantId: '' });
  const [formChannels, setFormChannels] = useState('');
  const [formWorkflows, setFormWorkflows] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Send test message state
  const [showSendMessage, setShowSendMessage] = useState(false);
  const [sendChannel, setSendChannel] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Clipboard
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState({ total: 0, active: 0, messagesToday: 0, workflowsTriggered: 0 });

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await apiRequest('/admin/integrations');
      if (!res.ok) throw new Error(`Failed to load integrations (${res.status})`);
      const data = await res.json();
      const list: Integration[] = data.integrations || data || [];
      setIntegrations(list);

      const active = list.filter((i) => i.status === 'active').length;
      setMetrics({
        total: list.length,
        active,
        messagesToday: data.messagesToday ?? 0,
        workflowsTriggered: data.workflowsTriggered ?? 0,
      });
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const fetchLogs = useCallback(async (id: string) => {
    setLogsLoading(true);
    try {
      const res = await apiRequest(`/admin/integrations/${id}/logs`);
      if (!res.ok) throw new Error('Failed to load logs');
      const data = await res.json();
      setDetailLogs(data.logs || []);
    } catch {
      setDetailLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    await fetchIntegrations();
    setLoading(false);
  }, [fetchIntegrations]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchIntegrations();
    if (selectedId) await fetchLogs(selectedId);
    setRefreshing(false);
  }, [fetchIntegrations, fetchLogs, selectedId]);

  useEffect(() => { load(); }, [load]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleSelectIntegration = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
    fetchLogs(id);
  }, [fetchLogs]);

  const handleCopyWebhook = useCallback((id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this integration? This cannot be undone.')) return;
    try {
      const res = await apiRequest(`/admin/integrations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setIntegrations((prev) => prev.filter((i) => i.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [selectedId]);

  const handleToggle = useCallback(async (integration: Integration) => {
    const newStatus = integration.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await apiRequest(`/admin/integrations/${integration.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      setIntegrations((prev) =>
        prev.map((i) => (i.id === integration.id ? { ...i, status: newStatus } : i))
      );
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const openAddDialog = useCallback(() => {
    setEditingId(null);
    setFormPlatform('slack');
    setFormName('');
    setFormSlack({ botToken: '', signingSecret: '', appId: '' });
    setFormTeams({ appId: '', appPassword: '', tenantId: '' });
    setFormChannels('');
    setFormWorkflows('');
    setTestResult(null);
    setShowSendMessage(false);
    setSendResult(null);
    setSendChannel('');
    setShowDialog(true);
  }, []);

  const openEditDialog = useCallback((integration: Integration) => {
    setEditingId(integration.id);
    setFormPlatform(integration.platform);
    setFormName(integration.name);
    // The list endpoint omits `config` for security (don't leak secrets in
    // list responses). Defensive default to {} so we don't crash; user must
    // re-paste credentials to update them, or leave blank to keep existing
    // (the save handler ignores empty config fields). A future improvement
    // is to fetch /integrations/:id on edit and show "(unchanged)" placeholders.
    if (integration.platform === 'slack') {
      const cfg = (integration.config || {}) as SlackConfig;
      setFormSlack({ botToken: cfg.botToken || '', signingSecret: cfg.signingSecret || '', appId: cfg.appId || '' });
    } else {
      const cfg = (integration.config || {}) as TeamsConfig;
      setFormTeams({ appId: cfg.appId || '', appPassword: cfg.appPassword || '', tenantId: cfg.tenantId || '' });
    }
    setFormChannels(integration.channels?.join(', ') || '');
    setFormWorkflows(integration.workflowIds?.join(', ') || '');
    setTestResult(null);
    setShowSendMessage(false);
    setSendResult(null);
    setSendChannel('');
    setShowDialog(true);
  }, []);

  // B1: Fix response parsing — check data.success, not res.ok alone
  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setShowSendMessage(false);
    setSendResult(null);
    try {
      const id = editingId;
      if (id) {
        const res = await apiRequest(`/admin/integrations/${id}/test`, { method: 'POST' });
        const data = await res.json();

        // B1: Defense-in-depth: check both res.ok AND data.success
        const isSuccess = res.ok && data.success === true;
        const result = buildTestResultMessage(formPlatform, data);
        setTestResult(result);

        // B4: Show send message only after Slack auth success
        if (isSuccess && formPlatform === 'slack') {
          setShowSendMessage(true);
        }

        // B5: Persist last test result into integration config (client-side only for now)
        // The actual config.lastTest is stored server-side via PUT /integrations/:id
        // We update local state optimistically
        const lastTest = {
          status: isSuccess ? 'active' : 'error',
          error: isSuccess ? undefined : (data.details?.error || 'unknown'),
          testedAt: new Date().toISOString(),
        };
        setIntegrations((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  config: { ...i.config, lastTest } as any,
                  status: isSuccess ? 'active' : i.status,
                }
              : i
          )
        );
      } else {
        setTestResult({ ok: false, message: 'Save integration first, then test', testStatus: 'untested' });
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message, testStatus: 'error' });
    } finally {
      setTesting(false);
    }
  }, [editingId, formPlatform]);

  // A6: Send test message
  const handleSendMessage = useCallback(async () => {
    if (!editingId || !sendChannel) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await apiRequest(`/admin/integrations/${editingId}/test/send-message`, {
        method: 'POST',
        body: JSON.stringify({ channel: sendChannel }),
      });
      const data = await res.json();
      if (data.success) {
        setSendResult({ ok: true, message: `Message sent! (ts: ${data.details?.ts})` });
      } else {
        setSendResult({ ok: false, message: data.details?.error || 'Send failed' });
      }
    } catch (err: any) {
      setSendResult({ ok: false, message: err.message });
    } finally {
      setSending(false);
    }
  }, [editingId, sendChannel]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: formName,
        platform: formPlatform,
        config: formPlatform === 'slack' ? formSlack : formTeams,
        channels: formChannels.split(',').map((c) => c.trim()).filter(Boolean),
        workflowIds: formWorkflows.split(',').map((w) => w.trim()).filter(Boolean),
      };

      const res = editingId
        ? await apiRequest(`/admin/integrations/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiRequest('/admin/integrations', { method: 'POST', body: JSON.stringify(payload) });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Save failed (${res.status})`);
      }

      setShowDialog(false);
      await fetchIntegrations();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [editingId, formName, formPlatform, formSlack, formTeams, formChannels, formWorkflows, fetchIntegrations]);

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  const filtered = integrations.filter((i) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return i.name.toLowerCase().includes(q) || i.platform.includes(q) || i.status.includes(q);
  });

  const selected = selectedId ? integrations.find((i) => i.id === selectedId) : null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={['Admin', 'Integrations']}
        title="Integrations"
        explainer="Connect Slack, Teams, and other platforms — view delivery logs and trigger workflows from inbound messages."
        actions={[
          { label: 'Add Integration', primary: true, onClick: () => openAddDialog() },
          { label: 'Refresh', onClick: () => refresh(), disabled: refreshing },
        ]}
      />

      {/* Metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard label="Total Integrations" value={metrics.total} loading={loading} />
        <AdminMetricCard label="Active" value={metrics.active} loading={loading}
          subtext={metrics.total > 0 ? `${Math.round((metrics.active / metrics.total) * 100)}% of total` : undefined} />
        <AdminMetricCard label="Messages Today" value={metrics.messagesToday} loading={loading}
          tooltip="Inbound + outbound messages in the last 24 hours" />
        <AdminMetricCard label="Workflows Triggered" value={metrics.workflowsTriggered} loading={loading}
          tooltip="Workflows triggered by integration messages today" />
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <AdminFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          onRefresh={refresh}
          refreshing={refreshing}
        />
        <button
          onClick={openAddDialog}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--ap-fg-0)',
          }}
        >
          <Plus size={14} /> Add Integration
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="px-4 py-3 rounded-md text-sm flex items-center gap-2"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 12%, transparent)', color: 'var(--color-error)' }}
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto opacity-60 hover:opacity-100">
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {/* Main content: cards grid + detail panel */}
      <div className="flex gap-6">
        {/* Cards grid */}
        <div className={`flex-1 ${selected ? 'max-w-[55%]' : ''}`}>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((k) => (
                <div key={k} className="animate-pulse rounded-lg p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', height: 180 }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16" style={{ color: 'var(--text-tertiary)' }}>
              <ServerIcon size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                {searchTerm ? 'No integrations match your search.' : 'No integrations configured yet.'}
              </p>
              {!searchTerm && (
                <button onClick={openAddDialog} className="mt-3 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  Add your first integration
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  isSelected={selectedId === integration.id}
                  copiedId={copiedId}
                  onSelect={handleSelectIntegration}
                  onCopy={handleCopyWebhook}
                  onEdit={openEditDialog}
                  onDelete={handleDelete}
                  onTest={(id) => {
                    // Card-level Test opens the inspect/edit dialog so the
                    // RichTestResult panel is visible. Without this, the test
                    // ran silently and the user saw nothing.
                    const integration = integrations.find((it) => it.id === id);
                    if (integration) {
                      openEditDialog(integration);
                      // Trigger the test once the dialog has opened.
                      setTimeout(() => handleTestConnection(), 0);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <DetailPanel
            integration={selected}
            logs={detailLogs}
            logsLoading={logsLoading}
            onClose={() => setSelectedId(null)}
            onToggle={() => handleToggle(selected)}
          />
        )}
      </div>

      {/* Add/Edit dialog */}
      {showDialog && (
        <IntegrationDialog
          editingId={editingId}
          platform={formPlatform}
          name={formName}
          slackConfig={formSlack}
          teamsConfig={formTeams}
          channels={formChannels}
          workflows={formWorkflows}
          saving={saving}
          testing={testing}
          testResult={testResult}
          showSendMessage={showSendMessage}
          sendChannel={sendChannel}
          sending={sending}
          sendResult={sendResult}
          onPlatformChange={setFormPlatform}
          onNameChange={setFormName}
          onSlackChange={setFormSlack}
          onTeamsChange={setFormTeams}
          onChannelsChange={setFormChannels}
          onWorkflowsChange={setFormWorkflows}
          onTest={handleTestConnection}
          onSendChannelChange={setSendChannel}
          onSendMessage={handleSendMessage}
          onSave={handleSave}
          onClose={() => setShowDialog(false)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// IntegrationCard
// ---------------------------------------------------------------------------

const IntegrationCard: React.FC<{
  integration: Integration;
  isSelected: boolean;
  copiedId: string | null;
  onSelect: (id: string) => void;
  onCopy: (id: string, url: string) => void;
  onEdit: (i: Integration) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
}> = ({ integration, isSelected, copiedId, onSelect, onCopy, onEdit, onDelete, onTest }) => {
  const { id, name, platform, status, webhookUrl, channelCount, workflowCount, lastActivity } = integration;

  // B5: Derive display status from lastTest if present.
  // Defensive: list endpoint omits `config` for security; treat as {}.
  const config = (integration.config || {}) as any;
  const lastTest = config?.lastTest;
  const displayStatus = lastTest?.status === 'error' ? 'error' : status;

  return (
    <div
      className="rounded-lg p-4 cursor-pointer transition-all duration-150"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
        boxShadow: isSelected ? '0 0 0 1px var(--color-primary)' : undefined,
      }}
      onClick={() => onSelect(id)}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              // Slack #E01E5A and Teams #5059C9 — brand-tinted backgrounds.
              // eslint-disable-next-line admin-tokens/no-hardcoded-admin-color
              backgroundColor: platform === 'slack'
                // eslint-disable-next-line admin-tokens/no-hardcoded-admin-color
                ? 'color-mix(in srgb, #E01E5A 15%, transparent)'
                // eslint-disable-next-line admin-tokens/no-hardcoded-admin-color
                : 'color-mix(in srgb, #5059C9 15%, transparent)',
            }}
          >
            {platform === 'slack' ? <SlackIcon size={18} /> : <TeamsIcon size={18} />}
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{name}</div>
            <div className="text-xs capitalize" style={{ color: 'var(--text-tertiary)' }}>{platform}</div>
          </div>
        </div>
        <AdminStatusBadge status={displayStatus} size="sm" />
      </div>

      {/* Webhook URL */}
      <div className="flex items-center gap-1.5 mb-3">
        <code
          className="text-xs truncate flex-1 px-2 py-1 rounded"
          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--text-secondary)', fontFamily: 'monospace' }}
        >
          {webhookUrl}
        </code>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(id, webhookUrl); }}
          className="p-1 rounded transition-colors flex-shrink-0"
          style={{ color: copiedId === id ? 'var(--color-success)' : 'var(--text-tertiary)' }}
          title="Copy webhook URL"
        >
          {copiedId === id ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
        <span>{channelCount} channel{channelCount !== 1 ? 's' : ''}</span>
        <span>{workflowCount} workflow{workflowCount !== 1 ? 's' : ''}</span>
        <span className="ml-auto">{timeAgo(lastActivity)}</span>
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-1 pt-2"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <ActionButton label="Edit" icon={<EditIcon size={13} />} onClick={(e) => { e.stopPropagation(); onEdit(integration); }} />
        <ActionButton label="Test" icon={<Send size={13} />} onClick={(e) => { e.stopPropagation(); onTest(id); }} />
        <ActionButton label="Delete" icon={<Trash2 size={13} />} danger onClick={(e) => { e.stopPropagation(); onDelete(id); }} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ActionButton
// ---------------------------------------------------------------------------

const ActionButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onClick: (e: React.MouseEvent) => void;
}> = ({ label, icon, danger, onClick }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
    style={{ color: danger ? 'var(--color-error)' : 'var(--text-secondary)' }}
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = danger
        ? 'color-mix(in srgb, var(--color-error) 10%, transparent)'
        : 'color-mix(in srgb, var(--color-primary) 10%, transparent)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = 'transparent';
    }}
    title={label}
  >
    {icon}
    <span>{label}</span>
  </button>
);

// ---------------------------------------------------------------------------
// DetailPanel
// ---------------------------------------------------------------------------

const DetailPanel: React.FC<{
  integration: Integration;
  logs: LogEntry[];
  logsLoading: boolean;
  onClose: () => void;
  onToggle: () => void;
}> = ({ integration, logs, logsLoading, onClose, onToggle }) => {
  const isActive = integration.status === 'active';
  // List endpoint omits `config` for security; default to {} so the inspector
  // renders cleanly with masked placeholders instead of crashing.
  const config = integration.config || {};

  const configRows: Array<{ label: string; value: string }> = integration.platform === 'slack'
    ? [
        { label: 'Bot Token', value: maskSecret((config as SlackConfig).botToken || '') },
        { label: 'Signing Secret', value: maskSecret((config as SlackConfig).signingSecret || '') },
        { label: 'App ID', value: (config as SlackConfig).appId || '-' },
      ]
    : [
        { label: 'App ID', value: (config as TeamsConfig).appId || '-' },
        { label: 'App Password', value: maskSecret((config as TeamsConfig).appPassword || '') },
        { label: 'Tenant ID', value: (config as TeamsConfig).tenantId || '-' },
      ];

  return (
    <div
      className="w-[45%] max-w-[480px] rounded-lg overflow-hidden flex flex-col"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          {integration.platform === 'slack' ? <SlackIcon size={16} /> : <TeamsIcon size={16} />}
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{integration.name}</span>
          <AdminStatusBadge status={integration.status} size="sm" />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className="p-1 rounded transition-colors"
            style={{ color: isActive ? 'var(--color-success)' : 'var(--text-tertiary)' }}
            title={isActive ? 'Disable' : 'Enable'}
          >
            {isActive ? <ToggleOnIcon size={20} /> : <ToggleOffIcon size={20} />}
          </button>
          <button onClick={onClose} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }}>
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      {/* Config summary */}
      <div className="px-4 py-3 space-y-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Configuration</div>
        {configRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-tertiary)' }}>{row.label}</span>
            <code className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 11 }}>
              {row.value}
            </code>
          </div>
        ))}
        <div className="flex items-center justify-between text-xs pt-1">
          <span style={{ color: 'var(--text-tertiary)' }}>Channels</span>
          <span style={{ color: 'var(--text-secondary)' }}>{integration.channels?.join(', ') || 'All'}</span>
        </div>
      </div>

      {/* Logs table */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          Recent Activity
          <InfoTooltip content="Last 50 log entries from this integration" />
        </div>

        {logsLoading ? (
          <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-tertiary)' }}>
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No activity recorded yet.
          </div>
        ) : (
          <div className="space-y-0">
            <div
              className="grid text-xs font-medium uppercase tracking-wider py-1.5 px-2"
              style={{ color: 'var(--text-tertiary)', gridTemplateColumns: '70px 36px 1fr 60px 1fr' }}
            >
              <span>Time</span>
              <span>Dir</span>
              <span>Channel</span>
              <span>Status</span>
              <span>Message</span>
            </div>
            {logs.map((log) => (
              <div
                key={log.id}
                className="grid text-xs py-1.5 px-2 rounded transition-colors"
                style={{ gridTemplateColumns: '70px 36px 1fr 60px 1fr', color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--color-primary) 5%, transparent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span className="truncate" style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace', fontSize: 10 }}>
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span
                  className="text-xs font-medium"
                  style={{ color: log.direction === 'inbound' ? 'var(--color-primary)' : 'var(--color-success)' }}
                >
                  {log.direction === 'inbound' ? 'IN' : 'OUT'}
                </span>
                <span className="truncate">{log.channel || '-'}</span>
                <AdminStatusBadge status={log.status} size="sm" />
                <span className="truncate" style={{ color: 'var(--text-tertiary)' }}>{log.messagePreview}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// IntegrationDialog (Add/Edit)
// ---------------------------------------------------------------------------

const IntegrationDialog: React.FC<{
  editingId: string | null;
  platform: 'slack' | 'teams';
  name: string;
  slackConfig: SlackConfig;
  teamsConfig: TeamsConfig;
  channels: string;
  workflows: string;
  saving: boolean;
  testing: boolean;
  testResult: TestResult | null;
  showSendMessage: boolean;
  sendChannel: string;
  sending: boolean;
  sendResult: { ok: boolean; message: string } | null;
  onPlatformChange: (p: 'slack' | 'teams') => void;
  onNameChange: (v: string) => void;
  onSlackChange: (c: SlackConfig) => void;
  onTeamsChange: (c: TeamsConfig) => void;
  onChannelsChange: (v: string) => void;
  onWorkflowsChange: (v: string) => void;
  onTest: () => void;
  onSendChannelChange: (v: string) => void;
  onSendMessage: () => void;
  onSave: () => void;
  onClose: () => void;
}> = ({
  editingId, platform, name, slackConfig, teamsConfig, channels, workflows,
  saving, testing, testResult, showSendMessage, sendChannel, sending, sendResult,
  onPlatformChange, onNameChange, onSlackChange, onTeamsChange,
  onChannelsChange, onWorkflowsChange, onTest, onSendChannelChange, onSendMessage,
  onSave, onClose,
}) => {
  const isEdit = !!editingId;

  // B3: Track which field has an error
  const errorField = testResult?.details?.field;

  const inputStyle = (field?: string): React.CSSProperties => ({
    backgroundColor: 'var(--color-bg)',
    border: `1px solid ${field && errorField === field ? 'var(--color-error)' : 'var(--color-border)'}`,
    color: 'var(--text-primary)',
    outline: 'none',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div
        className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {/* Dialog header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? 'Edit Integration' : 'Add Integration'}
          </h3>
          <button onClick={onClose} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }}>
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Platform tabs */}
          {!isEdit && (
            <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              {(['slack', 'teams'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => onPlatformChange(p)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: platform === p ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: platform === p ? 'var(--ap-fg-0)' : 'var(--text-secondary)',
                  }}
                >
                  {p === 'slack' ? <SlackIcon size={16} /> : <TeamsIcon size={16} />}
                  {p === 'slack' ? 'Slack' : 'Microsoft Teams'}
                </button>
              ))}
            </div>
          )}

          {/* Name */}
          <Field label="Integration Name">
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={`My ${platform === 'slack' ? 'Slack' : 'Teams'} Integration`}
              className="w-full px-3 py-2 rounded-md text-sm outline-none"
              style={inputStyle()}
            />
          </Field>

          {/* Platform-specific config */}
          {platform === 'slack' ? (
            <>
              {/* B3: Per-field error on botToken */}
              <Field label="Bot Token" tooltip="xoxb-... token from your Slack app">
                <div data-field-error={errorField === 'botToken' ? 'botToken' : undefined}>
                  <input
                    type="password"
                    value={slackConfig.botToken}
                    onChange={(e) => onSlackChange({ ...slackConfig, botToken: e.target.value })}
                    placeholder="xoxb-..."
                    className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                    style={inputStyle('botToken')}
                    data-error={errorField === 'botToken' ? 'true' : undefined}
                    aria-invalid={errorField === 'botToken' ? 'true' : undefined}
                  />
                  {errorField === 'botToken' && testResult?.details?.error && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>
                      {testResult.details.error}
                    </p>
                  )}
                </div>
              </Field>
              {/* B3: Per-field error on signingSecret */}
              <Field label="Signing Secret" tooltip="Used to verify requests from Slack">
                <div data-field-error={errorField === 'signingSecret' ? 'signingSecret' : undefined}>
                  <input
                    type="password"
                    value={slackConfig.signingSecret}
                    onChange={(e) => onSlackChange({ ...slackConfig, signingSecret: e.target.value })}
                    placeholder="Signing secret"
                    className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                    style={inputStyle('signingSecret')}
                    data-error={errorField === 'signingSecret' ? 'true' : undefined}
                    aria-invalid={errorField === 'signingSecret' ? 'true' : undefined}
                  />
                  {errorField === 'signingSecret' && testResult?.details?.error && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>
                      {testResult.details.error}
                    </p>
                  )}
                </div>
              </Field>
              <Field label="App ID">
                <input
                  type="text"
                  value={slackConfig.appId}
                  onChange={(e) => onSlackChange({ ...slackConfig, appId: e.target.value })}
                  placeholder="A0123456789"
                  className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                  style={inputStyle()}
                />
              </Field>
            </>
          ) : (
            <>
              {/* B3: Per-field error on Teams appId */}
              <Field label="App ID" tooltip="Azure Bot registration App ID">
                <div data-field-error={errorField === 'appId' ? 'appId' : undefined}>
                  <input
                    type="text"
                    value={teamsConfig.appId}
                    onChange={(e) => onTeamsChange({ ...teamsConfig, appId: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                    style={inputStyle('appId')}
                    data-error={errorField === 'appId' ? 'true' : undefined}
                    aria-invalid={errorField === 'appId' ? 'true' : undefined}
                  />
                  {errorField === 'appId' && testResult?.details?.error && (
                    <p className="text-xs mt-1" style={{ color: 'var(--color-error)' }}>
                      {testResult.details.error}
                    </p>
                  )}
                </div>
              </Field>
              <Field label="App Password" tooltip="Client secret from Azure Bot registration">
                <input
                  type="password"
                  value={teamsConfig.appPassword}
                  onChange={(e) => onTeamsChange({ ...teamsConfig, appPassword: e.target.value })}
                  placeholder="App password"
                  className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                  style={inputStyle('appPassword')}
                  data-error={errorField === 'appPassword' ? 'true' : undefined}
                  aria-invalid={errorField === 'appPassword' ? 'true' : undefined}
                />
              </Field>
              <Field label="Tenant ID">
                <input
                  type="text"
                  value={teamsConfig.tenantId}
                  onChange={(e) => onTeamsChange({ ...teamsConfig, tenantId: e.target.value })}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full px-3 py-2 rounded-md text-sm outline-none font-mono"
                  style={inputStyle()}
                />
              </Field>
            </>
          )}

          {/* Channels */}
          <Field label="Channel Allowlist" tooltip="Comma-separated list of channels. Leave empty to allow all.">
            <input
              type="text"
              value={channels}
              onChange={(e) => onChannelsChange(e.target.value)}
              placeholder="#general, #support, #engineering"
              className="w-full px-3 py-2 rounded-md text-sm outline-none"
              style={inputStyle()}
            />
          </Field>

          {/* Workflows */}
          <Field label="Workflow Allowlist" tooltip="Comma-separated workflow IDs that this integration can trigger.">
            <input
              type="text"
              value={workflows}
              onChange={(e) => onWorkflowsChange(e.target.value)}
              placeholder="workflow-id-1, workflow-id-2"
              className="w-full px-3 py-2 rounded-md text-sm outline-none"
              style={inputStyle()}
            />
          </Field>

          {/* B1+B2: Test result display with rich diagnostics */}
          {testResult && (
            <div
              className="px-3 py-2 rounded-md text-xs"
              style={{
                backgroundColor: testResult.ok
                  ? 'color-mix(in srgb, var(--color-success) 12%, transparent)'
                  : 'color-mix(in srgb, var(--color-error) 12%, transparent)',
                color: testResult.ok ? 'var(--color-success)' : 'var(--color-error)',
              }}
            >
              {testResult.ok ? (
                // B2: Rich success display
                <RichTestResult platform={platform} details={testResult.details} />
              ) : (
                // B1: Show actual error, not generic message
                <span>{testResult.message}</span>
              )}
            </div>
          )}

          {/* B4: Send test message — only shown after Slack auth success */}
          {showSendMessage && platform === 'slack' && (
            <div className="space-y-2 rounded-md p-3" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
              <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Send test message
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={sendChannel}
                  onChange={(e) => onSendChannelChange(e.target.value)}
                  placeholder="Channel ID (e.g. C01ABCDEFG)"
                  className="flex-1 px-2 py-1.5 rounded-md text-xs outline-none font-mono"
                  style={inputStyle()}
                />
                <button
                  onClick={onSendMessage}
                  disabled={sending || !sendChannel}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40"
                  style={{ backgroundColor: 'var(--color-primary)', color: 'var(--ap-fg-0)' }}
                >
                  {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                  Send test message
                </button>
              </div>
              {sendResult && (
                <div
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: sendResult.ok ? 'var(--color-success)' : 'var(--color-error)' }}
                >
                  {sendResult.message}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dialog footer */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onTest}
            disabled={testing || !isEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--color-border)' }}
          >
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Test Connection
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving || !name.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-primary)', color: 'var(--ap-fg-0)' }}
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// RichTestResult — B2: Display rich success diagnostics
// ---------------------------------------------------------------------------

const RichTestResult: React.FC<{
  platform: 'slack' | 'teams';
  details?: TestResult['details'];
}> = ({ platform, details }) => {
  if (!details) return <span>Connection successful</span>;

  if (platform === 'slack') {
    return (
      <div className="space-y-1">
        <div>
          Connected to workspace <strong>{details.team}</strong> as{' '}
          <strong>@{details.user}</strong> (bot id {details.botId}).
        </div>
        {details.scopes && details.scopes.length > 0 && (
          <div>Scopes: {details.scopes.join(', ')}</div>
        )}
      </div>
    );
  }

  if (platform === 'teams') {
    return (
      <div>
        Authenticated against Bot Framework. Token type: {details.tokenType}, expires in {details.expiresIn}s.
      </div>
    );
  }

  return <span>Connection successful</span>;
};

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

const Field: React.FC<{
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}> = ({ label, tooltip, children }) => (
  <div>
    <label className="flex items-center gap-1.5 text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
      {label}
      {tooltip && <InfoTooltip content={tooltip} />}
    </label>
    {children}
  </div>
);

export default IntegrationsView;
