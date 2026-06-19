/**
 * GCP Credential Service
 *
 * Per-user Google Cloud OAuth credentials for the GCP run-as-user path.
 *
 * A user clicks "Connect GCP" → OAuth consent for the cloud-platform scope →
 * the platform stores their per-user access + refresh token (encrypted at
 * rest) → later, synth can run GCP code AS THEM
 * (GOOGLE_OAUTH_ACCESS_TOKEN scoped to exactly their GCP IAM permissions).
 *
 * This is the per-user-OAuth approach (NOT WIF, NOT a shared service
 * account). It mirrors GitHubCredentialService one-for-one:
 *   - generateOAuthState(userId) / decodeOAuthState — signed/encrypted,
 *     tamper-evident CSRF state.
 *   - exchangeCodeForToken(code) → { access_token, refresh_token, expiry }.
 *   - storeCredentials(userId, tokenInfo, userInfo) — encrypt + upsert by
 *     user_id into the GcpUserCredential Prisma model.
 *   - getToken(userId) — fetch + decrypt; auto-refresh an expired access
 *     token via the stored refresh_token; throw a clear "not connected"
 *     error if the user has not linked GCP (NEVER a shared-SA fallback).
 *   - getStatus(userId) — { connected, gcp_email?, expiry? } for the UI.
 *
 * WIRED (run-as-user follow-on):
 *   CredentialBroker.brokerGcp() calls
 *   getGCPCredentialService(logger).getValidAccessToken(userId) and injects the
 *   result as GOOGLE_OAUTH_ACCESS_TOKEN into synth.credentials — replacing the
 *   shared GOOGLE_SA_JSON path with the per-user token. getValidAccessToken()
 *   is the typed, null-on-not-connected accessor the broker adapter consumes;
 *   getToken() keeps its throw for the route path.
 */

import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../utils/prisma.js';

// GCP OAuth configuration from environment. Distinct from the GOOGLE_*
// LOGIN client (auth/googleAuth.ts) — this client requests the GCP RESOURCE
// scope (cloud-platform), not the openid/email/profile login scopes.
const GCP_CLIENT_ID = process.env.GCP_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const GCP_CLIENT_SECRET =
  process.env.GCP_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const GCP_REDIRECT_URI =
  process.env.GCP_OAUTH_REDIRECT_URI ||
  `${process.env.FRONTEND_URL || 'https://ai.openagentic.io'}/api/auth/gcp/callback`;

// The GCP RESOURCE scope — grants the access token exactly the caller's IAM
// permissions. This is the scope that makes "run as them" work.
const GCP_CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// Encryption key for token storage (32 bytes for AES-256). Reuses the shared
// LOCAL_ENCRYPTION_KEY fallback so a single deployment secret covers both the
// GitHub and GCP credential stores; a dedicated GCP key overrides it.
const ENCRYPTION_KEY =
  process.env.GCP_TOKEN_ENCRYPTION_KEY ||
  process.env.LOCAL_ENCRYPTION_KEY ||
  crypto.randomBytes(32).toString('hex');

/**
 * Thrown when a GCP token is requested but the user has no linked GCP
 * identity. The CredentialBroker's run-as-user adapter catches this BY TYPE
 * (not by string match) to decide null-vs-rethrow — mirrors
 * GitHubNotConnectedError. We NEVER fall back to a shared SA token; that would
 * break the run-as-the-user contract (code would run as the platform, not the
 * user).
 */
export class GcpNotConnectedError extends Error {
  override name = 'GcpNotConnectedError';
}

export interface GCPTokenInfo {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  scope?: string;
  expires_at?: Date;
  is_valid: boolean;
}

export interface GCPUserInfo {
  email?: string;
  project_id?: string;
}

export interface GCPOAuthState {
  userId: string;
  redirectUrl?: string;
  timestamp: number;
}

export interface GCPConnectionStatus {
  connected: boolean;
  gcp_email?: string;
  project_id?: string;
  expiry?: Date;
  isValid: boolean;
}

/**
 * GCP Credential Service
 * Handles per-user GCP OAuth flow and secure token management.
 */
export class GCPCredentialService {
  private logger: FastifyBaseLogger;
  private encryptionKey: Buffer;
  private client: OAuth2Client;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger.child({ service: 'GCPCredentialService' });
    this.encryptionKey = Buffer.from(ENCRYPTION_KEY.slice(0, 64).padEnd(64, '0'), 'hex');

