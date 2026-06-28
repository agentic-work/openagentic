/**
 * Phase G (task #152) — `memory_status` event renderer.
 *
 * Inline status line for user memory lookup. Mirrors the rag status
 * line but with a brain/memory icon and amber tint while running.
 */
import React, { memo } from 'react';
import { ensurePhaseGKeyframes } from './useKeyframes';

export interface MemoryStatusLineProps {
  status?: string | null;
  contextInjected?: boolean | null;
  tokenEstimate?: number | null;
  processingTime?: number | null;
  memoriesFound?: number | null;
}

const BrainIcon = ({ spinning }: { spinning: boolean }) => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
    style={{
      animation: spinning ? 'ragSpin 1.2s linear infinite' : undefined,
    }}
  >
    <path d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2z" />
  </svg>
);

const MemoryStatusLineComponent: React.FC<MemoryStatusLineProps> = ({
  status,
  contextInjected,
  tokenEstimate,
  processingTime,
  memoriesFound,
}) => {
  ensurePhaseGKeyframes();
  const done =
    status === 'complete' ||
    contextInjected === true ||
    contextInjected === false ||
    typeof memoriesFound === 'number';

  const foundCount =
    typeof memoriesFound === 'number'
      ? memoriesFound
      : contextInjected
        ? 1
        : contextInjected === false
          ? 0
          : null;

  const label = done
    ? foundCount === 0
      ? 'No relevant memories'
      : `Found ${foundCount === 1 ? '1 relevant memory' : `${foundCount ?? 'some'} relevant memories`}`
    : 'Checking memory...';

  const extra = done
    ? [
        typeof tokenEstimate === 'number' ? `${tokenEstimate}t` : null,
        typeof processingTime === 'number' ? `${processingTime}ms` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div
      data-testid="memory-status-line"
      data-status={done ? 'complete' : 'running'}
      data-context-injected={contextInjected ?? undefined}
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        fontSize: 12,
        color: done ? 'var(--cm-text-secondary)' : 'var(--cm-warning)',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <span style={{ color: done ? 'var(--cm-accent)' : 'var(--cm-warning)', display: 'inline-flex' }}>
        <BrainIcon spinning={!done} />
      </span>
      <span>{label}</span>
      {extra && (
        <span style={{ color: 'var(--cm-text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          · {extra}
        </span>
      )}
    </div>
  );
};

export const MemoryStatusLine = memo(MemoryStatusLineComponent);
MemoryStatusLine.displayName = 'MemoryStatusLine';
