/**
 * SynthExecuteJwt — mints the service-JWT that authenticates api → synth-executor.
 *
 * Pairs with synth-executor's verify_service_jwt middleware (commit aae7bb83
 * which requires { iss: 'openagentic-api', aud: 'synth-executor', sub, sid, exp }).
 *
 * Contract:
 *   - HS256 only.
 *   - `iss=openagentic-api`, `aud=synth-executor`.
 *   - `sub=userId` (the AD user the executor will run as).
 *   - `sid=sessionId` (chat/codemode session id, for executor-side audit + log correlation).
 *   - `exp=now+300` (5 min — short-lived; minted per /execute call, never reused).
 *
 * The minter REFUSES to sign with a `dev-secret*` literal — that string is the
 * helm-chart placeholder for "operator must override". A pod with a literal
 * dev-secret is misconfigured; we'd rather 500 at mint than allow a forged
 * boundary.
 */
import jwt from 'jsonwebtoken';

export interface SynthExecutorJwtClaims {
  userId: string;
  sessionId: string;
}

export function mintSynthExecutorJwt(
  claims: SynthExecutorJwtClaims,
  signingKey: string = process.env.SERVICE_JWT_KEY ?? '',
): string {
  if (!signingKey) {
    throw new Error('SERVICE_JWT_KEY required to mint synth-executor JWT');
  }
  if (signingKey.startsWith('dev-secret')) {
    throw new Error('refusing to mint with dev-secret literal SERVICE_JWT_KEY');
  }
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: 'openagentic-api',
      aud: 'synth-executor',
      sub: claims.userId,
      sid: claims.sessionId,
      iat: now,
      exp: now + 300, // 5 min
    },
    signingKey,
    { algorithm: 'HS256' },
  );
}
