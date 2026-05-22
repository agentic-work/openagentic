/**
 * Phase G (task #152) — `rag_citation` event renderer.
 *
 * Blue-tinted chip that surfaces a platform-RAG hit (user's uploaded
 * docs, shared KB, platform docs). Distinct from F.5 Anthropic
 * `citation` which covers web/document URL citations inline with text.
 *
 * Wire contract: `{source, chunkId, excerpt, score, collection?, url?}`.
 *
 * The chip is self-contained — on hover/focus it reveals the excerpt
 * preview inside a simple title attribute for now. A richer popover is
 * a follow-up in Phase I when we wire the canonical citation surface.
 */
import React, { memo } from 'react';

export interface RagCitationChipProps {
  source: string;
  chunkId?: string | null;
  excerpt?: string | null;
  score?: number | null;
  collection?: string | null;
  url?: string | null;
}

const DocIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);

const RagCitationChipComponent: React.FC<RagCitationChipProps> = ({
  source,
  chunkId,
  excerpt,
  score,
  collection,
  url,
}) => {
  const displaySource =
    source.length > 40 ? `${source.slice(0, 38)}…` : source;
  const scoreLabel =
    typeof score === 'number' && Number.isFinite(score)
      ? ` · ${(score * 100).toFixed(0)}%`
      : '';
  const title = [
    source,
    collection ? `collection: ${collection}` : null,
    chunkId ? `chunk: ${chunkId}` : null,
    excerpt ? `\n${excerpt}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 8px',
    borderRadius: 99,
    background: 'rgba(56,189,248,0.08)',
    border: '1px solid rgba(56,189,248,0.28)',
    fontSize: 11,
    color: '#7dd3fc',
    fontFamily: 'JetBrains Mono, monospace',
    lineHeight: 1,
    textDecoration: 'none',
    cursor: url ? 'pointer' : 'default',
  };

  const content = (
    <>
      <DocIcon />
      <span style={{ color: '#e0f2fe', fontWeight: 500 }}>{displaySource}</span>
      {scoreLabel && <span style={{ color: '#7dd3fc', opacity: 0.7 }}>{scoreLabel}</span>}
    </>
  );

  if (url) {
    return (
      <a
        data-testid="rag-citation-chip"
        data-source={source}
        data-chunk-id={chunkId || undefined}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        style={chipStyle}
      >
        {content}
      </a>
    );
  }

  return (
    <span
      data-testid="rag-citation-chip"
      data-source={source}
      data-chunk-id={chunkId || undefined}
      title={title}
      style={chipStyle}
    >
      {content}
    </span>
  );
};

export const RagCitationChip = memo(RagCitationChipComponent);
RagCitationChip.displayName = 'RagCitationChip';
