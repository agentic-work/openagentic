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
 * Chat Streaming Store
 * Centralized state management for streaming, thinking, and CoT display
 * Handles all state that changes during message streaming
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

export type StreamingStatus = 'idle' | 'streaming' | 'thinking' | 'tool_use' | 'error';

export interface CoTStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'reasoning';
  content: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  duration?: number;
}

interface ChatStreamingState {
  // Content being streamed
  streamingContent: string;
  currentPrompt: string;

  // Status
  streamingStatus: StreamingStatus;
  errorMessage: string | null;

  // Thinking/CoT state
  realtimeCoTSteps: CoTStep[];
  currentCoTData: any;
  thinkingStartTime: number | null;
  thinkingTime: number;

  // Model info
  currentModel: string | null;
}

interface ChatStreamingActions {
  // Start streaming a new message
  startStreaming: (prompt: string) => void;

  // Append content delta
  appendContent: (delta: string) => void;

  // Set content directly (for non-delta updates)
  setContent: (content: string) => void;

  // Thinking state
  startThinking: () => void;
  stopThinking: () => void;
  addCoTStep: (step: Omit<CoTStep, 'id' | 'timestamp'>) => void;
  setCoTData: (data: any) => void;
  clearCoTSteps: () => void;

  // Status updates
  setStatus: (status: StreamingStatus) => void;
  setError: (error: string | null) => void;

  // Model tracking
  setCurrentModel: (model: string | null) => void;

  // Finish streaming (success)
  finishStreaming: () => void;

  // Reset all streaming state
  reset: () => void;
}

type ChatStreamingStore = ChatStreamingState & ChatStreamingActions;

const initialState: ChatStreamingState = {
  streamingContent: '',
  currentPrompt: '',
  streamingStatus: 'idle',
  errorMessage: null,
  realtimeCoTSteps: [],
  currentCoTData: null,
  thinkingStartTime: null,
  thinkingTime: 0,
  currentModel: null,
};

export const useChatStreamingStore = create<ChatStreamingStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      startStreaming: (prompt) =>
        set(
          {
            streamingContent: '',
            currentPrompt: prompt,
            streamingStatus: 'streaming',
            errorMessage: null,
            realtimeCoTSteps: [],
            currentCoTData: null,
            thinkingStartTime: null,
            thinkingTime: 0,
          },
          false,
          'startStreaming'
        ),

      appendContent: (delta) =>
        set(
          (state) => ({
            streamingContent: state.streamingContent + delta,
          }),
          false,
          'appendContent'
        ),

      setContent: (content) =>
        set(
          { streamingContent: content },
          false,
          'setContent'
        ),

      startThinking: () =>
        set(
          {
            streamingStatus: 'thinking',
            thinkingStartTime: Date.now(),
          },
          false,
          'startThinking'
        ),

      stopThinking: () => {
        const { thinkingStartTime } = get();
        const thinkingTime = thinkingStartTime
          ? Date.now() - thinkingStartTime
          : 0;

        set(
          {
            streamingStatus: 'streaming',
            thinkingTime,
            thinkingStartTime: null,
          },
          false,
          'stopThinking'
        );
      },

      addCoTStep: (step) =>
        set(
          (state) => ({
            realtimeCoTSteps: [
              ...state.realtimeCoTSteps,
              {
                ...step,
                id: `cot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                timestamp: Date.now(),
              },
            ],
          }),
          false,
          'addCoTStep'
        ),

      setCoTData: (data) =>
        set(
          { currentCoTData: data },
          false,
          'setCoTData'
        ),

      clearCoTSteps: () =>
        set(
          { realtimeCoTSteps: [] },
          false,
          'clearCoTSteps'
        ),

      setStatus: (status) =>
        set(
          { streamingStatus: status },
          false,
          'setStatus'
        ),

      setError: (error) =>
        set(
          {
            streamingStatus: error ? 'error' : 'idle',
            errorMessage: error,
          },
          false,
          'setError'
        ),

      setCurrentModel: (model) =>
        set(
          { currentModel: model },
          false,
          'setCurrentModel'
        ),

      finishStreaming: () =>
        set(
          {
            streamingStatus: 'idle',
            currentPrompt: '',
            // Keep streamingContent until next message
            // Keep thinkingTime for display
          },
          false,
          'finishStreaming'
        ),

      reset: () =>
        set(
          initialState,
          false,
          'reset'
        ),
    }),
    { name: 'ChatStreaming' }
  )
);

// Selector hooks
export const useStreamingContent = () =>
  useChatStreamingStore((state) => state.streamingContent);

export const useStreamingStatus = () =>
  useChatStreamingStore((state) => state.streamingStatus);

export const useIsStreaming = () =>
  useChatStreamingStore((state) => state.streamingStatus !== 'idle');

export const useThinkingTime = () =>
  useChatStreamingStore((state) => state.thinkingTime);

export const useCoTSteps = () =>
  useChatStreamingStore(useShallow((state) => state.realtimeCoTSteps));

// Action hooks - use useShallow for object return
export const useStreamingActions = () =>
  useChatStreamingStore(
    useShallow((state) => ({
      startStreaming: state.startStreaming,
      appendContent: state.appendContent,
      setContent: state.setContent,
      startThinking: state.startThinking,
      stopThinking: state.stopThinking,
      addCoTStep: state.addCoTStep,
      setStatus: state.setStatus,
      setError: state.setError,
      finishStreaming: state.finishStreaming,
      reset: state.reset,
    }))
  );
