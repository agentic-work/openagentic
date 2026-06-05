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
 * Generic OIDC Authentication Strategy
 *
 * A directory-driven OpenID Connect strategy for any compliant IdP
 * (Okta / Auth0 / Keycloak / Entra-as-generic). It mirrors the surface of
 * `googleAuth.ts` (GoogleAuthService) — `generateAuthUrl` / `exchangeCodeForTokens`
 * / `validateIdToken` — so the per-directory login/callback routes can treat
 * Azure / Google / Generic instances interchangeably.
 *
 * Unlike the Azure and Google strategies, this one is driven ENTIRELY by the
 * `IdentityDirectory` row: clientId / clientSecret / issuer / redirectUri /
 * scopes / groupClaim, plus the directory's cached `.well-known/openid-configuration`
 * discovery document. There is NO env fallback — a generic-OIDC directory only
 * exists in the DB-driven registry (the LLM-provider doctrine: DB is the single
 * source of truth).
 *
 * Built on the `openid-client` v6 functional API:
 *   - `discovery()`            — fetch + cache the discovery doc (first construction)
 *   - `new Configuration(...)` — rebuild from the cached doc with ZERO network I/O
 *   - `buildAuthorizationUrl()`— authorization request URL
 *   - `authorizationCodeGrant()` — token exchange + ID-token validation in one call
 */

import * as client from 'openid-client';
import * as jose from 'node-jose';
import crypto from 'crypto';
import type { Logger } from 'pino';
import { createRedisService, RedisService } from '../services/redis.js';

export interface GenericOidcConfig {
  /** OAuth client identifier at the IdP */
  clientId: string;
  /** OAuth client secret (confidential client). Decrypted by the caller. */
  clientSecret: string;
  /** Issuer Identifier — the base used for .well-known discovery */
  issuer: string;
  /** Registered redirect URI (must match the IdP app config) */
  redirectUri: string;
  /** Requested scopes; defaults to OIDC standard set when empty */
  scopes?: string[];
  /** The ID-token claim that carries group membership (default 'groups') */
  groupClaim?: string;
  /**
   * Cached discovery document (.well-known/openid-configuration). When present,
   * the strategy is constructed offline from it. When absent, the strategy
   * fetches it once on first use and stores it on `discovery` for the caller
   * to persist back into the directory row.
   */
  discovery?: Record<string, any>;
}

export interface GenericOidcUserContext {
  userId: string;
  email: string;
  name?: string;
  picture?: string;
  emailVerified: boolean;
  groups: string[];
}

export interface GenericOidcTokenValidationResult {
  isValid: boolean;
  user?: GenericOidcUserContext;
  error?: string;
  claims?: Record<string, any>;
}

export interface GenericOidcTokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresIn: number;
  claims: Record<string, any>;
}

const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

/**
 * Generic OIDC strategy — one instance per generic-oidc IdentityDirectory.
 */
export class GenericOidcStrategy {
  private config: GenericOidcConfig;
  private logger: Logger;
  private redis: RedisService;

  /** Lazily-built openid-client Configuration (handle to the AS metadata + client auth). */
  private configuration: client.Configuration | null = null;
  /** The resolved discovery doc (so the caller can persist it back into the row). */
  private discoveryDoc: Record<string, any> | null = null;

  constructor(config: GenericOidcConfig, logger?: Logger) {
    this.logger = logger || (console as any);

    if (!config.clientId) throw new Error('[GENERIC-OIDC] clientId is required');
    if (!config.clientSecret) throw new Error('[GENERIC-OIDC] clientSecret is required');
    if (!config.issuer) throw new Error('[GENERIC-OIDC] issuer is required');
    if (!config.redirectUri) throw new Error('[GENERIC-OIDC] redirectUri is required');

    this.config = {
      ...config,
      scopes: config.scopes?.length ? config.scopes : DEFAULT_SCOPES,
      groupClaim: config.groupClaim || 'groups',
    };

    this.discoveryDoc = config.discovery ?? null;
    this.redis = createRedisService(this.logger);

    this.logger.info(
      {
        issuer: this.config.issuer,
        clientId: this.config.clientId ? `${this.config.clientId.substring(0, 12)}...` : 'NOT SET',
        redirectUri: this.config.redirectUri,
        hasCachedDiscovery: !!this.discoveryDoc,
        groupClaim: this.config.groupClaim,
      },
      '[GENERIC-OIDC] Initialized GenericOidcStrategy',
    );
  }

