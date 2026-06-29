/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * AdminConsole — root mount for the ground-up admin rewrite.
 *
 * This is the NEW DEFAULT admin surface (mounted by AdminPortalHost).
 * `?v3=1` / `?legacy=1` (or localStorage aw-admin-console=0) escapes back
 * to the shell-v3 host during cutover.
 *
 * Phase 0 wires the Shell chrome + nav + primitives + tokens + the
 * per-leaf two-part contract (PlaceholderLeaf body + optionSpecPanel).
 * Phase 1+ swaps the placeholder body for the real, wired, mock-fidelity
 * page via the `PAGES` registry (added in later phases) — the chrome and
 * nav do not change.
 *
 * Routing: the active leaf is reflected in window.location.hash so deep
 * links (#providers, #cluster-health, …) and back/forward work. A bare
 * hash (or `#home`) lands on the Home dashboard.
 */
import * as React from 'react'
import { DOMAIN_BY_ID, HOME_DOMAIN_ID, LEAF_INDEX, domainOfLeaf } from './ADMIN_IA'
import { Shell } from './chrome/Shell'
import { ScopeModal, type ScopeOption } from './chrome/ScopeModal'
import { PlaceholderLeaf } from './pages/PlaceholderLeaf'
import { HomePage, getLeafPage } from './pages/registry'
import type { ScopeInfo } from './chrome/TopBar'

/**
 * Render a leaf's body: the real page when one is registered in
 * pages/registry (PLUS the shared optionSpec tail = the two-part leaf
 * contract, blueprint §1), else the Phase-0 PlaceholderLeaf (which carries
 * its own optionSpec). A registered page renders ONLY its body.
 */
function LeafSlot({ leafId }: { leafId: string }) {
  const Page = getLeafPage(leafId)
  // Real, functional page only. The old "All configurable options" optionSpec
  // inventory was a developer manifest, not a user surface — removed (it does
  // not belong in the operator UX). Pages carry their own working controls.
  if (Page) return <Page leafId={leafId} />
  return <PlaceholderLeaf leafId={leafId} />
}

/**
 * Scope catalog. The open-source build is single-scope ("Local") — there
 * is no multi-tenant control plane. The scope selector renders this one
 * entry so the chrome stays consistent without implying tenants.
 */
const SCOPES: ScopeOption[] = [
  { id: 'local', org: 'Local', name: 'Local', env: 'LOCAL', region: '—', tone: 'info' },
]

function readHash(): string {
  if (typeof window === 'undefined') return HOME_DOMAIN_ID
  const h = window.location.hash.replace(/^#/, '')
  return h || HOME_DOMAIN_ID
}

export interface AdminConsoleProps {
  /** Avatar initials + title (from auth). */
  avatarInitials?: string
  avatarTitle?: string
  /** Bell count (open findings + critical recs); wired in a later phase. */
  bellCount?: number
  /** Open the admin-agent surface (the home hero + topbar pill target). */
  onOpenAgent?: () => void
  /** Open notifications. */
  onOpenNotif?: () => void
  /** Exit the console back to chat (closes the showAdminPortal overlay). */
  onExit?: () => void
  /** Sign out (local-JWT logout via AuthContext). */
  onSignOut?: () => void
  version?: string
}

export default function AdminConsole({
  avatarInitials = 'TW',
  avatarTitle = 'admin',
  bellCount = 0,
  onOpenAgent,
  onOpenNotif,
  onExit,
  onSignOut,
  version = '0.8.0',
}: AdminConsoleProps) {
  const [route, setRoute] = React.useState<string>(() => readHash())
  const [scopeId, setScopeId] = React.useState<string>(SCOPES[0].id)
  const [scopeOpen, setScopeOpen] = React.useState(false)

  React.useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setHash = React.useCallback((id: string) => {
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${id}`)
    setRoute(id)
  }, [])

  // Resolve the route → (domain, leaf).
  const { activeDomain, activeLeaf } = React.useMemo(() => {
    if (LEAF_INDEX[route]) {
      return { activeDomain: LEAF_INDEX[route].domain, activeLeaf: route }
    }
    if (DOMAIN_BY_ID[route]) {
      return { activeDomain: route, activeLeaf: null as string | null }
    }
    return { activeDomain: HOME_DOMAIN_ID, activeLeaf: null as string | null }
  }, [route])

  const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0]
  const scopeInfo: ScopeInfo = { name: scope.name, env: scope.env, envTone: scope.tone }

  const openAgent = React.useCallback(() => onOpenAgent?.(), [onOpenAgent])
  const openNotif = React.useCallback(() => onOpenNotif?.(), [onOpenNotif])

  const renderPage = React.useCallback(
    (leafId: string | null, domainId: string): React.ReactNode => {
      if (leafId) return <LeafSlot key={leafId} leafId={leafId} />
      if (domainId === HOME_DOMAIN_ID || !DOMAIN_BY_ID[domainId]) {
        return (
          <HomePage
            org={scope.org}
            scope={scope.name}
            region={scope.region}
            avatarTitle={avatarTitle}
            onOpenDomain={(d) => setHash(d)}
            onOpenAgent={openAgent}
          />
        )
      }
      // Domain landing — jump to the domain's first leaf so the operator
      // never sees an empty group page (matches the mock's nav behavior).
      const dom = DOMAIN_BY_ID[domainId]
      const first = dom.leaves[0]
      if (first) return <LeafSlot key={first.id} leafId={first.id} />
      return (
        <HomePage
          org={scope.org}
          scope={scope.name}
          region={scope.region}
          avatarTitle={avatarTitle}
          onOpenDomain={(d) => setHash(d)}
          onOpenAgent={openAgent}
        />
      )
    },
    [scope.org, scope.name, scope.region, avatarTitle, setHash, openAgent],
  )

  return (
    <>
      <Shell
        activeLeaf={activeLeaf}
        activeDomain={activeDomain}
        onNavLeaf={(leafId) => {
          // Keep the leaf's domain open + active.
          domainOfLeaf(leafId)
          setHash(leafId)
        }}
        onNavDomain={(domainId) => setHash(domainId)}
        renderPage={renderPage}
        scope={scopeInfo}
        onOpenScope={() => setScopeOpen(true)}
        bellCount={bellCount}
        avatarInitials={avatarInitials}
        avatarTitle={avatarTitle}
        onOpenNotif={openNotif}
        onOpenAgent={openAgent}
        onExit={onExit}
        onSignOut={onSignOut}
        version={version}
        region={scope.region}
      />
      <ScopeModal
        open={scopeOpen}
        scopes={SCOPES}
        activeId={scopeId}
        onClose={() => setScopeOpen(false)}
        onPick={(id) => {
          setScopeId(id)
          setScopeOpen(false)
        }}
      />
    </>
  )
}
