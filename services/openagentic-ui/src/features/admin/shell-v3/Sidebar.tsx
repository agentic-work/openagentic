import * as React from 'react'
import { ADMIN_NAV } from './sidebar-data'
import { useSidebarCounts } from '../hooks/useSidebarCounts'
import { isEnterpriseLeaf } from '../shell-v2/pageRouter'
import { useTheme as useChatTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/app/providers/AuthContext'
import SettingsMenu from '@/features/chat/components/SettingsMenu'
import { getGroupIcon } from './AdminGroupIcons'
import './styles.css'

export interface SidebarProps {
  active: string
  onSelect: (id: string) => void
  /** Optional sign-out handler (wires to AuthContext.logout in caller). */
  onSignOut?: () => void
}

// B'-18: collapsed-state per group, persisted across sessions.
// Default: ALL groups collapsed (per the user's request) EXCEPT the
// group containing the currently-active leaf — that group auto-opens
// so the operator always sees where they are.
const COLLAPSED_KEY = 'aw-sidebar-collapsed-groups-v1'

// C5 (2026-05-07): pinned + recently-visited support.
const PINNED_KEY = 'aw-sidebar-pinned-leaves-v1'
const RECENT_KEY = 'aw-sidebar-recent-leaves-v1'
const RECENT_LIMIT = 5

function readPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}
function writePinned(arr: string[]) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify(arr)) } catch { /* ignore */ }
}
function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((s): s is string => typeof s === 'string').slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}
function writeRecent(arr: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, RECENT_LIMIT))) } catch { /* ignore */ }
}

// Flat (id → leaf) lookup so the pinned + recent rails can render leaf
// metadata (name, key) without re-walking ADMIN_NAV every render.
const LEAF_BY_ID: Record<string, { id: string; key: string; name: string }> = (() => {
  const out: Record<string, { id: string; key: string; name: string }> = {}
  for (const g of ADMIN_NAV) for (const l of g.leaves) out[l.id] = { id: l.id, key: l.key, name: l.name }
  return out
})()

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((s): s is string => typeof s === 'string'))
  } catch {
    return new Set()
  }
}

