import { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import * as jose from 'node-jose';
import jwksRsa from 'jwks-rsa';
import { ClientSecretCredential, DefaultAzureCredential } from '@azure/identity';
import crypto from 'crypto';
import type { Logger } from 'pino';
import { createRedisService, RedisService } from '../services/redis.js';

export interface AzureADConfig {
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  authority: string;
  redirectUri: string;
  scopes: string[];
}

export interface UserContext {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
  roles?: string[];
  isAdmin?: boolean;
  groups?: string[];
}

export interface TokenValidationResult {
  isValid: boolean;
  user?: UserContext;
  error?: string;
  claims?: any;
}

/**
 * LANE S1-10 — MFA freshness for sensitive mutating operations.
 * NIST IA-2(1)/(2) (MFA for privileged/network access) + IA-11
 * (re-authentication): a sensitive mutating operation must be backed by
 * FRESH authentication, not merely a non-expired bearer token. A token can
 * stay `exp`-valid for an hour while its `auth_time` (the moment the user
 * last completed MFA) has aged well past any reasonable re-auth window.
 *
 * The freshness window is configurable via `MFA_FRESHNESS_SECS` with a sane
 * non-zero default. Garbage / non-positive values fall back to the default
 * rather than silently disabling the gate.
 *
 * 15 minutes is a conservative privileged-action re-auth window — short
 * enough to be meaningful for create/delete/deploy operations, long enough
 * not to thrash an interactive session. Mirrors the OBO-side freshness gate
 * in AzureTokenService (#789) which guards the outbound path.
 */
export const DEFAULT_MFA_FRESHNESS_SECS = 15 * 60;

/**
 * True iff verbose auth debug logging is explicitly enabled.
 *
 * The token-validation path used to print ~33 console lines exposing decoded
 * JWT header/payload internals (alg/kid/iss/aud/appid/ver/tid), the JWKS URI,
 * per-issuer/per-audience verification attempts, the user's email, their group
 * GUIDs, the configured authorized/admin group allowlists, the external-admin
 * email allowlist, and admin status — all at default level on EVERY token
 * validation. That is a token-internals + PII leak straight into prod stdout.
 *
 * These prints are diagnostic-only and must be opt-in. Gate them behind
 * AUTH_DEBUG so production never logs raw token claims or PII by default.
 */
function isAuthDebugEnabled(): boolean {
  return process.env.AUTH_DEBUG === 'true';
}

/** Gated debug log — no-op unless AUTH_DEBUG === 'true'. */
function authDebug(...args: any[]): void {
  if (isAuthDebugEnabled()) {
    console.log(...args);
  }
}

/** Gated debug error log — no-op unless AUTH_DEBUG === 'true'. */
function authDebugError(...args: any[]): void {
  if (isAuthDebugEnabled()) {
    console.error(...args);
  }
}

/** Gated debug warn log — no-op unless AUTH_DEBUG === 'true'. */
function authDebugWarn(...args: any[]): void {
  if (isAuthDebugEnabled()) {
    console.warn(...args);
  }
}

export function getMfaFreshnessSeconds(): number {
  const raw = process.env.MFA_FRESHNESS_SECS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MFA_FRESHNESS_SECS;
}

/**
 * True iff the token's authentication is fresh enough to authorize a
 * sensitive mutating operation. Prefers `auth_time` (the OIDC claim recording
 * when MFA was last performed) and falls back to `iat` when `auth_time` is
 * absent. When NEITHER claim is present we cannot prove freshness, so a
 * sensitive op is DENIED (fail-closed) — the caller must force re-auth.
 *
 * Note: `acr`/`amr` are inspected separately by `tokenHasMfaClaim` (used by
 * `evaluatePrivilegedMfa` / the admin gate) to confirm MFA actually occurred;
 * this function answers the time-based freshness question only.
 */
export function isAuthFreshForSensitiveOp(
  claims: Record<string, any> | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!claims) return false;
  const stamp = typeof claims.auth_time === 'number'
    ? claims.auth_time
    : (typeof claims.iat === 'number' ? claims.iat : undefined);
  // No usable timestamp → cannot prove freshness → fail closed for sensitive ops.
  if (stamp === undefined) return false;
  const ageSec = nowSec - stamp;
  return ageSec <= getMfaFreshnessSeconds();
}

/**
 * P-002 — Recognized OIDC `amr` (Authentication Methods Reference, RFC 8176)
 * values that PROVE a multi-factor authentication actually occurred. This is
 * the claim-verification half of NIST IA-2(1)/(2): even a perfectly fresh
 * token (passing isAuthFreshForSensitiveOp) may have been minted from a
 * single-factor password-only authentication — `amr=["pwd"]` — which must NOT
 * satisfy an MFA-for-privileged-access requirement.
 *
 * The set intentionally EXCLUDES `pwd`/`pin`/`kba` (knowledge factors that, on
 * their own, are single-factor). Azure AD emits `amr:["pwd","mfa"]` for a
 * password + second-factor sign-in, and `amr:["rsa"]`/`["otp"]`/`["fido"]` for
 * various strong factors.
 */
