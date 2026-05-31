/**
 * CompanyLogo — the official `⌥ openagentic` brand mark.
 *
 * Sidebar header (chat / code / flows / admin), About panel, and the
 * version badge all consume this. `full`/`compact` render the shared
 * OpenAgenticWordmark (single source of truth — ⌥ glyph in signal
 * orange + cream/ink word in IBM Plex Mono, theme-adaptive). `icon`
 * renders just the ⌥ glyph on a warm tile for the collapsed rail.
 *
 * (Replaces the old purple→blue→amber gradient SVG and the violet "A"
 * square placeholder — both predated the warm field-guide identity.)
 */

import React from 'react';
import { OpenAgenticWordmark } from '@/shared/components/OpenAgenticWordmark';

/** macOS option-key glyph (U+2325) — the openagentic brand mark. */
const GLYPH = '⌥';

interface CompanyLogoProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  variant?: 'full' | 'compact' | 'icon';
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({
  className = '',
  width,
  height,
  variant = 'full',
}) => {
  if (variant === 'icon') {
    const h = Number(height ?? 28);
    return (
      <div
        className={className}
        aria-label="openagentic"
        style={{
          width: width ?? h,
          height: h,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          background: 'var(--surface-1, #211A11)',
          border: '1px solid rgba(255, 87, 34, 0.35)',
          color: 'var(--signal, #FF5722)',
          fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          fontWeight: 700,
          fontSize: Math.max(13, Math.floor(Number(h) * 0.62)),
          textShadow: '0 0 10px rgba(255, 87, 34, 0.4)',
          flexShrink: 0,
        }}
      >
        {GLYPH}
      </div>
    );
  }

  // full / compact → the shared ⌥ openagentic wordmark, sized from height.
  const h = Number(height ?? (variant === 'full' ? 38 : 28));
  const size = Math.max(14, Math.round(h * 0.58));

  return (
    <span
      className={className}
      aria-label="openagentic"
      style={{ display: 'inline-flex', alignItems: 'center', height: h }}
    >
      <OpenAgenticWordmark size={size} animate={false} />
    </span>
  );
};

export default CompanyLogo;
