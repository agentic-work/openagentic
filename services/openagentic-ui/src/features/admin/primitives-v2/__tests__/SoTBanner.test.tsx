import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SoTBanner } from '../SoTBanner'

describe('SoTBanner', () => {
  it('renders the registry-SoT message', () => {
    render(<SoTBanner />)
    expect(screen.getByText(/REGISTRY · SoT/)).toBeInTheDocument()
    const note = screen.getByRole('note')
    expect(note.textContent).toMatch(/only.*place models become routable/i)
  })

  it('lists the four model-using surfaces', () => {
    render(<SoTBanner />)
    const note = screen.getByRole('note')
    const text = note.textContent ?? ''
    expect(text).toMatch(/chat/i)
    expect(text).toMatch(/flows/i)
    expect(text).toMatch(/agents/i)
    expect(text).toMatch(/code-mode/i)
  })

  it('renders optional context suffix', () => {
    render(<SoTBanner context="for code-mode specifically" />)
    const note = screen.getByRole('note')
    expect(note.textContent).toMatch(/for code-mode specifically/i)
  })

  it('renders Read-the-rule link with onClick callback', () => {
    let clicked = false
    render(<SoTBanner onReadRule={() => { clicked = true }} />)
    fireEvent.click(screen.getByRole('button', { name: /read the rule/i }))
    expect(clicked).toBe(true)
  })
})
