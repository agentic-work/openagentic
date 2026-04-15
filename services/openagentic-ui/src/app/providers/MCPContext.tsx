/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * MCP Context - Model Context Protocol Provider
 *
 * Manages MCP tool availability, enabling/disabling, and execution
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';
import { apiEndpoint } from '@/utils/api';

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

export interface MCP {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  tools: MCPTool[];
  status?: 'connected' | 'disconnected';
  icon?: string;
  isConnected?: boolean;
}

interface MCPContextType {
  mcps: MCP[];
  enabledTools: Set<string>;
  toggleServer: (serverId: string) => Promise<void>;
  toggleTool: (toolKey: string) => Promise<void>;
  getMCPTools: (id: string) => MCPTool[];
  executeTool: (mcpId: string, tool: string, parameters: any) => Promise<any>;
  isLoading: boolean;
  error: string | null;
  refreshMCPs: () => Promise<void>;
}

const MCPContext = createContext<MCPContextType | undefined>(undefined);

export const useMCP = () => {
  const context = useContext(MCPContext);
  if (!context) {
    throw new Error('useMCP must be used within an MCPProvider');
  }
  return context;
};

interface MCPProviderProps {
  children: ReactNode;
}

export const MCPProvider: React.FC<MCPProviderProps> = ({ children }) => {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [mcps, setMCPs] = useState<MCP[]>([]);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    // Only load MCPs if user is authenticated
    if (!isAuthenticated) {
      setIsLoading(false);
      return;
    }
    loadMCPs();
  }, [isAuthenticated]);

  const loadMCPs = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const token = await getAccessToken(['api://openagentic/.default']);

      // Call API to fetch available MCP tools
      const response = await axios.get(apiEndpoint('/user/available-tools'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });

      // console.log('[MCPContext] Loaded tools:', response.data);

      // Transform API response to MCP format
      const servers: MCP[] = response.data.servers?.map((server: any) => ({
        id: server.id || server.name,
        name: server.name,
        description: server.description,
        enabled: server.isConnected ?? true,
        tools: server.tools || [],
        status: server.isConnected ? 'connected' : 'disconnected',
        icon: getServerIcon(server.id || server.name),
        isConnected: server.isConnected
      })) || [];

      setMCPs(servers);

      // Initialize all tools as enabled by default
      const allTools = new Set<string>();
      servers.forEach(server => {
        if (server.enabled) {
          allTools.add(server.id);
          server.tools?.forEach(tool => {
            allTools.add(`${server.id}.${tool.name}`);
          });
        }
      });
      setEnabledTools(allTools);

    } catch (err: any) {
      // Suppress 401 errors (expected when not authenticated)
      if (err?.response?.status !== 401) {
        console.error('Failed to load MCPs:', err);
        setError('Failed to load MCP configuration');
      }
      setMCPs([]);
    } finally {
      setIsLoading(false);
    }
  };

  const getServerIcon = (serverId: string): string => {
    const iconMap: Record<string, string> = {
      'azure_mcp': '☁️',
      'sequential_thinking': '🤔',
      'fetch': '🌐',
      'memory': '🧠'
    };
    return iconMap[serverId] || '🔌';
  };

  const toggleServer = async (serverId: string) => {
    try {
      const server = mcps.find(m => m.id === serverId);
      if (!server) return;

      const newEnabled = !server.enabled;

      // Update local state
      setMCPs(prev => prev.map(m =>
        m.id === serverId ? { ...m, enabled: newEnabled } : m
      ));

      // Update enabled tools
      setEnabledTools(prev => {
        const next = new Set(prev);
        if (newEnabled) {
          next.add(serverId);
          server.tools?.forEach(tool => {
            next.add(`${serverId}.${tool.name}`);
          });
        } else {
          next.delete(serverId);
          server.tools?.forEach(tool => {
            next.delete(`${serverId}.${tool.name}`);
          });
        }
        return next;
      });

      // Persist to backend (optional - for user preferences)
      const token = await getAccessToken(['api://openagentic/.default']);
      await axios.post(apiEndpoint('/user/settings/mcp'),
        { serverId, enabled: newEnabled },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      ).catch(err => {
        // Failed to persist MCP setting - non-critical, silently ignore
      });

    } catch (err: any) {
      console.error('Failed to toggle MCP server:', err);
      setError(err.message || 'Failed to toggle MCP server');
    }
  };

  const toggleTool = async (toolKey: string) => {
    try {
      const [serverId, toolName] = toolKey.split('.');
      const server = mcps.find(m => m.id === serverId);

      if (!server || !server.enabled) {
        // console.warn('Cannot toggle tool - server not enabled:', serverId);
        return;
      }

      setEnabledTools(prev => {
        const next = new Set(prev);
        if (next.has(toolKey)) {
          next.delete(toolKey);
        } else {
          next.add(toolKey);
        }
        return next;
      });

      // Persist to backend (optional)
      const token = await getAccessToken(['api://openagentic/.default']);
      await axios.post(apiEndpoint('/user/settings/mcp/tool'),
        { toolKey, enabled: !enabledTools.has(toolKey) },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      ).catch(err => {
        // Failed to persist tool setting - non-critical, silently ignore
      });

    } catch (err) {
      console.error('Failed to toggle tool:', err);
    }
  };

  const getMCPTools = (id: string): MCPTool[] => {
    const mcp = mcps.find(m => m.id === id);
    return mcp ? mcp.tools : [];
  };

  const executeTool = async (mcpId: string, tool: string, parameters: any): Promise<any> => {
    try {
      const mcp = mcps.find(m => m.id === mcpId);
      if (!mcp || !mcp.enabled) {
        throw new Error(`MCP ${mcpId} is not enabled`);
      }

      const token = await getAccessToken(['api://openagentic/.default']);

      // Execute through API which routes to MCP Proxy
      const response = await axios.post(
        apiEndpoint('/chat/mcp/execute'),
        {
          serverId: mcpId,
          tool,
          parameters
        },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );

      return response.data.result;
    } catch (err: any) {
      console.error('Failed to execute MCP tool:', err);
      throw err;
    }
  };

  const refreshMCPs = async () => {
    await loadMCPs();
  };

  return (
    <MCPContext.Provider
      value={{
        mcps,
        enabledTools,
        toggleServer,
        toggleTool,
        getMCPTools,
        executeTool,
        isLoading,
        error,
        refreshMCPs
      }}
    >
      {children}
    </MCPContext.Provider>
  );
};

export { MCPContext };
