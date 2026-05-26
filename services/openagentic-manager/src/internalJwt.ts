/**
 * internalJwt — helpers for the in-pod OPENAGENTIC_API_KEY JWT.
 *
 * code-manager mints these and bakes them into the user's permanent
 * pod env. The openagentic CLI reads them and uses them as the bearer
 * for callbacks to /api/openagentic/v1/messages.
 *
 * Token expiry is the cause of "model not responding" after a pod has
 * been alive past its TTL — the pod is reused indefinitely but the env
 * var is static, so once the JWT exp passes, every CLI callback 401s.
 *
 * The fix lives at two layers:
 *   1. TTL bumped from 24h to 7d (POD_JWT_TTL_SECONDS) so refresh is
 *      a once-a-week event under normal use.
 *   2. K8sSessionManager.getOrCreateSession reads the existing pod's
 *      env, calls isJwtExpiringSoon(envJwt, POD_JWT_REFRESH_GRACE_SECONDS),
 *      and if true deletes the pod so the create-path mints a fresh one.
 */

import { createHmac } from 'node:crypto';
import { loggers } from './logger.js';

export const POD_JWT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const POD_JWT_REFRESH_GRACE_SECONDS = 60 * 60;

function base64UrlEncode(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface InternalJwtPayload {
  userId: string;
  email?: string;
  name?: string;
  isAdmin?: boolean;
}

export function generateInternalJwt(payload: InternalJwtPayload): string {
  const secret = process.env.JWT_SECRET || '';
  if (!secret) {
    loggers.security?.warn?.('JWT_SECRET not set - cannot generate internal tokens for code mode');
    return '';
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(JSON.stringify({
    sub: payload.userId,
    id: payload.userId,
    userId: payload.userId,
    email: payload.email || '',
    name: payload.name || 'Code Mode User',
    isAdmin: payload.isAdmin || false,
    source: 'code-mode-internal',
    iat: now,
    exp: now + POD_JWT_TTL_SECONDS,
  }));

  const signature = base64UrlEncode(
    createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  );

  return `${header}.${body}.${signature}`;
}

export function parseJwtExp(token: string | undefined | null): number | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(
      Buffer.from(padded + '='.repeat((4 - padded.length % 4) % 4), 'base64').toString('utf-8'),
    );
    if (typeof payload.exp !== 'number') return null;
    return payload.exp;
  } catch {
    return null;
  }
}

/**
 * Returns true when the JWT's exp is within `graceSeconds` of now,
 * is in the past, OR can't be parsed at all. Fail-closed so a
 * malformed env value triggers refresh rather than getting reused
 * forever.
 */
export function isJwtExpiringSoon(
  token: string | undefined | null,
  graceSeconds: number = POD_JWT_REFRESH_GRACE_SECONDS,
): boolean {
  const exp = parseJwtExp(token as string);
  if (exp === null) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp - now <= graceSeconds;
}
