import type { FastifyBaseLogger } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { validateAzureToken, logTokenValidation } from '../utils/validateAzureToken.js';
import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';

// MSAL for token refresh - will be loaded dynamically
let msalModule: any = null;
let msalLoadAttempted = false;

async function getMsalModule(): Promise<any> {
  if (msalLoadAttempted) return msalModule;
  msalLoadAttempted = true;

  try {
    msalModule = await import('@azure/msal-node');
    console.log('[AzureTokenService] ✅ @azure/msal-node loaded successfully');
    return msalModule;
  } catch (e) {
    console.warn('[AzureTokenService] ⚠️ @azure/msal-node not available:', (e as Error).message);
    return null;
  }
}

const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || process.env.AAD_CLIENT_ID || '';
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || process.env.AAD_CLIENT_SECRET || '';
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || process.env.AAD_TENANT_ID || '';

/**
 * Sev-1 #789 — MFA freshness window on cached OBO access tokens.
 *
 * Azure Conditional Access can enforce a "sign-in frequency" / MFA-freshness
 * policy that is independent of access-token `exp`. A token can still be
 * `exp`-valid while its `auth_time` (the moment MFA was last performed) has
 * aged past the policy window — AAD then returns 401/claims-challenge on
 * downstream calls. We treat such tokens as expired so the cache layer
 * forces a refresh BEFORE handing them to mcp-proxy / Azure MCP, which would
 * otherwise produce opaque 401s mid-conversation (the U/D-after-first-action
 * symptom in #789).
 *
 * Default 30 minutes — comfortably inside typical CA windows (1-4 hours).
 * Overridable via AZURE_OBO_MFA_FRESHNESS_MINUTES.
 */
const DEFAULT_MFA_FRESHNESS_MINUTES = 30;

function getMfaFreshnessSeconds(): number {
  const raw = process.env.AZURE_OBO_MFA_FRESHNESS_MINUTES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MFA_FRESHNESS_MINUTES;
  return minutes * 60;
}

/**
 * Decode the JWT payload (no signature verification — only the auth_time /
 * iat claims are inspected, AAD already validated the token at issue time).
 * Returns null on malformed tokens.
 */
