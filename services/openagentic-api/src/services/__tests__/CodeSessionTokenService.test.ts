import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { mintCodeSessionToken } from '../CodeSessionTokenService.js';
describe('mintCodeSessionToken', () => {
  it('signs a user-scoped session JWT verifiable with JWT_SECRET', () => {
    process.env.JWT_SECRET = 'test-secret';
    const tok = mintCodeSessionToken({ userId: 'u1', sessionId: 's1' });
    const dec = jwt.verify(tok, 'test-secret') as any;
    expect(dec.sub).toBe('u1');
    expect(dec.codeSessionId).toBe('s1');
    expect(dec.tokenType).toBe('local');
    expect(dec.isCodeSession).toBe(true);
  });

  it('includes `userId` so tokenValidator classifies it as a LOCAL token (regression: /v1/messages 401)', () => {
    // tokenValidator.ts:113 derives isLocalToken from `payload.userId` — NOT `sub`.
    // Without userId the code-session token falls through to the Azure-AD branch
    // and `claude` gets 401 on every /v1/messages call (api_retry loop).
    process.env.JWT_SECRET = 'test-secret';
    const dec = jwt.verify(mintCodeSessionToken({ userId: 'u1', sessionId: 's1' }), 'test-secret') as any;
    expect(dec.userId).toBe('u1');
    expect(dec.tid).toBeUndefined(); // no Azure tenant claim
    expect(dec.oid).toBeUndefined(); // no Azure object-id claim
  });
});
