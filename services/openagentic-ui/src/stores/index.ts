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

// Export all stores
export { useChatStore, selectActiveSession, selectSessionMessages, selectUserSessions } from './useChatStore';
export { useMCPStore, selectActiveServers, selectToolsByServer, selectRecentExecutions } from './useMCPStore';
export {
  useCodeModeStore,
  useCodeModeConnection,
  useCodeModeActivity,
  useCodeModeMessages,
  useCodeModeTodos,
  useCodeModeSteps,
  useCodeModeSession,
  useCodeModeUsage,
  getRandomMessage,
} from './useCodeModeStore';
export {
  useModelStore,
  useSelectedModel,
  useAvailableModels,
  useIsMultiModelEnabled,
  useIsLoadingModels,
  useModelActions,
} from './useModelStore';
export {
  useChatStreamingStore,
  useStreamingContent,
  useStreamingStatus,
  useIsStreaming,
  useThinkingTime,
  useCoTSteps,
  useStreamingActions,
} from './useChatStreamingStore';
export {
  useUIVisibilityStore,
  useShowMCPIndicators,
  useShowThinkingInline,
  useShowModelBadges,
  useIsSidebarExpanded,
  useUIActions,
} from './useUIVisibilityStore';

// Export types
export type { Message, ChatSession } from './useChatStore';
export type { MCPTool, MCPServer, MCPExecution } from './useMCPStore';
export type {
  ConnectionState,
  ActivityState,
  TodoItem,
  DiffLine,
  ToolStep,
  ConversationMessage,
  CodeSession,
} from './useCodeModeStore';
export type { ModelInfo } from './useModelStore';
export type { StreamingStatus, CoTStep } from './useChatStreamingStore';