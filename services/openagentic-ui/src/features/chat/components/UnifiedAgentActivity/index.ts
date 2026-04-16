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
