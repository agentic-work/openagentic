/**
 * Code Mode Hooks
 *
 * V2 Openagentic Style hooks for WebSocket communication and state management
 */

// WebSocket connection for Code Mode
export { useCodeModeWebSocket } from './useCodeModeWebSocket';

// Session persistence and context windowing
export {
  useCodeModeSession,
  type PersistedSession,
  type PersistedMessage,
  type ContextWindow,
  type UseCodeModeSessionOptions,
  type UseCodeModeSessionReturn,
} from './useCodeModeSession';

// State management
export { useCodeModeState, type ConnectionState, type SessionInfo } from './useCodeModeState';

// Streaming message parser
export { useStreamingParser } from './useStreamingParser';

