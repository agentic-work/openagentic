import { describe, it, expect } from 'vitest'
import { SIDEBAR_GROUPS } from '../sidebar-items'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('admin: deprecated prompts slugs retired', () => {
  it('sidebar has no prompts (Legacy Templates) leaf', () => {
    const allIds: string[] = []
    for (const g of SIDEBAR_GROUPS) for (const c of g.children) allIds.push(c.id)
    expect(allIds).not.toContain('prompts')
  })

  it('pageRouter has no case "prompts"', () => {
    const src = readFileSync(join(__dirname, '..', 'pageRouter.tsx'), 'utf8')
    expect(src).not.toMatch(/case\s+['"]prompts['"]\s*:/)
  })

  // Phase E.6 (2026-05-10) — the prompt-modules leaf is retired alongside
  // the PromptComposer + PromptModuleRegistry rip in Phase E.3/E.4.
  it('sidebar has no prompt-modules leaf', () => {
    const allIds: string[] = []
    for (const g of SIDEBAR_GROUPS) for (const c of g.children) allIds.push(c.id)
    expect(allIds).not.toContain('prompt-modules')
  })

  it('pageRouter has no case "prompt-modules"', () => {
    const src = readFileSync(join(__dirname, '..', 'pageRouter.tsx'), 'utf8')
    expect(src).not.toMatch(/case\s+['"]prompt-modules['"]\s*:/)
  })

  it('Prompt Engineering group has its active post-E.6 leaves', () => {
    const promptEng = SIDEBAR_GROUPS.find(g => g.id === 'prompt-engineering')
    expect(promptEng).toBeDefined()
    const ids = promptEng!.children.map(c => c.id)
    expect(ids).toEqual([
      'pipeline-settings',
      'prompt-effectiveness',
      'prompt-metrics',
      'rbac-system-prompts',
    ])
  })

  // Legacy AdminPortal shell (components/Shell/AdminPortal.tsx) had its own
  // sidebar + case dispatch separate from shell-v2. Phase E.6 rips both.
  it('legacy AdminPortal.tsx has no case "prompt-modules"', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'components', 'Shell', 'AdminPortal.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/case\s+['"]prompt-modules['"]\s*:/)
  })

  it('legacy AdminPortal.tsx has no prompt-modules sidebar leaf entry', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'components', 'Shell', 'AdminPortal.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/id:\s*['"]prompt-modules['"]/)
  })
})
