/**
 * VersionBadge — compact "v0.6.6 · dev" pill in the sidebar footer.
 * Click opens the About panel (platform logo + per-service versions).
 *
 * Uses theme tokens (--bg-*, --fg-*, --line-*) so it looks correct in
 * light and dark themes — the previous iteration used hardcoded
 * bg-gray-800 classes and went black-on-black in light mode.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CompanyLogo } from './CompanyLogo';

interface ServiceStatus {
  version: string;
  status: 'online' | 'offline' | 'degraded';
}

interface VersionData {
  version: string;
  environment: string;
  services: Record<string, ServiceStatus>;
}

interface ServiceDetail {
  name: string;
  version: string;
  gitCommit?: string;
  gitShortCommit?: string;
  status: 'online' | 'offline' | 'unknown';
  endpoint?: string;
  lastChecked?: string;
}

interface FullVersionData {
  platform: {
    name: string;
    version: string;
    environment: string;
    buildTime: string;
    gitCommit: string;
    gitBranch: string;
  };
  services: ServiceDetail[];
  timestamp: string;
}

const statusDot = (status: string): string => {
  switch (status) {
    case 'online':
      return 'var(--color-ok)';
    case 'offline':
      return 'var(--color-err)';
    case 'degraded':
      return 'var(--color-warn)';
    default:
      return 'var(--color-fg-subtle)';
  }
};

export const VersionBadge: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [versionData, setVersionData] = useState<VersionData | null>(null);
  const [fullData, setFullData] = useState<FullVersionData | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVersion = useCallback(async () => {
    try {
      const response = await fetch('/api/version/badge');
      if (response.ok) {
        const data = await response.json();
        setVersionData(data);
        setError(null);
      } else {
        setError('Failed to fetch version');
      }
    } catch {
      setError('Version unavailable');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchFullVersion = useCallback(async () => {
    try {
      const response = await fetch('/api/version/all');
      if (response.ok) {
        const data = await response.json();
        setFullData(data);
      }
    } catch {
      // silent — About panel will show whatever is in versionData
    }
  }, []);

  useEffect(() => {
    fetchVersion();
    const interval = setInterval(fetchVersion, 60000);
    return () => clearInterval(interval);
  }, [fetchVersion]);

  useEffect(() => {
    if (isExpanded && !fullData) {
      fetchFullVersion();
    }
  }, [isExpanded, fullData, fetchFullVersion]);

  const overallStatus = ((): 'online' | 'offline' | 'degraded' | 'unknown' => {
    if (!versionData?.services) return 'unknown';
    const statuses = Object.values(versionData.services);
    if (statuses.every((s) => s.status === 'online')) return 'online';
    if (statuses.some((s) => s.status === 'offline')) return 'degraded';
    return 'online';
  })();

  const pillStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 'var(--radius-full, 999px)',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-rule)',
    color: 'var(--color-fg-muted)',
    fontSize: 11,
    lineHeight: 1,
    cursor: 'pointer',
    transition: 'background 160ms ease',
  };

  if (isLoading) {
    return (
      <div className={className} style={pillStyle} aria-busy="true">
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 'var(--radius-full, 999px)',
            background: 'var(--color-fg-subtle)',
          }}
        />
        <span style={{ color: 'var(--color-fg-subtle)' }}>Loading…</span>
      </div>
    );
  }

  const fallbackVersion =
    import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_VERSION || 'dev';
  const version = versionData?.version ?? fallbackVersion;
  const environment =
    versionData?.environment === 'production' ? 'prod' : (versionData?.environment ?? 'dev');

  return (
    <div className={className} style={{ position: 'relative' }}>
      <motion.button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        style={pillStyle}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        aria-expanded={isExpanded}
        aria-label="Open About panel"
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: statusDot(overallStatus),
          }}
        />
        <span style={{ fontWeight: 500, color: 'var(--fg-1)' }}>v{version}</span>
        <span style={{ color: 'var(--fg-3)' }}>·</span>
        <span style={{ color: 'var(--color-fg-subtle)' }}>{environment}</span>
        {error && (
          <span
            title={error}
            style={{
              color: 'var(--color-warn)',
              marginLeft: 4,
              fontSize: 10,
            }}
          >
            offline
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {isExpanded && (
          <>
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 40,
              }}
              onClick={() => setIsExpanded(false)}
              aria-hidden
            />
            <motion.div
              role="dialog"
              aria-label="About OpenAgentic"
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'absolute',
                left: 0,
                bottom: 'calc(100% + 8px)',
                width: 340,
                background: 'var(--color-surface)',
                border: 'var(--border-w, 2px) solid var(--color-rule-strong)',
                borderRadius: 'var(--radius-card, 0px)',
                boxShadow: 'var(--shadow-card)',
                zIndex: 50,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '16px 16px 12px',
                  borderBottom: '1px solid var(--color-rule)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <CompanyLogo variant="full" width={180} height={32} />
                <div style={{ flex: 1 }} />
                <span
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    borderRadius: 999,
                    color: statusDot(overallStatus),
                    background: 'var(--bg-2)',
                    border: `1px solid ${statusDot(overallStatus)}40`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {overallStatus === 'online'
                    ? 'Operational'
                    : overallStatus === 'degraded'
                      ? 'Degraded'
                      : overallStatus === 'offline'
                        ? 'Outage'
                        : 'Unknown'}
                </span>
              </div>

              <div
                style={{
                  padding: '10px 16px 4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'var(--fg-2)',
                }}
              >
                <span>
                  Platform · <strong style={{ color: 'var(--fg-0)' }}>v{version}</strong>
                </span>
                <span>env: {environment}</span>
              </div>

              <div
                style={{
                  padding: '4px 16px 12px',
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    padding: '8px 0 6px',
                  }}
                >
                  Services
                </div>

                {fullData?.services?.length ? (
                  fullData.services.map((service) => {
                    const sha =
                      service.gitShortCommit || service.gitCommit || '';
                    const shaDisplay =
                      sha && sha !== 'unknown' && sha !== 'upstream'
                        ? sha.length > 8
                          ? sha.slice(0, 8)
                          : sha
                        : sha === 'upstream'
                          ? 'upstream'
                          : '';
                    return (
                      <div
                        key={service.name}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 0',
                          gap: 8,
                          fontSize: 12,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: statusDot(service.status),
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              color: 'var(--fg-1)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {service.name}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexShrink: 0,
                          }}
                        >
                          <span style={{ color: 'var(--fg-2)', fontSize: 11 }}>
                            v{service.version}
                          </span>
                          {shaDisplay && (
                            <code
                              title={service.gitCommit || sha}
                              style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'var(--bg-3)',
                                color: 'var(--fg-2)',
                                fontFamily: 'var(--font-mono, monospace)',
                              }}
                            >
                              {shaDisplay}
                            </code>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : versionData?.services ? (
                  Object.entries(versionData.services).map(([name, service]) => (
                    <div
                      key={name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 0',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: statusDot(service.status),
                          }}
                        />
                        <span style={{ color: 'var(--fg-1)' }}>{name}</span>
                      </div>
                      <span style={{ color: 'var(--fg-2)', fontSize: 11 }}>
                        v{service.version}
                      </span>
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: 11, color: 'var(--fg-3)', padding: '6px 0' }}>
                    Loading services…
                  </p>
                )}
              </div>

              {fullData?.platform && (
                <div
                  style={{
                    padding: '8px 16px',
                    background: 'var(--bg-2)',
                    borderTop: '1px solid var(--line-1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    color: 'var(--fg-3)',
                  }}
                >
                  <span>
                    Build{' '}
                    {fullData.platform.buildTime?.split('T')[0] || 'unknown'}
                  </span>
                  <span>
                    Commit{' '}
                    {fullData.platform.gitCommit?.slice(0, 7) || 'unknown'}
                  </span>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VersionBadge;