const MFA_AMR_VALUES: ReadonlySet<string> = new Set([
  'mfa',  // Azure AD's explicit multi-factor marker
  'otp',  // one-time password (RFC 8176)
  'sms',  // SMS confirmation code
  'tel',  // telephone confirmation
  'fido', // FIDO/WebAuthn authenticator
  'hwk',  // proof-of-possession of a hardware key (RFC 8176)
  'swk',  // proof-of-possession of a software key (RFC 8176)
  'rsa',  // RSA hardware/software token
  'phr',  // phishing-resistant (RFC 8176)
  'phh',  // phishing-resistant hardware-protected (RFC 8176)
  'wia',  // Windows integrated auth (Kerberos, second factor on domain join)
]);

/**
 * P-002 — `acr` (Authentication Context Class Reference) values that signal an
 * MFA-backed session. Azure AD historically emits `acr:"1"` for an MFA sign-in
 * and the legacy SAML `multipleauthn` URN; OIDC LoA URNs >= 2/3 also imply
 * step-up auth. `acr:"0"` explicitly means NO context (single-factor) and must
 * NOT pass.
 */
function acrSignalsMfa(acr: unknown): boolean {
  if (typeof acr !== 'string' || acr.trim() === '') return false;
  const v = acr.trim().toLowerCase();
  if (v === '0') return false;
  if (v === '1') return true; // Azure AD MFA context
  if (v.includes('multipleauthn')) return true; // legacy SAML MFA URN
  // OIDC Level-of-Assurance URNs: loa-2 / loa-3 (and bare "2"/"3") imply step-up.
  if (v === '2' || v === '3') return true;
  if (/loa-?[23]\b/.test(v)) return true;
  return false;
}

/**
 * P-002 — True iff the token's claims PROVE multi-factor authentication
 * actually occurred, via the `amr` array containing a recognized MFA method
 * OR the `acr` indicating an MFA authentication context. This is the dormant
 * "MFA claim verification" the POA&M flagged — coded here and wired into the
 * privileged-session gate (evaluatePrivilegedMfa / adminMfaGateForRequest).
 *
 * Defensive on shape: tolerates a single-string `amr` (some IdPs), is
 * case-insensitive, and returns false for null/undefined/empty claims.
 */
export function tokenHasMfaClaim(claims: Record<string, any> | null | undefined): boolean {
  if (!claims || typeof claims !== 'object') return false;
  const amrRaw = (claims as any).amr;
  const amrList: string[] = Array.isArray(amrRaw)
    ? amrRaw
    : typeof amrRaw === 'string'
      ? [amrRaw]
      : [];
  for (const m of amrList) {
    if (typeof m === 'string' && MFA_AMR_VALUES.has(m.trim().toLowerCase())) {
      return true;
    }
  }
  return acrSignalsMfa((claims as any).acr);
}

/**
 * P-002 — the privileged-session MFA gate (NIST IA-2(1)/(2) + IA-11). Combines
 * the MFA CLAIM check (tokenHasMfaClaim — proves MFA happened) with the MFA
 * FRESHNESS check (isAuthFreshForSensitiveOp — proves it happened recently).
 *
 * Returns a decision the auth middleware turns into an HTTP response:
 *   - { ok: true }                            → proceed
 *   - { ok: false, code: 'MFA_REQUIRED', error } → 401, force re-auth (MFA)
 *
 * Enforcement is OPT-IN (`enforced`) so dev / CI / local-JWT admin flows are
 * never broken by default; FedRAMP / production deployments flip it on via
 * `ADMIN_MFA_ENFORCED=true`. Only `azure-ad` sessions carry `amr`/`acr`, so
 * other token types (local JWT, google, api-key) are not subject to the claim
 * check — there is no IdP MFA evidence to evaluate for them.
 *
 * Fail-closed: an azure-ad session with absent/undecodable claims, no MFA
 * claim, or stale auth cannot prove MFA → MFA_REQUIRED.
 */
export interface PrivilegedMfaDecision {
  ok: boolean;
  code?: 'MFA_REQUIRED';
  error?: string;
}

