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
 * UnifiedAgentActivity - Exports
 *
 * Provides types and hooks for agent activity state management.
 * The UnifiedAgentActivity component has been removed - activity is now
 * displayed inline in message bubbles via InlineSteps.
 *
 * @copyright 2026 Gnomus.ai
 */

// Sub-components used by InlineSteps
export { ThinkingSphere } from './ThinkingSphere';

// State management hook - used by ChatContainer
export { useSSEToAgentState, type SSEToAgentStateHook } from './useSSEToAgentState';

// Types - used by ChatMessages, InlineSteps, and other components
export type {
  ActivityType,
  ActivityStatus,
  AgentPhase,
  AgentActivity,
  ActivityRound,
  AgentState,
  AgentEvent,
  UnifiedActivityConfig
} from './types';

export { DEFAULT_CONFIG } from './types';
