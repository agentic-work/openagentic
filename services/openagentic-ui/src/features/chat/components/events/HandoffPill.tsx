/**
 * Phase G (task #152) — `handoff` event renderer.
 *
 * A compact violet pill above an assistant message that shows when the
 * Auto-Routing (or MultiModelOrchestrator) switched models mid-turn.
 * Mirrors the `.handoff` class from the v0.6.7 UX mockup
 * (`docs/release-plans/v0.6.7-ux-mockups/02-kubernetes-health-report.html`):
 *
 *   [→]  gpt-oss:20b (strikethrough)  →  gpt-5.2 (accent)  · reason
 *
 * Wire contract: `{fromModel, toModel, reason?, complexityScore?, route_escalated_destructive?}`.
 * Either model may be absent (e.g. a MultiModelOrchestrator role→role
 * handoff without an explicit toModel carry — we still render, falling
 * back to `fromRole / toRole` if the payload carries those instead).
 */
import React, { memo } from 'react';

export interface HandoffPillProps {
  fromModel?: string | null;
  toModel?: string | null;
  fromRole?: string | null;
  toRole?: string | null;
  reason?: string | null;
  complexityScore?: number | null;
  routeEscalatedDestructive?: boolean;
}

const ArrowIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <path d="M4 12h16M14 6l6 6-6 6" />
  </svg>
);

const ShieldIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z" />
  </svg>
);

const HandoffPillComponent: React.FC<HandoffPillProps> = ({
  fromModel,
  toModel,
  fromRole,
  toRole,
  reason,
  complexityScore,
  routeEscalatedDestructive,
}) => {
  const from = fromModel || fromRole || 'auto';
  const to = toModel || toRole || 'model';

  const reasonParts: string[] = [];
  if (typeof complexityScore === 'number' && Number.isFinite(complexityScore)) {
    reasonParts.push(`complexity ${Math.round(complexityScore)}`);
  }
  if (routeEscalatedDestructive) {
    reasonParts.push('destructive escalation');
  } else if (reason && reason.trim()) {
    reasonParts.push(reason.trim());
  }
  const reasonText = reasonParts.join(' · ');

  return (
    <span
      data-testid="handoff-pill"
      data-from-model={fromModel || undefined}
      data-to-model={toModel || undefined}
      data-destructive={routeEscalatedDestructive ? 'true' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px',
        borderRadius: 99,
        background:
          'linear-gradient(90deg, color-mix(in srgb, var(--cm-accent) 12%, transparent), color-mix(in srgb, var(--cm-accent) 12%, transparent))',
        border: '1px solid color-mix(in srgb, var(--cm-accent) 32%, transparent)',
        fontSize: 11,
        color: 'var(--cm-text-secondary)',
        fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1,
      }}
    >
      {routeEscalatedDestructive ? <ShieldIcon /> : <ArrowIcon />}
      <span style={{ color: 'var(--cm-text-muted)', textDecoration: 'line-through' }}>{from}</span>
      <span style={{ color: 'var(--cm-text-muted)' }}>→</span>
      <span style={{ color: 'var(--cm-accent)', fontWeight: 600 }}>{to}</span>
      {reasonText && (
        <span
          style={{
            color: 'var(--cm-text-secondary)',
            fontFamily: 'Inter, sans-serif',
            marginLeft: 4,
            fontSize: 11,
          }}
        >
          · {reasonText}
        </span>
      )}
    </span>
  );
};

export const HandoffPill = memo(HandoffPillComponent);
HandoffPill.displayName = 'HandoffPill';
