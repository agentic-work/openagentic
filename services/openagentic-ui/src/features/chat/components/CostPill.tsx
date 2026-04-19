/**
 * Phase F.4 — running cost pill.
 *
 * Renders a compact "$X.XX" badge next to the model badge on an assistant
 * message. During streaming it shows a `~$X.XX` estimate computed from
 * the accumulated output length + a local pricing table. Once the server
 * returns authoritative usage (tokens in/out), the pill switches to the
 * exact number without the tilde prefix.
 */

import React, { memo, useMemo } from 'react';
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
  /** Show tilde and "live" feel while the message is still streaming */
  isStreaming?: boolean;
  /** Theme (reserved — uses CSS variables today) */
  theme?: 'light' | 'dark';
}

const CostPillComponent: React.FC<CostPillProps> = ({
  model,
  inputText,
  outputText,
  usage,
  isStreaming = false,
}) => {
  const { display, title } = useMemo(() => {
    const hasAuthoritative =
      !!usage && (usage.promptTokens != null || usage.completionTokens != null);

    const estimate = estimateCost({
      model,
      inputText: inputText || undefined,
      outputText: outputText || undefined,
      inputTokens: usage?.promptTokens ?? undefined,
      outputTokens: usage?.completionTokens ?? undefined,
    });

    const prefix = hasAuthoritative ? '' : '~';
    const totalTokens =
      usage?.totalTokens ?? estimate.inputTokens + estimate.outputTokens;

    return {
      display: `${prefix}${formatCost(estimate.usd)}`,
      title: [
        estimate.label,
        hasAuthoritative ? 'exact billing' : 'estimate from text length',
        `input: ${estimate.inputTokens.toLocaleString()} tok`,
        `output: ${estimate.outputTokens.toLocaleString()} tok`,
        `total: ${totalTokens.toLocaleString()} tok`,
      ].join(' · '),
    };
  }, [model, inputText, outputText, usage]);

  if (!display || display === '~$0.00') return null;

  return (
    <span
      data-testid="cost-pill"
      title={title}
      aria-label={`Response cost ${display} (${title})`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 7px',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-muted)',
        background: 'color-mix(in srgb, var(--color-border) 20%, transparent)',
        border: '1px solid var(--color-border)',
        lineHeight: 1.4,
        opacity: isStreaming ? 0.75 : 1,
        transition: 'opacity 120ms ease',
      }}
    >
      {display}
    </span>
  );
};

export const CostPill = memo(CostPillComponent);
CostPill.displayName = 'CostPill';
