import React from 'react';

/**
 * CitationChip — small numbered superscript chip rendered inline within
 * prose to point at a source. Mock 01 reference:
 * `mocks/UX/01-cloud-ops.html` lines 1139, 1168
 * (`<span class="citation" role="link" aria-label="Citation: ...">N</span>`).
 *
 * v2 chatmode primitive (#502). Inline styles to dodge stylesheet
 * collisions during the parallel rebuild.
 */

export interface CitationChipProps {
  /** 1-based citation index (1, 2, 3...). */
  index: number;
  /** Title/source describing the citation (used as ARIA label + tooltip). */
  source: string;
  /** Click handler — typically scrolls to / opens the citation source. */
  onClick?: () => void;
  className?: string;
}

export const CITATION_CHIP_STYLES: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  padding: 0,
  marginLeft: '2px',
  borderRadius: '50%',
  background: 'var(--accent-soft, rgba(139,92,246,0.14))',
  color: 'var(--accent, #8b5cf6)',
  border: '1px solid var(--accent-line, rgba(139,92,246,0.32))',
  fontSize: '10px',
  fontWeight: 600,
  fontFamily: 'JetBrains Mono, monospace',
  cursor: 'pointer',
  verticalAlign: 'super',
  lineHeight: 1,
};

export function CitationChip({
  index,
  source,
  onClick,
  className,
}: CitationChipProps): JSX.Element {
  const cls = ['cm-citation', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={`Citation: ${source}`}
      title={source}
      onClick={onClick}
      style={CITATION_CHIP_STYLES}
    >
      {index}
    </button>
  );
}
