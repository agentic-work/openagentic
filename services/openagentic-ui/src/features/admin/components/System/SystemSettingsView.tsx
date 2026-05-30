import React, { useState, useEffect } from 'react';
import { CogIcon as Settings, SaveIcon as Save, CloseIcon as X, SuccessIcon as Check } from '../Shared/AdminIcons';
import { useAuth } from '../../../../app/providers/AuthContext';
import { apiRequest } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

interface TieredFCConfig {
  enabled: boolean;
  toolStrippingEnabled: boolean;
  decisionCacheEnabled: boolean;
  decisionCacheTTL: number;
  cheapModel: string;
  balancedModel: string;
  premiumModel: string;
}

interface SystemSettingsViewProps {
  theme?: string;
}

const SystemSettingsView: React.FC<SystemSettingsViewProps> = () => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Tiered Function Calling state
  const [tieredFCConfig, setTieredFCConfig] = useState<TieredFCConfig>({
    enabled: true,
    toolStrippingEnabled: true,
    decisionCacheEnabled: true,
    decisionCacheTTL: 300,
    cheapModel: '',
    balancedModel: '',
    premiumModel: ''
  });
  const [hasTieredFCChanges, setHasTieredFCChanges] = useState(false);
  const [savingTieredFC, setSavingTieredFC] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();

      const fcResponse = await apiRequest('/admin/tiered-fc', { headers });
      const fcData = await fcResponse.json();
      setTieredFCConfig({
        enabled: fcData.enabled ?? true,
        toolStrippingEnabled: fcData.toolStrippingEnabled ?? true,
        decisionCacheEnabled: fcData.decisionCacheEnabled ?? true,
        decisionCacheTTL: fcData.decisionCacheTTL ?? 300,
        cheapModel: fcData.cheapModel || '',
        balancedModel: fcData.balancedModel || '',
        premiumModel: fcData.premiumModel || '',
      });
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleTieredFCChange = (key: keyof TieredFCConfig, value: boolean | number | string) => {
    setTieredFCConfig(prev => ({ ...prev, [key]: value }));
    setHasTieredFCChanges(true);
  };

  const handleSaveTieredFC = async () => {
    setSavingTieredFC(true);
    setError(null);
    setSuccess(null);

    try {
      const headers = {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      };

      await apiRequest('/admin/tiered-fc', {
        method: 'PUT',
        headers,
        body: JSON.stringify(tieredFCConfig)
      });

      setHasTieredFCChanges(false);
      setSuccess('Tiered function calling settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tiered FC settings');
    } finally {
      setSavingTieredFC(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          crumbs={['Admin', 'System', 'Settings']}
          title="System Settings"
          explainer="Configure global system settings that apply to all users."
        />
        <div className="flex items-center justify-center h-64">
          <div
            className="animate-spin rounded-full h-8 w-8"
            style={{
              border: '2px solid var(--color-border)',
              borderTopColor: 'var(--color-primary)',
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={['Admin', 'System', 'Settings']}
        title="System Settings"
        explainer="Configure global system settings that apply to all users."
      />

      {/* Error/Success Messages */}
      {error && (
        <div
          className="p-4 rounded-lg flex items-center gap-3"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-error) 15%, transparent)',
            border: '1px solid var(--color-error)',
          }}
        >
          <span style={{ color: 'var(--color-error)' }}>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto p-1 rounded"
            style={{ color: 'var(--color-error)' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {success && (
        <div
          className="p-4 rounded-lg flex items-center gap-3"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
            border: '1px solid var(--color-success)',
          }}
        >
          <Check size={16} style={{ color: 'var(--color-success)' }} />
          <span style={{ color: 'var(--color-success)' }}>{success}</span>
        </div>
      )}

      {/* Tiered Function Calling Settings */}
      <div
        className="p-6 rounded-lg"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3
            className="text-xl font-semibold flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <Settings size={20} style={{ color: 'var(--color-primary)' }} />
            Tiered Function Calling
          </h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tieredFCConfig.enabled}
              onChange={(e) => handleTieredFCChange('enabled', e.target.checked)}
              className="w-5 h-5 rounded"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Enabled
            </span>
          </label>
        </div>

        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          Configure how models are selected for function calling decisions and tool routing.
          This optimizes cost by using cheaper models for simple decisions.
        </p>

        {/* Tool Stripping */}
        <div
          className="mb-4 p-4 rounded-lg"
          style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
        >
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={tieredFCConfig.toolStrippingEnabled}
              onChange={(e) => handleTieredFCChange('toolStrippingEnabled', e.target.checked)}
              className="w-5 h-5 rounded"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            <div>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Tool Stripping
              </span>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Strip tools from requests that don't need them (saves 2000+ tokens per request)
              </p>
            </div>
          </label>
        </div>

        {/* Decision Caching */}
        <div
          className="mb-6 p-4 rounded-lg"
          style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
        >
          <label className="flex items-center gap-3 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={tieredFCConfig.decisionCacheEnabled}
              onChange={(e) => handleTieredFCChange('decisionCacheEnabled', e.target.checked)}
              className="w-5 h-5 rounded"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            <div>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Decision Caching
              </span>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Cache function calling decisions to avoid redundant model calls
              </p>
            </div>
          </label>
          {tieredFCConfig.decisionCacheEnabled && (
            <div className="ml-8 mt-2">
              <label className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Cache TTL (seconds)
                <input
                  type="number"
                  value={tieredFCConfig.decisionCacheTTL}
                  onChange={(e) => handleTieredFCChange('decisionCacheTTL', parseInt(e.target.value) || 300)}
                  className="ml-2 w-24 px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--text-primary)',
                  }}
                  min={0}
                  max={3600}
                />
              </label>
            </div>
          )}
        </div>

        {/* Model Configuration by Tier */}
        <div className="mb-6">
          <h4
            className="text-lg font-medium mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Model Configuration by Tier
          </h4>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            Leave blank to use slider-selected model. Specify models for cost optimization.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Cheap Tier */}
            <div
              className="p-4 rounded-lg"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-success) 10%, var(--color-surface))',
                border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="font-medium" style={{ color: 'var(--color-success)' }}>
                  Cheap Tier (0-40%)
                </span>
              </div>
              <input
                type="text"
                value={tieredFCConfig.cheapModel}
                onChange={(e) => handleTieredFCChange('cheapModel', e.target.value)}
                placeholder="e.g., gemini-2.0-flash"
                className="w-full px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--text-primary)',
                }}
              />
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                Fast, economical model for simple function decisions
              </p>
            </div>

            {/* Balanced Tier */}
            <div
              className="p-4 rounded-lg"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, var(--color-surface))',
                border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="font-medium" style={{ color: 'var(--color-warning)' }}>
                  Balanced Tier (41-60%)
                </span>
              </div>
              <input
                type="text"
                value={tieredFCConfig.balancedModel}
                onChange={(e) => handleTieredFCChange('balancedModel', e.target.value)}
                placeholder="e.g., claude-3-5-sonnet"
                className="w-full px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--text-primary)',
                }}
              />
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                Standard model for moderate complexity tasks
              </p>
            </div>

            {/* Premium Tier */}
            <div
              className="p-4 rounded-lg"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, var(--color-surface))',
                border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                  Premium Tier (61-100%)
                </span>
              </div>
              <input
                type="text"
                value={tieredFCConfig.premiumModel}
                onChange={(e) => handleTieredFCChange('premiumModel', e.target.value)}
                placeholder="e.g., claude-3-opus"
                className="w-full px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--text-primary)',
                }}
              />
              <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                High-quality model for complex reasoning
              </p>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div
          className="flex items-center justify-end gap-4 pt-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {hasTieredFCChanges && (
            <span className="text-sm" style={{ color: 'var(--color-warning)' }}>
              You have unsaved changes
            </span>
          )}
          <button
            onClick={handleSaveTieredFC}
            disabled={!hasTieredFCChanges || savingTieredFC}
            className="px-6 py-2 rounded-lg flex items-center gap-2 transition-colors"
            style={{
              backgroundColor: hasTieredFCChanges ? 'var(--color-primary)' : 'var(--color-surfaceTertiary)',
              color: hasTieredFCChanges ? 'var(--ap-fg-0)' : 'var(--text-muted)',
              cursor: hasTieredFCChanges && !savingTieredFC ? 'pointer' : 'not-allowed',
              opacity: savingTieredFC ? 0.7 : 1,
            }}
          >
            <Save size={16} />
            {savingTieredFC ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SystemSettingsView;
