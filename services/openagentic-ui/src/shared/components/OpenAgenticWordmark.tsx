import React from 'react';
import { motion } from 'framer-motion';

const WORD = 'openagentic';
/** macOS option-key glyph (U+2325) — the openagentic brand mark. */
const GLYPH = '⌥';

export interface OpenAgenticWordmarkProps {
  /** Font size in px. Default: 18. */
  size?: number;
  /** When true, animates the glyph + each char in with a stagger; static otherwise. Default: true. */
  animate?: boolean;
  /** Optional className. */
  className?: string;
  /** Optional inline style override. */
  style?: React.CSSProperties;
}

/**
 * OpenAgenticWordmark — the `⌥ openagentic` brand mark.
 *
 * The macOS option-key glyph (⌥) in signal orange + the lowercase
 * wordmark in cream/ink, set in IBM Plex Mono — the warm field-guide
 * identity (matches the login + openagentics.io). Theme-adaptive: cream
 * on dark, ink on light, via `--color-text`. `animate` opt-in does a
 * per-character stagger fade-in (glyph first). Distinct from the
 * enterprise AgenticWork mark.
 */
export const OpenAgenticWordmark: React.FC<OpenAgenticWordmarkProps> = ({
  size = 18,
  animate = true,
  className,
  style,
}) => {
  const MONO =
    "'IBM Plex Mono', var(--cm-mono-font, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)";
  const SIGNAL = 'var(--signal, #FF5722)';
  const INK = 'var(--color-text, var(--cm-text, #F4EFE6))';

  const rootStyle: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: size,
    lineHeight: 1,
    letterSpacing: '-0.01em',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'baseline',
    whiteSpace: 'nowrap',
    ...style,
  };

  const glyphStyle: React.CSSProperties = {
    color: SIGNAL,
    fontWeight: 700,
    marginRight: '0.12em',
    textShadow: '0 0 10px rgba(255, 87, 34, 0.35)',
  };

  if (!animate) {
    return (
      <span className={className} style={rootStyle}>
        <span style={glyphStyle}>{GLYPH}</span>
        <span> </span>
        <span style={{ color: INK }}>{WORD}</span>
      </span>
    );
  }

  return (
    <span className={className} style={rootStyle}>
      <motion.span
        style={glyphStyle}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
      >
        {GLYPH}
      </motion.span>
      <span> </span>
      <span style={{ color: INK }}>
        {WORD.split('').map((ch, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.08 + i * 0.05, ease: 'easeOut' }}
          >
            {ch}
          </motion.span>
        ))}
      </span>
    </span>
  );
};

export default OpenAgenticWordmark;
