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