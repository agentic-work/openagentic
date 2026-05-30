/**
 * About Modal — OpenAgentic Platform (OSS)
 *
 * Static — shows the build-time app version for each service.
 * No live service probes or API calls. Version is sourced from
 * the __APP_VERSION__ build constant injected by vite.config.ts
 * (VITE_APP_VERSION env var → defaults to '0.0.0-dev' in CI-less builds).
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { OpenAgenticWordmark } from '@/shared/components/OpenAgenticWordmark';

// Build-time version constant — injected by vite.config.ts via define.
// Falls back to the VITE_APP_VERSION env var or a 'dev' sentinel.
declare const __APP_VERSION__: string;
const APP_VERSION: string =
  (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined) ??
  (import.meta.env.VITE_APP_VERSION as string | undefined) ??
  '0.1.0';

// Canonical service list for the OSS platform.
const SERVICES: Array<{ name: string; label: string }> = [
  { name: 'openagentic-api',       label: 'API' },
  { name: 'openagentic-ui',        label: 'UI' },
  { name: 'openagentic-mcp-proxy', label: 'MCP Proxy' },
  { name: 'openagentic-workflows', label: 'Workflows' },
  { name: 'openagentic-exec',      label: 'Exec' },
  { name: 'openagentic-proxy',     label: 'Proxy' },
  { name: 'openagentic-synth',     label: 'Synth' },
];

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
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="px-6 py-5 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}
            >
              <div className="flex items-center gap-3">
                <OpenAgenticWordmark size={28} animate />
                <span className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
                  v{APP_VERSION}
                </span>
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
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
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-background)',
                    }}
                  >
                    <table className="w-full text-xs font-mono">
                      <thead>
                        <tr style={{ color: 'var(--color-textMuted)' }}>
                          <th className="text-left px-3 py-1.5 font-normal">Service</th>
                          <th className="text-left px-3 py-1.5 font-normal">Version</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SERVICES.map((svc) => (
                          <tr
                            key={svc.name}
                            style={{ borderTop: '1px solid var(--color-border)' }}
                          >
                            <td className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>
                              {svc.label}
                            </td>
                            <td className="px-3 py-1.5" style={{ color: 'var(--color-textMuted)' }}>
                              v{APP_VERSION}
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
                        — Hosted edition &amp; enterprise features
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
                borderTop: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                flexShrink: 0,
              }}
            >
              <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                OpenAgentic Platform · v{APP_VERSION} · open source
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
