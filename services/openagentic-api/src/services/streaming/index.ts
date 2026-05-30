/**
 * OpenAgentic Streaming Services
 *
 * Unified streaming normalization for all LLM providers.
 */

export {
  ActivityStreamNormalizer,
  activityNormalizer,
  type ActivitySession,
  type ProviderCapabilities,
  type ThinkingMode,
  type StopReason,
  type ActivityStartEvent,
  type ThinkingStartEvent,
  type ThinkingDeltaEvent,
  type ThinkingCompleteEvent,
  type ContentDeltaEvent,
  type ToolStartEvent,
  type ToolDeltaEvent,
  type ToolCompleteEvent,
  type ToolResultEvent,
  type ModelInfoEvent,
  type MetricsUpdateEvent,
  type ActivityCompleteEvent,
  type ActivityEvent
} from './ActivityStreamNormalizer.js';
