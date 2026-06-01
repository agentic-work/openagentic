import * as React from 'react'
import { ADMIN_NAV } from './sidebar-data'

const LAST_QUERY_KEY = 'aw-cmdk-last-query-v1'
const RECENT_KEY = 'aw-sidebar-recent-leaves-v1'

interface PageItem {
  kind: 'page'
  id: string         // leaf id (used by onSelect)
  name: string       // human-readable leaf name
  group: string      // ADMIN_NAV group title
  key: string        // 2-char vim mnemonic
  haystack: string   // lowercased name + group + key for substring match
}

const PAGE_INDEX: PageItem[] = (() => {
  const out: PageItem[] = []
  for (const g of ADMIN_NAV) {
    for (const l of g.leaves) {
      out.push({
        kind: 'page',
        id: l.id,
        name: l.name,
        group: g.title,
        key: l.key,
        haystack: `${l.name} ${g.title} ${l.key} ${l.id}`.toLowerCase(),
      })
    }
  }
  return out
})()

const PAGE_BY_ID: Record<string, PageItem> = (() => {
  const out: Record<string, PageItem> = {}
  for (const p of PAGE_INDEX) out[p.id] = p
  return out
})()

function readRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onSelect: (leafId: string) => void
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onSelect }) => {
  const [query, setQuery] = React.useState<string>(() => {
    try { return localStorage.getItem(LAST_QUERY_KEY) ?? '' } catch { return '' }
  })
  const [activeIdx, setActiveIdx] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  // Focus the input + reset cursor on open.
  React.useEffect(() => {
    if (!open) return
    setActiveIdx(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  React.useEffect(() => {
    try { localStorage.setItem(LAST_QUERY_KEY, query) } catch { /* ignore */ }
  }, [query])

  // Build the result set. Empty query → recent first then all pages
  // grouped by sidebar group title. Non-empty → fuzzy filter on
  // haystack, ranked by where the substring hits (name > group > id).
  const sections = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      const recent = readRecentIds().slice(0, 5)
        .map((id) => PAGE_BY_ID[id])
        .filter((x): x is PageItem => !!x)
      const recentIdSet = new Set(recent.map((p) => p.id))
      const grouped: { title: string; items: PageItem[] }[] = []
      if (recent.length > 0) grouped.push({ title: 'recent', items: recent })
      for (const g of ADMIN_NAV) {
        const items = PAGE_INDEX.filter((p) => p.group === g.title && !recentIdSet.has(p.id))
        if (items.length > 0) grouped.push({ title: g.title, items })
      }
      return grouped
    }
    // Substring match — rank by where the match lands.
    const matches = PAGE_INDEX
      .map((p) => {
        const idx = p.haystack.indexOf(q)
        if (idx < 0) return null
        // Earlier match wins; ties broken alphabetically by name.
        return { p, score: idx }
      })
      .filter((x): x is { p: PageItem; score: number } => !!x)
      .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
      .slice(0, 50)
      .map((x) => x.p)
    return matches.length > 0 ? [{ title: 'pages', items: matches }] : []
  }, [query])

  const flatItems: PageItem[] = React.useMemo(
    () => sections.flatMap((s) => s.items),
    [sections],
  )

  // Clamp active index when results change.
  React.useEffect(() => {
    setActiveIdx((prev) => Math.min(prev, Math.max(0, flatItems.length - 1)))
  }, [flatItems.length])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[activeIdx]
      if (item) {
        onSelect(item.id)
        onClose()
      }
      return
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      onKeyDown={onKey}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--color-shadow) 45%, transparent)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1000,
        paddingTop: '15vh',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          position: 'relative',
          width: 640,
          maxHeight: '60vh',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          color: 'var(--fg-0)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-v3-body)',
          boxShadow: '0 20px 80px color-mix(in srgb, var(--color-shadow) 45%, transparent)',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background:
              'linear-gradient(90deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 40%, transparent) 25%, transparent 60%)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--line-1)',
          }}
        >
          <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            /
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search resources, pages, agents…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--fg-0)',
              fontFamily: 'var(--font-v3-body)',
              fontSize: 14,
            }}
          />
          <kbd
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              padding: '2px 6px',
              border: '1px solid var(--line-2)',
              color: 'var(--fg-3)',
            }}
          >
            esc
          </kbd>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {sections.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--fg-3)', textAlign: 'center', fontSize: 13 }}>
              no matches
            </div>
          ) : (
            sections.map((sec) => {
              const startIdx = flatItems.indexOf(sec.items[0])
              return (
                <div key={sec.title}>
                  <div
                    style={{
                      padding: '6px 14px',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.18em',
                      color: 'var(--fg-3)',
                      fontFamily: 'var(--font-v3-body)',
                      background: 'var(--bg-1)',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      borderBottom: '1px solid var(--line-1)',
                    }}
                  >
                    {sec.title}
                  </div>
                  {sec.items.map((item, i) => {
                    const flatIdx = startIdx + i
                    const isActive = flatIdx === activeIdx
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setActiveIdx(flatIdx)}
                        onClick={() => { onSelect(item.id); onClose() }}
                        style={{
                          appearance: 'none',
                          border: 'none',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 14px',
                          background: isActive ? 'var(--bg-3)' : 'transparent',
                          color: 'var(--fg-0)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontFamily: 'var(--font-v3-body)',
                          fontSize: 13,
                          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 9,
                            padding: '1px 4px',
                            border: '1px solid var(--line-1)',
                            background: 'var(--bg-2)',
                            color: 'var(--fg-3)',
                            minWidth: 24,
                            textAlign: 'center',
                          }}
                        >
                          {item.key}
                        </span>
                        <span>{item.name}</span>
                        <span style={{ marginLeft: 'auto', color: 'var(--fg-3)', fontSize: 11 }}>
                          {item.group}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
        <div
          style={{
            padding: '6px 14px',
            borderTop: '1px solid var(--line-1)',
            display: 'flex',
            justifyContent: 'space-between',
            color: 'var(--fg-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
          }}
        >
          <span>↑ ↓ navigate · ↵ open · esc close</span>
          <span>{flatItems.length} match{flatItems.length === 1 ? '' : 'es'}</span>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
