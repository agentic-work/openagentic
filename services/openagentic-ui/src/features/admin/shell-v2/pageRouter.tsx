import React, { Suspense, lazy } from 'react'
import { DashboardOverview } from '../pages/dashboard/DashboardOverview'
import { useTheme } from '../hooks/useTheme'

// ---------------------------------------------------------------------------
// Lazy-loaded v1 section components — paths mirror AdminPortal.tsx exactly
// (AdminPortal imports from '../X'; we import from '../components/X')
// ---------------------------------------------------------------------------

// LLM
const LLMProviderManagement = lazy(() =>
  import('../components/LLM/LLMProviderManagement').then(m => ({ default: m.LLMProviderManagement })),
)
const DefaultModelsView = lazy(() => import('../components/SystemConfiguration/DefaultModelsView'))
const ModelManagementView = lazy(() =>
  import('../components/LLM/ModelManagementView').then(m => ({ default: m.ModelManagementView })),
)
const OllamaManagementView = lazy(() =>
  import('../components/LLM/OllamaManagementView').then(m => ({ default: m.OllamaManagementView })),
)
const TieredFCConfigView = lazy(() => import('../components/LLM/TieredFCConfigView'))
const RouterTuningView = lazy(() => import('../components/LLM/RouterTuningView'))
const LLMPerformanceMetrics = lazy(() => import('../components/LLM/LLMPerformanceMetrics'))

// Tools / MCP
// MCPManagementView retired 2026-06-02 — the `mcp-management` legacy id below
// already routes to the consolidated MCPFleet page (v3 is the live shell).
const MCPCallLogsView = lazy(() =>
  import('../components/MCP/MCPCallLogsView').then(m => ({ default: m.MCPCallLogsView })),
)
const ToolExecutionModeView = lazy(() =>
  import('../components/MCP/ToolExecutionModeView').then(m => ({ default: m.ToolExecutionModeView })),
)
const MCPKubernetesView = lazy(() => import('../components/MCP/MCPKubernetesView'))
const MCPFleet = lazy(() => import('../pages/tools/MCPFleet').then(m => ({ default: m.MCPFleet })))

// Workflows
const AdminWorkflowsView = lazy(() =>
  import('../components/Workflows/AdminWorkflowsView').then(m => ({ default: m.AdminWorkflowsView })),
)
const AdminExecutionsView = lazy(() =>
  import('../components/Workflows/AdminExecutionsView').then(m => ({ default: m.AdminExecutionsView })),
)
const WorkflowCredentialsView = lazy(() => import('../components/Workflows/WorkflowCredentialsView'))
const AdminWorkflowSettingsView = lazy(() =>
  import('../components/Workflows/AdminWorkflowSettingsView').then(m => ({
    default: m.AdminWorkflowSettingsView,
  })),
)
const FlowCostsView = lazy(() =>
  import('../components/Workflows/FlowCostsView').then(m => ({ default: m.FlowCostsView })),
)

// Agents
const AgentManagementView = lazy(() =>
  import('../components/Agents').then(m => ({ default: m.AgentManagementView })),
)
const SkillsMarketplaceView = lazy(() =>
  import('../components/Agents/SkillsMarketplaceView').then(m => ({ default: m.SkillsMarketplaceView })),
)
const AgentExecutionDashboard = lazy(() =>
  import('../components/Agents/AgentExecutionDashboard').then(m => ({ default: m.AgentExecutionDashboard })),
)
const AgentOpsView = lazy(() =>
  import('../components/AgentOps/AgentOpsView').then(m => ({ default: m.AgentOpsView })),
)
// Container that wraps AgentOpsView with the fleet-metrics hook. Lazy-
// loaded alongside the view so the admin shell pays nothing until the
// AgentOps tab is actually opened.
const AgentOpsViewContainer = lazy(() =>
  import('../components/AgentOps/AgentOpsViewContainer').then(m => ({ default: m.AgentOpsViewContainer })),
)

