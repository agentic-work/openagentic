/**
 * CodeMode Settings View
 *
 * Global defaults for all new code mode sessions.
 * Replaces AWCodeSettingsView with expanded controls per design spec:
 * - Model & Execution (model selector, security level, network, filesystem)
 * - Session Limits (max sessions, idle timeout, max lifetime, storage quota)
 * - System Prompt (custom prompt editor, OPENAGENTIC.md override)
 * - Hooks (audit hooks, custom hooks injected into every session)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Save, Globe, MessageSquare,
  RotateCcw, ChevronDown, ChevronRight, Clock,
  Terminal, Zap
} from '@/shared/icons';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiRequest } from '@/utils/api';

// --- Interfaces ---

interface CodeModeSettings {
  // Model & Execution
  defaultModel: string;
  defaultSecurityLevel: 'strict' | 'permissive' | 'minimal';
  defaultNetworkEnabled: boolean;
  networkDomainAllowlist: string[];
  filesystemReadPaths: string[];
  filesystemWritePaths: string[];
  // Session Limits
  maxSessionsPerUser: number;
  sessionIdleTimeout: number;
  sessionMaxLifetime: number;
  storageQuotaEnabled: boolean;
  defaultStorageLimitMb: number;
  // Resources
  defaultCpuLimit: number;
  defaultMemoryLimitMb: number;
  // Feature flags
  enabledForNewUsers: boolean;
}

interface SystemPromptState {
  prompt: string;
  isDefault: boolean;
  lastUpdated: string | null;
}

interface HookConfig {
  id: string;
  name: string;
  type: 'command' | 'prompt' | 'agent' | 'http';
  event: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

interface AvailableModel {
  id: string;
  name: string;
  providerId: string;
  available: boolean;
}

interface CodeModeSettingsViewProps {
  theme?: string;
}

// --- Security level descriptions ---
const SECURITY_LEVELS = {
  strict: {
    label: 'Strict',
    description: 'Read/Glob/Grep/LS only. No Bash, Write, or Edit.',
    color: 'var(--color-error)',
  },
  permissive: {
    label: 'Permissive',
    description: 'All tools allowed. Destructive system commands blocked.',
    color: 'var(--color-warning)',
  },
  minimal: {
    label: 'Minimal',
    description: 'Full access (--dangerously-skip-permissions). Use with caution.',
    color: 'var(--color-success)',
  },
} as const;

export const CodeModeSettingsView: React.FC<CodeModeSettingsViewProps> = ({ theme }) => {
  const confirm = useConfirm();

  // Settings state
  const [settings, setSettings] = useState<CodeModeSettings | null>(null);
  const [localSettings, setLocalSettings] = useState<Partial<CodeModeSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Models
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  // System prompt
  const [systemPrompt, setSystemPrompt] = useState<SystemPromptState | null>(null);
  const [localPrompt, setLocalPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptSaving, setPromptSaving] = useState(false);

  // Hooks
  const [hooks, setHooks] = useState<HookConfig[]>([]);
  const [hooksLoading, setHooksLoading] = useState(true);

  // Expanded sections
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['model', 'limits']));

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // --- Data fetching ---

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest('/admin/code/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        setLocalSettings(data.settings);
        setError(null);
      } else {
        setError('Failed to fetch settings');
      }
    } catch {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const response = await apiRequest('/openagentic/config');
      if (response.ok) {
        const data = await response.json();
        setAvailableModels(data.models || []);
      }
    } catch {
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const fetchSystemPrompt = useCallback(async () => {
    setPromptLoading(true);
    try {
      const response = await apiRequest('/admin/code/system-prompt');
      if (response.ok) {
        const data = await response.json();
        setSystemPrompt(data);
        setLocalPrompt(data.prompt);
      }
    } catch {
      // Prompt endpoint may not exist yet
    } finally {
      setPromptLoading(false);
    }
  }, []);

  const fetchHooks = useCallback(async () => {
    setHooksLoading(true);
    try {
      const response = await apiRequest('/admin/codemode/settings');
      if (response.ok) {
        const data = await response.json();
        setHooks(data.hooks || []);
      }
    } catch {
      // Hooks endpoint may not exist yet
    } finally {
      setHooksLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchModels();
    fetchSystemPrompt();
    fetchHooks();
  }, [fetchSettings, fetchModels, fetchSystemPrompt, fetchHooks]);

  // --- Save handlers ---

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest('/admin/code/settings', {
        method: 'PUT',
        body: JSON.stringify(localSettings),
      });
      if (response.ok) {
        setSettings({ ...settings, ...localSettings } as CodeModeSettings);
        setSuccess('Settings saved successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to save settings');
      }
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePrompt = async () => {
    setPromptSaving(true);
    setError(null);
    try {
      const response = await apiRequest('/admin/code/system-prompt', {
        method: 'PUT',
        body: JSON.stringify({ prompt: localPrompt }),
      });
      if (response.ok) {
        const data = await response.json();
        setSystemPrompt({ prompt: localPrompt, isDefault: false, lastUpdated: data.lastUpdated });
        setSuccess('System prompt saved');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to save system prompt');
      }
    } catch {
      setError('Failed to save system prompt');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleResetPrompt = async () => {
    if (!await confirm('Reset system prompt to default? This cannot be undone.', { variant: 'danger', title: 'Reset System Prompt' })) return;
    setPromptSaving(true);
    try {
      const response = await apiRequest('/admin/code/system-prompt', { method: 'DELETE' });
      if (response.ok) {
        const data = await response.json();
        setSystemPrompt({ prompt: data.prompt, isDefault: true, lastUpdated: null });
        setLocalPrompt(data.prompt);
        setSuccess('System prompt reset to default');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch {
      setError('Failed to reset system prompt');
    } finally {
      setPromptSaving(false);
    }
  };

  const updateSetting = <K extends keyof CodeModeSettings>(key: K, value: CodeModeSettings[K]) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
  };

  // --- Render helpers ---

  const SectionHeader: React.FC<{ id: string; icon: React.ReactNode; title: string; badge?: string }> = ({ id, icon, title, badge }) => (
    <button
      onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between py-3 text-left group"
    >
      <div className="flex items-center gap-2">
        <span className="text-primary-500">{icon}</span>
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500/15 text-primary-500">{badge}</span>
        )}
      </div>
      {expandedSections.has(id) ? <ChevronDown size={18} className="text-text-tertiary" /> : <ChevronRight size={18} className="text-text-tertiary" />}
    </button>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-bold mb-2 text-text-primary flex items-center gap-2">
            <Settings size={20} />
            CodeMode Settings
          </h2>
          <p className="text-text-secondary">Global defaults for all new code mode sessions</p>
        </div>
        <div className="glass-card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
          <p className="text-text-secondary mt-4">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold mb-1 text-text-primary flex items-center gap-2">
          <Settings size={20} />
          CodeMode Settings
        </h2>
        <p className="text-sm text-text-secondary">Global defaults for all new code mode sessions</p>
      </div>

      {/* Messages */}
      {success && (
        <div className="p-3 rounded-lg bg-success-500/10 border border-success/30 ap-text-success text-sm">{success}</div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-error-500/10 border border-error/30 ap-text-error text-sm">{error}</div>
      )}

      {/* MODEL & EXECUTION */}
      <div className="glass-card px-5 py-1">
        <SectionHeader id="model" icon={<Zap size={18} />} title="Model & Execution" />
        {expandedSections.has('model') && (
          <div className="pb-5 space-y-5">
            <div className="grid grid-cols-2 gap-5">
              {/* Default Model */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Default Model</label>
                <select
                  value={localSettings.defaultModel || ''}
                  onChange={(e) => updateSetting('defaultModel', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                  disabled={modelsLoading}
                >
                  <option value="">Smart Router (auto)</option>
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              {/* Security Level */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Security Level</label>
                <select
                  value={localSettings.defaultSecurityLevel || 'permissive'}
                  onChange={(e) => updateSetting('defaultSecurityLevel', e.target.value as CodeModeSettings['defaultSecurityLevel'])}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                >
                  {Object.entries(SECURITY_LEVELS).map(([key, { label, description }]) => (
                    <option key={key} value={key}>{label} — {description}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Network & Filesystem */}
            <div className="grid grid-cols-2 gap-5">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    id="networkEnabled"
                    checked={localSettings.defaultNetworkEnabled ?? true}
                    onChange={(e) => updateSetting('defaultNetworkEnabled', e.target.checked)}
                    className="rounded border-border-hover"
                  />
                  <label htmlFor="networkEnabled" className="text-sm text-text-secondary">
                    <Globe size={14} className="inline mr-1" />
                    Enable Network Access
                  </label>
                </div>
                <p className="text-xs text-text-tertiary">Domain allowlist configurable via API</p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enabledForNewUsers"
                  checked={localSettings.enabledForNewUsers ?? false}
                  onChange={(e) => updateSetting('enabledForNewUsers', e.target.checked)}
                  className="rounded border-border-hover"
                />
                <label htmlFor="enabledForNewUsers" className="text-sm text-text-secondary">
                  Enable CodeMode for New Users
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SESSION LIMITS */}
      <div className="glass-card px-5 py-1">
        <SectionHeader id="limits" icon={<Clock size={18} />} title="Session Limits" />
        {expandedSections.has('limits') && (
          <div className="pb-5">
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Max Sessions Per User</label>
                <input
                  type="number" min={1} max={10}
                  value={localSettings.maxSessionsPerUser || 3}
                  onChange={(e) => updateSetting('maxSessionsPerUser', parseInt(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Idle Timeout</label>
                <select
                  value={localSettings.sessionIdleTimeout || 1800}
                  onChange={(e) => updateSetting('sessionIdleTimeout', parseInt(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                >
                  <option value={300}>5 minutes</option>
                  <option value={600}>10 minutes</option>
                  <option value={1800}>30 minutes</option>
                  <option value={3600}>1 hour</option>
                  <option value={7200}>2 hours</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Max Lifetime</label>
                <select
                  value={localSettings.sessionMaxLifetime || 14400}
                  onChange={(e) => updateSetting('sessionMaxLifetime', parseInt(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                >
                  <option value={3600}>1 hour</option>
                  <option value={7200}>2 hours</option>
                  <option value={14400}>4 hours</option>
                  <option value={28800}>8 hours</option>
                  <option value={86400}>24 hours</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Storage Quota</label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={localSettings.storageQuotaEnabled ?? true}
                    onChange={(e) => updateSetting('storageQuotaEnabled', e.target.checked)}
                    className="rounded border-border-hover"
                  />
                  <input
                    type="number" min={100} max={10240} step={100}
                    value={localSettings.defaultStorageLimitMb || 5120}
                    onChange={(e) => updateSetting('defaultStorageLimitMb', parseInt(e.target.value))}
                    className="flex-1 px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                    disabled={!localSettings.storageQuotaEnabled}
                  />
                  <span className="text-xs text-text-tertiary">MB</span>
                </div>
              </div>
            </div>

            {/* Resources */}
            <div className="grid grid-cols-2 gap-5 mt-5">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">CPU Limit (cores)</label>
                <input
                  type="number" min={0.5} max={8} step={0.5}
                  value={localSettings.defaultCpuLimit || 2}
                  onChange={(e) => updateSetting('defaultCpuLimit', parseFloat(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">Memory Limit (MB)</label>
                <input
                  type="number" min={512} max={8192} step={256}
                  value={localSettings.defaultMemoryLimitMb || 2048}
                  onChange={(e) => updateSetting('defaultMemoryLimitMb', parseInt(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary text-sm"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SYSTEM PROMPT */}
      <div className="glass-card px-5 py-1">
        <SectionHeader
          id="prompt"
          icon={<MessageSquare size={18} />}
          title="System Prompt"
          badge={systemPrompt?.isDefault ? 'Default' : 'Custom'}
        />
        {expandedSections.has('prompt') && (
          <div className="pb-5 space-y-4">
            <p className="text-sm text-text-secondary">
              Defines how the AI assistant behaves in code mode sessions. Changes apply to new sessions only.
            </p>

            {promptLoading ? (
              <div className="p-4 text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500 mx-auto" />
              </div>
            ) : (
              <>
                <textarea
                  value={localPrompt}
                  onChange={(e) => setLocalPrompt(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary font-mono text-xs resize-y"
                  placeholder="Enter the system prompt for code mode..."
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-tertiary">{localPrompt.length} characters</span>
                  {systemPrompt?.lastUpdated && (
                    <span className="text-xs text-text-tertiary">
                      Updated: {new Date(systemPrompt.lastUpdated).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={handleResetPrompt}
                    disabled={promptSaving || systemPrompt?.isDefault}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-secondary text-text-secondary hover:bg-surface-hover disabled:opacity-50 text-sm transition-colors"
                  >
                    <RotateCcw size={14} />
                    Reset
                  </button>
                  <button
                    onClick={handleSavePrompt}
                    disabled={promptSaving || localPrompt === systemPrompt?.prompt}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 text-sm transition-colors"
                  >
                    <Save size={14} />
                    {promptSaving ? 'Saving...' : 'Save Prompt'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* HOOKS */}
      <div className="glass-card px-5 py-1">
        <SectionHeader id="hooks" icon={<Terminal size={18} />} title="Hooks" badge={hooks.length ? `${hooks.length}` : undefined} />
        {expandedSections.has('hooks') && (
          <div className="pb-5 space-y-3">
            <p className="text-sm text-text-secondary">
              Hooks are injected into every session's settings.json. They fire on tool use, prompts, and agent events.
            </p>

            {hooks.length === 0 ? (
              <div className="p-4 text-center text-text-tertiary text-sm border border-dashed border-white/10 rounded-lg">
                No hooks configured. Hooks will be available when the /api/admin/codemode/settings endpoint is deployed.
              </div>
            ) : (
              <div className="space-y-2">
                {hooks.map(hook => (
                  <div key={hook.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-secondary">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${hook.enabled ? 'bg-green-500' : 'bg-gray-500'}`} />
                      <span className="text-sm text-text-primary">{hook.name}</span>
                      <span className="text-xs text-text-tertiary px-1.5 py-0.5 rounded bg-surface-primary">{hook.type}</span>
                      <span className="text-xs text-text-tertiary">{hook.event}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors text-sm font-medium"
        >
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

export default CodeModeSettingsView;
