/**
 * Phase B · primitive — `<PageHead>` split actions API.
 *
 * Per plan §4 (5-place action triangle):
 *   - primaryAction lives top-LEFT next to the title (one per page,
 *     accent solid)
 *   - secondaryActions live top-RIGHT cluster (refresh, filters,
 *     columns, density toggle, export — ghost buttons)
 *
 * The legacy `actions` slot must keep working so the 60 existing
 * leaves don't regress; new prop names take precedence when both
 * are supplied.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PageHead } from '../PageHead'

describe('PageHead — split primaryAction + secondaryActions API', () => {
  it('renders title (h1)', () => {
    const { container } = render(<PageHead title="Dashboard" />)
    const h1 = container.querySelector('h1.aw-page-head__title')
    expect(h1?.textContent).toBe('Dashboard')
  })

  it('renders primaryAction in the .aw-page-head__primary slot (left)', () => {
    const { container } = render(
      <PageHead
        title="Models"
        primaryAction={<button data-testid="add">+ add model</button>}
      />,
    )
    const left = container.querySelector('.aw-page-head__primary')
    expect(left?.querySelector('[data-testid="add"]')).toBeTruthy()
  })

  it('renders secondaryActions in the .aw-page-head__actions slot (right)', () => {
    const { container } = render(
      <PageHead
        title="Models"
        secondaryActions={<button data-testid="refresh">refresh</button>}
      />,
    )
    const right = container.querySelector('.aw-page-head__actions')
    expect(right?.querySelector('[data-testid="refresh"]')).toBeTruthy()
  })

  it('keeps legacy `actions` prop working — renders into the right cluster', () => {
    const { container } = render(
      <PageHead
        title="Models"
        actions={<button data-testid="legacy">refresh</button>}
      />,
    )
    const right = container.querySelector('.aw-page-head__actions')
    expect(right?.querySelector('[data-testid="legacy"]')).toBeTruthy()
  })

  it('when both legacy actions and new secondaryActions are provided, new wins', () => {
    const { container } = render(
      <PageHead
        title="Models"
        actions={<button data-testid="legacy">old</button>}
        secondaryActions={<button data-testid="new">new</button>}
      />,
    )
    const right = container.querySelector('.aw-page-head__actions')
    expect(right?.querySelector('[data-testid="new"]')).toBeTruthy()
    expect(right?.querySelector('[data-testid="legacy"]')).toBeNull()
  })

  it('renders meta strip when supplied', () => {
    const { container } = render(<PageHead title="Models" meta="last 24h · auto-refresh" />)
    const meta = container.querySelector('.aw-page-head__meta')
    expect(meta?.textContent).toBe('last 24h · auto-refresh')
  })

  it('does not render the primary slot when primaryAction is omitted', () => {
    const { container } = render(<PageHead title="Models" />)
    expect(container.querySelector('.aw-page-head__primary')).toBeNull()
  })
})
