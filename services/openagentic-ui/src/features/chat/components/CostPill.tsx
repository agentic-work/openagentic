/**
 * Phase F.4 — running cost pill.
 *
 * Renders a compact "$X.XX" badge next to the model badge on an assistant
 * message. During streaming it shows a `~$X.XX` estimate computed from
 * the accumulated output length + a local pricing table. Once the server
 * returns authoritative usage (tokens in/out), the pill switches to the
 * exact number without the tilde prefix.
 *
 * v0.6.7 chat-polish (fix 2/5): consume `runningCost` from cost_delta
 * events and pulse on each update. The wire layer writes the incremental
 * running total into this prop; here we drive a brief scale animation
 * plus a background flash on every change.
 */

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { estimateCost, formatCost } from '../utils/estimateCost';

export interface CostPillProps {
  /** Model id used for this response; best-effort family match */
  model?: string | null;
  /** Prompt text sent to the model (for input-side estimate). Optional. */
  inputText?: string | null;
  /** Assistant's response so far / full output */
  outputText?: string | null;
  /** Authoritative token usage from the server, if available */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  /**
   * v0.6.7 — running cost (USD) accumulated from server-emitted cost_delta
   * events during streaming. When this value changes, the pill pulses.
   * Overrides the local estimate while present. Ignored once `usage`
   * arrives (authoritative server cost takes precedence).
   */
  runningCost?: number | null;
  /** Show tilde and "live" feel while the message is still streaming */
  isStreaming?: boolean;
  /** Theme (reserved — uses CSS variables today) */
  theme?: 'light' | 'dark';
}

/**
 * Format a USD cost to 3 significant figures, capped at a reasonable
 * width. Always starts with "$" — callers add the "~" prefix.
 */
function formatRunningCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01) return `$${usd.toPrecision(3)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(0)}`;
}

const CostPillComponent: React.FC<CostPillProps> = ({
  model,
  inputText,
  outputText,
  usage,
  runningCost,
  isStreaming = false,
}) => {
  const hasAuthoritative =
    !!usage && (usage.promptTokens != null || usage.completionTokens != null);

  const { estimateDisplay, title, usdForPulse } = useMemo(() => {
    const estimate = estimateCost({
      model,
      inputText: inputText || undefined,
      outputText: outputText || undefined,
      inputTokens: usage?.promptTokens ?? undefined,
      outputTokens: usage?.completionTokens ?? undefined,
    });

    // Prefer server running cost during streaming, else local estimate
    const streamingUsd =
      !hasAuthoritative && runningCost != null && runningCost > 0
        ? runningCost
        : estimate.usd;

    const prefix = hasAuthoritative ? '' : '~';
    const displayUsd = hasAuthoritative ? estimate.usd : streamingUsd;
    const totalTokens =
      usage?.totalTokens ?? estimate.inputTokens + estimate.outputTokens;

    return {
      estimateDisplay: `${prefix}${hasAuthoritative ? formatCost(displayUsd) : formatRunningCost(displayUsd)}`,
      title: [
        estimate.label,
        hasAuthoritative ? 'exact billing' : 'estimate from text length',
        `input: ${estimate.inputTokens.toLocaleString()} tok`,
        `output: ${estimate.outputTokens.toLocaleString()} tok`,
        `total: ${totalTokens.toLocaleString()} tok`,
        runningCost != null && !hasAuthoritative
          ? `running cost: $${runningCost.toFixed(4)}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      usdForPulse: displayUsd,
    };
  }, [model, inputText, outputText, usage, runningCost, hasAuthoritative]);

  // Pulse on every runningCost change. We watch the numeric pulse value
  // and bump a key; framer-motion restarts its animation on key change.
  const [pulseKey, setPulseKey] = useState(0);
  const prevPulseRef = useRef<number>(usdForPulse);
  useEffect(() => {
    if (prevPulseRef.current !== usdForPulse) {
      prevPulseRef.current = usdForPulse;
      setPulseKey(k => k + 1);
    }
  }, [usdForPulse]);

  if (!estimateDisplay || estimateDisplay === '~$0.00') return null;

  return (
    <motion.span
      key={pulseKey}
      data-testid="cost-pill"
      data-running-cost={runningCost != null ? runningCost.toFixed(4) : undefined}
      data-pulse-key={pulseKey}
      title={title}
      aria-label={`Response cost ${estimateDisplay} (${title})`}
      // Task #166 — violet scale+flash pulse on each delta. Mockup spec:
      // accent-soft bg, accent-line border, violet live dot when streaming.
      animate={{
        scale: [1, 1.04, 1],
        backgroundColor: [
          'var(--accent-soft, rgba(139,92,246,0.14))',
          'rgba(139,92,246,0.28)',
          'var(--accent-soft, rgba(139,92,246,0.14))',
        ],
      }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        borderRadius: 99,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--fg-0, #f8fafc)',
        background: 'var(--accent-soft, color-mix(in srgb, var(--user-accent-primary) 14%, transparent))',
        border: '1px solid var(--accent-line, color-mix(in srgb, var(--user-accent-primary) 32%, transparent))',
        lineHeight: 1.4,
      }}
    >
      {isStreaming ? (
        <motion.span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent, var(--user-accent-primary))',
            flexShrink: 0,
          }}
          animate={{ opacity: [1, 0.4, 1], scale: [1, 1.15, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--ok, #22c55e)',
            flexShrink: 0,
          }}
        />
      )}
      {estimateDisplay}
    </motion.span>
  );
};

export const CostPill = memo(CostPillComponent);
CostPill.displayName = 'CostPill';
