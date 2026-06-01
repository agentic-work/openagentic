import React from 'react';
import { motion } from 'framer-motion';

/**
 * Per-character color palette for the legacy `[openagentic]` rainbow-chord
 * wordmark. 11 chars → 11 entries; first and last hues match (`#ff5ea8`) so
 * it "loops" visually. theme-allow: this is a categorical decorative chord
 * palette for the SUPERSEDED enterprise mark (the active brand mark is the
 * warm OpenAgenticWordmark in OpenAgenticWordmark.tsx); kept for the existing
 * unit test only and not rendered in the app.
 */
export const OPENAGENTIC_CHAR_COLORS: readonly string[] = [
  '#ff5ea8',
  '#ff8c42',
  '#ffc43f',
  '#c3ed4a',
  '#5fdd82',
  '#3fd0d4',
  '#58a6ff',
  '#7c7cff',
  '#b25cff',
  '#ff6fd1',
  '#ff5ea8',
];

const WORD = 'openagentic';

export interface OpenAgenticWordmarkProps {
  /** Font size in px. Default: 18. */
  size?: number;
  /** When true, animates each char in with a stagger; when false, renders static. Default: true. */
  animate?: boolean;
  /** Optional className. */
  className?: string;
  /** Optional inline style override. */
  style?: React.CSSProperties;
}

/**
 * Renders `[openagentic]` as a per-character color chord with
 * dimmed bracket wrappers. See file-level doc for the contract.
 */
export const OpenAgenticWordmark: React.FC<OpenAgenticWordmarkProps> = ({
  size = 18,
  animate = true,
  className,
  style,
}) => {
  const MONO = 'var(--font-mono)';
  const DIM = 'var(--color-fg-subtle)';

  const rootStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: size,
    lineHeight: 1,
    letterSpacing: '0.02em',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'baseline',
    whiteSpace: 'nowrap',
    ...style,
  };

  const bracketStyle: React.CSSProperties = {
    color: DIM,
    fontWeight: 600,
  };

  return (
    <span className={className} style={rootStyle}>
      <span style={bracketStyle}>[</span>
      <span style={{ padding: '0 2px' }}>
        {WORD.split('').map((ch, i) => {
          const color = OPENAGENTIC_CHAR_COLORS[i % OPENAGENTIC_CHAR_COLORS.length];
          const charStyle: React.CSSProperties = {
            color,
            textShadow: `0 0 6px ${color}55`,
          };
          if (animate) {
            return (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: i * 0.06, ease: 'easeOut' }}
                style={charStyle}
              >
                {ch}
              </motion.span>
            );
          }
          return (
            <span key={i} style={charStyle}>
              {ch}
            </span>
          );
        })}
      </span>
      <span style={bracketStyle}>]</span>
    </span>
  );
};

export default OpenAgenticWordmark;
