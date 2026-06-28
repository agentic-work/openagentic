/**
 * ApprovalModal — human-approval gate for MUTATING tool calls (commit 7e6637539).
 *
 * Pure presentational component: render directly with a fixed `approval` prop,
 * no providers needed. Asserts:
 *   - tool name + server name rendered
 *   - pretty-printed (multi-line) JSON args
 *   - preview text when present
 *   - Approve / Deny clicks fire their callbacks exactly once
 *   - queuedCount surfaces "N more waiting"
 *   - pending disables both buttons + flips the notice to "Submitting…"
 *   - THEME GUARD: no hardcoded black scrim / hex literals in inline styles
 *     (this app was just theme-audited — canonical tokens only).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import ApprovalModal, { type AuditApprovalRequest } from '../ApprovalModal';

const baseApproval: AuditApprovalRequest = {
  auditId: 'audit-123',
  toolName: 'aws_s3_delete_bucket',
  serverName: 'aws',
  args: { bucket: 'prod-data', force: true },
  preview: 'Delete the prod-data bucket',
};

function renderModal(overrides: Partial<React.ComponentProps<typeof ApprovalModal>> = {}) {
  const onApprove = vi.fn();
  const onDeny = vi.fn();
  const utils = render(
    <ApprovalModal
      approval={baseApproval}
      onApprove={onApprove}
      onDeny={onDeny}
      {...overrides}
    />,
  );
  return { ...utils, onApprove, onDeny };
}

describe('ApprovalModal', () => {
  it('renders the tool name and server name', () => {
    renderModal();
    expect(screen.getByText('aws_s3_delete_bucket')).toBeInTheDocument();
    expect(screen.getByText('aws')).toBeInTheDocument();
  });

  it('renders the preview text when present', () => {
    renderModal();
    expect(screen.getByText('Delete the prod-data bucket')).toBeInTheDocument();
  });

  it('pretty-prints the args as multi-line JSON', () => {
    renderModal();
    const pre = screen.getByTestId('approval-args');
    expect(pre.textContent).toContain('"bucket"');
    expect(pre.textContent).toContain('prod-data');
    // pretty-printed JSON is multi-line
    expect(pre.textContent?.split('\n').length).toBeGreaterThan(1);
  });

  it('pretty-prints a stringified-JSON args payload', () => {
    renderModal({ approval: { ...baseApproval, args: '{"bucket":"x"}' } });
    const pre = screen.getByTestId('approval-args');
    expect(pre.textContent).toContain('"bucket"');
    expect(pre.textContent?.split('\n').length).toBeGreaterThan(1);
  });

  it('fires onApprove exactly once when Approve is clicked', () => {
    const { onApprove } = renderModal();
    fireEvent.click(screen.getByTestId('approval-approve'));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('fires onDeny exactly once when Deny is clicked', () => {
    const { onDeny } = renderModal();
    fireEvent.click(screen.getByTestId('approval-deny'));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('shows how many more approvals are queued behind this one', () => {
    renderModal({ queuedCount: 2 });
    expect(screen.getByText(/2 more waiting/)).toBeInTheDocument();
  });

  it('disables both buttons and shows a submitting notice while pending', () => {
    renderModal({ pending: true });
    expect(screen.getByTestId('approval-approve')).toBeDisabled();
    expect(screen.getByTestId('approval-deny')).toBeDisabled();
    expect(screen.getByText(/Submitting/)).toBeInTheDocument();
  });

  it('shows the awaiting-human notice when not pending', () => {
    renderModal();
    expect(screen.getByText(/Awaiting a human/)).toBeInTheDocument();
  });

  // ── THEME GUARD ──────────────────────────────────────────────────────────
  // The theme audit forbids hardcoded surface/border colors. The only legit
  // literal is the on-accent white fallback (text on the accent button), so we
  // scope the assertion to background/border/scrim usage.
  it('uses canonical theme tokens — no hardcoded black scrim or hex surfaces', () => {
    const { container } = renderModal();
    const html = container.innerHTML;
    // no rgba(0,0,0,...) scrim
    expect(html).not.toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0/);
    // surfaces come from var(--color-*) tokens
    expect(html).toContain('var(--color-surface)');
    expect(html).toContain('var(--color-text)');
    expect(html).toContain('var(--color-border)');
    expect(html).toContain('var(--user-accent-primary)');
    // any 6-digit hex literal must be the allowed on-accent white fallback
    const hexes = html.match(/#[0-9a-fA-F]{6}/g) ?? [];
    for (const hex of hexes) {
      expect(hex.toLowerCase()).toBe('#ffffff');
    }
  });
});
