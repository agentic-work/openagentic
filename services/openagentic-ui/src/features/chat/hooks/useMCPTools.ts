/**
 * MCP Tools Management Hook
 * Now uses MCPContext as single source of truth
 * Provides backward compatibility wrapper for existing chat code
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useAuth } from '@/app/providers/AuthContext';
import { useMCP } from '@/app/providers/MCPContext';
import { apiEndpoint } from '@/utils/api';

interface MCPFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  serverId?: string;
  serverType?: string;
  serverName?: string;
}

interface MCPServer {
  id: string;
  name: string;
  serverName: string;
  status: string;
  isConnected: boolean;
  tools: MCPFunction[];
  toolCount: number;
}

interface MCPToolsResponse {
  tools: {
    functions: MCPFunction[];
    toolsByServer?: Record<string, MCPFunction[]>;
  };
  servers?: MCPServer[];
}

export const useMCPTools = () => {
  const { getAccessToken } = useAuth();
  const { mcps, enabledTools: mcpEnabledTools, toggleServer, toggleTool, refreshMCPs } = useMCP();
  const [activeMcpCalls, setActiveMcpCalls] = useState<any[]>([]);
  const [currentToolRound, setCurrentToolRound] = useState<number>(0); // Track agentic loop round

  // Transform MCP context data to match old format for backward compatibility
  const availableMCPFunctions = useMemo<MCPToolsResponse | null>(() => {
    if (!mcps || mcps.length === 0) {
      return null;
    }

    // Flatten all tools from all servers
    const allFunctions: MCPFunction[] = [];
    const toolsByServer: Record<string, MCPFunction[]> = {};

    mcps.forEach(server => {
      const serverTools = server.tools?.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        serverId: server.id,
        serverType: 'mcp',
        serverName: server.name
      })) || [];

      allFunctions.push(...serverTools);
      toolsByServer[server.id] = serverTools;
    });

    // Transform servers to match old format
    const servers: MCPServer[] = mcps.map(server => ({
      id: server.id,
      name: server.name,
      serverName: server.name,
      status: server.status || 'unknown',
      isConnected: server.isConnected ?? server.enabled,
      tools: server.tools?.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        serverId: server.id,
        serverType: 'mcp',
        serverName: server.name
      })) || [],
      toolCount: server.tools?.length || 0
    }));

    return {
      tools: {
        functions: allFunctions,
        toolsByServer
      },
      servers
    };
  }, [mcps]);

  // Wrap MCPContext's refreshMCPs as loadMCPFunctions for backward compatibility
  const loadMCPFunctions = useCallback(async () => {
    await refreshMCPs();
  }, [refreshMCPs]);

  // Handle tool toggle - supports both server-level and tool-level toggles
  const handleToggleTool = useCallback(async (toolKey: string) => {
    // Check if it's a server toggle (no dot) or tool toggle (has dot)
    if (toolKey.includes('.')) {
      // Tool-level toggle: serverId.toolName
      await toggleTool(toolKey);
    } else {
      // Server-level toggle
      await toggleServer(toolKey);
    }
  }, [toggleServer, toggleTool]);

  // Handle tool execution updates
  const handleToolExecution = useCallback((tool: any) => {
    if (tool.type === 'clear_all') {
      // CRITICAL FIX: Clear active MCP calls when stream completes
      // This prevents "hanging cursor" issue where stale tool badges show during state transition
      setActiveMcpCalls([]);
      setCurrentToolRound(0); // Reset round counter
    } else if (tool.type === 'start') {
      setActiveMcpCalls(tool.tools || []);
      setCurrentToolRound(tool.round || 1); // Track round for agentic loop display
    } else if (tool.type === 'mcp_calls_data') {
      // Real-time MCP call results from backend
      console.log('[MCP-TOOLS] 📥 Received mcp_calls_data:', tool.calls);
      setActiveMcpCalls(tool.calls || []);
      // Update round if provided (agentic loop tracking)
      if (tool.round && tool.round > 0) {
        setCurrentToolRound(tool.round);
      }
    } else if (tool.type === 'executing') {
      // CRITICAL FIX: Add tool to active calls if it doesn't exist yet (streaming display)
      // MCP tool execution logging - disabled in production
      // console.log('[MCP-TOOLS] 🔧 tool_executing event received:', tool);
      setActiveMcpCalls(prev => {
        const exists = prev.some(call => call.name === tool.name);
        if (!exists) {
          // Add new tool call for live display during streaming
          return [...prev, {
            name: tool.name,
            status: 'executing',
            arguments: tool.arguments,
            server: tool.server || 'unknown',
            startTime: Date.now(),
          }];
        }
        // Update existing tool call
        return prev.map(call =>
          call.name === tool.name
            ? { ...call, status: 'executing' as const, arguments: tool.arguments, startTime: call.startTime || Date.now() }
            : call
        );
      });
    } else if (tool.type === 'result') {
      // CRITICAL FIX: Add tool to active calls if it doesn't exist yet (streaming display)
      setActiveMcpCalls(prev => {
        const exists = prev.some(call => call.name === tool.name);
        if (!exists) {
          // Add completed tool call for live display during streaming
          return [...prev, {
            name: tool.name,
            status: 'completed',
            result: tool.result,
            server: tool.server || 'unknown'
          }];
        }
        // Update existing tool call
        return prev.map(call =>
          call.name === tool.name
            ? { ...call, status: 'completed' as const, result: tool.result }
            : call
        );
      });
    } else if (tool.type === 'error') {
      // CRITICAL FIX: Add tool to active calls if it doesn't exist yet (streaming display)
      setActiveMcpCalls(prev => {
        const exists = prev.some(call => call.name === tool.name);
        if (!exists) {
          // Add failed tool call for live display during streaming
          return [...prev, {
            name: tool.name,
            status: 'error',
            error: tool.error,
            server: tool.server || 'unknown'
          }];
        }
        // Update existing tool call
        return prev.map(call =>
          call.name === tool.name
            ? { ...call, status: 'error' as const, error: tool.error }
            : call
        );
      });
    } else if (tool.type === 'progress') {
      // Handle tool_progress heartbeat events from long-running tools
      setActiveMcpCalls(prev => {
        const toolName = tool.name || tool.toolCallId;
        if (!toolName) return prev;
        const exists = prev.some(call => call.name === toolName || call.id === tool.toolCallId);
        if (!exists) {
          // Shouldn't happen but add if missing
          return [...prev, {
            name: toolName,
            status: 'executing',
            progressMessage: tool.message || `Running... ${Math.round((tool.elapsed || 0) / 1000)}s`,
            elapsed: tool.elapsed,
            startTime: Date.now() - (tool.elapsed || 0),
          }];
        }
        return prev.map(call =>
          (call.name === toolName || call.id === tool.toolCallId)
            ? {
                ...call,
                progressMessage: tool.message || `Running... ${Math.round((tool.elapsed || 0) / 1000)}s`,
                elapsed: tool.elapsed,
                startTime: call.startTime || (Date.now() - (tool.elapsed || 0)),
              }
            : call
        );
      });
    } else if (tool.type === 'stream_delta') {
      // Tool argument streaming delta - update args on active tool
      setActiveMcpCalls(prev => {
        return prev.map(call =>
          (call.id === tool.toolCallId)
            ? { ...call, arguments: tool.accumulated || call.arguments }
            : call
        );
      });
    } else if (tool.type === 'tool_call_streaming') {
      // Real-time tool calls during LLM streaming (function calling, e.g., Gemini)
      // These come from tool_call_delta events in the SSE stream
      const streamingCalls = tool.calls || [];
      setActiveMcpCalls(prev => {
        // Merge streaming calls with existing, avoiding duplicates
        const newCalls = [...prev];
        streamingCalls.forEach((streamCall: any) => {
          const existingIdx = newCalls.findIndex(c =>
            c.name === streamCall.name || c.id === streamCall.id
          );
          if (existingIdx >= 0) {
            // Update existing call
            newCalls[existingIdx] = {
              ...newCalls[existingIdx],
              ...streamCall,
              status: streamCall.status || 'running'
            };
          } else {
            // Add new call
            newCalls.push({
              id: streamCall.id,
              name: streamCall.name || streamCall.tool,
              tool: streamCall.tool || streamCall.name,
              status: streamCall.status || 'running',
              arguments: streamCall.args,
              server: 'llm-function-calling'
            });
          }
        });
        return newCalls;
      });
      // Update round if provided (agentic loop tracking)
      if (tool.round && tool.round > 0) {
        setCurrentToolRound(tool.round);
      }
    }
  }, []);

  

  return {
    availableMCPFunctions,
    enabledTools: mcpEnabledTools, // Use MCPContext's enabled tools
    activeMcpCalls,
    currentToolRound, // Current agentic loop round for visual indicator
    loadMCPFunctions,
    handleToggleTool,
    handleToolExecution,
    setActiveMcpCalls
  };
};