/**
 * internalJwt — unit tests for the in-pod JWT helpers.
 *
 * The pod's OPENAGENTIC_API_KEY is minted by code-manager and injected
 * as an env var. It used to live inline in index.ts with a 24h TTL,
 * which expired before the permanent pod was reaped → CLI 401-loop.
 *
 * RED-first TDD:
 *   1. generateInternalJwt issues a 7-day TTL (was 24h).
 *   2. parseJwtExp returns the JWT's exp epoch seconds, or null on garbage.
 *   3. isJwtExpiringSoon returns true within `graceSeconds` of expiry,
 *      and treats malformed/missing exp as expiring (fail-closed).
 */

import { describe, it, expect } from 'vitest';
import {
  generateInternalJwt,
  parseJwtExp,
  isJwtExpiringSoon,
  POD_JWT_TTL_SECONDS,
  POD_JWT_REFRESH_GRACE_SECONDS,
} from '../internalJwt';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

describe('internalJwt — TTL constants', () => {
  it('POD_JWT_TTL_SECONDS is 7 days (604800s)', () => {
    expect(POD_JWT_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('POD_JWT_REFRESH_GRACE_SECONDS is at least 1h (3600s)', () => {
    expect(POD_JWT_REFRESH_GRACE_SECONDS).toBeGreaterThanOrEqual(3600);
  });
});

describe('internalJwt — generateInternalJwt', () => {
  it('issues a 7-day TTL token (within ±5s of now+604800)', () => {
    process.env.JWT_SECRET = 'test-secret';
    const before = Math.floor(Date.now() / 1000);
    const token = generateInternalJwt({ userId: 'u1' });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const exp = parseJwtExp(token);
    expect(exp).not.toBeNull();
    expect(exp!).toBeGreaterThanOrEqual(before + POD_JWT_TTL_SECONDS - 5);
    expect(exp!).toBeLessThanOrEqual(before + POD_JWT_TTL_SECONDS + 5);
  });

  it('embeds source: code-mode-internal in the payload', () => {
    process.env.JWT_SECRET = 'test-secret';
    const token = generateInternalJwt({ userId: 'u1' });
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
    );
    expect(payload.source).toBe('code-mode-internal');
    expect(payload.userId).toBe('u1');
  });

  it('returns empty string when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    expect(generateInternalJwt({ userId: 'u1' })).toBe('');
  });
});

describe('internalJwt — parseJwtExp', () => {
  it('returns the exp claim as a number', () => {
    const token = `header.${b64url({ exp: 1234567890 })}.sig`;
    expect(parseJwtExp(token)).toBe(1234567890);
  });

  it('returns null for missing exp', () => {
    const token = `header.${b64url({ userId: 'u1' })}.sig`;
    expect(parseJwtExp(token)).toBeNull();
  });

  it('returns null for malformed token (not 3 parts)', () => {
    expect(parseJwtExp('not-a-jwt')).toBeNull();
    expect(parseJwtExp('header.body')).toBeNull();
    expect(parseJwtExp('')).toBeNull();
  });

  it('returns null for unparseable base64 payload', () => {
    expect(parseJwtExp('header.!!!not-base64!!!.sig')).toBeNull();
  });
});

describe('internalJwt — isJwtExpiringSoon', () => {
  it('returns true when exp is within graceSeconds of now', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `header.${b64url({ exp: now + 30 })}.sig`;
    expect(isJwtExpiringSoon(token, 60)).toBe(true);
  });

  it('returns true when exp is in the past', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `header.${b64url({ exp: now - 60 })}.sig`;
    expect(isJwtExpiringSoon(token, 60)).toBe(true);
  });

  it('returns false when exp is safely beyond graceSeconds', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `header.${b64url({ exp: now + 7200 })}.sig`;
    expect(isJwtExpiringSoon(token, 60)).toBe(false);
  });

  it('fails closed (returns true) on malformed token', () => {
    expect(isJwtExpiringSoon('not-a-jwt', 60)).toBe(true);
    expect(isJwtExpiringSoon('', 60)).toBe(true);
    expect(isJwtExpiringSoon(undefined as any, 60)).toBe(true);
  });

  it('fails closed (returns true) when exp is missing', () => {
    const token = `header.${b64url({ userId: 'u1' })}.sig`;
    expect(isJwtExpiringSoon(token, 60)).toBe(true);
  });
});
