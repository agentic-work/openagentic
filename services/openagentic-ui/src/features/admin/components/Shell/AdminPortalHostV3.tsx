import * as React from 'react'
import { AdminShell, type AdminLeaf } from '../../shell-v3'
import { CommandPalette } from '../../shell-v3/CommandPalette'
import { ActivityDrawer } from '../../shell-v3/ActivityDrawer'
import { useTheme } from '../../hooks/useTheme'
import { Dashboard } from '../../pages-v3/Dashboard'
import { RouterTuningPage } from '../../pages-v3/RouterTuningPage'
import { ChatLoopConfigPage } from '../../pages-v3/ChatLoopConfigPage'
import { UserPermissionsPage } from '../../pages-v3/UserPermissionsPage'
import { PermissionsPage } from '../../pages-v3/PermissionsPage'
import { MCPFleetV3 } from '../../pages-v3/MCPFleetV3'
import { LLMProvidersPage } from '../../pages-v3/LLMProvidersPage'
import { DefaultModelsPage } from '../../pages-v3/DefaultModelsPage'
import { ModelRegistryPage } from '../../pages-v3/ModelRegistryPage'
import { WorkflowsPage } from '../../pages-v3/WorkflowsPage'
import { AuditLogsPage } from '../../pages-v3/AuditLogsPage'
import { SynthesisHubPage, type SynthesisTab } from '../../pages-v3/SynthesisHubPage'
import { PromptsHubPage } from '../../pages-v3/PromptsHubPage'
import { MonitoringHubPage, type MonitoringTab } from '../../pages-v3/MonitoringHubPage'
import { AgentsHubPage } from '../../pages-v3/AgentsHubPage'
import type { AgentsTabId } from '../../pages-v3/agents/types'
import { ContentHubPage, type ContentHubTab } from '../../pages-v3/ContentHubPage'
import { ChargebackPage } from '../../pages-v3/ChargebackPage'
import { FlowsExtrasHubPage } from '../../pages-v3/FlowsExtrasHubPage'
import type { FlowsExtrasTab } from '../../pages-v3/flows-extras/types'
import { IntegrationsHubPage } from '../../pages-v3/IntegrationsHubPage'
import { SystemSettingsHubPage } from '../../pages-v3/SystemSettingsHubPage'
import { LLMExtrasHubPage } from '../../pages-v3/LLMExtrasHubPage'
import { EnrichedToolsPage } from '../../pages-v3/EnrichedToolsPage'
import { SloPage } from '../../pages-v3/SloPage'
import { FeedbackAdvisoriesPage } from '../../pages-v3/FeedbackAdvisoriesPage'
import type { IntegrationsHubTab } from '../../pages-v3/integrations/types'
import { useAuth } from '../../../../app/providers/AuthContext'
import { useUIVisibilityStore } from '@/stores/useUIVisibilityStore'
import { AdminQueryProvider } from '../../hooks/useAdminQuery'
import { useAdminRibbon } from '../../hooks/useAdminRibbon'
import { Banner, EmptyInline, PageHead } from '../../primitives-v3'
import { AdminAgentDock, type AISuggestion } from '../../primitives-v2'
import { enterpriseLockFor } from '../../shell-v2/pageRouter'

/**
 * LeafErrorBoundary — catches render errors from a single leaf so a
 * broken v2 component (missing context, throw on mount, etc.) doesn't
 * crash the entire admin shell. Operator can pick another leaf and
 * keep working; the affected one shows an inline error with the stack
 * for debugging.
 */
