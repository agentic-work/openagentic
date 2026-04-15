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
 * About Modal - OpenAgentic Platform
 * Simple modal showing real version information from the API
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { apiEndpoint } from '@/utils/api';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface VersionInfo {
  version: string;
  codename: string;
  releaseDate: string;
  components: {
    platform: string;
    api: string;
    ui: string;
    mcpProxy: string;
    codeManager: string;
    openagentic?: string;
    sdk?: string;
  };
  build: {
    time: string;
    commit: string;
    branch: string;
    environment: string;
  };
  runtime: {
    nodeVersion: string;
    uptime: number;
  };
}

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch version info from API
  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(null);

      fetch(apiEndpoint('/version'))
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch version info');
          return res.json();
        })
        .then(data => {
          setVersionInfo(data);
          setLoading(false);
        })
        .catch(err => {
          console.error('Failed to fetch version info:', err);
          setError('Unable to load version information');
          setLoading(false);
        });
    }
  }, [isOpen]);

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

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

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
            className="relative w-full max-w-lg rounded-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="px-6 py-5 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-4">
                {/* Logo */}
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
                  }}
                >
                  <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 2L4 14h7v8l9-12h-7V2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
                    Agentic<span style={{ color: '#3b82f6' }}>Work</span>
                  </h2>
                  {versionInfo && (
                    <p className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
                      v{versionInfo.version} "{versionInfo.codename}"
                    </p>
                  )}
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: 'var(--color-textMuted)' }}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-5">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              ) : error ? (
                <div className="text-center py-8" style={{ color: 'var(--color-error)' }}>
                  {error}
                </div>
              ) : versionInfo ? (
                <div className="space-y-5">
                  {/* Component Versions */}
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--color-textMuted)' }}>
                      Component Versions
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'API', value: versionInfo.components.api, color: '#3b82f6' },
                        { label: 'UI', value: versionInfo.components.ui, color: '#8b5cf6' },
                        { label: 'MCP Proxy', value: versionInfo.components.mcpProxy, color: '#06b6d4' },
                        { label: 'Code Manager', value: versionInfo.components.codeManager, color: '#10b981' },
                        { label: 'OpenAgentic', value: versionInfo.components.openagentic || 'N/A', color: '#ec4899' },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="px-3 py-2 rounded-lg"
                          style={{
                            backgroundColor: `${item.color}15`,
                            border: `1px solid ${item.color}30`,
                          }}
                        >
                          <div className="text-xs" style={{ color: 'var(--color-textMuted)' }}>{item.label}</div>
                          <div className="text-sm font-mono" style={{ color: item.color }}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Build Info */}
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--color-textMuted)' }}>
                      Build Information
                    </h3>
                    <div
                      className="rounded-lg p-3 space-y-1.5 font-mono text-xs"
                      style={{ backgroundColor: 'var(--color-background)' }}
                    >
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--color-textMuted)' }}>Commit</span>
                        <span style={{ color: 'var(--color-text)' }}>{versionInfo.build.commit.slice(0, 8)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--color-textMuted)' }}>Branch</span>
                        <span style={{ color: 'var(--color-text)' }}>{versionInfo.build.branch}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--color-textMuted)' }}>Environment</span>
                        <span style={{ color: 'var(--color-text)' }}>{versionInfo.build.environment}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--color-textMuted)' }}>Build Time</span>
                        <span style={{ color: 'var(--color-text)' }}>
                          {new Date(versionInfo.build.time).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Runtime Info */}
                  <div>
                    <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--color-textMuted)' }}>
                      Runtime
                    </h3>
                    <div
                      className="rounded-lg p-3 space-y-1.5 font-mono text-xs"
                      style={{ backgroundColor: 'var(--color-background)' }}
                    >
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--color-textMuted)' }}>Node.js</span>
                        <span style={{ color: 'var(--color-text)' }}>{versionInfo.runtime.nodeVersion}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: 'var(--color-textMuted)' }}>Uptime</span>
                        <span style={{ color: '#10b981' }}>{formatUptime(versionInfo.runtime.uptime)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div
              className="px-6 py-4 flex items-center justify-between"
              style={{
                borderTop: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
              }}
            >
              <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                © {new Date().getFullYear()} OpenAgentic LLC
              </p>
              <a
                href="https://openagentics.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs hover:underline"
                style={{ color: '#3b82f6' }}
              >
                Website
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