export function evaluatePrivilegedMfa(params: {
  claims: Record<string, any> | null | undefined;
  tokenType: 'local' | 'azure-ad' | 'google' | 'api-key' | string | undefined;
  enforced: boolean;
  nowSec?: number;
}): PrivilegedMfaDecision {
  const { claims, tokenType, enforced } = params;
  const nowSec = params.nowSec ?? Math.floor(Date.now() / 1000);

  // Gate disabled → always allow (default posture for dev/CI/local-admin).
  if (!enforced) return { ok: true };

  // Only Azure AD sessions carry the OIDC amr/acr MFA evidence. Local JWT /
  // google / api-key have no IdP MFA claim to verify; the claim check does not
  // apply (other controls gate those paths).
  if (tokenType !== 'azure-ad') return { ok: true };

  const windowSecs = getMfaFreshnessSeconds();

  if (!tokenHasMfaClaim(claims)) {
    return {
      ok: false,
      code: 'MFA_REQUIRED',
      error:
        'Multi-factor authentication is required for privileged access. Your ' +
        'current session was not established with MFA (no `amr`/`acr` MFA ' +
        'claim). Please re-authenticate with MFA and retry.',
    };
  }

  if (!isAuthFreshForSensitiveOp(claims, nowSec)) {
    return {
      ok: false,
      code: 'MFA_REQUIRED',
      error:
        `Re-authentication required: your MFA is older than the ${windowSecs}s ` +
        'privileged-session freshness window. Please re-authenticate with MFA ' +
        'and retry.',
    };
  }

  return { ok: true };
}

export interface TokenRefreshResult {
  success: boolean;
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  error?: string;
}

interface CachedToken {
  user: UserContext;
  exp: number;
  validatedAt: number;
}

/**
 * Azure AD Authentication Service
 * Handles token validation, user extraction, and permission checks
 */
export class AzureADAuthService {
  private config: AzureADConfig;
  private tokenCache: Map<string, CachedToken> = new Map();
  private jwksCache: any = null;
  private jwksCacheExpiry: number = 0;
  private pkceVerifiers: Map<string, string> = new Map(); // Keep as fallback
  private redis: RedisService;
  private logger: Logger;

  constructor(config: Partial<AzureADConfig>, logger?: Logger) {
    this.logger = logger || console as any;
    this.config = {
      tenantId: config.tenantId || process.env.AZURE_AD_TENANT_ID || '',
      clientId: config.clientId || process.env.AZURE_AD_CLIENT_ID || '',
      clientSecret: config.clientSecret || process.env.AZURE_AD_CLIENT_SECRET,
      authority: config.authority || process.env.AZURE_AD_AUTHORITY || 
        `https://login.microsoftonline.com/${config.tenantId || process.env.AZURE_AD_TENANT_ID}`,
      redirectUri: config.redirectUri || process.env.AZURE_AD_REDIRECT_URI || `${process.env.FRONTEND_URL || 'https://chat-dev.openagentic.io'}/api/auth/microsoft/callback`,
      // Request Azure ARM access directly - this gives a token usable against Azure Management APIs
      // For Graph/KeyVault/Storage, the MCP proxy will use the ID token for OBO exchange
      scopes: config.scopes || [
        'https://management.azure.com/user_impersonation',  // Direct ARM access
        'openid',
        'profile',
        'email',
        'offline_access'  // For refresh tokens
      ]
    };

    // Initialize Redis for shared PKCE verifier storage
    this.redis = createRedisService(this.logger);

    // Clean up expired tokens periodically
    setInterval(() => this.cleanupExpiredTokens(), parseInt(process.env.TOKEN_CLEANUP_INTERVAL || '60000')); // Every minute
  }

  getConfig(): AzureADConfig {
    return { ...this.config };
  }

