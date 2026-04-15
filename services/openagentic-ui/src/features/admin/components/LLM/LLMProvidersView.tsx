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

import React, { useState, useEffect, useCallback } from 'react';
// Keep basic chevrons from lucide, use custom for status icons
import { ChevronDown, ChevronRight } from '@/shared/icons';
import { Server, CheckCircle, XCircle, AlertCircle, RefreshCw } from '../Shared/AdminIcons';
import { useAuth } from '../../../../app/providers/AuthContext';

// ── Provider Icons (matching LLMProviderManagement) ─────────────────────────
const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  'azure-openai': (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <path d="M13.05 4.24L7.56 18.05l-2.15-7.54a.5.5 0 0 0-.39-.35L2 9.7l7.96-5.46h3.09zm.87.42L21.98 18.3a.25.25 0 0 1-.2.39l-7.67.02L13.92 4.66z" fill="#0089D6"/>
      <path d="M13.92 4.66l.19 14.05-7.67.02a.25.25 0 0 1-.2-.39l6.81-13.68z" fill="#0078D4" opacity="0.8"/>
    </svg>
  ),
  'vertex-ai': (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <circle cx="7" cy="7" r="3" fill="#4285F4"/><circle cx="17" cy="7" r="3" fill="#EA4335"/>
      <circle cx="7" cy="17" r="3" fill="#34A853"/><circle cx="17" cy="17" r="3" fill="#FBBC05"/>
    </svg>
  ),
  'aws-bedrock': (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <path d="M21.7 17.84c-2.23 1.65-5.46 2.52-8.24 2.52-3.9 0-7.4-1.44-10.06-3.83-.21-.19-.02-.44.23-.3 2.86 1.67 6.4 2.67 10.06 2.67 2.47 0 5.18-.51 7.68-1.57.37-.16.69.25.33.51z" fill="#FF9900"/>
      <path d="M22.64 16.78c-.28-.36-1.87-.17-2.59-.09-.22.03-.25-.16-.05-.3 1.27-.89 3.34-.63 3.58-.34.25.3-.06 2.38-1.25 3.37-.18.15-.36.07-.28-.13.27-.68.88-2.15.59-2.51z" fill="#FF9900"/>
    </svg>
  ),
  ollama: (
    <img src="https://ollama.com/public/ollama.png" width={24} height={24} alt="Ollama" style={{ borderRadius: 4, backgroundColor: '#fff', padding: 1 }} />
  ),
  anthropic: (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <path d="M13.82 4L20 20h-3.54l-1.27-3.37H9.85L13.82 4z" fill="#D4A574"/>
      <path d="M10.18 4L4 20h3.54l1.27-3.37h5.34L10.18 4z" fill="#C4956A"/>
    </svg>
  ),
  openai: (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <path d="M22.28 9.37a6.2 6.2 0 0 0-.53-5.1 6.27 6.27 0 0 0-6.76-3.02A6.22 6.22 0 0 0 10.32 0a6.27 6.27 0 0 0-5.99 4.37 6.2 6.2 0 0 0-4.15 3.02 6.27 6.27 0 0 0 .77 7.35 6.2 6.2 0 0 0 .53 5.1 6.27 6.27 0 0 0 6.76 3.02A6.22 6.22 0 0 0 13.68 24a6.27 6.27 0 0 0 5.99-4.37 6.2 6.2 0 0 0 4.15-3.02 6.27 6.27 0 0 0-.77-7.35l-.77.11z" fill="#10A37F"/>
    </svg>
  ),
};

function getProviderIcon(name: string): React.ReactNode {
  const lowerName = name.toLowerCase();
  for (const [key, icon] of Object.entries(PROVIDER_ICONS)) {
    if (lowerName.includes(key.replace('-', '')) || lowerName.includes(key)) return icon;
  }
  if (lowerName.includes('azure')) return PROVIDER_ICONS['azure-openai'];
  if (lowerName.includes('vertex') || lowerName.includes('google') || lowerName.includes('gemini')) return PROVIDER_ICONS['vertex-ai'];
  if (lowerName.includes('bedrock') || lowerName.includes('aws')) return PROVIDER_ICONS['aws-bedrock'];
  if (lowerName.includes('ollama')) return PROVIDER_ICONS['ollama'];
  if (lowerName.includes('anthropic') || lowerName.includes('claude')) return PROVIDER_ICONS['anthropic'];
  if (lowerName.includes('openai') || lowerName.includes('gpt')) return PROVIDER_ICONS['openai'];
  return <Server size={24} className="text-primary-500" />;
}

