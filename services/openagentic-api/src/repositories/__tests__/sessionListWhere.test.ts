/**
 * Sev-0 2026-05-08 — empty Playwright sessions polluting the sidebar.
 *
 * User feedback: "FUCKLOAD of your sessions in your playwright that are
 * empty or missing artifacts inline — this is getting fucking old".
 *
 * Pre-fix: every fresh `POST /api/chat/sessions` creates a row, even when
 * the user types nothing or the stream errors before persistence. Old
 * probe rows pile up in the user's sidebar forever.
 *
 * Fix: at LIST time, hide sessions with `message_count === 0` that are
 * older than the freshness window (5 min). New rows still show
 * immediately so legit "I just opened a chat" UX is preserved.
 *
 * Pinned by this contract test on the where-clause builder.
 */
import { describe, it, expect } from 'vitest';
import { buildSessionListWhere } from '../sessionListWhere.js';

const NOW = new Date('2026-05-08T20:00:00Z');

describe('buildSessionListWhere', () => {
  it('always scopes to user_id and excludes soft-deleted', () => {
    const w = buildSessionListWhere('user-1', NOW);
    expect(w.user_id).toBe('user-1');
    expect(w.deleted_at).toBeNull();
  });

  it('hides empty rows older than 5 minutes (the freshness window)', () => {
    const w = buildSessionListWhere('user-1', NOW);
    expect(w.OR).toBeDefined();
    const orClauses = w.OR as Array<Record<string, unknown>>;
    const hasMessageCountGate = orClauses.some(c => (c as any).message_count?.gt === 0);
    const hasFreshnessGate = orClauses.some(c => (c as any).created_at?.gt instanceof Date);
    expect(hasMessageCountGate).toBe(true);
    expect(hasFreshnessGate).toBe(true);
  });

  it('freshness threshold is now() - 5 minutes (not arbitrary)', () => {
    const w = buildSessionListWhere('user-1', NOW);
    const orClauses = w.OR as Array<Record<string, unknown>>;
    const fresh = orClauses.find(c => (c as any).created_at?.gt instanceof Date);
    const cutoff = (fresh as any).created_at.gt as Date;
    const expected = new Date(NOW.getTime() - 5 * 60 * 1000);
    expect(cutoff.toISOString()).toBe(expected.toISOString());
  });
});