  /**
   * Validate an Azure AD token
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    try {
      // Check cache first
      const cached = this.tokenCache.get(token);
      if (cached && cached.exp > Date.now() / 1000) {
        authDebug('🔍 [AUTH-DEBUG] Token found in cache, returning cached result');
        return {
          isValid: true,
          user: cached.user
        };
      }

      // Decode token header and payload for debugging
      const parts = token.split('.');
      if (parts.length !== 3) {
        authDebugError('❌ [AUTH-DEBUG] Invalid token format - expected 3 parts, got', parts.length);
        throw new Error('Invalid token format');
      }

      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      // Token internals (alg/kid/iss/aud/appid/ver/tid) are sensitive — only
      // surface them under the AUTH_DEBUG gate.
      authDebug('🔍 [AUTH-DEBUG] Token details:');
      authDebug('  - Algorithm:', header.alg);
      authDebug('  - Key ID:', header.kid);
      authDebug('  - Token Type:', header.typ);
      authDebug('  - Issuer:', payload.iss);
      authDebug('  - Audience:', payload.aud);
      authDebug('  - Client ID:', payload.appid || payload.azp);
      authDebug('  - Version:', payload.ver);
      authDebug('  - Tenant ID:', payload.tid);

      // Create jwks-rsa client for Azure AD
      const jwksUri = `${this.config.authority}/discovery/v2.0/keys`;
      authDebug('🔍 [AUTH-DEBUG] JWKS URI:', jwksUri);

      // Handle both CJS and ESM exports
      const createClient = (jwksRsa as any).default || jwksRsa;
      const client = createClient({
        jwksUri: jwksUri,
        cache: true,
        cacheMaxAge: 86400000, // 24 hours
        rateLimit: true,
        jwksRequestsPerMinute: 10
      });

      // Function to get signing key
      const getKey = (header: any, callback: any) => {
        authDebug('🔍 [AUTH-DEBUG] Fetching signing key for kid:', header.kid);
        client.getSigningKey(header.kid, (err, key) => {
          if (err) {
            authDebugError('❌ [AUTH-DEBUG] Error fetching signing key:', err.message);
            callback(err);
          } else {
            const signingKey = key?.getPublicKey();
            authDebug('✅ [AUTH-DEBUG] Successfully fetched signing key');
            callback(null, signingKey);
          }
        });
      };

      // Verify the token using jsonwebtoken with jwks-rsa
      // Azure AD can issue tokens from either v1.0 or v2.0 endpoints
      const validIssuers = [
        `${this.config.authority}/v2.0`,  // v2.0 endpoint
        `https://login.microsoftonline.com/${this.config.tenantId}/v2.0`,  // Alternative v2.0 format
        `https://sts.windows.net/${this.config.tenantId}/`  // v1.0 endpoint
      ];

      authDebug('🔍 [AUTH-DEBUG] Valid issuers to try:', validIssuers);
      authDebug('🔍 [AUTH-DEBUG] Expected audience:', this.config.clientId);

      let decoded: any = null;
      let lastError: Error | null = null;

      // Try each valid issuer until one works
      for (const issuer of validIssuers) {
        authDebug(`🔍 [AUTH-DEBUG] Trying issuer: ${issuer}`);

        // Azure AD tokens can have different audience formats
        const validAudiences = [
          this.config.clientId,  // Application ID
          `api://${this.config.clientId}`,  // API URI format
          `spn:${this.config.clientId}`,  // Service principal format
        ];

        // Add Microsoft Graph audience if configured or use well-known ID as fallback
        const graphAudience = process.env.AZURE_GRAPH_AUDIENCE || '00000003-0000-0000-c000-000000000000';
        if (graphAudience) {
          validAudiences.push(graphAudience);
        }

        for (const audience of validAudiences) {
          authDebug(`🔍 [AUTH-DEBUG] Trying audience: ${audience}`);
          try {
            decoded = await new Promise<any>((resolve, reject) => {
              jwt.verify(token, getKey, {
                audience: audience,  // Re-enabled audience validation
                issuer: issuer,  // Single issuer
                algorithms: ['RS256']
              }, (err, decodedToken) => {
                if (err) {
                  authDebug(`❌ [AUTH-DEBUG] Verification failed with issuer ${issuer}, audience ${audience}: ${err.message}`);
                  reject(err);
                } else {
                  authDebug(`✅ [AUTH-DEBUG] Token verified successfully with issuer: ${issuer}, audience: ${audience}`);
                  resolve(decodedToken);
                }
              });
            });

            // If we got here, verification succeeded
            break;
          } catch (err: any) {
            lastError = err;
            // Try next audience
          }
        }

        if (decoded) {
          break;  // Break out of issuer loop if we found a match
        }
      }

      // If no issuer worked, throw the last error
      if (!decoded && lastError) {
        authDebugError('❌ [AUTH-DEBUG] All issuers failed. Last error:', lastError.message);
        throw lastError;
      }

      // Validate tenant
      if (decoded.tid !== this.config.tenantId) {
        return {
          isValid: false,
          error: 'Token is not from the configured tenant'
        };
      }

      // Extract user context
      const user: UserContext = {
        userId: decoded.oid || decoded.sub,
        tenantId: decoded.tid,
        email: decoded.email || decoded.upn || decoded.preferred_username,
        name: decoded.name,
        roles: decoded.roles || [],
        groups: decoded.groups || []
      };

      // CRITICAL: Check if user is in ANY authorized group to allow login
      // Users MUST be in at least one of these groups to access the application
      // Use group IDs from environment variables - NO HARDCODED FALLBACKS
      const authorizedGroupsEnv = process.env.VITE_AZURE_AD_AUTHORIZED_GROUPS || process.env.AZURE_AD_AUTHORIZED_GROUPS;
      const configuredUserGroups = authorizedGroupsEnv?.split(',').map(g => g.trim()) || [];
      const configuredAdminGroups = process.env.AZURE_ADMIN_GROUPS?.split(',').map(g => g.trim()) || [];
      const authorizedGroups = [...configuredUserGroups, ...configuredAdminGroups];

      // Azure AD returns group GUIDs in the token, not group names
      // Map group names to their GUIDs from environment variables
      const groupNameToId: Record<string, string> = {};

      // Parse group mappings from environment if provided
      // Format: AZURE_GROUP_MAPPINGS="GroupName1:guid1,GroupName2:guid2"
      const groupMappings = process.env.AZURE_GROUP_MAPPINGS;
      if (groupMappings) {
        groupMappings.split(',').forEach(mapping => {
          const [name, id] = mapping.split(':').map(s => s.trim());
          if (name && id) {
            groupNameToId[name] = id;
          }
        });
      }

      // Get authorized group IDs (support both names and IDs)
      // If a group is already a GUID, use it as-is
      // If it's a name and we have a mapping, use the mapped ID
      // Otherwise, use the original value (could be a GUID we don't have mapped)
      const authorizedGroupIds = authorizedGroups.map(g => {
        // Check if it's already a GUID format
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g)) {
          return g;
        }
        // Otherwise try to map it
        return groupNameToId[g] || g;
      });

      // User email + group GUIDs are PII — only surface under the AUTH_DEBUG gate.
      authDebug(`🔍 [AUTH-BACKEND] Token validation for user: ${user.email}`);
      authDebug(`🔍 [AUTH-BACKEND] Configured authorized groups: [${authorizedGroups.join(', ')}]`);
      authDebug(`🔍 [AUTH-BACKEND] Authorized group IDs: [${authorizedGroupIds.join(', ')}]`);
      authDebug(`🔍 [AUTH-BACKEND] User's groups from token: [${(decoded.groups || []).join(', ')}]`);
      authDebug(`🔍 [AUTH-BACKEND] User groups count: ${(decoded.groups || []).length}`);
      
      // For admin detection, use AZURE_ADMIN_GROUPS environment variable directly
      // This should contain the GUIDs of admin groups, NOT names with 'admin' in them
      const authorizedAdminGroups = configuredAdminGroups;
      
      // All groups in the list are authorized for login (check against group IDs)
      const allAuthorizedGroups = authorizedGroupIds;

      const userGroups = decoded.groups || [];

      // Check if this is a guest user (#EXT# in UPN or email)
      const isGuestUser = user.email.includes('#EXT#') ||
                         (decoded.unique_name && decoded.unique_name.includes('#EXT#')) ||
                         (decoded.upn && decoded.upn.includes('#EXT#'));

      if (isGuestUser && userGroups.length === 0) {
        authDebugWarn(`⚠️ [AUTH-BACKEND] Guest user ${user.email} detected with no groups in token. This is expected for Azure AD guest users.`);
        authDebug(`🔍 [AUTH-BACKEND] Guest users often don't receive group claims. Consider using Microsoft Graph API for group validation.`);
      }

      const isAuthorizedUser = userGroups.some((group: string) =>
        allAuthorizedGroups.includes(group)
      );

      authDebug(`🔍 [AUTH-BACKEND] Authorization check result: ${isAuthorizedUser}`);
      authDebug(`🔍 [AUTH-BACKEND] Is guest user: ${isGuestUser}`);

      // Check for external/guest admins FIRST (before group validation)
      // For external users who might not have group claims, check explicit admin list
      const externalAdmins = (process.env.EXTERNAL_ADMIN_EMAILS || '').split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0);

      const isExternalAdmin = externalAdmins.includes(user.email.toLowerCase());

      authDebug(`🔍 [AUTH-BACKEND] External admin emails configured: [${externalAdmins.join(', ')}]`);
      authDebug(`🔍 [AUTH-BACKEND] Is external admin: ${isExternalAdmin}`);

      if (isExternalAdmin) {
        authDebug(`✅ [AUTH-BACKEND] External user ${user.email} recognized as admin from EXTERNAL_ADMIN_EMAILS - bypassing group validation`);
      }

      // Deny access if user is not in any authorized group (unless group validation is disabled or user is an external admin)
      const skipGroupValidation = process.env.SKIP_GROUP_VALIDATION === 'true';
      const knownGuestAdmins = (process.env.KNOWN_GUEST_ADMINS || '').split(',').map(e => e.trim().toLowerCase());

      if (!skipGroupValidation && !isAuthorizedUser && !isExternalAdmin) {
        // Access-denied is security-relevant, but the email + group GUIDs are
        // PII — keep the verbose form behind AUTH_DEBUG. The caller still
        // receives an honest denial via the returned error below.
        authDebugError(`❌ [AUTH-BACKEND] Access denied for ${user.email}. User groups: [${userGroups.join(', ')}], Required groups: [${allAuthorizedGroups.join(', ')}]`);
        return {
          isValid: false,
          error: `Access denied. User ${user.email} is not a member of any authorized Azure AD groups (${allAuthorizedGroups.join(', ')}). Please contact your administrator.`
        };
      }

      if (skipGroupValidation) {
        authDebugWarn(`⚠️ [AUTH-BACKEND] Group validation is DISABLED. Allowing user ${user.email} without group check.`);
        user.isAdmin = true; // Grant admin rights when group validation is disabled
      }

      // Check if user is admin based on admin-specific groups (use group IDs)
      const adminGroupIds = authorizedAdminGroups.map(g => {
        // Check if it's already a GUID format
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g)) {
          return g;
        }
        // Otherwise try to map it
        return groupNameToId[g] || g;
      });

      authDebug(`🔍 [AUTH-BACKEND] Admin groups to check: [${authorizedAdminGroups.join(', ')}]`);
      authDebug(`🔍 [AUTH-BACKEND] Admin group IDs to check: [${adminGroupIds.join(', ')}]`);

      // Check if user is in admin groups
      const isInAdminGroup = userGroups.some((group: string) =>
        adminGroupIds.includes(group)
      );

      user.isAdmin = isInAdminGroup || skipGroupValidation || isExternalAdmin;
      
      authDebug(`✅ [AUTH-BACKEND] User ${user.email} authorized successfully. Admin status: ${user.isAdmin}`);

      // Cache the token
      this.tokenCache.set(token, {
        user,
        exp: decoded.exp,
        validatedAt: Date.now()
      });

      return {
        isValid: true,
        user,
        claims: decoded
      };
    } catch (error: any) {
      return {
        isValid: false,
        error: `Token validation failed: ${error.message}`
      };
    }
  }

  /**
   * Validate a token for a SENSITIVE mutating operation (NIST IA-2(1)/(2)).
   *
   * Performs the standard signature/issuer/audience/tenant/exp validation,
   * then ADDITIONALLY enforces MFA freshness: even an otherwise-valid,
   * non-expired token is rejected for sensitive create/delete/deploy
   * operations if the user's last authentication (`auth_time`, falling back
   * to `iat`) is older than the configured `MFA_FRESHNESS_SECS` window. The
   * caller should surface this as a re-authentication challenge, not a hard
   * logout — the session is still valid, the user just needs to re-prove MFA
   * before the privileged action proceeds.
   *
   * P-002: when `ADMIN_MFA_ENFORCED=true`, this ALSO verifies the MFA CLAIM
   * (`amr`/`acr` — proving multi-factor actually occurred, not merely a fresh
   * single-factor password sign-in). The claim check is opt-in so existing
   * non-FedRAMP deployments are unaffected; the time-based freshness gate is
   * always on (unchanged behavior).
   *
   * Read-only / non-sensitive operations continue to use validateToken().
   */
  async validateTokenForSensitiveOp(token: string): Promise<TokenValidationResult> {
    const result = await this.validateToken(token);
    if (!result.isValid) {
      return result;
    }

    // The token cache short-circuits validateToken without re-surfacing
    // `claims`. Decode locally (signature already validated above) so the
    // freshness gate works on both cache-hit and cache-miss paths.
    const claims = result.claims ?? this.decodeClaimsUnsafe(token);

    // P-002: MFA CLAIM verification (amr/acr). Opt-in via ADMIN_MFA_ENFORCED so
    // it only activates in deployments configured to require it. Inlined env
    // read (not the unifiedAuth helper) to avoid a middleware→auth circular
    // import; both read the same `ADMIN_MFA_ENFORCED` flag.
    if (process.env.ADMIN_MFA_ENFORCED === 'true' && !tokenHasMfaClaim(claims)) {
      return {
        isValid: false,
        error:
          'Multi-factor authentication is required for this sensitive operation. ' +
          'Your session was not established with MFA (no `amr`/`acr` MFA claim). ' +
          'Please re-authenticate with MFA and retry.',
        claims,
      };
    }

    if (!isAuthFreshForSensitiveOp(claims)) {
      const windowSecs = getMfaFreshnessSeconds();
      return {
        isValid: false,
        error: `Re-authentication required: this operation is sensitive and ` +
          `your authentication is older than the ${windowSecs}s MFA freshness ` +
          `window. Please re-authenticate (MFA) and retry.`,
        claims
      };
    }

    return result;
  }