// Flows KPI + Audit Log
const FlowsKpiDashboard = lazy(() =>
  import('../components/Flows/FlowsKpiDashboard').then(m => ({ default: m.FlowsKpiDashboard })),
)
const FlowsAuditLogViewer = lazy(() =>
  import('../components/Flows/FlowsAuditLogViewer').then(m => ({ default: m.FlowsAuditLogViewer })),
)

// Teams
const TeamsManagementView = lazy(() =>
  import('../components/Teams/TeamsManagementView').then(m => ({ default: m.TeamsManagementView })),
)

// Prompt Engineering
// Phase E.6 (2026-05-10) — PromptModulesView removed alongside the
// PromptComposer + PromptModuleRegistry rip in Phase E.3/E.4.
const EffectivenessView = lazy(() =>
  import('../components/Prompts/EffectivenessView').then(m => ({ default: m.EffectivenessView })),
)
const PromptMetrics = lazy(() => import('../components/Content/PromptMetrics'))

// Content & Data
// PromptTemplateManager RIPPED 2026-05-11 (chatmode-rip Phase E final cleanup).
const PipelineSettingsView = lazy(() =>
  import('../components/Content/PipelineSettingsView').then(m => ({ default: m.PipelineSettingsView })),
)
const SharedKBView = lazy(() =>
  import('../components/Content/SharedKBView').then(m => ({ default: m.SharedKBView })),
)
const UnifiedDataLayerView = lazy(() =>
  import('../components/DataLayer').then(m => ({ default: m.UnifiedDataLayerView })),
)
const UserContextView = lazy(() =>
  import('../components/DataLayer/UserContextView').then(m => ({ default: m.UserContextView })),
)

// Monitoring
const TestHarnessView = lazy(() => import('../components/Testing/TestHarnessView'))

// Security & Access
const AuthAccessControlView = lazy(() =>
  import('../components/System/AuthAccessControlView').then(m => ({ default: m.AuthAccessControlView })),
)
const UserPermissionsView = lazy(() => import('../components/System/UserPermissionsView'))
const PermissionsPage = lazy(() =>
  import('../pages-v3/PermissionsPage').then(m => ({ default: m.PermissionsPage })),
)
const UserLockoutView = lazy(() => import('../components/System/UserLockoutView'))
const TokenManagementView = lazy(() => import('../components/Security/TokenManagementView'))

// System
const SystemSettingsView = lazy(() => import('../components/System/SystemSettingsView'))

