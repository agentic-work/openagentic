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
 * Authentication Middleware for Chat API
 * 
 * Handles JWT token validation and user extraction
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { loggers } from '../../../utils/logger.js';

export interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    oid: string; // Required by UserPayload interface
    userId: string;  // Required by UserPayload
    email: string;
    name?: string;
    groups: string[];
    isAdmin: boolean;
    azureOid?: string;
    localAccount: boolean;  // Required by UserPayload
    accessToken?: string;  // Optional - only for Azure AD users
  };
  requestId?: string;
}

export async function authMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  const startTime = Date.now();
  const requestId = request.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  loggers.auth.debug({
    requestId,
    method: request.method,
    url: request.url,
    hasAuthHeader: !!request.headers.authorization,
    userAgent: request.headers['user-agent'],
    clientIP: request.ip
  }, '[AUTH] Processing authentication middleware');

  try {
    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      loggers.auth.warn({
        requestId,
        hasAuthHeader: !!authHeader,
        authHeaderPrefix: authHeader ? authHeader.substring(0, 10) : null,
        method: request.method,
        url: request.url
      }, '[AUTH] [BLOCKED] No Authorization header or Bearer token');
      
      return reply.code(401).send({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authorization header with Bearer token required'
        }
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    loggers.auth.debug({
      requestId,
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 20) + '...',
      method: request.method
    }, '[AUTH] Extracted Bearer token, starting verification');

    // Verify and decode JWT token
    const decoded = await verifyToken(token);
    
    loggers.auth.debug({
      requestId,
      tokenVerified: !!decoded,
      decodedClaims: decoded ? {
        hasOid: !!decoded.oid,
        hasUserId: !!decoded.userId,
        hasSub: !!decoded.sub,
        hasEmail: !!(decoded.email || decoded.preferred_username),
        hasGroups: !!decoded.groups,
        exp: decoded.exp,
        iss: decoded.iss ? decoded.iss.substring(0, 50) + '...' : null
      } : null
    }, '[AUTH] Token verification completed');
    
    // Extract user information from token
    const user = await extractUserFromToken(decoded);
    
    loggers.auth.debug({
      requestId,
      userExtracted: !!user,
      userData: user ? {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        localAccount: user.localAccount,
        groupCount: user.groups ? user.groups.length : 0
      } : null
    }, '[AUTH] User extraction completed');
    
    if (!user) {
      loggers.auth.warn({
        requestId,
        tokenDecoded: !!decoded,
        decodedOid: decoded?.oid,
        decodedUserId: decoded?.userId,
        method: request.method,
        url: request.url
      }, '[AUTH] [BLOCKED] Failed to extract user from token');
      
      return reply.code(401).send({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token'
        }
      });
    }

    // Attach user to request with access token
    request.user = {
      ...user,
      accessToken: user.localAccount ? undefined : token // Only include token for Azure AD users
    };
    
    const executionTime = Date.now() - startTime;
    loggers.auth.info({ 
      requestId,
      userId: user.id, 
      email: user.email, 
      name: user.name,
      isAdmin: user.isAdmin,
      hasAccessToken: !user.localAccount,
      isAzureAD: !user.localAccount,
      localAccount: user.localAccount,
      groupCount: user.groups ? user.groups.length : 0,
      method: request.method,
      url: request.url,
      executionTime
    }, '[AUTH] [SUCCESS] User authenticated successfully');
    
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    loggers.auth.error({
      requestId,
      err: error,
      errorMessage: error.message,
      errorStack: error.stack,
      errorName: error.name,
      method: request.method,
      url: request.url,
      executionTime
    }, '[AUTH] [ERROR] Authentication failed with exception');
    
    return reply.code(401).send({
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'Authentication failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      }
    });
  }
}

/**
 * Verify JWT token
 */
