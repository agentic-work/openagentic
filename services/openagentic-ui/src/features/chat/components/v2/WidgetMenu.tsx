/**
 * WidgetMenu — v2 ellipsis menu for compose_visual widgets.
 *
 * Pattern from Claude.ai's artifact card:
 *   Copy → Download → Expand → Open in new tab
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/artifacts
 *
 * Behavior:
 *   - Closed by default. Trigger button is a 3-dot icon, top-right of the
 *     widget. Click toggles the popover.
 *   - Copy writes the widget content (the SVG / HTML source) to the
 *     clipboard. Not the iframe srcdoc — users want the content itself.
 *   - Download saves a `<title>.<ext>` file via the standard Blob URL
 *     anchor trick. Extension matches kind (svg/html).
 *   - Expand calls the parent's onExpand handler — the parent owns the
 *     fullscreen modal lifecycle (already shipped in WidgetRenderer).
 *   - Open in new tab opens the iframe srcdoc as a Blob URL — the content
 *     is the same one the user is already seeing in the iframe.
 *   - Escape and click-outside close the menu.
 *
 * Accessibility: trigger has aria-label="More options"; the popover is
 * role="menu", items are role="menuitem". Keyboard-friendly without any
 * extra keyboard wiring beyond what role selectors provide.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface WidgetMenuProps {
  /** Widget kind drives filename extension. */
  kind: 'svg' | 'html' | 'reactflow_arch' | 'chart';
  /** Source content (SVG markup or HTML fragment). */
  content: string;
  /** Title used as the download filename stem. */
  title: string;
  /** Full iframe srcdoc — used by Open-in-new-tab. */
  srcdoc: string;
  /** Parent owns expand modal lifecycle. */
  onExpand: () => void;
  /**
   * Sprint B (2026-05-18) — optional Excel-export callback. When provided,
   * the menu renders a "Download as Excel" item beneath the standard
   * Download item; clicking it invokes this callback. Parent (typically
   * WidgetRenderer or ArtifactSlideOut) is responsible for POSTing to
   * /api/render/export-artifact with the artifact's structured data
   * payload and triggering a browser download via the standard Blob trick.
   * Absent for SVG/HTML widgets without exportable data — the item simply
   * doesn't appear.
   */
  onDownloadExcel?: () => void;
  className?: string;
}

const EXT_MAP: Partial<Record<WidgetMenuProps['kind'], string>> = {
  svg: 'svg',
  html: 'html',
};

const MIME_MAP: Partial<Record<WidgetMenuProps['kind'], string>> = {
  svg: 'image/svg+xml',
  html: 'text/html',
};

function safeFilename(stem: string, ext: string): string {
  const sanitized = (stem || 'artifact').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);
  return `${sanitized}.${ext}`;
}

function downloadBlob(content: string, mime: string, filename: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Don't append to DOM — modern browsers don't require it for click().
  a.click();
  // Best-effort cleanup; browsers also auto-revoke on navigation.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function openSrcdocInNewTab(srcdoc: string): void {
  if (!srcdoc) return;
  try {
    const blob = new Blob([srcdoc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    /* swallow — best-effort */
  }
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 3 3 3 3 9" />
      <polyline points="15 21 21 21 21 15" />
      <line x1="3" y1="3" x2="10" y2="10" />
      <line x1="21" y1="21" x2="14" y2="14" />
    </svg>
  );
}

function NewTabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

interface MenuItemProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function MenuItem({ label, icon, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 12px',
        border: 0,
        background: 'transparent',
        color: 'var(--fg-1, #d4d4d8)',
        fontSize: 12,
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          'var(--accent-soft, rgba(139,92,246,0.14))';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function WidgetMenu({
  kind,
  content,
  title,
  srcdoc,
  onExpand,
  onDownloadExcel,
  className,
}: WidgetMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => setOpen(false), []);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeMenu]);

  // Click-outside closes
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        triggerRef.current &&
        !triggerRef.current.contains(t)
      ) {
        closeMenu();
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open, closeMenu]);

  // For HTML artifacts, copy + download must emit the themed srcdoc so the
  // payload is self-contained (renders standalone outside the app). SVG /
  // mermaid kinds copy/download the raw `content` — SVG has its own viewport
  // and mermaid is plain text, so they don't need the iframe wrapper.
  const portablePayload = kind === 'html' && srcdoc ? srcdoc : content;

  const handleCopy = useCallback(async () => {
    closeMenu();
    try {
      await navigator.clipboard.writeText(portablePayload);
    } catch {
      /* clipboard API unavailable; swallow */
    }
  }, [portablePayload, closeMenu]);

  const handleDownload = useCallback(() => {
    closeMenu();
    const ext = EXT_MAP[kind] ?? 'txt';
    const mime = MIME_MAP[kind] ?? 'text/plain';
    downloadBlob(portablePayload, mime, safeFilename(title, ext));
  }, [portablePayload, kind, title, closeMenu]);

  const handleExpand = useCallback(() => {
    closeMenu();
    onExpand();
  }, [onExpand, closeMenu]);

  const handleNewTab = useCallback(() => {
    closeMenu();
    openSrcdocInNewTab(srcdoc);
  }, [srcdoc, closeMenu]);

  const handleDownloadExcel = useCallback(() => {
    closeMenu();
    onDownloadExcel?.();
  }, [onDownloadExcel, closeMenu]);

  return (
    <div
      className={['cm-widget-menu', className || ''].filter(Boolean).join(' ')}
      style={{ position: 'relative' }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 28,
          height: 28,
          display: 'inline-grid',
          placeItems: 'center',
          borderRadius: 6,
          border: '1px solid var(--line-2, rgba(255,255,255,0.10))',
          background: 'rgba(15,16,18,0.78)',
          color: 'var(--fg-1, #d4d4d8)',
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          padding: 0,
        }}
      >
        <MoreIcon />
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="Widget options"
          style={{
            position: 'absolute',
            top: 32,
            right: 0,
            minWidth: 180,
            padding: '4px 0',
            border: '1px solid var(--line-2, rgba(255,255,255,0.10))',
            borderRadius: 8,
            background: 'rgba(15,16,18,0.95)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(8px)',
            zIndex: 2,
          }}
        >
          <MenuItem label="Copy" icon={<CopyIcon />} onClick={handleCopy} />
          <MenuItem label="Download" icon={<DownloadIcon />} onClick={handleDownload} />
          {onDownloadExcel && (
            <MenuItem
              label="Download as Excel"
              icon={<DownloadIcon />}
              onClick={handleDownloadExcel}
            />
          )}
          <MenuItem label="Expand" icon={<ExpandIcon />} onClick={handleExpand} />
          <MenuItem label="Open in new tab" icon={<NewTabIcon />} onClick={handleNewTab} />
        </div>
      )}
    </div>
  );
}

export default WidgetMenu;
