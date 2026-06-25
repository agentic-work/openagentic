import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdminAIBar, AdminAIPanel } from '../AdminAI'

describe('AdminAIBar', () => {
  it('renders the input with cmd-K hint', () => {
    render(<AdminAIBar onOpen={() => {}} />)
    const input = screen.getByPlaceholderText(/ask admin ai/i)
    expect(input).toBeInTheDocument()
    expect(screen.getByText(/⌘\s*K/i)).toBeInTheDocument()
  })

  it('focus triggers onOpen', () => {
    const onOpen = vi.fn()
    render(<AdminAIBar onOpen={onOpen} />)
    fireEvent.focus(screen.getByPlaceholderText(/ask admin ai/i))
    expect(onOpen).toHaveBeenCalled()
  })

  it('click triggers onOpen', () => {
    const onOpen = vi.fn()
    render(<AdminAIBar onOpen={onOpen} />)
    fireEvent.click(screen.getByPlaceholderText(/ask admin ai/i))
    expect(onOpen).toHaveBeenCalled()
  })
})

describe('AdminAIPanel', () => {
  it('renders header + suggestions when open + empty', () => {
    render(<AdminAIPanel open onClose={() => {}} suggestions={[{ q: 'How do I add a model?' }]} onAsk={async () => 'ok'} />)
    expect(screen.getByText(/admin ai assistant/i)).toBeInTheDocument()
    expect(screen.getByText(/how do i add a model/i)).toBeInTheDocument()
  })

  it('clicking a suggestion calls onAsk and renders the answer', async () => {
    const onAsk = vi.fn(async () => 'Open Models, click Add Model.')
    render(<AdminAIPanel open onClose={() => {}} suggestions={[{ q: 'How?' }]} onAsk={onAsk} />)
    fireEvent.click(screen.getByText('How?'))
    expect(onAsk).toHaveBeenCalledWith('How?')
    // wait for answer
    await screen.findByText(/open models/i)
  })

  it('Escape calls onClose when open', () => {
    const onClose = vi.fn()
    render(<AdminAIPanel open onClose={onClose} suggestions={[]} onAsk={async () => ''} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <AdminAIPanel open={false} onClose={() => {}} suggestions={[]} onAsk={async () => ''} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
