/**
 * ToolCallGroup — parallel fan-out wrapper, v2 mock-canonical.
 *
 * Mock anatomy (mocks/UX/01-cloud-ops.html lines 900-905):
 *   .tool-parallel-hdr   ← "Parallel fan-out · N concurrent calls"
 *   .tool-parallel       ← grid container (1fr 1fr)
 *     .tool              ← v2/ToolCard per cell
 *
 * This component is the group-level chrome (header + grid layout). Each
 * grid cell defers to v2/ToolCard so there is exactly one tool-card
 * renderer in the chatmode UI.
 *
 * Replaces 640 LOC of bespoke chrome (this file + ExpandableToolItem)
 * with ~150 LOC of group-level layout that delegates everything else.
 */

import React, { memo, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from '@/shared/icons';
import type { ContentBlock, ToolCall } from '../AgenticActivityStream/types/activity.types';
import { humanizeToolName } from '../../utils/toolNameHumanizer';
import { ToolCard, type ToolStatus } from '../v2';

function detectErrorInOutput(output: unknown): boolean {
  if (!output) return false;
  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>;
    if (obj.error || obj.isError || obj.success === false) return true;
  }
  if (typeof output === 'string') {
    return /^(error:|Error:|\{"error":)/i.test(output.trim());
  }
  return false;
}

const fmtDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const rem = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m ${rem}s`;
};

export interface ToolCallGroupProps {
  /** All blocks sharing the same toolCallRound (enforced by caller). */
  blocks: ContentBlock[];
  toolCalls?: ToolCall[];
  theme?: 'light' | 'dark';
  isStreaming?: boolean;
  isHistorical?: boolean;
  /** Stable session-scoped id for sessionStorage expand-state persistence. */
  clusterKey?: string;
}

const SESSION_STORAGE_PREFIX = 'cm.toolCluster.';

const readStoredExpand = (key: string | undefined): boolean | null => {
  if (!key || typeof window === 'undefined') return null;
  try {
    const v = window.sessionStorage.getItem(SESSION_STORAGE_PREFIX + key);
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch {
    return null;
  }
};

const writeStoredExpand = (key: string | undefined, expanded: boolean): void => {
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_PREFIX + key, expanded ? '1' : '0');
  } catch {
    /* swallow quota / disabled-storage */
  }
};

const ToolCallGroupComponent: React.FC<ToolCallGroupProps> = ({
  blocks,
  toolCalls = [],
  theme = 'dark',
  isStreaming,
  isHistorical = false,
  clusterKey,
}) => {
  const allComplete = useMemo(() => blocks.every((b) => b.isComplete), [blocks]);
  const isCluster = blocks.length >= 2;
  const stored = useMemo(() => readStoredExpand(clusterKey), [clusterKey]);
  // Stream ≡ final-render invariant (CLAUDE.md rule 8a + user direction
  // 2026-05-17 PM: "stream and finished result have to be EXACTLY THE
  // SAME"). Default to expanded so children stay visible at all times —
  // no flip from "individual cards" → "cluster summary" when the 2nd
  // tool arrives mid-stream, no flip from streaming → finalize.
  // User's manual click-to-collapse persists via sessionStorage (stored).
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    if (stored !== null) return stored;
    return true;
  });

  const errorCount = useMemo(
    () =>
      blocks.filter((b) => {
        const tc = toolCalls.find((t) => t.id === b.toolId);
        return b.error || detectErrorInOutput(tc?.output);
      }).length,
    [blocks, toolCalls]
  );

  const totalDuration = useMemo(
    () =>
      blocks.reduce((sum, b) => {
        const tc = toolCalls.find((t) => t.id === b.toolId);
        return sum + (tc?.duration ?? b.duration ?? 0);
      }, 0),
    [blocks, toolCalls]
  );

  const runningCount = blocks.filter((b) => !b.isComplete).length;

  const sortedBlocks = useMemo(() => {
    return [...blocks].sort((a, b) => {
      const ai = a.parallelSlotIndex ?? Number.MAX_SAFE_INTEGER;
      const bi = b.parallelSlotIndex ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.id.localeCompare(b.id);
    });
  }, [blocks]);

  const toolNamesPreview = useMemo(() => {
    const names = blocks.map((b) => {
      const tc = toolCalls.find((t) => t.id === b.toolId);
      const raw = b.toolName || tc?.toolName || 'tool';
      return humanizeToolName(raw).label;
    });
    if (names.length === 0) return { head: '', extra: 0 };
    if (names.length <= 2) return { head: names.join(', '), extra: 0 };
    return { head: names.slice(0, 2).join(', '), extra: names.length - 2 };
  }, [blocks, toolCalls]);

  const headerLabel = allComplete
    ? errorCount > 0
      ? `${blocks.length} tools completed (${blocks.length - errorCount} succeeded, ${errorCount} failed)`
      : `${blocks.length} tools completed`
    : `Running ${blocks.length} tools · ${runningCount} in flight`;

  const toggleExpanded = (): void => {
    setIsExpanded((prev) => {
      const next = !prev;
      writeStoredExpand(clusterKey, next);
      return next;
    });
  };

  // #873 (2026-05-15) — Rule 8(b): canonical theme tokens, no hex fallbacks.
  // Previously `var(--color-error, #ef4444)` — the hex second-arg leaked
  // through any time the legacy --color-error var was unset (e.g. theme
  // changes mid-session). Use --cm-* canonical tokens directly.
  const headerIcon = allComplete ? (
    errorCount > 0 ? (
      <XCircle size={14} style={{ color: 'var(--cm-err)' }} />
    ) : (
      <CheckCircle2 size={14} style={{ color: 'var(--cm-ok)' }} />
    )
  ) : (
    <Loader2
      size={14}
      style={{
        color: 'var(--accent)',
        animation: 'spin 1s linear infinite',
      }}
    />
  );

  return (
    <div
      data-testid={isCluster ? 'tool-cluster' : 'parallel-tool-group'}
      data-tool-call-round={blocks[0]?.toolCallRound ?? undefined}
      data-tool-count={blocks.length}
      data-all-complete={allComplete}
      data-theme={theme}
      style={{ marginBottom: 8 }}
    >
      {blocks.length > 1 && (
        <div
          data-testid="parallel-tool-group-header"
          className="cm-tool-parallel-hdr"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--fg-2, var(--color-text-muted))',
            margin: '6px 0 4px',
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            style={{ color: 'var(--accent, var(--color-primary))' }}
            aria-hidden
          >
            <path d="M12 3v18M5 12h14M7 5l10 14M17 5L7 19" />
          </svg>
          Parallel fan-out · {blocks.length} concurrent calls
        </div>
      )}

      <button
        type="button"
        data-testid={isCluster ? 'tool-cluster-header' : undefined}
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {headerIcon}
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
          }}
        >
          {headerLabel}
        </span>
        {isCluster && toolNamesPreview.head && (
          <span
            data-testid="tool-cluster-names"
            style={{
              fontSize: 12,
              color: 'var(--cm-fg-2, var(--color-text-muted))',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 380,
            }}
          >
            {toolNamesPreview.head}
            {toolNamesPreview.extra > 0 ? ` +${toolNamesPreview.extra} more` : ''}
          </span>
        )}
        {totalDuration > 0 && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ({fmtDuration(totalDuration)})
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>

      {isExpanded && (
        <div
          data-testid="parallel-tool-group-grid"
          className="cm-v2 cm-tool-parallel"
          style={{
            display: 'grid',
            gridTemplateColumns: blocks.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
            paddingTop: 4,
          }}
        >
          {sortedBlocks.map((block) => {
            const toolCall = toolCalls.find((t) => t.id === block.toolId);
            const isRunning = !block.isComplete && isStreaming !== false;
            const hasError = block.isComplete
              ? !!(block.error || detectErrorInOutput(toolCall?.output))
              : false;
            const status: ToolStatus = isRunning ? 'running' : hasError ? 'err' : 'ok';

            const lookMissing = (n?: string | null) =>
              !n || n === 'Tool' || n === 'tool' || n === 'unknown' || n === 'Unknown Tool';
            const toolName = lookMissing(block.toolName)
              ? lookMissing(toolCall?.toolName)
                ? (block.toolId
                    ? `call-${String(block.toolId).slice(-6)}`
                    : 'tool-call')
                : toolCall!.toolName!
              : block.toolName!;
            const humanized = humanizeToolName(toolName);

            const duration = toolCall?.duration ?? block.duration;
            const durationLabel =
              duration && duration > 0 ? fmtDuration(duration) : undefined;

            const errorMessage =
              status === 'err'
                ? typeof block.error === 'string'
                  ? block.error
                  : 'Tool execution failed.'
                : undefined;

            return (
              <div
                key={block.id}
                data-testid={isCluster ? 'tool-card' : 'parallel-tool-subcard'}
                data-tool-name={toolName}
                data-tool-status={status}
                data-status={status}
                data-slot={block.parallelSlotIndex ?? -1}
              >
                <ToolCard
                  name={humanized.label}
                  status={status}
                  durationLabel={durationLabel}
                  input={toolCall?.input ?? block.input}
                  result={toolCall?.output}
                  errorMessage={errorMessage}
                  outputTemplate={
                    // Audit L1-2 / Phase A3 — pass FrameRendererRegistry
                    // slug through when the wire tool_result carries it
                    // (useChatStream.ts stamps onto the ContentBlock).
                    (block as { outputTemplate?: string }).outputTemplate
                  }
                />
                <span
                  data-testid="parallel-tool-timer"
                  style={{ display: 'none' }}
                  aria-hidden
                >
                  {status === 'running' ? 'Running' : durationLabel || ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const ToolCallGroup = memo(ToolCallGroupComponent);
ToolCallGroup.displayName = 'ToolCallGroup';
