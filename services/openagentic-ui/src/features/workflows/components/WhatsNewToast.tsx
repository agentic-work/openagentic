/**
 * WhatsNewToast — first-load discoverability for 0.7.0.
 *
 * Surfaces the marquee features that are visible/runtime-conditional
 * but easy to miss. Dismissal is per-browser, version-keyed: if the
 * user dismisses 0.7.0 and we ship 0.7.1 with new highlights, bumping
 * the `version` prop re-shows the card.
 *
 * Defensive: any localStorage exception (private mode, sandbox) →
 * we bail out silently and never render. The toast is purely
 * informational — it MUST NOT block the workspace if storage breaks.
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'openagentic.workflow.whatsNew.dismissed';

const FEATURES_070: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  { id: 'swarm-popover',  label: 'Multi-agent swarm popover', hint: 'Live agent cards on canvas during multi_agent runs' },
  { id: 'secrets-wizard', label: 'Missing-secrets wizard',    hint: 'Auto-collect {{secret:NAME}} values on Run' },
  { id: 'model-picker',   label: 'Per-slot model picker',     hint: 'Pick a model per multi_agent slot in the inspector' },
  { id: 'nav-rail',       label: '9-section nav rail',         hint: 'Workspace nav rail to the left of the sidebar' },
  { id: 'signed-traces',  label: 'Signed run traces',          hint: 'Every workflow run produces an HMAC-SHA256 signature' },
];

export interface WhatsNewToastProps {
  version: string;
  onSelectFeature?: (id: string) => void;
}

function readDismissed(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Defensive — caller treats this as "we couldn't read so don't render".
    // We surface a sentinel that the component recognizes and short-circuits on.
    return '__storage_unavailable__';
  }
}

function writeDismissed(version: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, version);
  } catch {
    /* swallow — best-effort */
  }
}

export const WhatsNewToast: React.FC<WhatsNewToastProps> = ({ version, onSelectFeature }) => {
  const initialDismissed = readDismissed();
  const [hidden, setHidden] = useState<boolean>(
    initialDismissed === '__storage_unavailable__' || initialDismissed === version,
  );

  if (hidden) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="alert"
      aria-live="polite"
      // Terminal Glass: frosted toast over the workspace via the .glass class
      // (background var(--glass-bg) + blur + soft border/shadow + top-edge
      // highlight). Was an opaque #161b22 card. Only layout + text set inline.
      className="glass"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 9999,
        width: 360,
        padding: 16,
        color: 'var(--color-text)',
        fontSize: 13,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--user-accent-primary, #FF5722)' }}>
            Flows {version}
          </div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>What's new</h3>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            writeDismissed(version);
            setHidden(true);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-tertiary)',
            fontSize: 16,
            cursor: 'pointer',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {FEATURES_070.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              data-feature={f.id}
              onClick={() => onSelectFeature?.(f.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: 6,
                color: 'inherit',
                cursor: onSelectFeature ? 'pointer' : 'default',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <span style={{ fontWeight: 600 }}>{f.label}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {f.hint}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
};