function writeCollapsed(set: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

/** Group title containing the given leaf id, or undefined if not found. */
function groupOf(leafId: string): string | undefined {
  for (const g of ADMIN_NAV) {
    if (g.leaves.some((l) => l.id === leafId)) return g.title
  }
  return undefined
}

export const Sidebar = ({ active, onSelect, onSignOut }: SidebarProps) => {
  const { counts, liveLeaves } = useSidebarCounts()
  const { theme: chatTheme, changeTheme } = useChatTheme()
  const { user } = useAuth()

  // Collapsed-state: on first visit (no localStorage), every group
  // starts collapsed except the active leaf's group. Subsequent
  // visits honor the operator's persisted choices but still ensure
  // the active leaf's group is open.
  const [collapsed, setCollapsedState] = React.useState<Set<string>>(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY)
    const activeGroup = groupOf(active)
    if (stored == null) {
      // First visit — collapse everything except the active group.
      const all = new Set(ADMIN_NAV.map((g) => g.title))
      if (activeGroup) all.delete(activeGroup)
      writeCollapsed(all)
      return all
    }
    const persisted = readCollapsed()
    // Defensive: ensure active group is always open
    if (activeGroup && persisted.has(activeGroup)) {
      persisted.delete(activeGroup)
    }
    return persisted
  })

  // When `active` changes (operator clicked a leaf in a different
  // group), open that group automatically.
  React.useEffect(() => {
    const g = groupOf(active)
    if (!g) return
    setCollapsedState((prev) => {
      if (!prev.has(g)) return prev
      const next = new Set(prev)
      next.delete(g)
      writeCollapsed(next)
      return next
    })
  }, [active])

  function toggleGroup(title: string) {
    setCollapsedState((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      writeCollapsed(next)
      return next
    })
  }

  // C5: pinned + recent state.
  const [pinned, setPinned] = React.useState<string[]>(() => readPinned())
  const [recent, setRecent] = React.useState<string[]>(() => readRecent())

  function togglePin(leafId: string) {
    setPinned((prev) => {
      const next = prev.includes(leafId) ? prev.filter((x) => x !== leafId) : [...prev, leafId]
      writePinned(next)
      return next
    })
  }

  // Wrap onSelect to also push the leaf into the recent-visited list
  // (most recent first, deduped, capped at RECENT_LIMIT).
  const selectAndTrack = React.useCallback(
    (leafId: string) => {
      onSelect(leafId)
      setRecent((prev) => {
        const next = [leafId, ...prev.filter((x) => x !== leafId)].slice(0, RECENT_LIMIT)
        writeRecent(next)
        return next
      })
    },
    [onSelect],
  )

  // Render a non-group leaf row reused for pinned + recent rails.
  const renderRailLeaf = (leafId: string) => {
    const leaf = LEAF_BY_ID[leafId]
    if (!leaf) return null
    const isPinned = pinned.includes(leafId)
    return (
      <button
        key={leafId}
        className="aw-sidebar__leaf"
        aria-current={active === leafId ? 'page' : undefined}
        onClick={() => selectAndTrack(leafId)}
      >
        <span className="aw-sidebar__leaf-key">{leaf.key}</span>
        <span className="aw-sidebar__leaf-name">{leaf.name}</span>
        <span
          role="button"
          aria-label={isPinned ? 'unpin' : 'pin'}
          title={isPinned ? 'unpin' : 'pin'}
          onClick={(e) => { e.stopPropagation(); togglePin(leafId) }}
          className="aw-sidebar__leaf-pin"
          style={{ marginLeft: 'auto', cursor: 'pointer', opacity: isPinned ? 1 : 0.55 }}
        >
          {isPinned ? '★' : '☆'}
        </span>
      </button>
    )
  }

  return (
    <aside className="aw-sidebar" aria-label="Admin navigation">
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* C5: pinned rail. Lives at the top of the sidebar so the
            operator's most-used leaves are reachable without unfurling
            any group. Empty until the user pins something. */}
        {pinned.length > 0 && (
          <div className="aw-sidebar__group" key="__pinned__">
            <div className="aw-sidebar__group-title">
              <span className="aw-sidebar__group-ico" aria-hidden="true">★</span>
              <span>pinned</span>
              <span className="aw-sidebar__group-num">{pinned.length}</span>
            </div>
            <div>{pinned.map((id) => renderRailLeaf(id))}</div>
          </div>
        )}
        {ADMIN_NAV.map((group) => {
          const GroupIcon = getGroupIcon(group.title)
          const isCollapsed = collapsed.has(group.title)
          return (
          <div
            className="aw-sidebar__group"
            key={group.title}
            data-collapsed={isCollapsed ? 'true' : undefined}
          >
            <button
              type="button"
              className="aw-sidebar__group-title aw-sidebar__group-title--toggle"
              aria-expanded={!isCollapsed}
              aria-controls={`aw-group-${group.title.replace(/\s+/g, '-')}`}
              onClick={() => toggleGroup(group.title)}
            >
              {GroupIcon && (
                <span className="aw-sidebar__group-ico" aria-hidden="true">
                  <GroupIcon size={12} />
                </span>
              )}
              <span>{group.title}</span>
              <span className="aw-sidebar__group-num">{group.leaves.length}</span>
              <span className="aw-sidebar__group-chev" aria-hidden="true">
                {isCollapsed ? '▸' : '▾'}
              </span>
            </button>
            {!isCollapsed && (
              <div id={`aw-group-${group.title.replace(/\s+/g, '-')}`}>
                {group.leaves.map((leaf) => {
                  const count = counts[leaf.id]
                  const isLive = liveLeaves[leaf.id]
                  const meta = count ?? (isLive ? '●' : undefined)
                  const isPinned = pinned.includes(leaf.id)
                  const isLocked = isEnterpriseLeaf(leaf.id)
                  return (
                    <button
                      key={leaf.id}
                      className={`aw-sidebar__leaf${isLocked ? ' aw-sidebar__leaf--locked' : ''}`}
                      aria-current={active === leaf.id ? 'page' : undefined}
                      title={isLocked ? 'Enterprise edition' : undefined}
                      onClick={() => selectAndTrack(leaf.id)}
                    >
                      <span className="aw-sidebar__leaf-key">{leaf.key}</span>
                      <span className="aw-sidebar__leaf-name">{leaf.name}</span>
                      {isLocked && (
                        <span className="aw-sidebar__leaf-pro" aria-label="enterprise edition">PRO</span>
                      )}
                      {meta && !isLocked && (
                        <span
                          className={`aw-sidebar__leaf-meta ${isLive && !count ? 'aw-sidebar__leaf-meta--live' : ''}`}
                        >
                          {meta}
                        </span>
                      )}
                      {/* C5: per-leaf pin toggle. Visible on hover (CSS),
                          fully visible when already pinned. */}
                      <span
                        role="button"
                        aria-label={isPinned ? 'unpin' : 'pin'}
                        title={isPinned ? 'unpin' : 'pin'}
                        onClick={(e) => { e.stopPropagation(); togglePin(leaf.id) }}
                        className="aw-sidebar__leaf-pin"
                        style={{
                          marginLeft: meta ? 4 : 'auto',
                          cursor: 'pointer',
                          opacity: isPinned ? 1 : 0,
                        }}
                      >
                        {isPinned ? '★' : '☆'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          )
        })}

        {/* C5: recently-visited rail. Lives at the bottom of the scrollable
            list (above Settings & more) so the operator can quickly jump
            back to leaves they were just on. Auto-managed; no UI to clear. */}
        {recent.length > 0 && (
          <div className="aw-sidebar__group" key="__recent__">
            <div className="aw-sidebar__group-title">
              <span className="aw-sidebar__group-ico" aria-hidden="true">↺</span>
              <span>recent</span>
              <span className="aw-sidebar__group-num">{recent.length}</span>
            </div>
            <div>{recent.map((id) => renderRailLeaf(id))}</div>
          </div>
        )}
      </div>

      {/* Settings & more — pinned bottom. Uses the SHARED SettingsMenu
          from chat/flows/codemode so the popover, theme picker, accent
          picker, About / Documentation / Support items, and sign-out are
          identical across all four product surfaces. */}
      <div
        data-aw-settings
        style={{
          borderTop: '1px solid var(--line-1)',
          padding: '8px 0',
          background: 'var(--bg-1)',
          position: 'relative',
        }}
      >
        <SettingsMenu
          isExpanded={true}
          currentTheme={chatTheme ?? 'dark'}
          userName={user?.displayName ?? user?.email ?? 'admin'}
          userEmail={user?.email}
          isAdmin={false /* already inside admin — no Admin Panel item */}
          onThemeChange={(t) => changeTheme?.(t as any)}
          onLogout={onSignOut}
        />
      </div>
    </aside>
  )
}
