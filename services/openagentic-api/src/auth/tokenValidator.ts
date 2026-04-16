/**
 * UNIFIED Token Validation - USE THIS EVERYWHERE
 *
 * This is the SINGLE source of truth for token validation.
 * It handles:
 * 1. Local JWT tokens
 * 2. Azure AD tokens (when AUTH_PROVIDER=azure-ad)
 * 3. Google tokens (when AUTH_PROVIDER=google)
 * 4. API keys (awc_<64-hex-chars>)
 *
 * STOP CALLING azureADAuthService.validateToken() DIRECTLY!
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AzureADAuthService, UserContext } from './azureADAuth.js';
import { GoogleAuthService, getGoogleAuthService } from './googleAuth.js';
import { prisma } from '../utils/prisma.js';

// Auth provider configuration - determines which external IdP to use
const AUTH_PROVIDER = process.env.AUTH_PROVIDER || 'azure-ad';

// Initialize auth services based on provider
// Azure AD is enabled for: azure-ad, azure, hybrid, both, all
const azureADAuthService = ['azure-ad', 'azure', 'hybrid', 'both', 'all'].includes(AUTH_PROVIDER) ? new AzureADAuthService({}) : null;
// Google is enabled for: google, hybrid, both, all
const googleAuthService = ['google', 'hybrid', 'both', 'all'].includes(AUTH_PROVIDER) ? getGoogleAuthService() : null;

import crypto from 'crypto';

// Resolve JWT_SECRET: use env var if set and not a placeholder, otherwise generate a runtime secret
const rawJwtSecret = process.env.JWT_SECRET;
const isPlaceholder = !rawJwtSecret || rawJwtSecret.toLowerCase().includes('placeholder');
const JWT_SECRET = isPlaceholder
  ? crypto.randomBytes(64).toString('hex')
  : rawJwtSecret;

if (isPlaceholder) {
  console.error('[CRITICAL] JWT_SECRET is missing or contains a placeholder value. Generated an ephemeral runtime secret — sessions will not persist across restarts. Fix: set a real JWT_SECRET in Helm values or Vault ESO.');
}

export interface UnifiedTokenResult {
  isValid: boolean;
  user?: UserContext;
  error?: string;
  tokenType?: 'local' | 'azure-ad' | 'google' | 'api-key';
  apiKeyId?: string; // For API key requests, used for usage tracking
  apiKeyName?: string; // Human-readable name of the API key
}

// Export auth provider for other modules to check
export const getAuthProvider = () => AUTH_PROVIDER;

/**
 * Validates ANY token - local JWT, Azure AD, or API key
 *
 * ALWAYS USE THIS FUNCTION FOR TOKEN VALIDATION
 *
 * @param token - The token to validate
 * @param options - Optional settings
 * @returns Validation result with user context
 */
