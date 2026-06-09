/**
 * UNIFIED Token Validation - USE THIS EVERYWHERE
 *
 * This is the SINGLE source of truth for token validation.
 * It handles:
 * 1. Local JWT tokens (HS256, signed with JWT_SECRET)
 * 2. API keys — user keys (oa_<43-char-base64url>) and system/inter-service
 *    tokens (oa_sys_<43-char-base64url>)
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { UserContext } from './types.js';
import { prisma } from '../utils/prisma.js';

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
  tokenType?: 'local' | 'api-key';
  apiKeyId?: string; // For API key requests, used for usage tracking
  apiKeyName?: string; // Human-readable name of the API key
}

/**
 * Validates ANY token - local JWT or API key
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
    // Step 0: Check if this is an API key.
    // User keys are formatted oa_<base64url(32 bytes)> and system/inter-service
    // tokens are formatted oa_sys_<base64url(32 bytes)>. Both share the oa_ prefix,
    // so a single startsWith('oa_') check routes either kind to bcrypt validation.
    if (token.startsWith('oa_')) {
      if (options?.logger) {
        const tokenPrefix = token.startsWith('oa_sys_') ? 'oa_sys_' : 'oa_';
        options.logger.debug({ tokenPrefix }, '[TOKEN-VALIDATOR] Detected API key format');
      }

      return await validateApiKey(token, options);
    }

    // Step 1: Treat as a locally-issued HS256 JWT. Verify against JWT_SECRET.
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;

      if (!payload?.userId) {
        return {
          isValid: false,
          error: 'Local token missing userId claim',
          tokenType: 'local'
        };
      }

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
      if (options?.logger) {
        options.logger.warn({ error: error.message }, '[TOKEN-VALIDATOR] Local token validation failed');
      }
      return {
        isValid: false,
        error: `Local token validation failed: ${error.message}`,
        tokenType: 'local'
      };
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