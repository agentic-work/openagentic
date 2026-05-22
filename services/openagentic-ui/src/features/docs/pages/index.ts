import React from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface DocsPage {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  component: React.LazyExoticComponent<React.ComponentType>;
  adminOnly?: boolean;
}

export interface DocsCategory {
  id: string;
  title: string;
  icon: string;
  pages: DocsPage[];
}

// ============================================================================
// LAZY IMPORTS
// ============================================================================

const WelcomePage = React.lazy(() => import('./WelcomePage'));
const QuickStartPage = React.lazy(() => import('./QuickStartPage'));
const KeyConceptsPage = React.lazy(() => import('./KeyConceptsPage'));
const ChatModePage = React.lazy(() => import('./ChatModePage'));
// 2026-04-19 — IntelligenceSliderPage deleted (task #144, slider rip).
const AgentDelegationPage = React.lazy(() => import('./AgentDelegationPage'));
const ArtifactsPage = React.lazy(() => import('./ArtifactsPage'));
const CodeModePage = React.lazy(() => import('./CodeModePage'));
const SandboxSecurityPage = React.lazy(() => import('./SandboxSecurityPage'));
const FlowBuilderPage = React.lazy(() => import('./FlowBuilderPage'));
const NodeTypesPage = React.lazy(() => import('./NodeTypesPage'));
const SchedulingTriggersPage = React.lazy(() => import('./SchedulingTriggersPage'));
const WhatIsMcpPage = React.lazy(() => import('./WhatIsMcpPage'));
const AvailableToolsPage = React.lazy(() => import('./AvailableToolsPage'));
const ToolExecutionPage = React.lazy(() => import('./ToolExecutionPage'));
const AuthenticationPage = React.lazy(() => import('./AuthenticationPage'));
const DlpScannerPage = React.lazy(() => import('./DlpScannerPage'));
const HitlApprovalsPage = React.lazy(() => import('./HitlApprovalsPage'));
const AuditTrailPage = React.lazy(() => import('./AuditTrailPage'));
const ProviderManagementPage = React.lazy(() => import('./ProviderManagementPage'));
const AgentConfigurationPage = React.lazy(() => import('./AgentConfigurationPage'));
const SystemSettingsPage = React.lazy(() => import('./SystemSettingsPage'));
const ApiReferencePage = React.lazy(() => import('./ApiReferencePage'));
const ApiRoutesPage = React.lazy(() => import('./ApiRoutesPage'));
const ChangelogPage = React.lazy(() => import('./ChangelogPage'));
const ArchitecturePage = React.lazy(() => import('./ArchitecturePage'));
const DeploymentGuidePage = React.lazy(() => import('./DeploymentGuidePage'));
const SecurityArchPage = React.lazy(() => import('./SecurityArchPage'));
const RoadmapPage = React.lazy(() => import('./RoadmapPage'));

// ============================================================================
// NAVIGATION STRUCTURE
// ============================================================================

