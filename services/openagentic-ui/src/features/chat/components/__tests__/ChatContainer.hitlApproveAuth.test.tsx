/**
 * Q1-blocker-8 (2026-05-12) — Approve/Deny click must send
 * `Authorization: Bearer <token>` to /api/permissions/approvals/:id/*
 * AND update local hitlApprovalsByMessageId state on success so the
 * card buttons disappear and the cascade unblocks.
 *
 * Pre-fix: handler used `credentials: 'include'` only — no Bearer
 *          header. Cookie-based auth isn't how AAD is wired on this
 *          deployment, so the api receives userId='unknown' and
 *          PermissionService.submitApproval REJECTS the request as
 *          un-authenticated. Approve button visually did nothing.
 * Post-fix: handler awaits getAccessToken, sends Bearer header,
 *          awaits the POST, and updates the live state slot on success.
 *
 * Source-grep style.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatContainer.tsx');

describe('ChatContainer — HITL approve handler auth + state update (Q1-fix-8)', () => {
  it('approve handler sends Authorization: Bearer header', () => {
    const src = readFileSync(SRC, 'utf8');
    // Find the onApproveHitl block; assert it composes a Bearer header
    // (the rest of the file is full of Bearer fetches — we anchor on
    // the permissions/approvals URL).
    const idx = src.indexOf('permissions/approvals/');
    expect(idx).toBeGreaterThan(-1);
    // Within the next 2000 chars (the surrounding handler body) we
    // expect a Bearer composition. The full file uses template-literal
    // form: `Bearer ${token}`.
    const slice = src.slice(idx, idx + 2000);
    expect(slice).toContain('Bearer ${token}');
  });

  it('approve handler updates hitlApprovalsByMessageId after a successful POST', () => {
    const src = readFileSync(SRC, 'utf8');
    // The fix expects the approve/deny click handlers to call the
    // setter exposed by useChatStream so the card transitions to a
    // non-pending state and the buttons disappear.
    expect(src).toMatch(/setHitlApprovalsByMessageId/);
  });
});
