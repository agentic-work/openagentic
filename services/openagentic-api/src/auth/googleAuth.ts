/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Google OAuth Authentication Service
 *
 * Handles Google OAuth 2.0 authentication flow for user login.
 * Similar to AzureADAuthService but for Google Identity Platform.
 */

import { OAuth2Client, TokenPayload } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Logger } from 'pino';
import { createRedisService, RedisService } from '../services/redis.js';

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedDomains?: string[]; // Optional: restrict to specific domains (e.g., ['openagentics.io'])
}

export interface GoogleUserContext {
  userId: string;
  email: string;
  name?: string;
  picture?: string;
  emailVerified: boolean;
  hostedDomain?: string; // Google Workspace domain
  isAdmin?: boolean;
  groups?: string[];
}

export interface GoogleTokenValidationResult {
  isValid: boolean;
  user?: GoogleUserContext;
  error?: string;
  payload?: TokenPayload;
}

interface CachedGoogleToken {
  user: GoogleUserContext;
  exp: number;
  validatedAt: number;
}

/**
 * Google OAuth Authentication Service
 */
export class GoogleAuthService {
  private config: GoogleAuthConfig;
  private client: OAuth2Client;
  private tokenCache: Map<string, CachedGoogleToken> = new Map();
  private redis: RedisService;
  private logger: Logger;

  // Admin emails for this deployment (loaded from env)
  private adminEmails: Set<string>;
  private adminDomains: Set<string>;

  constructor(config?: Partial<GoogleAuthConfig>, logger?: Logger) {
    this.logger = logger || (console as any);

    this.config = {
      clientId: config?.clientId || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: config?.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: config?.redirectUri || process.env.GOOGLE_REDIRECT_URI ||
        `${process.env.FRONTEND_URL || 'https://ai.openagentics.io'}/api/auth/google/callback`,
      allowedDomains: config?.allowedDomains ||
        (process.env.GOOGLE_ALLOWED_DOMAINS?.split(',').map(d => d.trim()).filter(Boolean) || [])
    };

    this.client = new OAuth2Client({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri
    });

    // Load admin configuration from env
    this.adminEmails = new Set(
      (process.env.GOOGLE_ADMIN_EMAILS || 'trent@openagentics.io')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean)
    );

    this.adminDomains = new Set(
      (process.env.GOOGLE_ADMIN_DOMAINS || '')
        .split(',')
        .map(d => d.trim().toLowerCase())
        .filter(Boolean)
    );

    this.redis = createRedisService(this.logger);

    // Clean up expired tokens periodically
    setInterval(() => this.cleanupExpiredTokens(), 60000);

