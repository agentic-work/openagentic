/**
 * useAgentNodes — fetches agent definitions from the api SOT registry
 * (/api/agents) and converts them into NodeTypeConfig entries with
 * category='agents' so they appear alongside other workflow nodes in
 * the NodePalette. Each agent becomes a draggable node that drops onto
 * the canvas as a real flow node (not a side-panel drawer).
 *
 * The /api/agents route merges:
 *   1. openagentic-proxy GET /api/agents/definitions (prompt + tool config)
 *   2. DB admin.agent table (UUIDs + admin overrides)
 *
 * Which makes the api route the single SOT for "what agents exist".
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/providers/AuthContext';
import type { NodeTypeConfig } from '../types/workflow.types';

interface BackendAgent {
  id?: string;
  name: string;
  display_name?: string;
  role?: string;
  agent_type?: string;
  description?: string;
  icon?: string;
  category?: string;
  enabled?: boolean;
  model?: string;
  tools?: string[];
  skills?: string[];
  maxTurns?: number;
  maxToolCalls?: number;
}

interface AgentsResponse {
  agents: BackendAgent[];
}

/**
 * Convert a backend agent definition into a draggable workflow node config.
 * The resulting node lives in category='agents' and uses node type 'agent_spawn'
 * so the existing flow runtime handles execution via openagentic-proxy.
 */
function convertAgentToNodeConfig(agent: BackendAgent): NodeTypeConfig {
  const label = agent.display_name || agent.name || agent.role || 'Agent';
  const roleKey = agent.role || agent.agent_type || agent.name;
  return {
    type: 'agent_spawn',
    label,
    description: agent.description || `Spawn the ${label} agent`,
    icon: agent.icon || '🤖',
    color: '#8b5cf6',
    category: 'agents' as any,
    defaultData: {
      label,
      agentRole: roleKey,
      agentId: agent.id,
      agentName: agent.name,
      agentType: agent.agent_type,
      agentDisplayName: agent.display_name,
      agentDescription: agent.description,
      model: agent.model || 'auto',
      tools: agent.tools || [],
      skills: agent.skills || [],
      maxTurns: agent.maxTurns,
      maxToolCalls: agent.maxToolCalls,
    },
  };
}

export const useAgentNodes = () => {
  const { getAuthHeaders } = useAuth();
  const [agentNodeConfigs, setAgentNodeConfigs] = useState<Record<string, NodeTypeConfig>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
      const response = await fetch('/api/agents', {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch agents: ${response.statusText}`);
      }
      const data: AgentsResponse = await response.json();
      const configs: Record<string, NodeTypeConfig> = {};
      for (const agent of (data.agents || [])) {
        if (agent.enabled === false) continue;
        const key = `agent:${agent.role || agent.agent_type || agent.name}`;
        configs[key] = convertAgentToNodeConfig(agent);
      }
      setAgentNodeConfigs(configs);
    } catch (err: any) {
      console.info('Failed to fetch agent nodes:', err.message);
      setError(err.message);
      setAgentNodeConfigs({});
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return {
    agentNodeConfigs,
    loading,
    error,
    refetch: fetchAgents,
  };
};
