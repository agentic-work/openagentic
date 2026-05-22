import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogRow } from '../LogRow'

describe('LogRow', () => {
  it('renders timestamp, source, message, optional meta', () => {
    render(
      <LogRow severity="ok" timestamp="07:42:11" source="admin/llm" message="trent@ updated balanced.model" meta="audit#48211" />,
    )
    expect(screen.getByText('07:42:11')).toBeInTheDocument()
    expect(screen.getByText('admin/llm')).toBeInTheDocument()
    expect(screen.getByText(/trent@ updated/)).toBeInTheDocument()
    expect(screen.getByText('audit#48211')).toBeInTheDocument()
  })

  it('exposes severity via data-severity', () => {
    const { container } = render(<LogRow severity="err" timestamp="x" source="y" message="z" />)
    expect(container.querySelector('[data-severity="err"]')).toBeTruthy()
  })

  it('renders source as accent when sourceAccent is set', () => {
    const { container } = render(
      <LogRow severity="info" timestamp="x" source="admin/llm" sourceAccent message="z" />,
    )
    expect(container.querySelector('[data-source-accent="true"]')).toBeTruthy()
  })

  it('uses only --ap-* tokens', () => {
    const { container } = render(<LogRow severity="warn" timestamp="x" source="y" message="z" meta="m" />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
