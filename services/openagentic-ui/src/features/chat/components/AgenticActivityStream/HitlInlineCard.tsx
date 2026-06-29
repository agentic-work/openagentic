/**
 * AgenticActivityStream — inline HITL approval card.
 *
 * Extracted verbatim from AgenticActivityStream.tsx (behavior-preserving).
 * Rendered immediately adjacent to the gated tool_use block. Shared by both
 * TreeToolCallGroup (per-child embed) and the main stream.
 */
import React from 'react';
import type { HitlApprovalEntry } from './types/activity.types';

// ============================================================================
// HITL inline approval card (Sev-1 #922) — rendered IMMEDIATELY adjacent to
// the matching tool_use block so the approval prompt stays glued to the
// tool that triggered it. Theme tokens only (CLAUDE.md rule 8b).
//
// Defined BEFORE ToolCallGroup so the cluster renderer can embed it inside
// the per-child tool-card wrapper (fixes #922+#831 serial-cluster migration).
// ============================================================================

interface HitlInlineCardProps {
  entry: HitlApprovalEntry;
  onApprove?: (requestId: string) => void;
  onDeny?: (requestId: string) => void;
}

export const HitlInlineCard: React.FC<HitlInlineCardProps> = ({ entry, onApprove, onDeny }) => {
  // Optimistic-feedback state. The status flip from pending→approved only
  // lands when the next NDJSON frame arrives after the model's next turn
  // completes (10-20s). Without local state, the user clicks Approve and
  // nothing visually changes — they think the click was lost. Tracked in
  // the live regression in the dev environment 2026-05-24 ("hitl gate isnt working").
  const [pendingAction, setPendingAction] = React.useState<'approve' | 'deny' | null>(null);

  // When the parent flips entry.status (server confirmed), reset local state.
  React.useEffect(() => {
    if (entry.status !== 'pending') setPendingAction(null);
  }, [entry.status]);

  const handleApprove = () => {
    if (pendingAction) return;
    setPendingAction('approve');
    onApprove?.(entry.requestId);
  };
  const handleDeny = () => {
    if (pendingAction) return;
    setPendingAction('deny');
    onDeny?.(entry.requestId);
  };

  const isApproving = pendingAction === 'approve';
  const isDenying = pendingAction === 'deny';
  const isSubmitting = pendingAction !== null;

  return (
    <div
      data-testid="hitl-approval-card"
      data-status={entry.status}
      data-tool-name={entry.toolName}
      data-request-id={entry.requestId}
      style={{
        border: '1px solid var(--cm-line-2)',
        borderRadius: 6,
        padding: '10px 12px',
        background: 'var(--cm-bg-1)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        margin: '4px 0',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--cm-fg-1)' }}>
        ⚠ Approval required: <code>{entry.toolName}</code>
      </div>
      <div style={{ color: 'var(--cm-fg-2)', marginBottom: 8 }}>
        {entry.reason}
      </div>
      {entry.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            data-testid="hitl-approve-btn"
            onClick={handleApprove}
            disabled={isSubmitting}
            style={{
              border: '1px solid var(--cm-success)',
              background: isApproving ? 'var(--cm-success)' : 'transparent',
              color: isApproving ? 'var(--cm-bg-0)' : 'var(--cm-success)',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
              opacity: isSubmitting && !isApproving ? 0.5 : 1,
            }}
          >
            {isApproving ? 'Approving…' : 'Approve'}
          </button>
          <button
            data-testid="hitl-deny-btn"
            onClick={handleDeny}
            disabled={isSubmitting}
            style={{
              border: '1px solid var(--cm-error)',
              background: isDenying ? 'var(--cm-error)' : 'transparent',
              color: isDenying ? 'var(--cm-bg-0)' : 'var(--cm-error)',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
              opacity: isSubmitting && !isDenying ? 0.5 : 1,
            }}
          >
            {isDenying ? 'Denying…' : 'Deny'}
          </button>
        </div>
      )}
      {entry.status !== 'pending' && (
        <div style={{ color: 'var(--cm-fg-2)' }}>
          status: <code>{entry.status}</code>
        </div>
      )}
    </div>
  );
};

HitlInlineCard.displayName = 'HitlInlineCard';
