/**
 * #781 Phase B — ArtifactSlideOut primitive.
 *
 * The single slide-out shell every artifact-kind renderer plugs into.
 * Right-anchored panel with framer-motion slide-in, full-screen toggle
 * via `<dialog>` modal, ESC-to-close, accent rail, action bar slot.
 *
 * Aesthetic: matches `mocks/UX/AI/Artifacts/01-artifact-slideout-editorial.html`
 * editorial-prestige design for analytical-kind artifacts. Phase C
 * renderers can layer their own aesthetic inside the body slot
 * (midnight-blueprint for architecture / Stripe-Linear for mini-apps,
 * see ground rules in `docs/superpowers/plans/2026-05-13-next-gen-artifact-slideouts.md`).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ArtifactKind, ArtifactStatus } from './types.js';

export interface ArtifactSlideOutProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  /** Optional action bar slot — renders to the right of the title. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

const STATUS_LABEL: Record<ArtifactStatus, string> = {
  running: 'Running',
  success: 'Complete',
  error: 'Error',
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  'python-report': 'Report',
  'react-app': 'App',
  chart: 'Chart',
  table: 'Table',
  runbook: 'Runbook',
  'mini-app': 'Mini-App',
  unknown: 'Artifact',
};

export const ArtifactSlideOut: React.FC<ArtifactSlideOutProps> = ({
  open,
  onOpenChange,
  title,
  kind,
  status,
  actions,
  children,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ESC closes the slide-out (and exits fullscreen first if open)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          onOpenChange(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isFullscreen, onOpenChange]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          data-testid="artifact-slideout-root"
          data-fullscreen={isFullscreen ? 'true' : 'false'}
          role="dialog"
          aria-modal="true"
          aria-label={`Artifact: ${title}`}
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'tween', duration: 0.18, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            top: isFullscreen ? 0 : '64px',
            right: 0,
            bottom: 0,
            width: isFullscreen ? '100vw' : '560px',
            height: isFullscreen ? '100vh' : 'calc(100vh - 64px)',
            zIndex: 9999,
            display: 'grid',
            gridTemplateRows: 'auto 1fr',
            background: 'var(--surface, #f8f3e8)',
            color: 'var(--ink, #0d0d0c)',
            boxShadow: '-12px 0 32px rgba(0,0,0,0.10)',
            borderLeft: '3px solid var(--accent, #c1440e)',
          }}
        >
          <header
            data-testid="artifact-slideout-header"
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--ink-on-paper, rgba(13,13,12,0.12))',
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto auto',
              gap: '12px',
              alignItems: 'center',
            }}
          >
            <span
              data-testid="artifact-slideout-kind-badge"
              data-kind={kind}
              style={{
                fontSize: '10.5px',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontWeight: 600,
                padding: '3px 8px',
                background: 'var(--accent, #c1440e)',
                color: 'var(--paper, #f8f3e8)',
              }}
            >
              {KIND_LABEL[kind]}
            </span>
            <h2
              style={{
                margin: 0,
                fontSize: '15.5px',
                fontWeight: 600,
                fontFamily: 'var(--font-serif, ui-serif, Georgia, serif)',
                color: 'var(--ink, #0d0d0c)',
                letterSpacing: '-0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </h2>
            <span
              data-testid="artifact-slideout-status"
              data-status={status}
              style={{
                fontSize: '10.5px',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color:
                  status === 'error'
                    ? 'var(--err, #b91c1c)'
                    : status === 'running'
                      ? 'var(--warn, #ca8a04)'
                      : 'var(--ok, #16a34a)',
                fontWeight: 500,
              }}
            >
              {STATUS_LABEL[status]}
            </span>
            <div data-testid="artifact-slideout-actions">{actions}</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                data-testid="artifact-slideout-fullscreen"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--ink-on-paper, rgba(13,13,12,0.18))',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
                  fontSize: '11px',
                  color: 'var(--ink, #0d0d0c)',
                }}
              >
                {isFullscreen ? '⤓' : '⤢'}
              </button>
              <button
                type="button"
                data-testid="artifact-slideout-close"
                onClick={() => onOpenChange(false)}
                aria-label="Close artifact"
                title="Close (Esc)"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--ink-on-paper, rgba(13,13,12,0.18))',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
                  fontSize: '11px',
                  color: 'var(--ink, #0d0d0c)',
                }}
              >
                ×
              </button>
            </div>
          </header>
          <div
            data-testid="artifact-slideout-body"
            style={{
              overflow: 'auto',
              padding: '20px',
              background: 'var(--paper, #f8f3e8)',
            }}
          >
            {children}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