  /**
   * Return the (clientSecret-redacted) config for diagnostics / API responses.
   */
  getConfig(): Omit<GenericOidcConfig, 'clientSecret' | 'discovery'> {
    const { clientSecret, discovery, ...safe } = this.config;
    return safe;
  }

  /**
   * The discovery doc resolved for this strategy. Populated after the first
   * `getConfiguration()` call (or from the cached doc passed to the constructor).
   * The caller persists this back into the directory row's `discovery` column.
   */
  getDiscoveryDocument(): Record<string, any> | null {
    return this.discoveryDoc;
  }

  /**
   * Build (and cache) the openid-client Configuration. If a discovery doc was
   * provided/cached, construct OFFLINE from it (no network). Otherwise fetch the
   * IdP's .well-known/openid-configuration once and cache it.
   */
  private async getConfiguration(): Promise<client.Configuration> {
    if (this.configuration) {
      return this.configuration;
    }

    const clientAuth = client.ClientSecretPost(this.config.clientSecret);

    if (this.discoveryDoc && this.discoveryDoc.issuer) {
      // Offline construction from the cached discovery doc — zero network I/O.
      this.configuration = new client.Configuration(
        this.discoveryDoc as client.ServerMetadata,
        this.config.clientId,
        { client_secret: this.config.clientSecret },
        clientAuth,
      );
    } else {
      // First-time fetch of the discovery document.
      const server = new URL(this.config.issuer);
      this.configuration = await client.discovery(
        server,
        this.config.clientId,
        { client_secret: this.config.clientSecret },
        clientAuth,
      );
      // Cache the resolved metadata so subsequent constructions are offline.
      this.discoveryDoc = { ...this.configuration.serverMetadata() };
    }

    return this.configuration;
  }

  /**
   * Validate a remote OIDC discovery document. Asserts the four endpoints the
   * platform relies on are present, and that the issuer matches. Used by the
   * admin "Test" action + the directory-service reload path. On success the
   * resolved doc is cached on this instance.
   */
  async validateDiscovery(): Promise<{ valid: boolean; error?: string; discovery?: Record<string, any> }> {
    try {
      const server = new URL(this.config.issuer);
      const configuration = await client.discovery(
        server,
        this.config.clientId,
        { client_secret: this.config.clientSecret },
        client.ClientSecretPost(this.config.clientSecret),
      );
      const md = configuration.serverMetadata();

      const missing: string[] = [];
      if (!md.issuer) missing.push('issuer');
      if (!md.authorization_endpoint) missing.push('authorization_endpoint');
      if (!md.token_endpoint) missing.push('token_endpoint');
      if (!md.jwks_uri) missing.push('jwks_uri');

      if (missing.length) {
        return { valid: false, error: `Discovery document missing required fields: ${missing.join(', ')}` };
      }

      this.discoveryDoc = { ...md };
      this.configuration = configuration;
      return { valid: true, discovery: this.discoveryDoc };
    } catch (error: any) {
      this.logger.error({ error: error.message, issuer: this.config.issuer }, '[GENERIC-OIDC] Discovery validation failed');
      return { valid: false, error: error.message };
    }
  }

  /**
   * Generate the authorization request URL. Stores a PKCE verifier in Redis keyed
   * by `state` so the callback can complete the exchange. Mirrors
   * GoogleAuthService.generateAuthUrl — returns a string.
   */
  async generateAuthUrl(state?: string): Promise<string> {
    const configuration = await this.getConfiguration();

    const stateValue = state || crypto.randomBytes(32).toString('hex');
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    // Persist the PKCE verifier for the callback (10-minute TTL).
    await this.storePkceVerifier(stateValue, codeVerifier);

    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.redirectUri,
      scope: (this.config.scopes || DEFAULT_SCOPES).join(' '),
      state: stateValue,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    this.logger.info({ url: `${url.toString().substring(0, 100)}...`, state: stateValue }, '[GENERIC-OIDC] Generated auth URL');
    return url.toString();
  }

