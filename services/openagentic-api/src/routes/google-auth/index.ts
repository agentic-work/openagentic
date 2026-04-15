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
 * Google OAuth Authentication Routes
 *
 * Handles Google OAuth 2.0 authentication flow with ACCESS CONTROL.
 * Only pre-approved users can log in. Unauthorized users trigger an access request
 * notification email to the admin.
 *
 * Routes:
 *   GET /api/auth/google/login - Initiate OAuth flow
 *   GET /api/auth/google/callback - Handle OAuth callback
 *   POST /api/auth/google/token - Exchange/validate ID token
 *   GET /api/auth/google/me - Get current user info
 *   POST /api/auth/google/logout - Logout
 *   GET /api/auth/google/config - Get auth config for frontend
 *
 * Access Control:
 *   - GOOGLE_ALLOWED_USERS: Comma-separated list of allowed email addresses
 *   - GOOGLE_ADMIN_EMAILS: Comma-separated list of admin email addresses
 *   - If user is not in allowed list, they see a friendly message and an email is sent
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getGoogleAuthService, GoogleAuthService, GoogleUserContext } from '../../auth/googleAuth.js';
import { prisma } from '../../utils/prisma.js';
import { getEmailService, AccessRequestData } from '../../services/EmailService.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET!;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ai.openagentics.io';

// Cached database access control - refresh every 60 seconds
let cachedDbAllowedUsers: Map<string, { isAdmin: boolean }> = new Map();
let cachedDbAllowedDomains: Map<string, { isAdminDomain: boolean }> = new Map();
let cacheLastUpdated: number = 0;
const CACHE_TTL_MS = 60000; // 60 seconds

// Load allowed users from environment (fallback)
function getEnvAllowedUsers(): Set<string> {
  const allowedUsersEnv = process.env.GOOGLE_ALLOWED_USERS || '';
  const adminEmailsEnv = process.env.GOOGLE_ADMIN_EMAILS || 'trent@openagentics.io';

  // Combine both allowed users and admin emails (admins are implicitly allowed)
  const allAllowed = `${allowedUsersEnv},${adminEmailsEnv}`
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  return new Set(allAllowed);
}

// Get admin emails from environment (fallback)
function getEnvAdminEmails(): Set<string> {
  const adminEmailsEnv = process.env.GOOGLE_ADMIN_EMAILS || 'trent@openagentics.io';
  return new Set(
    adminEmailsEnv.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  );
}

// Get allowed domains from environment (fallback)
function getEnvAllowedDomains(): Set<string> {
  const allowedDomainsEnv = process.env.GOOGLE_ALLOWED_DOMAINS || '';
  return new Set(
    allowedDomainsEnv.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
  );
}

// Refresh the database cache
async function refreshDbCache(): Promise<void> {
  const now = Date.now();
  if (now - cacheLastUpdated < CACHE_TTL_MS) {
    return; // Cache is still fresh
  }

  try {
    // Load allowed users from database
    const dbUsers = await prisma.authAllowedUser.findMany({
      where: { is_active: true },
      select: { email: true, is_admin: true }
    });

    cachedDbAllowedUsers = new Map(
      dbUsers.map(u => [u.email.toLowerCase(), { isAdmin: u.is_admin }])
    );

    // Load allowed domains from database
    const dbDomains = await prisma.authAllowedDomain.findMany({
      where: { is_active: true },
      select: { domain: true, is_admin_domain: true }
    });

    cachedDbAllowedDomains = new Map(
      dbDomains.map(d => [d.domain.toLowerCase(), { isAdminDomain: d.is_admin_domain }])
    );

    cacheLastUpdated = now;
  } catch (error) {
    // Database tables might not exist yet - silently fall back to env vars
    // This handles first-time deployment before migration is run
  }
}

