/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * AdminConsoleHost — wires AdminConsole into the app: derives the avatar
 * initials from auth, and provides the Admin-Agent dock + notifications
 * sheet triggers.
 *
 * The rewrite owns its own chrome; this host only supplies app-level
 * context (auth) and the two overlay surfaces the topbar pill + bell
 * open. The Admin-Agent dock is the REAL SSE-backed surface (POSTs to
 * /api/admin/ai/ask, streams content events); the notifications sheet
 * is still a Phase-0 placeholder.
 */
import * as React from 'react'
import { useAuth } from '../../../app/providers/AuthContext'
import { AdminQueryProvider } from '../hooks/useAdminQuery'
import { AdminConsole, LEAF_INDEX, DOMAIN_BY_ID, HOME_DOMAIN_ID } from './index'
import { Banner, Btn } from './primitives'
import SharedAgentPanel from '@/features/chat/components/SharedAgentPanel'
import { apiEndpoint } from '@/utils/api'

export interface AdminConsoleHostProps {
  /**
   * Exit the admin console back to chat. Wired by AdminPortalHost to
   * closeUI('showAdminPortal') so the avatar menu's "Back to chat" returns
   * to the chat surface.
   */
  onClose?: () => void
}

export default function AdminConsoleHost({ onClose }: AdminConsoleHostProps = {}) {
  const { user, logout } = useAuth()
  const [agentOpen, setAgentOpen] = React.useState(false)
  const [notifOpen, setNotifOpen] = React.useState(false)

  // Deep-link navigation from the Admin Agent. AdminAIPanel intercepts
  // anchor clicks in the AI response (e.g. `[Open Models](#model-management)`)
  // and dispatches `openagentic-admin:navigate` with { detail: { slug } }.
  // The slug vocabulary the agent emits is the legacy sidebar corpus
  // (admin-page-corpus.ts) — we translate it to a v4 console leaf/domain id
  // (resolveV4Slug) and set the location hash, which AdminConsole's own
  // hashchange listener picks up to navigate the shell. Closing the dock
  // is owned by AdminAIPanel (it calls onClose after dispatching).
  React.useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent<{ slug?: string }>).detail
      const raw = detail?.slug
      if (!raw || typeof raw !== 'string') return
      const target = resolveV4Slug(raw)
      if (typeof window !== 'undefined') {
        window.location.hash = `#${target}`
      }
    }
    window.addEventListener('openagentic-admin:navigate', onNav as EventListener)
    return () => window.removeEventListener('openagentic-admin:navigate', onNav as EventListener)
  }, [])

  const initials = React.useMemo(() => {
    const src = user?.displayName ?? user?.email ?? ''
    return (
      src
        .split(/[\s@.]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() ?? '')
        .join('') || '?'
    )
  }, [user])

  return (
    <AdminQueryProvider>
      <AdminConsole
        avatarInitials={initials}
        avatarTitle={user?.email ?? 'admin'}
        bellCount={0}
        onOpenAgent={() => setAgentOpen(true)}
        onOpenNotif={() => setNotifOpen(true)}
        onExit={onClose}
        onSignOut={logout}
      />

      {/* Admin agent — the SHARED left slide-out agent panel (chat-grade
          renderer + live SSE, off the main chat pipeline). The v4 TopBar
          "Ask AI" pill drives `agentOpen` via onOpenAgent; the panel POSTs
          directly to /api/admin/ai/ask and streams the answer live. Deep
          links in the answer (bare `#slug` anchors) re-fire
          `openagentic-admin:navigate`, handled by the effect above, which
          translates the slug via resolveV4Slug and sets the location hash. */}
      <SharedAgentPanel
        open={agentOpen}
        onOpenChange={setAgentOpen}
        endpoint={apiEndpoint('/admin/ai/ask')}
        title="Admin Agent"
        placeholder="Find a setting · explain a page · walk me through…"
        suggestions={ADMIN_AGENT_SUGGESTIONS}
        buildContext={() => ({
          currentSection:
            typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '',
        })}
        onNavigate={(slug) => {
          // Preserve the existing admin deep-link path: dispatch the same
          // navigate event the old AdminAIPanel fired, then close the panel
          // so the user lands on the destination page. The host effect maps
          // the slug → v4 leaf/domain (resolveV4Slug) → location hash.
          window.dispatchEvent(
            new CustomEvent('openagentic-admin:navigate', { detail: { slug } }),
          )
          setAgentOpen(false)
        }}
      />

      {/* Notifications sheet — Phase-0 placeholder; the live findings +
          recommendations feed lands in a later phase. */}
      {notifOpen && (
        <OverlaySheet title="Notifications" sub="findings · advisories" onClose={() => setNotifOpen(false)}>
          <Banner tone="info">Live findings + recommendations feed is wired in a later phase.</Banner>
        </OverlaySheet>
      )}
    </AdminQueryProvider>
  )
}

