/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  OpenAgentic Enterprise — Runtime Identity Directory (SSO) registry
 *  Copyright © Agenticwork™ LLC. All rights reserved.
 *
 *  ENTERPRISE SOFTWARE — licensed ONLY under the OpenAgentic Enterprise License
 *  (/ee/LICENSE), NOT the repository's Apache-2.0 license. A paid Agenticwork LLC
 *  subscription is required to use this in production. Reading the source grants no
 *  license. Using, selling, hosting as a service, redistributing, or modifying it
 *  without a subscription — or removing the license gate — is a breach of
 *  /ee/LICENSE §4 and an infringement of Agenticwork's copyright.
 *  Licensing: licensing@agenticwork.io
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
/**
 * SSO Auth Routes — runtime, DB-driven, per-directory OAuth/OIDC handshake.
 *
 * The login/callback surface for the runtime identity-directory registry. Every
 * enabled `identity_directories` row gets one server-initiated OAuth handshake;
 * the browser never receives a clientId/tenant/secret — only a `loginUrl` to a
 * server endpoint. This is the deliverable that kills the baked
 * `VITE_AZURE_*` / browser client-id (plan §3c / §4b):
 *
 *   GET  /api/auth/directories                 PUBLIC, redacted directory list
 *   GET  /api/auth/sso/:directoryId/login      → IdP authorize (HMAC state)
 *   GET  /api/auth/sso/:directoryId/callback   → exchange → validate → JWT
 *
 * Plus thin LEGACY aliases that resolve the single seeded directory of a type,
 * so already-registered redirect URIs + existing bookmarks keep working during
 * the env→DB transition (plan §3c last bullet):
 *
 *   GET  /api/auth/microsoft/login | callback  → seeded azure-ad directory
 *   GET  /api/auth/google/login    | callback  → seeded google directory
 *
 * SECURITY / invariants honored verbatim from the design + memory:
 *   - The minted token is the UNCHANGED local HS256 JWT with `payload.userId`
 *     PRESENT (the documented userId-keying gotcha — a sub-only JWT 401s on the
 *     Azure branch of tokenValidator). It additionally carries `directory_id` +
 *     resolved `roles`, which are purely additive claims.
 *   - Group→role/admin resolution goes through the shared, pure
 *     `mapGroupsToRoles` so Azure + generic-OIDC map identically.
 *   - The IdP access/id/refresh tokens are stored in `userAuthToken` so OBO is
 *     unaffected (AzureOBOService operates on the stored access token).
 *   - `state` is HMAC-signed (CSRF) and encodes the directoryId so the callback
 *     resolves the right directory without trusting a cookie alone.
 *
 * NOTE: this file is intentionally NOT registered yet — the next agent wires it
 * into plugins/auth.plugin.ts (plan task 8 "Register in auth.plugin.ts").
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { getRedisClient } from '../utils/redis-client.js';
import { logAuthEvent } from '../services/audit/authAuditLogger.js';
import { mapGroupsToRoles } from '../services/identity/mapGroupsToRoles.js';
import {
  getIdentityDirectoryService,
  type DirectoryEntry,
} from '../services/identity/IdentityDirectoryService.js';
import type { DirectoryConfig } from '../services/identity/IdentityDirectoryConfigService.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Resolve the JWT secret the same way every other auth path does (HS256). */
function requireJwtSecret(): string {
  return (
    process.env.JWT_SECRET ||
    process.env.SIGNING_SECRET ||
    (() => {
      throw new Error('FATAL: JWT_SECRET must be set');
    })()
  );
}

/** FRONTEND_URL is required for the post-login redirect (matches auth.ts). */
function frontendUrl(): string {
  const url = process.env.FRONTEND_URL;
  if (!url) {
    throw new Error('FRONTEND_URL environment variable is required');
  }
  return url.replace(/\/+$/, '');
}

