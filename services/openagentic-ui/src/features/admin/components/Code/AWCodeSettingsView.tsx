/**
 * AWCode Settings View
 *
 * Standalone admin panel for AWCode/Openagentic configuration settings.
 * Extracted from AWCodeSessionsView for use as a top-level Admin Console section.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Save, Code, Globe, HardDrive, MessageSquare, RotateCcw, ChevronDown, ChevronRight } from '@/shared/icons';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiRequest } from '@/utils/api';

// System prompt interface
interface SystemPromptState {
  prompt: string;
  isDefault: boolean;
  lastUpdated: string | null;
}

// Settings interface
interface AWCodeSettings {
  sessionIdleTimeout: number;
  sessionMaxLifetime: number;
  maxSessionsPerUser: number;
  defaultSecurityLevel: 'strict' | 'permissive' | 'minimal';
  defaultNetworkEnabled: boolean;
  defaultCpuLimit: number;
  defaultMemoryLimitMb: number;
  enabledForNewUsers: boolean;
  // Storage quota settings
  defaultStorageLimitMb: number;
  storageQuotaEnabled: boolean;
  // Code Mode UI settings
  enableNewCodeModeUI: boolean;
  codeModeDefaultView: 'conversation' | 'terminal';
  artifactSandboxLevel: 'strict' | 'permissive' | 'none';
  artifactMaxPreviewSize: number;
  enableArtifactAutoPreview: boolean;
  enableActivityVisualization: boolean;
}

interface AWCodeSettingsViewProps {
  theme?: string;
}

export const AWCodeSettingsView: React.FC<AWCodeSettingsViewProps> = ({ theme }) => {
  const confirm = useConfirm();
  const [settings, setSettings] = useState<AWCodeSettings | null>(null);
  const [localSettings, setLocalSettings] = useState<Partial<AWCodeSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // System prompt state
  const [systemPrompt, setSystemPrompt] = useState<SystemPromptState | null>(null);
  const [localPrompt, setLocalPrompt] = useState<string>('');
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);

  // Fetch settings
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
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch system prompt
  const fetchSystemPrompt = useCallback(async () => {
    setPromptLoading(true);
    try {
      const response = await apiRequest('/admin/code/system-prompt');
      if (response.ok) {
        const data = await response.json();
        setSystemPrompt(data);
        setLocalPrompt(data.prompt);
      }
    } catch (err) {
      console.error('Failed to fetch system prompt:', err);
    } finally {
      setPromptLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchSystemPrompt();
  }, [fetchSettings, fetchSystemPrompt]);

  // Save system prompt
  const handleSavePrompt = async () => {
    setPromptSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest('/admin/code/system-prompt', {
        method: 'PUT',
        body: JSON.stringify({ prompt: localPrompt })
      });

      if (response.ok) {
        const data = await response.json();
        setSystemPrompt({
          prompt: localPrompt,
          isDefault: false,
          lastUpdated: data.lastUpdated
        });
        setSuccess('System prompt saved successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to save system prompt');
      }
    } catch (err) {
      setError('Failed to save system prompt');
    } finally {
      setPromptSaving(false);
    }
  };

  // Reset system prompt to default
  const handleResetPrompt = async () => {
    if (!await confirm('Are you sure you want to reset the system prompt to the default? This cannot be undone.', { variant: 'danger', title: 'Reset System Prompt' })) {
      return;
    }

    setPromptSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest('/admin/code/system-prompt', {
        method: 'DELETE',
      });

      if (response.ok) {
        const data = await response.json();
        setSystemPrompt({
          prompt: data.prompt,
          isDefault: true,
          lastUpdated: null
        });
        setLocalPrompt(data.prompt);
        setSuccess('System prompt reset to default');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to reset system prompt');
      }
    } catch (err) {
      setError('Failed to reset system prompt');
    } finally {
      setPromptSaving(false);
    }
  };

  // Save settings
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest('/admin/code/settings', {
        method: 'PUT',
        body: JSON.stringify(localSettings)
      });

      if (response.ok) {
        setSettings({ ...settings, ...localSettings } as AWCodeSettings);
        setSuccess('Settings saved successfully');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to save settings');
      }
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-bold mb-2 text-text-primary flex items-center gap-2">
            <Settings size={20} />
            Openagentic Settings
          </h2>
          <p className="text-text-secondary">
            Configure code mode behavior, model preferences, and sandbox settings
          </p>
        </div>
        <div className="glass-card p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
          <p className="text-text-secondary mt-4">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold mb-2 text-text-primary flex items-center gap-2">
          <Settings size={20} />
          Openagentic Settings
        </h2>
        <p className="text-text-secondary">
          Configure code mode behavior, model preferences, and sandbox settings
        </p>
      </div>

      {/* Success/Error messages */}
      {success && (
        <div className="p-4 rounded-lg bg-success-500/10 border border-success/30 ap-text-success">
          {success}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-lg bg-error-500/10 border border-error/30 ap-text-error">
          {error}
        </div>
      )}

      {/* Core Settings */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Settings size={20} className="text-primary-500" />
          Core Configuration
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Default Model — managed in System Configuration */}
          <div className="col-span-2">
            <div className="p-3 rounded-lg border" style={{ background: 'rgba(88,166,255,0.06)', borderColor: 'rgba(88,166,255,0.25)', fontSize: 13, color: 'var(--text-secondary)' }}>
              Platform-wide code-mode default is now managed in{' '}
              <strong>Admin → System Configuration → Default Models</strong>.
            </div>
          </div>

          {/* Max Sessions Per User */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Sessions Per User
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={localSettings.maxSessionsPerUser || 3}
              onChange={(e) => setLocalSettings({ ...localSettings, maxSessionsPerUser: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Session Idle Timeout */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Idle Timeout (seconds)
            </label>
            <input
              type="number"
              min={300}
              max={7200}
              step={60}
              value={localSettings.sessionIdleTimeout || 1800}
              onChange={(e) => setLocalSettings({ ...localSettings, sessionIdleTimeout: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Max Session Lifetime */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Lifetime (seconds)
            </label>
            <input
              type="number"
              min={3600}
              max={86400}
              step={3600}
              value={localSettings.sessionMaxLifetime || 14400}
              onChange={(e) => setLocalSettings({ ...localSettings, sessionMaxLifetime: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Security Level */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Security Level
            </label>
            <select
              value={localSettings.defaultSecurityLevel || 'permissive'}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultSecurityLevel: e.target.value as AWCodeSettings['defaultSecurityLevel'] })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="strict">Strict (Limited access)</option>
              <option value="permissive">Permissive (Default)</option>
              <option value="minimal">Minimal (Full access)</option>
            </select>
          </div>

          {/* CPU Limit */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              CPU Limit (cores)
            </label>
            <input
              type="number"
              min={0.5}
              max={8}
              step={0.5}
              value={localSettings.defaultCpuLimit || 2}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultCpuLimit: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Memory Limit */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Memory Limit (MB)
            </label>
            <input
              type="number"
              min={512}
              max={8192}
              step={256}
              value={localSettings.defaultMemoryLimitMb || 2048}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultMemoryLimitMb: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Network Enabled */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="networkEnabled"
              checked={localSettings.defaultNetworkEnabled ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultNetworkEnabled: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="networkEnabled" className="text-sm text-text-secondary">
              Enable Network Access by Default
            </label>
          </div>

          {/* Enabled for New Users */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enabledForNewUsers"
              checked={localSettings.enabledForNewUsers ?? false}
              onChange={(e) => setLocalSettings({ ...localSettings, enabledForNewUsers: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="enabledForNewUsers" className="text-sm text-text-secondary">
              Enable Openagentic for New Users
            </label>
          </div>
        </div>
      </div>

      {/* Storage Quota Settings */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <HardDrive size={20} className="text-primary-500" />
          Storage Quota Settings
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Storage Quota Enabled */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="storageQuotaEnabled"
              checked={localSettings.storageQuotaEnabled ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, storageQuotaEnabled: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="storageQuotaEnabled" className="text-sm text-text-secondary">
              Enable Storage Quota Enforcement
            </label>
          </div>

          {/* Default Storage Limit */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Storage Limit (MB)
            </label>
            <input
              type="number"
              min={100}
              max={10240}
              step={100}
              value={localSettings.defaultStorageLimitMb || 5120}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultStorageLimitMb: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
              disabled={!localSettings.storageQuotaEnabled}
            />
            <p className="text-xs text-text-tertiary mt-1">
              Default: 5120 MB (5GB) per user workspace
            </p>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-primary-500/10 border border-primary/20">
          <p className="text-sm text-primary-500">
            Storage quotas help prevent individual users from consuming excessive disk space.
            Users should use GitHub for files they want to persist long-term.
          </p>
        </div>
      </div>

      {/* Code Mode UI Settings */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Code size={20} className="ap-text-success" />
          Code Mode UI Settings
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Enable New Code Mode UI */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableNewCodeModeUI"
              checked={localSettings.enableNewCodeModeUI ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableNewCodeModeUI: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="enableNewCodeModeUI" className="text-sm text-text-secondary">
              Enable New Code Mode UI (Three-Panel Layout)
            </label>
          </div>

          {/* Enable Activity Visualization */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableActivityVisualization"
              checked={localSettings.enableActivityVisualization ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableActivityVisualization: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="enableActivityVisualization" className="text-sm text-text-secondary">
              Enable Real-time Activity Visualization
            </label>
          </div>

          {/* Default View */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Code Mode View
            </label>
            <select
              value={localSettings.codeModeDefaultView || 'conversation'}
              onChange={(e) => setLocalSettings({ ...localSettings, codeModeDefaultView: e.target.value as 'conversation' | 'terminal' })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="conversation">Conversation (New UI)</option>
              <option value="terminal">Terminal (Legacy)</option>
            </select>
          </div>

          {/* Artifact Sandbox Level */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Artifact Sandbox Level
            </label>
            <select
              value={localSettings.artifactSandboxLevel || 'strict'}
              onChange={(e) => setLocalSettings({ ...localSettings, artifactSandboxLevel: e.target.value as 'strict' | 'permissive' | 'none' })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="strict">Strict (Recommended)</option>
              <option value="permissive">Permissive (Allow more APIs)</option>
              <option value="none">None (Full access - Not recommended)</option>
            </select>
          </div>

          {/* Artifact Max Preview Size */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Artifact Preview Size (MB)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={localSettings.artifactMaxPreviewSize || 10}
              onChange={(e) => setLocalSettings({ ...localSettings, artifactMaxPreviewSize: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Enable Artifact Auto Preview */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableArtifactAutoPreview"
              checked={localSettings.enableArtifactAutoPreview ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableArtifactAutoPreview: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="enableArtifactAutoPreview" className="text-sm text-text-secondary">
              Auto-Preview Artifacts When Ready
            </label>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-primary-500/10 border border-primary/20">
          <p className="text-sm text-primary-500 flex items-center gap-2">
            <Globe size={14} />
            The new Code Mode UI uses WebSocket streaming via <code className="px-1 bg-primary-500/20 rounded">/ws/events</code> for real-time activity visualization.
          </p>
        </div>
      </div>

      {/* System Prompt Configuration */}
      <div className="glass-card p-6">
        <button
          onClick={() => setPromptExpanded(!promptExpanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <MessageSquare size={20} className="ap-text-info" />
            System Prompt Configuration
          </h3>
          <div className="flex items-center gap-2">
            {systemPrompt?.isDefault && (
              <span className="text-xs px-2 py-1 rounded bg-surface-secondary/20 text-text-secondary">
                Using Default
              </span>
            )}
            {!systemPrompt?.isDefault && (
              <span className="text-xs px-2 py-1 rounded bg-info-500/20 ap-text-info">
                Custom
              </span>
            )}
            {promptExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </div>
        </button>

        {promptExpanded && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-text-secondary">
              Configure the system prompt used for code mode LLM interactions. This prompt defines how the AI assistant behaves when helping users write and modify code.
            </p>

            {promptLoading ? (
              <div className="p-4 text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500 mx-auto" />
                <p className="text-text-secondary mt-2 text-sm">Loading prompt...</p>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    System Prompt
                  </label>
                  <textarea
                    value={localPrompt}
                    onChange={(e) => setLocalPrompt(e.target.value)}
                    rows={15}
                    className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary font-mono text-sm resize-y"
                    placeholder="Enter the system prompt for code mode..."
                  />
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-text-tertiary">
                      {localPrompt.length} characters
                    </p>
                    {systemPrompt?.lastUpdated && (
                      <p className="text-xs text-text-tertiary">
                        Last updated: {new Date(systemPrompt.lastUpdated).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <button
                    onClick={handleResetPrompt}
                    disabled={promptSaving || systemPrompt?.isDefault}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-secondary text-white hover:bg-surface-hover disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw size={16} />
                    Reset to Default
                  </button>
                  <button
                    onClick={handleSavePrompt}
                    disabled={promptSaving || localPrompt === systemPrompt?.prompt}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-info-500 text-white hover:bg-info-500 disabled:opacity-50 transition-colors"
                  >
                    <Save size={16} />
                    {promptSaving ? 'Saving...' : 'Save Prompt'}
                  </button>
                </div>

                <div className="p-3 rounded-lg bg-info-500/10 border border-info/20">
                  <p className="text-sm ap-text-info">
                    <strong>Note:</strong> Changes to the system prompt will affect all future code mode sessions. Existing sessions will continue using the prompt they started with.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

export default AWCodeSettingsView;
