/**
 * Phase G (task #152) — `rag_status` event renderer.
 *
 * Inline status line shown during RAG retrieval. Starts as
 * "Searching knowledge base..." and transitions to "Found N documents"
 * once the backend sends the final status envelope. Stays inline
 * (not a pill) to keep the reasoning flow readable.
 */
import React, { memo } from 'react';
import { ensurePhaseGKeyframes } from './useKeyframes';

export interface RagStatusLineProps {
  status?: string | null;
  docsRetrieved?: number | null;
  collections?: string[] | null;
  retrievalTimeMs?: number | null;
}

const SearchIcon = ({ spinning }: { spinning: boolean }) => (
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
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const RagStatusLineComponent: React.FC<RagStatusLineProps> = ({
  status,
  docsRetrieved,
  collections,
  retrievalTimeMs,
}) => {
  ensurePhaseGKeyframes();
  const done =
    status === 'complete' ||
    status === 'done' ||
    (typeof docsRetrieved === 'number' && docsRetrieved >= 0);

  const label = done
    ? typeof docsRetrieved === 'number' && docsRetrieved > 0
      ? `Found ${docsRetrieved} relevant document${docsRetrieved === 1 ? '' : 's'}`
      : 'Knowledge base search complete'
    : 'Searching knowledge base...';

  const collectionText =
    done && Array.isArray(collections) && collections.length > 0
      ? ` · ${collections.slice(0, 3).join(', ')}`
      : '';
  const timeText =
    done && typeof retrievalTimeMs === 'number' && retrievalTimeMs > 0
      ? ` · ${retrievalTimeMs}ms`
      : '';

  return (
    <div
      data-testid="rag-status-line"
      data-status={done ? 'complete' : 'running'}
      data-docs-retrieved={docsRetrieved ?? undefined}
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        fontSize: 12,
        color: done ? 'var(--cm-text-muted)' : 'var(--cm-info)',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <span style={{ color: done ? 'var(--cm-success)' : 'var(--cm-info)', display: 'inline-flex' }}>
        <SearchIcon spinning={!done} />
      </span>
      <span>{label}</span>
      {(collectionText || timeText) && (
        <span style={{ color: 'var(--cm-text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          {collectionText}
          {timeText}
        </span>
      )}
    </div>
  );
};

export const RagStatusLine = memo(RagStatusLineComponent);
RagStatusLine.displayName = 'RagStatusLine';
