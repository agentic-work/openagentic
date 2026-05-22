/**
 * DocsPageRenderer — Renders documentation pages from lazy-loaded components.
 *
 * Maps page IDs from the navigation to their React components.
 * Falls back to the old manifest renderer for pages without a dedicated component.
 */

import React, { Suspense, useMemo } from 'react';
import { useDocsStore } from '@/stores/useDocsStore';

// Lazy-loaded page components
const WelcomePage = React.lazy(() => import('../pages/WelcomePage'));
const QuickStartPage = React.lazy(() => import('../pages/QuickStartPage'));
const KeyConceptsPage = React.lazy(() => import('../pages/KeyConceptsPage'));
const ChatModePage = React.lazy(() => import('../pages/ChatModePage'));
// 2026-04-19 — IntelligenceSliderPage deleted (task #144, slider rip).
const AgentDelegationPage = React.lazy(() => import('../pages/AgentDelegationPage'));
const ArtifactsPage = React.lazy(() => import('../pages/ArtifactsPage'));
const SandboxSecurityPage = React.lazy(() => import('../pages/SandboxSecurityPage'));
const FlowBuilderPage = React.lazy(() => import('../pages/FlowBuilderPage'));
const NodeTypesPage = React.lazy(() => import('../pages/NodeTypesPage'));
const SchedulingTriggersPage = React.lazy(() => import('../pages/SchedulingTriggersPage'));
const WhatIsMcpPage = React.lazy(() => import('../pages/WhatIsMcpPage'));
const AvailableToolsPage = React.lazy(() => import('../pages/AvailableToolsPage'));
const AuthenticationPage = React.lazy(() => import('../pages/AuthenticationPage'));
const DlpScannerPage = React.lazy(() => import('../pages/DlpScannerPage'));
const HitlApprovalsPage = React.lazy(() => import('../pages/HitlApprovalsPage'));
const AuditTrailPage = React.lazy(() => import('../pages/AuditTrailPage'));
const ToolExecutionPage = React.lazy(() => import('../pages/ToolExecutionPage'));
const ApiReferencePage = React.lazy(() => import('../pages/ApiReferencePage'));

// Admin pages
const AdminDashboardPage = React.lazy(() => import('../pages/AdminDashboardPage').catch(() => ({ default: () => null as any })));
const AdminProvidersPage = React.lazy(() => import('../pages/AdminProvidersPage').catch(() => ({ default: () => null as any })));
const AdminAgentsPage = React.lazy(() => import('../pages/AdminAgentsPage').catch(() => ({ default: () => null as any })));
const AdminMCPPage = React.lazy(() => import('../pages/AdminMCPPage').catch(() => ({ default: () => null as any })));
const AdminFlowsPage = React.lazy(() => import('../pages/AdminFlowsPage').catch(() => ({ default: () => null as any })));
const AdminMonitoringPage = React.lazy(() => import('../pages/AdminMonitoringPage').catch(() => ({ default: () => null as any })));
const AdminSecurityConfigPage = React.lazy(() => import('../pages/AdminSecurityConfigPage').catch(() => ({ default: () => null as any })));
const AdminIntegrationsPage = React.lazy(() => import('../pages/AdminIntegrationsPage').catch(() => ({ default: () => null as any })));
const AdminPromptPage = React.lazy(() => import('../pages/AdminPromptPage').catch(() => ({ default: () => null as any })));
// Legacy admin pages (fallback)
const ProviderManagementPage = React.lazy(() => import('../pages/ProviderManagementPage'));
const AgentConfigurationPage = React.lazy(() => import('../pages/AgentConfigurationPage'));
const SystemSettingsPage = React.lazy(() => import('../pages/SystemSettingsPage'));
// Architecture & DevOps
const ArchitecturePage = React.lazy(() => import('../pages/ArchitecturePage').catch(() => ({ default: () => null as any })));
const DeploymentGuidePage = React.lazy(() => import('../pages/DeploymentGuidePage').catch(() => ({ default: () => null as any })));
const DeployedServicesPage = React.lazy(() => import('../pages/DeployedServicesPage').catch(() => ({ default: () => null as any })));
const SecurityArchPage = React.lazy(() => import('../pages/SecurityArchPage').catch(() => ({ default: () => null as any })));
const RoadmapPage = React.lazy(() => import('../pages/RoadmapPage').catch(() => ({ default: () => null as any })));
// Reference
const ApiRoutesPage = React.lazy(() => import('../pages/ApiRoutesPage'));
const ChangelogPage = React.lazy(() => import('../pages/ChangelogPage'));

