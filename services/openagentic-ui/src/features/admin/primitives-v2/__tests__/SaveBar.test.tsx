import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SaveBar } from '../SaveBar'

describe('SaveBar', () => {
  it('renders idle when no pending changes', () => {
    render(<SaveBar pendingCount={0} onSave={async () => {}} onDiscard={() => {}} />)
    expect(screen.getByText(/no pending changes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /discard/i })).toBeDisabled()
  })

  it('renders dirty when pending > 0 with count + summary', () => {
    render(
      <SaveBar
        pendingCount={3}
        pendingSummary="default_models.chat, default_models.code, default_models.embeddings"
        onSave={async () => {}}
        onDiscard={() => {}}
      />,
    )
    expect(screen.getByText(/3 pending changes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('walks idle → saving → saved on Save', async () => {
    let resolveSave!: () => void
    const onSave = vi.fn(() => new Promise<void>((r) => { resolveSave = r }))
    render(<SaveBar pendingCount={1} onSave={onSave} onDiscard={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(screen.getByText(/saving/i)).toBeInTheDocument()
    await act(async () => { resolveSave(); await Promise.resolve() })
    expect(screen.getByText(/saved/i)).toBeInTheDocument()
  })

  it('rolls to error state if onSave rejects', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('boom')))
    render(<SaveBar pendingCount={1} onSave={onSave} onDiscard={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText(/failed|error/i)).toBeInTheDocument()
  })

  it('Discard fires onDiscard', () => {
    const onDiscard = vi.fn()
    render(<SaveBar pendingCount={2} onSave={async () => {}} onDiscard={onDiscard} />)
    fireEvent.click(screen.getByRole('button', { name: /discard/i }))
    expect(onDiscard).toHaveBeenCalled()
  })
})
