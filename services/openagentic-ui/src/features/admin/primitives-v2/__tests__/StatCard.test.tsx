import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatCard } from '../StatCard'

describe('StatCard', () => {
  it('renders label, value, delta, sub, and sparkline', () => {
    const { container } = render(
      <StatCard
        label="Chat Sessions"
        value="51"
        dir="up"
        delta="+325%"
        sub="3 active"
        sparkData={[1, 2, 3, 4, 5]}
      />,
    )
    expect(screen.getByText(/Chat Sessions/i)).toBeInTheDocument()
    expect(screen.getByText('51')).toBeInTheDocument()
    expect(screen.getByText(/\+325%/)).toBeInTheDocument()
    expect(screen.getByText(/3 active/)).toBeInTheDocument()
    expect(container.querySelector('.scell .spark svg')).toBeInTheDocument()
  })

  it('adds data-stat attribute when liveKey is provided (for hydration targeting)', () => {
    const { container } = render(
      <StatCard label="API" value="100" sparkData={[1, 2]} liveKey="api-rps" />,
    )
    expect(container.querySelector('[data-stat="api-rps"]')).not.toBeNull()
  })

  it('colours the value by variant', () => {
    const { container } = render(<StatCard label="x" value="1" variant="ok" sparkData={[1]} />)
    const val = container.querySelector('.val')
    expect(val?.className).toContain('text-ok')
  })
})