/**
 * Page ID → Component mapping
 */
const PAGE_COMPONENTS: Record<string, React.LazyExoticComponent<React.FC<any>>> = {
  // Getting Started
  'welcome': WelcomePage,
  'quick-start': QuickStartPage,
  'key-concepts': KeyConceptsPage,
  // Chat Mode
  'chat-mode': ChatModePage,
  // 2026-04-19 — intelligence-slider route removed (task #144).
  'agents-delegation': AgentDelegationPage,
  'artifacts': ArtifactsPage,
  // Code Mode  'sandbox-security': SandboxSecurityPage,
  // Flows
  'flows-builder': FlowBuilderPage,
  'node-types': NodeTypesPage,
  'scheduling-triggers': SchedulingTriggersPage,
  // MCP & Tools
  'mcp-overview': WhatIsMcpPage,
  'available-tools': AvailableToolsPage,
  // Security
  'authentication': AuthenticationPage,
  'dlp-scanner-guide': DlpScannerPage,
  'hitl-guide': HitlApprovalsPage,
  'audit-trail-guide': AuditTrailPage,
  'tool-execution': ToolExecutionPage,
  // Admin — use new detailed pages, fall back to legacy
  'admin-dashboard': AdminDashboardPage,
  'admin-providers': AdminProvidersPage,
  'admin-agents': AdminAgentsPage,
  'admin-mcp': AdminMCPPage,
  'admin-flows': AdminFlowsPage,
  'admin-monitoring': AdminMonitoringPage,
  'admin-security-config': AdminSecurityConfigPage,
  'admin-integrations': AdminIntegrationsPage,
  'admin-prompts': AdminPromptPage,  'admin-settings': SystemSettingsPage,
  // Architecture & DevOps
  'architecture': ArchitecturePage,
  'deployed-services': DeployedServicesPage,
  'deployment-guide': DeploymentGuidePage,
  'security-architecture': SecurityArchPage,
  'roadmap': RoadmapPage,
  // Reference
  'swagger-api': ApiReferencePage,
  'api-routes': ApiRoutesPage,
  'changelog': ChangelogPage,
};

/**
 * Navigation structure for the docs sidebar.
 */
export interface DocsNavPage {
  id: string;
  title: string;
  description: string;
  adminOnly?: boolean;
}

export interface DocsNavCategory {
  id: string;
  title: string;
  icon: string;
  pages: DocsNavPage[];
}