// Check if a user is allowed to access the platform
// Priority: Database > Environment Variables
async function isUserAllowedAsync(email: string): Promise<{ allowed: boolean; isAdmin: boolean }> {
  await refreshDbCache();

  const emailLower = email.toLowerCase();
  const domain = emailLower.split('@')[1];

  // 1. Check database - user table (highest priority)
  if (cachedDbAllowedUsers.has(emailLower)) {
    const userData = cachedDbAllowedUsers.get(emailLower)!;
    return { allowed: true, isAdmin: userData.isAdmin };
  }

  // 2. Check database - domain table
  if (domain && cachedDbAllowedDomains.has(domain)) {
    const domainData = cachedDbAllowedDomains.get(domain)!;
    return { allowed: true, isAdmin: domainData.isAdminDomain };
  }

  // 3. Fallback to environment variables (for backward compatibility)
  const envAllowedUsers = getEnvAllowedUsers();
  if (envAllowedUsers.has(emailLower)) {
    const envAdmins = getEnvAdminEmails();
    return { allowed: true, isAdmin: envAdmins.has(emailLower) };
  }

  // 4. Check env domain allowance
  const envAllowedDomains = getEnvAllowedDomains();
  if (domain && envAllowedDomains.has(domain)) {
    return { allowed: true, isAdmin: false };
  }

  return { allowed: false, isAdmin: false };
}

// Synchronous version for backward compatibility (uses cache)
function isUserAllowed(email: string): boolean {
  const emailLower = email.toLowerCase();
  const domain = emailLower.split('@')[1];

  // Check cached database values
  if (cachedDbAllowedUsers.has(emailLower)) {
    return true;
  }
  if (domain && cachedDbAllowedDomains.has(domain)) {
    return true;
  }

  // Fall back to env vars
  const envAllowedUsers = getEnvAllowedUsers();
  if (envAllowedUsers.has(emailLower)) {
    return true;
  }

  const envAllowedDomains = getEnvAllowedDomains();
  if (domain && envAllowedDomains.has(domain)) {
    return true;
  }

  return false;
}

// Get client IP address from request
function getClientIP(request: FastifyRequest): string {
  // Check forwarded headers (for reverse proxy)
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
    return ips[0].trim();
  }

  const realIP = request.headers['x-real-ip'];
  if (realIP) {
    return Array.isArray(realIP) ? realIP[0] : realIP;
  }

  return request.ip || 'unknown';
}

// Handle unauthorized access - send email and return denial message
async function handleUnauthorizedAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  googleUser: GoogleUserContext,
  logger: any
): Promise<void> {
  const emailService = getEmailService(logger);

  // Collect all available information about the requester
  const accessRequestData: AccessRequestData = {
    email: googleUser.email,
    name: googleUser.name,
    picture: googleUser.picture,
    googleUserId: googleUser.userId,
    hostedDomain: googleUser.hostedDomain,
    ipAddress: getClientIP(request),
    userAgent: request.headers['user-agent'] || 'unknown',
    timestamp: new Date(),
    headers: Object.fromEntries(
      Object.entries(request.headers)
        .filter(([_, v]) => typeof v === 'string')
        .map(([k, v]) => [k, v as string])
    )
  };

  // Log the access attempt
  logger.warn({
    email: googleUser.email,
    name: googleUser.name,
    ipAddress: accessRequestData.ipAddress,
    hostedDomain: googleUser.hostedDomain
  }, '[GOOGLE-AUTH] Unauthorized access attempt - user not in allowed list');

  // Send notification email (async, don't wait)
  emailService.sendAccessRequestNotification(accessRequestData).catch(err => {
    logger.error({ error: err.message }, '[GOOGLE-AUTH] Failed to send access request email');
  });

  // Store the access request in database for tracking
  try {
    await prisma.accessRequest.create({
      data: {
        email: googleUser.email,
        name: googleUser.name,
        google_user_id: googleUser.userId,
        hosted_domain: googleUser.hostedDomain,
        ip_address: accessRequestData.ipAddress,
        user_agent: accessRequestData.userAgent,
        status: 'pending',
        request_data: accessRequestData as any
      }
    });
  } catch (dbError: any) {
    // Table might not exist yet - that's okay, we'll just log
    logger.warn({ error: dbError.message }, '[GOOGLE-AUTH] Could not store access request in database');
  }

  // Redirect to access denied page on frontend
  const deniedUrl = new URL(`${FRONTEND_URL}/auth/access-denied`);
  deniedUrl.searchParams.set('email', googleUser.email);

  return reply.redirect(deniedUrl.toString());
}

