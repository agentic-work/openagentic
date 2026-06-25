import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemePanel } from '../ThemePanel'

describe('ThemePanel', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.removeAttribute('data-theme')
    document.body.removeAttribute('data-accent')
  })

  it('does not render when open=false', () => {
    const { container } = render(<ThemePanel open={false} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders mode buttons and 6 accent swatches when open', () => {
    render(<ThemePanel open onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /^Dark$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Light$/ })).toBeInTheDocument()
    ;['gcp','green','teal','amber','violet','magenta'].forEach(a => {
      expect(screen.getByTestId(`accent-${a}`)).toBeInTheDocument()
    })
  })

  it('clicking Light flips document.body[data-theme] to light', async () => {
    render(<ThemePanel open onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /^Light$/ }))
    expect(document.body.dataset.theme).toBe('light')
  })

  it('clicking an accent swatch flips document.body[data-accent]', async () => {
    render(<ThemePanel open onClose={() => {}} />)
    await userEvent.click(screen.getByTestId('accent-amber'))
    expect(document.body.dataset.accent).toBe('amber')
  })

  it('renders CSS var inspector (:root · live values section)', () => {
    render(<ThemePanel open onClose={() => {}} />)
    expect(screen.getByText(/:root · live values/i)).toBeInTheDocument()
    expect(screen.getByText('--bg-0')).toBeInTheDocument()
    expect(screen.getByText('--pri')).toBeInTheDocument()
  })

  it('ESC button invokes onClose', async () => {
    const onClose = vi.fn()
    render(<ThemePanel open onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /ESC/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
