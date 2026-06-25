/**
 * About Modal — OpenAgentic Platform (OSS)
 *
 * Static — no live service probes or API calls. The version comes from the
 * __APP_VERSION__ build constant injected by vite.config.ts, which derives
 * from the build arg (PLATFORM_VERSION → VITE_APP_VERSION) and otherwise
 * falls back to this service's package.json version (the canonical release).
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { OpenAgenticWordmark } from '@/shared/components/OpenAgenticWordmark';

// Build-time version constant — injected by vite.config.ts via define
// (build arg → package.json version). The literal fallback below only applies
// if the define is ever stripped; keep it on the canonical release number.
declare const __APP_VERSION__: string;
const APP_VERSION: string =
  (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined) ??
  (import.meta.env.VITE_APP_VERSION as string | undefined) ??
  '1.0.0';

// Optional build info injected by the Docker build (unknown in dev builds).
const GIT_SHORT_COMMIT: string | undefined =
  (import.meta.env.VITE_GIT_SHORT_COMMIT as string | undefined) || undefined;
const GIT_BRANCH: string | undefined =
  (import.meta.env.VITE_GIT_BRANCH as string | undefined) || undefined;

// Canonical service list for the OSS platform. The platform ships as one
// monorepo release, so every service shares APP_VERSION — shown once below
// rather than repeated per row.
const SERVICES: Array<{ name: string; label: string }> = [
  { name: 'openagentic-api',       label: 'API' },
  { name: 'openagentic-ui',        label: 'UI' },
  { name: 'openagentic-mcp-proxy', label: 'MCP Proxy' },
  { name: 'openagentic-workflows', label: 'Workflows' },
  { name: 'openagentic-proxy',     label: 'Proxy' },
];

const COPYRIGHT_YEAR = new Date().getFullYear();

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[10001] flex items-center justify-center px-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="glass relative w-full max-w-2xl overflow-hidden"
            style={{
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="px-6 py-5 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--glass-border)', flexShrink: 0 }}
            >
              <div className="flex items-center gap-3">
                <OpenAgenticWordmark size={28} animate />
                <span className="text-sm font-mono" style={{ color: 'var(--color-textMuted)' }}>
                  v{APP_VERSION}
                </span>
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className="p-2 rounded-lg transition-colors hover:bg-[var(--ctl-surf-hover)]"
                style={{ color: 'var(--color-textMuted)' }}
                aria-label="Close"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-5" style={{ overflowY: 'auto', flex: 1 }}>
              <div className="space-y-6">
                {/* Release — one monorepo version for the whole platform */}
                <div>
                  <h3
                    className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: 'var(--color-textMuted)' }}
                  >
                    Release
                  </h3>
                  <div
                    className="rounded-lg overflow-hidden px-4 py-3 flex items-baseline justify-between"
                    style={{
                      border: '1px solid var(--glass-border)',
                      backgroundColor: 'var(--ctl-surf)',
                    }}
                  >
                    <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                      OpenAgentic Platform
                    </span>
                    <span className="text-sm font-mono" style={{ color: 'var(--color-text)' }}>
                      v{APP_VERSION}
                    </span>
                  </div>
                  {(GIT_SHORT_COMMIT || GIT_BRANCH) && (
                    <p
                      className="mt-2 text-xs font-mono"
                      style={{ color: 'var(--color-textMuted)' }}
                    >
                      build {GIT_SHORT_COMMIT ?? 'unknown'}
                      {GIT_BRANCH ? ` · ${GIT_BRANCH}` : ''}
                    </p>
                  )}
                </div>

                {/* Services */}
                <div>
                  <h3
                    className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: 'var(--color-textMuted)' }}
                  >
                    Services
                  </h3>
                  <div
                    className="rounded-lg overflow-hidden"
                    style={{
                      border: '1px solid var(--glass-border)',
                      backgroundColor: 'var(--ctl-surf)',
                    }}
                  >
                    <table className="w-full text-xs font-mono">
                      <tbody>
                        {SERVICES.map((svc, i) => (
                          <tr
                            key={svc.name}
                            style={
                              i === 0
                                ? undefined
                                : { borderTop: '1px solid var(--color-border)' }
                            }
                          >
                            <td className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>
                              {svc.label}
                            </td>
                            <td
                              className="px-3 py-1.5 text-right"
                              style={{ color: 'var(--color-textMuted)' }}
                            >
                              {svc.name}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Links */}
                <div>
                  <h3
                    className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: 'var(--color-textMuted)' }}
                  >
                    Links
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <a
                        href="https://agenticwork.io"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:underline"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        agenticwork.io
                      </a>
                      <span style={{ color: 'var(--color-textMuted)' }}>
                        — Project website
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href="https://github.com/agentic-work/openagentic"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:underline"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        GitHub
                      </a>
                      <span style={{ color: 'var(--color-textMuted)' }}>
                        — OpenAgentic open-source repository
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              className="px-6 py-3 flex items-center justify-between gap-2"
              style={{
                borderTop: '1px solid var(--glass-border)',
                backgroundColor: 'var(--ctl-surf)',
                flexShrink: 0,
              }}
            >
              <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                © {COPYRIGHT_YEAR} Agenticwork LLC · Apache License 2.0
              </p>
              <a
                href="https://agenticwork.io"
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                agenticwork.io
              </a>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default AboutModal;
