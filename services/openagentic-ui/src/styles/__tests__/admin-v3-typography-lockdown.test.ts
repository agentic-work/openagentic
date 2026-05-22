import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Phase A — Typography lockdown (2026-05-06).
 *
 * Locks the GCP-grade signature for the admin shell against accidental
 * regression — any future PR that flips Geist back to primary or removes
 * the tabular-figures rule will fail this test before it lands.
 *
 * The rules tested here are documented in
 * /home/trent/.claude/plans/whatever-plan-it-read-swift-koala.md §2 + §14.
 */

const accentsCss = readFileSync(
  join(__dirname, '..', 'admin-v2-accents.css'),
  'utf8',
)
const overridesCss = readFileSync(
  join(__dirname, '..', 'admin-v3-overrides.css'),
  'utf8',
)

// Match a CSS custom-property declaration and capture the value.
function readCustomProp(css: string, name: string): string | null {
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`)
  const m = css.match(re)
  return m ? m[1].trim() : null
}

// Return the first font-family token (before the first comma), stripped of
// quotes and whitespace.
function primaryFamily(value: string | null): string | null {
  if (!value) return null
  const first = value.split(',')[0].trim()
  return first.replace(/^['"]|['"]$/g, '')
}

describe('Phase A · admin-v3 typography tokens — Inter / JetBrains primary', () => {
  it('--font-v3-body leads with Inter, not Geist', () => {
    const value = readCustomProp(accentsCss, 'font-v3-body')
    expect(value).not.toBeNull()
    expect(primaryFamily(value)).toBe('Inter')
  })

  it('--font-v3-mono leads with JetBrains Mono, not Geist Mono', () => {
    const value = readCustomProp(accentsCss, 'font-v3-mono')
    expect(value).not.toBeNull()
    expect(primaryFamily(value)).toBe('JetBrains Mono')
  })

  it('--font-v3-tele leads with Inter (not aliased to a mono font anymore)', () => {
    const value = readCustomProp(accentsCss, 'font-v3-tele')
    expect(value).not.toBeNull()
    expect(primaryFamily(value)).toBe('Inter')
  })
})

describe('Phase A · admin-v3 overrides — tabular figures + heading hierarchy', () => {
  it('declares tabular-figures rule scoped under .aw-shell on data columns', () => {
    expect(overridesCss).toMatch(
      /\.aw-shell\s+\.aw-dt\s+td[^{]*\{[^}]*font-feature-settings:\s*['"]tnum['"]\s+1[^}]*\}/s,
    )
  })

  it('uses font-variant-numeric: tabular-nums on numeric / mono columns', () => {
    expect(overridesCss).toMatch(/font-variant-numeric:\s*tabular-nums/)
  })

  it('locks h1 / page-title to 22px Inter weight 500', () => {
    const re = /\.aw-shell\s+h1[\s\S]*?font-size:\s*22px[\s\S]*?font-weight:\s*500/m
    expect(overridesCss).toMatch(re)
  })

  it('locks h2 / section-title to 16px Inter weight 500', () => {
    const re = /\.aw-shell\s+h2[\s\S]*?font-size:\s*16px[\s\S]*?font-weight:\s*500/m
    expect(overridesCss).toMatch(re)
  })

  it('locks h3 / telemetry-title to 11px uppercase wide-tracked', () => {
    const re = /\.aw-shell\s+h3[\s\S]*?font-size:\s*11px[\s\S]*?text-transform:\s*uppercase[\s\S]*?letter-spacing:\s*0\.18em/m
    expect(overridesCss).toMatch(re)
  })

  it('locks form labels to 11px uppercase narrow-tracked (0.08em)', () => {
    const re = /\.aw-shell\s+label[\s\S]*?font-size:\s*11px[\s\S]*?text-transform:\s*uppercase[\s\S]*?letter-spacing:\s*0\.08em/m
    expect(overridesCss).toMatch(re)
  })

  it('every typography rule is scoped under .aw-shell so chat / flows are unaffected', () => {
    const phaseAStart = overridesCss.indexOf('Phase A — Typography lockdown')
    expect(phaseAStart).toBeGreaterThan(-1)
    const phaseABlock = overridesCss.slice(phaseAStart)
    // Every selector containing h1 / h2 / h3 / label / td / .aw-mono / etc.
    // inside the Phase A block must be prefixed with .aw-shell.
    const ruleHeads = phaseABlock.match(/^\s*([^\n{]+)\s*\{/gm) ?? []
    const offenders = ruleHeads
      .map((s) => s.replace(/\{$/, '').trim())
      .filter((h) => h.length > 0 && !h.includes('.aw-shell'))
    expect(offenders).toEqual([])
  })
})