  /**
   * Decode JWT claims WITHOUT signature verification. Only used after
   * validateToken() has already cryptographically verified the token, to
   * recover the `auth_time`/`iat` claims on the cache-hit path. Returns null
   * on malformed input.
   */
  private decodeClaimsUnsafe(token: string): Record<string, any> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
      return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Extract user from request
   */
  async extractUserFromToken(request: FastifyRequest): Promise<UserContext | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    const result = await this.validateToken(token);
    
    return result.isValid ? result.user! : null;
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenRefreshResult> {
    try {
      const tokens = await this.exchangeRefreshToken(refreshToken);
      return {
        success: true,
        tokens
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get user permissions from Microsoft Graph
   */
  async getUserPermissions(user: UserContext, accessToken: string): Promise<any> {
    try {
      return await this.callGraphAPI('/me/memberOf', accessToken);
    } catch (error) {
      // Graph failure object may carry response/PII detail — gate behind AUTH_DEBUG (#1175).
      authDebugError('Failed to get user permissions:', error);
      return {
        canAccessAzureResources: false,
        subscriptions: [],
        resourceGroups: []
      };
    }
  }

  /**
   * Get user group memberships from Microsoft Graph
   * @param accessToken - The access token for Microsoft Graph
   * @returns Array of group display names the user belongs to
   */
  async getGroupMemberships(accessToken: string): Promise<string[]> {
    try {
      const memberOf = await this.callGraphAPI('/me/memberOf?$select=id,displayName', accessToken);
      if (!memberOf || !memberOf.value) {
        return [];
      }

      // Extract both group IDs and display names
      // This allows checking against both GUIDs and display names in configuration
      const groups: string[] = [];
      memberOf.value
        .filter((item: any) => item['@odata.type'] === '#microsoft.graph.group')
        .forEach((group: any) => {
          if (group.id) groups.push(group.id);
          if (group.displayName) groups.push(group.displayName);
        });

      this.logger.debug({ groups }, 'User group memberships (IDs and names)');

      return groups;
    } catch (error) {
      // Graph failure object may carry response/PII detail — gate behind AUTH_DEBUG (#1175).
      authDebugError('Failed to get user group memberships:', error);
      return [];
    }
  }

  /**
   * Check if user is a member of the admin group
   * @param accessToken - The access token for Microsoft Graph
   * @param tokenGroups - Optional groups from JWT token as fallback
   * @returns True if user is in admin groups
   */
  async isUserAdmin(accessToken: string, tokenGroups?: string[]): Promise<boolean> {
    // Dev escape valve — same gate as validateToken at L332. When group
    // validation is disabled (k3s dev / no AAD groups enumerated), every
    // tenant-authenticated user is treated as admin. Without this branch,
    // routes/auth.ts:181 overwrites the validateToken-set isAdmin=true
    // back to false when a Graph token is present (SSO callback path).
    if (process.env.SKIP_GROUP_VALIDATION === 'true') {
      return true;
    }
    const graphGroups = await this.getGroupMemberships(accessToken);

    // Use environment variables for group configuration - NO HARDCODED FALLBACKS
    const authorizedGroupsEnv = process.env.VITE_AZURE_AD_AUTHORIZED_GROUPS || process.env.AZURE_AD_AUTHORIZED_GROUPS;
    const configuredUserGroups = authorizedGroupsEnv?.split(',').map(g => g.trim()) || [];
    const configuredAdminGroups = process.env.AZURE_ADMIN_GROUPS?.split(',').map(g => g.trim()) || [];
    const authorizedGroups = [...configuredUserGroups, ...configuredAdminGroups];

    // Combine Graph API groups with token groups as fallback
    const allGroups = [...graphGroups];
    if (tokenGroups && tokenGroups.length > 0) {
      allGroups.push(...tokenGroups);
    }

    // Remove duplicates
    const uniqueGroups = [...new Set(allGroups)];

    // Debug logging for admin group detection
    this.logger.info({
      graphGroups,
      tokenGroups: tokenGroups || [],
      allGroups: uniqueGroups,
      configuredAdminGroups,
      azureAdminGroupsEnv: process.env.AZURE_ADMIN_GROUPS,
      groupMatchFound: uniqueGroups.some(group => configuredAdminGroups.includes(group))
    }, 'Admin group detection debug');

    // Check if user has admin privileges based on admin groups (from either source)
    const isGroupAdmin = uniqueGroups.some(group => configuredAdminGroups.includes(group));

    // Also check EXTERNAL_ADMIN_EMAILS (same logic as validateToken)
    const externalAdmins = (process.env.EXTERNAL_ADMIN_EMAILS || '').split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);
    // Try to extract email from token for external admin check
    let isExternalAdmin = false;
    try {
      const decoded = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
      const email = (decoded.preferred_username || decoded.email || decoded.upn || '').toLowerCase();
      isExternalAdmin = email.length > 0 && externalAdmins.includes(email);
    } catch { /* token parse failed, skip external admin check */ }

    const isAdmin = isGroupAdmin || isExternalAdmin;

    this.logger.info({
      isAdmin,
      isGroupAdmin,
      isExternalAdmin,
      graphGroupCount: graphGroups.length,
      tokenGroupCount: tokenGroups?.length || 0,
      totalGroupCount: uniqueGroups.length,
      adminGroupCount: configuredAdminGroups.length
    }, 'Admin determination result');

    return isAdmin;
  }

  /**
   * Check if user has a specific role
   */
  userHasRole(user: UserContext, role: string): boolean {
    return user.roles?.includes(role) || false;
  }

  /**
   * Check if user has any of the specified roles
   */
  userHasAnyRole(user: UserContext, roles: string[]): boolean {
    return roles.some(role => this.userHasRole(user, role));
  }

  /**
   * Check if user has all specified roles
   */
  userHasAllRoles(user: UserContext, roles: string[]): boolean {
    return roles.every(role => this.userHasRole(user, role));
  }

  /**
   * Generate Azure AD authentication URL for OAuth2 flow (confidential client)
   */
  async getAuthUrl(state?: string): Promise<string> {
    // No PKCE needed for confidential client (Web app)
    const stateValue = state || 'auth_request_' + Date.now();
    
    this.logger.info({ 
      state: stateValue,
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      scopes: this.config.scopes,
      clientType: 'confidential'
    }, 'Generating auth URL for confidential client');
    
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      response_mode: 'query',
      scope: this.config.scopes.join(' '),
      state: stateValue
      // No PKCE parameters for confidential client
    });

    const authUrl = `${this.config.authority}/oauth2/v2.0/authorize?${params.toString()}`;
    
    this.logger.info({ 
      authUrl: authUrl.substring(0, 100) + '...',
      authority: this.config.authority
    }, 'Generated Azure AD auth URL');

    return authUrl;
  }
  
