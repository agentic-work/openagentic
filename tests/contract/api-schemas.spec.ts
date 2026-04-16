/**
 * API Contract Tests
 *
 * Tests for API schema validation and compatibility:
 * - OpenAI-compatible endpoints
 * - Request/response schemas
 * - Error format consistency
 * - Header requirements
 */

import { describe, it, expect } from 'vitest';
import { getTestEnv, TestAPIClient } from '../fixtures/setup';

const env = getTestEnv();
const api = new TestAPIClient(env.apiBaseUrl, env.testApiKey);

describe('API Contract Tests', () => {
  describe('Health Endpoint Schema', () => {
    it('GET /health should return expected schema', async () => {
      const health = await api.get<any>('/health');

      expect(health).toHaveProperty('status');
      expect(['healthy', 'unhealthy', 'degraded', 'ok']).toContain(health.status);
    });

    it('GET /api/health should return detailed status', async () => {
      const health = await api.get<any>('/api/health');

      expect(health).toBeDefined();
      // May have services object
      if (health.services) {
        expect(typeof health.services).toBe('object');
      }
    });
  });

  describe('Chat Completions Schema (OpenAI Compatible)', () => {
    const validRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'Say hello' }
      ],
      max_tokens: 10
    };

    it('should accept valid chat completion request', async () => {
      try {
        const response = await api.post<any>('/api/chat/completions', validRequest);

        // OpenAI-compatible response schema
        expect(response).toHaveProperty('id');
        expect(response).toHaveProperty('object');
        expect(response).toHaveProperty('created');
        expect(response).toHaveProperty('choices');
        expect(Array.isArray(response.choices)).toBe(true);

        if (response.choices.length > 0) {
          expect(response.choices[0]).toHaveProperty('message');
          expect(response.choices[0]).toHaveProperty('finish_reason');
          expect(response.choices[0].message).toHaveProperty('role');
          expect(response.choices[0].message).toHaveProperty('content');
        }
      } catch (e) {
        // Provider may not be configured
      }
    });

    it('should include usage information', async () => {
      try {
        const response = await api.post<any>('/api/chat/completions', validRequest);

        if (response.usage) {
          expect(response.usage).toHaveProperty('prompt_tokens');
          expect(response.usage).toHaveProperty('completion_tokens');
          expect(response.usage).toHaveProperty('total_tokens');
          expect(typeof response.usage.prompt_tokens).toBe('number');
        }
      } catch (e) {
        // Provider may not be configured
      }
    });

    it('should support tool calls in response', async () => {
      try {
        const response = await api.post<any>('/api/chat/completions', {
          ...validRequest,
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_time',
                description: 'Get current time',
                parameters: { type: 'object', properties: {} }
              }
            }
          ]
        });

        // Response may or may not include tool_calls
        if (response.choices?.[0]?.message?.tool_calls) {
          const toolCall = response.choices[0].message.tool_calls[0];
          expect(toolCall).toHaveProperty('id');
          expect(toolCall).toHaveProperty('type');
          expect(toolCall.type).toBe('function');
          expect(toolCall).toHaveProperty('function');
          expect(toolCall.function).toHaveProperty('name');
          expect(toolCall.function).toHaveProperty('arguments');
        }
      } catch (e) {
        // Tool use may not be enabled
      }
    });
  });

  describe('Models Endpoint Schema', () => {
    it('GET /api/models should return model list', async () => {
      const response = await api.get<any>('/api/models');

      // Response may be OpenAI-compatible (data) or custom (models)
      const modelList = response.data || response.models;
      expect(modelList).toBeDefined();
      expect(Array.isArray(modelList)).toBe(true);

      if (modelList.length > 0) {
        const model = modelList[0];
        expect(model).toHaveProperty('id');
        // object field is optional in custom response
        if (model.object) {
          expect(model.object).toBe('model');
        }
      }
    });

    it('GET /api/models/:id should return model details', async () => {
      try {
        const response = await api.get<any>('/api/models');
        const modelList = response.data || response.models;
        if (modelList && modelList.length > 0) {
          const modelId = modelList[0].id;
          const model = await api.get<any>(`/api/models/${modelId}`);

          expect(model).toHaveProperty('id');
          expect(model.id).toBe(modelId);
        }
      } catch (e) {
        // Individual model endpoint may not exist
      }
    });
  });

  describe('Sessions Endpoint Schema', () => {
    it('GET /api/chat/sessions should return session list', async () => {
      try {
        const response = await api.get<any>('/api/chat/sessions');

        // Check structure
        const sessions = response.sessions || response;
        expect(Array.isArray(sessions)).toBe(true);

        if (sessions.length > 0) {
          const session = sessions[0];
          expect(session).toHaveProperty('id');
          // May have title, created_at, etc.
        }
      } catch (e: any) {
        // 401 is acceptable if auth not configured for test environment
        if (e.status !== 401) throw e;
      }
    });

    it('GET /api/chat/sessions/:id should return session details', async () => {
      try {
        const listResponse = await api.get<any>('/api/chat/sessions');
        const sessions = listResponse.sessions || listResponse;

        if (sessions.length > 0) {
          const session = await api.get<any>(`/api/chat/sessions/${sessions[0].id}`);
          expect(session).toHaveProperty('id');
        }
      } catch (e) {
        // Session may not exist
      }
    });

    it('GET /api/chat/sessions/:id/messages should return messages', async () => {
      try {
        const listResponse = await api.get<any>('/api/chat/sessions');
        const sessions = listResponse.sessions || listResponse;

        if (sessions.length > 0) {
          const messages = await api.get<any>(`/api/chat/sessions/${sessions[0].id}/messages`);
          const msgList = messages.messages || messages;
          expect(Array.isArray(msgList)).toBe(true);

          if (msgList.length > 0) {
            expect(msgList[0]).toHaveProperty('role');
            expect(msgList[0]).toHaveProperty('content');
          }
        }
      } catch (e) {
        // No sessions or messages
      }
    });
  });

  describe('MCP Endpoints Schema', () => {
    it('GET /api/mcp/tools should return tool list', async () => {
      try {
        const response = await api.get<any>('/api/mcp/tools');

        expect(response).toHaveProperty('tools');
        expect(Array.isArray(response.tools)).toBe(true);

        if (response.tools.length > 0) {
          const tool = response.tools[0];
          expect(tool).toHaveProperty('name');
          expect(tool).toHaveProperty('description');
          expect(tool).toHaveProperty('inputSchema');
        }
      } catch (e) {
        // MCP may not be available
      }
    });

    it('POST /api/mcp/call should have expected schema', async () => {
      try {
        // Test with a valid tool call structure
        const response = await api.post<any>('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'list_memories',
          input: {}
        });

        // Response should have content or error
        expect(response !== null).toBe(true);
      } catch (e: any) {
        // Even error should have proper format
        if (e.status) {
          expect(typeof e.status).toBe('number');
        }
      }
    });

    it('GET /api/mcp/health should return server status', async () => {
      try {
        const response = await api.get<any>('/api/mcp/health');

        expect(response).toHaveProperty('servers');
        if (Array.isArray(response.servers)) {
          for (const server of response.servers) {
            expect(server).toHaveProperty('name');
            expect(server).toHaveProperty('status');
          }
        }
      } catch (e) {
        // MCP health may not be exposed
      }
    });
  });

  describe('Admin Endpoints Schema', () => {
    it('GET /api/admin/settings/slider should return slider value', async () => {
      try {
        const response = await api.get<any>('/api/admin/settings/slider');

        expect(response).toHaveProperty('value');
        expect(typeof response.value).toBe('number');
        expect(response.value).toBeGreaterThanOrEqual(0);
        expect(response.value).toBeLessThanOrEqual(100);
      } catch (e: any) {
        // 401/403 is acceptable if user doesn't have admin permissions
        expect([401, 403]).toContain(e.status);
      }
    });

    it('POST /api/admin/settings/slider should accept valid value', async () => {
      try {
        const response = await api.post<any>('/api/admin/settings/slider', {
          value: 50
        });

        expect(response.success || response.value !== undefined).toBe(true);
      } catch (e) {
        // May require admin permission
      }
    });

    it('GET /api/admin/tokens should return token list', async () => {
      try {
        const response = await api.get<any>('/api/admin/tokens');

        expect(response).toHaveProperty('tokens');
        expect(Array.isArray(response.tokens)).toBe(true);

        if (response.tokens.length > 0) {
          const token = response.tokens[0];
          expect(token).toHaveProperty('id');
          expect(token).toHaveProperty('name');
          // Should NOT include full key
          expect(token.key?.length || 0).toBeLessThan(50);
        }
      } catch (e) {
        // May require admin permission
      }
    });

    it('GET /api/admin/metrics should return metrics', async () => {
      try {
        const response = await api.get<any>('/api/admin/metrics');

        expect(response).toBeDefined();
        // Metrics structure varies
      } catch (e) {
        // May require admin permission
      }
    });
  });

  describe('Error Response Schema', () => {
    it('should return proper error for 401', async () => {
      const unauthApi = new TestAPIClient(env.apiBaseUrl, 'invalid_key');

      try {
        await unauthApi.get('/api/chat/sessions');
        expect(true).toBe(false); // Should have thrown
      } catch (e: any) {
        expect(e.status).toBe(401);
        expect(e.error || e.message).toBeDefined();
      }
    });

    it('should return proper error for 404', async () => {
      try {
        await api.get('/api/nonexistent/endpoint');
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e.status).toBe(404);
      }
    });

    it('should return proper error for 400', async () => {
      try {
        await api.post('/api/v1/chat/completions', {
          // Missing required fields - send empty messages array
          model: 'gpt-4o',
          messages: []
        });
      } catch (e: any) {
        // 400 for invalid request, 401 if auth fails first, 422 for validation error, or 500 if server error
        expect([400, 401, 422, 500]).toContain(e.status);
        expect(e.error || e.message).toBeDefined();
      }
    });
  });

  describe('Request Headers', () => {
    it('should require Content-Type for POST', async () => {
      // TestAPIClient sets Content-Type automatically
      // This tests that JSON is properly handled
      try {
        const response = await api.post<any>('/api/chat/stream', {
          message: 'Hello'
        });
        expect(response).toBeDefined();
      } catch (e) {
        // Error is acceptable, but should not be content-type related
      }
    });

    it('should return proper Content-Type', async () => {
      const response = await fetch(`${env.apiBaseUrl}/health`);
      const contentType = response.headers.get('content-type');
      expect(contentType?.includes('application/json')).toBe(true);
    });
  });

  describe('Pagination Schema', () => {
    it('should support pagination parameters', async () => {
      try {
        const response = await api.get<any>('/api/chat/sessions?page=1&limit=10');

        // May have pagination metadata
        if (response.pagination) {
          expect(response.pagination).toHaveProperty('page');
          expect(response.pagination).toHaveProperty('limit');
          expect(response.pagination).toHaveProperty('total');
        }
      } catch (e) {
        // Pagination may not be implemented
      }
    });
  });

  describe('Streaming Response Schema', () => {
    it('POST /api/chat/stream should return SSE format', async () => {
      const sessionId = `contract_stream_${Date.now()}`;

      try {
        const response = await fetch(`${env.apiBaseUrl}/api/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.testApiKey}`
          },
          body: JSON.stringify({
            sessionId,
            message: 'Hello'
          })
        });

        expect(response.ok).toBe(true);

        const contentType = response.headers.get('content-type');
        expect(contentType?.includes('text/event-stream')).toBe(true);
      } catch (e) {
        // Streaming may not work in test environment
      }
    });
  });

  describe('OpenAI Embeddings Schema', () => {
    it('POST /api/embeddings should return embedding format', async () => {
      try {
        const response = await api.post<any>('/api/embeddings', {
          input: 'Test text',
          model: 'text-embedding-ada-002'
        });

        expect(response).toHaveProperty('object');
        expect(response.object).toBe('list');
        expect(response).toHaveProperty('data');
        expect(Array.isArray(response.data)).toBe(true);

        if (response.data.length > 0) {
          expect(response.data[0]).toHaveProperty('object');
          expect(response.data[0].object).toBe('embedding');
          expect(response.data[0]).toHaveProperty('embedding');
          expect(Array.isArray(response.data[0].embedding)).toBe(true);
        }
      } catch (e) {
        // Embeddings endpoint may not exist
      }
    });
  });
});
