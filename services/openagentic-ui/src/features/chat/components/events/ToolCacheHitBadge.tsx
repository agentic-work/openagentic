/**
 * Phase G (task #152) — `tool_cache_hit` / `tool_semantic_cache_hit`
 * event renderer.
 *
 * Tiny cache icon + "served from cache" label that sits inline on a
 * tool card header. No interaction — purely observability.
 *
 * For `tool_semantic_cache_hit`, `similarity` is a 0-1 score that
 * renders as "87% match" alongside the base label.
 */
import React, { memo } from 'react';

export interface ToolCacheHitBadgeProps {
  name?: string | null;
  similarity?: number | null;
}

const CacheIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    aria-hidden="true"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14a9 3 0 0 0 18 0V5" />
    <path d="M3 12a9 3 0 0 0 18 0" />
  </svg>
);

const ToolCacheHitBadgeComponent: React.FC<ToolCacheHitBadgeProps> = ({ similarity }) => {
  const similarityLabel =
    typeof similarity === 'number' && Number.isFinite(similarity)
      ? ` · ${(similarity * 100).toFixed(0)}% match`
      : '';

  return (
    <span
      data-testid="tool-cache-hit-badge"
      data-similarity={similarity ?? undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 7px',
        borderRadius: 99,
        background: 'rgba(34,197,94,0.08)',
        border: '1px solid rgba(34,197,94,0.28)',
        fontSize: 10,
        color: '#86efac',
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}
    >
      <CacheIcon />
      <span>served from cache{similarityLabel}</span>
    </span>
  );
};

export const ToolCacheHitBadge = memo(ToolCacheHitBadgeComponent);
ToolCacheHitBadge.displayName = 'ToolCacheHitBadge';
