/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Shell — the rewrite console chrome.
 *
 * Composes TopBar + Sidebar + main page surface + crumbs + command
 * palette. Owns:
 *   - grid + rail collapse
 *   - density (S/M/L → data-density on the shell root, pure CSS)
 *   - theme dark/light toggle (data-theme on <html> — the global token SoT)
 *   - per-group open/closed state, persisted to localStorage, with the
 *     active domain auto-opened (default-open: models/flows/agents)
 *   - 2-char vim mnemonic keyboard jump (type 2 chars → jump to leaf)
 *   - cmd-K palette open/close
 *
 * The page body itself is supplied by `renderPage(leafId | null)` so the
 * Shell is body-agnostic — Phase 1+ swaps in rich page renderers without
 * touching the chrome.
 */
import * as React from 'react'
import '../theme-bridge.css'
import '../styles.css'
import {
  ADMIN_DOMAINS,
  DEFAULT_OPEN_GROUPS,
  DOMAIN_BY_ID,
  HOME_DOMAIN_ID,
  LEAF_BY_MNEMONIC,
  LEAF_COUNT,
  LEAF_INDEX,
  domainOfLeaf,
} from '../ADMIN_IA'
import { ADMIN_INV_OPTION_COUNT } from '../ADMIN_INV'
import { TopBar, type ScopeInfo } from './TopBar'
import { Sidebar } from './Sidebar'
import { Crumbs } from './Crumbs'
import { CommandPalette } from './CommandPalette'

const OPEN_GROUPS_KEY = 'awc-open-groups'
const DENSITY_KEY = 'awc-density'

type Density = 'compact' | 'cozy' | 'comfortable'

export interface ShellProps {
  /** active leaf id (null = a domain landing / home dashboard). */
  activeLeaf: string | null
  /** active domain id. */
  activeDomain: string
  /** navigate to a leaf (also sets its domain). */
  onNavLeaf: (leafId: string) => void
  /** navigate to a domain landing. */
  onNavDomain: (domainId: string) => void
  /** render the page body for the active route. */
  renderPage: (leafId: string | null, domainId: string) => React.ReactNode
  /** scope pill display. */
  scope: ScopeInfo
  onOpenScope: () => void
  bellCount?: number
  avatarInitials: string
  avatarTitle?: string
  onOpenNotif: () => void
  onOpenAgent: () => void
  /** Exit the admin console back to chat. */
  onExit?: () => void
  /** Sign out (local-JWT logout). */
  onSignOut?: () => void
  version?: string
  region?: string
}

function loadOpenGroups(): Set<string> {
  if (typeof window === 'undefined') return new Set(DEFAULT_OPEN_GROUPS)
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* ignore */
  }
  return new Set(DEFAULT_OPEN_GROUPS)
}

function loadDensity(): Density {
  if (typeof window === 'undefined') return 'cozy'
  const v = window.localStorage.getItem(DENSITY_KEY)
  return v === 'compact' || v === 'comfortable' || v === 'cozy' ? v : 'cozy'
}

function currentTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function Shell({
  activeLeaf,
  activeDomain,
  onNavLeaf,
  onNavDomain,
  renderPage,
  scope,
  onOpenScope,
  bellCount = 0,
  avatarInitials,
  avatarTitle,
  onOpenNotif,
  onOpenAgent,
  onExit,
  onSignOut,
  version = '0.8.0',
  region = 'us-gov-east-1',
}: ShellProps) {
  const [collapsed, setCollapsed] = React.useState(false)
  const [density, setDensity] = React.useState<Density>(() => loadDensity())
  const [theme, setTheme] = React.useState<'dark' | 'light'>(() => currentTheme())
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(() => loadOpenGroups())
  const [cmdkOpen, setCmdkOpen] = React.useState(false)

  // Auto-open the active domain so the active leaf is always visible.
  React.useEffect(() => {
    const dom = activeLeaf ? domainOfLeaf(activeLeaf) ?? activeDomain : activeDomain
    if (dom && dom !== HOME_DOMAIN_ID) {
      setOpenGroups((prev) => {
        if (prev.has(dom)) return prev
        const next = new Set(prev)
        next.add(dom)
        return next
      })
    }
  }, [activeLeaf, activeDomain])

  // Persist open groups.
  React.useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(Array.from(openGroups)))
    } catch {
      /* ignore */
    }
  }, [openGroups])

  // Persist density.
  React.useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_KEY, density)
    } catch {
      /* ignore */
    }
  }, [density])

  const toggleGroup = React.useCallback((domainId: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(domainId)) next.delete(domainId)
      else next.add(domainId)
      return next
    })
  }, [])

  const toggleTheme = React.useCallback(() => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = next
    setTheme(next)
  }, [])

  // cmd-K opens the palette (ignore when typing in an input).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
        e.preventDefault()
        setCmdkOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 2-char vim mnemonic jump — buffer two non-modifier letters, then jump.
  const bufRef = React.useRef<{ keys: string; t: number }>({ keys: '', t: 0 })
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (cmdkOpen) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!/^[a-z]$/i.test(e.key)) {
        bufRef.current = { keys: '', t: 0 }
        return
      }
      const now = Date.now()
      const buf = bufRef.current
      const keys = now - buf.t > 900 ? e.key.toLowerCase() : (buf.keys + e.key.toLowerCase()).slice(-2)
      bufRef.current = { keys, t: now }
      if (keys.length === 2 && LEAF_BY_MNEMONIC[keys]) {
        bufRef.current = { keys: '', t: 0 }
        onNavLeaf(LEAF_BY_MNEMONIC[keys])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cmdkOpen, onNavLeaf])

  // Console boot log — the Phase-0 gate (blueprint §5).
  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      `[admin-console] ready · ${ADMIN_DOMAINS.length} domains · ${LEAF_COUNT} leaves · ` +
        `${Object.keys(LEAF_INDEX).length} indexed · ${ADMIN_INV_OPTION_COUNT} options`,
    )
  }, [])

  const handleNavDomain = React.useCallback(
    (domainId: string) => {
      onNavDomain(domainId)
    },
    [onNavDomain],
  )

  const handleNavLeaf = React.useCallback(
    (_domainId: string, leafId: string) => {
      onNavLeaf(leafId)
    },
    [onNavLeaf],
  )

  return (
    <div className="awc-root" data-density={density} style={{ height: '100%', minHeight: 0 }}>
      <div className={'awc-shell' + (collapsed ? ' awc-rail-collapsed' : '')}>
        <TopBar
          scope={scope}
          density={density}
          theme={theme}
          bellCount={bellCount}
          avatarInitials={avatarInitials}
          avatarTitle={avatarTitle}
          onToggleRail={() => setCollapsed((c) => !c)}
          onLogoClick={() => handleNavDomain(HOME_DOMAIN_ID)}
          onOpenScope={onOpenScope}
          onOpenCmdK={() => setCmdkOpen(true)}
          onSetDensity={setDensity}
          onToggleTheme={toggleTheme}
          onOpenNotif={onOpenNotif}
          onOpenAgent={onOpenAgent}
          onExit={onExit}
          onSignOut={onSignOut}
        />
        <Sidebar
          activeLeaf={activeLeaf}
          activeDomain={activeDomain}
          openGroups={openGroups}
          onToggleGroup={toggleGroup}
          onNavDomain={handleNavDomain}
          onNavLeaf={handleNavLeaf}
          onQuickJump={() => setCmdkOpen(true)}
          collapsed={collapsed}
          version={version}
          region={region}
        />
        <main className="awc-main">
          <div className="awc-maxw awc-fade" key={activeLeaf ?? activeDomain}>
            <Crumbs
              scopeName={scope.name}
              domainId={activeDomain}
              leafId={activeLeaf}
              onScope={onOpenScope}
              onNavDomain={handleNavDomain}
            />
            {renderPage(activeLeaf, activeDomain)}
          </div>
        </main>
      </div>

      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        onNavDomain={(d) => handleNavDomain(d)}
        onNavLeaf={(_d, l) => handleNavLeaf(_d, l)}
      />
    </div>
  )
}

export { DOMAIN_BY_ID }