    this.logger.info({
      clientId: this.config.clientId ? `${this.config.clientId.substring(0, 20)}...` : 'NOT SET',
      redirectUri: this.config.redirectUri,
      allowedDomains: this.config.allowedDomains,
      adminEmails: Array.from(this.adminEmails)
    }, '[GOOGLE-AUTH] Initialized GoogleAuthService');
  }

  getConfig(): Omit<GoogleAuthConfig, 'clientSecret'> {
    const { clientSecret, ...safeConfig } = this.config;
    return safeConfig;
  }

  /**
   * Generate the Google OAuth authorization URL
   */
  generateAuthUrl(state?: string): string {
    const url = this.client.generateAuthUrl({
      access_type: 'offline', // Get refresh token
      scope: [
        'openid',
        'email',
        'profile'
      ],
      state: state || this.generateState(),
      prompt: 'consent', // Force consent to ensure refresh token
      // If allowed domains specified, hint the domain
      ...(this.config.allowedDomains?.length === 1 ? {
        hd: this.config.allowedDomains[0]
      } : {})
    });

    this.logger.info({ url: url.substring(0, 100) + '...' }, '[GOOGLE-AUTH] Generated auth URL');
    return url;
  }

  /**
   * Generate a random state parameter for CSRF protection
   */
  private generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    idToken: string;
    expiresIn: number;
  }> {
    try {
      const { tokens } = await this.client.getToken(code);

      if (!tokens.id_token) {
        throw new Error('No ID token received from Google');
      }

      return {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expiry_date ? Math.floor((tokens.expiry_date - Date.now()) / 1000) : 3600
      };
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[GOOGLE-AUTH] Failed to exchange code for tokens');
      throw new Error(`Failed to exchange authorization code: ${error.message}`);
    }
  }

  /**
   * Validate a Google ID token
   */
  async validateIdToken(idToken: string): Promise<GoogleTokenValidationResult> {
    try {
      // Check cache first
      const cacheKey = this.hashToken(idToken);
      const cached = this.tokenCache.get(cacheKey);
      if (cached && cached.exp > Date.now() / 1000) {
        return { isValid: true, user: cached.user };
      }

      // Verify the token with Google
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.config.clientId
      });

      const payload = ticket.getPayload();
      if (!payload) {
        return { isValid: false, error: 'Invalid token payload' };
      }

      // Check email verification
      if (!payload.email_verified) {
        return { isValid: false, error: 'Email not verified' };
      }

      // Check allowed domains if configured
      if (this.config.allowedDomains?.length) {
        const domain = payload.hd || payload.email?.split('@')[1];
        if (!domain || !this.config.allowedDomains.includes(domain)) {
          return {
            isValid: false,
            error: `Domain not allowed. Allowed domains: ${this.config.allowedDomains.join(', ')}`
          };
        }
      }

      // Build user context
      const user: GoogleUserContext = {
        userId: payload.sub!,
        email: payload.email!,
        name: payload.name,
        picture: payload.picture,
        emailVerified: payload.email_verified || false,
        hostedDomain: payload.hd,
        isAdmin: this.isAdmin(payload.email!, payload.hd),
        groups: [] // Google doesn't provide groups in ID token - would need Directory API
      };

      // Cache the result
      this.tokenCache.set(cacheKey, {
        user,
        exp: payload.exp!,
        validatedAt: Date.now()
      });

      this.logger.info({
        userId: user.userId,
        email: user.email,
        isAdmin: user.isAdmin,
        hostedDomain: user.hostedDomain
      }, '[GOOGLE-AUTH] Token validated successfully');

      return { isValid: true, user, payload };
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[GOOGLE-AUTH] Token validation failed');
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Check if user is an admin based on email or domain
   */
  private isAdmin(email: string, hostedDomain?: string): boolean {
    const emailLower = email.toLowerCase();

    // Check admin emails list
    if (this.adminEmails.has(emailLower)) {
      return true;
    }

    // Check admin domains
    if (hostedDomain && this.adminDomains.has(hostedDomain.toLowerCase())) {
      return true;
    }

    // Check email domain against admin domains
    const emailDomain = emailLower.split('@')[1];
    if (emailDomain && this.adminDomains.has(emailDomain)) {
      return true;
    }

    return false;
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    try {
      this.client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await this.client.refreshAccessToken();

      return {
        accessToken: credentials.access_token!,
        expiresIn: credentials.expiry_date
          ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
          : 3600
      };
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[GOOGLE-AUTH] Failed to refresh token');
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  /**
   * Generate a local JWT for the user (for API authentication)
   */
  generateLocalJwt(user: GoogleUserContext, expiresInSeconds: number = 86400): string {
    const payload = {
      userId: `google_${user.userId}`,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
      groups: user.groups || [],
      provider: 'google',
      hostedDomain: user.hostedDomain
    };

    return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: expiresInSeconds });
  }

  /**
   * Store PKCE verifier in Redis for OAuth flow
   */
  async storePkceVerifier(state: string, verifier: string): Promise<void> {
    const key = `google_pkce:${state}`;
    await this.redis.set(key, verifier);
    await this.redis.expire(key, 600); // 10 minutes
  }

  /**
   * Retrieve and delete PKCE verifier from Redis
   */
  async getPkceVerifier(state: string): Promise<string | null> {
    const key = `google_pkce:${state}`;
    const verifier = await this.redis.get(key);
    if (verifier) {
      await this.redis.del(key);
    }
    return verifier;
  }

  /**
   * Hash a token for cache key
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 32);
  }

  /**
   * Clean up expired tokens from cache
   */
  private cleanupExpiredTokens(): void {
    const now = Date.now() / 1000;
    let cleaned = 0;

    for (const [key, value] of this.tokenCache.entries()) {
      if (value.exp < now) {
        this.tokenCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug({ cleaned }, '[GOOGLE-AUTH] Cleaned up expired tokens');
    }
  }
}

// Singleton instance
let googleAuthServiceInstance: GoogleAuthService | null = null;

export function getGoogleAuthService(logger?: Logger): GoogleAuthService {
  if (!googleAuthServiceInstance) {
    googleAuthServiceInstance = new GoogleAuthService({}, logger);
  }
  return googleAuthServiceInstance;
}

export default GoogleAuthService;
