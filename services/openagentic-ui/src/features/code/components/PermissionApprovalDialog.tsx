/**
 * Permission Approval Dialog Component
 *
 * Openagentic style permission approval modal:
 * - Shows command/operation preview
 * - [Deny], [Always allow for project], [Allow once] options
 * - Keyboard shortcuts: Esc (Deny), Ctrl+Enter (Always), Enter (Allow once)
 * - Focus trap for accessibility
 *
 * Used when CodeMode tries to run potentially dangerous operations
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Terminal, X, Shield, ShieldCheck, ShieldX } from '@/shared/icons';
import clsx from 'clsx';

// =============================================================================
// Types
// =============================================================================

export type PermissionDecision = 'deny' | 'allow_once' | 'always_allow';

export interface PermissionRequest {
  id: string;
  type: 'bash' | 'write' | 'read' | 'delete' | 'network' | 'other';
  title: string;
  description?: string;
  command?: string;
  filePath?: string;
  risk: 'low' | 'medium' | 'high';
}

interface PermissionApprovalDialogProps {
  request: PermissionRequest | null;
  onDecision: (decision: PermissionDecision, requestId: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

// =============================================================================
// Risk Level Colors
// =============================================================================

const getRiskColor = (risk: 'low' | 'medium' | 'high') => {
  switch (risk) {
    case 'high':
      return 'var(--color-error)';
    case 'medium':
      return 'var(--color-warning)';
    case 'low':
    default:
      return 'var(--color-success)';
  }
};

const getRiskIcon = (risk: 'low' | 'medium' | 'high') => {
  switch (risk) {
    case 'high':
      return AlertTriangle;
    case 'medium':
      return Shield;
    case 'low':
    default:
      return ShieldCheck;
  }
};

// =============================================================================
// Main Component
// =============================================================================

export const PermissionApprovalDialog: React.FC<PermissionApprovalDialogProps> = ({
  request,
  onDecision,
  isOpen,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const allowOnceRef = useRef<HTMLButtonElement>(null);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen || !request) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      onDecision('deny', request.id);
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        onDecision('always_allow', request.id);
      } else {
        onDecision('allow_once', request.id);
      }
      onClose();
    }
  }, [isOpen, request, onDecision, onClose]);

  // Add/remove keyboard listener
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Focus the "Allow once" button by default
      setTimeout(() => {
        allowOnceRef.current?.focus();
      }, 100);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Click outside to close
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
      onDecision('deny', request?.id || '');
      onClose();
    }
  }, [request, onDecision, onClose]);

  if (!isOpen || !request) return null;

  const RiskIcon = getRiskIcon(request.risk);
  const riskColor = getRiskColor(request.risk);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
        }}
        onClick={handleBackdropClick}
      >
        <motion.div
          ref={dialogRef}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="relative w-full max-w-lg rounded-xl overflow-hidden shadow-2xl"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Risk indicator bar */}
          <div
            className="h-1"
            style={{ backgroundColor: riskColor }}
          />

          {/* Header */}
          <div className="px-5 pt-4 pb-3 flex items-start gap-3">
            <div
              className="p-2 rounded-lg"
              style={{
                backgroundColor: `color-mix(in srgb, ${riskColor} 15%, transparent)`,
              }}
            >
              <RiskIcon size={20} style={{ color: riskColor }} />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-[var(--color-text)]">
                {request.title}
              </h3>
              {request.description && (
                <p className="text-sm text-[var(--color-textMuted)] mt-0.5">
                  {request.description}
                </p>
              )}
            </div>

            <button
              onClick={() => {
                onDecision('deny', request.id);
                onClose();
              }}
              className="p-1.5 rounded-lg hover:bg-[var(--color-surfaceHover)] transition-colors"
              style={{ color: 'var(--color-textMuted)' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Command preview */}
          {request.command && (
            <div className="px-5 pb-4">
              <div
                className="rounded-lg p-3 font-mono text-sm"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div className="flex items-center gap-2 text-[var(--color-textMuted)] mb-1.5">
                  <Terminal size={14} />
                  <span className="text-xs uppercase tracking-wider">Command</span>
                </div>
                <code
                  className="text-[var(--color-text)] break-all"
                  style={{ wordBreak: 'break-word' }}
                >
                  {request.command}
                </code>
              </div>
            </div>
          )}

          {/* File path preview */}
          {request.filePath && !request.command && (
            <div className="px-5 pb-4">
              <div
                className="rounded-lg p-3 font-mono text-sm"
                style={{
                  backgroundColor: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <code className="text-cyan-400 break-all">
                  {request.filePath}
                </code>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div
            className="px-5 py-4 flex items-center justify-between gap-3"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            {/* Deny button */}
            <button
              onClick={() => {
                onDecision('deny', request.id);
                onClose();
              }}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
                'bg-transparent hover:bg-[var(--color-surfaceHover)]',
                'border border-[var(--color-border)]',
                'text-[var(--color-text)]',
                'transition-colors'
              )}
            >
              <ShieldX size={16} />
              <span>Deny</span>
              <kbd className="ml-1.5 text-xs text-[var(--color-textMuted)] bg-[var(--color-background)] px-1.5 py-0.5 rounded">
                Esc
              </kbd>
            </button>

            <div className="flex items-center gap-2">
              {/* Always allow button */}
              <button
                onClick={() => {
                  onDecision('always_allow', request.id);
                  onClose();
                }}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
                  'bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)]',
                  'text-[var(--color-text)]',
                  'transition-colors'
                )}
              >
                <span>Always allow</span>
                <kbd className="text-xs text-[var(--color-textMuted)] bg-[var(--color-background)] px-1.5 py-0.5 rounded">
                  Ctrl+Enter
                </kbd>
              </button>

              {/* Allow once button (primary) */}
              <button
                ref={allowOnceRef}
                onClick={() => {
                  onDecision('allow_once', request.id);
                  onClose();
                }}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
                  'bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90',
                  'text-white',
                  'shadow-lg shadow-[var(--color-primary)]/25',
                  'transition-colors'
                )}
              >
                <ShieldCheck size={16} />
                <span>Allow once</span>
                <kbd className="ml-1.5 text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded">
                  Enter
                </kbd>
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

export default PermissionApprovalDialog;
