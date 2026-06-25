import { describe, expect, it } from 'vitest'
import {
  ADMIN_DOMAINS,
  DEFAULT_OPEN_GROUPS,
  DOMAIN_BY_ID,
  LEAF_BY_MNEMONIC,
  LEAF_COUNT,
  LEAF_INDEX,
  domainOfLeaf,
} from '../ADMIN_IA'
import { ADMIN_INV, ADMIN_INV_OPTION_COUNT } from '../ADMIN_INV'

/**
 * IA contract gate: the admin console IA must be EXACTLY the 10-domain /
 * 55-leaf taxonomy, every leaf must own a unique 2-char mnemonic that
 * jumps to it, and every leaf must carry an option-spec inventory (the
 * two-part contract). This is the contract test.
 */
describe('ADMIN_IA — the rewrite taxonomy contract', () => {
  it('has exactly 10 domains (incl Home) in mock order', () => {
    expect(ADMIN_DOMAINS).toHaveLength(10)
    expect(ADMIN_DOMAINS.map((d) => d.id)).toEqual([
      'home',
      'models',
      'flows',
      'agents',
      'tools',
      'integrations',
      'prompts',
      'content',
      'obs',
      'system',
    ])
  })

  it('has exactly 55 leaves', () => {
    expect(LEAF_COUNT).toBe(55)
    expect(Object.keys(LEAF_INDEX)).toHaveLength(55)
    const total = ADMIN_DOMAINS.reduce((a, d) => a + d.leaves.length, 0)
    expect(total).toBe(55)
  })

  it('per-domain leaf counts (7/9/4/3/3/4/4/11/10)', () => {
    const counts = Object.fromEntries(ADMIN_DOMAINS.map((d) => [d.id, d.leaves.length]))
    expect(counts).toMatchObject({
      home: 0,
      models: 7,
      flows: 9,
      agents: 4,
      tools: 3,
      integrations: 3,
      prompts: 4,
      content: 4,
      obs: 11,
      system: 10,
    })
  })

  it('domain display titles match the mock', () => {
    expect(DOMAIN_BY_ID['models'].name).toBe('Models & Providers')
    expect(DOMAIN_BY_ID['obs'].name).toBe('Observability')
    expect(DOMAIN_BY_ID['system'].name).toBe('System & Security')
    expect(DOMAIN_BY_ID['tools'].name).toBe('Tools & MCP')
  })

  it('Federation is NOT present (enterprise/control-plane — excluded from OSS)', () => {
    expect(DOMAIN_BY_ID['federation']).toBeUndefined()
    expect(LEAF_INDEX['federation']).toBeUndefined()
    expect(LEAF_BY_MNEMONIC['xf']).toBeUndefined()
  })

  it('Code Mode is NOT present (stripped from OSS)', () => {
    expect(DOMAIN_BY_ID['code']).toBeUndefined()
    expect(LEAF_INDEX['cm-users']).toBeUndefined()
    expect(LEAF_INDEX['cm-global']).toBeUndefined()
    expect(LEAF_BY_MNEMONIC['cu']).toBeUndefined()
  })

  it('Synthesis is NOT present (no synth backend in OSS)', () => {
    expect(DOMAIN_BY_ID['synth']).toBeUndefined()
    expect(LEAF_INDEX['synth-management']).toBeUndefined()
    expect(LEAF_INDEX['synth-stats']).toBeUndefined()
    expect(LEAF_BY_MNEMONIC['yc']).toBeUndefined()
  })

  it('Flows includes the Failures leaf (fx)', () => {
    expect(LEAF_INDEX['failures']?.domain).toBe('flows')
    expect(LEAF_INDEX['failures']?.mn).toBe('fx')
  })

  it('every leaf has a UNIQUE 2-char mnemonic', () => {
    const mns = Object.values(LEAF_INDEX).map((l) => l.mn)
    expect(mns).toHaveLength(55)
    expect(new Set(mns).size).toBe(55)
    for (const mn of mns) expect(mn).toMatch(/^[a-z]{2}$/)
  })

  it('mnemonic-jump resolves every mnemonic back to its leaf id', () => {
    expect(Object.keys(LEAF_BY_MNEMONIC)).toHaveLength(55)
    for (const l of Object.values(LEAF_INDEX)) {
      expect(LEAF_BY_MNEMONIC[l.mn]).toBe(l.id)
    }
    // Spot-check a few.
    expect(LEAF_BY_MNEMONIC['lp']).toBe('providers')
    expect(LEAF_BY_MNEMONIC['mh']).toBe('cluster-health')
    expect(LEAF_BY_MNEMONIC['fx']).toBe('failures')
    expect(LEAF_BY_MNEMONIC['bc']).toBe('chargeback')
  })

  it('domainOfLeaf resolves a leaf to its parent domain', () => {
    expect(domainOfLeaf('providers')).toBe('models')
    expect(domainOfLeaf('chargeback')).toBe('obs')
    expect(domainOfLeaf(null)).toBeNull()
    expect(domainOfLeaf('not-a-leaf')).toBeNull()
  })

  it('groups models/flows/agents are open by default', () => {
    expect(DEFAULT_OPEN_GROUPS.has('models')).toBe(true)
    expect(DEFAULT_OPEN_GROUPS.has('flows')).toBe(true)
    expect(DEFAULT_OPEN_GROUPS.has('agents')).toBe(true)
    expect(DEFAULT_OPEN_GROUPS.has('system')).toBe(false)
  })
})

describe('ADMIN_INV — every leaf keeps its two-part contract', () => {
  it('has an option-spec inventory for ALL 55 leaves', () => {
    const leafIds = Object.keys(LEAF_INDEX)
    expect(leafIds).toHaveLength(55)
    for (const id of leafIds) {
      expect(ADMIN_INV[id], `missing inventory for leaf "${id}"`).toBeDefined()
      expect(ADMIN_INV[id].opts.length).toBeGreaterThan(0)
    }
  })

  it('every inventory option row is a [label, type, detail] triple', () => {
    for (const [id, inv] of Object.entries(ADMIN_INV)) {
      // Inventory is keyed only by real leaf ids.
      expect(LEAF_INDEX[id], `inventory for unknown leaf "${id}"`).toBeDefined()
      for (const row of inv.opts) {
        expect(row).toHaveLength(3)
        expect(typeof row[0]).toBe('string')
        expect(typeof row[1]).toBe('string')
        expect(typeof row[2]).toBe('string')
      }
    }
  })

  it('aggregate option count is positive and reported for the boot log', () => {
    expect(ADMIN_INV_OPTION_COUNT).toBeGreaterThan(64)
    const sum = Object.values(ADMIN_INV).reduce((a, i) => a + i.opts.length, 0)
    expect(ADMIN_INV_OPTION_COUNT).toBe(sum)
  })
})
