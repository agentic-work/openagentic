/**
 * VersionsContent — version history & restore.
 */

import React from 'react';
import { Clock, RotateCw, ArrowRightLeft } from '@/shared/icons';
import type { WorkflowVersion } from '../sectionShared';

export const VersionsContent: React.FC<{
  versions?: WorkflowVersion[];
  onRestoreVersion?: (versionId: string) => void;
}> = ({ versions = [], onRestoreVersion }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {versions.length} version{versions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {versions.length === 0 ? (
        <div className="py-12 text-center">
          <Clock className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No version history yet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Versions are created when you save or deploy a workflow.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map((version, idx) => (
            <div key={version.id || idx} className="rounded-lg border p-4 transition-colors hover:bg-[var(--color-surface)]"
              style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold px-2 py-0.5 rounded-full" style={{
                    backgroundColor: idx === 0 ? 'var(--glass-accent-fill-2)' : 'var(--color-surface)',
                    color: idx === 0 ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  }}>
                    v{version.version || versions.length - idx}
                  </span>
                  {idx === 0 && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)' }}>
                      Current
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {version.created_at ? new Date(version.created_at).toLocaleString() : 'Unknown'}
                </span>
              </div>
              {version.changelog && (
                <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>{version.changelog}</p>
              )}
              <div className="flex items-center gap-2">
                {idx !== 0 && (
                  <button onClick={() => onRestoreVersion?.(version.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:bg-[var(--color-surface)]"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-accent)' }}>
                    <RotateCw className="w-3 h-3" /> Restore
                  </button>
                )}
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:bg-[var(--color-surface)] opacity-50 cursor-not-allowed"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }} disabled>
                  <ArrowRightLeft className="w-3 h-3" /> Compare
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
