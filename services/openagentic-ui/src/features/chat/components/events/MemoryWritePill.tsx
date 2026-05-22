/**
 * Phase H (task #153) — `memory_write` event renderer.
 *
 * Small pill rendered above or after a user message when
 * UserMemoryService.ingest() successfully persists the turn into the
 * user's memory store. Lets the user see exactly what was remembered,
 * with scope (user / session / shared) clearly labeled.
 *
 * Wire contract: `{key, summary, scope, entryId?, tokenCount?}`.
 */
import React, { memo } from 'react';

export type MemoryScope = 'user' | 'session' | 'shared';

export interface MemoryWritePillProps {
  memoryKey: string;
  summary: string;
  scope: MemoryScope;
  tokenCount?: number | null;
}

const FloppyIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const SCOPE_COLOR: Record<MemoryScope, string> = {
  user: '#22c55e',      // green
  session: '#a78bfa',   // violet
  shared: '#0ea5e9',    // sky
};

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

const MemoryWritePillComponent: React.FC<MemoryWritePillProps> = ({
  memoryKey,
  summary,
  scope,
  tokenCount,
}) => {
  const preview = truncate(summary, 80);
  const tokenLabel =
    typeof tokenCount === 'number' && tokenCount > 0 ? `${tokenCount}t` : null;
  const scopeColor = SCOPE_COLOR[scope] ?? SCOPE_COLOR.user;

  return (
    <span
      data-testid="memory-write-pill"
      data-memory-key={memoryKey}
      data-scope={scope}
      role="status"
      aria-live="polite"
      title={summary}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        borderRadius: 99,
        background: 'rgba(34,197,94,0.08)',
        border: `1px solid ${scopeColor}33`,
        fontSize: 11,
        color: '#d4d4d8',
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}
    >
      <span style={{ color: scopeColor }}>
        <FloppyIcon />
      </span>
      <span style={{ fontWeight: 600, color: scopeColor }}>
        Remembered
      </span>
      <span style={{ color: '#71717a' }}>· {scope}</span>
      <span
        style={{
          color: '#a1a1aa',
          fontFamily: 'Inter, sans-serif',
          marginLeft: 4,
          maxWidth: 240,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        : {preview}
      </span>
      {tokenLabel && (
        <span style={{ color: '#71717a', marginLeft: 4 }}>· {tokenLabel}</span>
      )}
    </span>
  );
};

export const MemoryWritePill = memo(MemoryWritePillComponent);
MemoryWritePill.displayName = 'MemoryWritePill';
