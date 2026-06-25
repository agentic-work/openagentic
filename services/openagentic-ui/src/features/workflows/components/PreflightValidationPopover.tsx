/**
 * PreflightValidationPopover — surfaced when the user clicks Run on a flow
 * with incomplete required-field configuration. Closes the audit gap
 * surfaced 2026-04-25: today the canvas runs anyway and lets the first
 * incomplete node throw mid-execution; this lists every problem upfront
 * with click-to-jump so the user fixes them in one pass.
 *
 * Two paths out:
 *   - Cancel  → close popover, do nothing
 *   - Run Anyway → user explicitly opts in (rare; some test flows have
 *                  intentionally-blank fields that the engine fills at
 *                  runtime). Logged for observability.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, ChevronRight, Play } from '@/shared/icons';
import type { ValidationIssue } from '../utils/workflowValidator';

export interface IncompleteNodeEntry {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  issues: ValidationIssue[];
}

interface Props {
  isOpen: boolean;
  incomplete: IncompleteNodeEntry[];
  onJumpToNode: (nodeId: string) => void;
  onRunAnyway: () => void;
  onCancel: () => void;
}

export const PreflightValidationPopover: React.FC<Props> = ({
  isOpen,
  incomplete,
  onJumpToNode,
  onRunAnyway,
  onCancel,
}) => {
  const totalIssues = incomplete.reduce((sum, n) => sum + n.issues.length, 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onCancel}
            style={{
              position: 'fixed', inset: 0, zIndex: 50,
              background: 'rgba(0, 0, 0, 0.55)',
              backdropFilter: 'blur(2px)',
            }}
            data-testid="preflight-popover-backdrop"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preflight-title"
            data-testid="preflight-popover"
            // Terminal Glass: frosted modal CARD (.glass) over the dim scrim
            // backdrop above. Was an opaque #0d1117 panel.
            className="glass"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 51,
              width: 'min(92vw, 560px)',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--color-border, #30363d)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <AlertTriangle style={{ width: 20, height: 20, color: 'var(--color-warning)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div id="preflight-title" style={{
                  fontSize: 15, fontWeight: 700,
                  color: 'var(--color-text, #e6edf3)',
                }}>
                  Cannot run — {incomplete.length} node{incomplete.length === 1 ? '' : 's'} need configuration
                </div>
                <div style={{
                  fontSize: 12,
                  color: 'var(--color-text-secondary, #8b949e)',
                  marginTop: 2,
                }}>
                  {totalIssues} required field{totalIssues === 1 ? '' : 's'} missing across the flow.
                </div>
              </div>
              <button
                onClick={onCancel}
                aria-label="Close"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-tertiary, #999)',
                  padding: 4, borderRadius: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                data-testid="preflight-close"
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {/* List of incomplete nodes */}
            <div style={{
              flex: 1, overflowY: 'auto',
              padding: '8px 0',
            }}>
              {incomplete.map((entry) => (
                <button
                  key={entry.nodeId}
                  onClick={() => onJumpToNode(entry.nodeId)}
                  data-testid={`preflight-node-${entry.nodeId}`}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '12px 20px',
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    background: 'transparent', border: 'none',
                    borderTop: '1px solid var(--color-border, #21262d)',
                    cursor: 'pointer',
                    color: 'var(--color-text, #e6edf3)',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface, rgba(255,255,255,0.04))')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: 'var(--color-text-tertiary, #999)',
                        letterSpacing: '0.04em', textTransform: 'uppercase',
                      }}>
                        {entry.nodeType}
                      </span>
                      <span style={{ color: 'var(--color-text, #e6edf3)' }}>{entry.nodeLabel}</span>
                    </div>
                    <ul style={{
                      margin: '6px 0 0 0', padding: 0, listStyle: 'none',
                      fontSize: 12,
                      color: 'var(--color-warning)',
                    }}>
                      {entry.issues.map((iss, i) => (
                        <li key={i} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
                          <span aria-hidden="true">•</span>
                          <span>{iss.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <ChevronRight style={{
                    width: 14, height: 14,
                    color: 'var(--color-text-tertiary, #999)',
                    flexShrink: 0, marginTop: 2,
                  }} />
                </button>
              ))}
            </div>

            {/* Footer actions */}
            <div style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--color-border, #30363d)',
              display: 'flex', gap: 8, justifyContent: 'flex-end',
            }}>
              <button
                onClick={onRunAnyway}
                data-testid="preflight-run-anyway"
                style={{
                  padding: '8px 12px',
                  background: 'transparent',
                  border: '1px solid var(--color-border, #30363d)',
                  borderRadius: 6,
                  color: 'var(--color-text-secondary, #8b949e)',
                  fontSize: 12, fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
                title="Run despite missing fields. The flow may fail mid-execution if a required value is not resolved by template at runtime."
              >
                <Play style={{ width: 12, height: 12 }} />
                Run anyway
              </button>
              <button
                onClick={onCancel}
                data-testid="preflight-cancel"
                style={{
                  padding: '8px 16px',
                  background: 'var(--color-info)',
                  border: 'none',
                  borderRadius: 6,
                  color: 'var(--color-on-accent)',
                  fontSize: 13, fontWeight: 600,
                  cursor: 'pointer',
                }}
                autoFocus
              >
                Fix Configuration
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
