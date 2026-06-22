import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpiTile } from '../KpiTile'

describe('KpiTile', () => {
  it('renders label, value, optional unit, and optional delta', () => {
    render(<KpiTile label="Sessions" value="3,512" unit="sess" delta="+12%" />)
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('3,512')).toBeInTheDocument()
    expect(screen.getByText('sess')).toBeInTheDocument()
    expect(screen.getByText('+12%')).toBeInTheDocument()
  })

  it('honours tone via data-tone attribute on the value', () => {
    const { container } = render(<KpiTile label="Errors" value="3" tone="err" />)
    expect(container.querySelector('[data-tone="err"]')).toBeTruthy()
  })

  it('renders sparkline children when provided', () => {
    render(
      <KpiTile label="x" value="1">
        <svg data-testid="spark"><path d="M0,0 L10,10" /></svg>
      </KpiTile>,
    )
    expect(screen.getByTestId('spark')).toBeInTheDocument()
  })

  it('uses only --ap-* tokens', () => {
    const { container } = render(<KpiTile label="x" value="1" delta="ok" />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
