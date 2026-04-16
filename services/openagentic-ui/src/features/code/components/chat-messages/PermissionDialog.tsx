/**
 * PermissionDialog — modal prompt for mid-turn tool approvals.
 *
 * Renders when useCodeModeChat.pendingPermission is non-null (i.e. an
 * openagentic control_request with subtype `can_use_tool` arrived on
 * the stream). The user picks allow/deny and the response is sent
 * back via POST /api/code/sessions/:id/chat/control — see
 * useCodeModeChat.respondToPermission.
 *
 * This is a generic, tool-agnostic dialog: it shows the tool name,
 * a one-line summary (via toolRenderers), and the full input JSON in
 * an expandable code block. Variant-specific UIs (FileWrite diff,
 * Bash command preview, WebFetch URL preview, …) are a future
 * refinement but fall back here cleanly in the meantime.
 *
 * Keyboard: A / Enter = allow, D / Escape = deny.
 *
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import React, { useEffect } from 'react';
import type { CanUseToolRequest } from '../../types/streamJson';
import { renderToolInputSummary } from './toolRenderers';

interface PermissionDialogProps {
  request: CanUseToolRequest & { request_id: string };
  onAllow: () => void;
  onDeny: () => void;
}

export const PermissionDialog: React.FC<PermissionDialogProps> = ({
  request,
  onAllow,
  onDeny,
}) => {
  const summary = renderToolInputSummary(request.tool_name, request.input);

  // Global key handler: A/Enter = allow, D/Escape = deny. Attached in
  // capture phase so the dialog sees keys even when another element
  // has focus. stopPropagation prevents the underlying textarea's
  // Esc handler from ALSO firing cancel() on the in-flight turn.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onDeny();
        return;
      }
      if (e.key === 'Enter' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onAllow();
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onAllow, onDeny]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Permission prompt"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        fontFamily:
          'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDeny();
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: '100%',
          backgroundColor: 'var(--cm-bg-secondary, #161b22)',
          color: 'var(--cm-text, #e6edf3)',
          border: '1px solid var(--cm-accent, #58a6ff)',
          borderRadius: 6,
          padding: '14px 16px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.6ch',
            fontSize: 12,
            color: 'var(--cm-text-muted, #8b949e)',
            marginBottom: 8,
          }}
        >
          <span style={{ color: 'var(--cm-warning, #d29922)' }}>⚠</span>
          <span>openagentic wants to use</span>
        </div>

        <div
          style={{
            fontSize: 15,
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.6ch',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: 'var(--cm-accent, #58a6ff)', fontWeight: 600 }}>
            {request.tool_name}
          </span>
          {summary && (
            <>
              <span style={{ color: 'var(--cm-text-muted, #8b949e)' }}>(</span>
              <span style={{ color: 'var(--cm-text, #e6edf3)' }}>{summary}</span>
              <span style={{ color: 'var(--cm-text-muted, #8b949e)' }}>)</span>
            </>
          )}
        </div>

        <pre
          style={{
            marginTop: 10,
            padding: '8px 10px',
            backgroundColor: 'var(--cm-bg, #0d1117)',
            border: '1px solid var(--cm-border, #30363d)',
            borderRadius: 4,
            maxHeight: 200,
            overflowY: 'auto',
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: 'var(--cm-text, #e6edf3)',
          }}
        >
          {JSON.stringify(request.input ?? {}, null, 2)}
        </pre>

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--cm-text-muted, #8b949e)',
              marginRight: 'auto',
            }}
          >
            <kbd>A</kbd>/<kbd>⏎</kbd> allow · <kbd>D</kbd>/<kbd>esc</kbd> deny
          </span>
          <button
            type="button"
            onClick={onDeny}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid var(--cm-error, #f85149)',
              color: 'var(--cm-error, #f85149)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12,
            }}
          >
            Deny
          </button>
          <button
            type="button"
            onClick={onAllow}
            autoFocus
            style={{
              padding: '6px 14px',
              background: 'var(--cm-accent, #58a6ff)',
              border: '1px solid var(--cm-accent, #58a6ff)',
              color: 'var(--cm-bg, #0d1117)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
};