class LeafErrorBoundary extends React.Component<
  { leafName: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[v3] leaf "${this.props.leafName}" crashed`, error, info)
  }
  componentDidUpdate(prev: { leafName: string }) {
    if (prev.leafName !== this.props.leafName && this.state.error) {
      // Reset on leaf change so the user can navigate away.
      this.setState({ error: null })
    }
  }
  render() {
    if (this.state.error) {
      return (
        <>
          <PageHead title={this.props.leafName} meta="render error · v2 page body crashed" />
          <Banner level="err" label="leaf error">
            v2 component threw: <span style={{ fontFamily: 'var(--font-v3-mono)' }}>{this.state.error.message}</span>
          </Banner>
          <EmptyInline pad>
            <div>The leaf nav still works — pick another leaf to continue.</div>
            <div style={{ marginTop: 8 }}>
              Append <span className="accent">?v3=0</span> to the URL to fall back to the v2 shell where this leaf
              may render correctly.
            </div>
          </EmptyInline>
        </>
      )
    }
    return this.props.children
  }
}

// Read leaf id from URL hash (#dashboard); default to dashboard.
function readActive(): string {
  if (typeof window === 'undefined') return 'dashboard'
  const h = window.location.hash.replace(/^#/, '')
  return h || 'dashboard'
}

export default function AdminPortalHostV3() {
  return (
    <AdminQueryProvider>
      <AdminPortalHostV3Inner />
    </AdminQueryProvider>
  )
}

/**
 * Inner component — runs INSIDE AdminQueryProvider so React Query hooks
 * (useAdminRibbon) can resolve their QueryClient.
 */
function AdminPortalHostV3Inner() {
  const [active, setActiveState] = React.useState<string>(() => readActive())
  const { accent } = useTheme()
  const { logout, user } = useAuth()
  const closeUI = useUIVisibilityStore((s) => s.close)
  const [clock, setClock] = React.useState<string>(() => fmtClock())
  const { cells: ribbonCells } = useAdminRibbon()

  // Reflect active leaf in the hash + listen for back/forward.
  React.useEffect(() => {
    const onHash = () => setActiveState(readActive())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setActive = React.useCallback((id: string) => {
    if (typeof window !== 'undefined') {
      // Use replaceState to avoid spamming history; pushState would also
      // be acceptable but operators expect Cmd+[ to go back through
      // intentional steps, not every leaf hover.
      window.history.replaceState(null, '', `#${id}`)
    }
    setActiveState(id)
  }, [])

  // Tick the ribbon clock every second.
  React.useEffect(() => {
    const t = setInterval(() => setClock(fmtClock()), 1000)
    return () => clearInterval(t)
  }, [])

  // Compute user initials for the topbar avatar from auth context.
  const initials = React.useMemo(() => {
    const src = user?.displayName ?? user?.email ?? ''
    return src
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || '?'
  }, [user])

  // Append accent indicator (cosmetic, not a metric — stays in ribbon).
  const cellsWithAccent = React.useMemo(
    () => [...ribbonCells, { label: 'accent', value: accent }],
    [ribbonCells, accent],
  )

  // C1 (2026-05-07): cmd+K command palette. Global keydown opens; the
  // Modal-style overlay handles its own keyboard nav + esc/outside-click
  // close. AdminShell's TopBar already has a "Search resources, pages,
  // agents… ⌘K" affordance that calls onOpenCmdK.
  const [cmdkOpen, setCmdkOpen] = React.useState(false)
  const [activityOpen, setActivityOpen] = React.useState(false)
  // Sev-1 #932 — Admin AI Agent floating dock. The v3 TopBar's
  // "admin agent" pill (button) opens this; the floating panel
  // is anchored to the bottom-right of the admin shell with a
  // bounded 480×600 frame so it reads as a chat-widget, not a
  // full-page takeover.
  const [agentOpen, setAgentOpen] = React.useState(false)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Only intercept when not typing inside an input/textarea
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          return
        }
        e.preventDefault()
        setCmdkOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <AdminShell
        active={active}
        onActiveChange={setActive}
        renderPage={renderPage}
        ribbonCells={cellsWithAccent}
        ribbonClock={clock}
        onClose={() => closeUI('showAdminPortal')}
        onSignOut={logout}
        user={{ initials, name: user?.displayName ?? user?.email ?? 'admin' }}
        version="0.7.1"
        onOpenCmdK={() => setCmdkOpen(true)}
        onOpenActivity={() => setActivityOpen(true)}
        onOpenAgent={() => setAgentOpen(true)}
      />
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        onSelect={(id) => setActive(id)}
      />
      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      {/* Sev-1 #932 — Admin AI Agent floating dock, controlled by the
          TopBar's "admin agent" pill (button) above. Anchored bottom-
          right of the admin shell at 480×600 max so it reads as a chat
          widget, not a full-page takeover. */}
      <AdminAgentDock
        open={agentOpen}
        onOpenChange={setAgentOpen}
        onAsk={askAdminAgent}
        suggestions={ADMIN_AGENT_SUGGESTIONS}
      />
    </>
  )
}

