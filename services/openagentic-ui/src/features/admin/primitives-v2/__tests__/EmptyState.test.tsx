import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmptyState } from '../EmptyState'

describe('EmptyState', () => {
  it('renders title and hint', () => {
    render(<EmptyState title="No active lockouts" hint="Failed-login lockouts would appear here." />)
    expect(screen.getByText('No active lockouts')).toBeInTheDocument()
    expect(screen.getByText(/Failed-login lockouts/)).toBeInTheDocument()
  })

  it('renders CTA button when provided and fires onCta', () => {
    const onCta = vi.fn()
    render(<EmptyState title="x" hint="y" cta="Add one" onCta={onCta} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add one' }))
    expect(onCta).toHaveBeenCalledTimes(1)
  })

  it('omits CTA when none given', () => {
    render(<EmptyState title="x" hint="y" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uses only --ap-* tokens', () => {
    const { container } = render(<EmptyState title="x" hint="y" cta="Z" />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
