/**
 * Task #343 — Permanent fix for codemode UI→LLM drop caused by
 * internal-key drift between code-manager and long-lived exec pods.
 *
 * Root cause we are guarding against:
 *   1. Exec pod is created with the cm-current `OPENAGENTIC_INTERNAL_KEY`.
 *   2. A helm upgrade (or a secret rotation) changes cm's `INTERNAL_API_KEY`.
 *   3. cm happily reuses the existing pod on next login — but every WS
 *      handshake from api→daemon now presents the NEW key, which the
 *      daemon rejects with 401 ("auth.denied, missing or invalid
 *      internal key"). The UI hangs on "Considering…" forever.
 *
 * This file unit-tests the pure helpers added to k8sSessionManager.ts
 * that detect the drift. Integration behaviour (actually deleting + re-
 * creating the pod) is live-verified with Playwright.
 */

import { describe, it, expect } from 'vitest';

import {
  hashInternalKey,
  isInternalKeyStale,
} from '../internalKeyDrift';

describe('hashInternalKey', () => {
  it('returns a stable 16-hex-char fingerprint', () => {
    const a = hashInternalKey('cmik-abc-123');
    const b = hashInternalKey('cmik-abc-123');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces a different hash for a different key', () => {
    const a = hashInternalKey('cmik-abc-123');
    const b = hashInternalKey('cmik-abc-124');
    expect(a).not.toBe(b);
  });

  it('never returns the plaintext key', () => {
    const plaintext = 'super-secret-internal-api-key-xyz';
    const hashed = hashInternalKey(plaintext);
    expect(hashed).not.toContain(plaintext);
    expect(hashed).not.toContain('super');
    expect(hashed).not.toContain('secret');
  });
});

describe('isInternalKeyStale', () => {
  it('is NOT stale when the stored hash matches the current key', () => {
    const currentKey = 'cmik-current';
    const session = { lastInternalKeyHash: hashInternalKey(currentKey) };
    expect(isInternalKeyStale(session, currentKey)).toBe(false);
  });

  it('IS stale when the stored hash differs from the current key', () => {
    const session = { lastInternalKeyHash: hashInternalKey('cmik-old') };
    expect(isInternalKeyStale(session, 'cmik-new')).toBe(true);
  });

  it('IS stale when the stored hash is undefined (pre-fix session record)', () => {
    // This is the critical behaviour for AC: existing sessions that
    // were created before this fix shipped carry no hash. Treat them
    // as stale on FIRST reuse so cm recreates the pod and stamps a
    // fresh hash. Subsequent reuses with the same key will then be
    // correctly identified as fresh.
    const session = { lastInternalKeyHash: undefined };
    expect(isInternalKeyStale(session, 'cmik-whatever')).toBe(true);
  });

  it('IS stale when the stored hash is an empty string', () => {
    // Defensive — some store serializers (notably JSON round-trips of
    // optional fields) drop `undefined` and leave an empty string. We
    // treat that the same as "no hash recorded" so the self-heal path
    // fires instead of silently trusting the stale pod.
    const session = { lastInternalKeyHash: '' };
    expect(isInternalKeyStale(session, 'cmik-whatever')).toBe(true);
  });

  it('does NOT consider a session stale when the current key is empty (misconfig fail-open)', () => {
    // If cm is launched with no INTERNAL_API_KEY we're already in
    // insecure mode (logged on startup). Don't compound the problem
    // by nuking every exec pod on every reuse — fail open and let
    // the existing "INSECURE mode" warning carry the signal.
    const session = { lastInternalKeyHash: hashInternalKey('cmik-real') };
    expect(isInternalKeyStale(session, '')).toBe(false);
  });
});