/**
 * Sign an opaque, tamper-evident `state` value carrying the directoryId + a
 * random nonce. HMAC-SHA256 over the payload with JWT_SECRET → CSRF protection
 * without a server-side store. The callback re-derives + constant-time-compares.
 */
function signState(directoryId: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${directoryId}.${nonce}.${Date.now()}`;
  const sig = crypto
    .createHmac('sha256', requireJwtSecret())
    .update(payload)
    .digest('base64url');
  // base64url(payload) . sig — both URL-safe
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/**
 * Verify a signed state and extract the directoryId. Returns null on any
 * tampering, malformed input, or signature mismatch. Constant-time compare.
 */
function verifyState(state: string | undefined): { directoryId: string } | null {
  if (!state || typeof state !== 'string') return null;
  const dot = state.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = crypto
    .createHmac('sha256', requireJwtSecret())
    .update(payload)
    .digest('base64url');
  // Length-guard before timingSafeEqual (it throws on length mismatch).
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  const directoryId = payload.split('.')[0];
  if (!directoryId) return null;
  return { directoryId };
}

/**
 * Is local username/password login enabled? Mirrors the auth.plugin `ssoActive`
 * gate inversion — local login is suppressed when an SSO mode is active. Once
 * the auth.plugin `ssoActive` is switched to the DB count (plan task 11) this
 * stays consistent: any enabled directory implies SSO is available, and the
 * env flag still governs whether the local password form is offered.
 */
function localLoginEnabled(): boolean {
  const mode = (process.env.AUTH_MODE || process.env.AUTH_PROVIDER || 'local').toLowerCase();
  // 'hybrid'/'both'/'all' explicitly keep local login alongside SSO.
  if (['hybrid', 'both', 'all', 'local'].includes(mode)) return true;
  // Pure SSO modes suppress the local password form.
  return !['azure-ad', 'azuread', 'google'].includes(mode);
}

/** Map a directory type to a stable icon hint the login page can switch on. */
function iconHintForType(type: string): string {
  switch (type) {
    case 'azure-ad':
      return 'microsoft';
    case 'google-oidc':
    case 'google':
      return 'google';
    case 'generic-oidc':
      return 'openid';
    default:
      return 'key';
  }
}

/** The per-directory server login URL the browser is told to navigate to. */
function loginUrlFor(directoryId: string): string {
  return `/api/auth/sso/${directoryId}/login`;
}

/**
 * Resolve a directory entry, returning a typed not-found instead of throwing so
 * handlers can render a clean redirect/error. Reads the live registry singleton.
 */
function resolveDirectory(directoryId: string): DirectoryEntry | null {
  const svc = getIdentityDirectoryService();
  if (!svc) return null;
  return svc.getDirectory(directoryId) ?? null;
}

/**
 * Find the single ENABLED directory of a given type for the legacy aliases.
 * Prefers the lowest-priority (first) one if more than one of a type exists.
 */
function resolveSeededDirectoryByType(type: string): DirectoryEntry | null {
  const svc = getIdentityDirectoryService();
  if (!svc) return null;
  const candidates = svc
    .listEnabled()
    .filter((d) => d.type === type || (type === 'google-oidc' && d.type === 'google'));
  if (candidates.length === 0) return null;
  // listEnabled() is already priority-sorted; take the first.
  return svc.getDirectory(candidates[0].id) ?? null;
}

/**
 * Invoke whichever auth-url method the strategy instance exposes. Azure exposes
 * async `getAuthUrl(state)`; Google/Generic expose sync `generateAuthUrl(state)`.
 * The DirectoryStrategyInstance contract allows either — normalize to a string.
 */
async function buildAuthUrl(entry: DirectoryEntry, state: string): Promise<string> {
  const inst: any = entry.instance;
  if (typeof inst.getAuthUrl === 'function') {
    return await inst.getAuthUrl(state);
  }
  if (typeof inst.generateAuthUrl === 'function') {
    return await inst.generateAuthUrl(state);
  }
  throw new Error(
    `Directory "${entry.config.name}" (${entry.type}) strategy exposes no getAuthUrl/generateAuthUrl`,
  );
}

/**
 * The normalized shape every strategy callback resolves to so the JWT-mint path
 * below is identical across IdP types.
 */
interface NormalizedSsoUser {
  /** Stable subject from the IdP (oid/sub). */
  subject: string;
  email: string;
  name?: string;
  /** Group claims (GUIDs/names) used for mapGroupsToRoles. */
  groups: string[];
  /** Tokens to persist for OBO / downstream tool calls. */
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  /** Token expiry, if the IdP returned one. */
  expiresAt?: Date;
  avatarUrl?: string;
}

/**
 * Drive a directory's strategy through code→token→validated-user, normalizing
 * Azure vs Google vs Generic-OIDC into one shape. Throws on any failure; the
 * caller renders a redirect to the frontend error page.
 */
async function exchangeAndValidate(
  entry: DirectoryEntry,
  code: string,
  state: string | undefined,
): Promise<NormalizedSsoUser> {
  const inst: any = entry.instance;
  const cfg = entry.config;

  // --- Azure AD ---------------------------------------------------------
  if (entry.type === 'azure-ad') {
    const tokenResponse = await inst.exchangeCodeForToken(code, state);
    if (!tokenResponse || !tokenResponse.idToken) {
      throw new Error('Azure AD: failed to obtain ID token');
    }
    const validation = await inst.validateToken(tokenResponse.idToken);
    if (!validation?.isValid || !validation.user) {
      throw new Error(validation?.error || 'Azure AD token validation failed');
    }
    const user = validation.user;

    // ID tokens omit groups by default — enrich from Graph when we have an
    // access token (mirrors auth.ts microsoft/callback). Best-effort.
    let groups: string[] = Array.isArray(user.groups) ? user.groups : [];
    if (tokenResponse.accessToken && typeof inst.getGroupMemberships === 'function') {
      try {
        const fresh = await inst.getGroupMemberships(tokenResponse.accessToken);
        if (Array.isArray(fresh) && fresh.length > 0) groups = fresh;
      } catch {
        // keep token groups
      }
    }

    return {
      subject: user.userId,
      email: user.email,
      name: user.name,
      groups,
      accessToken: tokenResponse.accessToken,
      idToken: tokenResponse.idToken,
      refreshToken: tokenResponse.refreshToken,
      expiresAt: tokenResponse.expiresOn ? new Date(tokenResponse.expiresOn) : undefined,
    };
  }

  // --- Google OIDC ------------------------------------------------------
  if (entry.type === 'google-oidc' || entry.type === 'google') {
    const tokens = await inst.exchangeCodeForTokens(code);
    const validation = await inst.validateIdToken(tokens.idToken);
    if (!validation?.isValid || !validation.user) {
      throw new Error(validation?.error || 'Google token validation failed');
    }
    const gUser = validation.user;
    // Google ID tokens carry no group claims; allowed-domains gating already
    // happened inside validateIdToken. Use the hosted domain as a pseudo-group
    // so group_role_mappings keyed on a domain still works.
    const groups: string[] = Array.isArray(gUser.groups) ? gUser.groups : [];
    if (gUser.hostedDomain && !groups.includes(gUser.hostedDomain)) {
      groups.push(gUser.hostedDomain);
    }
    return {
      subject: gUser.userId,
      email: gUser.email,
      name: gUser.name,
      groups,
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : undefined,
      avatarUrl: gUser.picture,
    };
  }

  // --- Generic OIDC -----------------------------------------------------
  if (entry.type === 'generic-oidc') {
    // GenericOidcStrategy (plan task 6) mirrors Google's surface.
    const tokens = await inst.exchangeCodeForTokens(code);
    const validation = await inst.validateIdToken(tokens.idToken);
    if (!validation?.isValid || !validation.user) {
      throw new Error(validation?.error || 'Generic OIDC token validation failed');
    }
    const u = validation.user;
    // The group claim is configurable per-directory; the strategy is expected
    // to surface it on `user.groups` already, but fall back to reading the
    // configured claim off the raw claims if present.
    let groups: string[] = Array.isArray(u.groups) ? u.groups : [];
    const claimName = cfg.groupClaim || 'groups';
    if (groups.length === 0 && validation.claims && Array.isArray(validation.claims[claimName])) {
      groups = validation.claims[claimName];
    }
    return {
      subject: u.userId || u.sub,
      email: u.email,
      name: u.name,
      groups,
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : undefined,
    };
  }

  throw new Error(`Unsupported directory type for callback: ${entry.type}`);
}

/**
 * The shared post-validation path: map groups→roles, upsert the local user,
 * persist IdP tokens (for OBO), mint the UNCHANGED local HS256 JWT (with
 * `payload.userId` + additive `directory_id`/`roles`), and redirect to the
 * frontend. Returns the redirect target. Throws to let the caller render the
 * error redirect.
 */
async function completeSsoLogin(
  entry: DirectoryEntry,
  ssoUser: NormalizedSsoUser,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string> {
  const cfg: DirectoryConfig = entry.config;
  const logger = request.log;

  // 1) Group → role/admin resolution (pure, shared across IdP types).
  const decision = mapGroupsToRoles(ssoUser.groups, {
    authorizedGroups: cfg.authorizedGroups,
    adminGroups: cfg.adminGroups,
    groupRoleMappings: cfg.groupRoleMappings,
    allowAllAuthenticated: cfg.allowAllAuthenticated,
    externalAdminEmails: cfg.externalAdminEmails,
    email: ssoUser.email,
  });

  if (!decision.authorized) {
    // Login gate failed — record + bounce to the access-denied page.
    await logAuthEvent({
      event: 'login_failed',
      provider: entry.type,
      success: false,
      userEmail: ssoUser.email,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      detail: { reason: 'group_gate_denied', directoryId: cfg.id, directory: cfg.name },
    });
    return `${frontendUrl()}/auth/access-denied?reason=${encodeURIComponent('not_authorized')}`;
  }

  const isAdmin = decision.isAdmin;
  const roles = decision.roles;

  // 2) Upsert the local user (idempotent by email — matches google-auth).
  //    Admin groups always carry the synthetic 'admin' group, mirroring the
  //    Azure callback's `groups: isAdmin ? ['admin', ...groups] : groups`.
  const persistedGroups = isAdmin
    ? Array.from(new Set(['admin', ...ssoUser.groups]))
    : ssoUser.groups;

  const user = await prisma.user.upsert({
    where: { email: ssoUser.email },
    update: {
      name: ssoUser.name || ssoUser.email,
      is_admin: isAdmin,
      is_active: true,
      groups: persistedGroups,
      oauth_provider: entry.type,
      oauth_id: ssoUser.subject,
      ...(ssoUser.avatarUrl ? { avatar_url: ssoUser.avatarUrl } : {}),
      last_login_at: new Date(),
      updated_at: new Date(),
    },
    create: {
      email: ssoUser.email,
      name: ssoUser.name || ssoUser.email,
      is_admin: isAdmin,
      is_active: true,
      groups: persistedGroups,
      oauth_provider: entry.type,
      oauth_id: ssoUser.subject,
      ...(ssoUser.avatarUrl ? { avatar_url: ssoUser.avatarUrl } : {}),
      theme: 'system',
      force_password_change: false,
      last_login_at: new Date(),
    },
  });

  // 🔒 SECURITY: blocked accounts never get a session (matches auth.ts).
  if ((user as any).is_locked) {
    logger.warn(
      { userId: user.id, email: user.email },
      '[AUTH-SSO] BLOCKED: locked user attempted SSO login',
    );
    await logAuthEvent({
      event: 'login_failed',
      provider: entry.type,
      success: false,
      userId: user.id,
      userEmail: user.email,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      detail: { reason: 'account_locked', directoryId: cfg.id },
    });
    return `${frontendUrl()}/login?error=account_locked&message=${encodeURIComponent(
      'Your account has been locked. Please contact an administrator.',
    )}`;
  }

  // 3) Persist IdP tokens for OBO / downstream tool calls (unchanged OBO path).
  if (ssoUser.accessToken) {
    try {
      const expiresAt = ssoUser.expiresAt || new Date(Date.now() + 3600000);
      await prisma.userAuthToken.upsert({
        where: { user_id: user.id },
        update: {
          access_token: ssoUser.accessToken,
          id_token: ssoUser.idToken || null,
          refresh_token: ssoUser.refreshToken || null,
          expires_at: expiresAt,
          updated_at: new Date(),
        },
        create: {
          user_id: user.id,
          access_token: ssoUser.accessToken,
          id_token: ssoUser.idToken || null,
          refresh_token: ssoUser.refreshToken || null,
          expires_at: expiresAt,
        },
      });
    } catch (tokenErr) {
      logger.error(
        { error: tokenErr, userId: user.id },
        '[AUTH-SSO] Failed to persist IdP tokens (non-fatal — OBO may be unavailable)',
      );
    }
  }

  // 4) Mint the UNCHANGED local HS256 JWT. `userId` is PRESENT (the documented
  //    userId-keying invariant). `directory_id` + `roles` are additive claims.
  const JWT_SECRET = requireJwtSecret();
  const apiToken = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      isAdmin,
      directory_id: cfg.id,
      roles,
    },
    JWT_SECRET,
    { expiresIn: '24h' },
  );

  // 5) Redirect via a short-lived Redis session id to avoid a giant JWT in the
  //    URL (matches the Azure callback in auth.ts). Falls back to the token in
  //    the query string if Redis is unavailable.
  let redirectUrl: string;
  try {
    const redisClient = getRedisClient();
    const sessionId = jwt.sign(
      { type: 'auth-session', userId: user.id },
      JWT_SECRET,
      { expiresIn: '10m' },
    );
    const stored = await redisClient.set(`auth-session:${sessionId}`, apiToken, 600);
    if (stored) {
      redirectUrl = `${frontendUrl()}/auth/callback?session=${encodeURIComponent(
        sessionId,
      )}&success=true`;
    } else {
      redirectUrl = `${frontendUrl()}/auth/callback?token=${encodeURIComponent(
        apiToken,
      )}&success=true`;
    }
  } catch {
    redirectUrl = `${frontendUrl()}/auth/callback?token=${encodeURIComponent(
      apiToken,
    )}&success=true`;
  }

  // 6) Audit the successful SSO login into the unified auth feed.
  await logAuthEvent({
    event: 'sso_login',
    provider: entry.type,
    success: true,
    userId: user.id,
    userEmail: user.email,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
    detail: { isAdmin, roles, directoryId: cfg.id, directory: cfg.name },
  });

  logger.info(
    { userId: user.id, directoryId: cfg.id, type: entry.type, isAdmin },
    '[AUTH-SSO] SSO login complete — redirecting to frontend',
  );
  return redirectUrl;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const authSsoRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  /**
   * GET /api/auth/directories  — PUBLIC
   *
   * The login page fetches this on mount and renders one button per directory.
   * NEVER returns clientId/clientSecret/tenant — only what a button needs. This
   * is the endpoint that lets the browser drop every baked Azure client-id: the
   * whole OAuth handshake is server-initiated via `loginUrl`.
   */
  fastify.get('/api/auth/directories', async (_request, reply) => {
    const svc = getIdentityDirectoryService();
    const directories = svc
      ? svc.listEnabled().map((d) => ({
          id: d.id,
          type: d.type,
          displayName: d.displayName,
          loginUrl: loginUrlFor(d.id),
          iconHint: iconHintForType(d.type),
        }))
      : [];

    return reply.send({
      directories,
      // Meta flag the login page uses to gate the local email/password form.
      localEnabled: localLoginEnabled(),
    });
  });

  /**
   * GET /api/auth/sso/:directoryId/login
   *
   * Resolve the directory, build an HMAC-signed `state` that encodes the
   * directoryId, and redirect to that directory's IdP authorize endpoint.
   */
  fastify.get<{ Params: { directoryId: string } }>(
    '/api/auth/sso/:directoryId/login',
    async (request, reply) => {
      const { directoryId } = request.params;
      const entry = resolveDirectory(directoryId);
      if (!entry) {
        logger.warn({ directoryId }, '[AUTH-SSO] login: directory not found / not enabled');
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent('Unknown identity directory')}`,
        );
      }

      try {
        const state = signState(directoryId);
        // Belt-and-braces CSRF: also drop the state in a short-lived cookie so a
        // strategy that prefers cookie verification (e.g. generic-oidc) can use
        // it. The callback's primary check is the HMAC, so this is additive.
        const isSecure = request.protocol === 'https' || process.env.NODE_ENV === 'production';
        try {
          (reply as any).setCookie?.('oa_sso_state', state, {
            httpOnly: true,
            secure: isSecure,
            sameSite: isSecure ? 'none' : 'lax',
            maxAge: 600,
            path: '/',
          });
        } catch {
          // cookie plugin not present — HMAC state alone is sufficient
        }

        const authUrl = await buildAuthUrl(entry, state);
        logger.info(
          { directoryId, type: entry.type },
          '[AUTH-SSO] Redirecting to IdP authorize endpoint',
        );
        return reply.redirect(authUrl);
      } catch (error: any) {
        logger.error(
          { error: error?.message, directoryId },
          '[AUTH-SSO] Failed to build IdP auth URL',
        );
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent(error?.message || 'login_failed')}`,
        );
      }
    },
  );

  /**
   * GET /api/auth/sso/:directoryId/callback
   *
   * The IdP redirect target. Verify state → exchange code → validate IdP token →
   * mapGroupsToRoles → mint the UNCHANGED local JWT (userId + directory_id +
   * roles) → store IdP tokens → redirect to FRONTEND_URL.
   */
  fastify.get<{
    Params: { directoryId: string };
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>('/api/auth/sso/:directoryId/callback', async (request, reply) => {
    const { directoryId } = request.params;
    const { code, state, error, error_description } = request.query;

    if (error) {
      logger.error({ directoryId, error, error_description }, '[AUTH-SSO] IdP returned an error');
      await logAuthEvent({
        event: 'login_failed',
        provider: 'sso',
        success: false,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        detail: { reason: 'idp_error', directoryId, error: error_description || error },
      });
      return reply.redirect(
        `${frontendUrl()}/auth/error?error=${encodeURIComponent(error_description || error)}`,
      );
    }

    if (!code) {
      return reply.redirect(
        `${frontendUrl()}/auth/error?error=${encodeURIComponent('Missing authorization code')}`,
      );
    }

    // CSRF: the signed state must verify AND encode THIS directoryId.
    const verified = verifyState(state);
    if (!verified || verified.directoryId !== directoryId) {
      logger.warn(
        { directoryId, stateDir: verified?.directoryId },
        '[AUTH-SSO] State verification failed (possible CSRF)',
      );
      await logAuthEvent({
        event: 'login_failed',
        provider: 'sso',
        success: false,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        detail: { reason: 'state_mismatch', directoryId },
      });
      return reply.redirect(
        `${frontendUrl()}/auth/error?error=${encodeURIComponent(
          'Invalid state - possible CSRF attack',
        )}`,
      );
    }

    try {
      (reply as any).clearCookie?.('oa_sso_state', { path: '/' });
    } catch {
      // no-op
    }

    const entry = resolveDirectory(directoryId);
    if (!entry) {
      return reply.redirect(
        `${frontendUrl()}/auth/error?error=${encodeURIComponent('Unknown identity directory')}`,
      );
    }

    try {
      const ssoUser = await exchangeAndValidate(entry, code, state);
      const redirectUrl = await completeSsoLogin(entry, ssoUser, request, reply);
      return reply.redirect(redirectUrl);
    } catch (error: any) {
      logger.error(
        { error: error?.message, stack: error?.stack, directoryId },
        '[AUTH-SSO] Callback processing failed',
      );
      await logAuthEvent({
        event: 'login_failed',
        provider: entry.type,
        success: false,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        detail: { reason: 'callback_error', directoryId, message: error?.message },
      });
      return reply.redirect(
        `${frontendUrl()}/auth/error?error=${encodeURIComponent(
          error?.message || 'Authentication failed',
        )}`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // LEGACY ALIASES — resolve the single seeded directory of a type so already-
  // registered redirect URIs + bookmarks keep working during env→DB transition.
  // These delegate to the generic login/callback by resolving the directoryId
  // for the requested type, then issuing the same handshake. (plan §3c)
  // -------------------------------------------------------------------------

  /** Build a typed-alias login handler that resolves the seeded directory. */
  function aliasLogin(type: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const entry = resolveSeededDirectoryByType(type);
      if (!entry) {
        logger.warn({ type }, `[AUTH-SSO] alias login: no enabled ${type} directory`);
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent(
            `No ${type} directory configured`,
          )}`,
        );
      }
      // Reuse the canonical login path semantics.
      try {
        const stateVal = signState(entry.config.id);
        const authUrl = await buildAuthUrl(entry, stateVal);
        return reply.redirect(authUrl);
      } catch (error: any) {
        logger.error({ error: error?.message, type }, '[AUTH-SSO] alias login failed');
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent(error?.message || 'login_failed')}`,
        );
      }
    };
  }

  /** Build a typed-alias callback handler that resolves the seeded directory. */
  function aliasCallback(type: string) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };
      const entry = resolveSeededDirectoryByType(type);
      if (!entry) {
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent(
            `No ${type} directory configured`,
          )}`,
        );
      }
      if (q.error) {
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent(q.error_description || q.error)}`,
        );
      }
      if (!q.code) {
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent('Missing authorization code')}`,
        );
      }
      // Legacy aliases verify state leniently: if a signed state is present it
      // must match this directory; if absent (legacy IdP config) we proceed,
      // since the registered redirect URI itself is the trust anchor.
      const verified = verifyState(q.state);
      if (verified && verified.directoryId !== entry.config.id) {
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent('Invalid state')}`,
        );
      }
      try {
        const ssoUser = await exchangeAndValidate(entry, q.code, q.state);
        const redirectUrl = await completeSsoLogin(entry, ssoUser, request, reply);
        return reply.redirect(redirectUrl);
      } catch (error: any) {
        logger.error({ error: error?.message, type }, '[AUTH-SSO] alias callback failed');
        return reply.redirect(
          `${frontendUrl()}/auth/error?error=${encodeURIComponent(
            error?.message || 'Authentication failed',
          )}`,
        );
      }
    };
  }

  // NOTE: the legacy GET /api/auth/microsoft/login|callback +
  // /api/auth/google/login|callback routes are already owned by routes/auth.ts +
  // routes/google-auth/ (the original env-based handlers). Re-declaring them here
  // collides (FST_ERR_DUPLICATED_ROUTE) and crashes the ENTIRE auth plugin — which
  // cascades and de-registers /api/admin/identity-directories too. So we
  // intentionally do NOT register the legacy aliases here. The runtime registry is
  // reached via /api/auth/directories + /api/auth/sso/:directoryId/login|callback
  // (registered above). aliasLogin/aliasCallback are retained for a future migration
  // that moves the legacy paths off the env handlers onto the seeded directory.

  fastify.log.info('SSO auth routes registered (directories + per-directory login/callback)');
};

export default authSsoRoutes;
