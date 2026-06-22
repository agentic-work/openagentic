/**
 * Hook to fetch available workflow nodes from backend
 * Connects to openagenticflows microservice /api/nodes endpoint
 */
/* eslint-disable no-restricted-syntax -- Node type colors are intentional category indicators */

import { useState, useEffect } from 'react';
import { workflowEndpoint, getWorkflowsApiUrl } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';
import type { NodeTypeConfig, NodeType } from '../types/workflow.types';

interface BackendNode {
  name: string;
  label: string;
  description: string;
  category: string;
  version: number;
  icon?: string;
  color?: string;
  inputs?: any[];
  outputs?: any[];
  parameters?: any[];
}

interface BackendNodesResponse {
  nodes: BackendNode[];
  total: number;
  categories: string[];
}

/**
 * Map backend node category to our NodeType
 */
function mapNodeType(backendCategory: string, nodeName: string): NodeType {
  // Map based on node name
  if (nodeName.toLowerCase().includes('openai') || nodeName.toLowerCase().includes('chatmodel')) {
    return 'llm_completion';
  }
  if (nodeName.toLowerCase().includes('mcp') || nodeName.toLowerCase().includes('tool')) {
    return 'mcp_tool';
  }
  if (nodeName.toLowerCase().includes('http') || nodeName.toLowerCase().includes('request')) {
    return 'code'; // We'll use code type for HTTP requests
  }

  // Default mappings by category
  const categoryMap: Record<string, NodeType> = {
    'chatmodels': 'llm_completion',
    'tools': 'mcp_tool',
    'utilities': 'code',
    'triggers': 'trigger',
    'conditions': 'condition',
    'loops': 'loop',
    'transforms': 'transform',
    'merges': 'merge',
  };

  return categoryMap[backendCategory.toLowerCase()] || 'code';
}

/**
 * Get icon for node type
 */
function getIconForType(type: NodeType, nodeName: string): string {
  if (nodeName.toLowerCase().includes('openai')) return '🤖';
  if (nodeName.toLowerCase().includes('mcp')) return '🔧';
  if (nodeName.toLowerCase().includes('http')) return '🌐';

  const iconMap: Partial<Record<NodeType, string>> = {
    'trigger': '⚡',
    'mcp_tool': '🔧',
    'llm_completion': '🤖',
    'code': '💻',
    'condition': '🔀',
    'loop': '🔁',
    'transform': '🔄',
    'merge': '⛙',
    'wait': '⏳',
    'openagentic': '💻',
    'openagentic_llm': '✨',
    'multi_agent': '🎯',
    'http_request': '🌐',
    'approval': '✅',
    'human_approval': '🙋',
    'agent_spawn': '🤖',
    'a2a': '🔗',
    'synth': '🧪',
  };

  return iconMap[type] || '📦';
}

/**
 * Get color for node type
 */
function getColorForType(type: NodeType): string {
  // theme-allow: node-TYPE identity color map (categorical scale, same carve-out as
  // the workflow node-type palette); mixed with semantic tokens where they align.
  const colorMap: Partial<Record<NodeType, string>> = {
    'trigger': 'var(--color-warning)',
    'mcp_tool': 'var(--color-info)',
    'llm_completion': '#8b5cf6',
    'code': 'var(--color-success)',
    'condition': '#ec4899',
    'loop': 'var(--color-info)',
    'transform': 'var(--color-warning)',
    'merge': '#84cc16',
    'wait': 'var(--color-warning)',
    'openagentic': 'var(--color-success)',
    'openagentic_llm': '#8b5cf6',
    'multi_agent': '#7c3aed',
    'http_request': 'var(--color-info)',
    'approval': 'var(--color-success)',
    'human_approval': 'var(--color-success)',
    'agent_spawn': '#8b5cf6',
    'a2a': '#6366f1',
    'synth': '#ec4899',
  };

  return colorMap[type] || 'var(--color-fg-subtle)';
}

/**
 * Convert backend node to UI NodeTypeConfig
 */
function convertBackendNode(backendNode: BackendNode): NodeTypeConfig {
  const nodeType = mapNodeType(backendNode.category, backendNode.name);
  const icon = backendNode.icon || getIconForType(nodeType, backendNode.name);
  const color = backendNode.color || getColorForType(nodeType);

  // Create default data based on node type and parameters
  const defaultData: any = {
    label: backendNode.label,
  };

  // Add type-specific default data
  if (nodeType === 'llm_completion') {
    defaultData.model = '';
    defaultData.temperature = 0.7;
    defaultData.maxTokens = 2000;
    defaultData.prompt = '';
    defaultData.systemPrompt = '';
  } else if (nodeType === 'mcp_tool') {
    defaultData.toolName = '';
    defaultData.toolServer = '';
    defaultData.arguments = {};
  } else if (nodeType === 'code') {
    defaultData.code = '';
    defaultData.language = 'javascript';
  }

  return {
    type: nodeType,
    label: backendNode.label,
    description: backendNode.description,
    icon,
    color,
    category: backendNode.category.toLowerCase() as any,
    defaultData,
  };
}

export const useBackendNodes = () => {
  const { getAuthHeaders } = useAuth();
  const [nodeConfigs, setNodeConfigs] = useState<Record<string, NodeTypeConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNodes();
  }, []);

  const fetchNodes = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers = getAuthHeaders();

      // Fetch nodes from backend (openagenticflows service)
      // The workflows service exposes /api/nodes directly at port 3002
      const workflowsApiUrl = getWorkflowsApiUrl();

      // Skip fetch if workflows API is not configured (localhost means not available in production)
      // The openagenticflows microservice is optional - use fallback node configs
      if (!workflowsApiUrl || workflowsApiUrl.includes('localhost')) {
        console.info('Workflows API not configured, using default node types');
        setNodeConfigs({});
        setLoading(false);
        return;
      }

      const response = await fetch(`${workflowsApiUrl}/nodes`, {
        headers,
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch nodes: ${response.statusText}`);
      }

      const data: BackendNodesResponse = await response.json();

      // Convert backend nodes to UI node configs
      const configs: Record<string, NodeTypeConfig> = {};

      for (const backendNode of (data.nodes || [])) {
        const config = convertBackendNode(backendNode);
        // Use the backend node name as the key
        configs[backendNode.name] = config;
      }

      setNodeConfigs(configs);
    } catch (err: any) {
      // Don't log network errors as errors - the workflows service is optional
      console.info('Backend nodes not available, using default node types:', err.message);
      setError(null); // Clear error - this is expected behavior
      setNodeConfigs({});
    } finally {
      setLoading(false);
    }
  };

  return {
    nodeConfigs,
    loading,
    error,
    refetch: fetchNodes,
  };
};
