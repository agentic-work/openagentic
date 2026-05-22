/**
 * About Modal — OpenAgentic Platform
 *
 * Renders the LIVE deployed cluster state (image tags, digests, replica
 * counts) from GET /api/cluster/services rather than the build-time
 * version.json snapshot. The endpoint surfaces every Deployment /
 * StatefulSet in the API pod's namespace, grouped here by category.
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { apiEndpoint } from '@/utils/api';
import { OpenAgenticWordmark } from '@/shared/components/OpenAgenticWordmark';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ServiceCategory = 'core' | 'data' | 'mcp' | 'agent' | 'codemode' | 'auxiliary';

interface ServiceRow {
  name: string;
  displayName: string;
  kind: 'Deployment' | 'StatefulSet';
  image: string;
  imageDigest: string | null;
  tag: string;
  shaShort: string | null;
  replicas: { desired: number; ready: number; available: number };
  status: string;
  category: ServiceCategory;
}

interface ClusterServicesResponse {
  release: { version: string; codename: string; releaseDate?: string };
  namespace?: string;
  scrapedAt?: string;
  services: ServiceRow[];
  // Reserved for future helm-template enrichment (not currently emitted by
  // the handler — see DONE_WITH_CONCERNS note in PR description).
  chartName?: string;
  chartVersion?: string;
  appVersion?: string;
}

// Order categories deterministically so the UI is stable across renders.
const CATEGORY_ORDER: ServiceCategory[] = ['core', 'mcp', 'agent', 'codemode', 'data', 'auxiliary'];

function digestShort(digest: string | null | undefined): string {
  if (!digest) return '—';
  // imageDigest is "sha256:<64 hex>" — strip the prefix and take 12 chars
  const m = /sha256:([0-9a-f]+)/.exec(digest);
  const hex = m ? m[1] : digest;
  if (!hex || hex.length < 7) return '—';
  return hex.slice(0, 12);
}

function tagOf(image: string, fallback?: string): string {
  if (fallback) return fallback;
  const after = image.split('/').pop() || image;
  const colon = after.lastIndexOf(':');
  return colon === -1 ? 'latest' : after.slice(colon + 1);
}

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const [data, setData] = useState<ClusterServicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch live cluster service inventory
  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setError(null);

      fetch(apiEndpoint('/cluster/services'))
        .then(res => {
          if (!res.ok) throw new Error(`Cluster services endpoint returned ${res.status}`);
          return res.json();
        })
        .then((payload: ClusterServicesResponse) => {
          setData(payload);
          setLoading(false);
        })
        .catch(err => {
          console.error('Failed to fetch cluster services:', err);
          setError('Unable to load live cluster state');
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

  // Group services by category, preserving CATEGORY_ORDER
  const groupedServices: Array<{ category: ServiceCategory; rows: ServiceRow[] }> = [];
  if (data?.services?.length) {
    for (const cat of CATEGORY_ORDER) {
      const rows = data.services.filter(s => s.category === cat);
      if (rows.length) groupedServices.push({ category: cat, rows });
    }
    // Catch any unknown categories not in our enum
    const known = new Set(CATEGORY_ORDER as string[]);
    const stragglers = data.services.filter(s => !known.has(s.category));
    if (stragglers.length) {
      groupedServices.push({ category: 'auxiliary', rows: stragglers });
    }
  }

  const hasHelmInfo = !!(data?.chartName || data?.chartVersion || data?.appVersion);

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
                {data?.release && (
                  <span className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
                    v{data.release.version}
                    {data.release.codename ? ` "${data.release.codename}"` : ''}
                  </span>
                )}
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
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
                </div>
              ) : error ? (
                <div className="text-center py-8" style={{ color: 'var(--color-error)' }}>
                  {error}
                </div>
              ) : data ? (
                <div className="space-y-6">
                  {/* Live deployed services */}
                  <div>
                    <h3
                      className="text-xs font-medium uppercase tracking-wider mb-3"
                      style={{ color: 'var(--color-textMuted)' }}
                    >
                      Live deployed services
                      {data.namespace && (
                        <span className="ml-2 font-mono" style={{ textTransform: 'none' }}>
                          ({data.namespace})
                        </span>
                      )}
                    </h3>

                    {groupedServices.length === 0 ? (
                      <div className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
                        No services reported.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {groupedServices.map(({ category, rows }) => (
                          <div key={category}>
                            <div
                              className="text-[11px] font-semibold tracking-wider mb-1.5"
                              style={{ color: 'var(--color-textMuted)' }}
                            >
                              {category.toUpperCase()}
                            </div>
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
                                    <th className="text-left px-3 py-1.5 font-normal">Tag</th>
                                    <th className="text-left px-3 py-1.5 font-normal">Digest</th>
                                    <th className="text-right px-3 py-1.5 font-normal">Replicas</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((row) => (
                                    <tr
                                      key={row.name}
                                      style={{ borderTop: '1px solid var(--color-border)' }}
                                    >
                                      <td
                                        className="px-3 py-1.5"
                                        style={{ color: 'var(--color-text)' }}
                                      >
                                        {row.displayName || row.name}
                                      </td>
                                      <td className="px-3 py-1.5" style={{ color: 'var(--color-text)' }}>
                                        {tagOf(row.image, row.tag)}
                                      </td>
                                      <td
                                        className="px-3 py-1.5"
                                        style={{ color: 'var(--color-textMuted)' }}
                                      >
                                        {digestShort(row.imageDigest)}
                                      </td>
                                      <td
                                        className="px-3 py-1.5 text-right"
                                        style={{
                                          color:
                                            row.replicas.ready === row.replicas.desired
                                              ? 'var(--color-text)'
                                              : 'var(--color-error)',
                                        }}
                                      >
                                        {row.replicas.ready} / {row.replicas.desired}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Helm release — only when handler exposes the fields */}
                  {hasHelmInfo && (
                    <div>
                      <h3
                        className="text-xs font-medium uppercase tracking-wider mb-3"
                        style={{ color: 'var(--color-textMuted)' }}
                      >
                        Helm release
                      </h3>
                      <div
                        className="rounded-lg p-3 space-y-1.5 font-mono text-xs"
                        style={{
                          backgroundColor: 'var(--color-background)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        {(data.chartName || data.chartVersion) && (
                          <div className="flex justify-between">
                            <span style={{ color: 'var(--color-textMuted)' }}>Chart</span>
                            <span style={{ color: 'var(--color-text)' }}>
                              {data.chartName ?? '—'}
                              {data.chartVersion ? `@${data.chartVersion}` : ''}
                            </span>
                          </div>
                        )}
                        {data.appVersion && (
                          <div className="flex justify-between">
                            <span style={{ color: 'var(--color-textMuted)' }}>App version</span>
                            <span style={{ color: 'var(--color-text)' }}>{data.appVersion}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Release / scrape provenance */}
                  {(data.release.releaseDate || data.scrapedAt) && (
                    <div
                      className="rounded-lg p-3 space-y-1.5 font-mono text-xs"
                      style={{ backgroundColor: 'var(--color-background)' }}
                    >
                      {data.release.releaseDate && (
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--color-textMuted)' }}>Released</span>
                          <span style={{ color: 'var(--color-text)' }}>
                            {data.release.releaseDate}
                          </span>
                        </div>
                      )}
                      {data.scrapedAt && (
                        <div className="flex justify-between">
                          <span style={{ color: 'var(--color-textMuted)' }}>Scraped</span>
                          <span style={{ color: 'var(--color-text)' }}>
                            {new Date(data.scrapedAt).toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div
              className="px-6 py-3 flex items-center justify-center gap-2"
              style={{
                borderTop: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-background)',
                flexShrink: 0,
              }}
            >
              <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                OpenAgentic Platform ·
              </p>
              <a
                href="https://openagentic.io"
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                openagentic.io
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