export const googleAuthRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;
  const googleAuth = getGoogleAuthService(logger as any);

  // Pre-load database cache on startup
  await refreshDbCache();

  // Log access control sources on startup
  const envAllowedUsers = getEnvAllowedUsers();
  logger.info({
    envAllowedUsersCount: envAllowedUsers.size,
    dbAllowedUsersCount: cachedDbAllowedUsers.size,
    dbAllowedDomainsCount: cachedDbAllowedDomains.size,
    envAllowedUsers: Array.from(envAllowedUsers),
    dbSource: cachedDbAllowedUsers.size > 0 ? 'database' : 'env-only'
  }, '[GOOGLE-AUTH] Access control initialized (DB + ENV fallback)');

  /**
   * Root route - redirect to login
   * GET /api/auth/google
   *
   * Provides a convenient redirect to the login endpoint
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect('/api/auth/google/login');
  });

  /**
   * Initiate Google OAuth login flow
   * GET /api/auth/google/login
   *
   * Redirects user to Google consent screen
   */
  fastify.get('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Generate state for CSRF protection
      const state = crypto.randomBytes(32).toString('hex');

      // Store state in session/cookie for verification
      // Use request.protocol to detect HTTPS (works with trustProxy: true in Fastify)
      // This handles TLS termination at ingress/reverse proxy correctly
      const isSecure = request.protocol === 'https' || process.env.NODE_ENV === 'production';

      reply.setCookie('google_oauth_state', state, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        maxAge: 600, // 10 minutes
        path: '/'
      });

      // Generate auth URL and redirect
      const authUrl = googleAuth.generateAuthUrl(state);

      logger.info({
        state: state.substring(0, 8) + '...',
        isSecure,
        protocol: request.protocol,
        host: request.hostname,
        xForwardedProto: request.headers['x-forwarded-proto']
      }, '[GOOGLE-AUTH] Initiating OAuth flow - setting state cookie');

      return reply.redirect(authUrl);
    } catch (error: any) {
      logger.error({ error: error.message }, '[GOOGLE-AUTH] Failed to initiate OAuth flow');
      return reply.redirect(`${FRONTEND_URL}/auth/error?error=${encodeURIComponent(error.message)}`);
    }
  });

  /**
   * Handle Google OAuth callback
   * GET /api/auth/google/callback
   *
   * Exchanges authorization code for tokens, validates user, and handles access control
   */
  fastify.get('/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { code, state, error, error_description } = request.query as {
        code?: string;
        state?: string;
        error?: string;
        error_description?: string;
      };

      // Check for OAuth errors
      if (error) {
        logger.error({ error, error_description }, '[GOOGLE-AUTH] OAuth error from Google');
        return reply.redirect(`${FRONTEND_URL}/auth/error?error=${encodeURIComponent(error_description || error)}`);
      }

      if (!code || !state) {
        return reply.redirect(`${FRONTEND_URL}/auth/error?error=${encodeURIComponent('Missing code or state')}`);
      }

      // Verify state matches
      const storedState = request.cookies['google_oauth_state'];

      // Debug logging to help diagnose cookie issues
      logger.info({
        hasCookie: !!storedState,
        storedStatePrefix: storedState ? storedState.substring(0, 8) + '...' : 'none',
        receivedStatePrefix: state?.substring(0, 8) + '...',
        allCookies: Object.keys(request.cookies || {}),
        protocol: request.protocol,
        xForwardedProto: request.headers['x-forwarded-proto'],
        host: request.hostname
      }, '[GOOGLE-AUTH] Callback - verifying state cookie');

      if (!storedState || storedState !== state) {
        logger.warn({
          storedState: !!storedState,
          receivedState: state?.substring(0, 8),
          cookieHeader: request.headers['cookie'] ? 'present' : 'missing'
        }, '[GOOGLE-AUTH] State mismatch - cookie verification failed');
        return reply.redirect(`${FRONTEND_URL}/auth/error?error=${encodeURIComponent('Invalid state - possible CSRF attack')}`);
      }

      // Clear state cookie
      reply.clearCookie('google_oauth_state', { path: '/' });

      // Exchange code for tokens
      const tokens = await googleAuth.exchangeCodeForTokens(code);

      // Validate ID token and get user info
      const validation = await googleAuth.validateIdToken(tokens.idToken);
      if (!validation.isValid || !validation.user) {
        return reply.redirect(`${FRONTEND_URL}/auth/error?error=${encodeURIComponent(validation.error || 'Token validation failed')}`);
      }

      const googleUser = validation.user;

      // ============================================
      // ACCESS CONTROL CHECK - CRITICAL
      // Uses async version to check both database and env vars
      // ============================================
      const accessCheck = await isUserAllowedAsync(googleUser.email);
      if (!accessCheck.allowed) {
        return handleUnauthorizedAccess(request, reply, googleUser, logger);
      }

      // Determine admin status: database takes priority, then Google auth, then env
      const isAdmin = accessCheck.isAdmin || googleUser.isAdmin || false;

      // User is allowed - proceed with authentication
      logger.info({
        email: googleUser.email,
        name: googleUser.name,
        isAdmin,
        source: accessCheck.isAdmin ? 'database' : (googleUser.isAdmin ? 'google' : 'env')
      }, '[GOOGLE-AUTH] Authorized user login');

      // Upsert user in database
      const user = await prisma.user.upsert({
        where: { email: googleUser.email },
        update: {
          name: googleUser.name || googleUser.email,
          last_login: new Date(),
          is_active: true,
          is_admin: isAdmin, // Update admin status from access control
          // Store Google-specific info
          oauth_provider: 'google',
          oauth_id: googleUser.userId,
          avatar_url: googleUser.picture
        },
        create: {
          email: googleUser.email,
          name: googleUser.name || googleUser.email,
          is_admin: isAdmin,
          is_active: true,
          oauth_provider: 'google',
          oauth_id: googleUser.userId,
          avatar_url: googleUser.picture,
          groups: googleUser.hostedDomain ? [googleUser.hostedDomain] : []
        }
      });

      // Generate local JWT for API authentication
      const localToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin,
          groups: user.groups || [],
          provider: 'google',
          hostedDomain: googleUser.hostedDomain
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Generate refresh token
      const refreshToken = jwt.sign(
        { userId: user.id, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      logger.info({
        userId: user.id,
        email: user.email,
        isAdmin: user.is_admin,
        hostedDomain: googleUser.hostedDomain
      }, '[GOOGLE-AUTH] User authenticated successfully');

      // Set JWT as cookie for browser navigation
      // This allows requests to protected routes to be authenticated
      // without requiring the frontend to pass the Authorization header
      const isSecure = request.protocol === 'https' || process.env.NODE_ENV === 'production';
      reply.setCookie('openagentic_token', localToken, {
        httpOnly: false, // Allow JS access so frontend can read it
        secure: isSecure,
        sameSite: isSecure ? 'none' : 'lax',
        maxAge: 86400, // 24 hours (matches JWT expiry)
        path: '/'
      });

      // Also set refresh token as httpOnly cookie for security
      reply.setCookie('openagentic_refresh', refreshToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: isSecure ? 'none' : 'lax',
        maxAge: 604800, // 7 days (matches refresh token expiry)
        path: '/'
      });

      // Redirect to frontend with tokens
      // Frontend will store these and complete the auth flow
      // IMPORTANT: Must include success=true for AuthCallback to process the token
      const callbackUrl = new URL(`${FRONTEND_URL}/auth/callback`);
      callbackUrl.searchParams.set('success', 'true');
      callbackUrl.searchParams.set('token', localToken);
      callbackUrl.searchParams.set('refresh_token', refreshToken);
      callbackUrl.searchParams.set('provider', 'google');

      return reply.redirect(callbackUrl.toString());
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, '[GOOGLE-AUTH] Callback error');
      return reply.redirect(`${FRONTEND_URL}/auth/error?error=${encodeURIComponent(error.message)}`);
    }
  });

  /**
   * Exchange/validate a Google ID token for a local JWT
   * POST /api/auth/google/token
   *
   * Used by mobile apps or SPAs that handle OAuth client-side
   */
  fastify.post('/token', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { idToken, accessToken } = request.body as {
        idToken: string;
        accessToken?: string;
      };

      if (!idToken) {
        return reply.code(400).send({ error: 'ID token is required' });
      }

      // Validate ID token
      const validation = await googleAuth.validateIdToken(idToken);
      if (!validation.isValid || !validation.user) {
        return reply.code(401).send({ error: validation.error || 'Invalid token' });
      }

      const googleUser = validation.user;

      // ACCESS CONTROL CHECK (uses database + env vars)
      const accessCheck = await isUserAllowedAsync(googleUser.email);
      if (!accessCheck.allowed) {
        // For API requests, return JSON error instead of redirect
        const emailService = getEmailService(logger);
        const accessRequestData: AccessRequestData = {
          email: googleUser.email,
          name: googleUser.name,
          picture: googleUser.picture,
          googleUserId: googleUser.userId,
          hostedDomain: googleUser.hostedDomain,
          ipAddress: getClientIP(request),
          userAgent: request.headers['user-agent'] || 'unknown',
          timestamp: new Date(),
          headers: Object.fromEntries(
            Object.entries(request.headers)
              .filter(([_, v]) => typeof v === 'string')
              .map(([k, v]) => [k, v as string])
          )
        };

        emailService.sendAccessRequestNotification(accessRequestData).catch(() => {});

        return reply.code(403).send({
          error: 'access_denied',
          message: 'Thank you for your interest! We will get back to you with your evaluation request soon. - OpenAgentic Team',
          email: googleUser.email
        });
      }

      // Determine admin status from database/env
      const isAdmin = accessCheck.isAdmin || googleUser.isAdmin || false;

      // Upsert user
      const user = await prisma.user.upsert({
        where: { email: googleUser.email },
        update: {
          name: googleUser.name || googleUser.email,
          last_login: new Date(),
          is_active: true,
          is_admin: isAdmin,
          oauth_provider: 'google',
          oauth_id: googleUser.userId,
          avatar_url: googleUser.picture
        },
        create: {
          email: googleUser.email,
          name: googleUser.name || googleUser.email,
          is_admin: isAdmin,
          is_active: true,
          oauth_provider: 'google',
          oauth_id: googleUser.userId,
          avatar_url: googleUser.picture,
          groups: googleUser.hostedDomain ? [googleUser.hostedDomain] : []
        }
      });

      // Generate local JWT
      const localToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin,
          groups: user.groups || [],
          provider: 'google'
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      const refreshToken = jwt.sign(
        { userId: user.id, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      return reply.send({
        token: localToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin,
          picture: googleUser.picture
        },
        expiresIn: 86400
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[GOOGLE-AUTH] Token exchange error');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * Get current authenticated user info
   * GET /api/auth/google/me
   */
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'No token provided' });
      }

      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          name: true,
          is_admin: true,
          avatar_url: true,
          groups: true,
          oauth_provider: true
        }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.is_admin,
        picture: user.avatar_url,
        groups: user.groups,
        provider: user.oauth_provider
      });
    } catch (error: any) {
      return reply.code(401).send({ error: 'Invalid token' });
    }
  });

  /**
   * Logout - invalidate session
   * POST /api/auth/google/logout
   */
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    // Clear any cookies
    reply.clearCookie('google_oauth_state', { path: '/' });

    // In a more complete implementation, you'd:
    // 1. Add the token to a blacklist in Redis
    // 2. Clear any server-side session data

    return reply.send({ success: true, message: 'Logged out successfully' });
  });

  /**
   * Get auth configuration for frontend
   * GET /api/auth/google/config
   */
  fastify.get('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = googleAuth.getConfig();
    const authProvider = process.env.AUTH_PROVIDER || 'azure-ad';

    return reply.send({
      enabled: ['google', 'hybrid', 'both', 'all'].includes(authProvider),
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      allowedDomains: config.allowedDomains
    });
  });
};

export default googleAuthRoutes;
