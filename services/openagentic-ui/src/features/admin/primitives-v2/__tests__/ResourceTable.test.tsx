import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResourceTable } from '../ResourceTable'

describe('ResourceTable', () => {
  it('renders columns in <thead>', () => {
    render(
      <ResourceTable
        columns={[
          { id: 'name', label: 'Model' },
          { id: 'status', label: 'Status' },
          { id: 'provider', label: 'Provider' },
        ]}
        rows={[]}
      />,
    )
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Provider')).toBeInTheDocument()
  })

  it('renders one <tr> per row', () => {
    render(
      <ResourceTable
        columns={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]}
        rows={[
          { id: 'r1', cells: { a: 'A1', b: 'B1' } },
          { id: 'r2', cells: { a: 'A2', b: 'B2' } },
        ]}
      />,
    )
    // 2 body rows + 1 header row = 3 total
    const trs = document.querySelectorAll('tr')
    expect(trs.length).toBe(3)
  })

  it('renders empty-state when no rows', () => {
    render(
      <ResourceTable
        columns={[{ id: 'a', label: 'A' }]}
        rows={[]}
        emptyState={<div data-testid="es">none</div>}
      />,
    )
    expect(screen.getByTestId('es')).toBeInTheDocument()
  })

  it('uses only --ap-* tokens', () => {
    const { container } = render(
      <ResourceTable
        columns={[{ id: 'a', label: 'A' }]}
        rows={[{ id: 'r1', cells: { a: 'x' } }]}
      />,
    )
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