/** Default in-product suggestions for the Admin AI Agent. */
const ADMIN_AGENT_SUGGESTIONS: AISuggestion[] = [
  { q: 'How do I add a model to the registry?', icon: '+' },
  { q: 'What does Tiered Function Calling do?', icon: '?' },
  { q: 'Where do I configure DLP rules?', icon: '→' },
  { q: 'Show me users approaching their token cap', icon: '@' },
  { q: 'Walk me through enabling a new provider', icon: '▶' },
]

/**
 * Same inline-fetch SSE consumer as `AdminShellV2.askOnce` — kept inline
 * here so the v3 path doesn't depend on the v2 shell. POSTs the question
 * to /api/admin/ai/ask and accumulates the streamed `content` events
 * into a single resolved string for `AdminAIPanel.onAsk`.
 */
async function askAdminAgent(question: string): Promise<string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const res = await fetch('/api/admin/ai/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message: question,
      sessionId: `admin-agent-${Date.now()}`,
      currentSection: typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '',
      conversationHistory: [],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (!res.body) throw new Error('No response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let acc = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    let evt = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) evt = line.slice(7).trim()
      else if (line.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(line.slice(6))
          if (evt === 'content' && parsed.content) acc += parsed.content
          if (evt === 'error') throw new Error(parsed.message || 'stream error')
        } catch {
          /* skip malformed */
        }
        evt = ''
      }
    }
  }
  return acc
}