export async function validateAnyToken(
  token: string,
  options?: {
    requireAdmin?: boolean;
    logger?: any;
  }
): Promise<UnifiedTokenResult> {
  try {
    // Step 0: Check if this is an API key (format: awc_<64-hex-chars>)
    if (token.startsWith('awc_')) {
      if (options?.logger) {
        options.logger.debug({ tokenPrefix: 'awc_' }, '[TOKEN-VALIDATOR] Detected API key format');
      }

      return await validateApiKey(token, options);
    }

    // Step 1: Try to decode the token to determine its type (JWT)
    let decoded: any;
    try {
      decoded = jwt.decode(token, { complete: true });
    } catch {
      // Can't decode at all - invalid token
      return {
        isValid: false,
        error: 'Invalid token format'
      };
    }

    // Check if decode returned null (malformed JWT - not 3 parts, invalid base64, etc.)
    if (!decoded || !decoded.payload) {
      if (options?.logger) {
        options.logger.warn({ tokenLength: token.length }, '[TOKEN-VALIDATOR] Token decode returned null - malformed JWT');
      }
      return {
        isValid: false,
        error: 'Malformed token - unable to decode'
      };
    }

    // Step 2: Detect token type based on payload claims
    const hasUserId = !!decoded?.payload?.userId;
    const hasTid = !!decoded?.payload?.tid;       // Azure AD tenant ID
    const hasOid = !!decoded?.payload?.oid;       // Azure AD object ID
    const issuer = decoded?.payload?.iss || '';

    // Google tokens have issuer containing 'accounts.google.com'
    const isGoogleToken = issuer.includes('accounts.google.com');

    // Local tokens have userId field and NO external IdP fields
    const isLocalToken = hasUserId && !hasTid && !hasOid && !isGoogleToken;

    // Azure AD tokens have tid and oid
    const isAzureAdToken = hasTid && hasOid && !isGoogleToken;

    if (options?.logger) {
      options.logger.debug({
        hasUserId,
        hasTid,
        hasOid,
        issuer: issuer.substring(0, 50),
        isLocalToken,
        isAzureAdToken,
        isGoogleToken,
        authProvider: AUTH_PROVIDER,
        payloadKeys: decoded?.payload ? Object.keys(decoded.payload) : []
      }, '[TOKEN-VALIDATOR] Token type detection');
    }

    // Step 3: Validate based on token type

    // 3a: Google tokens
    if (isGoogleToken) {
      if (!googleAuthService) {
        return {
          isValid: false,
          error: 'Google authentication is not enabled (AUTH_PROVIDER != google)',
          tokenType: 'google'
        };
      }

      try {
        const validationResult = await googleAuthService.validateIdToken(token);

        if (!validationResult.isValid || !validationResult.user) {
          return {
            isValid: false,
            error: validationResult.error || 'Google token validation failed',
            tokenType: 'google'
          };
        }

        // Convert Google user to UserContext
        const user: UserContext = {
          userId: `google_${validationResult.user.userId}`,
          email: validationResult.user.email,
          name: validationResult.user.name || '',
          isAdmin: validationResult.user.isAdmin || false,
          groups: validationResult.user.groups || [],
          roles: validationResult.user.isAdmin ? ['admin'] : [],
          tenantId: validationResult.user.hostedDomain || 'google'
        };

        // Check admin requirement
        if (options?.requireAdmin && !user.isAdmin) {
          return {
            isValid: false,
            error: 'Administrator access required',
            tokenType: 'google'
          };
        }

        if (options?.logger) {
          options.logger.info({
            userId: user.userId,
            email: user.email,
            isAdmin: user.isAdmin,
            hostedDomain: validationResult.user.hostedDomain
          }, '[TOKEN-VALIDATOR] Google token validated successfully');
        }

        return {
          isValid: true,
          user,
          tokenType: 'google'
        };
      } catch (error: any) {
        return {
          isValid: false,
          error: `Google token validation failed: ${error.message}`,
          tokenType: 'google'
        };
      }
    }

    // 3b: Local tokens
    if (isLocalToken) {
      // LOCAL TOKEN - validate with JWT_SECRET
      try {
        const payload = jwt.verify(token, JWT_SECRET) as any;

        // Handle both camelCase (isAdmin) and snake_case (is_admin) for compatibility
        const adminFlag = payload.isAdmin || payload.is_admin || false;

        const user: UserContext = {
          userId: payload.userId,
          email: payload.email,
          name: payload.name || '',
          isAdmin: adminFlag,
          groups: payload.groups || [],
          roles: adminFlag ? ['admin'] : [],
          tenantId: 'local'
        };

        // Check admin requirement
        if (options?.requireAdmin && !user.isAdmin) {
          return {
            isValid: false,
            error: 'Administrator access required',
            tokenType: 'local'
          };
        }

        if (options?.logger) {
          options.logger.info({
            userId: user.userId,
            email: user.email,
            isAdmin: user.isAdmin
          }, '[TOKEN-VALIDATOR] Local token validated successfully');
        }

        return {
          isValid: true,
          user,
          tokenType: 'local'
        };
      } catch (error: any) {
        return {
          isValid: false,
          error: `Local token validation failed: ${error.message}`,
          tokenType: 'local'
        };
      }
    } else {
      // AZURE AD TOKEN - validate with Azure AD service
      if (!azureADAuthService) {
        return {
          isValid: false,
          error: 'Azure AD authentication is not enabled (AUTH_PROVIDER != azure-ad)',
          tokenType: 'azure-ad'
        };
      }

      try {
        const validationResult = await azureADAuthService.validateToken(token);

        if (!validationResult.isValid || !validationResult.user) {
          return {
            isValid: false,
            error: validationResult.error || 'Azure AD token validation failed',
            tokenType: 'azure-ad'
          };
        }

        // Check admin requirement
        if (options?.requireAdmin && !validationResult.user.isAdmin) {
          return {
            isValid: false,
            error: 'Administrator access required',
            tokenType: 'azure-ad'
          };
        }

        if (options?.logger) {
          options.logger.info({
            userId: validationResult.user.userId,
            email: validationResult.user.email,
            isAdmin: validationResult.user.isAdmin
          }, '[TOKEN-VALIDATOR] Azure AD token validated successfully');
        }

        return {
          isValid: true,
          user: validationResult.user,
          tokenType: 'azure-ad'
        };
      } catch (error: any) {
        return {
          isValid: false,
          error: `Azure AD token validation failed: ${error.message}`,
          tokenType: 'azure-ad'
        };
      }
    }
  } catch (error: any) {
    return {
      isValid: false,
      error: `Token validation error: ${error.message}`
    };
  }
}

