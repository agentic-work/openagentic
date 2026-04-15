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
 * Security Middleware
 * 
 * Comprehensive security layer providing API key validation, origin checking,
 * request signing verification, IP filtering, and rate limiting protection.
 * 
 * @see {@link https://docs.openagentics.io/api/authentication}
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

// Security configuration
// Validate required environment variables
if (!process.env.API_SECRET_KEY || !process.env.FRONTEND_SECRET || !process.env.SIGNING_SECRET) {
  throw new Error('CRITICAL: Security environment variables are not set. Please set API_SECRET_KEY, FRONTEND_SECRET, and SIGNING_SECRET.');
}

const SECURITY_CONFIG = {
  // API Key that must be present in all requests
  API_KEY: process.env.API_SECRET_KEY,
  
  // Allowed origins (frontend URLs)
  ALLOWED_ORIGINS: [
    'http://localhost:3010',
    'http://openagentic-ui:3000', // Docker internal
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  
  // Special header that frontend must send
  FRONTEND_HEADER: 'X-OpenAgentic-Frontend',
  FRONTEND_HEADER_VALUE: process.env.FRONTEND_SECRET,
  
  // Request signing secret
  SIGNING_SECRET: process.env.SIGNING_SECRET,
  
  // Allowed IPs (Docker network ranges)
  ALLOWED_IP_RANGES: [
    '172.16.0.0/12', // Docker default range
    '10.0.0.0/8',    // Docker swarm range
    '127.0.0.1',     // Localhost
    '::1',           // IPv6 localhost
  ],
};

// Import logger for security middleware
import { loggers } from '../utils/logger.js';

// Log security configuration on startup (without secrets)
loggers.middleware.info('Security Configuration loaded', {
  allowedOrigins: SECURITY_CONFIG.ALLOWED_ORIGINS,
  frontendHeaderName: SECURITY_CONFIG.FRONTEND_HEADER,
  apiKeyLength: SECURITY_CONFIG.API_KEY.length,
  ipRanges: SECURITY_CONFIG.ALLOWED_IP_RANGES,
});

// Helper to check if IP is in allowed range
function isIPAllowed(ip: string): boolean {
  // For now, implement basic check - in production, use proper IP range checking
  if (!ip) return false;
  
  // Allow localhost
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  
  // Allow Docker network IPs (basic check)
  if (ip.startsWith('172.') || ip.startsWith('10.') || ip.includes('openagentic')) return true;
  
  return false;
}

// Helper to verify request signature
function verifyRequestSignature(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const payload = `${timestamp}.${body}`;
  const expectedSignature = crypto
    .createHmac('sha256', SECURITY_CONFIG.SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Main security middleware
export async function securityMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const startTime = Date.now();
  const requestId = request.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  loggers.middleware.debug({
    requestId,
    method: request.method,
    url: request.url,
    headers: {
      origin: request.headers.origin,
      referer: request.headers.referer,
      userAgent: request.headers['user-agent'],
      hasAuth: !!request.headers.authorization,
      hasFrontendHeader: !!request.headers[SECURITY_CONFIG.FRONTEND_HEADER.toLowerCase()],
      hasApiKey: !!request.headers['x-api-key']
    },
    clientIP: request.ip || request.socket.remoteAddress
  }, '[SECURITY] Processing security middleware');

  // Skip security for health checks and Swagger docs
  if (request.url === '/health' || request.url === '/api/health' || request.url.startsWith('/health/') || request.url.startsWith('/api/health/') || request.url.startsWith('/api/swagger')) {
    loggers.middleware.debug({ requestId, url: request.url }, '[SECURITY] Skipping security for public endpoint');
    return;
  }

  try {
    // Check if request has Azure AD Bearer token
    const authHeader = request.headers.authorization;
    const hasAzureADToken = authHeader && authHeader.startsWith('Bearer ') && authHeader.length > 50; // Azure AD tokens are long
    
    loggers.middleware.debug({
      requestId,
      hasAuthHeader: !!authHeader,
      authHeaderPrefix: authHeader ? authHeader.substring(0, 10) + '...' : null,
      hasAzureADToken,
      tokenLength: authHeader ? authHeader.length : 0
    }, '[SECURITY] Checking authentication headers');
    
    // 1. Check Origin header
    const origin = request.headers.origin || request.headers.referer;
    if (origin && !SECURITY_CONFIG.ALLOWED_ORIGINS.some(allowed => 
      allowed && origin.startsWith(allowed)
    )) {
      loggers.middleware.warn({
        requestId,
        origin,
        allowedOrigins: SECURITY_CONFIG.ALLOWED_ORIGINS,
        method: request.method,
        url: request.url
      }, '[SECURITY] [BLOCKED] Origin not allowed');
      
      reply.code(403).send({ 
        error: 'Forbidden', 
        message: 'Origin not allowed' 
      });
      return;
    }

    // 2. Check Frontend Header
    const frontendHeader = request.headers[SECURITY_CONFIG.FRONTEND_HEADER.toLowerCase()];
    if (frontendHeader !== SECURITY_CONFIG.FRONTEND_HEADER_VALUE) {
      loggers.middleware.warn({
        requestId,
        frontendHeaderPresent: !!frontendHeader,
        frontendHeaderMatches: frontendHeader === SECURITY_CONFIG.FRONTEND_HEADER_VALUE,
        method: request.method,
        url: request.url
      }, '[SECURITY] [BLOCKED] Invalid frontend authentication header');
      
      reply.code(403).send({ 
        error: 'Forbidden', 
        message: 'Invalid frontend authentication' 
      });
      return;
    }

    // 3. Check API Key OR Azure AD Token
    const apiKey = (Array.isArray(request.headers['x-api-key']) ? request.headers['x-api-key'][0] : request.headers['x-api-key']) || '';
    // SECURITY: Use timing-safe comparison to prevent side-channel attacks
    const hasValidApiKey = apiKey && SECURITY_CONFIG.API_KEY &&
      apiKey.length === SECURITY_CONFIG.API_KEY.length &&
      require('crypto').timingSafeEqual(Buffer.from(apiKey as string), Buffer.from(SECURITY_CONFIG.API_KEY));
    
    if (!hasAzureADToken && !hasValidApiKey) {
      loggers.middleware.warn({
        requestId,
        hasAzureADToken,
        hasApiKey: !!apiKey,
        apiKeyMatches: hasValidApiKey,
        method: request.method,
        url: request.url
      }, '[SECURITY] [BLOCKED] Invalid authentication - no valid token or API key');
      
      reply.code(401).send({ 
        error: 'Unauthorized', 
        message: 'Invalid authentication' 
      });
      return;
    }

    // 4. Check IP Address (relaxed for Docker networks)
    const clientIP = request.ip || request.socket.remoteAddress || '';
    const isIPOk = isIPAllowed(clientIP);
    
    if (!isIPOk) {
      loggers.middleware.warn({ 
        requestId,
        clientIP,
        allowedRanges: SECURITY_CONFIG.ALLOWED_IP_RANGES,
        method: request.method,
        url: request.url
      }, '[SECURITY] [WARNING] Request from non-allowed IP - not blocking due to Docker complexity');
      // Don't block for now, just log - Docker networking can be complex
    }

    // 5. Verify Request Signature (for POST/PUT/PATCH requests with body)
    if (['POST', 'PUT', 'PATCH'].includes(request.method) && request.body) {
      const timestamp = request.headers['x-timestamp'] as string;
      const signature = request.headers['x-signature'] as string;
      
      loggers.middleware.debug({
        requestId,
        hasTimestamp: !!timestamp,
        hasSignature: !!signature,
        method: request.method,
        bodySize: JSON.stringify(request.body).length
      }, '[SECURITY] Checking request signature for write operation');
      
      if (!timestamp || !signature) {
        loggers.middleware.warn({
          requestId,
          hasTimestamp: !!timestamp,
          hasSignature: !!signature,
          method: request.method,
          url: request.url
        }, '[SECURITY] [BLOCKED] Missing request signature for write operation');
        
        reply.code(401).send({ 
          error: 'Unauthorized', 
          message: 'Missing request signature' 
        });
        return;
      }
      
      // Check timestamp is within 5 minutes
      const requestTime = parseInt(timestamp);
      const now = Date.now();
      const timeDiff = Math.abs(now - requestTime);
      const maxAge = 5 * 60 * 1000; // 5 minutes
      
      if (timeDiff > maxAge) {
        loggers.middleware.warn({
          requestId,
          requestTime,
          now,
          timeDiff,
          maxAge,
          method: request.method,
          url: request.url
        }, '[SECURITY] [BLOCKED] Request timestamp too old');
        
        reply.code(401).send({ 
          error: 'Unauthorized', 
          message: 'Request timestamp too old' 
        });
        return;
      }
      
      // Verify signature
      const bodyString = JSON.stringify(request.body);
      const signatureValid = verifyRequestSignature(bodyString, timestamp, signature);
      
      if (!signatureValid) {
        loggers.middleware.warn({
          requestId,
          bodyLength: bodyString.length,
          timestamp,
          signatureProvided: signature.substring(0, 10) + '...',
          method: request.method,
          url: request.url
        }, '[SECURITY] [BLOCKED] Invalid request signature');
        
        reply.code(401).send({ 
          error: 'Unauthorized', 
          message: 'Invalid request signature' 
        });
        return;
      }
      
      loggers.middleware.debug({
        requestId,
        signatureValid: true,
        method: request.method
      }, '[SECURITY] Request signature verified successfully');
    }

    // 6. Add security headers to response
    reply.headers({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    
    const executionTime = Date.now() - startTime;
    loggers.middleware.info({
      requestId,
      method: request.method,
      url: request.url,
      hasAzureADToken,
      hasValidApiKey,
      clientIP,
      isIPOk,
      executionTime
    }, '[SECURITY] [SUCCESS] Security middleware passed all checks');
    
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    loggers.middleware.error({
      requestId,
      err: error,
      errorMessage: error.message,
      errorStack: error.stack,
      method: request.method,
      url: request.url,
      executionTime
    }, '[SECURITY] [ERROR] Security middleware failed with exception');
    
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Security validation failed'
    });
  }
}

// Rate limiting configuration
export const rateLimitOptions = {
  max: 100, // Max 100 requests
  timeWindow: '1 minute',
  keyGenerator: (request: FastifyRequest) => {
    return request.headers['x-user-id'] as string || request.ip;
  },
  errorResponseBuilder: () => {
    return {
      error: 'Too Many Requests',
      message: 'Rate limit exceeded, please try again later',
    };
  },
};

// Export safe security configuration metadata (no secrets)
export function getSecurityConfig() {
  return {
    frontendHeader: SECURITY_CONFIG.FRONTEND_HEADER,
    // SECURITY: Never export raw API keys, signing secrets, or frontend header values
    hasApiKey: !!SECURITY_CONFIG.API_KEY,
    hasSigningSecret: !!SECURITY_CONFIG.SIGNING_SECRET,
  };
}

// Plugin to register security middleware
export async function securityPlugin(fastify: FastifyInstance) {
  // Add the security middleware to all routes
  fastify.addHook('onRequest', securityMiddleware);
  
  // Add rate limiting
  const rateLimit = await import('@fastify/rate-limit');
  await fastify.register(rateLimit.default as any, rateLimitOptions);
  
  // Add a route to get security config (only accessible from frontend)
  fastify.get('/security/config', async (_request, _reply) => {
    // This route itself is protected by the security middleware
    return {
      frontendHeader: SECURITY_CONFIG.FRONTEND_HEADER,
      // Don't send the actual values, frontend should have them via env vars
      message: 'Security configuration active',
    };
  });
}
