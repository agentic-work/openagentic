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
export {
  MCPManagementView,
  MCPAccessControlView,
  MCPToolsView,
  MCPInspectorView,
  MCPCallLogsView
} from './MCP';

// Content - Prompts, templates, pipeline
// PromptTemplateManager RIPPED 2026-05-11 (chatmode-rip Phase E final cleanup).
export {
  PipelineSettingsView,
  PromptMetrics
} from './Content';

// Monitoring - Analytics, logs, metrics
export {
  MonitoringView,
  UsageAnalytics,
  ContextWindowMetrics,
  EmbeddingMetrics,
  PerformanceMetrics,
  FeedbackAnalyticsView,
  AuditLogsView,
  CodeModeMetricsDashboard
} from './Monitoring';

// Security - Rate limits, API tokens
export { RateLimitsView, DeveloperAPIView } from './Security';

// Code - Code mode management (legacy)
export { AWCodeSessionsView, AWCodeSettingsView } from './Code';

// CodeMode - New admin section (replaces Openagentic)
export { CodeModeSettingsView, CodeModeMcpView, CodeModeSkillsView, CodeModeUsersView, CodeModeGlobalSettingsView } from './CodeMode';

// Prompts — Phase E.6 (2026-05-10) ripped the composable prompt-module
// admin surface alongside PromptComposer/PromptModuleRegistry. Only the
// effectiveness analytics view remains.
export { EffectivenessView } from './Prompts/EffectivenessView';

// System Configuration
export { DefaultModelsView } from './SystemConfiguration';

