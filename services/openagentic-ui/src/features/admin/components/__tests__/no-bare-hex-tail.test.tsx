import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ADMIN_ROOT = join(__dirname, '..')
const FILES = [
  'LLM/LLMProviderManagement/ProviderCard.tsx',
  'Monitoring/AuditLogsView.tsx',
  'LLM/LLMProviderManagement/ProviderDetailPanel.tsx',
]

// Match hex inside source: any '#xxxxxx' / "#xxxxxx" / `#xxxxxx` literal.
// Catches both bare hex and hex inside template literals.
const HEX_LITERAL = /(['"`])#[0-9a-fA-F]{3,8}(?:['"`])/

describe('admin: bare hex literals removed from theme-tail components', () => {
  for (const rel of FILES) {
    it(`${rel} has no string-quoted hex literal`, () => {
      const src = readFileSync(join(ADMIN_ROOT, rel), 'utf8')
      const matches = src.match(new RegExp(HEX_LITERAL.source, 'g')) ?? []
      expect(matches).toEqual([])
    })
  }
})