// ---------------------------------------------------------------------------
// Placeholder for sections that are still inline JSX in v1 AdminPortal
// ---------------------------------------------------------------------------
function V2PagePlaceholder({ sectionId: _sectionId }: { sectionId: string }) {
  return (
    <div className="p-10 text-center max-w-xl mx-auto mt-10">
      <h2 className="text-fg-0 text-xl font-bold mt-2">Select a section</h2>
      <p className="text-fg-2 mt-3">
        Choose a section from the navigation to get started.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grafana external link tile
// ---------------------------------------------------------------------------
function GrafanaLink() {
  return (
    <div className="p-10 text-center max-w-xl mx-auto mt-10">
      <div className="text-fg-3 font-mono text-xs tracking-widest uppercase">// external</div>
      <h2 className="text-fg-0 text-xl font-bold mt-2">Grafana opens in a new tab</h2>
      <p className="text-fg-2 mt-3">
        Live dashboards at <span className="font-mono">/grafana/</span>.
      </p>
      <button
        onClick={() => window.open('/grafana/', '_blank', 'noopener,noreferrer')}
        className="mt-5 px-4 py-2 rounded bg-pri text-white text-sm font-semibold"
      >
        Open Grafana →
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Suspense fallback
// ---------------------------------------------------------------------------
function SectionLoading() {
  return <div className="p-10 text-center font-mono text-fg-3 text-sm">loading section…</div>
}

// ---------------------------------------------------------------------------
// Core dispatch — mirrors AdminPortal.renderMainContent() switch statement
// ---------------------------------------------------------------------------
function renderSection(id: string, theme: 'dark' | 'light'): React.ReactNode {
  switch (id) {
    // LLM
    case 'providers':
      return <LLMProviderManagement theme={theme} />
    case 'llm-default-models':
      return <DefaultModelsView />
    case 'model-management':
      return <ModelManagementView theme={theme} />
    case 'ollama':
      return <OllamaManagementView theme={theme as 'light' | 'dark'} />
    case 'tiered-fc':
      return <TieredFCConfigView />
    case 'llm-router-tuning':
      return <RouterTuningView />
    case 'llm-performance':
      return <LLMPerformanceMetrics theme={theme} />

    // Tools / MCP — consolidated 2026-05-05 into MCPFleet.
    // Legacy ids redirect to the same page for bookmark continuity.
    case 'mcp-fleet':
    case 'mcp-management':
    case 'mcp-logs':
    case 'mcp-kubernetes':
    case 'tool-execution-mode':
      return <MCPFleet theme={theme} />

    // Workflows
    case 'native-workflow-list':
      return <AdminWorkflowsView theme={theme} />
    case 'native-execution-list':
      return <AdminExecutionsView theme={theme} />
    case 'native-workflow-credentials':
      return <WorkflowCredentialsView theme={theme} />
    case 'native-workflow-settings':
      return <AdminWorkflowSettingsView />
    case 'native-workflow-costs':
      return <FlowCostsView theme={theme} />

    // Agents
    case 'agent-registry':
      return <AgentManagementView theme={theme} />
    case 'agent-ops':
      // Pillar 4 fleet view (#54). Backed by /admin/agents/metrics/fleet,
      // rolled up from admin.agentic_loops + admin.agentic_loop_executions
      // over the last 24h. AgentOpsView handles empty / loading / error
      // states; the hook degrades to empty arrays on any failure.
      return <AgentOpsViewContainer />

    case 'agent-skills':
      return <SkillsMarketplaceView theme={theme} />
    case 'agent-executions':
      return <AgentExecutionDashboard theme={theme} />

    // OpenAgentic Flows — KPI dashboard + Audit log viewer + Teams
    case 'flows-kpis':
      return <FlowsKpiDashboard theme={theme} />
    case 'flows-audit-logs':
      return <FlowsAuditLogViewer theme={theme} />
    case 'teams':
      return <TeamsManagementView theme={theme} />

    // Prompt Engineering
    // Phase E.6 (2026-05-10) — 'prompt-modules' route case removed.
    case 'prompt-effectiveness':
      return <EffectivenessView />
    case 'prompt-metrics':
      return <PromptMetrics theme={theme} />

    // Content & Data
    // 'templates' route RIPPED 2026-05-11 along with PromptTemplateManager.
    case 'pipeline-settings':
      return <PipelineSettingsView />
    case 'shared-kb':
      return <SharedKBView />
    case 'data-layer':
      return <UnifiedDataLayerView theme={theme} />
    case 'user-context':
      return <UserContextView theme={theme} />

    // Monitoring
    case 'performance':
      // AdminPortal maps 'performance' → LLMPerformanceMetrics (same component as 'llm-performance')
      return <LLMPerformanceMetrics theme={theme} />
    case 'grafana':
      return <GrafanaLink />
    case 'test-harness':
      return <TestHarnessView />

    // Security & Access
    case 'auth-access':
      return <AuthAccessControlView />
    case 'permissions':
      // Global Read-Only Mode toggle + tool permission rules editor.
      // Per-user role/lockout management lives under `users`.
      return <PermissionsPage />
    case 'users':
      return <UserPermissionsView />
    case 'user-lockout':
      return <UserLockoutView />
    case 'tokens':
      return <TokenManagementView />

    // System
    case 'settings':
      return <SystemSettingsView theme={theme} />

    default:
      return <V2PagePlaceholder sectionId={id} />
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function PageRouter({ active }: { active: string }) {
  const { theme } = useTheme()

  if (active === 'overview') return <DashboardOverview />

  return (
    <div className="p-0">
      <Suspense fallback={<SectionLoading />}>{renderSection(active, theme)}</Suspense>
    </div>
  )
}
