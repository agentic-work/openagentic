import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Reads each source file and asserts it contains no Tailwind purple/violet
// utility classes (which bypass the user's accent token). Source-level
// assertion — no rendering needed.
const ADMIN_ROOT = join(__dirname, '..')
const FILES = [
  'LLM/OllamaManagementView.tsx',
  'DataLayer/UnifiedDataLayerView.tsx',
  'Content/SharedKBView.tsx',
  'LLM/MultiModelConfigView.tsx',
  'LLM/ModelManagementView/constants.ts',
  'LLM/LLMProviderManagement/CapabilityMatrix.tsx',
  'Content/PipelineSettingsView.tsx',
]

// Match Tailwind utility forms: `(bg|text|border|from|to|via|ring|accent|fill|stroke)-(purple|violet)-NNN`
// optionally followed by /opacity or trailing characters.
const LEAK = /\b(bg|text|border|from|to|via|ring|accent|fill|stroke)-(purple|violet)-\d{2,3}\b/

describe('no admin component should leak Tailwind purple/violet (accent leak)', () => {
  for (const rel of FILES) {
    it(`${rel} has no purple/violet utility class`, () => {
      const src = readFileSync(join(ADMIN_ROOT, rel), 'utf8')
      const matches = src.match(new RegExp(LEAK.source, 'g')) ?? []
      expect(matches).toEqual([])
    })
  }
})