  /**
   * Exchange an authorization-code callback for tokens + validated ID-token claims.
   * `currentUrl` is the full callback URL (with code + state); `state` is the
   * value originally issued by generateAuthUrl (used to recover the PKCE verifier).
   * Mirrors GoogleAuthService.exchangeCodeForTokens.
   */
  async exchangeCodeForTokens(currentUrl: string | URL, state: string): Promise<GenericOidcTokenExchangeResult> {
    const configuration = await this.getConfiguration();

    const codeVerifier = await this.getPkceVerifier(state);
    if (!codeVerifier) {
      throw new Error('PKCE verifier not found or expired for the provided state');
    }

    const url = typeof currentUrl === 'string' ? new URL(currentUrl) : currentUrl;

    try {
      const tokens = await client.authorizationCodeGrant(configuration, url, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
      });

      const claims = tokens.claims();
      if (!claims) {
        throw new Error('No ID token returned from the authorization server');
      }

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token!,
        expiresIn: tokens.expiresIn() ?? 3600,
        claims: claims as Record<string, any>,
      };
    } catch (error: any) {
      this.logger.error({ error: error.message, issuer: this.config.issuer }, '[GENERIC-OIDC] Code exchange failed');
      throw new Error(`Failed to exchange authorization code: ${error.message}`);
    }
  }

  /**
   * Validate a raw ID token against the IdP's JWKS (from the discovery doc) and
   * build a user context. Used when only an ID token is available (e.g. the
   * legacy alias path) — the primary callback path validates via
   * `exchangeCodeForTokens`. Mirrors GoogleAuthService.validateIdToken.
   */
  async validateIdToken(idToken: string): Promise<GenericOidcTokenValidationResult> {
    try {
      const jwksUri = this.discoveryDoc?.jwks_uri;
      if (!jwksUri) {
        // Resolve discovery (which populates jwks_uri) then retry.
        await this.getConfiguration();
      }
      const resolvedJwksUri = this.discoveryDoc?.jwks_uri;
      if (!resolvedJwksUri) {
        return { isValid: false, error: 'IdP discovery document has no jwks_uri' };
      }

      const res = await fetch(resolvedJwksUri);
      if (!res.ok) {
        return { isValid: false, error: `Failed to fetch JWKS (${res.status})` };
      }
      const jwks = await res.json();
      const keyStore = await jose.JWK.asKeyStore(jwks as any);

      const verified = await jose.JWS.createVerify(keyStore).verify(idToken);
      const claims = JSON.parse(verified.payload.toString());

      // Audience + issuer + expiry checks.
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!aud.includes(this.config.clientId)) {
        return { isValid: false, error: 'ID token audience does not match clientId' };
      }
      if (this.discoveryDoc?.issuer && claims.iss !== this.discoveryDoc.issuer) {
        return { isValid: false, error: 'ID token issuer does not match the directory issuer' };
      }
      if (typeof claims.exp === 'number' && claims.exp <= Math.floor(Date.now() / 1000)) {
        return { isValid: false, error: 'ID token is expired' };
      }

      return { isValid: true, user: this.buildUserContext(claims), claims };
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[GENERIC-OIDC] ID token validation failed');
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Build a normalized user context from validated ID-token claims, extracting
   * groups from the directory-configured `groupClaim`.
   */
  buildUserContext(claims: Record<string, any>): GenericOidcUserContext {
    const groupClaim = this.config.groupClaim || 'groups';
    const rawGroups = claims[groupClaim];
    const groups: string[] = Array.isArray(rawGroups)
      ? rawGroups.map(String)
      : typeof rawGroups === 'string' && rawGroups.length
        ? [rawGroups]
        : [];

    return {
      userId: String(claims.sub),
      email: claims.email || claims.preferred_username || '',
      name: claims.name,
      picture: claims.picture,
      emailVerified: claims.email_verified !== false,
      groups,
    };
  }

  /**
   * Store PKCE verifier in Redis for the OAuth flow (10-minute TTL).
   *
   * The verifier is JSON-encoded on store / decoded on retrieve. The unified
   * Redis wrapper `JSON.parse`s on `set` and `JSON.stringify`s on `get`, so a
   * raw string would not round-trip — encoding it keeps the value intact across
   * both the unified and in-memory backends.
   */
  private async storePkceVerifier(state: string, verifier: string): Promise<void> {
    const key = `generic_oidc_pkce:${state}`;
    await this.redis.set(key, JSON.stringify(verifier));
    await this.redis.expire(key, 600);
  }

  /**
   * Retrieve and delete the PKCE verifier from Redis (single use).
   */
  private async getPkceVerifier(state: string): Promise<string | null> {
    const key = `generic_oidc_pkce:${state}`;
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }
    await this.redis.del(key);
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : raw;
    } catch {
      return raw;
    }
  }
}

export default GenericOidcStrategy;
