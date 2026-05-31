/**
 * Synth (Tool Synthesis) Management View
 *
 * Admin interface for configuring and monitoring Synth.
 *
 * Features:
 * - Global Synth configuration (enable/disable, LLM settings, limits)
 * - Capability management (allowed/blocked capabilities)
 * - Security settings (user-only auth, SSO requirements)
 * - Usage statistics and cost tracking
 * - Approval queue management
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  CogIcon, ActivityIcon, ShieldIcon, CpuIcon, DollarIcon, UsersIcon,
  PlayIcon, StopIcon, RefreshIcon, SuccessIcon, WarningIcon, ErrorIcon
} from '../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

interface SynthConfig {
  // Visibility & Enablement
  enabled: boolean;
  visibleToLLM: boolean;
  // Model Configuration
  provider: string;
  model: string;
  baseUrl?: string;
  synthesisTemperature: number;
  maxSynthesisTokens: number;
  // Execution Settings
  timeoutSeconds: number;
  executorUrl?: string;
  maxMemoryMb: number;
  maxConcurrentExecutions: number;
  // Rate Limits & Budgets
  maxDailySynthesesPerUser: number;
  defaultUserDailyBudgetUsd: number;
  defaultGroupDailyBudgetUsd: number;
  // Approval Workflow
  autoApproveLowRisk: boolean;
  autoApproveMediumRisk: boolean;
  approvalTimeoutSeconds: number;
  approvalTimeoutAction: 'reject' | 'approve';
  // Capabilities
  allowedCapabilities: string[];
  blockedCapabilities: string[];
  adminOnlyCapabilities: string[];
  // Semantic Search
  useSemanticToolSearch: boolean;
  semanticSearchTopK: number;
  // Auth Settings
  authMode: string;
  credentialSource: string;
  sessionBasedOAuth: boolean;
}

interface SynthModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  recommended?: boolean;
}

interface SynthStats {
  totalSyntheses: number;
  successfulSyntheses: number;
  failedSyntheses: number;
  totalCostUsd: number;
  avgExecutionMs: number;
  riskBreakdown: Record<string, number>;
  topCapabilities: Array<{ name: string; count: number }>;
  dailyUsage: Array<{ date: string; count: number; cost: number }>;
}

interface SynthCapability {
  name: string;
  description: string;
  authType: string;
  scopes: string[];
  tokenEnvVar: string | null;
}

interface SynthManagementViewProps {
  theme: string;
}

export const SynthManagementView: React.FC<SynthManagementViewProps> = ({ theme }) => {
  const [config, setConfig] = useState<SynthConfig | null>(null);
  const [stats, setStats] = useState<SynthStats | null>(null);
  const [capabilities, setCapabilities] = useState<SynthCapability[]>([]);
  const [availableModels, setAvailableModels] = useState<SynthModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'capabilities' | 'stats' | 'security'>('config');

  // Fetch Synth configuration
  const fetchConfig = useCallback(async () => {
    try {
      const response = await apiRequest('/api/admin/synth/config');
      if (!response.ok) throw new Error('Failed to fetch Synth config');
      const data = await response.json();
      setConfig(data.config);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Fetch Synth capabilities
  const fetchCapabilities = useCallback(async () => {
    try {
      const response = await apiRequest('/api/admin/synth/capabilities');
      if (!response.ok) throw new Error('Failed to fetch capabilities');
      const data = await response.json();
      setCapabilities(data.capabilities);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Fetch Synth stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await apiRequest('/api/admin/synth/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      setStats(data.stats);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // Fetch available models for Synth
  const fetchModels = useCallback(async () => {
    try {
      const response = await apiRequest('/api/admin/synth/models');
      if (!response.ok) throw new Error('Failed to fetch models');
      const data = await response.json();
      setAvailableModels(data.models || []);
    } catch (err: any) {
      // Non-critical - just log it
      console.warn('Failed to fetch Synth models:', err.message);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchConfig(), fetchCapabilities(), fetchStats(), fetchModels()]);
      setLoading(false);
    };
    loadData();
  }, [fetchConfig, fetchCapabilities, fetchStats, fetchModels]);

  // Save config
  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiRequest('/api/admin/synth/config', {
        method: 'PUT',
        body: JSON.stringify(config),
      });

      if (!response.ok) throw new Error('Failed to save configuration');

      setSuccess('Configuration saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Toggle Synth enabled state
  const toggleEnabled = () => {
    if (config) {
      setConfig({ ...config, enabled: !config.enabled });
    }
  };

  // Toggle Synth visibility to LLM (hides Synth from LLM at runtime)
  const toggleVisibleToLLM = () => {
    if (config) {
      setConfig({ ...config, visibleToLLM: !config.visibleToLLM });
    }
  };

  // Toggle capability in allowed/blocked lists
  const toggleCapability = (capName: string, list: 'allowed' | 'blocked') => {
    if (!config) return;

    const listKey = list === 'allowed' ? 'allowedCapabilities' : 'blockedCapabilities';
    const currentList = config[listKey];

    if (currentList.includes(capName)) {
      setConfig({
        ...config,
        [listKey]: currentList.filter(c => c !== capName),
      });
    } else {
      setConfig({
        ...config,
        [listKey]: [...currentList, capName],
      });
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          crumbs={['Admin', 'Tools', 'Synthesis Config']}
          title="Synthesis Config"
          explainer="Synth — dynamic tool synthesis and execution."
        />
        <div className="p-6 flex items-center justify-center min-h-[400px]" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text)' }}>
          <RefreshIcon size={32} className="animate-spin text-accent-primary" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text)' }}>
      <PageHeader
        crumbs={['Admin', 'Tools', 'Synthesis Config']}
        title="Synthesis Config"
        explainer="Synth — dynamic tool synthesis and execution. Toggle visibility to LLM and enable/disable the synthesis pipeline."
        actions={config ? [
          { label: config.visibleToLLM ? 'Visible to LLM' : 'Hidden from LLM', onClick: () => { void toggleVisibleToLLM(); } },
          { label: config.enabled ? 'Enabled' : 'Disabled', onClick: () => { void toggleEnabled(); } },
          { label: saving ? 'Saving…' : 'Save Changes', primary: true, onClick: () => { void saveConfig(); }, disabled: saving },
        ] : [
          { label: saving ? 'Saving…' : 'Save Changes', primary: true, onClick: () => { void saveConfig(); }, disabled: saving },
        ]}
      />

      <div className="p-6">

      {/* Visibility Warning Banner */}
      {config && !config.visibleToLLM && (
        <div className="mb-4 p-4 bg-orange-100 dark:bg-orange-900/30 border border-orange-400 text-orange-700 dark:text-orange-400 rounded-lg flex items-center gap-2">
          <ShieldIcon size={20} />
          <span>
            <strong>Synth is hidden from LLM:</strong> The LLM will not see or be able to use Synth capabilities during chat.
            This is useful for testing or when you want to disable dynamic tool synthesis without disabling Synth entirely.
          </span>
        </div>
      )}

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 text-red-700 dark:text-red-400 rounded-lg flex items-center gap-2">
          <ErrorIcon size={20} />
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 bg-green-100 dark:bg-green-900/30 border border-green-400 text-green-700 dark:text-green-400 rounded-lg flex items-center gap-2">
          <SuccessIcon size={20} />
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b mb-6" style={{ borderColor: 'var(--color-border)' }}>
        {[
          { id: 'config', label: 'Configuration', icon: CogIcon },
          { id: 'capabilities', label: 'Capabilities', icon: ActivityIcon },
          { id: 'stats', label: 'Usage Stats', icon: DollarIcon },
          { id: 'security', label: 'Security', icon: ShieldIcon },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as typeof activeTab)}
            className={`px-4 py-3 flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === id
                ? 'border-accent-primary text-accent-primary'
                : 'border-transparent'
            }`}
            style={activeTab !== id ? { color: 'var(--color-text-secondary)' } : undefined}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'config' && config && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LLM Settings */}
          <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <CpuIcon size={20} style={{ color: 'var(--ap-accent)' }} />
              LLM Settings
            </h3>
            <div className="space-y-4">
              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-medium mb-1">Provider</label>
                <select
                  value={config.provider}
                  onChange={(e) => setConfig({ ...config, provider: e.target.value })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="bedrock">AWS Bedrock</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="ollama">Ollama</option>
                  <option value="openagentic">OpenAgentic (Internal)</option>
                </select>
              </div>

              {/* Model Selection */}
              <div>
                <label className="block text-sm font-medium mb-1">Model</label>
                {availableModels.length > 0 ? (
                  <select
                    value={config.model}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {availableModels
                      .filter(m => !config.provider || m.provider === config.provider)
                      .map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({model.provider})
                          {model.recommended && ' - Recommended'}
                          {model.inputCostPer1k && ` - $${model.inputCostPer1k}/1K in`}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.model}
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
                    className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    placeholder="e.g., us.anthropic.claude-opus-4-6-v1"
                  />
                )}
              </div>

              {/* Temperature */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Synthesis Temperature: {config.synthesisTemperature.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.synthesisTemperature}
                  onChange={(e) => setConfig({ ...config, synthesisTemperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
                <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <span>Precise (0)</span>
                  <span>Creative (1)</span>
                </div>
              </div>

              {/* Max Synthesis Tokens */}
              <div>
                <label className="block text-sm font-medium mb-1">Max Synthesis Tokens</label>
                <input
                  type="number"
                  value={config.maxSynthesisTokens}
                  onChange={(e) => setConfig({ ...config, maxSynthesisTokens: parseInt(e.target.value) })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  min={1000}
                  max={32000}
                  step={1000}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>Maximum tokens for code synthesis (1000-32000)</p>
              </div>

              {/* Timeout */}
              <div>
                <label className="block text-sm font-medium mb-1">Timeout (seconds)</label>
                <input
                  type="number"
                  value={config.timeoutSeconds}
                  onChange={(e) => setConfig({ ...config, timeoutSeconds: parseInt(e.target.value) })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  min={10}
                  max={300}
                />
              </div>
            </div>
          </div>

          {/* Limits */}
          <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <UsersIcon size={20} className="text-accent-primary" />
              Limits
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Max Daily Syntheses per User</label>
                <input
                  type="number"
                  value={config.maxDailySynthesesPerUser}
                  onChange={(e) => setConfig({ ...config, maxDailySynthesesPerUser: parseInt(e.target.value) })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  min={1}
                  max={10000}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Max Concurrent Executions</label>
                <input
                  type="number"
                  value={config.maxConcurrentExecutions}
                  onChange={(e) => setConfig({ ...config, maxConcurrentExecutions: parseInt(e.target.value) })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  min={1}
                  max={100}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">User Daily Budget ($)</label>
                <input
                  type="text"
                  value={config.defaultUserDailyBudgetUsd}
                  onChange={(e) => setConfig({ ...config, defaultUserDailyBudgetUsd: parseFloat(e.target.value) || 0 })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  placeholder="10.00"
                />
              </div>
            </div>
          </div>

          {/* Approval Settings */}
          <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <SuccessIcon size={20} className="text-green-500" />
              Approval Settings
            </h3>
            <div className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoApproveLowRisk}
                  onChange={(e) => setConfig({ ...config, autoApproveLowRisk: e.target.checked })}
                  className="w-4 h-4 text-blue-600"
                />
                <span>Auto-approve low-risk tools</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoApproveMediumRisk}
                  onChange={(e) => setConfig({ ...config, autoApproveMediumRisk: e.target.checked })}
                  className="w-4 h-4 text-blue-600"
                />
                <span>Auto-approve medium-risk tools</span>
              </label>
              <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                High and critical risk tools always require manual approval.
              </p>

              <div>
                <label className="block text-sm font-medium mb-1">Approval Timeout (seconds)</label>
                <input
                  type="number"
                  value={config.approvalTimeoutSeconds}
                  onChange={(e) => setConfig({ ...config, approvalTimeoutSeconds: parseInt(e.target.value) })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  min={60}
                  max={86400}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>How long to wait for approval (60s - 24h)</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Timeout Action</label>
                <select
                  value={config.approvalTimeoutAction}
                  onChange={(e) => setConfig({ ...config, approvalTimeoutAction: e.target.value as 'reject' | 'approve' })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="reject">Reject (safer)</option>
                  <option value="approve">Auto-approve</option>
                </select>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>What to do when approval times out</p>
              </div>
            </div>
          </div>

          {/* Semantic Search Settings */}
          <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <ActivityIcon size={20} className="text-accent-primary" />
              Semantic Tool Search
            </h3>
            <div className="space-y-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.useSemanticToolSearch}
                  onChange={(e) => setConfig({ ...config, useSemanticToolSearch: e.target.checked })}
                  className="w-4 h-4 text-blue-600"
                />
                <div>
                  <span className="font-medium">Enable Semantic Tool Search</span>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Use Milvus vector search to find existing tools before synthesizing new ones</p>
                </div>
              </label>

              {config.useSemanticToolSearch && (
                <div>
                  <label className="block text-sm font-medium mb-1">Top-K Results</label>
                  <input
                    type="number"
                    value={config.semanticSearchTopK}
                    onChange={(e) => setConfig({ ...config, semanticSearchTopK: parseInt(e.target.value) })}
                    className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    min={1}
                    max={20}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>Number of similar tools to consider (1-20)</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'capabilities' && (
        <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-semibold mb-4">Available Capabilities</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {capabilities.map((cap) => (
              <div
                key={cap.name}
                className="p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">{cap.name}</h4>
                  <span className={`text-xs px-2 py-1 rounded ${
                    cap.authType === 'none' ? 'bg-green-100 text-green-800' :
                    cap.authType === 'oauth' ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {cap.authType}
                  </span>
                </div>
                <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>{cap.description}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleCapability(cap.name, 'blocked')}
                    className={`text-xs px-2 py-1 rounded ${
                      config?.blockedCapabilities.includes(cap.name)
                        ? 'bg-red-600 text-white'
                        : ''
                    }`}
                    style={!config?.blockedCapabilities.includes(cap.name) ? { backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' } : undefined}
                  >
                    {config?.blockedCapabilities.includes(cap.name) ? 'Blocked' : 'Block'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'stats' && stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h4 className="text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>Total Syntheses</h4>
            <p className="text-2xl font-bold">{stats.totalSyntheses.toLocaleString()}</p>
          </div>
          <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h4 className="text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>Success Rate</h4>
            <p className="text-2xl font-bold text-green-500">
              {stats.totalSyntheses > 0
                ? ((stats.successfulSyntheses / stats.totalSyntheses) * 100).toFixed(1)
                : 0}%
            </p>
          </div>
          <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h4 className="text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>Total Cost</h4>
            <p className="text-2xl font-bold">${stats.totalCostUsd.toFixed(2)}</p>
          </div>
          <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h4 className="text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>Avg Execution Time</h4>
            <p className="text-2xl font-bold">{stats.avgExecutionMs.toFixed(0)}ms</p>
          </div>
        </div>
      )}

      {activeTab === 'security' && config && (
        <div className="p-6 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ShieldIcon size={20} className="text-red-500" />
            Security Settings
          </h3>
          <div className="space-y-6">
            <div className="p-4 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <WarningIcon size={20} className="text-yellow-600" />
                <span className="font-semibold text-yellow-800 dark:text-yellow-400">Critical Security Policy</span>
              </div>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Synth is configured to run ONLY as the authenticated user. No service accounts or hardcoded credentials are used.
                Users can only access cloud capabilities that match their SSO provider.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Authentication Mode</label>
                <div className="p-3 rounded border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <span className="font-mono text-green-500">{config.authMode}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>Always "user_only" - cannot be changed</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Credential Source</label>
                <select
                  value={config.credentialSource}
                  onChange={(e) => setConfig({ ...config, credentialSource: e.target.value })}
                  className="w-full p-2 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="sso_only">SSO Only</option>
                  <option value="linked_accounts">Linked Accounts</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.sessionBasedOAuth}
                onChange={(e) => setConfig({ ...config, sessionBasedOAuth: e.target.checked })}
                className="w-4 h-4 text-blue-600"
              />
              <span>Session-based OAuth (fresh auth each session)</span>
            </label>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              When enabled, users must re-authenticate with OAuth providers (GitHub, Slack, etc.) each session.
              No credentials are stored beyond the session.
            </p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default SynthManagementView;