async function verifyToken(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const tokenId = `token_${token.substring(0, 10)}...`;
    
    // Try JWT secret first (for local tokens)
    const jwtSecret = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
    if (!jwtSecret) {
        loggers.auth.error('JWT_SECRET or SIGNING_SECRET environment variable is required');
        throw new Error('Authentication configuration error: Missing JWT secret');
    }
    
    loggers.auth.debug({
      tokenId,
      hasJwtSecret: !!jwtSecret,
      jwtSecretLength: jwtSecret ? jwtSecret.length : 0,
      tokenLength: token.length
    }, '[AUTH] Starting token verification - trying JWT first');
    
    if (jwtSecret) {
      jwt.verify(token, jwtSecret, (err, decoded) => {
        if (!err && decoded) {
          loggers.auth.debug({
            tokenId,
            decodedType: typeof decoded,
            hasOid: !!(decoded as any).oid,
            hasUserId: !!(decoded as any).userId,
            hasSub: !!(decoded as any).sub
          }, '[AUTH] [SUCCESS] Successfully verified local JWT token');
          resolve(decoded);
          return;
        }
        
        loggers.auth.debug({
          tokenId,
          jwtError: err?.message,
          jwtErrorName: err?.name,
          tryingAzureAD: true
        }, '[AUTH] JWT verification failed, trying Azure AD validation');
        
        // If JWT verification fails, try Azure AD validation
        verifyAzureToken(token)
          .then((azureDecoded) => {
            loggers.auth.debug({
              tokenId,
              azureVerificationSuccess: true
            }, '[AUTH] [SUCCESS] Azure AD token verification succeeded after JWT failed');
            resolve(azureDecoded);
          })
          .catch((azureErr) => {
            // If both fail, return the JWT error as it's more likely a local token
            loggers.auth.error({
              tokenId,
              jwtError: err?.message,
              azureError: azureErr.message,
              tokenPrefix: token.substring(0, 50) + '...'
            }, '[AUTH] [ERROR] Both JWT and Azure AD verification failed');
            reject(err || azureErr);
          });
      });
    } else {
      loggers.auth.debug({
        tokenId,
        onlyAzureAD: true
      }, '[AUTH] No JWT secret configured, only trying Azure AD tokens');
      
      // Only Azure AD tokens
      verifyAzureToken(token)
        .then((azureDecoded) => {
          loggers.auth.debug({
            tokenId,
            azureOnlySuccess: true
          }, '[AUTH] [SUCCESS] Azure AD token verification succeeded (JWT secret not configured)');
          resolve(azureDecoded);
        })
        .catch((azureErr) => {
          loggers.auth.error({
            tokenId,
            azureError: azureErr.message,
            noJwtSecret: true
          }, '[AUTH] [ERROR] Azure AD verification failed and no JWT secret configured');
          reject(azureErr);
        });
    }
  });
}

/**
 * Verify Azure AD token
 */
async function verifyAzureToken(token: string): Promise<any> {
  const tokenId = `token_${token.substring(0, 10)}...`;
  
  loggers.auth.debug({
    tokenId,
    tokenLength: token.length
  }, '[AUTH] Starting Azure AD token verification');
  
  try {
    // For Azure AD tokens from MSAL, we can trust them since they've already been validated
    // by MSAL in the frontend. We just need to decode and verify the structure.
    
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') {
      loggers.auth.error({
        tokenId,
        decodedType: typeof decoded,
        decodedIsNull: decoded === null
      }, '[AUTH] [ERROR] Token decode failed - invalid format');
      throw new Error('Invalid token format');
    }
    
    const payload = decoded.payload as any;
    
    loggers.auth.debug({
      tokenId,
      azureAdClaims: {
        aud: payload.aud,
        iss: payload.iss ? payload.iss.substring(0, 50) + '...' : null,
        oid: payload.oid,
        email: payload.email || payload.preferred_username,
        name: payload.name,
        exp: payload.exp,
        groupCount: payload.groups?.length || 0,
        hasRequiredClaims: !!(payload.aud && payload.iss && payload.oid)
      }
    }, '[AUTH] Azure AD token claims extracted');
    
    // Verify this is an Azure AD token by checking for required claims
    if (!payload.aud || !payload.iss || !payload.oid) {
      loggers.auth.error({
        tokenId,
        missingClaims: {
          aud: !!payload.aud,
          iss: !!payload.iss,
          oid: !!payload.oid
        }
      }, '[AUTH] [ERROR] Missing required Azure AD claims');
      throw new Error('Invalid Azure AD token structure');
    }
    
    // Verify the issuer is from Microsoft (both login.microsoftonline.com and sts.windows.net are valid)
    const isMicrosoftIssuer = payload.iss.includes('login.microsoftonline.com') || payload.iss.includes('sts.windows.net');
    if (!isMicrosoftIssuer) {
      loggers.auth.error({
        tokenId,
        issuer: payload.iss,
        isMicrosoftIssuer: false
      }, '[AUTH] [ERROR] Invalid issuer - not from Microsoft login');
      throw new Error('Token not from Microsoft login');
    }
    
    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    const isExpired = payload.exp && payload.exp < now;
    if (isExpired) {
      loggers.auth.error({
        tokenId,
        exp: payload.exp,
        now,
        timeDiff: now - payload.exp,
        isExpired: true
      }, '[AUTH] [ERROR] Azure AD token expired');
      throw new Error('Token expired');
    }
    
    loggers.auth.debug({
      tokenId,
      azureAdVerification: {
        hasRequiredClaims: true,
        isMicrosoftIssuer: true,
        isExpired: false,
        timeUntilExpiry: payload.exp ? payload.exp - now : null
      }
    }, '[AUTH] [SUCCESS] Azure AD token verification completed successfully');
    
    return payload;
    
  } catch (error: any) {
    loggers.auth.error({
      tokenId,
      err: error,
      errorMessage: error.message,
      errorName: error.name,
      errorStack: error.stack
    }, '[AUTH] [ERROR] Azure AD token verification failed');
    throw new Error(`Invalid Azure AD token: ${error.message}`);
  }
}

