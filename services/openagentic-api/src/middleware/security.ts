/**
 * Shared rate-limit / internal-request trust helper.
 *
 * SECURITY: an `x-request-from` header alone is NOT trusted. A request only
 * counts as an internal-service caller (and is thus exempt from the per-IP
 * rate limit) when it ALSO carries a valid `x-internal-secret` matching
 * `INTERNAL_SERVICE_SECRET` — the exact same gate `middleware/unifiedAuth.ts`
 * applies to the identity claim. Without this, any external client could add
 * one header to skip all rate limiting (defeating brute-force protection on
 * the unauthenticated /api/auth/local/login). Fails CLOSED: if no secret is
 * configured, nothing is treated as internal.
 *
 * Pinned by `__tests__/rateLimitSkip.test.ts`.
 */
import crypto from 'node:crypto';

const INTERNAL_FROMS = new Set([
  'internal',
  'mcp-proxy',
  'openagentic-proxy',
  'workflows',
]);

/** True only for a recognized x-request-from WITH a valid timing-safe X-Internal-Secret. */
export function isTrustedInternalRequest(request: { headers?: Record<string, unknown> }): boolean {
  const headers = request.headers ?? {};
  const from = String(headers['x-request-from'] ?? '').toLowerCase();
  if (!INTERNAL_FROMS.has(from)) return false;

  const secret = process.env.INTERNAL_SERVICE_SECRET;
  const provided = headers['x-internal-secret'];
  if (!secret || typeof provided !== 'string' || secret.length !== provided.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(provided));
  } catch {
    return false;
  }
}

/**
 * Rate-limit option surface consumed by the @fastify/rate-limit registration.
 * `skip(request)` returns true when the request must NOT be counted against the
 * per-IP budget: a secret-authenticated internal-service caller, a health probe,
 * or a WebSocket upgrade. (The richer admin-telemetry carve-out lives at the
 * call site in config/fastify.config.ts where the admin RBAC context exists.)
 */
export const rateLimitOptions = {
  skip(request: { headers?: Record<string, unknown>; url?: string }): boolean {
    if (isTrustedInternalRequest(request)) return true;
    const url = request.url ?? '';
    const isHealth = url === '/health' || url === '/api/health';
    const isWebSocket =
      url.includes('/ws/') || String(request.headers?.['upgrade'] ?? '') === 'websocket';
    return isHealth || isWebSocket;
  },
};