function decodeJwtPayload(token: string): Record<string, any> | null {
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
 * True iff the token's MFA authentication is older than the freshness window.
 * Prefer `auth_time` (RFC 9068 / OIDC ID-token claim) and fall back to `iat`
 * when AAD didn't surface auth_time. Returns false (NOT stale) when neither
 * claim is present — we don't penalize tokens that simply don't expose
 * auth_time; the exp check still applies.
 */
export function isMfaStale(token: string, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const stamp = typeof payload.auth_time === 'number'
    ? payload.auth_time
    : (typeof payload.iat === 'number' ? payload.iat : undefined);
  if (stamp === undefined) return false;
  const ageSec = nowSec - stamp;
  return ageSec > getMfaFreshnessSeconds();
}

export interface AzureTokenInfo {
  access_token: string;
  id_token?: string;  // ID token for AWS Identity Center OBO (has app's client ID as audience)
  expires_at: Date;
  is_expired: boolean;
}

/**
 * Service for retrieving Azure OBO tokens from the database
 * This service retrieves tokens that were previously stored during Azure AD authentication
 */
export class AzureTokenService {
  private logger: FastifyBaseLogger;
  
  constructor(logger: FastifyBaseLogger) {
    this.logger = logger.child({ service: 'AzureTokenService' }) as Logger;
  }
  
  /**
   * Get the Azure OBO token for a user from the database
   */
  async getUserAzureToken(userId: string): Promise<AzureTokenInfo | null> {
    try {
      this.logger.debug({ userId }, 'Retrieving Azure token for user');
      
      const tokenData = await prisma.userAuthToken.findUnique({
        where: { user_id: userId },
        select: {
          access_token: true,
          id_token: true,  // ID token for AWS Identity Center OBO
          refresh_token: true,
          expires_at: true
        }
      });
      
      if (!tokenData) {
        this.logger.warn({ userId }, 'No Azure token found for user');
        return null;
      }
      
      // Check if this is a Service Principal auth (admin user)
      const isServicePrincipal = tokenData.refresh_token === 'service_principal';
      
      const isExpired = tokenData.expires_at < new Date();
      const tokenInfo = {
        access_token: tokenData.access_token,
        expires_at: tokenData.expires_at,
        is_expired: isExpired
      };
      
      if (tokenInfo.is_expired) {
        this.logger.warn({ userId, expiresAt: tokenInfo.expires_at }, 'Azure token is expired');
        return {
          access_token: tokenInfo.access_token,
          id_token: tokenData.id_token || undefined,
          expires_at: tokenInfo.expires_at,
          is_expired: true
        };
      }

      // Skip JWT validation for Service Principal auth
      if (isServicePrincipal) {
        this.logger.info({ userId }, 'Service Principal authentication detected - skipping JWT validation');
        return {
          access_token: tokenInfo.access_token,
          id_token: tokenData.id_token || undefined,
          expires_at: tokenInfo.expires_at,
          is_expired: false
        };
      }
      
      // Validate the token structure and claims for regular OBO tokens
      const isTokenValid = logTokenValidation(this.logger, userId, tokenInfo.access_token);
      
      if (!isTokenValid) {
        this.logger.error({ userId }, 'Azure token failed validation checks');
        return {
          access_token: tokenInfo.access_token,
          id_token: tokenData.id_token || undefined,
          expires_at: tokenInfo.expires_at,
          is_expired: true // Treat invalid tokens as expired
        };
      }

      this.logger.info({
        userId,
        expiresAt: tokenInfo.expires_at,
        hasIdToken: !!tokenData.id_token,
        timeUntilExpiry: Math.floor((new Date(tokenInfo.expires_at).getTime() - Date.now()) / 1000 / 60)
      }, 'Retrieved valid Azure OBO token for user');

      return {
        access_token: tokenInfo.access_token,
        id_token: tokenData.id_token || undefined,
        expires_at: tokenInfo.expires_at,
        is_expired: false
      };
      
    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Failed to retrieve Azure OBO token');
      throw error;
    }
  }
  
  /**
   * Check if a user has a valid Azure OBO token
   */
  async hasValidAzureToken(userId: string): Promise<boolean> {
    try {
      const tokenInfo = await this.getUserAzureToken(userId);
      return tokenInfo !== null && !tokenInfo.is_expired;
    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Failed to check Azure token validity');
      return false;
    }
  }
  
  /**
   * Get the Azure OBO token string for a user, or null if not available/expired
   */
  async getValidAzureTokenString(userId: string): Promise<string | null> {
    try {
      const tokenInfo = await this.getUserAzureToken(userId);
      
      if (!tokenInfo || tokenInfo.is_expired) {
        return null;
      }
      
      return tokenInfo.access_token;
    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Failed to get valid Azure token string');
      return null;
    }
  }
  
  /**
   * Store an Azure OBO token for a user (typically called during authentication)
   */
  async storeUserAzureToken(userId: string, token: string): Promise<void> {
    try {
      // Validate token before storing
      const validation = validateAzureToken(token);
      if (!validation.isValid) {
        this.logger.error({ 
          userId, 
          issues: validation.issues 
        }, 'Cannot store invalid Azure token');
        throw new Error(`Invalid Azure token: ${validation.issues.join(', ')}`);
      }
      
      // Log successful validation
      logTokenValidation(this.logger, userId, token);
      
      // Decode token to get expiration info
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid JWT token format');
      }
      
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
      const expiresAt = new Date(payload.exp * 1000);
      
      await prisma.userAuthToken.upsert({
        where: { user_id: userId },
        update: {
          access_token: token,
          expires_at: expiresAt,
          updated_at: new Date()
        },
        create: {
          user_id: userId,
          access_token: token,
          expires_at: expiresAt
        }
      });
      
      this.logger.info({ userId, expiresAt }, 'Stored Azure OBO token for user');
    } catch (error) {
      this.logger.error({ userId, error: error.message }, 'Failed to store Azure OBO token');
      throw error;
    }
  }
  
  /**
   * Clean up expired tokens from the database
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = await prisma.userAuthToken.deleteMany({
        where: {
          expires_at: {
            lt: oneDayAgo
          }
        }
      });

      const deletedCount = result.count || 0;

      if (deletedCount > 0) {
        this.logger.info({ deletedCount }, 'Cleaned up expired Azure OBO tokens');
      }

      return deletedCount;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Failed to cleanup expired Azure tokens');
      throw error;
    }
  }

  /**
   * Refresh an expired Azure OBO token using the stored refresh token
   * This is called automatically when a token is found to be expired
   */
  async refreshToken(userId: string): Promise<AzureTokenInfo | null> {
    try {
      // Get existing token data including refresh token and id_token
      const tokenData = await prisma.userAuthToken.findUnique({
        where: { user_id: userId },
        select: {
          access_token: true,
          id_token: true,
          refresh_token: true,
          expires_at: true,
          scope: true
        }
      });

      if (!tokenData || !tokenData.refresh_token) {
        this.logger.warn({ userId }, 'No refresh token available for user');
        return null;
      }

      // Service principal tokens don't need refresh
      if (tokenData.refresh_token === 'service_principal') {
        this.logger.debug({ userId }, 'Service principal token - skipping refresh');
        return null;
      }

      // Dynamically load MSAL
      const msal = await getMsalModule();
      if (!msal) {
        this.logger.error({ userId }, 'MSAL module not available for token refresh');
        return null;
      }

      this.logger.info({ userId }, 'Attempting to refresh Azure OBO token');

      // Initialize MSAL client
      const msalClient = new msal.ConfidentialClientApplication({
        auth: {
          clientId: AZURE_CLIENT_ID,
          clientSecret: AZURE_CLIENT_SECRET,
          authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`
        }
      });

      // Use MSAL to refresh the token
      const refreshTokenRequest = {
        refreshToken: tokenData.refresh_token,
        scopes: [tokenData.scope || 'https://management.azure.com/.default']
      };

      const response = await msalClient.acquireTokenByRefreshToken(refreshTokenRequest);

      if (!response || !response.accessToken) {
        this.logger.error({ userId }, 'Token refresh returned no access token');
        return null;
      }

      const expiresAt = new Date(response.expiresOn?.getTime() || Date.now() + 3600000);
      const newIdToken = (response as any).idToken || undefined;

      // Update token in database
      await prisma.userAuthToken.update({
        where: { user_id: userId },
        data: {
          access_token: response.accessToken,
          // MSAL may return new ID token on refresh
          ...(newIdToken && { id_token: newIdToken }),
          // Azure SDK might provide new refresh token, use it if available
          refresh_token: response.refreshToken || tokenData.refresh_token,
          expires_at: expiresAt,
          updated_at: new Date()
        }
      });

      this.logger.info({
        userId,
        expiresAt,
        hasNewIdToken: !!newIdToken,
        tokenPreview: response.accessToken.substring(0, 20) + '...'
      }, 'Successfully refreshed Azure OBO token');

      // If MSAL didn't return new ID token, fetch current one from database
      const currentIdToken = newIdToken || tokenData.id_token;

      return {
        access_token: response.accessToken,
        id_token: currentIdToken || undefined,
        expires_at: expiresAt,
        is_expired: false
      };

    } catch (error: any) {
      this.logger.error({
        userId,
        error: error.message,
        errorCode: error.errorCode
      }, 'Failed to refresh Azure OBO token - user may need to re-authenticate');
      return null;
    }
  }

  /**
   * Get a valid Azure OBO token, refreshing if necessary
   * This is the primary method to use when you need a valid token
   *
   * Sev-1 #789: ALSO refreshes when the cached token's MFA stamp
   * (`auth_time` / `iat`) is older than the configured MFA freshness
   * window — even if `exp` is still in the future. This prevents
   * mid-conversation 401s on the 2nd/3rd Azure MCP Update/Delete call
   * once Conditional-Access flags the stale MFA. Service-principal
   * tokens (refresh_token === 'service_principal') are exempt — they
   * have no MFA dimension to be stale against.
   */
  async getOrRefreshToken(userId: string): Promise<AzureTokenInfo | null> {
    try {
      // First try to get existing token
      const tokenInfo = await this.getUserAzureToken(userId);

      if (!tokenInfo) {
        this.logger.debug({ userId }, 'No Azure token found for user');
        return null;
      }

      // Determine if this is a service-principal-issued token. SP tokens
      // are issued by client_credentials and have no MFA dimension, so
      // they bypass freshness checks (they only expire by `exp`). We re-read
      // refresh_token to detect this — getUserAzureToken doesn't surface it.
      let isServicePrincipal = false;
      try {
        const raw = await prisma.userAuthToken.findUnique({
          where: { user_id: userId },
          select: { refresh_token: true },
        });
        isServicePrincipal = raw?.refresh_token === 'service_principal';
      } catch {
        // If the lookup fails we treat as regular user token (safer to refresh).
      }

      const mfaStale = !isServicePrincipal && isMfaStale(tokenInfo.access_token);

      // If token is valid AND MFA is fresh, return it.
      if (!tokenInfo.is_expired && !mfaStale) {
        return tokenInfo;
      }

      if (mfaStale && !tokenInfo.is_expired) {
        this.logger.info(
          { userId, freshnessMinutes: Math.floor(getMfaFreshnessSeconds() / 60) },
          'Azure token MFA freshness expired (Sev-1 #789), forcing refresh',
        );
      } else {
        this.logger.info({ userId }, 'Azure token expired, attempting refresh');
      }

      const refreshedToken = await this.refreshToken(userId);

      if (refreshedToken) {
        return refreshedToken;
      }

      // Refresh failed. Surface as expired (even if `exp` is still future)
      // so the caller can short-circuit to re-auth instead of forwarding a
      // stale token to AAD where it produces an opaque MFA-required 401.
      this.logger.warn(
        { userId, mfaStale, expExpired: tokenInfo.is_expired },
        'Token refresh failed - surfacing as expired so caller re-auths',
      );
      return {
        ...tokenInfo,
        is_expired: true,
      };

    } catch (error: any) {
      this.logger.error({ userId, error: error.message }, 'Failed to get or refresh Azure token');
      return null;
    }
  }
}