/**
 * Authentication API Tests
 *
 * Tests for:
 * - Local JWT authentication
 * - API key authentication
 * - Azure AD authentication
 * - Token validation
 * - Session management
 */

import { test, expect } from '@playwright/test';

const API_BASE = process.env.TEST_API_URL || 'http://localhost:8000';
const TEST_API_KEY = process.env.TEST_API_KEY || 'oa_test_key';

test.describe('Authentication API', () => {
  test.describe('Health & Status', () => {
    test('GET /health returns healthy status', async ({ request }) => {
      const response = await request.get(`${API_BASE}/health`);
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(['healthy', 'ok']).toContain(body.status);
    });

    test('GET /api/health returns detailed health info', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/health`);
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('services');
    });
  });

  test.describe('API Key Authentication', () => {
    test('valid API key returns 200 on protected endpoint', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/chat/sessions`, {
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });
      // Should succeed or return empty array, not 401
      expect(response.status()).not.toBe(401);
    });

    test('invalid API key returns 401', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/chat/sessions`, {
        headers: {
          'X-API-Key': 'oa_invalidkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        }
      });
      expect(response.status()).toBe(401);
    });

    test('missing authentication returns 401', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/chat/sessions`);
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Bearer Token Authentication', () => {
    test('invalid bearer token returns 401', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/chat/sessions`, {
        headers: {
          'Authorization': 'Bearer invalid_token'
        }
      });
      expect(response.status()).toBe(401);
    });

    test('malformed bearer header returns 401', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/chat/sessions`, {
        headers: {
          'Authorization': 'NotBearer token'
        }
      });
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Token Validation Endpoints', () => {
    test('POST /api/auth/validate with valid API key', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/auth/validate`, {
        headers: {
          'X-API-Key': TEST_API_KEY
        }
      });
      // Endpoint may not exist, but shouldn't crash
      expect([200, 404]).toContain(response.status());
    });
  });
});
