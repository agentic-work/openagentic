/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * leafMeta — derives the per-leaf page-head mode badge + primary action
 * from the leaf's ADMIN_INV inventory, mirroring the mock's
 * `genericLeafHead` derivation so every leaf declares a mode without a
 * hand-maintained table:
 *   - deprecated  → inventory mentions "deprecat…"
 *   - readonly    → inventory mentions read-only / locked
 *   - hitl        → inventory mentions HITL (mutating · human-in-the-loop)
 *   - editable    → has a toggle or action-button option
 *   - else readonly (default — a pure read surface)
 *
 * Phase 1+ pages may override `mode` explicitly; this is the Phase 0
 * default so the chrome + spec panel are correct out of the gate.
 */
import { ADMIN_INV } from './ADMIN_INV'
import type { LeafMode, OptionSpecRow } from './types'

function anyDetail(opts: OptionSpecRow[], re: RegExp): boolean {
  return opts.some((o) => re.test(o[2]))
}
function anyLabel(opts: OptionSpecRow[], re: RegExp): boolean {
  return opts.some((o) => re.test(o[0]))
}

/** Resolve the mode badge for a leaf from its inventory. */
export function leafMode(leafId: string): LeafMode {
  const inv = ADMIN_INV[leafId]
  if (!inv) return 'readonly'
  const { opts } = inv
  if (anyDetail(opts, /deprecat/i) || anyLabel(opts, /deprecat/i)) return 'deprecated'
  if (anyDetail(opts, /read-only|READ-ONLY|LockedTag|locked/i) || anyLabel(opts, /read-only/i))
    return 'readonly'
  if (anyDetail(opts, /HITL/) || anyLabel(opts, /HITL/)) return 'hitl'
  if (opts.some((o) => o[1] === 'toggle' || o[1] === 'action-button')) return 'editable'
  return 'readonly'
}

/** Human label for a mode badge. */
export function leafModeLabel(mode: LeafMode): string {
  switch (mode) {
    case 'editable':
      return 'editable'
    case 'hitl':
      return 'mutating · HITL'
    case 'deprecated':
      return 'deprecated'
    case 'readonly':
    default:
      return 'read-only'
  }
}

/** The primary "+ add / new" action label for a leaf, if its inventory declares one. */
export function leafPrimaryAction(leafId: string): string | null {
  const inv = ADMIN_INV[leafId]
  if (!inv) return null
  const hit = inv.opts.find(
    (o) => o[1] === 'action-button' && /^\+|primary/.test(o[0] + o[2]),
  )
  return hit ? hit[0] : null
}

/** Count of configurable options for a leaf (for the page-head meta line). */
export function leafOptionCount(leafId: string): number {
  return ADMIN_INV[leafId]?.opts.length ?? 0
}