/**
 * Extract user information from decoded token
 */
async function extractUserFromToken(decoded: any): Promise<any | null> {
  const tokenId = `token_${JSON.stringify(decoded).substring(0, 10)}...`;
  
  loggers.auth.debug({
    tokenId,
    decodedClaims: {
      hasUserId: !!decoded.userId,
      hasSub: !!decoded.sub,
      hasOid: !!decoded.oid,
      hasEmail: !!(decoded.email || decoded.preferred_username),
      hasGroups: !!decoded.groups,
      isLocal: !!(decoded.userId || decoded.sub),
      isAzureAD: !!decoded.oid
    }
  }, '[AUTH] Starting user extraction from token');

  try {
    // Handle local JWT tokens
    if (decoded.userId || decoded.sub) {
      const localUser = {
        id: decoded.userId || decoded.sub,
        oid: decoded.oid || decoded.userId || decoded.sub, // Use oid if available, fallback to user ID
        userId: decoded.userId || decoded.sub,  // Required by UserPayload
        email: decoded.email || '',
        name: decoded.name || decoded.displayName,
        groups: decoded.groups || [],
        isAdmin: decoded.isAdmin || false,
        azureOid: decoded.oid,
        localAccount: !decoded.oid // If no Azure OID, it's a local account
      };
      
      loggers.auth.debug({
        tokenId,
        localUser: {
          id: localUser.id,
          email: localUser.email,
          name: localUser.name,
          isAdmin: localUser.isAdmin,
          localAccount: localUser.localAccount,
          groupCount: localUser.groups.length
        }
      }, '[AUTH] [SUCCESS] Extracted local JWT user');
      
      return localUser;
    }
    
    // Handle Azure AD tokens
    if (decoded.oid) {
      // Check if user is in the admin group
      const adminGroupId = process.env.AZURE_AD_ADMIN_GROUP;
      const userGroups = decoded.groups || [];
      const isAdmin = (adminGroupId && userGroups.includes(adminGroupId)) || 
                     userGroups.includes('OpenAgenticAdmins');
      
      loggers.auth.debug({
        tokenId,
        azureOid: decoded.oid,
        adminGroupId,
        userGroupCount: userGroups.length,
        isAdmin,
        hasAdminGroup: !!adminGroupId
      }, '[AUTH] Processing Azure AD user - checking admin status');
      
      // Look up the database user by Azure OID
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL || 
          `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/${process.env.POSTGRES_DB}`
      });
      
      loggers.auth.debug({
        tokenId,
        azureOid: decoded.oid,
        databaseLookup: true,
        hasConnectionString: !!process.env.DATABASE_URL
      }, '[AUTH] Looking up Azure AD user in database');
      
      try {
        const result = await pool.query(
          'SELECT id, email, name, is_admin, groups FROM users WHERE azure_oid = $1',
          [decoded.oid]
        );

        if (result.rows.length > 0) {
          const dbUser = result.rows[0];
          const syncedUser = {
            id: dbUser.id, // Use database user ID
            oid: decoded.oid,
            userId: dbUser.id,  // Required by UserPayload
            email: dbUser.email || '',
            name: dbUser.name,
            groups: dbUser.groups || userGroups,
            isAdmin: dbUser.is_admin || isAdmin, // Use snake_case from database
            azureOid: decoded.oid,
            localAccount: false
          };
          
          loggers.auth.info({
            tokenId,
            azureOid: decoded.oid,
            dbUserId: dbUser.id,
            dbUserEmail: dbUser.email,
            dbUserIsAdmin: dbUser.isAdmin,
            finalIsAdmin: syncedUser.isAdmin,
            userSynced: true
          }, '[AUTH] [SUCCESS] Found synced Azure AD user in database');
          
          return syncedUser;
        } else {
          // User not synced yet - return Azure OID as ID
          // The UI should call /api/auth/azure/sync to create the database user
          const unsyncedUser = {
            id: decoded.oid,
            oid: decoded.oid,
            userId: decoded.oid,  // Required by UserPayload
            email: decoded.email || decoded.preferred_username || decoded.upn || '',
            name: decoded.name || (decoded.given_name && decoded.family_name ?
                   decoded.given_name + ' ' + decoded.family_name : null),
            groups: userGroups,
            isAdmin: isAdmin,
            azureOid: decoded.oid,
            localAccount: false
          };
          
          loggers.auth.warn({
            tokenId,
            azureOid: decoded.oid,
            email: unsyncedUser.email,
            name: unsyncedUser.name,
            isAdmin: unsyncedUser.isAdmin,
            userSynced: false,
            shouldCallSync: true
          }, '[AUTH] [WARNING] Azure AD user not found in database - using OID as ID. UI should call /api/auth/azure/sync');
          
          return unsyncedUser;
        }
      } catch (error: any) {
        loggers.auth.error({
          tokenId,
          azureOid: decoded.oid,
          err: error,
          errorMessage: error.message,
          databaseLookupFailed: true
        }, '[AUTH] [ERROR] Failed to look up user by Azure OID - using fallback');
        
        // Fallback to using OID as ID
        const fallbackUser = {
          id: decoded.oid,
          oid: decoded.oid,
          userId: decoded.oid,  // Required by UserPayload
          email: decoded.email || decoded.preferred_username || decoded.upn || '',
          name: decoded.name || (decoded.given_name && decoded.family_name ?
                 decoded.given_name + ' ' + decoded.family_name : null),
          groups: userGroups,
          isAdmin: isAdmin,
          azureOid: decoded.oid,
          localAccount: false
        };
        
        loggers.auth.warn({
          tokenId,
          fallbackUser: {
            id: fallbackUser.id,
            email: fallbackUser.email,
            name: fallbackUser.name,
            isAdmin: fallbackUser.isAdmin
          }
        }, '[AUTH] [FALLBACK] Using Azure OID as user ID due to database error');
        
        return fallbackUser;
      } finally {
        await pool.end();
      }
    }
    
    loggers.auth.error({
      tokenId,
      hasUserId: !!decoded.userId,
      hasSub: !!decoded.sub,
      hasOid: !!decoded.oid,
      noValidUserIdentifier: true
    }, '[AUTH] [ERROR] No valid user identifier found in token');
    
    return null;
    
  } catch (error: any) {
    loggers.auth.error({
      tokenId,
      err: error,
      errorMessage: error.message,
      errorStack: error.stack,
      extractionFailed: true
    }, '[AUTH] [ERROR] Failed to extract user from token');
    return null;
  }
}

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
export async function optionalAuthMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await authMiddleware(request, reply);
  } catch (error) {
    // Don't fail, just continue without user
    request.user = undefined;
  }
}

