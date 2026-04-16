/**
 * useStreamingParser - Parses Anthropic streaming events
 *
 * Handles content_block_start, content_block_delta, content_block_stop events
 * and builds up the conversation state.
 *
 * State machine:
 * IDLE → message_start → STREAMING
 *   → content_block_start (text) → STREAMING_TEXT
 *   → content_block_start (tool_use) → TOOL_CALLING
 *   → content_block_start (thinking) → THINKING
 *
 * → content_block_delta → accumulate content
 * → content_block_stop → finalize block
 * → message_delta (stop_reason: end_turn) → COMPLETE
 * → message_delta (stop_reason: tool_use) → TOOL_EXECUTING (wait for results)
 */

import { useCallback, useRef, useState } from 'react';
import type {
  StreamingEvent,
  UIState,
  ToolStep,
  StepsContainer,
  ConversationMessage,
  TextDelta,
  ToolInputDelta,
  ThinkingDelta,
  StopReason,
} from '../types/anthropic-blocks';
import {
  getToolDisplayName,
  getToolIcon,
  getInputPreview,
} from '../types/anthropic-blocks';

// Re-export the helper functions
export * from '../types/anthropic-blocks';

interface StreamingState {
  /** Current UI state */
  uiState: UIState;
  /** Streaming text content */
  textContent: string;
  /** Streaming thinking content */
  thinkingContent: string;
  /** Current tool steps */
  steps: ToolStep[];
  /** Accumulated partial JSON for tool inputs */
  partialToolInputs: Map<number, string>;
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** Stop reason when complete */
  stopReason?: StopReason;
  /** Error message if any */
  error?: string;
}

interface StreamingParserResult {
  /** Current streaming state */
  state: StreamingState;
  /** Process a streaming event */
  processEvent: (event: StreamingEvent) => void;
  /** Process a tool result (when tool execution completes) */
  processToolResult: (toolId: string, result: string, isError?: boolean) => void;
  /** Reset state for new turn */
  reset: () => void;
  /** Get the current message as a ConversationMessage */
  getMessage: () => ConversationMessage | null;
  /** Get steps container */
  getStepsContainer: () => StepsContainer;
}

const initialState: StreamingState = {
  uiState: 'IDLE',
  textContent: '',
  thinkingContent: '',
  steps: [],
  partialToolInputs: new Map(),
  usage: {
    inputTokens: 0,
    outputTokens: 0,
  },
};