  /**
   * Generate a cryptographically random code verifier for PKCE
   */
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }
  
  /**
   * Generate the code challenge from the verifier
   */
  private generateCodeChallenge(verifier: string): string {
    return crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
  }

  /**
   * Exchange authorization code for access token (confidential client)
   */
  async exchangeCodeForToken(code: string, state?: string): Promise<any> {
    const params: any = {
      client_id: this.config.clientId,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' ')
    };

    // Only include client_secret for confidential clients
    if (this.config.clientSecret) {
      params.client_secret = this.config.clientSecret;
    }

    const urlParams = new URLSearchParams(params);

    // Debug logging to verify params
    this.logger.info({
      state,
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      hasClientSecret: !!this.config.clientSecret,
      clientType: this.config.clientSecret ? 'confidential' : 'public',
      paramsBeingSent: Object.keys(params),
      bodyContent: urlParams.toString().substring(0, 200) // Log first 200 chars of body
    }, `Using ${this.config.clientSecret ? 'confidential' : 'public'} client flow for token exchange`);

    const tokenUrl = `${this.config.authority}/oauth2/v2.0/token`;
    this.logger.info({ 
      tokenUrl,
      clientId: this.config.clientId,
      redirectUri: this.config.redirectUri,
      clientType: 'confidential',
      codeLength: code.length,
      authority: this.config.authority
    }, 'Exchanging authorization code for token');

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: urlParams.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails: any = { text: errorText };
      try {
        errorDetails = JSON.parse(errorText);
      } catch (e) {
        // Keep as text if not JSON
      }
      
      this.logger.error({ 
        status: response.status,
        statusText: response.statusText,
        error: errorDetails,
        clientId: this.config.clientId,
        redirectUri: this.config.redirectUri,
        clientType: 'confidential',
        state,
        hasClientSecret: !!this.config.clientSecret
      }, 'Azure AD token exchange failed');
      
      // Check for specific authentication errors
      if (errorDetails.error === 'invalid_client') {
        this.logger.error('Client authentication failed - check client_id and client_secret');
      }
      
      throw new Error(`Token exchange failed: ${JSON.stringify(errorDetails)}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
      id_token?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope,
      idToken: data.id_token
    };
  }

  /**
   * Get JWKS from Azure AD
   */
  private async getJWKS(): Promise<any> {
    if (this.jwksCache && this.jwksCacheExpiry > Date.now()) {
      return this.jwksCache;
    }

    const response = await fetch(`${this.config.authority}/discovery/v2.0/keys`);
    if (!response.ok) {
      throw new Error('Failed to fetch JWKS');
    }

    this.jwksCache = await response.json();
    this.jwksCacheExpiry = Date.now() + parseInt(process.env.JWKS_CACHE_EXPIRY || '3600000'); // Cache for 1 hour
    
    return this.jwksCache;
  }

  /**
   * Exchange refresh token for new tokens
   */
  private async exchangeRefreshToken(refreshToken: string): Promise<any> {
    const params: any = {
      client_id: this.config.clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: this.config.scopes.join(' ')
    };

    // Only include client_secret for confidential clients
    if (this.config.clientSecret) {
      params.client_secret = this.config.clientSecret;
    }

    const urlParams = new URLSearchParams(params);

    const response = await fetch(`${this.config.authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: urlParams.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  }

  /**
   * Call Microsoft Graph API
   */
  private async callGraphAPI(endpoint: string, accessToken: string): Promise<any> {
    const response = await fetch(`${process.env.AZURE_GRAPH_API_URL || 'https://graph.microsoft.com/v1.0'}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Graph API call failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Clean up expired tokens from cache
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now() / 1000;
    for (const [token, cached] of this.tokenCache.entries()) {
      if (cached.exp <= now) {
        this.tokenCache.delete(token);
      }
    }
  }
}

/**
 * Standalone function to extract user from token
 */
export function extractUserFromToken(request: FastifyRequest): UserContext | null {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.decode(token) as any;
    
    if (!decoded) {
      return null;
    }

    return {
      userId: decoded.oid || decoded.sub,
      tenantId: decoded.tid,
      email: decoded.email || decoded.upn || decoded.preferred_username,
      name: decoded.name,
      roles: decoded.roles || []
    };
  } catch (error) {
    // Decode error is derived from a raw bearer token — gate behind AUTH_DEBUG (#1175).
    authDebugError('Failed to decode token:', error);
    return null;
  }
}


