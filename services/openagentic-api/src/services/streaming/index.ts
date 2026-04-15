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
