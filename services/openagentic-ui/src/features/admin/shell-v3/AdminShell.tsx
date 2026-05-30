import * as React from 'react'
import { TopBar, type Crumb } from './TopBar'
import type { RibbonCell } from './Ribbon'
import { Sidebar } from './Sidebar'
import { ADMIN_NAV, leafById, leafByKey, type AdminLeaf } from './sidebar-data'
import './styles.css'

export interface AdminShellProps {
  /** Active leaf id (e.g. 'dashboard', 'mcp-fleet'). */
  active: string
  onActiveChange: (id: string) => void
  /** Caller renders the page for the active leaf. */
  renderPage: (leaf: AdminLeaf) => React.ReactNode
  /** Live ribbon cells (left of clock). */
  ribbonCells?: RibbonCell[]
  /** Right-aligned clock or status. */
  ribbonClock?: React.ReactNode
  /** Open the cmdk palette (caller mounts it). */
  onOpenCmdK?: () => void
  /** Open the activity drawer (caller mounts it). */
  onOpenActivity?: () => void
  /** Open the Admin AI Agent floating dock (caller mounts the dock). */
  onOpenAgent?: () => void
  /** Close admin console (return to chat / code / flows). */
  onClose?: () => void
  /** Sign-out handler — passed through to Sidebar's footer menu. */
  onSignOut?: () => void
  /** Topbar metadata. */
  scope?: { env: string; region: string }
  user?: { initials: string; name?: string }
  agentLabel?: string
  version?: string
}

export const AdminShell = ({
  active,
  onActiveChange,
  renderPage,
  ribbonCells = [],
  ribbonClock,
  onOpenCmdK,
  onOpenActivity,
  onOpenAgent,
  onClose,
  onSignOut,
  scope,
  user,
  agentLabel,
  version,
}: AdminShellProps) => {
  const [collapsed, setCollapsed] = React.useState(false)

  const leaf = leafById(active) ?? ADMIN_NAV[0].leaves[0]
  const crumbs: Crumb[] = buildCrumbs(active)

  // Vim-style mnemonic jump: type two lowercase chars to navigate.
  React.useEffect(() => {
    let buf = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (!/^[a-z]$/.test(e.key) || e.metaKey || e.ctrlKey || e.altKey) return
      buf += e.key
      if (buf.length >= 2) {
        const target = leafByKey(buf)
        if (target) onActiveChange(target.id)
        buf = ''
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { buf = '' }, 900)
    }
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      if (timer) clearTimeout(timer)
    }
  }, [onActiveChange])

  return (
    <div className="aw-shell aw-shell--no-ribbon" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <TopBar
        crumbs={crumbs}
        onToggleSidebar={() => setCollapsed((c) => !c)}
        onOpenCmdK={onOpenCmdK}
        onOpenActivity={onOpenActivity}
        onOpenAgent={onOpenAgent}
        onClose={onClose}
        scope={scope}
        user={user}
        agentLabel={agentLabel}
        version={version}
      />
      <Sidebar active={active} onSelect={onActiveChange} onSignOut={onSignOut} />
      <main className="aw-main">{renderPage(leaf)}</main>
    </div>
  )
}

// Build admin / group / leaf breadcrumbs based on the leaf id and
// its enclosing group.
function buildCrumbs(active: string): Crumb[] {
  for (const group of ADMIN_NAV) {
    for (const leaf of group.leaves) {
      if (leaf.id === active) {
        return [
          { label: 'admin' },
          { label: group.title },
          { label: leaf.name.toLowerCase(), id: leaf.id },
        ]
      }
    }
  }
  return [{ label: 'admin' }]
}
