/**
 * mintInterServiceSystemToken — #1026 (2026-05-22).
 *
 * Mints the inter-service `oa_sys_<HMAC>` Bearer token that
 * openagentic-mcp-proxy validates for system callers. Pattern lifted
 * verbatim from `MCPToolIndexingService.ts:372-376` (substrate fix S1,
 * 2026-05-09). Proxy verifier reads the same `INTERNAL_SERVICE_SECRET`
 * shared via the openagentic-internal-secrets Secret and does a
 * constant-time compare against the same HMAC label
 * (services/openagentic-mcp-proxy/src/main.py:913).
 *
 * Token format (OSS — fresh keys only, no legacy back-compat):
 *   - User API keys:           `oa_<base64url(randomBytes(32))>`  (43-char suffix)
 *   - System/inter-service:    `oa_sys_<HMAC_SHA256(secret, label).base64url>`
 * Storage/hashing is unchanged (bcrypt of the full key); only the
 * human-visible prefix + format changed. Validators accept `oa_` (user)
 * and `oa_sys_` (system) and reject everything else.
 *
 * Empty/undefined secret returns prefix-only `oa_sys_` — proxy will
 * reject the call. This matches the existing inline behavior so the
 * dedupe at the 3 prior call sites stays observably identical.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S1
 */
import { createHmac } from 'node:crypto';

const SYSTEM_TOKEN_LABEL = 'openagentic-system-token';
const SYSTEM_TOKEN_PREFIX = 'oa_sys_';

export function mintInterServiceSystemToken(secret: string | undefined): string {
  if (!secret) return SYSTEM_TOKEN_PREFIX;
  const suffix = createHmac('sha256', secret).update(SYSTEM_TOKEN_LABEL).digest('base64url');
  return `${SYSTEM_TOKEN_PREFIX}${suffix}`;
}
