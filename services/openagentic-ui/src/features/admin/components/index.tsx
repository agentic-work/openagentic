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

