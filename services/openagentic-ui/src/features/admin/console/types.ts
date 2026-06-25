/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Admin Console (rewrite) — shared types.
 *
 * This is the ground-up rewrite home. The shell chrome, the nav
 * taxonomy (ADMIN_IA), the option-spec inventory (ADMIN_INV), the
 * shared primitives, and the theme tokens here are FINAL. The 65 page
 * BODIES are filled per-phase; until a phase lands, a leaf renders a
 * placeholder body + its optionSpecPanel.
 *
 * Canonical leaf id = the contract key. It is the route segment, the
 * ADMIN_INV[leafId] key, the future PAGES[leafId] renderer key, and the
 * API deep-link. Display titles + grouping are a presentation view on
 * top of the canonical ids (blueprint §0).
 */

/** Page mode badge tone (blueprint §3.3). */
export type LeafMode = 'editable' | 'readonly' | 'hitl' | 'deprecated'

/** Status tone — resolves to var(--ok|--warn|--err|--info|...). */
export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'muted' | 'accent' | 'purple' | 'teal'

/** A single leaf (one route, one page) inside a domain. */
export interface AdminConsoleLeaf {
  /** Canonical id — the contract key (route segment + INV key). */
  id: string
  /** Display name shown in the sidebar + crumbs + page head. */
  name: string
  /** 2-char vim-style mnemonic for cmd-K + keyboard jump. Unique. */
  mn: string
}

/** A top-level domain (sidebar group). */
export interface AdminConsoleDomain {
  /** Domain id (sidebar group key). */
  id: string
  /** Display title (e.g. "Models & Providers"). */
  name: string
  /** Domain SVG icon path (single <path d="...">). */
  icon: string
  /** Leaves under this domain, in sidebar order. */
  leaves: AdminConsoleLeaf[]
}

/** A leaf with its resolved parent domain, for index lookups. */
export interface AdminConsoleLeafIndexEntry extends AdminConsoleLeaf {
  domain: string
  domainName: string
}

/**
 * One configurable-option row of a leaf's "All configurable options"
 * inventory table (ported verbatim from the mock INV). Tuple form:
 *   [label, type, detail]
 * where `type` selects the TYPE_META icon + mock control, and `detail`
 * is the wiring note.
 */
export type OptionSpecRow = readonly [label: string, type: OptionSpecType, detail: string]

/** Inventory option control type → drives TYPE_META icon + mock control. */
export type OptionSpecType =
  | 'toggle'
  | 'select'
  | 'number-input'
  | 'text-input'
  | 'action-button'
  | 'table'
  | 'chart'
  | 'tab'
  | 'side-panel'
  | 'form'
  | 'badge'
  | 'list'
  | 'kpi'

/** Per-leaf inventory: the display domain label + its option-spec rows. */
export interface OptionSpecInventory {
  domain: string
  opts: OptionSpecRow[]
}
