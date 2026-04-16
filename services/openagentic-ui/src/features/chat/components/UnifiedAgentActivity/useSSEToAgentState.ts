import { useCallback, useMemo } from 'react';
import { useAgentState } from './useAgentState';
import type { MultiModelEvent } from '../../hooks/useSSEChat';

interface ToolExecutionEvent {
  type: 'start' | 'executing' | 'result' | 'error' | 'complete' | 'mcp_calls_data' | 'clear_all' | 'stream_ended' | 'progress';
  tools?: Array<{ name: string; arguments?: unknown }>;
  name?: string;
  arguments?: unknown;
  result?: unknown;
  error?: string;
  executionTimeMs?: number;
  successCount?: number;
  errorCount?: number;
  round?: number;
  // Progress heartbeat fields
  toolCallId?: string;
  elapsed?: number;
  message?: string;
  // Agent event forwarding fields
  agentEvent?: string;
  agentId?: string;
  agentRole?: string;
  calls?: Array<{
    name?: string;
    toolName?: string;
    arguments?: unknown;
    serverId?: string;
    serverName?: string;
    status?: string;
  }>;
}

export function useSSEToAgentState() {
  // Destructure stable functions from useAgentState
  const {
    state,
    reset: resetState,
    startStream,
    startThinking,
    updateThinking,
    completeThinking,
    startToolExecution,
    setToolExecuting,
    setToolResult,
    completeToolExecution,
    markToolsAbandoned,
    updateToolProgress,
    modelHandoff,
    startMultiModel,
    completeMultiModel,
    addContentDelta,
    setError,
    completeStream,
    isActive,
    isThinking,
    isToolExecuting,
    isStreaming
  } = useAgentState();

  // Handler for stream start (called when sendMessage is initiated)
  const onStreamStart = useCallback((messageId: string, model?: string) => {
    startStream(messageId, model);
  }, [startStream]);

  // Handler for thinking events
  const onThinking = useCallback((status: string) => {
    startThinking(status);
  }, [startThinking]);

  // Handler for thinking content (streaming thinking text)
  const onThinkingContent = useCallback((content: string, tokens?: number) => {
    updateThinking(content, tokens);
  }, [updateThinking]);

  // Handler for thinking complete
  const onThinkingComplete = useCallback(() => {
    completeThinking();
  }, [completeThinking]);

  // Handler for tool execution events
  const onToolExecution = useCallback((event: ToolExecutionEvent) => {
    switch (event.type) {
      case 'start':
        if (event.tools) {
          startToolExecution(event.tools, event.round || 1);
        }
        break;

      case 'executing':
        if (event.name) {
          setToolExecuting(event.name, event.arguments);
        }
        break;

      case 'result':
        if (event.name) {
          setToolResult(event.name, event.result, undefined, event.executionTimeMs);
        }
        break;

      case 'error':
        if (event.name) {
          setToolResult(event.name, undefined, event.error, event.executionTimeMs);
        }
        break;

      case 'complete':
        completeToolExecution(event.round || 1, event.successCount || 0, event.errorCount || 0);
        break;

      case 'mcp_calls_data':
        // Handle MCP calls data - add each as a tool
        if (event.calls) {
          for (const call of event.calls) {
            const toolName = call.name || call.toolName || 'Unknown Tool';
            if (call.status === 'completed') {
              setToolResult(toolName, call);
            } else {
              setToolExecuting(toolName, call.arguments, call.serverId, call.serverName);
            }
          }
        }
        break;

      case 'stream_ended':
        // Stream died without explicit done/stream_complete — mark in-flight tools as abandoned
        markToolsAbandoned();
        break;

      case 'progress':
        // Heartbeat progress update for a running tool
        if (event.name) {
          updateToolProgress(event.name, event.message || `Executing... (${event.elapsed || 0}s)`, event.elapsed);
        }
        break;

      case 'clear_all':
        resetState();
        break;
    }
  }, [startToolExecution, setToolExecuting, setToolResult, completeToolExecution, markToolsAbandoned, updateToolProgress, resetState]);

  // Handler for multi-model events
  const onMultiModel = useCallback((event: MultiModelEvent) => {
    console.log('[AgentState] Multi-model event:', event.type, event);
    switch (event.type) {
      case 'agent_spawn_plan':
        // Multi-agent spawn plan — start orchestration with agent roles
        if (event.agents && event.agents.length > 0) {
          const roles = event.agents.map(a => `${a.role} (${a.agentId})`);
          startMultiModel(event.agents[0]?.agentId || 'spawn', roles);
          startThinking(`Spawning ${event.agents.length} parallel agents...`);
        }
        break;

      case 'start':
        if (event.orchestrationId) {
          // executionPlan is string[] (array of role names) from useSSEChat.MultiModelEvent
          const roles = Array.isArray(event.executionPlan) ? event.executionPlan : (event.executionPlan as any)?.roles || [];
          startMultiModel(event.orchestrationId, roles);
        }
        break;

      case 'role_start':
        // A specific role started - show as thinking/processing
        if (event.role && event.model) {
          console.log('[AgentState] Role started:', event.role, 'using', event.model);
          startThinking(`${event.role}: ${event.model}`);
        }
        break;

      case 'role_thinking':
        // Thinking content from a role
        if (event.content) {
          updateThinking(event.content);
        }
        break;

      case 'role_complete':
        // A role completed
        console.log('[AgentState] Role completed:', event.role);
        completeThinking();
        break;

      case 'handoff':
        // Model handoff - use fromRole/toRole if available, fallback to fromModel/toModel
        const fromRole = event.fromRole || event.fromModel || 'unknown';
        const toRole = event.toRole || event.toModel || 'unknown';
        if (fromRole && toRole) {
          modelHandoff(fromRole, toRole, event.role || 'handoff');
        }
        break;

      case 'complete':
        completeMultiModel(event.rolesExecuted || [], event.totalCost);
        break;

      case 'error':
        setError(event.error || 'Multi-model orchestration failed', 'ORCHESTRATION_ERROR');
        break;
    }
  }, [startMultiModel, modelHandoff, completeMultiModel, startThinking, updateThinking, completeThinking, setError]);

  // Handler for content delta (text streaming)
  const onContentDelta = useCallback((content: string) => {
    addContentDelta(content);
  }, [addContentDelta]);

  // Handler for errors
  const onError = useCallback((error: Error) => {
    setError(error.message, error.name);
  }, [setError]);

  // Handler for stream complete
  const onStreamComplete = useCallback((metrics?: Record<string, unknown>) => {
    completeStream(metrics);
  }, [completeStream]);

  // Handler for pipeline stage changes
  const onPipelineStage = useCallback((stage: string, data?: { model?: string; complete?: boolean }) => {
    // Map pipeline stages to agent phases
    if (stage === 'response' && data?.complete) {
      completeStream();
    }
  }, [completeStream]);

  // Reset state on unmount or session change
  const reset = useCallback(() => {
    resetState();
  }, [resetState]);

  // Memoize handlers to prevent unnecessary re-renders
  const handlers = useMemo(() => ({
    onStreamStart,
    onThinking,
    onThinkingContent,
    onThinkingComplete,
    onToolExecution,
    onMultiModel,
    onContentDelta,
    onError,
    onStreamComplete,
    onPipelineStage
  }), [
    onStreamStart,
    onThinking,
    onThinkingContent,
    onThinkingComplete,
    onToolExecution,
    onMultiModel,
    onContentDelta,
    onError,
    onStreamComplete,
    onPipelineStage
  ]);

  return {
    // Handlers to pass to useSSEChat (memoized)
    handlers,

    // Direct state access
    state,

    // Derived state
    isActive,
    isThinking,
    isToolExecuting,
    isStreaming,

    // Actions
    reset
  };
}

export type SSEToAgentStateHook = ReturnType<typeof useSSEToAgentState>;
