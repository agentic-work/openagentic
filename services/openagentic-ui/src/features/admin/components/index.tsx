// Shell - Main admin shell components
export { AdminPortal, AdminUI } from './Shell';
export {
  StatusBadge,
  AdminCard,
  StatCard,
  AdminButton,
  SectionHeader,
  EmptyState,
  Divider,
  Label,
  AdminInput,
  type BadgeVariant,
  type ButtonVariant,
  type ButtonSize,
} from './Shell/AdminUI';

// Shared - Icons and utilities
export { AdminIcon } from './Shared';
export * from './Shared/AdminIcons';

// Overview - Dashboard views
export { DashboardOverview } from './Overview';

// System - User management and settings
export {
  UserPermissionsView,
  UserLockoutView,
  SystemSettingsView,
  AuthAccessControlView
} from './System';

// LLM - Provider and model management
export {
  LLMProviderManagement,
  LLMProvidersView,
  LLMPerformanceMetrics,
  LLMSankeyModal,
  MultiModelConfigView,
  MultiModelSankeyChart,
  OllamaManagementView,
  TieredFCConfigView,
  RouterTuningView
} from './LLM';

// MCP - Model Context Protocol management
// MCPManagementView + MCPAccessControlView retired 2026-06-02 — v3 MCPFleetV3 is
// the single MCP-management + IAM surface (see components/MCP/index.tsx).
export {
  MCPToolsView,
  MCPInspectorView,
  MCPCallLogsView
} from './MCP';

// Content - Prompts, templates, pipeline
// PromptTemplateManager RIPPED 2026-05-11 (the chat-pipeline refactor Phase E final cleanup).
export {
  PipelineSettingsView,
  PromptMetrics
} from './Content';

// Security - API tokens
export { DeveloperAPIView } from './Security';

// Prompts — Phase E.6 (2026-05-10) ripped the composable prompt-module
// admin surface alongside PromptComposer/PromptModuleRegistry. Only the
// effectiveness analytics view remains.
export { EffectivenessView } from './Prompts/EffectivenessView';

// System Configuration
export { DefaultModelsView } from './SystemConfiguration';

