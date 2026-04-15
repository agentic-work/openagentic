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



// Barrel exports for Chat components
// Main Chat component exported separately to avoid circular imports
export { default as ChatSidebar } from './ChatSidebar';
export { default as ChatHeader } from './ChatHeader';
export { default as ChatMessages } from './ChatMessages';
export { default as ChatInput } from './ChatInput';
export { default as ChatInputBar } from './ChatInputBar';
export { default as EditableMessage } from './EditableMessage';
export { default as ImageViewer } from './ImageViewer';
export { default as LiveUsagePanel } from './LiveUsagePanel';
export { default as MetricsPanel } from './MetricsPanel';
export { default as PersonalTokenUsage } from './PersonalTokenUsage';
export { default as SettingsDropdown } from './SettingsDropdown';
export { default as ToolsPopup } from './ToolsPopup';
export { default as Tooltip } from './Tooltip';

// Export utilities
export * from './utils';

// Skills System - Anthropic Agent Skills integration
export { SkillSelectorButton, useSkills, BUILT_IN_SKILLS } from './SkillSelector';
export type { Skill, SkillCategory } from './SkillSelector';

// Agentic Activity Stream (structured thinking display)
export { AgenticActivityStream } from './AgenticActivityStream';
export type {
  ContentBlock,
  AgenticTask,
  ToolCall,
  StreamingState,
  ActivitySection,
  ResponseSummary,
  SuggestedAction,
  // InlineStep type now exported from activity.types.ts
  InlineStep,
  DisplayMode,
} from './AgenticActivityStream';