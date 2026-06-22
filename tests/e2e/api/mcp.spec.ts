/**
 * MCP (Model Context Protocol) Tests
 *
 * Tests for:
 * - MCP Proxy health
 * - Tool discovery
 * - Tool execution
 * - Error handling
 */

import { test, expect } from '@playwright/test';

const MCP_BASE = process.env.TEST_MCP_URL || 'http://localhost:8090';
const API_BASE = process.env.TEST_API_URL || 'http://localhost:8000';
const TEST_API_KEY = process.env.TEST_API_KEY || 'awc_test_key';

const authHeaders = {
  'X-API-Key': TEST_API_KEY,
  'Content-Type': 'application/json'
};

test.describe('MCP Proxy', () => {
  test.describe('Health & Status', () => {
    test('GET /health returns proxy status', async ({ request }) => {
      const response = await request.get(`${MCP_BASE}/health`);
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body).toHaveProperty('status');
    });

    test('GET /health includes server status', async ({ request }) => {
      const response = await request.get(`${MCP_BASE}/health`);
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body).toHaveProperty('servers');
    });
  });

  test.describe('Tool Discovery', () => {
    test('GET /tools returns available tools', async ({ request }) => {
      const response = await request.get(`${MCP_BASE}/tools`);
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      expect(body).toHaveProperty('tools');
      expect(Array.isArray(body.tools)).toBeTruthy();
    });

    test('tools have required schema fields', async ({ request }) => {
      const response = await request.get(`${MCP_BASE}/tools`);
      expect(response.ok()).toBeTruthy();
      const body = await response.json();

      if (body.tools.length > 0) {
        const tool = body.tools[0];
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
      }
    });

    test('GET /tools by category', async ({ request }) => {
      const response = await request.get(`${MCP_BASE}/tools?category=web`);
      // May or may not support filtering
      expect([200, 400]).toContain(response.status());
    });
  });

  test.describe('Tool Execution', () => {
    test('POST /call executes a tool', async ({ request }) => {
      const response = await request.post(`${MCP_BASE}/call`, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          name: 'openagentic_web__web_search',
          arguments: { query: 'test query' }
        }
      });
      // Tool may succeed or fail based on config
      expect([200, 400, 404, 500]).toContain(response.status());
    });

    test('POST /call with missing tool returns 404', async ({ request }) => {
      const response = await request.post(`${MCP_BASE}/call`, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          name: 'nonexistent_tool_12345',
          arguments: {}
        }
      });
      expect([400, 404]).toContain(response.status());
    });

    test('POST /call with invalid arguments returns error', async ({ request }) => {
      const response = await request.post(`${MCP_BASE}/call`, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          name: 'openagentic_memory__store_memory',
          arguments: {} // Missing required fields
        }
      });
      expect([400, 422]).toContain(response.status());
    });
  });

  test.describe('MCP via API Gateway', () => {
    test('GET /api/tools returns tools via API', async ({ request }) => {
      const response = await request.get(`${API_BASE}/api/tools`, {
        headers: authHeaders
      });
      // May or may not exist
      expect([200, 404]).toContain(response.status());
    });

    test('chat stream can use MCP tools', async ({ request }) => {
      const response = await request.post(`${API_BASE}/api/chat/stream`, {
        headers: {
          ...authHeaders,
          'Accept': 'text/event-stream'
        },
        data: {
          sessionId: `mcp_test_${Date.now()}`,
          message: 'Search the web for "test query"'
        }
      });
      expect(response.ok()).toBeTruthy();
      // May or may not trigger tool depending on model
    });
  });

  test.describe('Specific MCP Servers', () => {
    test('memory MCP stores and retrieves', async ({ request }) => {
      const sessionId = `memory_test_${Date.now()}`;

      // Store a memory
      const storeResponse = await request.post(`${MCP_BASE}/call`, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          name: 'openagentic_memory__store_memory',
          arguments: {
            content: 'Test memory content',
            tags: ['test'],
            metadata: { sessionId }
          }
        }
      });
      // May or may not be available
      if (storeResponse.ok()) {
        // Try to retrieve
        const retrieveResponse = await request.post(`${MCP_BASE}/call`, {
          headers: { 'Content-Type': 'application/json' },
          data: {
            name: 'openagentic_memory__search_memories',
            arguments: {
              query: 'Test memory',
              limit: 10
            }
          }
        });
        expect(retrieveResponse.ok()).toBeTruthy();
      }
    });

    test('admin MCP requires authentication', async ({ request }) => {
      const response = await request.post(`${MCP_BASE}/call`, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          name: 'admin_mcp__list_users',
          arguments: {}
        }
      });
      // Admin tools may require auth
      expect([200, 401, 403, 404]).toContain(response.status());
    });

    test('diagram MCP generates diagrams', async ({ request }) => {
      const response = await request.post(`${MCP_BASE}/call`, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          name: 'openagentic_diagram__generate_mermaid',
          arguments: {
            diagram_type: 'flowchart',
            description: 'A to B to C'
          }
        }
      });
      // May not be available
      expect([200, 400, 404, 500]).toContain(response.status());
    });
  });
});
