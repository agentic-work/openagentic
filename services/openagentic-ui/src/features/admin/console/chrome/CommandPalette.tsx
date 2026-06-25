/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * CommandPalette (cmd-K) — jump to any domain or leaf, including by
 * 2-letter mnemonic. Matches the mock palette: fuzzy match over domain
 * name + leaf name + mnemonic; arrow keys + Enter to select; Esc closes.
 *
 * The mnemonic-jump contract: typing a leaf's 2-char mnemonic (e.g. "lp",
 * "fx", "mh") surfaces and selects that leaf — the keyboard jump the
 * blueprint §3.2 requires (65 unique mnemonics).
 */
import * as React from 'react'
import { ADMIN_DOMAINS, LEAF_BY_MNEMONIC } from '../ADMIN_IA'

interface PalRow {
  type: string
  name: string
  ic: string
  go: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onNavDomain: (domainId: string) => void
  onNavLeaf: (domainId: string, leafId: string) => void
}

export function CommandPalette({ open, onClose, onNavDomain, onNavLeaf }: CommandPaletteProps) {
  const [q, setQ] = React.useState('')
  const [sel, setSel] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      const t = setTimeout(() => inputRef.current?.focus(), 40)
      return () => clearTimeout(t)
    }
  }, [open])

  const rows = React.useMemo<PalRow[]>(() => {
    const query = q.toLowerCase().trim()
    const out: PalRow[] = []
    // Exact mnemonic jump floats to the very top.
    if (LEAF_BY_MNEMONIC[query]) {
      const leafId = LEAF_BY_MNEMONIC[query]
      for (const d of ADMIN_DOMAINS) {
        const leaf = d.leaves.find((l) => l.id === leafId)
        if (leaf) {
          out.push({
            type: 'Page',
            name: `${d.name} · ${leaf.name}  (${leaf.mn})`,
            ic: '▤',
            go: () => onNavLeaf(d.id, leaf.id),
          })
        }
      }
    }
    for (const d of ADMIN_DOMAINS) {
      if (!query || d.name.toLowerCase().includes(query)) {
        out.push({ type: 'Domain', name: d.name, ic: '▦', go: () => onNavDomain(d.id) })
      }
      for (const l of d.leaves) {
        const hay = `${l.name} ${d.name} ${l.mn}`.toLowerCase()
        if (query && l.mn === query) continue // already floated above
        if (!query || hay.includes(query)) {
          out.push({
            type: 'Page',
            name: `${d.name} · ${l.name}`,
            ic: '▤',
            go: () => onNavLeaf(d.id, l.id),
          })
        }
      }
    }
    return out
  }, [q, onNavDomain, onNavLeaf])

  React.useEffect(() => {
    setSel(0)
  }, [q])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(rows.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rows[sel]) {
        onClose()
        rows[sel].go()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="awc-palette" onClick={onClose}>
      <div className="awc-palbox" onClick={(e) => e.stopPropagation()}>
        <div className="awc-palsearch">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--fg-2)" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            placeholder="Jump to any page or domain — try a 2-char mnemonic (lp, fx, mh)…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <span className="awc-cmdk__kbd">esc</span>
        </div>
        <div className="awc-palresults">
          {rows.length === 0 ? (
            <div className="awc-palempty">No matches</div>
          ) : (
            rows.slice(0, 40).map((r, i) => (
              <button
                key={i}
                className={'awc-palitem' + (i === sel ? ' awc-sel' : '')}
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  onClose()
                  r.go()
                }}
              >
                <span className="awc-pi">{r.ic}</span>
                <span>{r.name}</span>
                <span className="awc-ptype">{r.type}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
