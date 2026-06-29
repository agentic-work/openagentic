import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';

export interface MCPTool {
  name: string;
  description: string;
  parameters: any;
  serverId?: string;
  category?: string;
  enabled?: boolean;
  requiresApproval?: boolean;
}

export interface MCPServer {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  status: 'running' | 'stopped' | 'error' | 'starting' | 'stopping';
  tools: MCPTool[];
  lastError?: string;
  metadata?: any;
}

export interface MCPExecution {
  id: string;
  toolName: string;
  serverId: string;
  sessionId: string;
  messageId: string;
  parameters: any;
  result?: any;
  error?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  duration?: number;
}

interface MCPStore {
  // State
  servers: Record<string, MCPServer>;
  availableTools: MCPTool[];
  activeTools: string[];
  toolExecutions: Record<string, MCPExecution>;
  loading: boolean;
  error: string | null;
  
  // Actions
  loadServers: () => Promise<void>;
  loadTools: (serverId?: string) => Promise<void>;
  toggleServerStatus: (serverId: string, enabled: boolean) => Promise<void>;
  executeTool: (toolName: string, serverId: string, params: any, sessionId: string, messageId: string) => Promise<MCPExecution>;
  getToolsByCategory: (category?: string) => MCPTool[];
  getExecutionHistory: (sessionId?: string) => MCPExecution[];
  clearError: () => void;
  retryExecution: (executionId: string) => Promise<void>;
  cancelExecution: (executionId: string) => Promise<void>;
}

export const useMCPStore = create<MCPStore>()(
  devtools(
    immer((set, get) => ({
      servers: {},
      availableTools: [],
      activeTools: [],
      toolExecutions: {},
      loading: false,
      error: null,

      loadServers: async () => {
        set({ loading: true, error: null });
        try {
          const response = await fetch('/api/mcp/servers', {
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            }
          });
          
          if (!response.ok) {
            throw new Error(`Failed to load MCP servers: ${response.statusText}`);
          }
          
          const servers = await response.json();
          
          set((state) => {
            state.servers = {};
            servers.forEach((server: any) => {
              state.servers[server.id] = {
                ...server,
                tools: server.tools || []
              };
            });
            state.loading = false;
          });
        } catch (error) {
          set({ loading: false, error: (error as Error).message });
        }
      },

      loadTools: async (serverId) => {
        set({ loading: true, error: null });
        try {
          const url = serverId 
            ? `/api/mcp/servers/${serverId}/tools`
            : '/api/mcp/tools';
            
          const response = await fetch(url, {
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            }
          });
          
          if (!response.ok) {
            throw new Error(`Failed to load MCP tools: ${response.statusText}`);
          }
          
          const tools = await response.json();
          
          set((state) => {
            if (serverId) {
              // Update tools for specific server
              if (state.servers[serverId]) {
                state.servers[serverId].tools = tools;
              }
            } else {
              // Update all available tools
              state.availableTools = tools;
              
              // Update active tools list
              state.activeTools = tools
                .filter((tool: MCPTool) => tool.enabled !== false)
                .map((tool: MCPTool) => tool.name);
            }
            state.loading = false;
          });
        } catch (error) {
          set({ loading: false, error: (error as Error).message });
        }
      },

      toggleServerStatus: async (serverId, enabled) => {
        set({ loading: true, error: null });
        try {
          const response = await fetch(`/api/mcp/servers/${serverId}/toggle`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ enabled })
          });
          
          if (!response.ok) {
            throw new Error(`Failed to toggle server: ${response.statusText}`);
          }
          
          const updatedServer = await response.json();
          
          set((state) => {
            if (state.servers[serverId]) {
              state.servers[serverId] = {
                ...state.servers[serverId],
                ...updatedServer
              };
            }
            state.loading = false;
          });
          
          // Reload tools after server status change
          await get().loadTools();
        } catch (error) {
          set({ loading: false, error: (error as Error).message });
        }
      },

      executeTool: async (toolName, serverId, params, sessionId, messageId) => {
        const executionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Create pending execution
        const execution: MCPExecution = {
          id: executionId,
          toolName,
          serverId,
          sessionId,
          messageId,
          parameters: params,
          status: 'pending',
          startTime: new Date()
        };
        
        set((state) => {
          state.toolExecutions[executionId] = execution;
        });
        
        try {
          // Update to running status
          set((state) => {
            state.toolExecutions[executionId].status = 'running';
          });
          
          const response = await fetch('/api/mcp/tools/execute', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              toolName,
              serverId,
              parameters: params,
              sessionId,
              messageId,
              executionId
            })
          });
          
          if (!response.ok) {
            throw new Error(`Tool execution failed: ${response.statusText}`);
          }
          
          const result = await response.json();
          const endTime = new Date();
          
          set((state) => {
            state.toolExecutions[executionId] = {
              ...state.toolExecutions[executionId],
              result,
              status: 'completed',
              endTime,
              duration: endTime.getTime() - execution.startTime.getTime()
            };
          });
          
          return get().toolExecutions[executionId];
        } catch (error) {
          const endTime = new Date();
          
          set((state) => {
            state.toolExecutions[executionId] = {
              ...state.toolExecutions[executionId],
              error: (error as Error).message,
              status: 'failed',
              endTime,
              duration: endTime.getTime() - execution.startTime.getTime()
            };
          });
          
          return get().toolExecutions[executionId];
        }
      },

      getToolsByCategory: (category) => {
        const { availableTools } = get();
        if (!category) return availableTools;
        
        return availableTools.filter(tool => 
          tool.category === category || 
          (category === 'uncategorized' && !tool.category)
        );
      },

      getExecutionHistory: (sessionId) => {
        const { toolExecutions } = get();
        const executions = Object.values(toolExecutions);
        
        if (!sessionId) return executions;
        
        return executions
          .filter(execution => execution.sessionId === sessionId)
          .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
      },

      retryExecution: async (executionId) => {
        const execution = get().toolExecutions[executionId];
        if (!execution) return;
        
        // Create new execution with same parameters
        await get().executeTool(
          execution.toolName,
          execution.serverId,
          execution.parameters,
          execution.sessionId,
          execution.messageId
        );
      },

      cancelExecution: async (executionId) => {
        try {
          await fetch(`/api/mcp/executions/${executionId}/cancel`, {
            method: 'POST',
            credentials: 'include',
          });
          
          set((state) => {
            if (state.toolExecutions[executionId]) {
              state.toolExecutions[executionId].status = 'failed';
              state.toolExecutions[executionId].error = 'Cancelled by user';
              state.toolExecutions[executionId].endTime = new Date();
            }
          });
        } catch (error) {
          set({ error: (error as Error).message });
        }
      },

      clearError: () => set({ error: null })
    }))
  )
);

// Selectors for optimized re-renders
export const selectActiveServers = (state: MCPStore) => 
  Object.values(state.servers).filter(server => server.enabled);

export const selectToolsByServer = (serverId: string) => (state: MCPStore) =>
  state.servers[serverId]?.tools || [];

export const selectRecentExecutions = (limit: number = 10) => (state: MCPStore) =>
  Object.values(state.toolExecutions)
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
    .slice(0, limit);