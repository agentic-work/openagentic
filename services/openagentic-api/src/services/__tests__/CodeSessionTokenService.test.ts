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
});
