/**
 * Phase B · primitive — `<EmptyState>` designed empty / onboarding panel.
 *
 * Replaces the terse `<EmptyInline>` for list-view contexts. Anatomy:
 *   1. Compact line illustration (SVG, hairline, accent-tinted) —
 *      matches v1 diagram aesthetic. NOT Material Symbols.
 *   2. 1-line title + 1-2 sentence body explaining the resource.
 *   3. Primary CTA (action button — calls onCtaClick).
 *   4. "Learn more →" link (href).
 *
 * Design intent: empty IS the onboarding. The illustration is small
 * (no fanfare) but the title + body + CTA + link form a complete
 * "first time you arrive here" hand-off.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '../EmptyState'

describe('EmptyState — designed list-view empty / onboarding panel', () => {
  it('renders title and body', () => {
    render(
      <EmptyState
        title="No providers configured"
        body="Add an LLM provider to start routing chat through it."
      />,
    )
    expect(screen.getByText('No providers configured')).toBeInTheDocument()
    expect(
      screen.getByText('Add an LLM provider to start routing chat through it.'),
    ).toBeInTheDocument()
  })

  it('renders the primary CTA and fires onCtaClick', () => {
    const onCtaClick = vi.fn()
    render(
      <EmptyState
        title="Empty"
        body="."
        ctaLabel="+ add provider"
        onCtaClick={onCtaClick}
      />,
    )
    const btn = screen.getByRole('button', { name: '+ add provider' })
    fireEvent.click(btn)
    expect(onCtaClick).toHaveBeenCalledTimes(1)
  })

  it('renders the Learn more link with the supplied href', () => {
    render(
      <EmptyState
        title="x"
        body="x"
        learnMoreHref="/docs/admin/providers"
      />,
    )
    const link = screen.getByRole('link', { name: /learn more/i })
    expect(link).toHaveAttribute('href', '/docs/admin/providers')
  })

  it('omits CTA + Learn more cleanly when not provided', () => {
    const { container } = render(<EmptyState title="x" body="x" />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })

  it('renders the illustration slot (default SVG glyph) when not overridden', () => {
    const { container } = render(<EmptyState title="x" body="x" />)
    expect(container.querySelector('.aw-empty-state__illu svg')).toBeTruthy()
  })

  it('honors a custom illustration prop', () => {
    const { container } = render(
      <EmptyState
        title="x"
        body="x"
        illustration={<div data-testid="custom-illu" />}
      />,
    )
    expect(container.querySelector('[data-testid="custom-illu"]')).toBeTruthy()
    // Default svg should NOT also render when custom illustration is provided
    expect(container.querySelector('.aw-empty-state__illu > svg')).toBeNull()
  })

  it('uses class-driven styling — no inline color literals', () => {
    const { container } = render(
      <EmptyState
        title="x"
        body="x"
        ctaLabel="add"
        onCtaClick={() => {}}
        learnMoreHref="/d"
      />,
    )
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('roots under .aw-empty-state so the override layer can scope it', () => {
    const { container } = render(<EmptyState title="x" body="x" />)
    expect(container.querySelector('.aw-empty-state')).toBeTruthy()
  })
})
