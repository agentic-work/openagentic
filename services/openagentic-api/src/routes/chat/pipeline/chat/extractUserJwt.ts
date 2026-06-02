/**
 * extractUserJwt — chat-pipeline JWT accessor (chatmode-rip Phase C.6).
 *
 * Surfaces the user's Azure AD ACCESS token from the loose `RunCtx.user`
 * shape so the OBO-aware cloud-MCP dispatch path (chatLoop's Azure OBO
 * seam) can read it via the typed `ctx.userJwt` field instead of sniffing
 * the user object directly.
 *
 * Why ACCESS token, not idToken:
 *   - accessToken is what ARM, AWS STS, GCP IAM accept as a bearer for
 *     the cloud OBO exchange
 *   - idToken is identity-only (claims about who the user is); cloud APIs
 *     reject it. Falling back to idToken would silently produce 401s
 *     downstream — much harder to debug than a clean "no JWT" path.
 *
 * Returns `undefined` when:
 *   - user is undefined / null
 *   - user has no accessToken field
 *   - accessToken is present but empty / non-string (malformed claim)
 *
 * Call site: `runChat.ts` sets `ctx.userJwt = extractUserJwt(ctx.user)`
 * once per turn. Sub-agent dispatch through openagentic-proxy gets its own
 * propagation path (already plumbed via `userIdToken` in
 * legacy-orchestrator-style helpers, not yet re-typed here).
 */
export function extractUserJwt(user: unknown): string | undefined {
  if (user === undefined || user === null || typeof user !== 'object') {
    return undefined;
  }
  const u = user as { accessToken?: unknown; authMethod?: unknown };
  // Sev-0 (UAT 2026-05-20): api-key auth must NOT leak the raw key
  // as an AAD/OIDC bearer. unifiedAuth.buildRequestUser stamps
  // accessToken with the inbound Bearer regardless of tokenType, so
  // api-key callers (token shape `awc_*`) would otherwise be handed to
  // assumeRoleWithWebIdentity → STS rejects → chatLoop fails before
  // any model call. Returning undefined here lets the static Bedrock
  // provider creds (set via Add-Provider authConfig) carry the request.
  if (u.authMethod === 'api-key') {
    return undefined;
  }
  const accessToken = u.accessToken;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return undefined;
  }
  return accessToken;
}
