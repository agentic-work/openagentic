/**
 * Phase B · hook — `useUrlFilter` URL-sync filter chips.
 *
 * Each Dt's filter state (status / provider / tier / capability / etc.)
 * is serialized to the page's query string so URLs are shareable and
 * the back button works as expected. The hook returns:
 *   { filters, set, clear, removeKey } — plus the chips array the
 *   FilterRow renders. State is bidirectional: navigating to
 *   `?status=healthy&tier=t1` populates the filter state on first
 *   render; calling `set('status', 'down')` updates the URL.
 *
 * Tests use a shim window.history pushState to assert the URL
 * round-trip without hitting jsdom's location bag.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUrlFilter } from '../useUrlFilter'

beforeEach(() => {
  window.history.replaceState({}, '', '/test-page')
})
afterEach(() => {
  window.history.replaceState({}, '', '/')
})

describe('useUrlFilter — URL-sync filter chips', () => {
  it('initializes from the current query string', () => {
    window.history.replaceState({}, '', '/test-page?status=healthy&tier=t1')
    const { result } = renderHook(() => useUrlFilter('aw-table'))
    expect(result.current.filters).toEqual({ status: 'healthy', tier: 't1' })
  })

  it('initializes empty when no query string is present', () => {
    const { result } = renderHook(() => useUrlFilter('aw-table'))
    expect(result.current.filters).toEqual({})
  })

  it('set(key, value) updates state and writes the new URL', () => {
    const { result } = renderHook(() => useUrlFilter('aw-table'))
    act(() => result.current.set('status', 'healthy'))
    expect(result.current.filters).toEqual({ status: 'healthy' })
    expect(window.location.search).toContain('status=healthy')
  })

  it('set(key, null) clears that key', () => {
    window.history.replaceState({}, '', '/test-page?status=healthy&tier=t1')
    const { result } = renderHook(() => useUrlFilter('aw-table'))
    act(() => result.current.set('status', null))
    expect(result.current.filters).toEqual({ tier: 't1' })
    expect(window.location.search).not.toContain('status')
  })

  it('removeKey(key) is sugar for set(key, null)', () => {
    window.history.replaceState({}, '', '/test-page?status=healthy')
    const { result } = renderHook(() => useUrlFilter('aw-table'))
    act(() => result.current.removeKey('status'))
    expect(result.current.filters).toEqual({})
  })

  it('clear() removes every filter at once', () => {
    window.history.replaceState({}, '', '/test-page?status=healthy&tier=t1&q=foo')
    const { result } = renderHook(() => useUrlFilter('aw-table'))
    act(() => result.current.clear())
    expect(result.current.filters).toEqual({})
    expect(window.location.search).not.toContain('status')
    expect(window.location.search).not.toContain('tier')
  })

  it('chips array reflects current filters with key + value pairs', () => {
    window.history.replaceState({}, '', '/test-page?status=healthy&tier=t1')
    const { result } = renderHook(() => useUrlFilter('aw-table'))
    expect(result.current.chips).toEqual([
      { key: 'status', value: 'healthy' },
      { key: 'tier', value: 't1' },
    ])
  })

  it('preserves other (non-filter) query params on the page', () => {
    // ?other=keep-me should survive a filter change.
    window.history.replaceState({}, '', '/test-page?other=keep-me&status=healthy')
    const { result } = renderHook(() => useUrlFilter('aw-table', { ignore: ['other'] }))
    act(() => result.current.set('status', 'down'))
    expect(window.location.search).toContain('other=keep-me')
    expect(window.location.search).toContain('status=down')
  })
})
