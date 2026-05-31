/**
 * CodeSessionTokenService
 *
 * Mints a short-lived JWT that the exec-launched `claude` process sends as
 * `Authorization: Bearer <token>` (via ANTHROPIC_AUTH_TOKEN) to the api's
 * `/v1/messages` endpoint. The token is verifiable with the same secret the
 * api uses (JWT_SECRET || SIGNING_SECRET) and carries `tokenType:'local'` so
 * the api auth middleware treats it as a local user session.
 */

import jwt from 'jsonwebtoken';

export interface MintCodeSessionTokenInput {
  userId: string;
  sessionId: string;
}

/**
 * Resolve the signing secret from the environment.
 * Mirrors the behaviour of `src/utils/secrets.ts#getJWTSecret` for the
 * synchronous path needed at token-mint time.
 * Throws if neither JWT_SECRET nor SIGNING_SECRET is set.
 */
function resolveSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET or SIGNING_SECRET must be set');
  }
  return secret;
}

/**
 * Mint a code-session JWT.
 *
 * Payload:
 *   sub            — userId (standard JWT subject)
 *   codeSessionId  — exec session identifier
 *   tokenType      — 'local' (api auth middleware accepts this as a local user)
 *   isCodeSession  — true (allows api to apply code-session policy if needed)
 *
 * Expiry: 12 h (ample for a long coding session; exec service terminates the
 * claude process independently when the user closes the terminal).
 */
export function mintCodeSessionToken(input: MintCodeSessionTokenInput): string {
  const { userId, sessionId } = input;
  const secret = resolveSecret();
  return jwt.sign(
    {
      // tokenValidator classifies + extracts local tokens via `userId` (NOT `sub`)
      // — see auth/tokenValidator.ts:113 (`hasUserId`) and :209. Without this the
      // code-session token falls through to the Azure-AD branch → 401, which
      // breaks BOTH terminal and chat codemode on any local-auth deployment.
      userId,
      sub: userId,
      codeSessionId: sessionId,
      tokenType: 'local',
      isCodeSession: true,
    },
    secret,
    { expiresIn: '12h' },
  );
}
