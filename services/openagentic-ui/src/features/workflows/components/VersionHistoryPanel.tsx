/**
 * VersionHistoryPanel
 * Side panel listing WorkflowVersion rows for the current flow.
 * Shows timestamp, author, changelog. Each row has Compare + Restore actions.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, GitBranch, RotateCcw, ChevronLeft } from '@/shared/icons';
import type { WorkflowVersion } from '../types/workflow.types';

interface VersionHistoryPanelProps {
  versions: WorkflowVersion[];
  currentVersion: WorkflowVersion | null;
  onClose: () => void;
  onCompare: (version: WorkflowVersion) => void;
  onRestore: (version: WorkflowVersion) => void;
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({
  versions,
  currentVersion,
  onClose,
  onCompare,
  onRestore,
}) => {
  const [pendingRestore, setPendingRestore] = useState<WorkflowVersion | null>(null);

  // Sort newest first
  const sorted = [...versions].sort((a, b) => b.version - a.version);

  const handleRestoreClick = (version: WorkflowVersion) => {
    setPendingRestore(version);
  };

  const handleRestoreConfirm = () => {
    if (pendingRestore) {
      onRestore(pendingRestore);
      setPendingRestore(null);
    }
  };

  const handleRestoreCancel = () => {
    setPendingRestore(null);
  };

  return (
    <div
      data-testid="version-history-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary, #0a0a0f)',
        color: 'var(--text-primary, #e4e4e7)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-primary, #27272a)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: 6,
            color: 'var(--text-secondary, #71717a)',
            display: 'flex',
            alignItems: 'center',
          }}
          title="Close"
        >
          <ChevronLeft size={16} />
        </button>
        <GitBranch size={16} style={{ color: 'var(--accent-primary, #818cf8)' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Version History</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: 6,
            color: 'var(--text-secondary, #71717a)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Version list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary, #71717a)', fontSize: 12, padding: 24 }}>
            No saved versions yet
          </div>
        )}

        {sorted.map((version) => {
          const isCurrent = currentVersion?.id === version.id || version.isActive;
          return (
            <div
              key={version.id}
              data-testid={`version-row-${version.version}`}
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--border-primary, #27272a)',
                background: isCurrent ? 'rgba(129,140,248,0.05)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  data-testid={`version-label-${version.version}`}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: isCurrent ? 'var(--accent-primary, #818cf8)' : 'var(--text-primary, #e4e4e7)',
                    fontFamily: 'monospace',
                  }}
                >
                  v{version.version}
                </span>
                {isCurrent && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                    color: 'var(--accent-primary, #818cf8)',
                    background: 'rgba(129,140,248,0.15)',
                    padding: '1px 5px', borderRadius: 3,
                    letterSpacing: '0.04em',
                  }}>
                    current
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-secondary, #71717a)' }}>
                  {formatDate(version.createdAt)}
                </span>
              </div>

              {version.changelog && (
                <div style={{ fontSize: 11, color: 'var(--text-primary, #e4e4e7)', marginBottom: 4, lineHeight: 1.4 }}>
                  {version.changelog}
                </div>
              )}

              {version.createdBy && (
                <div style={{ fontSize: 10, color: 'var(--text-secondary, #71717a)', marginBottom: 8 }}>
                  {version.createdBy}
                </div>
              )}

              {/* Actions */}
              {!isCurrent && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => onCompare(version)}
                    style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 5,
                      border: '1px solid var(--border-primary, #27272a)',
                      background: 'transparent',
                      color: 'var(--text-secondary, #71717a)',
                      cursor: 'pointer',
                    }}
                  >
                    Compare
                  </button>
                  <button
                    onClick={() => handleRestoreClick(version)}
                    style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 5,
                      border: '1px solid rgba(249,115,22,0.3)',
                      background: 'rgba(249,115,22,0.08)',
                      color: '#f97316',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <RotateCcw size={10} />
                    Restore
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Confirmation dialog */}
      <AnimatePresence>
        {pendingRestore && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            data-testid="restore-confirm-dialog"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
            }}
          >
            <div style={{
              background: 'var(--bg-secondary, #18181b)',
              border: '1px solid var(--border-primary, #27272a)',
              borderRadius: 10,
              padding: 20,
              maxWidth: 320,
              width: '100%',
              margin: '0 16px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary, #e4e4e7)' }}>
                Restore v{pendingRestore.version}?
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary, #71717a)', marginBottom: 16, lineHeight: 1.5 }}>
                This will overwrite the current workflow with version {pendingRestore.version}.
                {pendingRestore.changelog && ` (${pendingRestore.changelog})`}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={handleRestoreCancel}
                  data-testid="restore-cancel-button"
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 12,
                    border: '1px solid var(--border-primary, #27272a)',
                    background: 'transparent',
                    color: 'var(--text-secondary, #71717a)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRestoreConfirm}
                  data-testid="restore-confirm-button"
                  style={{
                    padding: '6px 14px', borderRadius: 6, fontSize: 12,
                    border: '1px solid rgba(249,115,22,0.3)',
                    background: 'rgba(249,115,22,0.15)',
                    color: '#f97316',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Restore
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
