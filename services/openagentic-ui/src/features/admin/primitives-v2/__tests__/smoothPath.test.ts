import { describe, expect, it } from 'vitest'
import { smoothPath } from '../smoothPath'

describe('smoothPath', () => {
  it('returns empty string for 0 or 1 points', () => {
    expect(smoothPath([])).toBe('')
    expect(smoothPath([[0, 0]])).toBe('')
  })

  it('starts with M and uses C (cubic beziers) for 2+ points', () => {
    const d = smoothPath([[0, 10], [10, 5], [20, 15]])
    expect(d).toMatch(/^M0,10/)
    expect(d).toMatch(/C/)
  })
})