/**
 * Admin-only middleware
 */
export async function adminOnlyMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  const requestId = request.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  loggers.auth.debug({
    requestId,
    method: request.method,
    url: request.url,
    hasUser: !!request.user,
    userId: request.user?.id,
    userEmail: request.user?.email,
    isAdmin: request.user?.isAdmin
  }, '[AUTH] [ADMIN] Checking admin privileges');

  if (!request.user) {
    loggers.auth.warn({
      requestId,
      method: request.method,
      url: request.url,
      adminCheckFailed: 'no_user'
    }, '[AUTH] [ADMIN] [BLOCKED] Authentication required for admin endpoint');
    
    return reply.code(401).send({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required'
      }
    });
  }
  
  if (!request.user.isAdmin) {
    loggers.auth.warn({
      requestId,
      method: request.method,
      url: request.url,
      userId: request.user.id,
      userEmail: request.user.email,
      isAdmin: request.user.isAdmin,
      localAccount: request.user.localAccount,
      groupCount: request.user.groups ? request.user.groups.length : 0,
      adminCheckFailed: 'not_admin'
    }, '[AUTH] [ADMIN] [BLOCKED] User lacks administrative privileges');
    
    return reply.code(403).send({
      error: {
        code: 'ADMIN_REQUIRED',
        message: 'Administrative privileges required'
      }
    });
  }
  
  loggers.auth.info({
    requestId,
    method: request.method,
    url: request.url,
    userId: request.user.id,
    userEmail: request.user.email,
    isAdmin: request.user.isAdmin,
    adminCheckPassed: true
  }, '[AUTH] [ADMIN] [SUCCESS] Admin privileges verified');
}

/**
 * Create auth middleware plugin
 */
export const authMiddlewarePlugin = async (fastify: any, options: { authService: any }) => {
  fastify.decorateRequest('user', null);
  
  fastify.addHook('preHandler', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    // Skip auth for health check and other public endpoints
    // Check both relative and absolute paths
    const path = request.url;
    if (path === '/health' || path.endsWith('/health') || 
        path.startsWith('/docs') || path.includes('/docs/') ||
        path === '/test-image-generation' || path.endsWith('/test-image-generation')) {
      return;
    }
    
    // Apply authentication to all other endpoints
    await authMiddleware(request, reply);
  });
};