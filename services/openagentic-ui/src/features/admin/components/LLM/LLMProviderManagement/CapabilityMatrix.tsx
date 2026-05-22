/**
 * Capability Matrix — Grid view showing which providers handle which capabilities.
 */
import React from 'react';
import { Server } from '../../Shared/AdminIcons';
import { InfoTooltip } from '../../Shared/AdminTooltip';
import { type DbProvider, CAPABILITY_ROWS, PROVIDER_META } from './types';

export const CapabilityMatrix: React.FC<{
  providers: DbProvider[];
  onCapabilityChange: (providerId: string, capability: string, role: 'primary' | 'fallback' | 'none') => void;
}> = ({ providers, onCapabilityChange }) => {
  const activeProviders = providers.filter(p => !p.deleted_at && p.enabled);

  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
            <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', minWidth: 140 }}>
              Capability
            </th>
            {activeProviders.map(p => {
              const meta = PROVIDER_META[p.provider_type] || PROVIDER_META.ollama;
              return (
                <th key={p.id} className="text-center px-3 py-3" style={{ minWidth: 120 }}>
                  <div className="flex flex-col items-center gap-1">
                    <span className="flex items-center">{meta.icon}</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{p.display_name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ color: 'var(--text-muted)', border: '1px solid var(--color-border)' }}>
                      P{p.priority}
                    </span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {CAPABILITY_ROWS.map((cap) => (
            <tr key={cap.key} className="border-b hover:brightness-105 transition-colors" style={{ borderColor: 'var(--color-border)' }}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{cap.label}</span>
                  <InfoTooltip content={cap.description} size={12} />
                </div>
              </td>
              {activeProviders.map(p => {
                const hasCap = p.capabilities?.[cap.key] ?? false;
                const providersWithCap = activeProviders.filter(pp => pp.capabilities?.[cap.key]).sort((a, b) => a.priority - b.priority);
                const isPrimary = providersWithCap[0]?.id === p.id;
                const isFallback = hasCap && !isPrimary;

                return (
                  <td key={p.id} className="text-center px-3 py-3">
                    <div className="flex flex-col items-center gap-1">
                      {/* Primary radio */}
                      <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: isPrimary ? 'var(--ap-accent)' : 'var(--text-tertiary)' }}>
                        <input type="radio" name={`primary-${cap.key}`} checked={isPrimary && hasCap}
                          onChange={() => onCapabilityChange(p.id, cap.key, 'primary')}
                          className="accent-primary-500" style={{ width: 12, height: 12 }} />
                        Primary
                      </label>
                      {/* Fallback checkbox */}
                      <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: isFallback ? 'var(--ap-accent)' : 'var(--text-tertiary)' }}>
                        <input type="checkbox" checked={hasCap && !isPrimary}
                          onChange={e => onCapabilityChange(p.id, cap.key, e.target.checked ? 'fallback' : 'none')}
                          className="rounded" style={{ width: 12, height: 12, accentColor: 'var(--ap-accent)' }} />
                        Fallback
                      </label>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {activeProviders.length === 0 && (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          <Server size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">No active providers. Enable providers to configure capabilities.</p>
        </div>
      )}
    </div>
  );
};
