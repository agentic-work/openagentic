import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterRow } from '../FilterRow'

describe('FilterRow', () => {
  it('renders a search input with placeholder', () => {
    render(<FilterRow placeholder="Search models…" />)
    expect(screen.getByPlaceholderText('Search models…')).toBeInTheDocument()
  })

  it('emits onSearchChange as user types', () => {
    const onSearch = vi.fn()
    render(<FilterRow placeholder="Search…" onSearchChange={onSearch} />)
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'haiku' } })
    expect(onSearch).toHaveBeenCalledWith('haiku')
  })

  it('renders chips and toggles them via onChipClick', () => {
    const onClick = vi.fn()
    render(
      <FilterRow
        placeholder="Search…"
        chips={[
          { id: 'enabled', label: 'Status: enabled', on: true },
          { id: 'provider', label: 'Provider: any' },
        ]}
        onChipClick={onClick}
      />,
    )
    expect(screen.getByRole('button', { name: /Status: enabled/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Provider: any/ }))
    expect(onClick).toHaveBeenCalledWith('provider')
  })

  it('renders right-side label', () => {
    render(<FilterRow placeholder="x" rightLabel="28 of 28" />)
    expect(screen.getByText('28 of 28')).toBeInTheDocument()
  })

  it('uses only --ap-* tokens', () => {
    const { container } = render(<FilterRow placeholder="x" rightLabel="y" chips={[{ id: 'a', label: 'A' }]} />)
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