function fmtClock(): string {
  const d = new Date()
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())} ${z(
    d.getUTCHours(),
  )}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())} UTC`
}

/**
 * Monitoring hub leaf-id → sub-tab. EIGHT v2 leaves consolidate into a
 * single MonitoringHubPage; the leaf id picks the initial sub-tab.
 * `audit` (also under Monitoring) is intentionally NOT in this set —
 * it has its own native v3 page (AuditLogsPage) handled above so the
 * scope/resource chips behave as designed.
 */
const MONITORING_LEAF_TO_TAB: Record<string, MonitoringTab> = {
  'user-activity':  'activity',
  'analytics':      'analytics',
  'feedback':       'feedback',
  'errors':         'errors',
  'context-window': 'context',
  'embeddings':     'embeddings',
  'cluster-health': 'cluster',
  'test-harness':   'tests',
}

function renderPage(leaf: AdminLeaf) {
  // OSS enterprise gate. v3 leaves share the same ENTERPRISE_LEAVES set
  // as v2 (defined in shell-v2/pageRouter); locked leaves render the
  // upsell lock screen instead of the real route.
  const locked = enterpriseLockFor(leaf.id);
  if (locked) {
    return <LeafErrorBoundary leafName={leaf.name}>{locked as any}</LeafErrorBoundary>;
  }

  if (leaf.id === 'dashboard') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <Dashboard />
      </LeafErrorBoundary>
    )
  }

  // Router Tuning — native v3, replaces the v2-delegated leaf so the
  // scoring formula renders with v3 vocabulary (Chip / KpiGrid / Dt).
  if (leaf.id === 'router-tuning') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <RouterTuningPage />
      </LeafErrorBoundary>
    )
  }

  // Chat Loop Config — admin-tunable max_turns + future chat-loop knobs.
  // Backed by /api/admin/chat-loop-config → ChatLoopConfigService.
  // Spun up to fix the Sev-1 surfaced by the 2026-05-11 multi-cloud
  // capstone (gpt-5.4 hit the prior hardcoded 12-cap during 32-tool
  // cascade fanout). Operators now adjust this live.
  if (leaf.id === 'chat-loop-config') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <ChatLoopConfigPage />
      </LeafErrorBoundary>
    )
  }

  // V3 Phase 5 — EnrichedTool registry. Stub page now; full edit UI in
  // Phase 11 (UX primitives). Sidebar group: "tools management".
  if (leaf.id === 'enriched-tools') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <EnrichedToolsPage />
      </LeafErrorBoundary>
    )
  }

  // V3 Phase 12 — Service Level Objectives. Read-only table now;
  // full edit form is a follow-up (operators tune via API in the
  // meantime). Sidebar group: "monitoring".
  if (leaf.id === 'slo') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <SloPage />
      </LeafErrorBoundary>
    )
  }

  // V3 Phase 13 — Feedback advisory loop. Read-only this phase; Apply
  // lands in a Sev-2 follow-up. Sidebar group: "monitoring".
  if (leaf.id === 'feedback-advisories') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <FeedbackAdvisoriesPage />
      </LeafErrorBoundary>
    )
  }

  // `permissions` is the GLOBAL permission surface — hosts the Read-Only
  // Mode kill switch + the platform-wide tool permission rules editor
  // (allow/deny/ask). Per-user role / lockout management lives at the
  // `users` leaf via UserPermissionsPage.
  if (leaf.id === 'permissions') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <PermissionsPage />
      </LeafErrorBoundary>
    )
  }
  if (leaf.id === 'users') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <UserPermissionsPage initialTab="profile" />
      </LeafErrorBoundary>
    )
  }

  // System Management hub — native v3 SystemSettingsHubPage replaces v2
  // delegation for `auth-access`, `user-lockouts`, `tokens`,
  // `system-settings`, `rate-limits`, `network-security`,
  // `webhook-security`, `dlp-config`. Each leaf maps to a sub-tab so
  // operators land on the right pane.
  const SYSTEM_LEAF_TO_TAB: Record<string, string> = {
    'auth-access':      'auth',
    'user-lockouts':    'lockouts',
    'tokens':           'tokens',
    'system-settings':  'settings',
    'rate-limits':      'rate-limits',
    'network-security': 'network',
    'webhook-security': 'webhooks',
    'dlp-config':       'dlp',
  }
  if (leaf.id in SYSTEM_LEAF_TO_TAB) {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <SystemSettingsHubPage initialTab={SYSTEM_LEAF_TO_TAB[leaf.id] as any} />
      </LeafErrorBoundary>
    )
  }

  // LLM Extras — native v3 LLMExtrasHubPage. The standalone leaves
  // `ollama` (Ollama Hosts), `tiered-fc` (Tiered Function Calling),
  // and `llm-performance` route here so they get the v3 chrome
  // instead of the legacy v2 LLMOllamaView / TieredFCConfigView /
  // LLMPerformanceMetrics. Performance is also a sub-tab under
  // Provider Management (B'-22) — both paths reach the same data.
  if (leaf.id === 'ollama' || leaf.id === 'tiered-fc' || leaf.id === 'llm-performance') {
    const llmExtrasTab =
      leaf.id === 'ollama' ? 'ollama'
      : leaf.id === 'tiered-fc' ? 'tiered-fc'
      : 'performance'
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <LLMExtrasHubPage initialTab={llmExtrasTab as any} />
      </LeafErrorBoundary>
    )
  }

  // MCP Fleet — native v3, replaces the v2 MCPFleet (under pages/tools/)
  // delegated through PageRouter. Built on primitives-v3 so theme/density
  // tokens are honored. 6 sub-tabs: Overview · Tools · Logs · Config ·
  // IAM · Cost. SSE-fed live activity drawer + SSE-fed Logs tab fall back
  // to /api/admin/mcp-logs polling when SSE auth is unavailable.
  if (leaf.id === 'mcp-fleet') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <MCPFleetV3 />
      </LeafErrorBoundary>
    )
  }

  // Provider Management — native v3, replaces the v2-delegated
  // LLMProvidersView. Read-only parity with /api/admin/llm-providers +
  // health + dashboard metrics + audit logs; mutation surface is stubbed
  // until the calling session wires CRUD.
  if (leaf.id === 'providers') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <LLMProvidersPage />
      </LeafErrorBoundary>
    )
  }

  // Default Models — native v3, replaces the v2-delegated DefaultModelsView.
  // Read-only parity with /api/admin/llm-providers/default-models +
  // /api/admin/llm-providers/registry + dashboard modelUsage rollup;
  // mutation surface (assign role, switch-to, reset-to-seed) stubbed
  // until the calling session wires it.
  if (leaf.id === 'default-models') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <DefaultModelsPage />
      </LeafErrorBoundary>
    )
  }

  // Model Registry — native v3, replaces the v2-delegated ModelManagementView.
  // Read-only parity with /api/admin/llm-providers/registry?enabledOnly=false
  // + /api/admin/llm-providers + dashboard modelUsage + audit logs;
  // mutation surface (add model, refresh from providers, edit, toggle, delete)
  // stubbed until the calling session wires it.
  if (leaf.id === 'model-management') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <ModelRegistryPage />
      </LeafErrorBoundary>
    )
  }

  // Flows — native v3, consolidates THREE v2-delegated leaves
  // (`workflows`, `executions`, `flow-costs`) into a single page with
  // sub-tabs. Leaf id picks which sub-tab opens by default. Same code,
  // same hooks, same SidePanel — just a different landing tab so deep
  // links from existing operator runbooks keep working.
  if (leaf.id === 'workflows' || leaf.id === 'executions' || leaf.id === 'flow-costs') {
    const initialTab =
      leaf.id === 'executions' ? 'executions' : leaf.id === 'flow-costs' ? 'costs' : 'workflows'
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <WorkflowsPage initialTab={initialTab} />
      </LeafErrorBoundary>
    )
  }

  // Audit Logs — native v3, consolidates TWO v2 leaves into a single
  // page driven by a Scope chip set:
  //   - leaf `audit-logs` (Flows group)   → all-scope, Workflow-resource
  //   - leaf `audit`      (Monitoring)    → admin-scope, all resources
  // Both surfaces previously read from prisma.adminAuditLog +
  // prisma.userQueryAudit so they're truly the same data.
  if (leaf.id === 'audit-logs' || leaf.id === 'audit') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <AuditLogsPage
          initialScope={leaf.id === 'audit' ? 'admin' : 'all'}
          initialResource={leaf.id === 'audit-logs' ? 'Workflow' : 'all'}
        />
      </LeafErrorBoundary>
    )
  }

  // Agent Management — native v3, consolidates FOUR v2 leaves
  // (agent-registry, agent-ops, agent-skills, agent-executions) into
  // a single AgentsHubPage. Leaf id picks the initial sub-tab. Read-only;
  // mutations route back through v2 (?v3=0) for now.
  if (leaf.id.startsWith('agent-')) {
    const initialTab = leaf.id.replace('agent-', '') as AgentsTabId
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <AgentsHubPage initialTab={initialTab} />
      </LeafErrorBoundary>
    )
  }
  
  // Tool Synthesis — native v3, consolidates THREE v2 leaves
  // (synth-management, synth-approvals, synth-stats) into a single
  // hub with sub-tabs. Leaf id picks the initial sub-tab; the legacy
  // "synth-management" id maps to the cleaner "config" sub-tab.
  // Read-only; mutations route back through v2 (?v3=0) for now.
  if (leaf.id.startsWith('synth-')) {
    const initialTab = leaf.id.replace('synth-', '') as SynthesisTab
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <SynthesisHubPage initialTab={initialTab} />
      </LeafErrorBoundary>
    )
  }

  // Prompts — native v3, consolidates FOUR v2 leaves (prompt-modules,
  // pipeline-settings, prompt-effectiveness, prompt-metrics) into a
  // single Prompt Engineering hub. Leaf id picks the initial sub-tab.
  // Read-only; mutations route back through v2 (?v3=0) for now.
  // Note: pipeline-settings was retired with the V1 chat-pipeline rip
  // (2026-05-05); the Pipeline sub-tab here is a deprecation index that
  // points operators at the surfaces that replaced it.
  if (
    leaf.id === 'prompt-modules' ||
    leaf.id === 'pipeline-settings' ||
    leaf.id === 'prompt-effectiveness' ||
    leaf.id === 'prompt-metrics'
  ) {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <PromptsHubPage initialTab={leaf.id} />
      </LeafErrorBoundary>
    )
  }

  // Monitoring — native v3, consolidates EIGHT v2 leaves (user-activity,
  // analytics, feedback, errors, context-window, embeddings,
  // cluster-health, test-harness) into a single Monitoring hub with
  // sub-tabs. Leaf id picks the initial sub-tab. Read-only; the v2
  // mutation surfaces (test-harness "Light It Up", debug actions in the
  // legacy Monitoring view) stay in v2 — operators hop with `?v3=0`.
  if (leaf.id in MONITORING_LEAF_TO_TAB) {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <MonitoringHubPage initialTab={MONITORING_LEAF_TO_TAB[leaf.id]} />
      </LeafErrorBoundary>
    )
  }

  // Flow Operations — native v3, consolidates FOUR v2-delegated leaves
  // (`credentials`, `governance`, `kpi-dashboard`, `teams`) into a single
  // FlowsExtrasHubPage with sub-tabs. Leaf id picks the initial sub-tab.
  // Read-only; mutations route back through v2 (?v3=0) for now.
  if (
    leaf.id === 'credentials' ||
    leaf.id === 'governance' ||
    leaf.id === 'kpi-dashboard' ||
    leaf.id === 'teams'
  ) {
    const initialTab: FlowsExtrasTab =
      leaf.id === 'governance'
        ? 'governance'
        : leaf.id === 'kpi-dashboard'
          ? 'kpis'
          : leaf.id === 'teams'
            ? 'teams'
            : 'credentials'
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <FlowsExtrasHubPage initialTab={initialTab} />
      </LeafErrorBoundary>
    )
  }

  // Integrations — native v3, consolidates THREE v2-delegated leaves
  // (`slack`, `ms-teams`, `integration-logs`) into a single
  // IntegrationsHubPage with sub-tabs. Leaf id picks the initial sub-tab.
  // Read-only; mutations route back through v2 (?v3=0) for now.
  if (leaf.id === 'slack' || leaf.id === 'ms-teams' || leaf.id === 'integration-logs') {
    const initialTab: IntegrationsHubTab =
      leaf.id === 'ms-teams' ? 'ms-teams' : leaf.id === 'integration-logs' ? 'logs' : 'slack'
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <IntegrationsHubPage initialTab={initialTab} />
      </LeafErrorBoundary>
    )
  }

  // Content & Data — native v3, consolidates FOUR v2 leaves (templates,
  // shared-kb, data-layer, user-memory) into a single ContentHubPage with
  // sub-tabs. Leaf id picks the initial sub-tab. Read-only; mutations
  // route back through v2 (?v3=0) for now.
  if (
    leaf.id === 'templates' ||
    leaf.id === 'shared-kb' ||
    leaf.id === 'data-layer' ||
    leaf.id === 'user-memory'
  ) {
    const initialTab = leaf.id as ContentHubTab
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <ContentHubPage initialTab={initialTab} />
      </LeafErrorBoundary>
    )
  }

  // Cost Management — native v3, single leaf `chargeback`. Replaces
  // the v2-delegated ChargebackView (which mapped to `chargeback-dashboard`
  // in PageRouter). Read-only; budget/report mutations route back through
  // v2 (?v3=0) for now.
  if (leaf.id === 'chargeback') {
    return (
      <LeafErrorBoundary leafName={leaf.name}>
        <ChargebackPage />
      </LeafErrorBoundary>
    )
  }

  return (
    <LeafErrorBoundary leafName={leaf.name}>
      <div style={{ padding: 32, color: 'var(--fg-3)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--fg-1)' }}>
          {leaf.name}
        </div>
        <div style={{ fontSize: 13 }}>
          This leaf is not yet wired into the v3 admin shell. File a ticket if you reached it
          from the sidebar — every sidebar entry has a native v3 handler.
        </div>
      </div>
    </LeafErrorBoundary>
  )
}
