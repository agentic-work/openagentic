import { describe, expect, it } from 'vitest'
import { SIDEBAR_GROUPS, TOP_LEVEL_ITEMS, allSidebarIds } from '../sidebar-items'
import { ADMIN_PAGES } from '../../../../../e2e/helpers/pages'

describe('sidebar-items', () => {
  it('declares exactly 1 top-level item + 11 groups', () => {
    expect(TOP_LEVEL_ITEMS).toHaveLength(1)
    expect(TOP_LEVEL_ITEMS[0].id).toBe('overview')
    expect(SIDEBAR_GROUPS).toHaveLength(11)
  })

  it('every leaf id appears in ADMIN_PAGES registry (no fabricated pages)', () => {
    const pageIds = new Set(ADMIN_PAGES.map(p => p.id))
    const sidebarLeaves = SIDEBAR_GROUPS.flatMap(g => g.children.map(c => c.id))
    for (const id of sidebarLeaves) {
      expect(pageIds.has(id), `sidebar has page '${id}' that is not in ADMIN_PAGES registry`).toBe(true)
    }
  })

  it('every ADMIN_PAGES registry id is reachable from the sidebar', () => {
    const allIds = new Set(allSidebarIds())
    for (const p of ADMIN_PAGES) {
      expect(allIds.has(p.id), `page '${p.id}' in registry has no sidebar entry`).toBe(true)
    }
  })

  it('exact total: 1 overview + 64 leaf items = 65 pages (added agent-ops 2026-04-26)', () => {
    const total = TOP_LEVEL_ITEMS.length + SIDEBAR_GROUPS.flatMap(g => g.children).length
    expect(total).toBe(65)
  })
})
