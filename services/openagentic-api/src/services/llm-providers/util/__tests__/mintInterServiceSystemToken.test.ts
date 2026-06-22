/**
 * mintInterServiceSystemToken — #1025 (2026-05-22).
 *
 * Pure helper that mints the `oa_sys_<HMAC>` token that mcp-proxy
 * validates for inter-service callers. Pattern lifted verbatim from
 * `MCPToolIndexingService.ts:372-376` so the four current call sites
 * (admin-test-harness, MCPToolIndexingService [2x], ToolSemanticCacheService)
 * stay byte-identical.
 *
 * Why a unit-test first: the harness was minting from the wrong env var
 * (`MCP_PROXY_API_KEY`, never set on the live pod) → empty Bearer → 401
 * on every openagentic_* MCP server. The fix factors the inline pattern into one
 * helper and re-wires the harness to call it. RED here before the helper
 * file exists.
 *
 * Token format (OSS — fresh keys only, no legacy `awc_`/`awc_system_`):
 *   - User API keys:        `oa_<base64url(randomBytes(32))>`
 *   - System/inter-service: `oa_sys_<HMAC_SHA256(secret, label).base64url>`
 *
 * Spec (matches existing inline behavior so the dedupe in #1029 is a no-op):
 *   - mintInterServiceSystemToken('any-secret') →
 *       `oa_sys_${base64url(HMAC_SHA256(secret, 'openagentic-system-token'))}`
 *   - mintInterServiceSystemToken('') → `oa_sys_` (prefix only)
 *   - mintInterServiceSystemToken(undefined) → `oa_sys_`
 *   - deterministic: same input → same output across calls
 *   - HMAC label 'openagentic-system-token' must match mcp-proxy verify
 *     side (services/openagentic-mcp-proxy/src/main.py:913).
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { mintInterServiceSystemToken } from '../mintInterServiceSystemToken.js';

const LABEL = 'openagentic-system-token';
const SYSTEM_PREFIX = 'oa_sys_';

function expectedToken(secret: string): string {
  if (!secret) return SYSTEM_PREFIX;
  const suffix = createHmac('sha256', secret).update(LABEL).digest('base64url');
  return `${SYSTEM_PREFIX}${suffix}`;
}

describe('mintInterServiceSystemToken — #1025 inter-service auth helper', () => {
  it('mints oa_sys_<HMAC> for a non-empty secret', () => {
    const out = mintInterServiceSystemToken('test-secret-64chars-' + 'a'.repeat(44));
    expect(out.startsWith(SYSTEM_PREFIX)).toBe(true);
    // SHA-256 base64url (no padding) = 43 chars
    const suffix = out.slice(SYSTEM_PREFIX.length);
    expect(suffix.length).toBe(43);
    // base64url alphabet — [A-Za-z0-9_-]
    expect(/^[A-Za-z0-9_-]+$/.test(suffix)).toBe(true);
  });

  it('matches the exact MCPToolIndexingService.ts:372-376 inline pattern', () => {
    const secret = 'shared-secret-12345';
    expect(mintInterServiceSystemToken(secret)).toBe(expectedToken(secret));
  });

  it('returns prefix-only `oa_sys_` when secret is empty string', () => {
    // Matches the inline behavior at MCPToolIndexingService.ts:373:
    //   const systemTokenSuffix = internalSecret ? createHmac(...) : '';
    //   const systemToken = `oa_sys_${systemTokenSuffix}`;
    // So empty secret yields `oa_sys_` with no suffix — caller's
    // responsibility to not call with empty secret in prod.
    expect(mintInterServiceSystemToken('')).toBe(SYSTEM_PREFIX);
  });

  it('returns prefix-only `oa_sys_` when secret is undefined', () => {
    // The 3 prod call sites read `process.env.INTERNAL_SERVICE_SECRET || ''`,
    // so undefined is already coerced to '' before reaching here. But making
    // the helper handle undefined defensively means callers can drop the
    // `|| ''` boilerplate.
    expect(mintInterServiceSystemToken(undefined)).toBe(SYSTEM_PREFIX);
  });

  it('is deterministic — same input produces same output every call', () => {
    const secret = 'deterministic-secret';
    const first = mintInterServiceSystemToken(secret);
    const second = mintInterServiceSystemToken(secret);
    const third = mintInterServiceSystemToken(secret);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('different secrets produce different tokens', () => {
    expect(mintInterServiceSystemToken('secret-A')).not.toBe(
      mintInterServiceSystemToken('secret-B'),
    );
  });

  it('uses the canonical HMAC label `openagentic-system-token`', () => {
    // Cross-check: a token minted with this helper for secret X must equal
    // a hand-computed HMAC using the exact label string the mcp-proxy
    // verifier checks against (services/openagentic-mcp-proxy/src/main.py:913
    // — same constant). If anyone changes the label without bumping both
    // sides, this test breaks.
    const secret = 'cross-check-secret';
    const handComputed = createHmac('sha256', secret)
      .update('openagentic-system-token')
      .digest('base64url');
    const out = mintInterServiceSystemToken(secret);
    expect(out).toBe(`${SYSTEM_PREFIX}${handComputed}`);
  });
});
