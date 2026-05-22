/**
 * Inline Thinking Block Component
 * Displays LLM thinking blocks in a clean, natural-flowing UI.
 *
 * Track B Phase 5 of the canonical streaming rip (2026-05-22): the boxed
 * variant was deleted so live ≡ settled ≡ reload DOM. The only renderer
 * shape is the natural `<div class="cm-thinking inline-thinking-natural">`.
 *
 * v0.6.7 chat-polish: collapsed-by-default accordion with live header
 *   Header reads "Thinking..." while streaming, then
 *   "Thought for X.Xs · ~N tokens" once complete. Duration pill pulses
 *   during streaming. Token count is estimated from content length ÷ 4
 *   when an explicit count isn't provided.
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from '@/shared/icons';

/**
 * Task #166 — violet starburst glyph matching the mockup
 * (docs/release-plans/v0.6.7-ux-mockups/01-cloud-ops.html .thinking .ico).
 * When streaming, a thin violet ring spins around the starburst;
 * when idle, the glyph is static violet.
 */
const ThinkingStarburst: React.FC<{ size?: number; animate?: boolean; className?: string }> = ({
  size = 12,
  animate = true,
  className,
}) => (
  <span
    aria-hidden
    className={className}
    style={{
      position: 'relative',
      display: 'inline-flex',
      width: size,
      height: size,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      style={{
        color: 'var(--accent, #8b5cf6)',
        flexShrink: 0,
      }}
    >
      <path d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2z" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </svg>
    {animate && (
      <span
        style={{
          position: 'absolute',
          inset: -2,
          borderRadius: '50%',
          border: '1px solid var(--accent-line, rgba(139,92,246,0.32))',
          borderTopColor: 'var(--accent, #8b5cf6)',
          animation: 'spin 1.2s linear infinite',
        }}
      />
    )}
  </span>
);
interface InlineThinkingBlockProps {
  content: string;
  isExpanded?: boolean;
  onToggle?: () => void;
  isStreaming?: boolean;
  /** ms epoch when this thinking block began streaming. Falsy = now on first delta. */
  startedAt?: number;
  /** ms epoch when this thinking block stopped. Falsy while streaming. */
  endedAt?: number;
  /** Optional authoritative token count. If absent, estimated as ceil(chars/4). */
  tokenCount?: number;
}

/** Format a millisecond duration as "1.2s" / "45s" / "2m 03s". */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.0s';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000)
    .toString()
    .padStart(2, '0');
  return `${minutes}m ${seconds}s`;
}

export const InlineThinkingBlock: React.FC<InlineThinkingBlockProps> = ({
  content,
  isExpanded: externalIsExpanded,
  onToggle: externalOnToggle,
  isStreaming = false,
  startedAt,
  endedAt,
  tokenCount,
}) => {
  // v0.6.7: default COLLAPSED (was open). Users can expand on click.
  const [internalIsExpanded, setInternalIsExpanded] = useState(false);

  // Use external state if provided, otherwise use internal state
  const isExpanded = externalIsExpanded !== undefined ? externalIsExpanded : internalIsExpanded;
  const handleToggle = externalOnToggle || (() => setInternalIsExpanded(!internalIsExpanded));

  // Track a monotonic "streaming started at" so we can compute live elapsed
  // without blinking if the parent forgets to pass startedAt. If the first
  // render happens mid-stream, we anchor to Date.now() and update on tick.
  const anchoredStartRef = useRef<number | null>(startedAt ?? null);
  if (anchoredStartRef.current === null && isStreaming) {
    anchoredStartRef.current = Date.now();
  }

  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  const effectiveStart = startedAt ?? anchoredStartRef.current ?? nowTick;
  const effectiveEnd = endedAt ?? (isStreaming ? nowTick : undefined);
  const elapsedMs =
    effectiveEnd !== undefined && effectiveStart !== undefined
      ? Math.max(0, effectiveEnd - effectiveStart)
      : 0;

  // Rough token estimate: ~4 chars/token. Prefer an explicit count if given.
  const estimatedTokens =
    tokenCount ?? Math.max(0, Math.ceil((content?.length ?? 0) / 4));

  // #848 (2026-05-14) — when duration is missing (persisted block with no
  // stamped duration, or close path that didn't get a timestamp), elapsedMs
  // is 0 and the header reads "Thought · 0.0s · ~N tok" — visibly broken.
  // Hide the duration segment entirely in that case; show just the token
  // estimate. Regression of #319; root cause is upstream (duration not
  // persisted on completed messages), but the user-visible "0.0s" is the
  // symptom to remove.
  const headerText = isStreaming
    ? 'Thinking'
    : elapsedMs > 0
      ? `Thought · ${formatElapsed(elapsedMs)} · ~${estimatedTokens} tok`
      : `Thought · ~${estimatedTokens} tok`;

  // First-line preview from the thinking content. Cleaned of markdown bullets
  // and clamped to ~80 chars so the header reads as one sentence in chat.
  const firstLinePreview = (() => {
    const raw = (content || '').split('\n').find(l => l.trim().length > 0) || '';
    const cleaned = raw.trim().replace(/^[#>\-*\s]+/, '').replace(/\s+/g, ' ');
    return cleaned.length > 80 ? cleaned.slice(0, 78).trimEnd() + '…' : cleaned;
  })();

  // Natural (non-boxed) variant - clean, inline display.
  // Track B Phase 5: this is the ONLY rendering shape — boxed branch deleted
  // so live ≡ settled ≡ reload DOM.
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="cm-thinking inline-thinking-natural"
        aria-expanded={isExpanded}
        data-testid="inline-thinking-block"
        data-streaming={isStreaming ? 'true' : 'false'}
        data-expanded={isExpanded ? 'true' : 'false'}
        style={{
          marginBottom: '8px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header - minimal, clickable. While collapsed, the first line of
            the thinking content peeks in next to the timing label, with the
            chevron at the right edge so the line reads as one composed
            "Thought · 1.2s · ~54 tok · {first line of reasoning}" header. */}
        <button
          onClick={handleToggle}
          aria-expanded={isExpanded}
          data-testid="inline-thinking-toggle"
          className="cm-head"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 0',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            color: 'var(--fg-2, var(--color-textMuted))',
            width: '100%',
            maxWidth: '100%',
          }}
        >
          <ThinkingStarburst size={12} animate={isStreaming} className="cm-ico" />
          <motion.span
            animate={
              isStreaming
                ? { opacity: [0.6, 1, 0.6] }
                : { opacity: 1 }
            }
            transition={
              isStreaming
                ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0 }
            }
            className="cm-label"
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--fg-1, var(--color-textSecondary))',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
            data-testid="inline-thinking-header"
          >
            {headerText}
          </motion.span>
          {firstLinePreview && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 400,
                color: 'var(--color-textMuted)',
                fontStyle: 'italic',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '60ch',
                opacity: isExpanded ? 0.55 : 1,
                transition: 'opacity 150ms',
              }}
              title={firstLinePreview}
              data-testid="inline-thinking-preview"
            >
              · {firstLinePreview}
            </span>
          )}
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="cm-chev"
            style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 'auto' }}
          >
            <ChevronDown size={14} />
          </motion.span>
        </button>

        {/* Collapsible content - flows naturally */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="cm-body"
              style={{ overflow: 'hidden' }}
              data-testid="inline-thinking-body"
            >
              <div style={{
                paddingLeft: '12px',
                paddingTop: '6px',
                paddingBottom: '10px',
                fontSize: '13px',
                color: 'var(--fg-2, var(--color-textSecondary))',
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.6',
                borderLeft: '1.5px solid var(--accent-line, rgba(139,92,246,0.32))',
                marginLeft: '6px',
              }}>
                {content}
                {isStreaming && (
                  <motion.span
                    className="inline-block w-1.5 h-3.5 bg-[var(--color-primary)] rounded-sm ml-1"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    style={{ verticalAlign: 'text-bottom' }}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
};

export default InlineThinkingBlock;
