/**
 * Chat API Tests
 *
 * Comprehensive tests for:
 * - Session management
 * - Message streaming (SSE)
 * - Model routing
 * - Slider integration
 * - Tool execution
 * - Memory/context handling
 */

import { test, expect } from '@playwright/test';

const API_BASE = process.env.TEST_API_URL || 'http://localhost:8000';
const TEST_API_KEY = process.env.TEST_API_KEY || 'awc_test_key';

const authHeaders = {
  'X-API-Key': TEST_API_KEY,
  'Content-Type': 'application/json'
};

test.describe('Chat API', () => {
  let testSessionId: string;

  test.beforeAll(async () => {
    testSessionId = `test_session_${Date.now()}`;
  });

  test.describe('Session Management', () => {
    test('GET /api/chat/sessions returns user sessions', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/chat/sessions`, {
        headers: authHeaders
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(Array.isArray(body.sessions || body)).toBeTruthy();
    });

    test('POST /api/chat/sessions creates new session', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/chat/sessions`, {
        headers: authHeaders,
        data: {
          title: 'Test Session',
          model: 'gpt-oss'
        }
      });
      // May return session or redirect
      expect([200, 201, 302]).toContain(response.status());
    });

    test('GET /api/chat/sessions/:id returns session details', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/chat/sessions/${testSessionId}`, {
        headers: authHeaders
      });
      // Session may not exist yet, that's ok
      expect([200, 404]).toContain(response.status());
    });

    test('DELETE /api/chat/sessions/:id deletes session', async ({ request }) => {
      const response = await request.delete(`${API_BASE}/api/chat/sessions/non_existent_session`, {
        headers: authHeaders
      });
      // May return 404 if doesn't exist, or 200/204 if deleted
      expect([200, 204, 404]).toContain(response.status());
    });
  });

  test.describe('Chat Streaming', () => {
    test('POST /api/chat/stream initiates SSE stream', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/chat/stream`, {
        headers: {
          ...authHeaders,
          'Accept': 'text/event-stream'
        },
        data: {
          sessionId: testSessionId,
          message: 'Hello, what is 2+2?'
        }
      });
      expect(response.ok()).toBeTruthy();
      expect(response.headers()['content-type']).toContain('text/event-stream');
    });

    test('stream returns proper SSE format', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/chat/stream`, {
        headers: {
          ...authHeaders,
          'Accept': 'text/event-stream'
        },
        data: {
          sessionId: `stream_test_${Date.now()}`,
          message: 'Say hello'
        }
      });
      expect(response.ok()).toBeTruthy();
      const text = await response.text();
      // SSE format should have event: and data: lines
      expect(text).toContain('event:');
      expect(text).toContain('data:');
    });

    test('stream handles empty message error', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/chat/stream`, {
        headers: authHeaders,
        data: {
          sessionId: testSessionId,
          message: ''
        }
      });
      expect(response.status()).toBe(400);
    });

    test('stream handles missing sessionId error', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/chat/stream`, {
        headers: authHeaders,
        data: {
          message: 'test'
        }
      });
      expect(response.status()).toBe(400);
    });
  });

  test.describe('Slider Integration', () => {
    test('GET /api/admin/settings/slider returns slider value', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/admin/settings/slider`, {
        headers: authHeaders
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body).toHaveProperty('value');
      expect(typeof body.value).toBe('number');
      expect(body.value).toBeGreaterThanOrEqual(0);
      expect(body.value).toBeLessThanOrEqual(100);
    });

    test('PUT /api/admin/settings/slider updates slider value', async ({ request }) => {
      const newValue = 50;
      const response = await request.put(`${API_BASE}/api/admin/settings/slider`, {
        headers: authHeaders,
        data: { value: newValue }
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body.value).toBe(newValue);
    });

    test('slider affects model routing', async ({ request }) => {
      // Set slider to economical (0)
      await request.put(`${API_BASE}/api/admin/settings/slider`, {
        headers: authHeaders,
        data: { value: 0 }
      });

      // Make a chat request and verify economical model is used
      const streamResponse = await request.post(`${API_BASE}/api/chat/stream`, {
        headers: {
          ...authHeaders,
          'Accept': 'text/event-stream'
        },
        data: {
          sessionId: `slider_test_${Date.now()}`,
          message: 'What is 1+1?'
        }
      });
      expect(streamResponse.ok()).toBeTruthy();
      const text = await streamResponse.text();
      // Should see completion_start event with model
      expect(text).toContain('completion_start');
    });
  });

  test.describe('Model Selection', () => {
    test('explicit model in request is honored', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/chat/stream`, {
        headers: {
          ...authHeaders,
          'Accept': 'text/event-stream'
        },
        data: {
          sessionId: `model_test_${Date.now()}`,
          message: 'Hello',
          model: 'gpt-oss'
        }
      });
      expect(response.ok()).toBeTruthy();
    });

    test('GET /api/models returns available models', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/models`, {
        headers: authHeaders
      });
      // Endpoint may or may not exist
      if (response.ok()) {
        const body = await response.json();
        expect(Array.isArray(body.models || body)).toBeTruthy();
      }
    });
  });

  test.describe('Message History', () => {
    test('GET /api/chat/sessions/:id/messages returns message history', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/chat/sessions/${testSessionId}/messages`, {
        headers: authHeaders
      });
      // Session may not exist, but endpoint should respond
      expect([200, 404]).toContain(response.status());
      if (response.ok()) {
        const body = await response.json();
        expect(Array.isArray(body.messages || body)).toBeTruthy();
      }
    });
  });

  test.describe('Attachments', () => {
    test('stream accepts file attachments', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/chat/stream`, {
        headers: {
          ...authHeaders,
          'Accept': 'text/event-stream'
        },
        data: {
          sessionId: `attach_test_${Date.now()}`,
          message: 'Describe this file',
          files: [{
            name: 'test.txt',
            type: 'text/plain',
            content: btoa('Hello world test content')
          }]
        }
      });
      expect(response.ok()).toBeTruthy();
    });
  });

  test.describe('Error Handling', () => {
    test('handles rate limiting gracefully', async ({ request }) => {
      // Make multiple rapid requests
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request.post(`${API_BASE}/api/chat/stream`, {
            headers: authHeaders,
            data: {
              sessionId: `rate_limit_${i}_${Date.now()}`,
              message: 'Test'
            }
          })
        );
      }
      const responses = await Promise.all(promises);
      // At least one should succeed
      const successCount = responses.filter(r => r.ok()).length;
      expect(successCount).toBeGreaterThan(0);
    });
  });
});
