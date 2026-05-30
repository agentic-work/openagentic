import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTheme } from '../useTheme'

beforeEach(() => {
  // Make sure no leftover storage drives the default.
  try { localStorage.removeItem('ac-density') } catch { /* ignore */ }
})

describe('Phase B-prime · admin density default is "compact"', () => {
  it('returns "compact" on first run when no density preference is stored', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.density).toBe('compact')
  })

  it('still honors a stored explicit "cozy" preference (operator opted in)', () => {
    localStorage.setItem('ac-density', 'cozy')
    const { result } = renderHook(() => useTheme())
    expect(result.current.density).toBe('cozy')
  })

  it('still honors a stored explicit "comfortable" preference', () => {
    localStorage.setItem('ac-density', 'comfortable')
    const { result } = renderHook(() => useTheme())
    expect(result.current.density).toBe('comfortable')
  })
})
