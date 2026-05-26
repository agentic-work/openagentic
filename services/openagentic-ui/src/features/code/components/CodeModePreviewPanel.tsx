import React, { useCallback, useState } from 'react';

import { useActiveSessionId } from '@/stores/useCodeModeStore';

export interface CodeModePreviewPanelProps {
  port: number;
  /** Pod-local URL the daemon detected — shown as the muted address label. */
  displayUrl: string;
  framework: string;
  /**
   * Override the api path-proxy origin. Defaults to '' (same-origin),
   * which is what production uses. Tests pass an explicit value so the
   * iframe `src` becomes deterministic.
   */
  proxyOrigin?: string;
  /**
   * Override the active session id. Defaults to reading from
   * `useActiveSessionId()`. Tests inject a fixed id so they don't have
   * to seed the zustand store.
   */
  sessionIdOverride?: string;
  /** Optional iframe height (px). Default 220 — matches the mock. */
  height?: number;
}

/**
 * Build the proxy iframe URL. Pure helper so tests pin the contract
 * (`/api/code/preview/<sid>/<port>/` with optional cache-bust query).
 */
export function buildPreviewSrc(
  origin: string,
  sessionId: string,
  port: number,
  cacheBustToken?: number,
): string {
  const base = `${origin}/api/code/preview/${encodeURIComponent(sessionId)}/${port}/`;
  return cacheBustToken ? `${base}?_=${cacheBustToken}` : base;
}

const PANEL_HEIGHT_DEFAULT = 220;

export const CodeModePreviewPanel: React.FC<CodeModePreviewPanelProps> = ({
  port,
  displayUrl,
  framework,
  proxyOrigin = '',
  sessionIdOverride,
  height = PANEL_HEIGHT_DEFAULT,
}) => {
  const liveSessionId = useActiveSessionId();
  const sessionId = sessionIdOverride ?? liveSessionId ?? '';
  const [cacheBust, setCacheBust] = useState<number | undefined>(undefined);

  const src = sessionId ? buildPreviewSrc(proxyOrigin, sessionId, port, cacheBust) : '';

  const handleRefresh = useCallback(() => {
    setCacheBust(Date.now());
  }, []);

  const handleOpenInNewTab = useCallback(() => {
    if (!src) return;
    // Use the absolute URL so the new tab resolves against the api host
    // even if the iframe is embedded in a different origin in the future.
    const absolute = src.startsWith('http')
      ? src
      : new URL(src, window.location.origin).toString();
    window.open(absolute, '_blank', 'noopener,noreferrer');
  }, [src]);

  if (!sessionId) {
    // Defensive — never render the iframe without a session, the proxy
    // would 404 and produce a confusing error frame inside the panel.
    return null;
  }

  return (
    <div
      className="cm-preview"
      data-testid="cm-preview-panel"
      data-port={port}
      data-framework={framework}
      style={{
        marginTop: 8,
        border: '1px solid var(--cm-border, #30363d)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--cm-bg-secondary, #161b22)',
      }}
    >
      <div
        className="cm-preview-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--cm-border, #30363d)',
          fontFamily:
            'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
          fontSize: 12,
        }}
      >
        <span
          style={{
            color: 'var(--cm-success, #3fb950)',
            fontWeight: 600,
          }}
          aria-label="preview-header"
        >
          ⏵ PREVIEW
        </span>
        <span
          style={{
            color: 'var(--cm-text-muted, #8b949e)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
          title={displayUrl}
        >
          {displayUrl}
        </span>
        <span
          style={{
            color: 'var(--cm-text-muted, #8b949e)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            border: '1px solid var(--cm-border, #30363d)',
            padding: '0 6px',
            borderRadius: 4,
          }}
        >
          {framework}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Refresh preview"
          data-testid="cm-preview-refresh"
          style={iconButtonStyle}
        >
          ⟳
        </button>
        <button
          type="button"
          onClick={handleOpenInNewTab}
          aria-label="Open preview in new tab"
          data-testid="cm-preview-open-new-tab"
          style={iconButtonStyle}
        >
          ↗
        </button>
      </div>
      <iframe
        data-testid="cm-preview-iframe"
        src={src}
        title={`Preview: ${displayUrl}`}
        style={{
          width: '100%',
          height,
          border: 'none',
          display: 'block',
          background: '#fff',
        }}
        // Same-origin sandbox so dev-server JS can run + WS HMR works.
        // The proxy enforces auth at the api edge; the iframe doesn't
        // need additional sandbox restrictions beyond the defaults.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
};

const iconButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--cm-text-muted, #8b949e)',
  border: '1px solid var(--cm-border, #30363d)',
  borderRadius: 4,
  width: 22,
  height: 22,
  cursor: 'pointer',
  fontSize: 12,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export default CodeModePreviewPanel;
