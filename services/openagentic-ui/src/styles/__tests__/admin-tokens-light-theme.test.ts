import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '..', 'admin-tokens.css'), 'utf8')

// Assert every cap-/tier-/toast- token defined in :root has a corresponding
// override inside a [data-theme="light"] block. If a token's value doesn't
// need changing on light theme, it must still be re-declared explicitly so
// future readers know it was considered.

const ROOT_BLOCK_RE = /:root\s*\{([^}]*)\}/s
const LIGHT_BLOCK_RE = /\[data-theme=["']light["']\]\s*\{([^}]*)\}/s

function tokensIn(block: string, prefix: string): string[] {
  const re = new RegExp(`--${prefix}-[a-z0-9-]+`, 'g')
  return [...new Set((block.match(re) ?? []))]
}

describe('admin-tokens.css has light-theme overrides for cap/tier/toast palettes', () => {
  it('defines a [data-theme="light"] block', () => {
    expect(LIGHT_BLOCK_RE.test(css)).toBe(true)
  })

  for (const prefix of ['cap', 'tier', 'toast']) {
    it(`every --${prefix}-* token has a light-theme override`, () => {
      const root = (css.match(ROOT_BLOCK_RE) ?? ['',''])[1]
      const light = (css.match(LIGHT_BLOCK_RE) ?? ['',''])[1]
      const rootTokens = tokensIn(root, prefix)
      const lightTokens = tokensIn(light, prefix)
      const missing = rootTokens.filter(t => !lightTokens.includes(t))
      expect(missing).toEqual([])
    })
  }
})
