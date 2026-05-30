import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Phase B'-1 — Dashboard tab bar must be sticky as the user scrolls
 * through anchor sections.
 *
 * Two CSS contracts must hold:
 *   1. .aw-subtabs is `position: sticky; top: 0; z-index: >= 3`
 *      (in primitives-v3/styles.css OR in the override layer).
 *   2. Section anchors driven by Subtabs (`#section-…` IDs in Dashboard)
 *      are reachable via scrollIntoView with the sticky bar still
 *      readable — i.e., the Phase A override or component sets
 *      `scroll-margin-top` on those anchors so the section header
 *      isn't hidden under the sticky bar.
 */

const baseStyles = readFileSync(
  join(__dirname, '..', '..', 'features', 'admin', 'primitives-v3', 'styles.css'),
  'utf8',
)
const overridesCss = readFileSync(
  join(__dirname, '..', 'admin-v3-overrides.css'),
  'utf8',
)
const css = baseStyles + '\n' + overridesCss

describe('Phase B-prime · Dashboard tab bar stays sticky on scroll', () => {
  it('declares .aw-subtabs as position: sticky with top: 0', () => {
    // Either base styles OR the override layer must contain the rule.
    expect(css).toMatch(
      /\.aw-subtabs[^{]*\{[^}]*position:\s*sticky[^}]*top:\s*0/s,
    )
  })

  it('gives .aw-subtabs a z-index >= 3 so it overlaps scrolling content', () => {
    const block =
      css.match(/\.aw-subtabs[^{]*\{([^}]*position:\s*sticky[^}]*)\}/s)?.[1] ?? ''
    const z = block.match(/z-index:\s*(\d+)/)
    expect(z).not.toBeNull()
    expect(Number(z?.[1])).toBeGreaterThanOrEqual(3)
  })

  it('section anchors get scroll-margin-top so they land below sticky bar', () => {
    expect(css).toMatch(
      /\[id\^?=["']?section-["']?\][^{]*\{[^}]*scroll-margin-top:/s,
    )
  })
})