/**
 * Validate API key against database
 * API keys are stored as bcrypt hashes and checked against all active keys
 */
async function validateApiKey(
  apiKey: string,
  options?: {
    requireAdmin?: boolean;
    logger?: any;
  }
): Promise<UnifiedTokenResult> {
  try {
    // Fetch all active API keys from database
    const apiKeys = await prisma.apiKey.findMany({
      where: {
        is_active: true,
        OR: [
          { expires_at: null },
          { expires_at: { gt: new Date() } }
        ]
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            is_admin: true,
            groups: true
          }
        }
      }
    });

    // Check the provided API key against each stored hash
    for (const storedKey of apiKeys) {
      const isMatch = await bcrypt.compare(apiKey, storedKey.key_hash);

      if (isMatch) {
        // Found matching API key - update last_used_at
        await prisma.apiKey.update({
          where: { id: storedKey.id },
          data: { last_used_at: new Date() }
        });

        const user: UserContext = {
          userId: storedKey.user.id,
          email: storedKey.user.email,
          name: storedKey.user.name || storedKey.user.email,
          isAdmin: storedKey.user.is_admin,
          groups: storedKey.user.groups || [],
          roles: storedKey.user.is_admin ? ['admin'] : [],
          tenantId: 'api-key'
        };

        // Check admin requirement
        if (options?.requireAdmin && !user.isAdmin) {
          return {
            isValid: false,
            error: 'Administrator access required',
            tokenType: 'api-key'
          };
        }

        if (options?.logger) {
          options.logger.info({
            tokenId: storedKey.id,
            userId: user.userId,
            email: user.email,
            tokenName: storedKey.name
          }, '[TOKEN-VALIDATOR] API key validated successfully');
        }

        return {
          isValid: true,
          user,
          tokenType: 'api-key',
          apiKeyId: storedKey.id,
          apiKeyName: storedKey.name
        };
      }
    }

    // No matching API key found
    if (options?.logger) {
      options.logger.warn('[TOKEN-VALIDATOR] API key not found or inactive');
    }

    return {
      isValid: false,
      error: 'Invalid or inactive API key',
      tokenType: 'api-key'
    };
  } catch (error: any) {
    if (options?.logger) {
      options.logger.error({ error }, '[TOKEN-VALIDATOR] API key validation error');
    }

    return {
      isValid: false,
      error: `API key validation failed: ${error.message}`,
      tokenType: 'api-key'
    };
  }
}

/**
 * Extract token from Authorization header
 */
export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}