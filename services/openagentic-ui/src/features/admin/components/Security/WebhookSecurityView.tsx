import React, { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw } from '@/shared/icons';
import {
  Shield, AlertTriangle, CheckCircle, XCircle, Lock
} from '../Shared/AdminIcons';
import { apiRequestJson } from '@/utils/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebhookSecurityConfig {
  globalEnabled: boolean;
  maxPayloadBytes: number;
  replayWindowSeconds: number;
  globalRateLimitPerMinute: number;
  promptInjectionScanEnabled: boolean;
  promptInjectionBlockEnabled: boolean;
  promptInjectionThreshold: number;
  dlpScanEnabled: boolean;
  allowedContentTypes: string[];
  platformAllowlists: Record<string, PlatformAllowlist>;
  blockedTools: string[];
  requireHmacGlobal: boolean;
}

interface PlatformAllowlist {
  enabled: boolean;
  cidrs: string[];
  signatureHeader: string;
  timestampHeader?: string;
  description: string;
}

interface AuditLogEntry {
  id: string;
  webhook_key: string;
  workflow_id?: string;
  source_ip: string;
  user_agent?: string;
  content_type?: string;
  payload_size: number;
  status: string;
  status_code: number;
  rejection_reason?: string;
  injection_score?: number;
  platform?: string;
  created_at: string;
}

interface Stats {
  period: { hours: number; since: string };
  summary: { totalRequests: number; accepted: number; rejected: number; rejectionRate: string };
  byStatus: Array<{ status: string; count: number }>;
  byPlatform: Array<{ platform: string; count: number }>;
  topRejections: Array<{ rejection_reason: string; count: number }>;
  injectionStats: { scanned: number; detected: number; avg_score: number; max_score: number };
}

