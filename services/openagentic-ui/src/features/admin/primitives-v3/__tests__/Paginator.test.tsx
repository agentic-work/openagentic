/**
 * Phase B · primitive — `<Paginator>` server-driven pagination chips.
 *
 * Lives in the bottom-right of every Dt with > pageSize rows.
 * Anatomy:
 *   - Page-size chip group: 100 / 500 / 1000
 *   - Page-jumper: "page X of Y"
 *   - Prev / next / first / last arrow chips
 *
 * The paginator is a *display* component — it doesn't fetch data
 * itself; it fires onChange({ page, pageSize }) and the parent
 * re-fetches.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Paginator } from '../Paginator'

describe('Paginator — server-driven pagination chips', () => {
  it('renders the current page x of y', () => {
    render(
      <Paginator page={2} pageSize={100} total={550} onChange={() => {}} />,
    )
    // ceil(550/100) = 6
    expect(screen.getByText(/page 2 of 6/i)).toBeInTheDocument()
  })

  it('renders the page-size chip group with the active size marked', () => {
    const { container } = render(
      <Paginator page={1} pageSize={500} total={2000} onChange={() => {}} />,
    )
    const sizes = [...container.querySelectorAll('[data-page-size]')]
    expect(sizes.map((s) => s.getAttribute('data-page-size'))).toEqual([
      '100',
      '500',
      '1000',
    ])
    const active = container.querySelector('[data-page-size="500"][data-active="true"]')
    expect(active).toBeTruthy()
  })

  it('disables prev when on page 1; disables next on last page', () => {
    const { container, rerender } = render(
      <Paginator page={1} pageSize={100} total={250} onChange={() => {}} />,
    )
    expect(container.querySelector('[data-nav="prev"]')).toBeDisabled()
    expect(container.querySelector('[data-nav="next"]')).not.toBeDisabled()
    rerender(<Paginator page={3} pageSize={100} total={250} onChange={() => {}} />)
    expect(container.querySelector('[data-nav="prev"]')).not.toBeDisabled()
    expect(container.querySelector('[data-nav="next"]')).toBeDisabled()
  })

  it('fires onChange with the next page on next-arrow click', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Paginator page={2} pageSize={100} total={400} onChange={onChange} />,
    )
    fireEvent.click(container.querySelector('[data-nav="next"]') as Element)
    expect(onChange).toHaveBeenCalledWith({ page: 3, pageSize: 100 })
  })

  it('fires onChange with page 1 on first-arrow click', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Paginator page={5} pageSize={100} total={1000} onChange={onChange} />,
    )
    fireEvent.click(container.querySelector('[data-nav="first"]') as Element)
    expect(onChange).toHaveBeenCalledWith({ page: 1, pageSize: 100 })
  })

  it('fires onChange with the last page on last-arrow click', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Paginator page={1} pageSize={100} total={950} onChange={onChange} />,
    )
    fireEvent.click(container.querySelector('[data-nav="last"]') as Element)
    // ceil(950/100) = 10
    expect(onChange).toHaveBeenCalledWith({ page: 10, pageSize: 100 })
  })

  it('fires onChange resetting page to 1 when page-size chip is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Paginator page={5} pageSize={100} total={2000} onChange={onChange} />,
    )
    const chip = container.querySelector('[data-page-size="500"]') as HTMLButtonElement
    fireEvent.click(chip)
    expect(onChange).toHaveBeenCalledWith({ page: 1, pageSize: 500 })
  })

  it('hides itself when total <= pageSize (no pagination needed)', () => {
    const { container } = render(
      <Paginator page={1} pageSize={100} total={42} onChange={() => {}} />,
    )
    expect(container.querySelector('.aw-paginator')).toBeNull()
  })

  it('roots under .aw-paginator so the override layer can scope it', () => {
    const { container } = render(
      <Paginator page={1} pageSize={100} total={500} onChange={() => {}} />,
    )
    expect(container.querySelector('.aw-paginator')).toBeTruthy()
  })
})
