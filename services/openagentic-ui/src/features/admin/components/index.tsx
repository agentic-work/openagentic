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
export { DashboardOverview, AnalyticsDashboard } from './Overview';

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
  TieredFCConfigView
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
export {
  PipelineSettingsView,
  PromptTemplateManager,
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
export { CodeModeSettingsView, CodeModeMcpView, CodeModeSkillsView, CodeModeUsersView } from './CodeMode';

// Prompts - Composable prompt modules
export { PromptModulesView } from './Prompts/PromptModulesView';
export { EffectivenessView } from './Prompts/EffectivenessView';

