/**
 * Authentication Middleware Unit Tests
 *
 * Tests for authentication and authorization:
 * - API key validation
 * - Bearer token validation
 * - Azure AD integration
 * - Permission checks
 * - Rate limiting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Authentication Middleware', () => {
  describe('API Key Validation', () => {
    // New OSS API-key format:
    //   - User keys:   "oa_"     + base64url(randomBytes(32))  (43-char body)
    //   - System keys: "oa_sys_" + base64url(randomBytes(32))  (inter-service tokens)
    // base64url chars are [A-Za-z0-9_-], no padding. Hashing/storage (bcrypt of the
    // full key) is unchanged — only the human-visible prefix + body encoding changed.
    const validateApiKey = (key: string | undefined): { valid: boolean; userId?: string; error?: string } => {
      if (!key) {
        return { valid: false, error: 'API key required' };
      }

      // System tokens use the "oa_sys_" prefix; user keys use the bare "oa_" prefix.
      // Check the more specific prefix first so it isn't shadowed by "oa_".
      const isSystem = key.startsWith('oa_sys_');
      const isUser = !isSystem && key.startsWith('oa_');
      if (!isSystem && !isUser) {
        return { valid: false, error: 'Invalid API key format' };
      }

      // base64url body of 32 random bytes is 43 chars (no padding). Reject anything
      // whose body is too short to be a real key.
      const body = isSystem ? key.slice('oa_sys_'.length) : key.slice('oa_'.length);
      if (body.length < 43) {
        return { valid: false, error: 'Invalid API key length' };
      }

      // Simulated key lookup (43-char base64url bodies = 32 random bytes)
      const validKeys: Record<string, string> = {
        'oa_gPugrhxI45eOQ-Tvw2XhThLqDIMLqLpbmi2vx-Pyq4s': 'user_123',
        'oa_iEbwhnY6HQqX1zKyYvGX898xv0jKK91JTqDO5TG0kIY': 'admin_456',
        'oa_sys_u8XmYeEGxtzY3G3RhkVML8ujxxD7TY5xpgyT6vB38HM': 'system'
      };

      const userId = validKeys[key];
      if (!userId) {
        return { valid: false, error: 'API key not found' };
      }

      return { valid: true, userId };
    };

    it('should reject missing API key', () => {
      const result = validateApiKey(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject invalid prefix', () => {
      const result = validateApiKey('sk_invalid_key_12345');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('format');
    });

    it('should reject legacy awc_ prefix', () => {
      const result = validateApiKey('awc_test_key_1234567890');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('format');
    });

    it('should reject short keys', () => {
      const result = validateApiKey('oa_short');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('length');
    });

    it('should validate correct API key', () => {
      const result = validateApiKey('oa_gPugrhxI45eOQ-Tvw2XhThLqDIMLqLpbmi2vx-Pyq4s');
      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user_123');
    });

    it('should validate system inter-service token', () => {
      const result = validateApiKey('oa_sys_u8XmYeEGxtzY3G3RhkVML8ujxxD7TY5xpgyT6vB38HM');
      expect(result.valid).toBe(true);
      expect(result.userId).toBe('system');
    });

    it('should reject unknown API key', () => {
      const result = validateApiKey('oa_sjpqhDnA3eVRWJPnyQweMjO4YW5jRHDyDcSSi882Cbw');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Bearer Token Validation', () => {
    const extractBearerToken = (authHeader: string | undefined): string | null => {
      if (!authHeader) return null;
      if (!authHeader.startsWith('Bearer ')) return null;
      return authHeader.slice(7);
    };

    const validateJWT = (token: string): { valid: boolean; payload?: any; error?: string } => {
      try {
        // Simulated JWT validation
        const parts = token.split('.');
        if (parts.length !== 3) {
          return { valid: false, error: 'Invalid JWT format' };
        }

        // Decode payload (base64)
        const payload = JSON.parse(atob(parts[1]));

        // Check expiration
        if (payload.exp && payload.exp < Date.now() / 1000) {
          return { valid: false, error: 'Token expired' };
        }

        return { valid: true, payload };
      } catch (e) {
        return { valid: false, error: 'Invalid token' };
      }
    };

    it('should extract bearer token', () => {
      const token = extractBearerToken('Bearer abc123xyz');
      expect(token).toBe('abc123xyz');
    });

    it('should return null for missing header', () => {
      const token = extractBearerToken(undefined);
      expect(token).toBeNull();
    });

    it('should return null for non-bearer auth', () => {
      const token = extractBearerToken('Basic abc123');
      expect(token).toBeNull();
    });

    it('should reject invalid JWT format', () => {
      const result = validateJWT('not.a.valid.jwt.token');
      expect(result.valid).toBe(false);
    });
  });

  describe('Azure AD Integration', () => {
    interface AzureADConfig {
      tenantId: string;
      clientId: string;
      allowedGroups: string[];
    }

    const validateAzureToken = (
      token: string,
      config: AzureADConfig
    ): { valid: boolean; user?: any; error?: string } => {
      // Simulated Azure AD token validation
      try {
        const parts = token.split('.');
        if (parts.length !== 3) {
          return { valid: false, error: 'Invalid token format' };
        }

        const payload = JSON.parse(atob(parts[1]));

        // Check tenant
        if (payload.tid !== config.tenantId) {
          return { valid: false, error: 'Invalid tenant' };
        }

        // Check audience
        if (payload.aud !== config.clientId) {
          return { valid: false, error: 'Invalid audience' };
        }

        // Check groups
        const userGroups = payload.groups || [];
        const hasAllowedGroup = config.allowedGroups.some(g => userGroups.includes(g));
        if (!hasAllowedGroup && config.allowedGroups.length > 0) {
          return { valid: false, error: 'User not in allowed group' };
        }

        return {
          valid: true,
          user: {
            id: payload.oid,
            email: payload.email,
            name: payload.name,
            groups: userGroups
          }
        };
      } catch (e) {
        return { valid: false, error: 'Token validation failed' };
      }
    };

    it('should validate Azure AD token', () => {
      // Create a mock token (base64 encoded)
      const payload = {
        tid: 'tenant-123',
        aud: 'client-456',
        oid: 'user-789',
        email: 'test@example.com',
        name: 'Test User',
        groups: ['group-1']
      };
      const mockToken = `header.${btoa(JSON.stringify(payload))}.signature`;

      const config: AzureADConfig = {
        tenantId: 'tenant-123',
        clientId: 'client-456',
        allowedGroups: ['group-1']
      };

      const result = validateAzureToken(mockToken, config);
      expect(result.valid).toBe(true);
      expect(result.user?.email).toBe('test@example.com');
    });

    it('should reject wrong tenant', () => {
      const payload = { tid: 'wrong-tenant', aud: 'client-456' };
      const mockToken = `header.${btoa(JSON.stringify(payload))}.signature`;

      const result = validateAzureToken(mockToken, {
        tenantId: 'tenant-123',
        clientId: 'client-456',
        allowedGroups: []
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('tenant');
    });
  });

  describe('Permission Checks', () => {
    interface User {
      id: string;
      role: 'user' | 'admin' | 'superadmin';
      permissions: string[];
    }

    const hasPermission = (user: User, permission: string): boolean => {
      // Superadmin has all permissions
      if (user.role === 'superadmin') return true;

      // Check explicit permissions
      if (user.permissions.includes(permission)) return true;

      // Admin role grants certain permissions
      if (user.role === 'admin') {
        const adminPermissions = [
          'users.read',
          'users.write',
          'settings.read',
          'settings.write',
          'metrics.read'
        ];
        if (adminPermissions.includes(permission)) return true;
      }

      return false;
    };

    it('should allow superadmin all permissions', () => {
      const user: User = { id: 'user_1', role: 'superadmin', permissions: [] };
      expect(hasPermission(user, 'any.permission')).toBe(true);
      expect(hasPermission(user, 'delete.everything')).toBe(true);
    });

    it('should allow admin default permissions', () => {
      const user: User = { id: 'user_2', role: 'admin', permissions: [] };
      expect(hasPermission(user, 'users.read')).toBe(true);
      expect(hasPermission(user, 'settings.write')).toBe(true);
    });

    it('should deny admin non-default permissions', () => {
      const user: User = { id: 'user_2', role: 'admin', permissions: [] };
      expect(hasPermission(user, 'superadmin.action')).toBe(false);
    });

    it('should allow explicit permissions', () => {
      const user: User = {
        id: 'user_3',
        role: 'user',
        permissions: ['custom.permission']
      };
      expect(hasPermission(user, 'custom.permission')).toBe(true);
    });

    it('should deny user without permission', () => {
      const user: User = { id: 'user_4', role: 'user', permissions: [] };
      expect(hasPermission(user, 'admin.action')).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    const rateLimitStore: Map<string, { count: number; resetAt: number }> = new Map();

    const checkRateLimit = (
      userId: string,
      limit: number,
      windowMs: number
    ): { allowed: boolean; remaining: number; resetAt: number } => {
      const now = Date.now();
      let record = rateLimitStore.get(userId);

      if (!record || now >= record.resetAt) {
        record = { count: 0, resetAt: now + windowMs };
        rateLimitStore.set(userId, record);
      }

      record.count += 1;

      return {
        allowed: record.count <= limit,
        remaining: Math.max(0, limit - record.count),
        resetAt: record.resetAt
      };
    };

    beforeEach(() => {
      rateLimitStore.clear();
    });

    it('should allow requests within limit', () => {
      for (let i = 0; i < 10; i++) {
        const result = checkRateLimit('user_1', 10, 60000);
        expect(result.allowed).toBe(true);
      }
    });

    it('should block requests over limit', () => {
      for (let i = 0; i < 15; i++) {
        const result = checkRateLimit('user_2', 10, 60000);
        if (i < 10) {
          expect(result.allowed).toBe(true);
        } else {
          expect(result.allowed).toBe(false);
        }
      }
    });

    it('should track remaining requests', () => {
      checkRateLimit('user_3', 10, 60000);
      checkRateLimit('user_3', 10, 60000);
      const result = checkRateLimit('user_3', 10, 60000);
      expect(result.remaining).toBe(7);
    });

    it('should reset after window expires', async () => {
      // Use short window for test
      checkRateLimit('user_4', 1, 10);
      const blocked = checkRateLimit('user_4', 1, 10);
      expect(blocked.allowed).toBe(false);

      // Wait for window to reset
      await new Promise(r => setTimeout(r, 15));

      const allowed = checkRateLimit('user_4', 1, 10);
      expect(allowed.allowed).toBe(true);
    });
  });

  describe('Request Context', () => {
    interface RequestContext {
      userId: string;
      email: string;
      role: string;
      permissions: string[];
      apiKeyId?: string;
      clientIp: string;
      userAgent: string;
    }

    const buildContext = (
      user: any,
      request: { ip?: string; headers?: Record<string, string> }
    ): RequestContext => {
      return {
        userId: user.id,
        email: user.email,
        role: user.role,
        permissions: user.permissions || [],
        apiKeyId: user.apiKeyId,
        clientIp: request.ip || 'unknown',
        userAgent: request.headers?.['user-agent'] || 'unknown'
      };
    };

    it('should build context from user and request', () => {
      const user = {
        id: 'user_123',
        email: 'test@example.com',
        role: 'user',
        permissions: ['read']
      };

      const request = {
        ip: '192.168.1.1',
        headers: { 'user-agent': 'Mozilla/5.0' }
      };

      const context = buildContext(user, request);

      expect(context.userId).toBe('user_123');
      expect(context.email).toBe('test@example.com');
      expect(context.clientIp).toBe('192.168.1.1');
    });

    it('should handle missing request data', () => {
      const user = { id: 'user_456', email: 'test@test.com', role: 'user' };
      const context = buildContext(user, {});

      expect(context.clientIp).toBe('unknown');
      expect(context.userAgent).toBe('unknown');
    });
  });

  describe('Audit Logging', () => {
    const auditLog: any[] = [];

    const logAuthEvent = (
      eventType: string,
      userId: string,
      success: boolean,
      details: Record<string, any>
    ) => {
      auditLog.push({
        eventType,
        userId,
        success,
        details,
        timestamp: new Date()
      });
    };

    beforeEach(() => {
      auditLog.length = 0;
    });

    it('should log successful authentication', () => {
      logAuthEvent('auth.login', 'user_123', true, { method: 'api_key' });

      expect(auditLog.length).toBe(1);
      expect(auditLog[0].eventType).toBe('auth.login');
      expect(auditLog[0].success).toBe(true);
    });

    it('should log failed authentication', () => {
      logAuthEvent('auth.login', 'user_456', false, {
        method: 'bearer_token',
        error: 'Token expired'
      });

      expect(auditLog.length).toBe(1);
      expect(auditLog[0].success).toBe(false);
      expect(auditLog[0].details.error).toBe('Token expired');
    });

    it('should include timestamp', () => {
      logAuthEvent('auth.login', 'user_789', true, {});
      expect(auditLog[0].timestamp).toBeInstanceOf(Date);
    });
  });
});
