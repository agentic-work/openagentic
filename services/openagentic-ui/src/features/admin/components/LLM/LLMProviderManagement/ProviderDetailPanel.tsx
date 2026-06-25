/**
 * Provider Detail Panel — Expandable details shown below each provider card.
 */
import React, { useState } from 'react';
import { Edit2, Trash2, Play, ChevronDown } from '@/shared/icons';
import {
  CheckCircle, AlertCircle, RefreshCw, Zap, DollarSign, Activity,
  Timer as Clock,
} from '../../Shared/AdminIcons';
import { AdminMetricCard } from '../../Shared/AdminMetricCard';
import { InfoTooltip } from '../../Shared/AdminTooltip';
import {
  type DbProvider, type HealthInfo, type MetricsInfo,
  CAPABILITY_ROWS, PAUSE_DURATIONS,
  btnPrimary, btnSecondary, btnDanger,
} from './types';

export const ProviderDetailPanel: React.FC<{
  provider: DbProvider;
  health?: HealthInfo;
  metrics?: MetricsInfo;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onPauseResume: (durationMinutes?: number) => void;
  onRotateCredentials: () => void;
  onCapabilityToggle: (capability: string, enabled: boolean) => void;
  testing: boolean;
  isEnv: boolean;
}> = ({ provider, health, metrics, onEdit, onDelete, onTest, onPauseResume, onRotateCredentials, onCapabilityToggle, testing, isEnv }) => {
  const mc = provider.model_config || {};
  const isPaused = provider.provider_config?.paused;
  const [showPausePicker, setShowPausePicker] = useState(false);

  const modelEntries = [
    { label: 'Chat', value: mc.chatModel },
    { label: 'Embedding', value: mc.embeddingModel },
    { label: 'Vision', value: mc.visionModel },
    { label: 'Image Gen', value: mc.imageModel },
    { label: 'Compaction', value: mc.compactionModel },
  ].filter(e => e.value);

  return (
    <div className="px-5 pb-4 pt-0 border-t space-y-4" style={{ borderColor: 'var(--color-border)' }}>
      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-3 pt-4">
        <AdminMetricCard label="Requests" value={metrics?.totalRequests?.toLocaleString() || '0'} icon={<Zap size={16} />} />
        <AdminMetricCard label="Avg Latency" value={`${metrics?.averageLatency?.toFixed(0) || '--'}ms`} icon={<Clock size={16} />} />
        <AdminMetricCard label="Success Rate" value={metrics && metrics.totalRequests > 0 ? `${((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(1)}%` : '--'} icon={<Activity size={16} />} />
        <AdminMetricCard label="Cost" value={`$${metrics?.totalCost?.toFixed(4) || '0.00'}`} icon={<DollarSign size={16} />} />
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span>Last health check: {health?.lastChecked ? new Date(health.lastChecked).toLocaleTimeString() : 'Never'}</span>
        {health?.endpoint && <span>Endpoint: <code style={{ color: 'var(--text-primary)' }}>{health.endpoint}</code></span>}
        {health?.error && <span className="text-err">Error: {health.error.substring(0, 80)}</span>}
      </div>

      {/* Models */}
      {modelEntries.length > 0 && (
        <div>
          <span className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
            Configured Models ({modelEntries.length})
          </span>
          <div className="flex flex-wrap gap-2">
            {modelEntries.map(e => (
              <div key={e.label} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <span style={{ color: 'var(--text-muted)' }}>{e.label}: </span>
                <code style={{ color: 'var(--text-primary)' }}>{e.value}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities with toggle checkboxes */}
      <div>
        <span className="block text-xs font-medium uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          Capabilities <InfoTooltip content="Toggle capabilities this provider supports. Changes are saved immediately." />
        </span>
        <div className="flex flex-wrap gap-3">
          {CAPABILITY_ROWS.map(cap => {
            const enabled = provider.capabilities?.[cap.key] ?? false;
            return (
              <label key={cap.key} className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-medium" style={{ color: enabled ? 'var(--color-primary)' : 'var(--text-tertiary)' }}>
                <input type="checkbox" checked={enabled} onChange={e => onCapabilityToggle(cap.key, e.target.checked)}
                  disabled={isEnv} className="accent-primary-500 rounded" />
                {cap.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Auth Status */}
      <div className="flex items-center gap-3 text-xs">
        {(() => {
          const ac = provider.auth_config || {};
          const hasType = ac.type && ac.type !== 'none' || provider.provider_type === 'ollama';
          const hasAnyField = ac.hasApiKey || ac.hasCredentials || ac.apiKey || ac.accessKeyId
            || ac.secretAccessKey || ac.clientId || ac.clientSecret || ac.endpoint || ac.baseUrl
            || ac.credentials || ac.serviceAccountCredentials || ac.has_apiKey || ac.has_accessKeyId
            || ac.has_clientSecret || ac.has_credentials;
          const isConfigured = hasType || hasAnyField || provider.provider_type === 'ollama'
            || ac.type === 'environment' || ac.type === 'iam-role'
            || (ac.type && Object.keys(ac).length > 1);
          return isConfigured;
        })() ? (
          <span className="flex items-center gap-1.5 text-ok"><CheckCircle size={12} /> Credentials configured</span>
        ) : (
          <span className="flex items-center gap-1.5 text-warn"><AlertCircle size={12} /> Credentials needed</span>
        )}
        {!isEnv && (
          <button onClick={onRotateCredentials} className="text-xs underline transition-colors hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
            Rotate credentials
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
        {!isEnv && <button onClick={onEdit} className={btnPrimary}><Edit2 size={14} className="inline mr-1" /> Edit</button>}
        <button onClick={onTest} disabled={testing || !provider.enabled} className={btnSecondary} style={{ borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}>
          {testing ? <RefreshCw size={14} className="inline animate-spin mr-1" /> : <Play size={14} className="inline mr-1" />} Test
        </button>

        {/* Pause/Resume */}
        {!isEnv && (
          <div className="relative">
            {isPaused ? (
              <button onClick={() => onPauseResume()} className={btnSecondary} style={{ borderColor: 'color-mix(in srgb, var(--ap-ok) 25%, transparent)', color: 'var(--ap-ok)' }}>
                <Play size={14} className="inline mr-1" /> Resume
              </button>
            ) : (
              <button onClick={() => setShowPausePicker(!showPausePicker)} className={btnSecondary} style={{ borderColor: 'color-mix(in srgb, var(--ap-warn) 25%, transparent)', color: 'var(--ap-warn)' }}>
                <span className="inline mr-1">||</span> Pause <ChevronDown size={12} className="inline ml-0.5" />
              </button>
            )}
            {showPausePicker && !isPaused && (
              <div className="absolute top-full left-0 mt-1 z-20 rounded-lg border shadow-lg py-1" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: 120 }}>
                {PAUSE_DURATIONS.map(d => (
                  <button key={d.value} onClick={() => { onPauseResume(d.value); setShowPausePicker(false); }}
                    className="block w-full text-left px-3 py-1.5 text-xs transition-colors hover:brightness-110" style={{ color: 'var(--text-primary)' }}>
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />
        {!isEnv && <button onClick={onDelete} className={btnDanger}><Trash2 size={14} className="inline mr-1" /> Delete</button>}
      </div>
    </div>
  );
};
