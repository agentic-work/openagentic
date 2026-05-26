/**
 * UnknownVizFallback — Sprint Z.7
 *
 * Visible error chrome rendered when FrameRendererRegistry receives a
 * named outputTemplate slug that has no registered component. Shows a
 * small amber warning pill "unknown viz: <slug>" so the user knows
 * something didn't render rather than silently getting empty output.
 *
 * Styled with --cm-warn tokens to stay theme-aware.
 */

import React from 'react';

export function UnknownVizFallback({ slug }: { slug?: string }) {
  const label = slug ?? 'unknown';
  return (
    <div
      data-testid="unknown-viz-fallback"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 4,
        border: '1px solid color-mix(in srgb, var(--cm-warning) 40%, transparent)',
        background: 'color-mix(in srgb, var(--cm-warning) 8%, transparent)',
        color: 'var(--cm-warning)',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
        margin: '4px 0',
      }}
      aria-label={`unknown viz: ${label}`}
    >
      ⚠ {`unknown viz: ${label}`}
    </div>
  );
}
UnknownVizFallback.displayName = 'UnknownVizFallback';
