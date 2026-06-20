/**
 * extractUserJwt — RED test for the chat-pipeline JWT accessor (Phase C.6).
 *
 * the chat-pipeline refactor plan §Phase C task C.6: surface `ctx.userJwt` as a typed
 * field on RunCtx so the synth dispatcher (Phase C.5) and any future
 * OBO-aware tool can read the user JWT without sniffing the loose
 * `ctx.user` shape that varies across auth providers.
 *
 * The helper extracts the Azure AD ACCESS token (used as a bearer to
 * ARM, AWS STS, etc.). It explicitly does NOT fall back to idToken —
 * idToken is identity-only (claims about who the user is), accessToken
 * is what cloud APIs accept. Picking the wrong one is a silent failure
 * mode where downstream broker calls 401.
 */
import { describe, it, expect } from 'vitest';
import { extractUserJwt } from '../extractUserJwt.js';

describe('extractUserJwt (the chat-pipeline refactor Phase C.6)', () => {
  it('returns undefined when user is undefined', () => {
    expect(extractUserJwt(undefined)).toBeUndefined();
  });

  it('returns undefined when user has no token fields', () => {
    expect(extractUserJwt({ id: 'u1', email: 'a@b.c' })).toBeUndefined();
  });

  it('returns accessToken when present (canonical OBO path)', () => {
    expect(extractUserJwt({ accessToken: 'eyJaccess...' })).toBe('eyJaccess...');
  });

  it('does NOT fall back to idToken when accessToken is absent', () => {
    // idToken cannot be exchanged at ARM / AWS STS — silent failure mode
    // if the broker accepted it. Forces the call site to surface a clean
    // "no JWT" path instead of leaking an unusable token downstream.
    expect(extractUserJwt({ idToken: 'eyJid...' })).toBeUndefined();
  });

  it('prefers accessToken over idToken when both present', () => {
    expect(
      extractUserJwt({ accessToken: 'access1', idToken: 'id1' }),
    ).toBe('access1');
  });

  it('rejects empty-string accessToken (treats as missing)', () => {
    expect(extractUserJwt({ accessToken: '' })).toBeUndefined();
  });

  it('rejects non-string accessToken (treats as missing)', () => {
    expect(extractUserJwt({ accessToken: 12345 as unknown as string })).toBeUndefined();
    expect(extractUserJwt({ accessToken: null as unknown as string })).toBeUndefined();
  });
});
