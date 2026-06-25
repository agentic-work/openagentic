/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * PlaceholderLeaf — the Phase-0 leaf body.
 *
 * Every leaf renders its two-part contract (blueprint §1):
 *   1. a rich/generic BODY (a Phase-0 placeholder until the page's phase
 *      lands), and
 *   2. its optionSpecPanel (the ADMIN_INV "All configurable options"
 *      table).
 *
 * The chrome, nav, primitives, tokens, mode badge, and the option-spec
 * inventory are FINAL here. Phase 1+ replaces only the placeholder body
 * with the wired, mock-fidelity page.
 */
import * as React from 'react'
import { LEAF_INDEX } from '../ADMIN_IA'
import { ADMIN_INV } from '../ADMIN_INV'
import { leafMode, leafModeLabel, leafOptionCount, leafPrimaryAction } from '../leafMeta'
import { Banner, OptionSpec, PageHead, type PageHeadAction } from '../primitives'

export function PlaceholderLeaf({ leafId }: { leafId: string }) {
  const leaf = LEAF_INDEX[leafId]
  const mode = leafMode(leafId)
  const optCount = leafOptionCount(leafId)
  const primary = leafPrimaryAction(leafId)

  const actions: PageHeadAction[] = []
  if (primary && (mode === 'editable' || mode === 'hitl')) {
    actions.push({ label: primary, ic: '＋ ', primary: true })
  }

  const title = leaf?.name ?? leafId
  const domainName = leaf?.domainName ?? 'Admin'
  const hasInv = !!ADMIN_INV[leafId]

  return (
    <>
      <PageHead
        title={title}
        sub={`${optCount} configurable options · ${domainName} · ${leafModeLabel(mode)}`}
        actions={actions}
        mode={mode}
      />
      <Banner tone="info">
        <span>
          <b>{title}</b> — Phase 0 shell. The chrome, navigation, primitives, tokens, and the full
          option-spec inventory below are final. This page body is wired to its real endpoint in a
          later phase; the configurable surface is enumerated below.
        </span>
      </Banner>
      {hasInv ? (
        <OptionSpec leafId={leafId} />
      ) : (
        <Banner tone="warn">
          No option-spec inventory registered for <b>{leafId}</b>.
        </Banner>
      )}
    </>
  )
}
