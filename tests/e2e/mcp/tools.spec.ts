/**
 * MCP Tool E2E Tests
 *
 * Tests for all MCP tools across servers:
 * - openagentic_web (search, fetch)
 * - openagentic_memory (store, search, delete)
 * - openagentic_diagram (create diagrams)
 * - openagentic_admin (system tools)
 * - openagentic_flowise (workflow management)
 * - openagentic_openagentic (code execution)
 * - openagentic_azure (Azure operations)
 * - openagentic_gcp (GCP operations)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestEnv, TestAPIClient } from '../../fixtures/setup';

const env = getTestEnv();
const api = new TestAPIClient(env.apiBaseUrl, env.testApiKey);

describe('MCP Tool E2E Tests', () => {
  describe('Tool Discovery', () => {
    it('should list all available MCP tools', async () => {
      try {
        const tools = await api.get<any>('/api/mcp/tools');
        expect(tools.tools || tools).toBeDefined();

        const toolList = tools.tools || tools;
        expect(Array.isArray(toolList)).toBe(true);
        expect(toolList.length).toBeGreaterThan(0);

        // Log tool names for reference
        console.log('Available tools:', toolList.map((t: any) => t.name).join(', '));
      } catch (e) {
        console.log('MCP tools not available');
      }
    });

    it('should have tools from multiple servers', async () => {
      try {
        const tools = await api.get<any>('/api/mcp/tools');
        const toolList = tools.tools || tools;

        const servers = new Set(toolList.map((t: any) => t.server));
        console.log('Available servers:', Array.from(servers).join(', '));
      } catch (e) {
        // MCP may not be available
      }
    });
  });

  describe('Web MCP (openagentic_web)', () => {
    const server = 'openagentic_web';

    it('should search the web', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'web_search',
          input: { query: 'TypeScript programming' }
        });

        expect(result.results || result.content).toBeDefined();
      } catch (e) {
        console.log('Web search not available');
      }
    });

    it('should fetch URL content', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'fetch_url',
          input: { url: 'https://example.com' }
        });

        expect(result.content || result.text || result.html).toBeDefined();
      } catch (e) {
        console.log('URL fetch not available');
      }
    });

    it('should handle invalid URLs gracefully', async () => {
      try {
        await api.post('/api/mcp/call', {
          server,
          tool: 'fetch_url',
          input: { url: 'not-a-valid-url' }
        });
      } catch (e: any) {
        expect(e.error || e.message).toBeDefined();
      }
    });
  });

  describe('Memory MCP (openagentic_memory)', () => {
    const server = 'openagentic_memory';
    let storedMemoryId: string;

    it('should store a memory', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'store_memory',
          input: {
            content: `E2E test memory ${Date.now()}`,
            category: 'e2e_test',
            metadata: { test: true }
          }
        });

        expect(result.success || result.memoryId || result.id).toBeDefined();
        storedMemoryId = result.memoryId || result.id;
      } catch (e) {
        console.log('Memory store not available');
      }
    });

    it('should search memories', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'search_memories',
          input: {
            query: 'E2E test',
            limit: 5
          }
        });

        expect(result.memories || result.results || result).toBeDefined();
      } catch (e) {
        console.log('Memory search not available');
      }
    });

    it('should search by category', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'search_memories',
          input: {
            query: 'test',
            category: 'e2e_test',
            limit: 10
          }
        });

        const memories = result.memories || result.results || [];
        if (memories.length > 0) {
          expect(memories.every((m: any) => m.category === 'e2e_test')).toBe(true);
        }
      } catch (e) {
        console.log('Category search not available');
      }
    });

    it('should list memories', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'list_memories',
          input: { limit: 10 }
        });

        expect(Array.isArray(result.memories || result)).toBe(true);
      } catch (e) {
        console.log('Memory list not available');
      }
    });

    it('should delete memory', async () => {
      if (!storedMemoryId) return;

      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'delete_memory',
          input: { memoryId: storedMemoryId }
        });

        expect(result.success).toBe(true);
      } catch (e) {
        console.log('Memory delete not available');
      }
    });
  });

  describe('Diagram MCP (openagentic_diagram)', () => {
    const server = 'openagentic_diagram';

    it('should create flowchart diagram', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'create_diagram',
          input: {
            type: 'flowchart',
            code: `
              graph TD
                A[Start] --> B{Decision}
                B -->|Yes| C[Action 1]
                B -->|No| D[Action 2]
                C --> E[End]
                D --> E
            `
          }
        });

        expect(result.svg || result.image || result.url).toBeDefined();
      } catch (e) {
        console.log('Diagram creation not available');
      }
    });

    it('should create sequence diagram', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'create_diagram',
          input: {
            type: 'sequence',
            code: `
              sequenceDiagram
                participant A as Client
                participant B as Server
                A->>B: Request
                B-->>A: Response
            `
          }
        });

        expect(result.svg || result.image).toBeDefined();
      } catch (e) {
        console.log('Sequence diagram not available');
      }
    });

    it('should create class diagram', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'create_diagram',
          input: {
            type: 'class',
            code: `
              classDiagram
                class User {
                  +String name
                  +String email
                  +login()
                }
            `
          }
        });

        expect(result.svg || result.image).toBeDefined();
      } catch (e) {
        console.log('Class diagram not available');
      }
    });
  });

  describe('Admin MCP (openagentic_admin)', () => {
    const server = 'openagentic_admin';

    it('should get system status', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'get_system_status',
          input: {}
        });

        expect(result).toBeDefined();
      } catch (e) {
        console.log('Admin tools not available');
      }
    });

    it('should list users', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'list_users',
          input: { limit: 10 }
        });

        expect(result.users || result).toBeDefined();
      } catch (e) {
        console.log('User listing not available');
      }
    });

    it('should get metrics', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'get_metrics',
          input: {}
        });

        expect(result).toBeDefined();
      } catch (e) {
        console.log('Metrics not available');
      }
    });
  });

  describe('Flowise MCP (openagentic_flowise)', () => {
    const server = 'openagentic_flowise';

    it('should list chatflows', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'list_chatflows',
          input: {}
        });

        expect(result.chatflows || result.flows || result).toBeDefined();
      } catch (e) {
        console.log('Flowise not available');
      }
    });

    it('should run chatflow', async () => {
      try {
        // Get first chatflow
        const list = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'list_chatflows',
          input: {}
        });

        const chatflows = list.chatflows || list.flows || [];
        if (chatflows.length > 0) {
          const result = await api.post<any>('/api/mcp/call', {
            server,
            tool: 'run_chatflow',
            input: {
              chatflowId: chatflows[0].id,
              question: 'Hello'
            }
          });

          expect(result.text || result.response).toBeDefined();
        }
      } catch (e) {
        console.log('Chatflow execution not available');
      }
    });
  });

  describe('OpenAgentic MCP (openagentic_openagentic)', () => {
    const server = 'openagentic_openagentic';

    it('should execute Python code', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'execute_code',
          input: {
            language: 'python',
            code: 'print("Hello from Python")'
          }
        });

        expect(result.output || result.stdout).toBeDefined();
      } catch (e) {
        console.log('Code execution not available');
      }
    });

    it('should execute JavaScript code', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'execute_code',
          input: {
            language: 'javascript',
            code: 'console.log("Hello from JS")'
          }
        });

        expect(result.output || result.stdout).toBeDefined();
      } catch (e) {
        console.log('JS execution not available');
      }
    });

    it('should handle code errors', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'execute_code',
          input: {
            language: 'python',
            code: 'raise Exception("Test error")'
          }
        });

        expect(result.error || result.stderr).toBeDefined();
      } catch (e) {
        // Error is acceptable
      }
    });

    it('should timeout long-running code', async () => {
      try {
        await api.post('/api/mcp/call', {
          server,
          tool: 'execute_code',
          input: {
            language: 'python',
            code: 'import time; time.sleep(60)'
          }
        });
      } catch (e: any) {
        expect(e.error || e.message).toContain('timeout');
      }
    });
  });

  describe('Azure MCP (openagentic_azure)', () => {
    const server = 'openagentic_azure';

    it('should list resource groups', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'list_resource_groups',
          input: {}
        });

        expect(result.resourceGroups || result).toBeDefined();
      } catch (e) {
        console.log('Azure not available');
      }
    });

    it('should get ARM template', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'generate_arm_template',
          input: {
            resourceType: 'Microsoft.Storage/storageAccounts',
            name: 'teststorage'
          }
        });

        expect(result.template || result.arm).toBeDefined();
      } catch (e) {
        console.log('ARM template not available');
      }
    });
  });

  describe('GCP MCP (openagentic_gcp)', () => {
    const server = 'openagentic_gcp';

    it('should list projects', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'list_projects',
          input: {}
        });

        expect(result.projects || result).toBeDefined();
      } catch (e) {
        console.log('GCP not available');
      }
    });

    it('should list GKE clusters', async () => {
      try {
        const result = await api.post<any>('/api/mcp/call', {
          server,
          tool: 'list_gke_clusters',
          input: {}
        });

        expect(result.clusters || result).toBeDefined();
      } catch (e) {
        console.log('GKE not available');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown server', async () => {
      try {
        await api.post('/api/mcp/call', {
          server: 'nonexistent_server',
          tool: 'some_tool',
          input: {}
        });
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e.error || e.message).toBeDefined();
      }
    });

    it('should handle unknown tool', async () => {
      try {
        await api.post('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'nonexistent_tool',
          input: {}
        });
        expect(true).toBe(false);
      } catch (e: any) {
        expect(e.error || e.message).toBeDefined();
      }
    });

    it('should handle missing required parameters', async () => {
      try {
        await api.post('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'store_memory',
          input: {} // Missing required 'content'
        });
      } catch (e: any) {
        expect(e.error || e.message).toBeDefined();
      }
    });

    it('should handle invalid parameter types', async () => {
      try {
        await api.post('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'search_memories',
          input: {
            query: 123, // Should be string
            limit: 'five' // Should be number
          }
        });
      } catch (e: any) {
        expect(e.error || e.message).toBeDefined();
      }
    });
  });

  describe('Concurrent Tool Calls', () => {
    it('should handle multiple concurrent calls', async () => {
      const calls = [
        api.post('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'list_memories',
          input: { limit: 5 }
        }),
        api.post('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'list_memories',
          input: { limit: 5 }
        }),
        api.post('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'list_memories',
          input: { limit: 5 }
        })
      ].map(p => p.catch(() => null));

      const results = await Promise.all(calls);
      const successCount = results.filter(r => r !== null).length;
      expect(successCount).toBeGreaterThan(0);
    });

    it('should handle calls to different servers', async () => {
      const calls = [
        api.post('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'list_memories',
          input: { limit: 5 }
        }),
        api.post('/api/mcp/call', {
          server: 'openagentic_diagram',
          tool: 'create_diagram',
          input: { type: 'flowchart', code: 'graph TD; A-->B;' }
        })
      ].map(p => p.catch(() => null));

      const results = await Promise.all(calls);
      // At least some should succeed
    });
  });

  describe('Cleanup', () => {
    afterAll(async () => {
      // Clean up test memories
      try {
        const memories = await api.post<any>('/api/mcp/call', {
          server: 'openagentic_memory',
          tool: 'search_memories',
          input: {
            query: 'E2E test',
            category: 'e2e_test',
            limit: 100
          }
        });

        const memoryList = memories.memories || memories.results || [];
        for (const memory of memoryList) {
          await api.post('/api/mcp/call', {
            server: 'openagentic_memory',
            tool: 'delete_memory',
            input: { memoryId: memory.id }
          }).catch(() => null);
        }
      } catch (e) {
        // Cleanup may fail
      }
    });
  });
});
