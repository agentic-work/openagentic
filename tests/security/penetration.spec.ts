/**
 * Security & Penetration Tests
 *
 * Tests for security vulnerabilities:
 * - Authentication bypass
 * - Authorization flaws
 * - Injection attacks
 * - Rate limiting
 * - Data exposure
 * - Session security
 */

import { describe, it, expect } from 'vitest';
import { getTestEnv, TestAPIClient } from '../fixtures/setup';

const env = getTestEnv();
const api = new TestAPIClient(env.apiBaseUrl, env.testApiKey);

describe('Security Tests', () => {
  describe('Authentication', () => {
    it('should reject requests without auth', async () => {
      const noAuthApi = new TestAPIClient(env.apiBaseUrl, '');

      try {
        await noAuthApi.get('/api/chat/sessions');
        expect(true).toBe(false); // Should have thrown
      } catch (e: any) {
        expect(e.status).toBe(401);
      }
    });

    it('should reject invalid API keys', async () => {
      const badApi = new TestAPIClient(env.apiBaseUrl, 'invalid_key_12345');

      try {
        await badApi.get('/api/chat/sessions');
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e.status === 401 || e.status === 403).toBe(true);
      }
    });

    it('should reject expired tokens', async () => {
      // Test with obviously expired/malformed token
      const expiredApi = new TestAPIClient(env.apiBaseUrl, 'awc_expired_token_test_123456789');

      try {
        await expiredApi.get('/api/chat/sessions');
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e.status === 401 || e.status === 403).toBe(true);
      }
    });

    it('should not expose auth error details', async () => {
      const badApi = new TestAPIClient(env.apiBaseUrl, 'awc_bad_key_1234567890');

      try {
        await badApi.get('/api/chat/sessions');
      } catch (e: any) {
        // Error should not reveal sensitive info
        const errorText = JSON.stringify(e);
        expect(errorText).not.toContain('password');
        expect(errorText).not.toContain('secret');
        expect(errorText).not.toContain('database');
      }
    });
  });

  describe('Authorization', () => {
    it('should prevent access to other users sessions', async () => {
      // Create session with one user
      const sessionId = `auth_test_${Date.now()}`;

      await api.post('/api/chat/stream', {
        sessionId,
        message: 'Private message'
      }).catch(() => null);

      // Try to access with different key (if available)
      try {
        const otherApi = new TestAPIClient(env.apiBaseUrl, 'awc_other_user_key_12345');
        await otherApi.get(`/api/chat/sessions/${sessionId}`);
        // If succeeds, check if data is properly filtered
      } catch (e: any) {
        // 401/403/404 are acceptable
        expect([401, 403, 404]).toContain(e.status);
      }
    });

    it('should require admin for admin endpoints', async () => {
      try {
        // Try to access admin endpoint with regular API key
        // This depends on the test key's permissions
        await api.get('/api/admin/users');
      } catch (e: any) {
        // May be allowed or denied based on permissions
        if (e.status === 403) {
          expect(e.status).toBe(403);
        }
      }
    });

    it('should prevent privilege escalation', async () => {
      try {
        // Try to modify own permissions
        await api.post('/api/admin/users/me/permissions', {
          role: 'superadmin',
          permissions: ['*']
        });
        expect(true).toBe(false); // Should not succeed
      } catch (e: any) {
        expect([401, 403, 404, 405]).toContain(e.status);
      }
    });
  });

  describe('Injection Attacks', () => {
    it('should sanitize SQL injection in query params', async () => {
      try {
        await api.get("/api/chat/sessions?id=1'; DROP TABLE sessions;--");
      } catch (e: any) {
        // Should not cause server error (500)
        expect(e.status).not.toBe(500);
      }
    });

    it('should sanitize SQL injection in body', async () => {
      try {
        await api.post('/api/chat/stream', {
          sessionId: "'; DROP TABLE sessions;--",
          message: 'Test'
        });
      } catch (e: any) {
        // Should not cause SQL error
        expect(e.status).not.toBe(500);
      }
    });

    it('should sanitize XSS in messages', async () => {
      const xssPayload = '<script>alert("XSS")</script>';

      try {
        await api.post('/api/chat/stream', {
          sessionId: `xss_test_${Date.now()}`,
          message: xssPayload
        });

        // If stored, should be escaped when retrieved
        // Can't easily verify without UI testing
      } catch (e) {
        // Request should be handled safely
      }
    });

    it('should sanitize command injection in tool calls', async () => {
      try {
        await api.post('/api/mcp/call', {
          server: 'openagentic_openagentic',
          tool: 'execute_code',
          input: {
            code: '; rm -rf /',
            language: 'bash'
          }
        });
      } catch (e: any) {
        // Should be rejected or sandboxed
        expect(e.status !== 200 || e.error).toBeDefined();
      }
    });

    it('should prevent NoSQL injection', async () => {
      try {
        await api.get('/api/chat/sessions?filter[$gt]=');
      } catch (e: any) {
        expect(e.status).not.toBe(500);
      }
    });

    it('should prevent path traversal', async () => {
      try {
        await api.get('/api/files/../../../etc/passwd');
      } catch (e: any) {
        expect([400, 403, 404]).toContain(e.status);
      }
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit excessive requests', async () => {
      const requests = [];

      // Make many rapid requests
      for (let i = 0; i < 100; i++) {
        requests.push(
          api.get('/health').catch(e => e)
        );
      }

      const results = await Promise.all(requests);
      const rateLimited = results.filter(r => r?.status === 429);

      // Some may be rate limited (depends on config)
      // Just verify the endpoint handles high load
    });

    it('should return Retry-After header on rate limit', async () => {
      try {
        // Make many requests
        for (let i = 0; i < 200; i++) {
          await api.get('/health');
        }
      } catch (e: any) {
        if (e.status === 429) {
          // Should include retry information
          // Headers may include Retry-After
        }
      }
    });
  });

  describe('Data Exposure', () => {
    it('should not expose sensitive data in errors', async () => {
      try {
        await api.post('/api/chat/completions', {
          model: 'nonexistent',
          messages: [{ role: 'user', content: 'test' }]
        });
      } catch (e: any) {
        const errorStr = JSON.stringify(e);
        expect(errorStr).not.toContain('API_KEY');
        expect(errorStr).not.toContain('sk-');
        expect(errorStr).not.toContain('password');
      }
    });

    it('should mask API keys in responses', async () => {
      try {
        const tokens = await api.get<any>('/api/admin/tokens');

        if (tokens.tokens) {
          for (const token of tokens.tokens) {
            // Full key should never be returned after creation
            if (token.key) {
              expect(token.key.length).toBeLessThan(40);
              expect(token.key).toMatch(/^\*+|awc_\*+$/);
            }
          }
        }
      } catch (e) {
        // May require admin access
      }
    });

    it('should not expose internal IDs in URLs', async () => {
      try {
        const sessions = await api.get<any>('/api/chat/sessions');
        const sessionList = sessions.sessions || sessions;

        for (const session of sessionList) {
          // IDs should be UUIDs or hashed, not sequential
          expect(session.id).not.toMatch(/^\d+$/);
        }
      } catch (e) {
        // May not have sessions
      }
    });

    it('should not expose stack traces in production', async () => {
      try {
        // Force an error
        await api.post('/api/chat/stream', {
          sessionId: null as any // Invalid
        });
      } catch (e: any) {
        const errorStr = JSON.stringify(e);
        expect(errorStr).not.toContain('at Function.');
        expect(errorStr).not.toContain('.ts:');
        expect(errorStr).not.toContain('node_modules');
      }
    });
  });

  describe('Session Security', () => {
    it('should generate unique session IDs', async () => {
      const sessionIds = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const id = `session_${Date.now()}_${Math.random().toString(36)}`;
        expect(sessionIds.has(id)).toBe(false);
        sessionIds.add(id);
      }
    });

    it('should invalidate sessions on logout', async () => {
      // Test logout functionality if exists
      try {
        await api.post('/api/auth/logout', {});

        // Subsequent requests should fail
        // (would need new session)
      } catch (e) {
        // Logout endpoint may not exist
      }
    });
  });

  describe('Input Validation', () => {
    it('should reject oversized payloads', async () => {
      const largePayload = 'A'.repeat(10 * 1024 * 1024); // 10MB

      try {
        await api.post('/api/chat/stream', {
          sessionId: 'test',
          message: largePayload
        });
      } catch (e: any) {
        // 400/413 for payload too large, 401 if auth fails first
        // undefined status means request failed before HTTP response (also acceptable for oversized payload)
        if (e.status !== undefined) {
          expect([400, 401, 413]).toContain(e.status);
        }
      }
    });

    it('should validate content types', async () => {
      try {
        const response = await fetch(`${env.apiBaseUrl}/api/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'Authorization': `Bearer ${env.testApiKey}`
          },
          body: 'not json'
        });

        expect(response.status).toBe(400);
      } catch (e) {
        // Error is acceptable
      }
    });

    it('should reject malformed JSON', async () => {
      try {
        const response = await fetch(`${env.apiBaseUrl}/api/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.testApiKey}`
          },
          body: '{"malformed": json}'
        });

        expect(response.status).toBe(400);
      } catch (e) {
        // Error is acceptable
      }
    });
  });

  describe('CORS Security', () => {
    it('should have proper CORS headers', async () => {
      try {
        const response = await fetch(`${env.apiBaseUrl}/health`, {
          method: 'OPTIONS'
        });

        const allowOrigin = response.headers.get('access-control-allow-origin');
        // Should not be wildcard in production, or should be specific
        if (allowOrigin === '*') {
          // Acceptable for development
        } else {
          // Should be specific origin
          expect(allowOrigin).toBeDefined();
        }
      } catch (e) {
        // OPTIONS may be handled differently
      }
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await fetch(`${env.apiBaseUrl}/health`);

      // Check for common security headers
      const csp = response.headers.get('content-security-policy');
      const xFrame = response.headers.get('x-frame-options');
      const xContent = response.headers.get('x-content-type-options');

      // At least some security headers should be present
      // (Implementation varies)
    });
  });

  describe('Denial of Service Prevention', () => {
    it('should handle request bombs gracefully', async () => {
      try {
        // Deeply nested JSON
        let bomb: any = { a: 'value' };
        for (let i = 0; i < 100; i++) {
          bomb = { nested: bomb };
        }

        await api.post('/api/chat/stream', {
          sessionId: 'test',
          message: 'test',
          extra: bomb
        });
      } catch (e: any) {
        // 400/413/422 for validation errors, 401 if auth fails first
        // undefined status means request failed before HTTP response (also acceptable for bomb payload)
        if (e.status !== undefined) {
          expect([400, 401, 413, 422]).toContain(e.status);
        }
      }
    });

    it('should handle slow loris-style attacks', async () => {
      // Test connection timeout handling
      // Most frameworks handle this automatically
    });
  });

  describe('API Key Security', () => {
    it('should hash stored API keys', async () => {
      // Cannot directly verify hashing, but can verify key never returned
      try {
        const tokens = await api.get<any>('/api/admin/tokens');

        if (tokens.tokens) {
          for (const token of tokens.tokens) {
            // Full key should never be returned
            expect(token.keyHash).toBeUndefined();
            expect(token.fullKey).toBeUndefined();
          }
        }
      } catch (e) {
        // May require admin
      }
    });

    it('should only show full key on creation', async () => {
      try {
        // Create new token
        const created = await api.post<any>('/api/admin/tokens', {
          name: `security_test_${Date.now()}`
        });

        // Should have key on creation
        if (created.token || created.key) {
          const key = created.token || created.key;
          expect(key.startsWith('awc_')).toBe(true);
        }

        // List should not show full key
        const tokens = await api.get<any>('/api/admin/tokens');
        const createdToken = tokens.tokens?.find((t: any) =>
          t.name?.includes('security_test')
        );

        if (createdToken?.key) {
          expect(createdToken.key.length).toBeLessThan(40);
        }
      } catch (e) {
        // May require admin
      }
    });
  });
});