export function useStreamingParser(): StreamingParserResult {
  const [state, setState] = useState<StreamingState>(initialState);
  const messageIdRef = useRef<string>('');
  const blockIndexRef = useRef<number>(-1);

  // Reset state for new turn
  const reset = useCallback(() => {
    setState(initialState);
    messageIdRef.current = '';
    blockIndexRef.current = -1;
  }, []);

  // Process a streaming event
  const processEvent = useCallback((event: StreamingEvent) => {
    setState((prev) => {
      switch (event.type) {
        case 'message_start': {
          messageIdRef.current = event.message.id;
          return {
            ...prev,
            uiState: 'STREAMING_TEXT' as UIState,
            usage: {
              inputTokens: event.message.usage.input_tokens,
              outputTokens: event.message.usage.output_tokens,
              cacheRead: event.message.usage.cache_read_input_tokens,
              cacheWrite: event.message.usage.cache_creation_input_tokens,
            },
          };
        }

        case 'content_block_start': {
          blockIndexRef.current = event.index;
          const block = event.content_block;

          if (block.type === 'thinking') {
            return {
              ...prev,
              uiState: 'THINKING' as UIState,
            };
          }

          if (block.type === 'tool_use' && block.id && block.name) {
            const toolStep: ToolStep = {
              id: block.id,
              name: block.name,
              displayName: getToolDisplayName(block.name),
              icon: getToolIcon(block.name),
              input: {},
              inputPreview: '',
              status: 'pending',
              startTime: Date.now(),
              isCollapsed: true,
            };

            return {
              ...prev,
              uiState: 'TOOL_CALLING' as UIState,
              steps: [...prev.steps, toolStep],
              partialToolInputs: new Map(prev.partialToolInputs).set(event.index, ''),
            };
          }

          // text block
          return {
            ...prev,
            uiState: 'STREAMING_TEXT' as UIState,
          };
        }

        case 'content_block_delta': {
          const delta = event.delta;

          if (delta.type === 'text_delta') {
            return {
              ...prev,
              textContent: prev.textContent + (delta as TextDelta).text,
            };
          }

          if (delta.type === 'thinking_delta') {
            return {
              ...prev,
              thinkingContent: prev.thinkingContent + (delta as ThinkingDelta).thinking,
            };
          }

          if (delta.type === 'input_json_delta') {
            const partialJson = (delta as ToolInputDelta).partial_json;
            const newPartials = new Map(prev.partialToolInputs);
            const existing = newPartials.get(event.index) || '';
            newPartials.set(event.index, existing + partialJson);
            return {
              ...prev,
              partialToolInputs: newPartials,
            };
          }

          return prev;
        }

        case 'content_block_stop': {
          // Finalize tool input if this was a tool_use block
          const partialJson = prev.partialToolInputs.get(event.index);
          if (partialJson) {
            try {
              const input = JSON.parse(partialJson);
              const stepIndex = prev.steps.findIndex(
                (s) => s.status === 'pending' && !s.input
              );
              if (stepIndex >= 0 || prev.steps.length > 0) {
                const lastStepIndex = stepIndex >= 0 ? stepIndex : prev.steps.length - 1;
                const newSteps = [...prev.steps];
                newSteps[lastStepIndex] = {
                  ...newSteps[lastStepIndex],
                  input,
                  inputPreview: getInputPreview(newSteps[lastStepIndex].name, input),
                  status: 'executing',
                };
                return {
                  ...prev,
                  steps: newSteps,
                  uiState: 'TOOL_EXECUTING' as UIState,
                };
              }
            } catch (e) {
              console.error('Failed to parse tool input:', e);
            }
          }

          return prev;
        }

        case 'message_delta': {
          const stopReason = event.delta.stop_reason;
          let newUIState: UIState = prev.uiState;

          if (stopReason === 'end_turn') {
            newUIState = 'COMPLETE';
          } else if (stopReason === 'tool_use') {
            newUIState = 'TOOL_EXECUTING';
          }

          return {
            ...prev,
            uiState: newUIState,
            stopReason,
            usage: {
              ...prev.usage,
              outputTokens: prev.usage.outputTokens + event.usage.output_tokens,
            },
          };
        }

        case 'message_stop': {
          return {
            ...prev,
            uiState: prev.stopReason === 'tool_use' ? 'TOOL_EXECUTING' : 'COMPLETE',
          };
        }

        default:
          return prev;
      }
    });
  }, []);

  // Process a tool result
  const processToolResult = useCallback(
    (toolId: string, result: string, isError = false) => {
      setState((prev) => {
        const stepIndex = prev.steps.findIndex((s) => s.id === toolId);
        if (stepIndex < 0) return prev;

        const newSteps = [...prev.steps];
        newSteps[stepIndex] = {
          ...newSteps[stepIndex],
          status: isError ? 'error' : 'success',
          result: {
            content: result,
            isError,
            preview: result.split('\n').length > 1
              ? `${result.split('\n').length} lines`
              : result.length > 60
              ? result.slice(0, 60) + '...'
              : result,
          },
          endTime: Date.now(),
          duration: Date.now() - newSteps[stepIndex].startTime,
        };

        // Check if all tools are complete
        const allComplete = newSteps.every(
          (s) => s.status === 'success' || s.status === 'error'
        );

        return {
          ...prev,
          steps: newSteps,
          uiState: allComplete ? 'TOOL_RESULT' : 'TOOL_EXECUTING',
        };
      });
    },
    []
  );

  // Get the current message
  const getMessage = useCallback((): ConversationMessage | null => {
    if (state.uiState === 'IDLE') return null;

    return {
      id: messageIdRef.current || `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date(),
      textContent: state.textContent || undefined,
      thinkingContent: state.thinkingContent || undefined,
      steps:
        state.steps.length > 0
          ? {
              steps: state.steps,
              isCollapsed: false,
              totalCount: state.steps.length,
              completedCount: state.steps.filter(
                (s) => s.status === 'success'
              ).length,
              pendingCount: state.steps.filter(
                (s) => s.status === 'pending' || s.status === 'executing'
              ).length,
              errorCount: state.steps.filter((s) => s.status === 'error')
                .length,
            }
          : undefined,
      isStreaming: state.uiState !== 'COMPLETE' && state.uiState !== 'ERROR',
      usage: state.usage,
    };
  }, [state]);

  // Get steps container
  const getStepsContainer = useCallback((): StepsContainer => {
    return {
      steps: state.steps,
      isCollapsed: false,
      totalCount: state.steps.length,
      completedCount: state.steps.filter((s) => s.status === 'success').length,
      pendingCount: state.steps.filter(
        (s) => s.status === 'pending' || s.status === 'executing'
      ).length,
      errorCount: state.steps.filter((s) => s.status === 'error').length,
    };
  }, [state.steps]);

  return {
    state,
    processEvent,
    processToolResult,
    reset,
    getMessage,
    getStepsContainer,
  };
}

export default useStreamingParser;
