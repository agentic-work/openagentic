/**
 * ApprovalModal — human-approval gate for MUTATING tool calls.
 * Surfaces the backend `approval_required` SSE event (commit 7e6637539):
 *   { auditId, toolName, serverName?, args, preview? }
 * Approve  → POST /api/approvals/:auditId/approve
 * Deny     → POST /api/approvals/:auditId/deny
 * Canonical theme tokens only (light + dark safe).
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Check, X } from '@/shared/icons';

export interface AuditApprovalRequest {
  auditId: string;
  toolName: string;
  serverName?: string;
  args?: Record<string, unknown> | string;
  preview?: string;
}

interface ApprovalModalProps {
  approval: AuditApprovalRequest;
  /** number of further approvals waiting behind this one (one-at-a-time queue) */
  queuedCount?: number;
  /** true while the approve/deny POST is in flight */
  pending?: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

function prettyArgs(args: AuditApprovalRequest['args']): string {
  if (args == null) return '';
  if (typeof args === 'string') {
    try { return JSON.stringify(JSON.parse(args), null, 2); } catch { return args; }
  }
  try { return JSON.stringify(args, null, 2); } catch { return String(args); }
}

const ApprovalModal: React.FC<ApprovalModalProps> = ({
  approval, queuedCount = 0, pending = false, onApprove, onDeny,
}) => {
  const argsText = prettyArgs(approval.args);

  return (
    <AnimatePresence>
      <motion.div
        data-testid="approval-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Tool approval required"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
          backdropFilter: 'blur(4px)',
        }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          className="rounded-panel p-6 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className="p-3 rounded-lg"
              style={{ backgroundColor: 'color-mix(in srgb, var(--user-accent-primary) 16%, transparent)' }}
            >
              <Shield className="w-6 h-6" style={{ color: 'var(--user-accent-primary)' }} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
                Approval required
              </h3>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                A mutating tool wants to run
                {queuedCount > 0 ? ` · ${queuedCount} more waiting` : ''}
              </p>
            </div>
          </div>

          {/* Tool + server */}
          <div
            className="mb-4 p-4 rounded-lg"
            style={{
              backgroundColor: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold font-mono text-sm" style={{ color: 'var(--color-text)' }}>
                {approval.toolName}
              </span>
              {approval.serverName && (
                <span
                  className="px-2 py-0.5 rounded text-xs font-mono"
                  style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
                >
                  {approval.serverName}
                </span>
              )}
            </div>

            {approval.preview && (
              <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>
                {approval.preview}
              </p>
            )}

            {argsText && (
              <div
                className="mt-3 p-3 rounded-lg"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>
                  Arguments
                </p>
                <pre
                  data-testid="approval-args"
                  className="text-xs overflow-auto font-mono"
                  style={{ color: 'var(--color-text)', maxHeight: '240px' }}
                >
                  {argsText}
                </pre>
              </div>
            )}
          </div>

          {/* Awaiting-human / pending notice */}
          <div
            className="mb-4 p-3 rounded-lg"
            style={{ backgroundColor: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
          >
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {pending
                ? 'Submitting your decision…'
                : 'Awaiting a human decision. The tool is paused and will auto-deny if no one responds.'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              data-testid="approval-deny"
              disabled={pending}
              onClick={onDeny}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-pill font-medium disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-surface-2)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            >
              <X className="w-5 h-5" />
              Deny
            </button>
            <button
              data-testid="approval-approve"
              disabled={pending}
              onClick={onApprove}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-pill font-medium disabled:opacity-50"
              style={{
                backgroundColor: 'var(--user-accent-primary)',
                color: 'var(--color-on-accent, #ffffff)',
              }}
            >
              <Check className="w-5 h-5" />
              Approve
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ApprovalModal;