    // Reuse the same OAuth2Client setup pattern as auth/googleAuth.ts.
    this.client = new OAuth2Client({
      clientId: GCP_CLIENT_ID,
      clientSecret: GCP_CLIENT_SECRET,
      redirectUri: GCP_REDIRECT_URI,
    });
  }

  /**
   * Build the Google OAuth authorization URL for the GCP cloud-platform scope.
   * access_type:'offline' + prompt:'consent' guarantee a refresh_token (even
   * on a re-link), so getToken() can always mint a fresh short-lived token.
   */
  getAuthUrl(state: string): string {
    return this.client.generateAuthUrl({
      access_type: 'offline', // guarantees a refresh_token
      scope: [GCP_CLOUD_PLATFORM_SCOPE],
      state,
      prompt: 'consent', // force consent so a refresh_token is always returned
    });
  }

  /**
   * Generate a secure, tamper-evident state parameter for the OAuth flow.
   */
  generateOAuthState(userId: string, redirectUrl?: string): string {
    const stateData: GCPOAuthState = {
      userId,
      redirectUrl,
      timestamp: Date.now(),
    };
    return this.encrypt(JSON.stringify(stateData));
  }

  /**
   * Validate and decode an OAuth state parameter (CSRF defense).
   */
  decodeOAuthState(encryptedState: string): GCPOAuthState | null {
    try {
      const stateJson = this.decrypt(encryptedState);
      const state = JSON.parse(stateJson) as GCPOAuthState;

      // Reject states older than 15 minutes.
      const maxAge = 15 * 60 * 1000;
      if (!state.userId || typeof state.timestamp !== 'number') {
        return null;
      }
      if (Date.now() - state.timestamp > maxAge) {
        this.logger.warn('GCP OAuth state expired');
        return null;
      }
      return state;
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'Failed to decode GCP OAuth state');
      return null;
    }
  }

  /**
   * Exchange an authorization code for access + refresh tokens.
   */
  async exchangeCodeForToken(code: string): Promise<GCPTokenInfo> {
    this.logger.info('Exchanging GCP authorization code for token');

    const { tokens } = await this.client.getToken(code);

    if (!tokens.access_token) {
      throw new Error('GCP OAuth token exchange returned no access_token');
    }

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || undefined,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || GCP_CLOUD_PLATFORM_SCOPE,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      is_valid: true,
    };
  }

  /**
   * Store per-user GCP credentials (access + refresh token encrypted at rest).
   * Upserts by user_id — one credential row per user.
   */
  async storeCredentials(
    userId: string,
    tokenInfo: GCPTokenInfo,
    userInfo: GCPUserInfo = {},
  ): Promise<void> {
    this.logger.info({ userId, gcpEmail: userInfo.email }, 'Storing GCP credentials');

    const encryptedAccessToken = this.encrypt(tokenInfo.access_token);
    const encryptedRefreshToken = tokenInfo.refresh_token
      ? this.encrypt(tokenInfo.refresh_token)
      : null;

    await prisma.gcpUserCredential.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_type: tokenInfo.token_type,
        scope: tokenInfo.scope,
        gcp_email: userInfo.email,
        project_id: userInfo.project_id,
        expires_at: tokenInfo.expires_at,
        last_validated: new Date(),
        is_valid: true,
      },
      update: {
        access_token: encryptedAccessToken,
        // Only overwrite the refresh token when a new one was issued — Google
        // omits refresh_token on some re-grants; keep the existing one.
        ...(encryptedRefreshToken ? { refresh_token: encryptedRefreshToken } : {}),
        token_type: tokenInfo.token_type,
        scope: tokenInfo.scope,
        gcp_email: userInfo.email,
        project_id: userInfo.project_id,
        expires_at: tokenInfo.expires_at,
        last_validated: new Date(),
        is_valid: true,
        updated_at: new Date(),
      },
    });

    this.logger.info({ userId }, 'GCP credentials stored successfully');
  }

  /**
   * Get a VALID short-lived GCP access token for the user.
   *
   * - Fresh token → returns it directly (no network round-trip).
   * - Expired token → uses the stored refresh_token to mint a new access
   *   token, persists the new token + expiry, returns the fresh one.
   * - No linked GCP → throws a clear error. NEVER falls back to a shared SA
   *   token — that would break run-as-them.
   *
   * The returned string is what brokerGcp() will inject as
   * GOOGLE_OAUTH_ACCESS_TOKEN (follow-on pass).
   */
  async getToken(userId: string): Promise<string> {
    const credential = await prisma.gcpUserCredential.findUnique({
      where: { user_id: userId },
    });

    if (!credential) {
      // Typed so the run-as-user broker adapter (getValidAccessToken) can
      // catch by instanceof and return null, while the route path still gets a
      // clear, actionable error. NEVER a shared-SA fallback.
      throw new GcpNotConnectedError('GCP not connected — Connect GCP in settings');
    }

    // Record usage (best-effort).
    await prisma.gcpUserCredential
      .update({ where: { user_id: userId }, data: { last_used_at: new Date() } })
      .catch(() => {});

    const accessToken = this.decrypt(credential.access_token);

    // Fresh? Return as-is. 60s skew buffer so a token about to expire mid-call
    // gets proactively refreshed.
    const expiresAt = credential.expires_at ? new Date(credential.expires_at).getTime() : 0;
    const isExpired = !expiresAt || expiresAt <= Date.now() + 60_000;

    if (!isExpired) {
      return accessToken;
    }

    // Expired — refresh via the stored refresh token.
    if (!credential.refresh_token) {
      throw new Error(
        'GCP access token expired and no refresh token is stored — reconnect GCP in settings',
      );
    }

    const refreshToken = this.decrypt(credential.refresh_token);
    this.logger.info({ userId }, 'GCP access token expired — refreshing');

    this.client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error('GCP token refresh returned no access_token');
    }

    const newExpiry = credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : new Date(Date.now() + 3600_000);

    // Persist the freshly minted access token (encrypted) + new expiry.
    await prisma.gcpUserCredential.update({
      where: { user_id: userId },
      data: {
        access_token: this.encrypt(credentials.access_token),
        expires_at: newExpiry,
        is_valid: true,
        updated_at: new Date(),
      },
    });

    return credentials.access_token;
  }

  /**
   * Run-as-user accessor for the CredentialBroker.
   *
   * Thin, TYPED wrapper over getToken(): returns the user's valid short-lived
   * GCP OAuth token, or `null` when the user has not linked GCP
   * (GcpNotConnectedError). Any OTHER error (refresh/IO failure) propagates so
   * the broker never silently swallows a real failure. The broker uses the
   * null signal to throw its own GcpNotConnectedError WITHOUT string-matching.
   * The route path keeps using getToken() (which throws) directly.
   */
  async getValidAccessToken(userId: string): Promise<string | null> {
    try {
      return await this.getToken(userId);
    } catch (err) {
      if (err instanceof GcpNotConnectedError) {
        return null;
      }
      throw err;
    }
  }

  /**
   * GCP connection status for the UI.
   */
  async getStatus(userId: string): Promise<GCPConnectionStatus> {
    const credential = await prisma.gcpUserCredential.findUnique({
      where: { user_id: userId },
      select: {
        gcp_email: true,
        project_id: true,
        expires_at: true,
        is_valid: true,
      },
    });

    if (!credential) {
      return { connected: false, isValid: false };
    }

    return {
      connected: true,
      gcp_email: credential.gcp_email || undefined,
      project_id: credential.project_id || undefined,
      expiry: credential.expires_at || undefined,
      isValid: credential.is_valid,
    };
  }

  /**
   * Disconnect GCP for a user — best-effort revoke at Google, then delete the
   * stored row.
   */
  async disconnect(userId: string): Promise<boolean> {
    try {
      // Best-effort token revoke at Google so the grant is dropped server-side.
      try {
        const credential = await prisma.gcpUserCredential.findUnique({
          where: { user_id: userId },
        });
        if (credential?.access_token) {
          const accessToken = this.decrypt(credential.access_token);
          await this.client.revokeToken(accessToken).catch(() => {});
        }
      } catch {
        // Non-fatal — we still delete the row below.
      }

      await prisma.gcpUserCredential.delete({ where: { user_id: userId } });
      this.logger.info({ userId }, 'GCP disconnected');
      return true;
    } catch (error) {
      if ((error as any).code === 'P2025') {
        // Already disconnected.
        return true;
      }
      this.logger.error(
        { userId, error: (error as Error).message },
        'Failed to disconnect GCP',
      );
      return false;
    }
  }

  /**
   * Whether GCP OAuth is configured for this instance.
   */
  isConfigured(): boolean {
    return !!(GCP_CLIENT_ID && GCP_CLIENT_SECRET);
  }

  /**
   * OAuth config status (for health checks / the public /config endpoint).
   */
  getConfigStatus(): { configured: boolean; clientId?: string; redirectUri?: string } {
    return {
      configured: this.isConfigured(),
      clientId: GCP_CLIENT_ID ? `${GCP_CLIENT_ID.substring(0, 8)}...` : undefined,
      redirectUri: GCP_REDIRECT_URI || undefined,
    };
  }

  // ==========================================================================
  // Encryption helpers (AES-256-GCM, mirrors GitHubCredentialService format).
  // ==========================================================================

  /**
   * AES-256-GCM encrypt. Format: `gcpenc2:<iv-hex>:<tag-hex>:<ciphertext-hex>`.
   * 12-byte IV (GCM standard) + 16-byte auth tag bind integrity to
   * confidentiality.
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `gcpenc2:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  }

  private decrypt(text: string): string {
    if (text.startsWith('gcpenc2:')) {
      const parts = text.split(':');
      if (parts.length !== 4) throw new Error('Invalid gcpenc2 format');
      const iv = Buffer.from(parts[1], 'hex');
      const tag = Buffer.from(parts[2], 'hex');
      const encrypted = parts[3];
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    // Not in our encrypted format — refuse rather than silently pass through a
    // tampered/garbage state. (CSRF state decode relies on this throwing.)
    throw new Error('Invalid encrypted payload');
  }
}

// Singleton factory (mirror getGitHubCredentialService).
let _instance: GCPCredentialService | null = null;

export function getGCPCredentialService(logger: FastifyBaseLogger): GCPCredentialService {
  if (!_instance) {
    _instance = new GCPCredentialService(logger);
  }
  return _instance;
}