interface WebhookSecurityViewProps {
  theme: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const WebhookSecurityView: React.FC<WebhookSecurityViewProps> = ({ theme }) => {
  const [config, setConfig] = useState<WebhookSecurityConfig | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditPagination, setAuditPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'platforms' | 'audit'>('overview');
  const [auditFilter, setAuditFilter] = useState<string>('');
  const [statsHours, setStatsHours] = useState(24);

  const cardBg = 'bg-[var(--color-surface)]';
  const borderColor = 'border-[var(--color-border)]';
  const textMuted = 'text-[var(--text-secondary)]';
  const textPrimary = 'text-[var(--text-primary)]';
  const inputBg = 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--text-primary)]';
  const hoverBg = 'hover:bg-[var(--color-surface)]';

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configData, statsData, auditData] = await Promise.all([
        apiRequestJson('/admin/webhook-security/config').catch(() => ({ config: null })),
        apiRequestJson(`/admin/webhook-security/stats?hours=${statsHours}`).catch(() => null),
        apiRequestJson('/admin/webhook-security/audit-logs?limit=20').catch(() => ({ logs: [], pagination: {} })),
      ]);
      if (configData?.config) setConfig(configData.config);
      if (statsData) setStats(statsData);
      setAuditLogs(auditData?.logs || []);
      setAuditPagination(auditData?.pagination || { page: 1, total: 0, totalPages: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhook security data');
    } finally {
      setLoading(false);
    }
  }, [statsHours]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const updateConfig = async (updates: Partial<WebhookSecurityConfig>) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiRequestJson('/admin/webhook-security/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res?.config) setConfig(res.config);
      setSuccess('Configuration saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const toggleKillSwitch = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await apiRequestJson('/admin/webhook-security/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !config.globalEnabled }),
      });
      setConfig(prev => prev ? { ...prev, globalEnabled: res.globalEnabled } : prev);
      setSuccess(res.message);
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle kill switch');
    } finally {
      setSaving(false);
    }
  };

  const loadAuditPage = async (page: number) => {
    try {
      const query = new URLSearchParams({ page: String(page), limit: '20' });
      if (auditFilter) query.set('status', auditFilter);
      const res = await apiRequestJson(`/admin/webhook-security/audit-logs?${query}`);
      setAuditLogs(res?.logs || []);
      setAuditPagination(res?.pagination || { page: 1, total: 0, totalPages: 0 });
    } catch (err) {
      setError('Failed to load audit logs');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'config' as const, label: 'Configuration' },
    { id: 'platforms' as const, label: 'Platforms' },
    { id: 'audit' as const, label: 'Audit Logs' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/20">
            <Shield size={24} className="text-purple-400" />
          </div>
          <div>
            <h2 className={`text-xl font-bold ${textPrimary}`}>Webhook Security</h2>
            <p className={textMuted}>Enterprise-grade inbound webhook protection</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Kill Switch */}
          <button
            onClick={toggleKillSwitch}
            disabled={saving}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              config?.globalEnabled
                ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
            }`}
          >
            {config?.globalEnabled ? (
              <><CheckCircle size={16} /> Webhooks Active</>
            ) : (
              <><XCircle size={16} /> Kill Switch ON</>
            )}
          </button>
          <button onClick={fetchAll} className={`p-2 rounded-lg ${hoverBg} ${textMuted}`}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 flex items-center gap-2">
          <CheckCircle size={16} /> {success}
        </div>
      )}

      {/* Tabs */}
      <div className={`flex gap-1 p-1 rounded-lg bg-[var(--color-surface)]`}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-purple-500/20 text-purple-400'
                : `${textMuted} ${hoverBg}`
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab stats={stats} config={config} cardBg={cardBg} borderColor={borderColor} textPrimary={textPrimary} textMuted={textMuted} statsHours={statsHours} setStatsHours={setStatsHours} onRefresh={fetchAll} />}
      {activeTab === 'config' && <ConfigTab config={config} onSave={updateConfig} saving={saving} cardBg={cardBg} borderColor={borderColor} textPrimary={textPrimary} textMuted={textMuted} inputBg={inputBg} />}
      {activeTab === 'platforms' && <PlatformsTab config={config} onSave={updateConfig} saving={saving} cardBg={cardBg} borderColor={borderColor} textPrimary={textPrimary} textMuted={textMuted} inputBg={inputBg} />}
      {activeTab === 'audit' && <AuditTab logs={auditLogs} pagination={auditPagination} filter={auditFilter} setFilter={setAuditFilter} onPageChange={loadAuditPage} cardBg={cardBg} borderColor={borderColor} textPrimary={textPrimary} textMuted={textMuted} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

const OverviewTab: React.FC<{
  stats: Stats | null;
  config: WebhookSecurityConfig | null;
  cardBg: string;
  borderColor: string;
  textPrimary: string;
  textMuted: string;
  statsHours: number;
  setStatsHours: (h: number) => void;
  onRefresh: () => void;
}> = ({ stats, config, cardBg, borderColor, textPrimary, textMuted, statsHours, setStatsHours }) => {
  const statCards = [
    { label: 'Total Requests', value: stats?.summary.totalRequests ?? 0, color: 'text-blue-400' },
    { label: 'Accepted', value: stats?.summary.accepted ?? 0, color: 'text-green-400' },
    { label: 'Rejected', value: stats?.summary.rejected ?? 0, color: 'text-red-400' },
    { label: 'Rejection Rate', value: stats?.summary.rejectionRate ?? '0%', color: 'text-amber-400' },
  ];

  const securityFeatures = config ? [
    { label: 'Global Kill Switch', enabled: config.globalEnabled, desc: 'Master on/off for all webhooks' },
    { label: 'HMAC Signature Required', enabled: config.requireHmacGlobal, desc: 'Require signed payloads' },
    { label: 'Prompt Injection Scan', enabled: config.promptInjectionScanEnabled, desc: 'Scan payloads for LLM injection attacks' },
    { label: 'Prompt Injection Block', enabled: config.promptInjectionBlockEnabled, desc: 'Block (vs log) injection attempts' },
    { label: 'DLP Scanning', enabled: config.dlpScanEnabled, desc: 'Detect credentials and PII in payloads' },
    { label: 'Replay Protection', enabled: config.replayWindowSeconds > 0, desc: `Reject requests older than ${config.replayWindowSeconds}s` },
    { label: 'Rate Limiting', enabled: config.globalRateLimitPerMinute > 0, desc: `${config.globalRateLimitPerMinute} req/min global` },
    { label: 'Payload Size Limit', enabled: true, desc: `${(config.maxPayloadBytes / 1024).toFixed(0)} KB maximum` },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Time Period Selector */}
      <div className="flex items-center gap-2">
        <span className={textMuted + ' text-sm'}>Period:</span>
        {[1, 6, 24, 168, 720].map(h => (
          <button
            key={h}
            onClick={() => setStatsHours(h)}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              statsHours === h ? 'bg-purple-500/20 text-purple-400' : `${textMuted} hover:bg-white/5`
            }`}
          >
            {h < 24 ? `${h}h` : h === 24 ? '1d' : h === 168 ? '7d' : '30d'}
          </button>
        ))}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className={`p-4 rounded-xl border ${borderColor} ${cardBg}`}>
            <div className={`text-sm ${textMuted}`}>{card.label}</div>
            <div className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Security Status Grid */}
      <div className={`rounded-xl border ${borderColor} ${cardBg} overflow-hidden`}>
        <div className={`px-4 py-3 border-b ${borderColor}`}>
          <h3 className={`font-semibold ${textPrimary}`}>Security Layers</h3>
        </div>
        <div className="divide-y divide-white/5">
          {securityFeatures.map(feat => (
            <div key={feat.label} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className={`font-medium text-sm ${textPrimary}`}>{feat.label}</div>
                <div className={`text-xs ${textMuted}`}>{feat.desc}</div>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                feat.enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              }`}>
                {feat.enabled ? <><CheckCircle size={12} /> Active</> : <><XCircle size={12} /> Disabled</>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Injection Stats */}
      {stats?.injectionStats && stats.injectionStats.scanned > 0 && (
        <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
          <h3 className={`font-semibold mb-3 ${textPrimary}`}>Prompt Injection Analysis</h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <div className={`text-xs ${textMuted}`}>Scanned</div>
              <div className={`text-lg font-bold ${textPrimary}`}>{stats.injectionStats.scanned}</div>
            </div>
            <div>
              <div className={`text-xs ${textMuted}`}>Detected</div>
              <div className="text-lg font-bold text-amber-400">{stats.injectionStats.detected}</div>
            </div>
            <div>
              <div className={`text-xs ${textMuted}`}>Avg Score</div>
              <div className={`text-lg font-bold ${textPrimary}`}>{(stats.injectionStats.avg_score || 0).toFixed(3)}</div>
            </div>
            <div>
              <div className={`text-xs ${textMuted}`}>Max Score</div>
              <div className="text-lg font-bold text-red-400">{(stats.injectionStats.max_score || 0).toFixed(3)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Top Rejections */}
      {stats?.topRejections && stats.topRejections.length > 0 && (
        <div className={`rounded-xl border ${borderColor} ${cardBg} overflow-hidden`}>
          <div className={`px-4 py-3 border-b ${borderColor}`}>
            <h3 className={`font-semibold ${textPrimary}`}>Top Rejection Reasons</h3>
          </div>
          <div className="divide-y divide-white/5">
            {stats.topRejections.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2">
                <span className={`text-sm ${textMuted}`}>{r.rejection_reason || 'Unknown'}</span>
                <span className="text-sm font-mono text-red-400">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Platform Breakdown */}
      {stats?.byPlatform && stats.byPlatform.length > 0 && (
        <div className={`rounded-xl border ${borderColor} ${cardBg} overflow-hidden`}>
          <div className={`px-4 py-3 border-b ${borderColor}`}>
            <h3 className={`font-semibold ${textPrimary}`}>Requests by Platform</h3>
          </div>
          <div className="divide-y divide-white/5">
            {stats.byPlatform.map((p, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2">
                <span className={`text-sm ${textPrimary} capitalize`}>{p.platform}</span>
                <span className={`text-sm font-mono ${textMuted}`}>{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Configuration Tab
// ---------------------------------------------------------------------------

const ConfigTab: React.FC<{
  config: WebhookSecurityConfig | null;
  onSave: (updates: Partial<WebhookSecurityConfig>) => void;
  saving: boolean;
  cardBg: string;
  borderColor: string;
  textPrimary: string;
  textMuted: string;
  inputBg: string;
}> = ({ config, onSave, saving, cardBg, borderColor, textPrimary, textMuted, inputBg }) => {
  const [local, setLocal] = useState<WebhookSecurityConfig | null>(null);

  useEffect(() => {
    if (config) setLocal({ ...config });
  }, [config]);

  if (!local) return null;

  const ToggleRow = ({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between py-3">
      <div>
        <div className={`font-medium text-sm ${textPrimary}`}>{label}</div>
        <div className={`text-xs ${textMuted}`}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-purple-500' : 'bg-[var(--color-border)]'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );

  const NumberInput = ({ label, desc, value, onChange, min, max, step }: { label: string; desc: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) => (
    <div className="py-3">
      <div className={`font-medium text-sm ${textPrimary}`}>{label}</div>
      <div className={`text-xs ${textMuted} mb-2`}>{desc}</div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg}`}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Security Toggles */}
      <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
        <h3 className={`font-semibold mb-2 ${textPrimary}`}>Security Features</h3>
        <div className="divide-y divide-white/5">
          <ToggleRow label="Require HMAC Globally" desc="Reject all webhook requests that don't include a valid HMAC signature" checked={local.requireHmacGlobal} onChange={v => setLocal({ ...local, requireHmacGlobal: v })} />
          <ToggleRow label="Prompt Injection Scanning" desc="Scan webhook payloads for LLM prompt injection patterns" checked={local.promptInjectionScanEnabled} onChange={v => setLocal({ ...local, promptInjectionScanEnabled: v })} />
          <ToggleRow label="Prompt Injection Blocking" desc="Block requests that exceed the injection confidence threshold (vs log-only)" checked={local.promptInjectionBlockEnabled} onChange={v => setLocal({ ...local, promptInjectionBlockEnabled: v })} />
          <ToggleRow label="DLP Scanning" desc="Detect credentials (API keys, tokens) and PII (SSN, credit cards) in payloads" checked={local.dlpScanEnabled} onChange={v => setLocal({ ...local, dlpScanEnabled: v })} />
        </div>
      </div>

      {/* Numeric Settings */}
      <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
        <h3 className={`font-semibold mb-2 ${textPrimary}`}>Limits & Thresholds</h3>
        <div className="grid grid-cols-2 gap-x-6 divide-y divide-white/5">
          <NumberInput label="Max Payload Size (bytes)" desc="Reject payloads larger than this (default 524288 = 512KB)" value={local.maxPayloadBytes} onChange={v => setLocal({ ...local, maxPayloadBytes: v })} min={1024} max={10485760} step={1024} />
          <NumberInput label="Replay Window (seconds)" desc="Reject requests with timestamps older than this (default 300 = 5min)" value={local.replayWindowSeconds} onChange={v => setLocal({ ...local, replayWindowSeconds: v })} min={30} max={3600} step={30} />
          <NumberInput label="Global Rate Limit (req/min)" desc="Maximum webhook requests per minute across ALL webhooks (0 = unlimited)" value={local.globalRateLimitPerMinute} onChange={v => setLocal({ ...local, globalRateLimitPerMinute: v })} min={0} max={100000} step={10} />
          <NumberInput label="Injection Threshold (0-1)" desc="Confidence score above which requests are blocked (default 0.7)" value={local.promptInjectionThreshold} onChange={v => setLocal({ ...local, promptInjectionThreshold: v })} min={0} max={1} step={0.05} />
        </div>
      </div>

      {/* Content Types */}
      <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
        <h3 className={`font-semibold mb-2 ${textPrimary}`}>Allowed Content Types</h3>
        <div className={`text-xs ${textMuted} mb-3`}>Webhook requests with content types not in this list will be rejected.</div>
        <div className="flex flex-wrap gap-2">
          {local.allowedContentTypes.map((ct, i) => (
            <span key={i} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-mono bg-[var(--color-surface)] text-[var(--text-primary)]`}>
              {ct}
              <button onClick={() => setLocal({ ...local, allowedContentTypes: local.allowedContentTypes.filter((_, j) => j !== i) })} className="text-red-400 hover:text-red-300 ml-1">&times;</button>
            </span>
          ))}
        </div>
      </div>

      {/* Blocked Tools */}
      <div className={`rounded-xl border ${borderColor} ${cardBg} p-4`}>
        <h3 className={`font-semibold mb-2 ${textPrimary}`}>Blocked Tools</h3>
        <div className={`text-xs ${textMuted} mb-3`}>MCP tools that are NEVER available to webhook-triggered workflow executions. Prevents external actors from accessing destructive admin tools.</div>
        <div className="flex flex-wrap gap-2">
          {local.blockedTools.map((tool, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-mono bg-red-500/10 text-red-400 border border-red-500/20">
              <Lock size={10} /> {tool}
              <button onClick={() => setLocal({ ...local, blockedTools: local.blockedTools.filter((_, j) => j !== i) })} className="text-red-300 hover:text-red-200 ml-1">&times;</button>
            </span>
          ))}
        </div>
        <AddItemInput placeholder="Add blocked tool name..." onAdd={tool => setLocal({ ...local, blockedTools: [...local.blockedTools, tool] })} inputBg={inputBg} />
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={() => onSave(local)}
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Platforms Tab
// ---------------------------------------------------------------------------

const PlatformsTab: React.FC<{
  config: WebhookSecurityConfig | null;
  onSave: (updates: Partial<WebhookSecurityConfig>) => void;
  saving: boolean;
  cardBg: string;
  borderColor: string;
  textPrimary: string;
  textMuted: string;
  inputBg: string;
}> = ({ config, onSave, saving, cardBg, borderColor, textPrimary, textMuted, inputBg }) => {
  const [localPlatforms, setLocalPlatforms] = useState<Record<string, PlatformAllowlist>>({});

  useEffect(() => {
    if (config?.platformAllowlists) setLocalPlatforms({ ...config.platformAllowlists });
  }, [config]);

  const platformColors: Record<string, string> = {
    slack: '#4a154b', github: '#24292f', pagerduty: '#06AC38', jira: '#0052CC',
    teams: '#6264A7', servicenow: '#81B5A1', discord: '#5865F2',
  };

  const updatePlatform = (id: string, update: Partial<PlatformAllowlist>) => {
    setLocalPlatforms(prev => ({
      ...prev,
      [id]: { ...prev[id], ...update },
    }));
  };

  return (
    <div className="space-y-4">
      <div className={`text-sm ${textMuted}`}>
        Configure platform-specific settings for known webhook sources. IP CIDR ranges are used to validate source IPs. Signature headers are used for HMAC validation.
      </div>

      {Object.entries(localPlatforms).map(([id, platform]) => (
        <div key={id} className={`rounded-xl border ${borderColor} ${cardBg} overflow-hidden`}>
          <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: platformColors[id] || '#888' }} />
              <div>
                <span className={`font-semibold capitalize ${textPrimary}`}>{id}</span>
                <span className={`ml-2 text-xs ${textMuted}`}>{platform.description}</span>
              </div>
            </div>
            <button
              onClick={() => updatePlatform(id, { enabled: !platform.enabled })}
              className={`relative w-11 h-6 rounded-full transition-colors ${platform.enabled ? 'bg-purple-500' : 'bg-[var(--color-border)]'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${platform.enabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <label className={`text-xs font-medium ${textMuted}`}>Signature Header</label>
              <input
                value={platform.signatureHeader}
                onChange={e => updatePlatform(id, { signatureHeader: e.target.value })}
                className={`w-full mt-1 px-3 py-1.5 rounded-lg border text-sm font-mono ${inputBg}`}
              />
            </div>
            {platform.timestampHeader && (
              <div>
                <label className={`text-xs font-medium ${textMuted}`}>Timestamp Header</label>
                <input
                  value={platform.timestampHeader}
                  onChange={e => updatePlatform(id, { timestampHeader: e.target.value })}
                  className={`w-full mt-1 px-3 py-1.5 rounded-lg border text-sm font-mono ${inputBg}`}
                />
              </div>
            )}
            <div>
              <label className={`text-xs font-medium ${textMuted}`}>IP CIDR Allowlist</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {platform.cidrs.length === 0 && (
                  <span className={`text-xs ${textMuted} italic`}>No IP restrictions (signature validation only)</span>
                )}
                {platform.cidrs.map((cidr, i) => (
                  <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-[var(--color-surface)] text-[var(--text-primary)]`}>
                    {cidr}
                    <button onClick={() => {
                      const newCidrs = platform.cidrs.filter((_, j) => j !== i);
                      updatePlatform(id, { cidrs: newCidrs });
                    }} className="text-red-400 hover:text-red-300">&times;</button>
                  </span>
                ))}
              </div>
              <AddItemInput placeholder="Add CIDR (e.g. 10.0.0.0/8)..." onAdd={cidr => updatePlatform(id, { cidrs: [...platform.cidrs, cidr] })} inputBg={inputBg} />
            </div>
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button
          onClick={() => onSave({ platformAllowlists: localPlatforms })}
          disabled={saving}
          className="px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Platform Settings'}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Audit Logs Tab
// ---------------------------------------------------------------------------

const AuditTab: React.FC<{
  logs: AuditLogEntry[];
  pagination: { page: number; total: number; totalPages: number };
  filter: string;
  setFilter: (f: string) => void;
  onPageChange: (page: number) => void;
  cardBg: string;
  borderColor: string;
  textPrimary: string;
  textMuted: string;
}> = ({ logs, pagination, filter, setFilter, onPageChange, cardBg, borderColor, textPrimary, textMuted }) => {

  const statusFilters = ['', 'accepted', 'rejected_kill_switch', 'rejected_payload', 'rejected_content_type', 'rejected_ip', 'rejected_signature', 'rejected_replay', 'rejected_rate_limit', 'rejected_injection', 'rejected_dlp', 'rejected_disabled'];

  const statusColor = (status: string) => {
    if (status === 'accepted') return 'text-green-400 bg-green-500/10';
    if (status.includes('injection')) return 'text-red-400 bg-red-500/10';
    if (status.includes('dlp')) return 'text-orange-400 bg-orange-500/10';
    return 'text-amber-400 bg-amber-500/10';
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Search size={14} className={textMuted} />
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value); onPageChange(1); }}
            className="px-3 py-1.5 rounded-lg border text-sm bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--text-primary)]"
          >
            <option value="">All statuses</option>
            {statusFilters.filter(Boolean).map(s => (
              <option key={s} value={s}>{s.replace('rejected_', 'Rejected: ')}</option>
            ))}
          </select>
        </div>
        <span className={`text-xs ${textMuted}`}>{pagination.total} entries</span>
      </div>

      {/* Logs Table */}
      <div className={`rounded-xl border ${borderColor} ${cardBg} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead>
            <tr className={`border-b ${borderColor} bg-[var(--color-surface)]`}>
              <th className={`px-3 py-2 text-left font-medium ${textMuted}`}>Time</th>
              <th className={`px-3 py-2 text-left font-medium ${textMuted}`}>Status</th>
              <th className={`px-3 py-2 text-left font-medium ${textMuted}`}>Platform</th>
              <th className={`px-3 py-2 text-left font-medium ${textMuted}`}>Source IP</th>
              <th className={`px-3 py-2 text-left font-medium ${textMuted}`}>Webhook Key</th>
              <th className={`px-3 py-2 text-right font-medium ${textMuted}`}>Size</th>
              <th className={`px-3 py-2 text-left font-medium ${textMuted}`}>Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {logs.length === 0 && (
              <tr><td colSpan={7} className={`px-3 py-8 text-center ${textMuted}`}>No audit logs found</td></tr>
            )}
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-[var(--color-surface)] transition-colors">
                <td className={`px-3 py-2 ${textMuted} text-xs font-mono whitespace-nowrap`}>
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(log.status)}`}>
                    {log.status_code}
                  </span>
                </td>
                <td className={`px-3 py-2 capitalize text-xs ${textPrimary}`}>{log.platform || '-'}</td>
                <td className={`px-3 py-2 font-mono text-xs ${textMuted}`}>{log.source_ip}</td>
                <td className={`px-3 py-2 font-mono text-xs ${textMuted}`}>{log.webhook_key?.substring(0, 12)}...</td>
                <td className={`px-3 py-2 text-right font-mono text-xs ${textMuted}`}>{(log.payload_size / 1024).toFixed(1)}K</td>
                <td className={`px-3 py-2 text-xs ${textMuted} max-w-[200px] truncate`}>{log.rejection_reason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className={`text-xs ${textMuted}`}>Page {pagination.page} of {pagination.totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className={`px-3 py-1 rounded text-xs font-medium ${textMuted} hover:bg-[var(--color-surface)] disabled:opacity-30`}
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className={`px-3 py-1 rounded text-xs font-medium ${textMuted} hover:bg-[var(--color-surface)] disabled:opacity-30`}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared Components
// ---------------------------------------------------------------------------

const AddItemInput: React.FC<{ placeholder: string; onAdd: (value: string) => void; inputBg: string }> = ({ placeholder, onAdd, inputBg }) => {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-2 mt-2">
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) {
            onAdd(value.trim());
            setValue('');
          }
        }}
        className={`flex-1 px-3 py-1.5 rounded-lg border text-sm ${inputBg}`}
      />
      <button
        onClick={() => { if (value.trim()) { onAdd(value.trim()); setValue(''); } }}
        className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium"
      >
        Add
      </button>
    </div>
  );
};

export default WebhookSecurityView;