/**
 * Default in-product suggestions for the Admin Agent (mirrors the v3 set).
 * Plain strings — the SharedAgentPanel renders them as suggestion chips.
 */
const ADMIN_AGENT_SUGGESTIONS: string[] = [
  'How do I add a model to the registry?',
  'What does Tiered Function Calling do?',
  'Where do I configure DLP rules?',
  'Show me users approaching their token cap',
  'Walk me through enabling a new provider',
]

/**
 * Translate a deep-link slug emitted by the Admin Agent into a v4 console
 * route id. The agent emits the legacy sidebar-corpus vocabulary
 * (services/.../admin/ai/admin-page-corpus.ts) which has drifted from the
 * v4 console's canonical leaf ids. We map the known divergent slugs; if the
 * slug already matches a v4 leaf or domain we pass it through; anything we
 * can't resolve falls back to the Home dashboard so the link still jumps
 * somewhere sensible rather than a dead hash.
 */
const SLUG_ALIASES: Record<string, string> = {
  // Home / overview
  overview: HOME_DOMAIN_ID,
  // Models & Providers
  'llm-default-models': 'default-models',
  'llm-router-tuning': 'router-tuning',
  // Flows (legacy `native-*` + `flows-*`)
  'native-workflow-list': 'workflows',
  'native-workflows': 'workflows',
  'native-workflow-settings': 'workflows',
  'native-execution-list': 'executions',
  'native-workflow-costs': 'flow-costs',
  'native-workflow-credentials': 'credentials',
  'flows-audit-logs': 'audit-logs',
  'flows-kpis': 'kpi-dashboard',
  // Tools & MCP
  'mcp-management': 'mcp-fleet',
  'mcp-logs': 'mcp-fleet',
  'mcp-kubernetes': 'mcp-fleet',
  'test-harness': 'test-harness',
  // Integrations
  'slack-integration': 'slack',
  'teams-integration': 'ms-teams',
  // Observability / monitoring
  audit: 'audit',
  analytics: 'analytics',
  network: 'network-security',
  'context-window': 'context-window',
  'user-activity': 'user-activity',
  // System & Security
  'user-lockout': 'user-lockouts',
  settings: 'system-settings',
  'dlp-config': 'dlp-config',
}

function resolveV4Slug(raw: string): string {
  const slug = raw.toLowerCase()
  // 1) Already a valid v4 leaf or domain id — use as-is.
  if (LEAF_INDEX[slug] || DOMAIN_BY_ID[slug]) return slug
  // 2) Known legacy-corpus alias.
  const aliased = SLUG_ALIASES[slug]
  if (aliased && (LEAF_INDEX[aliased] || DOMAIN_BY_ID[aliased])) return aliased
  // 3) Unresolvable — land on Home rather than a dead hash.
  return HOME_DOMAIN_ID
}

function OverlaySheet({
  title,
  sub,
  onClose,
  children,
}: {
  title: string
  sub: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'color-mix(in srgb, var(--bg-0) 62%, transparent)',
          backdropFilter: 'blur(3px)',
          zIndex: 60,
        }}
        onClick={onClose}
      />
      <aside
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: '94vw',
          background: 'var(--bg-1)',
          borderLeft: '1px solid var(--line-2)',
          zIndex: 61,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 70px -20px color-mix(in srgb, var(--bg-0) 80%, transparent)',
        }}
      >
        <div
          style={{
            padding: '16px 18px',
            borderBottom: '1px solid var(--line-1)',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg-0)' }}>{title}</div>
            <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>{sub}</div>
          </div>
          <Btn variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Btn>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>{children}</div>
      </aside>
    </>
  )
}
