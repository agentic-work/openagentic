import { describe, it, expect } from 'vitest'
import { SIDEBAR_GROUPS } from '../sidebar-items'

describe('sidebar-items: Security & Access merged into System Management', () => {
  it('does not have a separate "security" group', () => {
    const ids = SIDEBAR_GROUPS.map(g => g.id)
    expect(ids).not.toContain('security')
  })

  it('System Management contains all the previously-security slugs', () => {
    const system = SIDEBAR_GROUPS.find(g => g.id === 'system')
    expect(system).toBeDefined()
    const childIds = system!.children.map(c => c.id)
    for (const slug of ['auth-access', 'permissions', 'user-lockout', 'tokens', 'network', 'webhook-security', 'dlp-config']) {
      expect(childIds).toContain(slug)
    }
  })

  it('System Management still contains its original slugs', () => {
    const system = SIDEBAR_GROUPS.find(g => g.id === 'system')!
    const childIds = system.children.map(c => c.id)
    expect(childIds).toContain('users')
    expect(childIds).toContain('settings')
    expect(childIds).toContain('rate-limits')
  })

  it('tokens slug appears immediately after the User-* group, before settings', () => {
    const system = SIDEBAR_GROUPS.find(g => g.id === 'system')!
    const childIds = system.children.map(c => c.id)
    const tokensIdx = childIds.indexOf('tokens')
    const settingsIdx = childIds.indexOf('settings')
    expect(tokensIdx).toBeGreaterThan(-1)
    expect(settingsIdx).toBeGreaterThan(tokensIdx)
  })
})