export const docsNavigation: DocsCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'book',
    pages: [
      {
        id: 'welcome',
        title: 'Welcome',
        description: 'What is OpenAgentic — platform overview',
        category: 'getting-started',
        icon: 'book',
        component: WelcomePage,
      },
      {
        id: 'quick-start',
        title: 'Quick Start',
        description: 'Getting up and running in minutes',
        category: 'getting-started',
        icon: 'book',
        component: QuickStartPage,
      },
      {
        id: 'key-concepts',
        title: 'Key Concepts',
        description: 'Agents, MCP, Pipeline, Flows explained',
        category: 'getting-started',
        icon: 'book',
        component: KeyConceptsPage,
      },
    ],
  },
  {
    id: 'chat-mode',
    title: 'Chat Mode',
    icon: 'brain',
    pages: [
      {
        id: 'how-chat-works',
        title: 'How Chat Works',
        description: 'The chat pipeline explained',
        category: 'chat-mode',
        icon: 'chat',
        component: ChatModePage,
      },
      // 2026-04-19 — intelligence-slider docs page removed (task #144).
      {
        id: 'agent-delegation',
        title: 'Agents & Delegation',
        description: 'How the AI delegates to specialists',
        category: 'chat-mode',
        icon: 'agent',
        component: AgentDelegationPage,
      },
      {
        id: 'artifacts',
        title: 'Artifacts',
        description: 'HTML artifacts, charts, visualizations',
        category: 'chat-mode',
        icon: 'code',
        component: ArtifactsPage,
      },
    ],
  },
  {
    id: 'code-mode',
    title: 'Code Mode',
    icon: 'code',
    pages: [
      {
        id: 'ide-interface',
        title: 'IDE Interface',
        description: 'The three-panel code environment',
        category: 'code-mode',
        icon: 'code',
        component: CodeModePage,
      },
      {
        id: 'sandbox-security',
        title: 'Sandbox Security',
        description: 'Kubernetes isolation model',
        category: 'code-mode',
        icon: 'shield',
        component: SandboxSecurityPage,
      },
    ],
  },
  {
    id: 'flows',
    title: 'Flows',
    icon: 'flow',
    pages: [
      {
        id: 'flow-builder',
        title: 'Visual Workflow Builder',
        description: 'Drag-and-drop workflow creation',
        category: 'flows',
        icon: 'flow',
        component: FlowBuilderPage,
      },
      {
        id: 'node-types',
        title: 'Node Types',
        description: 'All 30+ node types explained',
        category: 'flows',
        icon: 'flow',
        component: NodeTypesPage,
      },
      {
        id: 'scheduling-triggers',
        title: 'Scheduling & Triggers',
        description: 'Cron, webhooks, API triggers',
        category: 'flows',
        icon: 'flow',
        component: SchedulingTriggersPage,
      },
    ],
  },
  {
    id: 'mcp-tools',
    title: 'MCP Tools',
    icon: 'tool',
    pages: [
      {
        id: 'what-is-mcp',
        title: 'What is MCP?',
        description: 'Model Context Protocol explained',
        category: 'mcp-tools',
        icon: 'tool',
        component: WhatIsMcpPage,
      },
      {
        id: 'available-tools',
        title: 'Available Tools',
        description: 'All 16 MCP servers and their capabilities',
        category: 'mcp-tools',
        icon: 'tool',
        component: AvailableToolsPage,
      },
      {
        id: 'tool-execution',
        title: 'Tool Execution',
        description: 'How tools are selected and run',
        category: 'mcp-tools',
        icon: 'tool',
        component: ToolExecutionPage,
      },
    ],
  },
  {
    id: 'security',
    title: 'Security',
    icon: 'shield',
    pages: [
      {
        id: 'authentication',
        title: 'Authentication',
        description: 'SSO, API keys, token types',
        category: 'security',
        icon: 'shield',
        component: AuthenticationPage,
      },
      {
        id: 'dlp-scanner',
        title: 'DLP Scanner',
        description: 'Data loss prevention rules',
        category: 'security',
        icon: 'shield',
        component: DlpScannerPage,
      },
      {
        id: 'hitl-approvals',
        title: 'HITL Approvals',
        description: 'Human-in-the-loop gates',
        category: 'security',
        icon: 'shield',
        component: HitlApprovalsPage,
      },
      {
        id: 'audit-trail',
        title: 'Audit Trail',
        description: 'Immutable logging and compliance',
        category: 'security',
        icon: 'shield',
        component: AuditTrailPage,
      },
    ],
  },
  {
    id: 'administration',
    title: 'Administration',
    icon: 'infra',
    pages: [
      {
        id: 'provider-management',
        title: 'Provider Management',
        description: 'LLM provider configuration',
        category: 'administration',
        icon: 'infra',
        component: ProviderManagementPage,
        adminOnly: true,
      },
      {
        id: 'agent-configuration',
        title: 'Agent Configuration',
        description: 'Creating and tuning agents',
        category: 'administration',
        icon: 'agent',
        component: AgentConfigurationPage,
        adminOnly: true,
      },
      {
        id: 'system-settings',
        title: 'System Settings',
        description: 'Platform configuration',
        category: 'administration',
        icon: 'infra',
        component: SystemSettingsPage,
        adminOnly: true,
      },
    ],
  },
  {
    id: 'api-reference',
    title: 'API Reference',
    icon: 'code',
    pages: [
      {
        id: 'swagger-ui',
        title: 'Swagger UI',
        description: 'Interactive API explorer',
        category: 'api-reference',
        icon: 'code',
        component: ApiReferencePage,
      },
      {
        id: 'api-routes',
        title: 'API Routes',
        description: 'All HTTP endpoints',
        category: 'api-reference',
        icon: 'code',
        component: ApiRoutesPage,
      },
    ],
  },
  {
    id: 'architecture-ops',
    title: 'Architecture & Ops',
    icon: 'infra',
    pages: [
      {
        id: 'architecture',
        title: 'System Architecture',
        description: 'Full architecture diagram and design decisions',
        category: 'architecture-ops',
        icon: 'infra',
        component: ArchitecturePage,
      },
      {
        id: 'deployment-guide',
        title: 'Deployment Guide',
        description: 'Build, deploy, and manage the platform',
        category: 'architecture-ops',
        icon: 'infra',
        component: DeploymentGuidePage,
      },
      {
        id: 'security-architecture',
        title: 'Security Architecture',
        description: 'Defense-in-depth security reference',
        category: 'architecture-ops',
        icon: 'shield',
        component: SecurityArchPage,
      },
      {
        id: 'roadmap',
        title: 'Roadmap',
        description: 'Future plans and platform direction',
        category: 'architecture-ops',
        icon: 'flow',
        component: RoadmapPage,
      },
    ],
  },
  {
    id: 'changelog',
    title: 'Changelog',
    icon: 'book',
    pages: [
      {
        id: 'changelog',
        title: 'Version History',
        description: 'Release notes and version timeline',
        category: 'changelog',
        icon: 'book',
        component: ChangelogPage,
      },
    ],
  },
];

// ============================================================================
// HELPERS
// ============================================================================

/** Flat list of all pages for lookup */
export const allDocsPages: DocsPage[] = docsNavigation.flatMap((cat) => cat.pages);

/** Get a page by its ID */
export const getDocsPage = (pageId: string): DocsPage | undefined =>
  allDocsPages.find((p) => p.id === pageId);

/** Get category by ID */
export const getDocsCategory = (categoryId: string): DocsCategory | undefined =>
  docsNavigation.find((c) => c.id === categoryId);
