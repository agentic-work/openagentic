/**
 * GitHub Credential Service
 *
 * Manages GitHub OAuth credentials for the GitHub MCP server.
 * Supports OAuth flow, token storage/retrieval with encryption,
 * and token refresh.
 */

import crypto from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../utils/prisma.js';

// GitHub OAuth configuration from environment
const GITHUB_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_OAUTH_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_OAUTH_REDIRECT_URI || '';

// Encryption key for token storage (32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.GITHUB_PAT_ENCRYPTION_KEY ||
  process.env.LOCAL_ENCRYPTION_KEY ||
  crypto.randomBytes(32).toString('hex');

export interface GitHubTokenInfo {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  scope?: string;
  expires_at?: Date;
  is_valid: boolean;
}

export interface GitHubUserInfo {
  id: number;
  login: string;
  name?: string;
  email?: string;
  avatar_url?: string;
}

export interface GitHubOAuthState {
  userId: string;
  redirectUrl?: string;
  timestamp: number;
}

export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubDeviceFlowSession {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
  userId: string;
}

/**
 * GitHub Credential Service
 * Handles OAuth flow and secure token management
 */
export class GitHubCredentialService {
  private logger: FastifyBaseLogger;
  private encryptionKey: Buffer;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger.child({ service: 'GitHubCredentialService' });
    this.encryptionKey = Buffer.from(ENCRYPTION_KEY.slice(0, 64).padEnd(64, '0'), 'hex');
  }

  /**
   * Generate the GitHub OAuth authorization URL
   */
  getAuthorizationUrl(state: string, scopes: string[] = ['repo', 'read:org', 'read:user', 'user:email']): string {
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: GITHUB_REDIRECT_URI,
      scope: scopes.join(' '),
      state,
      allow_signup: 'false'
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Generate a secure state parameter for OAuth
   */
  generateOAuthState(userId: string, redirectUrl?: string): string {
    const stateData: GitHubOAuthState = {
      userId,
      redirectUrl,
      timestamp: Date.now()
    };

    // Encrypt state to prevent tampering
    const stateJson = JSON.stringify(stateData);
    return this.encrypt(stateJson);
  }

  /**
   * Validate and decode OAuth state parameter
   */
  decodeOAuthState(encryptedState: string): GitHubOAuthState | null {
    try {
      const stateJson = this.decrypt(encryptedState);
      const state = JSON.parse(stateJson) as GitHubOAuthState;

      // Check if state is too old (15 minutes max)
      const maxAge = 15 * 60 * 1000;
      if (Date.now() - state.timestamp > maxAge) {
        this.logger.warn('OAuth state expired');
        return null;
      }

      return state;
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'Failed to decode OAuth state');
      return null;
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<GitHubTokenInfo> {
    this.logger.info('Exchanging authorization code for token');

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI
      })
    });

    if (!response.ok) {
      throw new Error(`GitHub OAuth token exchange failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
    }

    this.logger.info({ scope: data.scope, tokenType: data.token_type }, 'Token exchange successful');

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || 'bearer',
      scope: data.scope,
      is_valid: true
    };
  }

  /**
   * Fetch GitHub user info using the access token
   */
  async fetchUserInfo(accessToken: string): Promise<GitHubUserInfo> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch GitHub user info: ${response.status}`);
    }

    const data = await response.json();

    // Also fetch user's primary email if not public
    let email = data.email;
    if (!email) {
      try {
        const emailResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });

        if (emailResponse.ok) {
          const emails = await emailResponse.json();
          const primaryEmail = emails.find((e: any) => e.primary);
          email = primaryEmail?.email || emails[0]?.email;
        }
      } catch (e) {
        this.logger.warn('Could not fetch GitHub user emails');
      }
    }

    return {
      id: data.id,
      login: data.login,
      name: data.name,
      email,
      avatar_url: data.avatar_url
    };
  }

  /**
   * Store GitHub credentials for a user
   */
  async storeCredentials(
    userId: string,
    tokenInfo: GitHubTokenInfo,
    userInfo: GitHubUserInfo,
    githubHost: string = 'github.com'
  ): Promise<void> {
    this.logger.info({ userId, githubUsername: userInfo.login }, 'Storing GitHub credentials');

    const encryptedAccessToken = this.encrypt(tokenInfo.access_token);
    const encryptedRefreshToken = tokenInfo.refresh_token ?
      this.encrypt(tokenInfo.refresh_token) : null;

    await prisma.userGitHubCredential.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_type: tokenInfo.token_type,
        scope: tokenInfo.scope,
        github_id: userInfo.id,
        github_username: userInfo.login,
        github_email: userInfo.email,
        github_name: userInfo.name,
        avatar_url: userInfo.avatar_url,
        github_host: githubHost,
        expires_at: tokenInfo.expires_at,
        last_validated: new Date(),
        is_valid: true
      },
      update: {
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        token_type: tokenInfo.token_type,
        scope: tokenInfo.scope,
        github_id: userInfo.id,
        github_username: userInfo.login,
        github_email: userInfo.email,
        github_name: userInfo.name,
        avatar_url: userInfo.avatar_url,
        github_host: githubHost,
        expires_at: tokenInfo.expires_at,
        last_validated: new Date(),
        is_valid: true,
        updated_at: new Date()
      }
    });

    this.logger.info({ userId, githubUsername: userInfo.login }, 'GitHub credentials stored successfully');
  }

  /**
   * Get GitHub token for a user (decrypted)
   */
  async getUserToken(userId: string): Promise<GitHubTokenInfo | null> {
    try {
      const credential = await prisma.userGitHubCredential.findUnique({
        where: { user_id: userId }
      });

      if (!credential) {
        return null;
      }

      // Update last_used_at
      await prisma.userGitHubCredential.update({
        where: { user_id: userId },
        data: { last_used_at: new Date() }
      }).catch(() => {}); // Don't fail if update fails

      return {
        access_token: this.decrypt(credential.access_token),
        refresh_token: credential.refresh_token ?
          this.decrypt(credential.refresh_token) : undefined,
        token_type: credential.token_type,
        scope: credential.scope || undefined,
        expires_at: credential.expires_at || undefined,
        is_valid: credential.is_valid
      };
    } catch (error) {
      this.logger.error({ userId, error: (error as Error).message }, 'Failed to get GitHub token');
      return null;
    }
  }

  /**
   * Get GitHub token string for MCP injection (just the access token)
   */
  async getValidTokenString(userId: string): Promise<string | null> {
    const tokenInfo = await this.getUserToken(userId);

    if (!tokenInfo || !tokenInfo.is_valid) {
      return null;
    }

    // Validate token is still working
    try {
      const isValid = await this.validateToken(tokenInfo.access_token);
      if (!isValid) {
        // Mark as invalid
        await prisma.userGitHubCredential.update({
          where: { user_id: userId },
          data: { is_valid: false }
        });
        return null;
      }
    } catch (e) {
      // Network error - assume token is still valid
      this.logger.warn({ userId }, 'Could not validate GitHub token - assuming valid');
    }

    return tokenInfo.access_token;
  }

  /**
   * Validate a GitHub token by making a test API call
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      return response.ok;
    } catch (error) {
      this.logger.error({ error: (error as Error).message }, 'GitHub token validation failed');
      return false;
    }
  }

  /**
   * Get GitHub connection status for a user
   */
  async getConnectionStatus(userId: string): Promise<{
    connected: boolean;
    githubUsername?: string;
    githubEmail?: string;
    avatarUrl?: string;
    scopes?: string[];
    lastUsed?: Date;
    isValid: boolean;
  }> {
    const credential = await prisma.userGitHubCredential.findUnique({
      where: { user_id: userId },
      select: {
        github_username: true,
        github_email: true,
        avatar_url: true,
        scope: true,
        last_used_at: true,
        is_valid: true
      }
    });

    if (!credential) {
      return { connected: false, isValid: false };
    }

    return {
      connected: true,
      githubUsername: credential.github_username || undefined,
      githubEmail: credential.github_email || undefined,
      avatarUrl: credential.avatar_url || undefined,
      scopes: credential.scope?.split(',').map(s => s.trim()) || [],
      lastUsed: credential.last_used_at || undefined,
      isValid: credential.is_valid
    };
  }

  /**
   * Disconnect GitHub for a user
   */
  async disconnect(userId: string): Promise<boolean> {
    try {
      await prisma.userGitHubCredential.delete({
        where: { user_id: userId }
      });

      this.logger.info({ userId }, 'GitHub disconnected');
      return true;
    } catch (error) {
      if ((error as any).code === 'P2025') {
        // Record not found - already disconnected
        return true;
      }
      this.logger.error({ userId, error: (error as Error).message }, 'Failed to disconnect GitHub');
      return false;
    }
  }

  /**
   * Check if GitHub OAuth is configured
   */
  isConfigured(): boolean {
    // Device Flow only needs clientId, not secret or redirect URI
    return !!GITHUB_CLIENT_ID;
  }

  /**
   * Check if full OAuth (with redirect) is configured
   */
  isFullOAuthConfigured(): boolean {
    return !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET && GITHUB_REDIRECT_URI);
  }

  // ============================================================================
  // Device Flow Methods (for terminal/CLI use)
  // ============================================================================

  /**
   * Initiate GitHub Device Flow - returns code for user to enter
   */
  async initiateDeviceFlow(userId: string): Promise<GitHubDeviceFlowSession> {
    if (!GITHUB_CLIENT_ID) {
      throw new Error('GitHub OAuth not configured - missing client ID');
    }

    this.logger.info({ userId }, 'Initiating GitHub Device Flow');

    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: 'repo read:org read:user user:email'
      })
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error({ status: response.status, error }, 'Device Flow initiation failed');
      throw new Error(`GitHub Device Flow failed: ${response.status}`);
    }

    const data: GitHubDeviceCodeResponse = await response.json();

    this.logger.info({
      userId,
      userCode: data.user_code,
      expiresIn: data.expires_in
    }, 'Device Flow initiated - user must enter code');

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresAt: Date.now() + (data.expires_in * 1000),
      interval: data.interval || 5,
      userId
    };
  }

  /**
   * Poll for Device Flow completion
   * Returns token info if successful, null if still pending, throws on error/expiry
   */
  async pollDeviceFlow(session: GitHubDeviceFlowSession): Promise<GitHubTokenInfo | null> {
    if (Date.now() > session.expiresAt) {
      throw new Error('Device Flow session expired');
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: session.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    const data = await response.json();

    if (data.error) {
      switch (data.error) {
        case 'authorization_pending':
          // User hasn't completed auth yet - keep polling
          return null;
        case 'slow_down':
          // Need to slow down polling — GitHub requires adding 5 seconds
          session.interval = (session.interval || 5) + 5;
          this.logger.warn({ newInterval: session.interval }, 'Device Flow: slow_down received, increasing interval');
          return null;
        case 'expired_token':
          throw new Error('Device Flow session expired - please try again');
        case 'access_denied':
          throw new Error('User denied authorization');
        default:
          throw new Error(`GitHub Device Flow error: ${data.error_description || data.error}`);
      }
    }

    // Success! We have the token
    this.logger.info({ userId: session.userId }, 'Device Flow completed successfully');

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || 'bearer',
      scope: data.scope,
      is_valid: true
    };
  }

  /**
   * Complete Device Flow - poll until success or timeout
   * This is a convenience method that handles the polling loop
   */
  async completeDeviceFlow(
    session: GitHubDeviceFlowSession,
    onPoll?: (attempt: number) => void
  ): Promise<{ tokenInfo: GitHubTokenInfo; userInfo: GitHubUserInfo }> {
    const maxAttempts = Math.ceil((session.expiresAt - Date.now()) / (session.interval * 1000));
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      onPoll?.(attempt);

      const tokenInfo = await this.pollDeviceFlow(session);

      if (tokenInfo) {
        // Got the token - fetch user info and store
        const userInfo = await this.fetchUserInfo(tokenInfo.access_token);
        await this.storeCredentials(session.userId, tokenInfo, userInfo);
        return { tokenInfo, userInfo };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, session.interval * 1000));
    }

    throw new Error('Device Flow timed out');
  }

  /**
   * Get OAuth configuration status (for health checks)
   */
  getConfigStatus(): { configured: boolean; clientId?: string; redirectUri?: string } {
    return {
      configured: this.isConfigured(),
      clientId: GITHUB_CLIENT_ID ? `${GITHUB_CLIENT_ID.substring(0, 8)}...` : undefined,
      redirectUri: GITHUB_REDIRECT_URI || undefined
    };
  }

  // ============================================================================
  // Encryption helpers
  // ============================================================================

  /**
   * AES-256-GCM encrypt. Format: `ghenc2:<iv-hex>:<tag-hex>:<ciphertext-hex>`.
   * 12-byte IV (GCM standard) + 16-byte auth tag bind integrity to confidentiality.
   * Legacy `ghenc:` CBC rows are still readable via decrypt() for a seamless migration.
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `ghenc2:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  }

  private decrypt(text: string): string {
    // GCM (new format)
    if (text.startsWith('ghenc2:')) {
      const parts = text.split(':');
      if (parts.length !== 4) throw new Error('Invalid ghenc2 format');
      const iv = Buffer.from(parts[1], 'hex');
      const tag = Buffer.from(parts[2], 'hex');
      const encrypted = parts[3];
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    // Legacy CBC — kept for existing rows written before the GCM migration.
    // New writes always use GCM; old rows re-encrypt to GCM on next write.
    if (text.startsWith('ghenc:')) {
      const parts = text.split(':');
      if (parts.length !== 3) throw new Error('Invalid ghenc format');
      const iv = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    return text; // Not encrypted — backwards-compat passthrough.
  }
}

// Singleton factory
let _instance: GitHubCredentialService | null = null;

export function getGitHubCredentialService(logger: FastifyBaseLogger): GitHubCredentialService {
  if (!_instance) {
    _instance = new GitHubCredentialService(logger);
  }
  return _instance;
}
