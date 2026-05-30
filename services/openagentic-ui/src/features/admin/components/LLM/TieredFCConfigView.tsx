/**
 * TieredFCConfigView - Tiered Function Calling Configuration
 *
 * Configure function calling tiers and optimization settings:
 * - Tier model configuration (cheap/balanced/premium)
 * - Tool stripping thresholds
 * - Decision cache settings
 * - Cache statistics display
 * - Test decision functionality
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Trash2,
  Save,
  Zap,
  Database,
  Activity,
  Play,
  ChevronDown,
  ChevronRight,
  X,
  CheckCircle,
  AlertTriangle,
  Layers,
  Clock,
} from '@/shared/icons';
import { apiRequest } from '@/utils/api';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { PageHeader } from '../../primitives-v2';
import SlideInPanel, {
  SlideInPanelSection,
  SlideInPanelFooter,
  SlideInPanelField,
} from '@/shared/components/SlideInPanel';

interface TierConfig {
  // Post-slider-rip (0.6.6 task #144 + 0.6.7 umbrella #210): `triggers`
  // is a human-readable label describing WHEN this tier fires
  // (message complexity + tool count). No per-user override.
  triggers: string;
  model: string;
  description: string;
  recommended: string[];
}

interface CacheStats {
  size: number;
  hits?: number;
  misses?: number;
  hitRate?: number;
}

interface TieredFCConfig {
  cheapModel: string | null;
  balancedModel: string | null;
  premiumModel: string | null;
  toolStrippingEnabled: boolean;
  decisionCacheEnabled: boolean;
  decisionCacheTtlSeconds: number;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  providerDisplay: string;
}

interface TieredFCData {
  config: TieredFCConfig;
  cacheStats: CacheStats;
  tiers: {
    cheap: TierConfig;
    balanced: TierConfig;
    premium: TierConfig;
  };
  features: {
    toolStripping: { enabled: boolean; description: string };
    decisionCaching: { enabled: boolean; ttlSeconds: number; description: string };
  };
}

interface TestResult {
  decision: string;
  model: string;
  shouldStripTools: boolean;
  reason: string;
  cached: boolean;
}

interface ModelSelectProps {
  id: string;
  label: string;
  hint: string;
  value: string | null;
  onChange: (next: string | null) => void;
  availableModels: AvailableModel[];
}

function renderModelSelect({ id, label, hint, value, onChange, availableModels }: ModelSelectProps) {
  const grouped = new Map<string, AvailableModel[]>();
  for (const m of availableModels) {
    const key = m.providerDisplay;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(m);
    else grouped.set(key, [m]);
  }
  const knownIds = new Set(availableModels.map(m => m.id));
  const showOrphan = value && !knownIds.has(value);

  return (
    <SlideInPanelField label={label} htmlFor={id} hint={hint}>
      <select
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
      >
        <option value="">(Use system default)</option>
        {showOrphan && (
          <option value={value!}>{value} — not in current registry</option>
        )}
        {Array.from(grouped.entries()).map(([providerDisplay, models]) => (
          <optgroup key={providerDisplay} label={providerDisplay}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </SlideInPanelField>
  );
}

const TieredFCConfigView: React.FC = () => {
  const confirm = useConfirm();
  const [data, setData] = useState<TieredFCData | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit state
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [editForm, setEditForm] = useState<Partial<TieredFCConfig>>({});

  // Test state
  // 2026-04-19 — testSliderPosition removed (task #144, slider rip).
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testToolCount, setTestToolCount] = useState(10);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Expanded sections
  const [expandedSections, setExpandedSections] = useState({
    tiers: true,
    features: true,
    cache: true,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgResp, provResp] = await Promise.all([
        apiRequest('/admin/tiered-fc'),
        apiRequest('/admin/llm-providers'),
      ]);
      const result = await cfgResp.json();
      setData(result);
      setEditForm({
        cheapModel: result.config.cheapModel,
        balancedModel: result.config.balancedModel,
        premiumModel: result.config.premiumModel,
        toolStrippingEnabled: result.config.toolStrippingEnabled,
        decisionCacheEnabled: result.config.decisionCacheEnabled,
        decisionCacheTtlSeconds: result.config.decisionCacheTtlSeconds,
      });

      // Build the registry list from /admin/llm-providers. Backend already
      // merges provider_config.models[] with model_config.{chatModel,defaultModel,...}
      // and broadcasts invalidation via Redis pub/sub, so this response is
      // always current — we just re-pull when admin changes providers.
      if (provResp.ok) {
        const provData = await provResp.json();
        const seen = new Map<string, AvailableModel>();
        const providers = Array.isArray(provData?.providers) ? provData.providers : [];
        for (const p of providers) {
          if (p.enabled === false) continue;
          const chat = p.capabilities?.chat;
          if (chat === false) continue;
          const providerName = p.name || p.type || 'unknown';
          const providerDisplay = p.displayName || providerName;
          const modelsArr = Array.isArray(p.models) ? p.models : [];
          for (const m of modelsArr) {
            if (m?.capabilities?.chat === false) continue;
            const id = m?.id || m?.name;
            if (!id) continue;
            const lower = String(id).toLowerCase();
            if (lower.includes('embed') || lower.startsWith('imagen') || lower.includes('image-generation')) continue;
            if (!seen.has(id)) {
              seen.set(id, {
                id,
                name: m.name || id,
                provider: providerName,
                providerDisplay,
              });
            }
          }
        }
        const sorted = Array.from(seen.values()).sort((a, b) => {
          if (a.providerDisplay !== b.providerDisplay) return a.providerDisplay.localeCompare(b.providerDisplay);
          return a.name.localeCompare(b.name);
        });
        setAvailableModels(sorted);
      }
    } catch (err) {
      console.error('Failed to fetch tiered FC config:', err);
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const onRegistryChanged = () => { void fetchData(); };
    const onFocus = () => { void fetchData(); };
    window.addEventListener('llm-registry-changed', onRegistryChanged);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('llm-registry-changed', onRegistryChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchData]);

  const handleSaveConfig = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await apiRequest('/admin/tiered-fc', {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });

      setSuccess('Configuration saved successfully');
      setShowEditPanel(false);
      await fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (!await confirm('Clear the function calling decision cache?', { variant: 'danger', title: 'Clear Cache' })) return;

    setActionLoading(true);
    setError(null);
    try {
      const response = await apiRequest('/admin/tiered-fc/clear-cache', {
        method: 'POST',
      });
      const result = await response.json();

      setSuccess(`Cleared ${result.entriesCleared} cached decisions`);
      await fetchData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cache');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTestDecision = async () => {
    if (!testMessage.trim()) {
      setError('Please enter a test message');
      return;
    }

    setTestLoading(true);
    setTestResult(null);
    setError(null);
    try {
      const response = await apiRequest('/admin/tiered-fc/test', {
        method: 'POST',
        body: JSON.stringify({
          message: testMessage,
          toolCount: testToolCount,
        }),
      });
      const result = await response.json();
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test decision');
    } finally {
      setTestLoading(false);
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Tier colors using CSS variables
  const getTierColorStyle = (tier: string): React.CSSProperties => {
    switch (tier) {
      case 'cheap':
        return { color: 'var(--ap-success)' };
      case 'balanced':
        return { color: 'var(--ap-warning)' };
      case 'premium':
        return { color: 'var(--ap-info)' };
      default:
        return { color: 'var(--color-text-secondary)' };
    }
  };

  const getTierBgStyle = (tier: string): React.CSSProperties => {
    switch (tier) {
      case 'cheap':
        return { backgroundColor: 'var(--ap-segment-success-bg)', borderColor: 'color-mix(in srgb, var(--ap-success) 30%, transparent)' };
      case 'balanced':
        return { backgroundColor: 'var(--ap-segment-warning-bg)', borderColor: 'color-mix(in srgb, var(--ap-warning) 30%, transparent)' };
      case 'premium':
        return { backgroundColor: 'var(--ap-segment-info-bg)', borderColor: 'color-mix(in srgb, var(--ap-info) 30%, transparent)' };
      default:
        return { backgroundColor: 'var(--color-surface-secondary)', borderColor: 'var(--color-border)' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Universal admin chrome — every page wears the same header. */}
      <PageHeader
        crumbs={['Admin', 'LLM', 'Tiered Function Calling']}
        title="Tiered Function Calling"
        explainer="Configure cheap/balanced/premium tier models, tool-stripping thresholds, and decision cache."
        actions={[
          { label: 'Refresh', onClick: () => { void fetchData(); }, disabled: actionLoading },
          { label: 'Configure', primary: true, onClick: () => setShowEditPanel(true) },
        ]}
      />

      {/* Caption (replaced SoTBanner + ExplainerCard pair — see exposition audit 2026-05-05) */}
      <p className="text-sm" style={{ color: 'var(--ap-text-secondary)', margin: '0 0 16px' }}>
        Tier composition is the single largest cost lever — putting a premium model in
        <b> economy</b> makes every &quot;what time?&quot; query pay premium prices.
        <span
          title="Tier composition reads from the model registry — assigning a non-routable model to a tier silently drops it from the candidate pool. The Smart Router only considers models within the request's tier when picking a winner."
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '16px', height: '16px', marginLeft: '6px',
            fontSize: '10px', fontWeight: 700,
            color: 'var(--ap-text-secondary)',
            border: '1px solid var(--ap-border)', borderRadius: '50%',
            cursor: 'help', verticalAlign: 'middle',
          }}
        >?</span>
      </p>

      {/* Messages */}
      {error && (
        <div className="glass-card p-4 rounded-lg ap-bg-error" style={{ borderColor: 'color-mix(in srgb, var(--ap-error) 50%, transparent)' }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" style={{ color: 'var(--ap-error)' }} />
            <span style={{ color: 'var(--ap-error)' }}>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto p-1 rounded ap-icon-btn-error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {success && (
        <div className="glass-card p-4 rounded-lg ap-bg-success" style={{ borderColor: 'color-mix(in srgb, var(--ap-success) 50%, transparent)' }}>
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5" style={{ color: 'var(--ap-success)' }} />
            <span style={{ color: 'var(--ap-success)' }}>{success}</span>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="glass-card p-4 border-l-4" style={{ borderLeftColor: 'var(--ap-success)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">Cheap Tier</p>
                  <p className="text-lg font-semibold truncate" style={{ color: 'var(--ap-success)' }}>
                    {data.config.cheapModel || 'Default'}
                  </p>
                  <p className="text-xs text-text-secondary">{data.tiers.cheap.triggers}</p>
                </div>
                <Zap className="h-8 w-8 opacity-50" style={{ color: 'var(--ap-success)' }} />
              </div>
            </div>

            <div className="glass-card p-4 border-l-4" style={{ borderLeftColor: 'var(--ap-warning)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">Balanced Tier</p>
                  <p className="text-lg font-semibold truncate" style={{ color: 'var(--ap-warning)' }}>
                    {data.config.balancedModel || 'Default'}
                  </p>
                  <p className="text-xs text-text-secondary">{data.tiers.balanced.triggers}</p>
                </div>
                <Layers className="h-8 w-8 opacity-50" style={{ color: 'var(--ap-warning)' }} />
              </div>
            </div>

            <div className="glass-card p-4 border-l-4" style={{ borderLeftColor: 'var(--ap-info)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">Premium Tier</p>
                  <p className="text-lg font-semibold truncate" style={{ color: 'var(--ap-info)' }}>
                    {data.config.premiumModel || 'Default'}
                  </p>
                  <p className="text-xs text-text-secondary">{data.tiers.premium.triggers}</p>
                </div>
                <Activity className="h-8 w-8 opacity-50" style={{ color: 'var(--ap-info)' }} />
              </div>
            </div>

            <div className="glass-card p-4 border-l-4" style={{ borderLeftColor: 'var(--color-primary)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-secondary">Cache Size</p>
                  <p className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>{data.cacheStats.size}</p>
                  <p className="text-xs text-text-secondary">cached decisions</p>
                </div>
                <Database className="h-8 w-8 opacity-50" style={{ color: 'var(--color-primary)' }} />
              </div>
            </div>
          </div>

          {/* Tiers Section */}
          <div className="glass-card">
            <button
              onClick={() => toggleSection('tiers')}
              className="w-full p-4 flex items-center justify-between hover:bg-surface-secondary/20 transition-colors"
            >
              <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary-400" />
                Model Tiers Configuration
              </h3>
              {expandedSections.tiers ? (
                <ChevronDown className="h-5 w-5 text-text-secondary" />
              ) : (
                <ChevronRight className="h-5 w-5 text-text-secondary" />
              )}
            </button>

            {expandedSections.tiers && (
              <div className="p-6 pt-0 grid grid-cols-1 md:grid-cols-3 gap-4">
                {(['cheap', 'balanced', 'premium'] as const).map((tierName) => {
                  const tier = data.tiers[tierName];
                  return (
                    <div
                      key={tierName}
                      className="p-4 rounded-lg border"
                      style={getTierBgStyle(tierName)}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold capitalize" style={getTierColorStyle(tierName)}>
                          {tierName} Tier
                        </h4>
                        <span className="text-xs text-text-secondary">{tier.triggers}</span>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <span className="text-xs text-text-secondary block">Current Model:</span>
                          <span className="text-sm text-text-primary font-medium">{tier.model}</span>
                        </div>
                        {tier.recommended.length > 0 && tier.recommended[0] !== 'See env config' && (
                          <div>
                            <span className="text-xs text-text-secondary block">Recommended:</span>
                            <span className="text-xs text-text-primary">{tier.recommended.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Features Section */}
          <div className="glass-card">
            <button
              onClick={() => toggleSection('features')}
              className="w-full p-4 flex items-center justify-between hover:bg-surface-secondary/20 transition-colors"
            >
              <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary-400" />
                Optimization Features
              </h3>
              {expandedSections.features ? (
                <ChevronDown className="h-5 w-5 text-text-secondary" />
              ) : (
                <ChevronRight className="h-5 w-5 text-text-secondary" />
              )}
            </button>

            {expandedSections.features && (
              <div className="p-6 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <h4
                      className="font-medium text-text-primary"
                      title={data.features.toolStripping.description}
                    >Tool Stripping</h4>
                    <span className={`ap-badge ${
                      data.features.toolStripping.enabled
                        ? 'ap-badge-success'
                        : 'ap-badge-error'
                    }`}>
                      {data.features.toolStripping.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <h4
                      className="font-medium text-text-primary"
                      title={data.features.decisionCaching.description}
                    >Decision Caching</h4>
                    <span className={`ap-badge ${
                      data.features.decisionCaching.enabled
                        ? 'ap-badge-success'
                        : 'ap-badge-error'
                    }`}>
                      {data.features.decisionCaching.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  {data.features.decisionCaching.enabled && (
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                      <Clock className="h-3 w-3" />
                      TTL: {data.features.decisionCaching.ttlSeconds}s
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Model FC Ranking Table */}
          <div className="glass-card">
            <div className="p-4">
              <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2 mb-4">
                <Activity className="h-5 w-5 text-primary-400" />
                Model Function Calling Accuracy
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-text-secondary font-medium">Model Family</th>
                      <th
                        className="text-center py-2 px-3 text-text-secondary font-medium"
                        title="FC accuracy scores are derived from SmartModelRouter capability inference. Models below the minimum threshold (90%) are restricted to simple single-call tools."
                      >FC Accuracy</th>
                      <th className="text-center py-2 px-3 text-text-secondary font-medium">Tier</th>
                      <th className="text-center py-2 px-3 text-text-secondary font-medium">Complexity</th>
                      <th className="text-right py-2 px-3 text-text-secondary font-medium">Est. Cost/Call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { family: 'Claude (Opus/Sonnet)', accuracy: 97, tier: 'Premium', complexity: 'Multi-step', cost: '$0.05-0.12' },
                      { family: 'GPT-4o', accuracy: 95, tier: 'Balanced', complexity: 'Multi-step', cost: '$0.02-0.06' },
                      { family: 'Gemini 2.0 Pro', accuracy: 93, tier: 'Balanced', complexity: 'Multi-step', cost: '$0.01-0.04' },
                      { family: 'GPT-4o-mini', accuracy: 88, tier: 'Cheap', complexity: 'Simple', cost: '$0.001-0.003' },
                      { family: 'Gemini 2.0 Flash', accuracy: 85, tier: 'Cheap', complexity: 'Simple', cost: '$0.0005-0.002' },
                      { family: 'Claude Haiku', accuracy: 82, tier: 'Cheap', complexity: 'Simple', cost: '$0.001-0.005' },
                    ].map((row, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="py-2 px-3 text-text-primary font-medium">{row.family}</td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{
                              backgroundColor: row.accuracy >= 90
                                ? 'color-mix(in srgb, var(--ap-success) 15%, transparent)'
                                : 'color-mix(in srgb, var(--ap-warning) 15%, transparent)',
                              color: row.accuracy >= 90 ? 'var(--ap-success)' : 'var(--ap-warning)',
                            }}
                          >
                            {row.accuracy}%
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span style={getTierColorStyle(row.tier.toLowerCase())} className="text-xs font-medium">
                            {row.tier}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center text-text-secondary text-xs">{row.complexity}</td>
                        <td className="py-2 px-3 text-right text-text-secondary text-xs">{row.cost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Cache Section */}
          <div className="glass-card">
            <button
              onClick={() => toggleSection('cache')}
              className="w-full p-4 flex items-center justify-between hover:bg-surface-secondary/20 transition-colors"
            >
              <h3 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <Database className="h-5 w-5 text-primary-400" />
                Cache Statistics
              </h3>
              {expandedSections.cache ? (
                <ChevronDown className="h-5 w-5 text-text-secondary" />
              ) : (
                <ChevronRight className="h-5 w-5 text-text-secondary" />
              )}
            </button>

            {expandedSections.cache && (
              <div className="p-6 pt-0">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-6">
                    <div>
                      <span className="text-sm text-text-secondary block">Cached Decisions</span>
                      <span className="text-2xl font-bold text-text-primary">{data.cacheStats.size}</span>
                    </div>
                    {data.cacheStats.hitRate !== undefined && (
                      <div>
                        <span className="text-sm text-text-secondary block">Hit Rate</span>
                        <span className="text-2xl font-bold" style={{ color: 'var(--ap-success)' }}>
                          {(data.cacheStats.hitRate * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleClearCache}
                    disabled={actionLoading || data.cacheStats.size === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ap-bg-error"
                    style={{ color: 'var(--ap-error)' }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear Cache
                  </button>
                </div>

                {/* Test Tool */}
                <div className="mt-4 p-4 bg-surface-secondary/30 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-text-primary flex items-center gap-2">
                      <Play className="h-4 w-4" />
                      Test Function Calling Decision
                    </h4>
                    <button
                      onClick={() => setShowTestPanel(!showTestPanel)}
                      className="text-xs px-2 py-1 border border-border rounded hover:bg-surface-secondary transition-colors text-text-secondary"
                    >
                      {showTestPanel ? 'Hide' : 'Show'} Test Tool
                    </button>
                  </div>

                  {showTestPanel && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-text-secondary mb-1">Test Message</label>
                        <textarea
                          value={testMessage}
                          onChange={(e) => setTestMessage(e.target.value)}
                          placeholder="Enter a message to test function calling decision..."
                          rows={3}
                          className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary placeholder-text-secondary resize-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-text-secondary mb-1">Tool Count</label>
                        <input
                          type="number"
                          min="0"
                          value={testToolCount}
                          onChange={(e) => setTestToolCount(parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
                        />
                      </div>
                      {/* 2026-04-19 — Slider Position input removed (task #144);
                          tier is derived from message complexity + tool count. */}
                      <button
                        onClick={handleTestDecision}
                        disabled={testLoading || !testMessage.trim()}
                        className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50"
                      >
                        {testLoading ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            Testing...
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" />
                            Test Decision
                          </>
                        )}
                      </button>

                      {testResult && (
                        <div className="mt-4 p-3 border border-border rounded-lg bg-surface-primary">
                          <h5 className="font-medium text-text-primary mb-2">Test Result:</h5>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Decision:</span>
                              <span className="text-text-primary font-medium">{testResult.decision}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Model:</span>
                              <span className="text-text-primary font-medium">{testResult.model}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Strip Tools:</span>
                              <span style={testResult.shouldStripTools ? { color: 'var(--ap-success)' } : {}}>
                                {testResult.shouldStripTools ? 'Yes' : 'No'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-text-secondary">Cached:</span>
                              <span style={testResult.cached ? { color: 'var(--color-primary)' } : {}}>
                                {testResult.cached ? 'Yes (cache hit)' : 'No'}
                              </span>
                            </div>
                            {testResult.reason && (
                              <div>
                                <span className="text-text-secondary block">Reason:</span>
                                <span className="text-text-primary">{testResult.reason}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit Configuration Panel */}
      <SlideInPanel
        isOpen={showEditPanel}
        onClose={() => setShowEditPanel(false)}
        title="Configure Tiered Function Calling"
        subtitle="Customize model selection and optimization settings"
        width="lg"
        icon={<Settings size={20} />}
        footer={
          <SlideInPanelFooter
            onCancel={() => setShowEditPanel(false)}
            onSubmit={handleSaveConfig}
            cancelText="Cancel"
            submitText="Save Configuration"
            isSubmitting={actionLoading}
          />
        }
      >
        <SlideInPanelSection title="Model Configuration" description="Configure models for each tier">
          {renderModelSelect({
            id: 'cheapModel',
            label: 'Cheap Tier Model',
            hint: 'Fast, low-cost model for simple requests (<= 3 tools, short messages)',
            value: editForm.cheapModel ?? null,
            onChange: (v) => setEditForm({ ...editForm, cheapModel: v }),
            availableModels,
          })}
          {renderModelSelect({
            id: 'balancedModel',
            label: 'Balanced Tier Model',
            hint: 'Good accuracy, moderate cost (default tier)',
            value: editForm.balancedModel ?? null,
            onChange: (v) => setEditForm({ ...editForm, balancedModel: v }),
            availableModels,
          })}
          {renderModelSelect({
            id: 'premiumModel',
            label: 'Premium Tier Model',
            hint: 'Best accuracy, higher cost (> 8 tools, long messages, multi-step, multi-cloud)',
            value: editForm.premiumModel ?? null,
            onChange: (v) => setEditForm({ ...editForm, premiumModel: v }),
            availableModels,
          })}
        </SlideInPanelSection>

        <SlideInPanelSection title="Optimization Settings" description="Fine-tune performance and cost optimization">
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-surface-secondary/20">
              <input
                type="checkbox"
                checked={editForm.toolStrippingEnabled ?? true}
                onChange={(e) => setEditForm({ ...editForm, toolStrippingEnabled: e.target.checked })}
                className="w-4 h-4"
              />
              <div>
                <span
                  className="block text-text-primary font-medium"
                  title="Removes tools from requests that don't need function calling — saves ~2000+ tokens per request."
                >Enable Tool Stripping</span>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-surface-secondary/20">
              <input
                type="checkbox"
                checked={editForm.decisionCacheEnabled ?? true}
                onChange={(e) => setEditForm({ ...editForm, decisionCacheEnabled: e.target.checked })}
                className="w-4 h-4"
              />
              <div>
                <span className="block text-text-primary font-medium">Enable Decision Caching</span>
              </div>
            </label>

            <SlideInPanelField
              label="Cache TTL (seconds)"
              htmlFor="cacheTtl"
              hint="How long to cache function calling decisions"
            >
              <input
                id="cacheTtl"
                type="number"
                min="0"
                value={editForm.decisionCacheTtlSeconds ?? 300}
                onChange={(e) => setEditForm({ ...editForm, decisionCacheTtlSeconds: parseInt(e.target.value) || 300 })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary"
              />
            </SlideInPanelField>
          </div>
        </SlideInPanelSection>
      </SlideInPanel>
    </div>
  );
};

export default TieredFCConfigView;
