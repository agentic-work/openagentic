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
        console.log('🔍 [AUTH-DEBUG] Token found in cache, returning cached result');
        return {
          isValid: true,
          user: cached.user
        };
      }

      // Decode token header and payload for debugging
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.error('❌ [AUTH-DEBUG] Invalid token format - expected 3 parts, got', parts.length);
        throw new Error('Invalid token format');
      }

      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      console.log('🔍 [AUTH-DEBUG] Token details:');
      console.log('  - Algorithm:', header.alg);
      console.log('  - Key ID:', header.kid);
      console.log('  - Token Type:', header.typ);
      console.log('  - Issuer:', payload.iss);
      console.log('  - Audience:', payload.aud);
      console.log('  - Client ID:', payload.appid || payload.azp);
      console.log('  - Version:', payload.ver);
      console.log('  - Tenant ID:', payload.tid);

      // Create jwks-rsa client for Azure AD
      const jwksUri = `${this.config.authority}/discovery/v2.0/keys`;
      console.log('🔍 [AUTH-DEBUG] JWKS URI:', jwksUri);

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
        console.log('🔍 [AUTH-DEBUG] Fetching signing key for kid:', header.kid);
        client.getSigningKey(header.kid, (err, key) => {
          if (err) {
            console.error('❌ [AUTH-DEBUG] Error fetching signing key:', err.message);
            callback(err);
          } else {
            const signingKey = key?.getPublicKey();
            console.log('✅ [AUTH-DEBUG] Successfully fetched signing key');
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

      console.log('🔍 [AUTH-DEBUG] Valid issuers to try:', validIssuers);
      console.log('🔍 [AUTH-DEBUG] Expected audience:', this.config.clientId);

      let decoded: any = null;
      let lastError: Error | null = null;

      // Try each valid issuer until one works
      for (const issuer of validIssuers) {
        console.log(`🔍 [AUTH-DEBUG] Trying issuer: ${issuer}`);

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
          console.log(`🔍 [AUTH-DEBUG] Trying audience: ${audience}`);
          try {
            decoded = await new Promise<any>((resolve, reject) => {
              jwt.verify(token, getKey, {
                audience: audience,  // Re-enabled audience validation
                issuer: issuer,  // Single issuer
                algorithms: ['RS256']
              }, (err, decodedToken) => {
                if (err) {
                  console.log(`❌ [AUTH-DEBUG] Verification failed with issuer ${issuer}, audience ${audience}: ${err.message}`);
                  reject(err);
                } else {
                  console.log(`✅ [AUTH-DEBUG] Token verified successfully with issuer: ${issuer}, audience: ${audience}`);
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
        console.error('❌ [AUTH-DEBUG] All issuers failed. Last error:', lastError.message);
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

      console.log(`🔍 [AUTH-BACKEND] Token validation for user: ${user.email}`);
      console.log(`🔍 [AUTH-BACKEND] Configured authorized groups: [${authorizedGroups.join(', ')}]`);
      console.log(`🔍 [AUTH-BACKEND] Authorized group IDs: [${authorizedGroupIds.join(', ')}]`);
      console.log(`🔍 [AUTH-BACKEND] User's groups from token: [${(decoded.groups || []).join(', ')}]`);
      console.log(`🔍 [AUTH-BACKEND] User groups count: ${(decoded.groups || []).length}`);
      
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
        console.warn(`⚠️ [AUTH-BACKEND] Guest user ${user.email} detected with no groups in token. This is expected for Azure AD guest users.`);
        console.log(`🔍 [AUTH-BACKEND] Guest users often don't receive group claims. Consider using Microsoft Graph API for group validation.`);
      }

      const isAuthorizedUser = userGroups.some((group: string) =>
        allAuthorizedGroups.includes(group)
      );

      console.log(`🔍 [AUTH-BACKEND] Authorization check result: ${isAuthorizedUser}`);
      console.log(`🔍 [AUTH-BACKEND] Is guest user: ${isGuestUser}`);

      // Check for external/guest admins FIRST (before group validation)
      // For external users who might not have group claims, check explicit admin list
      const externalAdmins = (process.env.EXTERNAL_ADMIN_EMAILS || '').split(',')
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0);

      const isExternalAdmin = externalAdmins.includes(user.email.toLowerCase());

      console.log(`🔍 [AUTH-BACKEND] External admin emails configured: [${externalAdmins.join(', ')}]`);
      console.log(`🔍 [AUTH-BACKEND] Is external admin: ${isExternalAdmin}`);

      if (isExternalAdmin) {
        console.log(`✅ [AUTH-BACKEND] External user ${user.email} recognized as admin from EXTERNAL_ADMIN_EMAILS - bypassing group validation`);
      }

      // Deny access if user is not in any authorized group (unless group validation is disabled or user is an external admin)
      const skipGroupValidation = process.env.SKIP_GROUP_VALIDATION === 'true';
      const knownGuestAdmins = (process.env.KNOWN_GUEST_ADMINS || '').split(',').map(e => e.trim().toLowerCase());

      if (!skipGroupValidation && !isAuthorizedUser && !isExternalAdmin) {
        console.error(`❌ [AUTH-BACKEND] Access denied for ${user.email}. User groups: [${userGroups.join(', ')}], Required groups: [${allAuthorizedGroups.join(', ')}]`);
        return {
          isValid: false,
          error: `Access denied. User ${user.email} is not a member of any authorized Azure AD groups (${allAuthorizedGroups.join(', ')}). Please contact your administrator.`
        };
      }

      if (skipGroupValidation) {
        console.warn(`⚠️ [AUTH-BACKEND] Group validation is DISABLED. Allowing user ${user.email} without group check.`);
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

      console.log(`🔍 [AUTH-BACKEND] Admin groups to check: [${authorizedAdminGroups.join(', ')}]`);
      console.log(`🔍 [AUTH-BACKEND] Admin group IDs to check: [${adminGroupIds.join(', ')}]`);

      // Check if user is in admin groups
      const isInAdminGroup = userGroups.some((group: string) =>
        adminGroupIds.includes(group)
      );

      user.isAdmin = isInAdminGroup || skipGroupValidation || isExternalAdmin;
      
      console.log(`✅ [AUTH-BACKEND] User ${user.email} authorized successfully. Admin status: ${user.isAdmin}`);

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
      console.error('Failed to get user permissions:', error);
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
      console.error('Failed to get user group memberships:', error);
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
    console.error('Failed to decode token:', error);
    return null;
  }
}

