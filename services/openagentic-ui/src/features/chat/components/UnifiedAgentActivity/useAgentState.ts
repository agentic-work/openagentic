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
 * Agent State Hook
 *
 * Manages the state machine for agentic activities including
 * thinking, tool execution, multi-model handoffs, and streaming.
 *
 * @copyright 2026 Gnomus.ai
 */

import { useState, useCallback, useMemo } from 'react';
import type { AgentState, AgentActivity, AgentPhase } from './types';

const initialState: AgentState = {
  phase: 'idle',
  currentRound: 0,
  maxRounds: 10,
  activities: [],
};

let activityCounter = 0;
const generateId = () => `activity-${Date.now()}-${++activityCounter}`;

export function useAgentState() {
  const [state, setState] = useState<AgentState>(initialState);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const startStream = useCallback((messageId: string, model?: string) => {
    setState(prev => ({
      ...prev,
      phase: 'streaming',
      currentModel: model,
      activities: [],
      thinkingContent: undefined,
      thinkingTokens: undefined,
    }));
  }, []);

  const startThinking = useCallback((content?: string) => {
    setState(prev => ({
      ...prev,
      phase: 'thinking',
      thinkingContent: content || '',
    }));
  }, []);

  const updateThinking = useCallback((content: string, tokens?: number) => {
    setState(prev => ({
      ...prev,
      thinkingContent: (prev.thinkingContent || '') + content,
      thinkingTokens: tokens ?? prev.thinkingTokens,
    }));
  }, []);

  const completeThinking = useCallback(() => {
    setState(prev => {
      const activity: AgentActivity = {
        id: generateId(),
        type: 'thinking',
        status: 'complete',
        content: prev.thinkingContent || '',
        timestamp: Date.now(),
      };
      return {
        ...prev,
        phase: 'streaming',
        activities: [...prev.activities, activity],
      };
    });
  }, []);

  const startToolExecution = useCallback((tools: Array<{ name: string; arguments?: unknown }>, round: number) => {
    setState(prev => ({
      ...prev,
      phase: 'tool_executing',
      currentRound: round,
    }));
  }, []);

  const setToolExecuting = useCallback((name: string, args?: unknown, serverId?: string, serverName?: string) => {
    setState(prev => {
      const activity: AgentActivity = {
        id: generateId(),
        type: 'tool_call',
        status: 'executing',
        content: name,
        arguments: args as Record<string, unknown>,
        timestamp: Date.now(),
        round: prev.currentRound,
        serverId,
        serverName,
      };
      return {
        ...prev,
        activities: [...prev.activities, activity],
      };
    });
  }, []);

  const setToolResult = useCallback((name: string, result?: unknown, error?: string, duration?: number) => {
    setState(prev => {
      // Find and update the matching tool_call activity
      const activities = prev.activities.map(act => {
        if (act.type === 'tool_call' && act.content === name && act.status === 'executing') {
          return {
            ...act,
            status: error ? 'error' as const : 'complete' as const,
            result,
            details: error,
            duration,
          };
        }
        return act;
      });
      return { ...prev, activities };
    });
  }, []);

  const completeToolExecution = useCallback((round: number, successCount: number, errorCount: number) => {
    setState(prev => ({
      ...prev,
      phase: 'streaming',
    }));
  }, []);

  const modelHandoff = useCallback((fromModel: string, toModel: string, role: string) => {
    setState(prev => {
      const activity: AgentActivity = {
        id: generateId(),
        type: 'handoff',
        status: 'complete',
        content: `${fromModel} → ${toModel}`,
        details: role,
        timestamp: Date.now(),
      };
      return {
        ...prev,
        currentModel: toModel,
        currentModelRole: role as AgentState['currentModelRole'],
        activities: [...prev.activities, activity],
      };
    });
  }, []);

  const startMultiModel = useCallback((orchestrationId: string, roles: string[]) => {
    setState(prev => ({
      ...prev,
      phase: 'synthesizing',
      orchestrationId,
      rolesExecuted: [],
    }));
  }, []);

  const completeMultiModel = useCallback((rolesExecuted: string[], totalCost?: number) => {
    setState(prev => ({
      ...prev,
      phase: 'complete',
      rolesExecuted,
      totalCost,
    }));
  }, []);

  const addContentDelta = useCallback((content: string) => {
    // Content deltas don't change state machine, just accumulate
  }, []);

  const setError = useCallback((message: string, code?: string) => {
    setState(prev => {
      const activity: AgentActivity = {
        id: generateId(),
        type: 'error',
        status: 'error',
        content: message,
        details: code,
        timestamp: Date.now(),
      };
      return {
        ...prev,
        activities: [...prev.activities, activity],
      };
    });
  }, []);

  const completeStream = useCallback((metrics?: Record<string, unknown>) => {
    setState(prev => ({
      ...prev,
      phase: 'complete',
      totalDuration: metrics?.durationMs as number | undefined,
      totalCost: metrics?.cost as number | undefined,
    }));
  }, []);

  // Mark all in-flight tool calls as abandoned (stream died without proper completion)
  const markToolsAbandoned = useCallback(() => {
    setState(prev => {
      const activities = prev.activities.map(act => {
        if (act.type === 'tool_call' && act.status === 'executing') {
          return { ...act, status: 'abandoned' as const };
        }
        return act;
      });
      return { ...prev, phase: 'complete', activities };
    });
  }, []);

  // Update a tool's progress message (from heartbeat events)
  const updateToolProgress = useCallback((name: string, message: string, elapsed?: number) => {
    setState(prev => {
      const activities = prev.activities.map(act => {
        if (act.type === 'tool_call' && act.content === name && act.status === 'executing') {
          return { ...act, progressMessage: message, progressElapsed: elapsed };
        }
        return act;
      });
      return { ...prev, activities };
    });
  }, []);

  // Derived state
  const isActive = state.phase !== 'idle' && state.phase !== 'complete';
  const isThinking = state.phase === 'thinking';
  const isToolExecuting = state.phase === 'tool_executing';
  const isStreaming = state.phase === 'streaming';

  return {
    state,
    reset,
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
    isStreaming,
  };
}