interface LLMProvider {
  name: string;
  models: Array<{
    id: string;
    provider: string;
    capabilities: {
      chat: boolean;
      embeddings: boolean;
      tools: boolean;
      vision: boolean;
      dimensions?: number;
    };
    maxTokens?: number;
    costPerToken?: {
      prompt: number;
      completion: number;
    };
  }>;
}

interface ProviderHealth {
  provider: string;
  status: string;
  healthy: boolean;
  endpoint?: string;
  error?: string;
  lastChecked: string;
}

interface ProviderMetric {
  provider: string;
  requests: {
    total: number;
    successful: number;
    failed: number;
    successRate: string;
  };
  performance: {
    averageLatency: number;
    uptime: string;
  };
  usage: {
    totalTokens: number;
    estimatedCost: string;
  };
  lastHealthCheck: string;
}

interface LLMProvidersViewProps {
  theme: string;
}

export const LLMProvidersView: React.FC<LLMProvidersViewProps> = ({ theme }) => {
  const { getAccessToken } = useAuth();
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [metrics, setMetrics] = useState<ProviderMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();
      const headers = {
        'Authorization': `Bearer ${token}`,
        'X-OpenAgentic-Frontend': 'true'
      };

      // Try runtime providers first, fallback to database endpoint
      let providersData: any = { providers: [] };
      let healthData: any = { providers: [] };
      let metricsData: any = { providers: [] };

      // Fetch providers list - try runtime first, then database fallback
      const providersRes = await fetch('/api/admin/llm-providers', { headers });

      if (providersRes.ok) {
        providersData = await providersRes.json();
      } else if (providersRes.status === 503) {
        // ProviderManager not initialized - use database endpoint
        console.log('ProviderManager not initialized, fetching from database...');
        const dbRes = await fetch('/api/admin/llm-providers/database', { headers });
        if (dbRes.ok) {
          const dbData = await dbRes.json();
          // Convert database format to providers format
          providersData = {
            providers: dbData.providers?.map((p: any) => ({
              name: p.name,
              displayName: p.display_name,
              type: p.provider_type,
              enabled: p.enabled,
              priority: p.priority,
              isEnvironmentProvider: p.isEnvironmentProvider,
              models: [{
                id: p.model_config?.modelId || p.name,
                provider: p.name,
                capabilities: p.capabilities || { chat: true, embeddings: false, tools: true, vision: false },
                maxTokens: p.model_config?.maxTokens || 8192
              }]
            })) || []
          };
        }
      }

      // Fetch health status (may fail if ProviderManager not initialized)
      try {
        const healthRes = await fetch('/api/admin/llm-providers/health', { headers });
        if (healthRes.ok) {
          healthData = await healthRes.json();
        }
      } catch (e) {
        console.warn('Health check unavailable:', e);
      }

      // Fetch metrics (may fail if ProviderManager not initialized)
      try {
        const metricsRes = await fetch('/api/admin/llm-providers/metrics', { headers });
        if (metricsRes.ok) {
          metricsData = await metricsRes.json();
        }
      } catch (e) {
        console.warn('Metrics unavailable:', e);
      }

      setProviders(providersData.providers || []);
      setHealth(healthData.providers || []);
      setMetrics(metricsData.providers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers');
      console.error('Error fetching LLM providers:', err);
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const toggleProvider = (name: string) => {
    const newExpanded = new Set(expandedProviders);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpandedProviders(newExpanded);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5 ap-text-success" />;
      case 'degraded':
        return <AlertCircle className="w-5 h-5 ap-text-warning" />;
      case 'unhealthy':
        return <XCircle className="w-5 h-5 ap-text-error" />;
      default:
        return <AlertCircle className="w-5 h-5 text-text-tertiary" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-3 ap-text-error">
          <XCircle className="w-6 h-6" />
          <div>
            <h3 className="font-semibold">Failed to Load Providers</h3>
            <p className="text-sm text-text-secondary">{error}</p>
          </div>
        </div>
        <button
          onClick={fetchProviders}
          className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-2 text-text-primary">
            LLM Providers
          </h2>
          <p className="text-text-secondary">
            View configured providers and their available models (Read-Only)
          </p>
        </div>
        <button
          onClick={fetchProviders}
          className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
          style={{
            backgroundColor: 'var(--color-surfaceSecondary)',
            color: 'var(--color-text)'
          }}
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Server className="w-12 h-12 mx-auto mb-4 text-text-secondary" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">No Providers Configured</h3>
          <p className="text-text-secondary">Configure LLM providers to enable AI functionality</p>
        </div>
      ) : (
        providers.map((provider) => {
          const providerHealth = health.find(h => h.provider === provider.name);
          const providerMetrics = metrics.find(m => m.provider === provider.name);
          const isExpanded = expandedProviders.has(provider.name);

          return (
            <div key={provider.name} className="glass-card p-6">
              {/* Provider Header */}
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleProvider(provider.name)}
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-primary-500/10 flex items-center justify-center">
                    {getProviderIcon(provider.name)}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-text-primary">{provider.name}</h3>
                      {providerHealth && getStatusIcon(providerHealth.status)}
                    </div>
                    <p className="text-sm text-text-secondary">
                      {provider.models.length} model{provider.models.length !== 1 ? 's' : ''} available
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {providerMetrics && (
                    <div className="text-right">
                      <div className="text-sm font-medium text-text-primary">
                        {providerMetrics.requests.successRate}% success
                      </div>
                      <div className="text-xs text-text-secondary">
                        {providerMetrics.requests.total} requests
                      </div>
                    </div>
                  )}
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-text-secondary" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-text-secondary" />
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="mt-6 space-y-4">
                  {/* Health Status */}
                  {providerHealth && (
                    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                      <h4 className="text-sm font-semibold text-text-primary mb-2">Health Status</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-text-secondary">Status:</span>
                          <span className="ml-2 font-medium text-text-primary">{providerHealth.status}</span>
                        </div>
                        {providerHealth.endpoint && (
                          <div>
                            <span className="text-text-secondary">Endpoint:</span>
                            <span className="ml-2 font-mono text-xs text-text-primary">{providerHealth.endpoint}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-text-secondary">Last Checked:</span>
                          <span className="ml-2 font-medium text-text-primary">
                            {new Date(providerHealth.lastChecked).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {providerHealth.error && (
                        <div className="mt-2 p-2 rounded bg-error-500/10 ap-text-error text-xs">
                          {providerHealth.error}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Performance Metrics */}
                  {providerMetrics && (
                    <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                      <h4 className="text-sm font-semibold text-text-primary mb-2">Performance Metrics</h4>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-xs text-text-secondary">Avg Latency</div>
                          <div className="text-lg font-semibold text-text-primary">{providerMetrics.performance.averageLatency}ms</div>
                        </div>
                        <div>
                          <div className="text-xs text-text-secondary">Total Tokens</div>
                          <div className="text-lg font-semibold text-text-primary">{providerMetrics.usage.totalTokens.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-xs text-text-secondary">Est. Cost</div>
                          <div className="text-lg font-semibold text-text-primary">${providerMetrics.usage.estimatedCost}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Models List */}
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary mb-3">Available Models</h4>
                    <div className="space-y-2">
                      {provider.models.map((model) => (
                        <div
                          key={model.id}
                          className="p-3 rounded-lg border"
                          style={{
                            backgroundColor: 'var(--color-surfaceSecondary)',
                            borderColor: 'var(--color-border)'
                          }}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="font-mono text-sm font-medium text-text-primary">{model.id}</div>
                              <div className="flex gap-2 mt-2">
                                {model.capabilities.chat && (
                                  <span className="px-2 py-1 text-xs rounded-full bg-primary-500/10 text-primary-500">Chat</span>
                                )}
                                {model.capabilities.embeddings && (
                                  <span className="px-2 py-1 text-xs rounded-full bg-info-500/10 ap-text-info">Embeddings</span>
                                )}
                                {model.capabilities.tools && (
                                  <span className="px-2 py-1 text-xs rounded-full bg-success-500/10 ap-text-success">Tools</span>
                                )}
                                {model.capabilities.vision && (
                                  <span className="px-2 py-1 text-xs rounded-full bg-warning-500/10 ap-text-warning">Vision</span>
                                )}
                              </div>
                            </div>
                            {model.maxTokens && (
                              <div className="text-right">
                                <div className="text-xs text-text-secondary">Max Tokens</div>
                                <div className="text-sm font-medium text-text-primary">{model.maxTokens.toLocaleString()}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