export const docsNavigation: DocsNavCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'book',
    pages: [
      { id: 'welcome', title: 'Welcome', description: 'What is OpenAgentic' },
      { id: 'quick-start', title: 'Quick Start', description: 'Get up and running' },
      { id: 'key-concepts', title: 'Key Concepts', description: 'Agents, MCP, Pipeline, Flows' },
    ],
  },
  {
    id: 'chat',
    title: 'Chat Mode',
    icon: 'brain',
    pages: [
      { id: 'chat-mode', title: 'How Chat Works', description: 'The AI conversation pipeline' },
      // 2026-04-19 — intelligence-slider nav entry removed (task #144).
      { id: 'agents-delegation', title: 'Agent Delegation', description: 'Multi-agent orchestration' },
      { id: 'artifacts', title: 'Artifacts', description: 'HTML visualizations and dashboards' },
    ],
  },
  {
    id: 'workflows',
    title: 'Flows',
    icon: 'flow',
    pages: [
      { id: 'flows-builder', title: 'Workflow Builder', description: 'Visual automation canvas' },
      { id: 'node-types', title: 'Node Types', description: '30+ workflow node types' },
      { id: 'scheduling-triggers', title: 'Scheduling & Triggers', description: 'Cron, webhooks, API' },
    ],
  },
  {
    id: 'tools',
    title: 'MCP & Tools',
    icon: 'tool',
    pages: [
      { id: 'mcp-overview', title: 'What is MCP?', description: 'Model Context Protocol' },
      { id: 'available-tools', title: 'Available Tools', description: '16 MCP servers' },
      { id: 'tool-execution', title: 'Tool Execution', description: 'How tools run securely' },
    ],
  },
  {
    id: 'security',
    title: 'Security',
    icon: 'shield',
    pages: [
      { id: 'authentication', title: 'Authentication', description: 'SSO, API keys, tokens' },
      { id: 'dlp-scanner-guide', title: 'DLP Scanner', description: 'Data loss prevention' },
      { id: 'hitl-guide', title: 'HITL Approvals', description: 'Human-in-the-loop' },
      { id: 'audit-trail-guide', title: 'Audit Trail', description: 'Immutable logging' },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    icon: 'infra',
    pages: [
      { id: 'admin-dashboard', title: 'Dashboard Overview', description: 'Platform metrics & health', adminOnly: true },
      { id: 'admin-providers', title: 'LLM Providers', description: 'Provider config & routing', adminOnly: true },
      { id: 'admin-agents', title: 'Agent Management', description: 'Registry, skills, testing', adminOnly: true },
      { id: 'admin-mcp', title: 'MCP Servers', description: 'Tool servers & access control', adminOnly: true },
      { id: 'admin-flows', title: 'Workflow Admin', description: 'Governance & execution', adminOnly: true },
      { id: 'admin-monitoring', title: 'Monitoring', description: 'Metrics, logs, debug tools', adminOnly: true },
      { id: 'admin-security-config', title: 'Security Config', description: 'Auth, DLP, rate limits', adminOnly: true },
      { id: 'admin-integrations', title: 'Integrations', description: 'Slack, Teams, webhooks', adminOnly: true },
      { id: 'admin-prompts', title: 'Prompt Engineering', description: 'Modules & effectiveness', adminOnly: true },    ],
  },
  {
    id: 'architecture',
    title: 'Architecture',
    icon: 'infra',
    pages: [
      { id: 'deployed-services', title: 'Deployed Services', description: 'Live cluster topology + image SHAs per service' },
      { id: 'architecture', title: 'System Architecture', description: 'Services, databases, protocols' },
      { id: 'security-architecture', title: 'Security Architecture', description: 'Auth, DLP, audit, encryption' },
      { id: 'deployment-guide', title: 'Deployment Guide', description: 'Build, Helm, Kubernetes', adminOnly: true },
    ],
  },
  {
    id: 'reference',
    title: 'Reference',
    icon: 'code',
    pages: [
      { id: 'swagger-api', title: 'API Explorer', description: 'OpenAPI documentation' },
      { id: 'api-routes', title: 'API Routes', description: 'All HTTP endpoints' },
      { id: 'changelog', title: 'Changelog', description: 'Version history' },
      { id: 'roadmap', title: 'Roadmap', description: 'Future plans' },
    ],
  },
];

export function hasPageComponent(pageId: string): boolean {
  return pageId in PAGE_COMPONENTS;
}

export function getPageComponent(pageId: string): React.LazyExoticComponent<React.FC<any>> | null {
  return PAGE_COMPONENTS[pageId] || null;
}

const PageLoading: React.FC = () => (
  <div className="flex-1 flex items-center justify-center py-20">
    <div className="flex items-center gap-3">
      <div
        className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"
        style={{ color: 'var(--color-textMuted)' }}
      />
      <span className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
        Loading...
      </span>
    </div>
  </div>
);

export const DocsPageRenderer: React.FC = () => {
  const { currentDomain } = useDocsStore();

  const PageComponent = useMemo(
    () => (currentDomain ? getPageComponent(currentDomain) : null),
    [currentDomain],
  );

  if (!PageComponent) return null;

  return (
    <Suspense fallback={<PageLoading />}>
      <PageComponent />
    </Suspense>
  );
};
