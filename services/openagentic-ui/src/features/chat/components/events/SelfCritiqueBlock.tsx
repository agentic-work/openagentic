/**
 * Phase G (task #152) — `self_critique` event renderer.
 *
 * Collapsible block that surfaces a self-critique summary ("X issues
 * flagged") with expandable detail. The backend emits two flavours
 * (status=revising and status=completed) — this component accepts both
 * and renders the most recent state.
 *
 * Wire contract: `{critique?, contradictions?, lowestConfidence?, status?}`.
 */
import React, { memo, useState } from 'react';

export interface SelfCritiqueBlockProps {
  critique?: string | null;
  contradictions?: number | null;
  lowestConfidence?: number | null;
  status?: 'revising' | 'completed' | string | null;
  defaultExpanded?: boolean;
}

const BrainIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M12 2a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2z" />
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
    style={{
      transform: expanded ? 'rotate(90deg)' : 'none',
      transition: 'transform 0.2s',
    }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const SelfCritiqueBlockComponent: React.FC<SelfCritiqueBlockProps> = ({
  critique,
  contradictions,
  lowestConfidence,
  status,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const countLabel =
    typeof contradictions === 'number' && contradictions > 0
      ? `${contradictions} issue${contradictions === 1 ? '' : 's'} flagged`
      : 'self-critique';
  const confidenceLabel =
    typeof lowestConfidence === 'number' && Number.isFinite(lowestConfidence)
      ? ` · confidence ${(lowestConfidence * 100).toFixed(0)}%`
      : '';
  const statusLabel =
    status === 'revising' ? 'revising…' : status === 'completed' ? 'revised' : null;

  return (
    <div
      data-testid="self-critique-block"
      data-status={status || undefined}
      data-contradictions={contradictions ?? undefined}
      style={{
        border: '1px solid rgba(139,92,246,0.24)',
        borderRadius: 8,
        background: 'rgba(139,92,246,0.04)',
        margin: '6px 0',
        fontSize: 12,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="self-critique-body"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'none',
          border: 0,
          color: '#d4d4d8',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ color: '#a78bfa', display: 'inline-flex' }}>
          <BrainIcon />
        </span>
        <span style={{ fontWeight: 600, color: '#f8fafc' }}>Self-critique</span>
        <span style={{ color: '#71717a' }}>
          · {countLabel}
          {confidenceLabel}
        </span>
        {statusLabel && (
          <span
            style={{
              marginLeft: 4,
              padding: '1px 6px',
              borderRadius: 4,
              background: status === 'revising' ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)',
              border: `1px solid ${status === 'revising' ? 'rgba(245,158,11,0.28)' : 'rgba(34,197,94,0.28)'}`,
              color: status === 'revising' ? '#fcd34d' : '#86efac',
              fontSize: 10,
            }}
          >
            {statusLabel}
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: '#71717a' }}>
          <ChevronIcon expanded={expanded} />
        </span>
      </button>
      {expanded && (
        <div
          id="self-critique-body"
          data-testid="self-critique-body"
          style={{
            padding: '0 12px 10px 30px',
            color: '#a1a1aa',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {critique || 'Critique details not provided by the pipeline.'}
        </div>
      )}
    </div>
  );
};

export const SelfCritiqueBlock = memo(SelfCritiqueBlockComponent);
SelfCritiqueBlock.displayName = 'SelfCritiqueBlock';
