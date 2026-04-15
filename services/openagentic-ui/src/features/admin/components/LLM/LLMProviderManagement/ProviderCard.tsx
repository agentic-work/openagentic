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
 * Provider Card — Individual card in the provider list view.
 */
import React from 'react';
import { Edit2, ChevronRight, Plus } from '@/shared/icons';
import { Server } from '../../Shared/AdminIcons';
import { AdminStatusBadge } from '../../Shared/AdminStatusBadge';
import {
  type DbProvider, type HealthInfo, type MetricsInfo, type HealthStatus,
  PROVIDER_META, btnPrimary, resolveHealthStatus, healthToBadgeStatus, countModels,
} from './types';
import { ProviderDetailPanel } from './ProviderDetailPanel';

interface ProviderCardProps {
  provider: DbProvider;
  health?: HealthInfo;
  metrics?: MetricsInfo;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onToggleEnabled: () => void;
  onPauseResume: (durationMinutes?: number) => void;
  onRotateCredentials: () => void;
  onCapabilityToggle: (capability: string, enabled: boolean) => void;
  testing: boolean;
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
  provider, health, metrics, isExpanded, onToggleExpand,
  onEdit, onDelete, onTest, onToggleEnabled,
  onPauseResume, onRotateCredentials, onCapabilityToggle, testing,
}) => {
  const meta = PROVIDER_META[provider.provider_type] || PROVIDER_META.ollama;
  const isEnv = provider.id.startsWith('env-');
  const mc = provider.model_config || {};
  const hStatus = resolveHealthStatus(provider, health);
  const modelCount = countModels(mc);

  return (
    <div className="rounded-xl border overflow-hidden transition-all" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      {/* Card Header */}
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer select-none hover:brightness-105 transition-all"
        onClick={onToggleExpand}>
        <div className="flex items-center gap-4">
          {/* Icon with health dot overlay */}
          <div className={`relative w-10 h-10 rounded-lg flex items-center justify-center ${meta.bgColor} ${meta.borderColor} border`}>
            <span className="text-lg flex items-center justify-center">{meta.icon}</span>
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2"
              style={{
                borderColor: 'var(--color-surface)',
                backgroundColor: hStatus === 'healthy' ? '#00D26A' : hStatus === 'paused' ? '#f59e0b' : hStatus === 'unhealthy' ? '#ef4444' : hStatus === 'disabled' ? 'var(--text-tertiary)' : '#8b5cf6',
              }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{provider.display_name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ border: '1px solid var(--color-border)', color: 'var(--text-muted)' }}>
                P{provider.priority}
              </span>
              {isEnv && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">ENV</span>}
              {modelCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#6366f115', color: '#6366f1', border: '1px solid #6366f130' }}>
                  {modelCount} model{modelCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{meta.label}</span>
              {mc.chatModel && <><span className="text-xs" style={{ color: 'var(--text-muted)' }}>&middot;</span><code className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{mc.chatModel}</code></>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {metrics && metrics.totalRequests > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {metrics.totalRequests.toLocaleString()} reqs &middot; {metrics.averageLatency?.toFixed(0) || '?'}ms
            </span>
          )}
          <AdminStatusBadge status={healthToBadgeStatus(hStatus)} size="sm" />
          {!isEnv && (
            <button onClick={e => { e.stopPropagation(); onEdit(); }}
              className="p-1.5 rounded-lg border transition-colors hover:brightness-110"
              style={{ borderColor: 'var(--color-border)', color: 'var(--text-secondary)' }} title="Edit">
              <Edit2 size={14} />
            </button>
          )}
          <button onClick={e => { e.stopPropagation(); if (!isEnv) onToggleEnabled(); }}
            className={`relative w-9 h-5 rounded-full transition-colors ${isEnv ? 'opacity-50 cursor-not-allowed' : ''} ${provider.enabled ? 'bg-emerald-500' : ''}`}
            style={!provider.enabled ? { backgroundColor: 'var(--color-border)' } : undefined}
            disabled={isEnv} title={provider.enabled ? 'Disable' : 'Enable'}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${provider.enabled ? 'left-4' : 'left-0.5'}`} />
          </button>
          <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} style={{ color: 'var(--text-muted)' }}>
            <ChevronRight size={16} />
          </span>
        </div>
      </div>

      {/* Expanded Detail Panel */}
      {isExpanded && (
        <ProviderDetailPanel
          provider={provider}
          health={health}
          metrics={metrics}
          onEdit={onEdit}
          onDelete={onDelete}
          onTest={onTest}
          onPauseResume={onPauseResume}
          onRotateCredentials={onRotateCredentials}
          onCapabilityToggle={onCapabilityToggle}
          testing={testing}
          isEnv={isEnv}
        />
      )}
    </div>
  );
};

/** Empty state for when no providers are configured */
export const EmptyProviderState: React.FC<{
  searchTerm: string;
  onAddProvider: () => void;
}> = ({ searchTerm, onAddProvider }) => (
  <div className="text-center py-16 rounded-xl border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surfaceSecondary)' }}>
    <Server size={40} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
    <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
      {searchTerm ? 'No matching providers' : 'No providers configured'}
    </p>
    {!searchTerm && (
      <button onClick={onAddProvider} className={`${btnPrimary} mt-3`}>
        <Plus size={16} className="inline mr-1" /> Add Provider
      </button>
    )}
  </div>
);
