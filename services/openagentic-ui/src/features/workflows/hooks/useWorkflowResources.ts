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
 * Hook to fetch available workflow resources (LLM models, MCP tools)
 */

import { useState, useEffect } from 'react';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';

export interface MCPTool {
  name: string;
  server: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: string[]; default?: any }>;
    required?: string[];
  };
}

export const useWorkflowResources = () => {
  const { getAuthHeaders } = useAuth();
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableTools, setAvailableTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchResources();
  }, []);

  const fetchResources = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers = getAuthHeaders();

      // Fetch available LLM models
      const modelsResponse = await fetch(apiEndpoint('/models'), {
        headers,
      });

      if (modelsResponse.ok) {
        const modelsData = await modelsResponse.json();
        // Extract model IDs from the response
        const models = modelsData.models?.map((m: any) => m.id || m.model || m) || [];
        setAvailableModels(models);
      }

      // Fetch available MCP tools
      const toolsResponse = await fetch(apiEndpoint('/v1/mcp/tools'), {
        headers,
      });

      if (toolsResponse.ok) {
        const toolsData = await toolsResponse.json();

        // Parse MCP tools from response
        const tools: MCPTool[] = [];

        if (toolsData.tools) {
          if (Array.isArray(toolsData.tools)) {
            // Flat array format: { tools: [{ server, name, description, inputSchema }] }
            toolsData.tools.forEach((tool: any) => {
              tools.push({
                name: tool.name,
                server: tool.server || 'unknown',
                description: tool.description || tool.inputSchema?.description,
                inputSchema: tool.inputSchema,
              });
            });
          } else {
            // Grouped format: { tools: { serverName: [{ name, description }] } }
            Object.entries(toolsData.tools).forEach(([server, serverTools]: [string, any]) => {
              if (Array.isArray(serverTools)) {
                serverTools.forEach((tool: any) => {
                  tools.push({
                    name: tool.name,
                    server,
                    description: tool.description || tool.inputSchema?.description,
                    inputSchema: tool.inputSchema,
                  });
                });
              }
            });
          }
        }

        setAvailableTools(tools);
      }
    } catch (err: any) {
      console.error('Failed to fetch workflow resources:', err);
      setError(err.message || 'Failed to load resources');
    } finally {
      setLoading(false);
    }
  };

  return {
    availableModels,
    availableTools,
    loading,
    error,
    refetch: fetchResources,
  };
};
