/**
 * useAgentExecution - SSE hook for live agent execution streaming.
 *
 * Connects to openagentic-proxy's /api/agents/stream/:executionId and
 * parses events into a timeline state that ExecutionPanel can render.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NodeExecution, ExecutionData } from '../components/ExecutionPanel';
import { parseNDJSONStream } from '@/utils/ndjsonStream';

export interface AgentEvent {
  type: 'agent_start' | 'agent_complete' | 'agent_error' | 'tool_call' | 'llm_chunk' | 'execution_complete';
  agentId: string;
  agentRole?: string;
  toolName?: string;
  data?: any;
  timestamp: number;
}

interface UseAgentExecutionOpts {
  executionId: string | null;
  openagenticProxyUrl?: string;
  token?: string;
}

export function useAgentExecution({ executionId, openagenticProxyUrl, token }: UseAgentExecutionOpts) {
  const [execution, setExecution] = useState<ExecutionData | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const disconnect = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (!executionId) {
      disconnect();
      return;
    }

    const baseUrl = openagenticProxyUrl || '/api/agents';
    const url = `${baseUrl}/stream/${executionId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    const abort = new AbortController();
    abortRef.current = abort;

    const startTime = Date.now();
    const nodeMap = new Map<string, NodeExecution>();

    (async () => {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/x-ndjson' },
          signal: abort.signal,
        });
        setIsConnected(true);

        for await (const raw of parseNDJSONStream(resp)) {
          const event = raw as unknown as AgentEvent;
          setEvents(prev => [...prev, event]);

          switch (event.type) {
            case 'agent_start': {
              const nodeId = event.agentId;
              nodeMap.set(nodeId, {
                nodeId,
                nodeLabel: event.agentRole || event.agentId,
                nodeType: 'agent',
                status: 'running',
                startTime: event.timestamp - startTime,
              });
              break;
            }
            case 'tool_call': {
              const parentId = event.agentId;
              const toolNodeId = `${parentId}_tool_${event.toolName}`;
              nodeMap.set(toolNodeId, {
                nodeId: toolNodeId,
                nodeLabel: event.toolName || 'tool',
                nodeType: 'tool',
                status: 'running',
                startTime: event.timestamp - startTime,
                input: event.data?.arguments,
              });
              break;
            }
            case 'agent_complete': {
              const node = nodeMap.get(event.agentId);
              if (node) {
                node.status = 'completed';
                node.duration = event.timestamp - startTime - (node.startTime || 0);
                node.output = event.data?.result;
                node.tokens = event.data?.tokensUsed;
              }
              for (const [key, n] of nodeMap) {
                if (key.startsWith(`${event.agentId}_tool_`) && n.status === 'running') {
                  n.status = 'completed';
                  n.duration = event.timestamp - startTime - (n.startTime || 0);
                }
              }
              break;
            }
            case 'agent_error': {
              const errNode = nodeMap.get(event.agentId);
              if (errNode) {
                errNode.status = 'failed';
                errNode.error = event.data?.error || 'Unknown error';
                errNode.duration = event.timestamp - startTime - (errNode.startTime || 0);
              }
              break;
            }
            case 'execution_complete':
              disconnect();
              return;
          }

          const nodeExecutions = Array.from(nodeMap.values());
          const allDone = nodeExecutions.every(n => n.status === 'completed' || n.status === 'failed');
          const hasFailed = nodeExecutions.some(n => n.status === 'failed');

          setExecution({
            executionId: executionId!,
            status: allDone ? (hasFailed ? 'failed' : 'completed') : 'running',
            startedAt: new Date(startTime).toISOString(),
            completedAt: allDone ? new Date().toISOString() : undefined,
            totalDuration: Date.now() - startTime,
            nodeExecutions,
            totalTokens: nodeExecutions.reduce((sum, n) => sum + (n.tokens || 0), 0),
          });
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setIsConnected(false);
        }
      }
    })();

    return () => disconnect();
  }, [executionId, openagenticProxyUrl, token, disconnect]);

  return { execution, events, isConnected, disconnect };
}
