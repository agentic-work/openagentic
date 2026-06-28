/**
 * ArtifactPane — split-pane artifact viewer (mocks 02, 03, 06, 07, 08, 09).
 *
 *   <aside class="cm-artifact-panel">
 *     <header class="cm-art-head">
 *       <span class="cm-tag">artifact</span>
 *       <span class="cm-title">{title}</span>
 *       <span class="cm-meta">· {meta}</span>
 *       <span class="cm-spacer" />
 *       <button class="cm-action" data-action="copy">copy</button>
 *       <button class="cm-action" data-action="export">export</button>
 *       <button class="cm-action" data-action="fullscreen">fullscreen</button>
 *       <button class="cm-action" data-action="close">×</button>
 *     </header>
 *     <div class="cm-art-tabs">             (multi-file only)
 *       <button class="cm-art-tab cm-active">{tab.label}</button>
 *       ...
 *     </div>
 *     <div class="cm-art-body">{children}</div>
 *   </aside>
 *
 * Replaces the legacy file-manager `ArtifactsPanel`. This primitive matches
 * the mock anatomy exactly; live wiring (selecting an artifact from
 * AgenticActivityStream → opening this pane) is a follow-up.
 */

import React from 'react';

export interface ArtifactPaneTab {
  id: string;
  label: string;
}

export interface ArtifactPaneProps {
  /** Headline title (typically the file name). */
  title: string;
  /** Short meta line — language / size / generated-at. Renders after a "·". */
  meta?: string;
  /** Multi-file artifact — when set, renders the tab row. */
  tabs?: ReadonlyArray<ArtifactPaneTab>;
  /** Active tab id. Required when `tabs` is set. */
  activeTabId?: string;
  /** Body content (markdown, csv preview, yaml, code, etc.). */
  children: React.ReactNode;
  /** Close button — required. Closes the pane. */
  onClose: () => void;
  /** Optional copy-contents action. Renders when supplied. */
  onCopy?: () => void;
  /** Optional download/export action. Renders when supplied. */
  onExport?: () => void;
  /** Optional full-screen action. Renders when supplied. */
  onFullscreen?: () => void;
  /** Tab change callback. Required when `tabs` is set. */
  onTabChange?: (tabId: string) => void;
  /** Override aria-label on the aside. */
  ariaLabel?: string;
}

const CopyIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const ExportIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const FullscreenIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);
const CloseIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export function ArtifactPane({
  title,
  meta,
  tabs,
  activeTabId,
  children,
  onClose,
  onCopy,
  onExport,
  onFullscreen,
  onTabChange,
  ariaLabel,
}: ArtifactPaneProps) {
  return (
    <aside
      className="cm-artifact-panel"
      aria-label={ariaLabel ?? `Artifact: ${title}`}
      data-testid="artifact-pane"
    >
      <header className="cm-art-head">
        <span className="cm-tag">artifact</span>
        <span className="cm-title">{title}</span>
        {meta && <span className="cm-meta">· {meta}</span>}
        <span className="cm-spacer" />
        {onCopy && (
          <button className="cm-action" data-action="copy" onClick={onCopy} aria-label="Copy contents">
            {CopyIcon}<span>copy</span>
          </button>
        )}
        {onExport && (
          <button className="cm-action" data-action="export" onClick={onExport} aria-label="Download / export">
            {ExportIcon}<span>export</span>
          </button>
        )}
        {onFullscreen && (
          <button className="cm-action" data-action="fullscreen" onClick={onFullscreen} aria-label="Full screen">
            {FullscreenIcon}
          </button>
        )}
        <button className="cm-action" data-action="close" onClick={onClose} aria-label="Close panel">
          {CloseIcon}
        </button>
      </header>
      {tabs && tabs.length > 0 && (
        <div className="cm-art-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`cm-art-tab${t.id === activeTabId ? ' cm-active' : ''}`}
              role="tab"
              aria-selected={t.id === activeTabId}
              onClick={() => onTabChange?.(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="cm-art-body">{children}</div>
    </aside>
  );
}
