/**
 * useAgentPlayground - State management for Agent Playground
 *
 * Handles agent listing, selection, task execution, and SSE streaming.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/app/providers/AuthContext';

export interface PlaygroundAgent {
  id: string;
  name: string;
  display_name: string;
  role: string;
  agent_type: string;
  description: string;
  icon?: string;
  category: string;
  enabled: boolean;
  model: string;
  tools: string[];
  skills: string[];
  maxTurns?: number;
  maxToolCalls?: number;
}

export interface ExecutionStep {
  type: 'agent_start' | 'tool_call' | 'tool_result' | 'llm_chunk' | 'agent_complete' | 'agent_error';
  agentId: string;
  agentRole?: string;
  toolName?: string;
  data?: any;
  timestamp: number;
}

export function useAgentPlayground() {
  const { getAuthHeaders } = useAuth();
  const [agents, setAgents] = useState<PlaygroundAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [executing, setExecuting] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  );

  // Fetch agents
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        setLoading(true);
        const headers = getAuthHeaders();
        // Try non-admin agents endpoint first, fall back to admin
        let res = await fetch('/api/agents', { headers });
        if (!res.ok) res = await fetch('/api/workflows/agents', { headers });
        if (!res.ok) res = await fetch('/api/admin/agents', { headers });
        if (res.ok) {
          const data = await res.json();
          const list = (data.agents || []).filter((a: any) => a.enabled !== false);
          setAgents(list);
          if (list.length > 0 && !selectedAgentId) {
            setSelectedAgentId(list[0].id);
          }
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };
    fetchAgents();
  }, [getAuthHeaders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Execute agent task
  const execute = useCallback(async () => {
    if (!selectedAgentId || !task.trim()) return;

    setExecuting(true);
    setSteps([]);
    setResult(null);
    setError(null);
    setExecutionId(null);

    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/agents/${selectedAgentId}/execute`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: task.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Execution failed' }));
        setError(err.error || 'Execution failed');
        setExecuting(false);
        return;
      }

      const data = await res.json();
      const execId = data.executionId;
      setExecutionId(execId);

      // Connect to SSE stream
      const es = new EventSource(`/api/agents/stream/${execId}`);

      es.onmessage = (evt) => {
        try {
          const event: ExecutionStep = JSON.parse(evt.data);
          setSteps(prev => [...prev, event]);

          if (event.type === 'agent_complete') {
            setResult(event.data?.result || JSON.stringify(event.data));
            setExecuting(false);
            es.close();
          } else if (event.type === 'agent_error') {
            setError(event.data?.error || 'Agent encountered an error');
            setExecuting(false);
            es.close();
          }
        } catch { /* skip malformed */ }
      };

      es.onerror = () => {
        setExecuting(false);
        es.close();
      };

      // Timeout after 5 minutes
      setTimeout(() => {
        if (es.readyState !== EventSource.CLOSED) {
          es.close();
          setExecuting(false);
          if (!result && !error) {
            setError('Execution timed out after 5 minutes');
          }
        }
      }, 300000);
    } catch (err: any) {
      setError(err.message || 'Failed to execute agent');
      setExecuting(false);
    }
  }, [selectedAgentId, task, getAuthHeaders, result, error]);

  const reset = useCallback(() => {
    setSteps([]);
    setResult(null);
    setError(null);
    setExecutionId(null);
    setExecuting(false);
  }, []);

  return {
    agents,
    loading,
    selectedAgent,
    selectedAgentId,
    setSelectedAgentId,
    task,
    setTask,
    executing,
    executionId,
    steps,
    result,
    error,
    execute,
    reset,
  };
}
