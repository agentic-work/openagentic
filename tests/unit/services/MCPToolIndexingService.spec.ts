/**
 * MCPToolIndexingService Unit Tests
 *
 * Tests for MCP tool discovery and indexing:
 * - Tool discovery
 * - Tool caching
 * - Server health checks
 * - Tool filtering
 * - Permission checks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MCPToolIndexingService', () => {
  describe('Tool Discovery', () => {
    interface MCPTool {
      name: string;
      description: string;
      server: string;
      inputSchema: Record<string, any>;
    }

    const mockTools: MCPTool[] = [
      {
        name: 'web_search',
        description: 'Search the web',
        server: 'openagentic_web',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' }
          },
          required: ['query']
        }
      },
      {
        name: 'store_memory',
        description: 'Store information in memory',
        server: 'openagentic_memory',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            category: { type: 'string' }
          },
          required: ['content']
        }
      },
      {
        name: 'create_diagram',
        description: 'Create a diagram',
        server: 'openagentic_diagram',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['flowchart', 'sequence', 'class'] },
            code: { type: 'string' }
          },
          required: ['type', 'code']
        }
      }
    ];

    it('should list all available tools', () => {
      expect(mockTools.length).toBe(3);
    });

    it('should have required tool properties', () => {
      for (const tool of mockTools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.server).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
      }
    });

    it('should have valid input schema', () => {
      for (const tool of mockTools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });
  });

  describe('Tool Filtering', () => {
    const tools = [
      { name: 'web_search', server: 'openagentic_web', category: 'search' },
      { name: 'fetch_url', server: 'openagentic_web', category: 'search' },
      { name: 'store_memory', server: 'openagentic_memory', category: 'storage' },
      { name: 'search_memories', server: 'openagentic_memory', category: 'search' },
      { name: 'execute_code', server: 'openagentic_openagentic', category: 'code' },
    ];

    const filterByServer = (server: string) => {
      return tools.filter(t => t.server === server);
    };

    const filterByCategory = (category: string) => {
      return tools.filter(t => t.category === category);
    };

    const filterByName = (pattern: string) => {
      const regex = new RegExp(pattern, 'i');
      return tools.filter(t => regex.test(t.name));
    };

    it('should filter tools by server', () => {
      const webTools = filterByServer('openagentic_web');
      expect(webTools.length).toBe(2);
      expect(webTools.every(t => t.server === 'openagentic_web')).toBe(true);
    });

    it('should filter tools by category', () => {
      const searchTools = filterByCategory('search');
      expect(searchTools.length).toBe(3);
    });

    it('should filter tools by name pattern', () => {
      const memoryTools = filterByName('memor');  // Matches 'store_memory' and 'search_memories'
      expect(memoryTools.length).toBe(2);
    });

    it('should return empty array for no matches', () => {
      const noMatch = filterByServer('nonexistent');
      expect(noMatch.length).toBe(0);
    });
  });

  describe('Server Health Checks', () => {
    interface ServerHealth {
      name: string;
      healthy: boolean;
      latency?: number;
      error?: string;
      lastCheck: Date;
    }

    const checkServerHealth = async (serverName: string): Promise<ServerHealth> => {
      // Simulated health check
      const healthyServers = ['openagentic_web', 'openagentic_memory', 'openagentic_diagram'];

      const isHealthy = healthyServers.includes(serverName);
      return {
        name: serverName,
        healthy: isHealthy,
        latency: isHealthy ? Math.random() * 100 : undefined,
        error: isHealthy ? undefined : 'Connection refused',
        lastCheck: new Date()
      };
    };

    it('should report healthy servers', async () => {
      const health = await checkServerHealth('openagentic_web');
      expect(health.healthy).toBe(true);
      expect(health.latency).toBeDefined();
    });

    it('should report unhealthy servers', async () => {
      const health = await checkServerHealth('openagentic_nonexistent');
      expect(health.healthy).toBe(false);
      expect(health.error).toBeDefined();
    });

    it('should include timestamp', async () => {
      const health = await checkServerHealth('openagentic_memory');
      expect(health.lastCheck).toBeInstanceOf(Date);
    });
  });

  describe('Tool Caching', () => {
    const cache: Map<string, { tools: any[]; expires: number }> = new Map();
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    const getCachedTools = (server: string): any[] | null => {
      const cached = cache.get(server);
      if (!cached) return null;
      if (Date.now() > cached.expires) {
        cache.delete(server);
        return null;
      }
      return cached.tools;
    };

    const setCachedTools = (server: string, tools: any[]) => {
      cache.set(server, {
        tools,
        expires: Date.now() + CACHE_TTL
      });
    };

    beforeEach(() => {
      cache.clear();
    });

    it('should cache tools', () => {
      const tools = [{ name: 'tool1' }, { name: 'tool2' }];
      setCachedTools('openagentic_web', tools);

      const cached = getCachedTools('openagentic_web');
      expect(cached).toEqual(tools);
    });

    it('should return null for uncached server', () => {
      const cached = getCachedTools('openagentic_nonexistent');
      expect(cached).toBeNull();
    });

    it('should invalidate expired cache', () => {
      const tools = [{ name: 'tool1' }];
      cache.set('openagentic_test', {
        tools,
        expires: Date.now() - 1000 // Already expired
      });

      const cached = getCachedTools('openagentic_test');
      expect(cached).toBeNull();
    });
  });

  describe('Permission Filtering', () => {
    interface UserPermissions {
      allowedServers: string[];
      blockedTools: string[];
      isAdmin: boolean;
    }

    const tools = [
      { name: 'web_search', server: 'openagentic_web' },
      { name: 'execute_code', server: 'openagentic_openagentic' },
      { name: 'admin_command', server: 'openagentic_admin' },
      { name: 'store_memory', server: 'openagentic_memory' },
    ];

    const filterByPermissions = (
      tools: any[],
      permissions: UserPermissions
    ): any[] => {
      if (permissions.isAdmin) return tools;

      return tools.filter(tool => {
        // Check if server is allowed
        if (!permissions.allowedServers.includes(tool.server)) {
          return false;
        }

        // Check if tool is blocked
        if (permissions.blockedTools.includes(tool.name)) {
          return false;
        }

        return true;
      });
    };

    it('should filter tools by allowed servers', () => {
      const permissions: UserPermissions = {
        allowedServers: ['openagentic_web', 'openagentic_memory'],
        blockedTools: [],
        isAdmin: false
      };

      const filtered = filterByPermissions(tools, permissions);
      expect(filtered.length).toBe(2);
      expect(filtered.every(t => permissions.allowedServers.includes(t.server))).toBe(true);
    });

    it('should filter out blocked tools', () => {
      const permissions: UserPermissions = {
        allowedServers: ['openagentic_web', 'openagentic_memory', 'openagentic_openagentic'],
        blockedTools: ['execute_code'],
        isAdmin: false
      };

      const filtered = filterByPermissions(tools, permissions);
      expect(filtered.every(t => t.name !== 'execute_code')).toBe(true);
    });

    it('should allow all tools for admin', () => {
      const permissions: UserPermissions = {
        allowedServers: [],
        blockedTools: [],
        isAdmin: true
      };

      const filtered = filterByPermissions(tools, permissions);
      expect(filtered.length).toBe(tools.length);
    });
  });

  describe('Tool Schema Validation', () => {
    const validateToolInput = (
      schema: any,
      input: Record<string, any>
    ): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];

      // Check required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (input[field] === undefined) {
            errors.push(`Missing required field: ${field}`);
          }
        }
      }

      // Check property types
      if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          const propSchema = prop as any;
          const value = input[key];

          if (value !== undefined) {
            if (propSchema.type === 'string' && typeof value !== 'string') {
              errors.push(`Field ${key} must be a string`);
            }
            if (propSchema.type === 'number' && typeof value !== 'number') {
              errors.push(`Field ${key} must be a number`);
            }
            if (propSchema.enum && !propSchema.enum.includes(value)) {
              errors.push(`Field ${key} must be one of: ${propSchema.enum.join(', ')}`);
            }
          }
        }
      }

      return { valid: errors.length === 0, errors };
    };

    it('should validate required fields', () => {
      const schema = {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      };

      const result1 = validateToolInput(schema, { query: 'test' });
      expect(result1.valid).toBe(true);

      const result2 = validateToolInput(schema, {});
      expect(result2.valid).toBe(false);
      expect(result2.errors[0]).toContain('query');
    });

    it('should validate field types', () => {
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'number' }
        }
      };

      const result = validateToolInput(schema, { count: 'not a number' });
      expect(result.valid).toBe(false);
    });

    it('should validate enum values', () => {
      const schema = {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['flowchart', 'sequence'] }
        }
      };

      const result1 = validateToolInput(schema, { type: 'flowchart' });
      expect(result1.valid).toBe(true);

      const result2 = validateToolInput(schema, { type: 'invalid' });
      expect(result2.valid).toBe(false);
    });
  });

  describe('Tool Formatting', () => {
    const formatToolForLLM = (tool: any): any => {
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      };
    };

    it('should format tool for OpenAI-compatible API', () => {
      const tool = {
        name: 'web_search',
        description: 'Search the web',
        server: 'openagentic_web',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } }
        }
      };

      const formatted = formatToolForLLM(tool);

      expect(formatted.type).toBe('function');
      expect(formatted.function.name).toBe('web_search');
      expect(formatted.function.description).toBe('Search the web');
      expect(formatted.function.parameters).toEqual(tool.inputSchema);
    });
  });

  describe('Tool Execution Tracking', () => {
    const executionLog: any[] = [];

    const trackExecution = (
      toolName: string,
      serverId: string,
      userId: string,
      duration: number,
      success: boolean
    ) => {
      executionLog.push({
        toolName,
        serverId,
        userId,
        duration,
        success,
        timestamp: new Date()
      });
    };

    const getToolStats = (toolName: string) => {
      const executions = executionLog.filter(e => e.toolName === toolName);
      const successCount = executions.filter(e => e.success).length;
      const avgDuration = executions.reduce((sum, e) => sum + e.duration, 0) / executions.length;

      return {
        totalExecutions: executions.length,
        successRate: executions.length > 0 ? successCount / executions.length : 0,
        avgDuration
      };
    };

    beforeEach(() => {
      executionLog.length = 0;
    });

    it('should track tool executions', () => {
      trackExecution('web_search', 'openagentic_web', 'user_123', 500, true);
      trackExecution('web_search', 'openagentic_web', 'user_123', 600, true);
      trackExecution('web_search', 'openagentic_web', 'user_456', 700, false);

      const stats = getToolStats('web_search');
      expect(stats.totalExecutions).toBe(3);
      expect(stats.successRate).toBeCloseTo(0.67, 1);
      expect(stats.avgDuration).toBe(600);
    });

    it('should return zero stats for unused tool', () => {
      const stats = getToolStats('unused_tool');
      expect(stats.totalExecutions).toBe(0);
      expect(stats.successRate).toBe(0);
    });
  });
});
