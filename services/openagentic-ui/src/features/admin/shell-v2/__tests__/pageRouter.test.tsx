import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { Suspense } from 'react'
import { PageRouter } from '../pageRouter'

// ---------------------------------------------------------------------------
// Mock every lazy-loaded v1 view to prevent jsdom from trying to actually
// render them (they have deep provider requirements). We only test that
// PageRouter dispatches to the right component boundary — not that v1
// components work in jsdom.
// ---------------------------------------------------------------------------
vi.mock('../../components/LLM/LLMProviderManagement', () => ({
  LLMProviderManagement: () => <div data-testid="v1-providers" />,
}))
vi.mock('../../components/System/UserPermissionsView', () => ({
  default: () => <div data-testid="v1-user-permissions" />,
}))
vi.mock('../../components/Monitoring/AuditLogsView', () => ({
  AuditLogsView: () => <div data-testid="v1-audit" />,
}))
vi.mock('../../components/Security/RateLimitsView', () => ({
  default: () => <div data-testid="v1-rate-limits" />,
}))
// Remaining v1 components — minimal stubs so lazy() doesn't throw
vi.mock('../../components/SystemConfiguration/DefaultModelsView', () => ({ default: () => <div /> }))
vi.mock('../../components/LLM/ModelManagementView', () => ({ ModelManagementView: () => <div /> }))
vi.mock('../../components/LLM/OllamaManagementView', () => ({ OllamaManagementView: () => <div /> }))
vi.mock('../../components/LLM/TieredFCConfigView', () => ({ default: () => <div /> }))
vi.mock('../../components/LLM/RouterTuningView', () => ({ default: () => <div /> }))
vi.mock('../../components/LLM/LLMPerformanceMetrics', () => ({ default: () => <div /> }))
vi.mock('../../components/MCP/MCPCallLogsView', () => ({ MCPCallLogsView: () => <div /> }))
vi.mock('../../components/Synth', () => ({
  SynthManagementView: () => <div />,
  SynthApprovalsView: () => <div />,
  SynthUsageStatsView: () => <div />,
}))
vi.mock('../../components/MCP/ToolExecutionModeView', () => ({ ToolExecutionModeView: () => <div /> }))
vi.mock('../../components/MCP/MCPKubernetesView', () => ({
  default: () => <div data-testid="v2-mcp-kubernetes" />,
}))
vi.mock('../../components/Workflows/AdminWorkflowsView', () => ({ AdminWorkflowsView: () => <div /> }))
vi.mock('../../components/Workflows/AdminExecutionsView', () => ({ AdminExecutionsView: () => <div /> }))
vi.mock('../../components/Workflows/WorkflowCredentialsView', () => ({ default: () => <div /> }))
vi.mock('../../components/Workflows/AdminWorkflowSettingsView', () => ({
  AdminWorkflowSettingsView: () => <div />,
}))
vi.mock('../../components/Workflows/FlowCostsView', () => ({ FlowCostsView: () => <div /> }))
vi.mock('../../components/Agents', () => ({
  AgentManagementView: () => <div />,
}))
vi.mock('../../components/Agents/SkillsMarketplaceView', () => ({ SkillsMarketplaceView: () => <div /> }))
vi.mock('../../components/Agents/AgentExecutionDashboard', () => ({
  AgentExecutionDashboard: () => <div />,
}))
vi.mock('../../components/Integrations/IntegrationsView', () => ({ IntegrationsView: () => <div /> }))
vi.mock('../../components/Flows/FlowsKpiDashboard', () => ({
  FlowsKpiDashboard: () => <div data-testid="flows-kpi-dashboard" />,
}))
vi.mock('../../components/Flows/FlowsAuditLogViewer', () => ({
  FlowsAuditLogViewer: () => <div data-testid="flows-audit-log-viewer" />,
}))
vi.mock('../../components/Teams/TeamsManagementView', () => ({
  TeamsManagementView: () => <div data-testid="teams-management-view" />,
}))
// Phase E.6 (2026-05-10) — PromptModulesView source deleted; no mock needed.
vi.mock('../../components/Prompts/EffectivenessView', () => ({ EffectivenessView: () => <div /> }))
vi.mock('../../components/Content/PromptMetrics', () => ({ default: () => <div /> }))
vi.mock('../../components/Content/PromptTemplateManager', () => ({
  PromptTemplateManager: () => <div />,
}))
vi.mock('../../components/Content/PipelineSettingsView', () => ({ PipelineSettingsView: () => <div /> }))
vi.mock('../../components/Content/SharedKBView', () => ({ SharedKBView: () => <div /> }))
vi.mock('../../components/DataLayer', () => ({ UnifiedDataLayerView: () => <div /> }))
vi.mock('../../components/DataLayer/UserContextView', () => ({ UserContextView: () => <div /> }))
vi.mock('../../components/Chargeback', () => ({ ChargebackView: () => <div /> }))
vi.mock('../../components/Monitoring/UserActivityDashboard', () => ({ default: () => <div /> }))
vi.mock('../../components/Monitoring/UsageAnalytics', () => ({ default: () => <div /> }))
vi.mock('../../components/Monitoring/FeedbackAnalyticsView', () => ({
  FeedbackAnalyticsView: () => <div />,
}))
vi.mock('../../components/Monitoring/PerformanceMetrics', () => ({ default: () => <div /> }))
vi.mock('../../components/Monitoring/MonitoringView', () => ({ MonitoringView: () => <div /> }))
vi.mock('../../components/Monitoring/ContextWindowMetrics', () => ({
  ContextWindowMetrics: () => <div />,
}))
vi.mock('../../components/Monitoring/EmbeddingMetrics', () => ({ default: () => <div /> }))
vi.mock('../../components/Monitoring/ClusterHealthView', () => ({
  default: () => <div data-testid="v2-cluster-health" />,
}))
vi.mock('../../components/Testing/TestHarnessView', () => ({ default: () => <div /> }))
vi.mock('../../components/System/AuthAccessControlView', () => ({
  AuthAccessControlView: () => <div />,
}))
vi.mock('../../components/System/UserLockoutView', () => ({ default: () => <div /> }))
vi.mock('../../components/Security/NetworkSecurityView', () => ({ default: () => <div /> }))
vi.mock('../../components/Security/WebhookSecurityView', () => ({ default: () => <div /> }))
vi.mock('../../components/Security/DLPConfigView', () => ({ default: () => <div /> }))
vi.mock('../../components/Security/TokenManagementView', () => ({
  default: () => <div data-testid="v1-tokens" />,
}))
vi.mock('../../components/System/SystemSettingsView', () => ({ default: () => <div /> }))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div>loading</div>}>{ui}</Suspense>
    </QueryClientProvider>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PageRouter', () => {
  it('renders DashboardOverview for active="overview"', () => {
    render(wrap(<PageRouter active="overview" />))
    expect(screen.getAllByText(/Dashboard Overview/).length).toBeGreaterThan(0)
  })

  it('renders Grafana link for active="grafana"', () => {
    render(wrap(<PageRouter active="grafana" />))
    expect(screen.getByText(/Grafana opens in a new tab/i)).toBeInTheDocument()
  })

  it('dispatches to TokenManagementView for tokens', async () => {
    render(wrap(<PageRouter active="tokens" />))
    expect(await screen.findByTestId('v1-tokens')).toBeInTheDocument()
  })

  it('dispatches to MCPKubernetesView for mcp-kubernetes', async () => {
    render(wrap(<PageRouter active="mcp-kubernetes" />))
    expect(await screen.findByTestId('v2-mcp-kubernetes')).toBeInTheDocument()
  })

  it('renders V2PagePlaceholder for unknown section id', async () => {
    render(wrap(<PageRouter active="does-not-exist" />))
    expect(await screen.findByText(/still wired into v1/i)).toBeInTheDocument()
  })

  it('dispatches to correct v1 component for providers', async () => {
    render(wrap(<PageRouter active="providers" />))
    expect(await screen.findByTestId('v1-providers')).toBeInTheDocument()
  })

  it('dispatches to correct v1 component for permissions (shares with users)', async () => {
    render(wrap(<PageRouter active="permissions" />))
    expect(await screen.findByTestId('v1-user-permissions')).toBeInTheDocument()
  })

  it('dispatches to correct v1 component for rate-limits', async () => {
    render(wrap(<PageRouter active="rate-limits" />))
    expect(await screen.findByTestId('v1-rate-limits')).toBeInTheDocument()
  })

  it('dispatches to FlowsKpiDashboard for flows-kpis', async () => {
    render(wrap(<PageRouter active="flows-kpis" />))
    expect(await screen.findByTestId('flows-kpi-dashboard')).toBeInTheDocument()
  })

  it('dispatches to FlowsAuditLogViewer for flows-audit-logs', async () => {
    render(wrap(<PageRouter active="flows-audit-logs" />))
    expect(await screen.findByTestId('flows-audit-log-viewer')).toBeInTheDocument()
  })

  it('dispatches to TeamsManagementView for teams', async () => {
    render(wrap(<PageRouter active="teams" />))
    expect(await screen.findByTestId('teams-management-view')).toBeInTheDocument()
  })
})
