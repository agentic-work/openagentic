import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Pill } from '../Pill'

describe('Pill', () => {
  it('renders the label', () => {
    render(<Pill tone="ok">healthy</Pill>)
    expect(screen.getByText('healthy')).toBeInTheDocument()
  })

  it('exposes the tone via data-tone for testing/styling', () => {
    const { container } = render(<Pill tone="warn">throttled</Pill>)
    expect(container.querySelector('[data-tone="warn"]')).toBeTruthy()
  })

  it('uses only --ap-* tokens (no hex literals in inline style)', () => {
    const { container } = render(<Pill tone="ok">x</Pill>)
    const el = container.querySelector('[data-tone]') as HTMLElement
    const styleAttr = el.getAttribute('style') ?? ''
    expect(styleAttr).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('supports all five tones', () => {
    const { rerender, container } = render(<Pill tone="ok">x</Pill>)
    for (const tone of ['ok', 'warn', 'err', 'idle', 'info'] as const) {
      rerender(<Pill tone={tone}>x</Pill>)
      expect(container.querySelector(`[data-tone="${tone}"]`)).toBeTruthy()
    }
  })
})
