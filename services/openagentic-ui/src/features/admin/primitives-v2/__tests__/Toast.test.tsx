import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ToastHost, useToast } from '../Toast'

function PushButton({ kind, sticky }: { kind?: 'info' | 'success' | 'warn' | 'err'; sticky?: boolean }) {
  const { push } = useToast()
  return (
    <button onClick={() => push({ kind, sticky, title: 'x', sub: 's' })}>push</button>
  )
}

describe('Toast / ToastHost', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders nothing initially', () => {
    render(<ToastHost />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('push displays a toast with title + sub', () => {
    render(<ToastHost><PushButton kind="info" /></ToastHost>)
    fireEvent.click(screen.getByText('push'))
    expect(screen.getByText('x')).toBeInTheDocument()
    expect(screen.getByText('s')).toBeInTheDocument()
  })

  it('non-error toasts auto-dismiss after 4s', async () => {
    render(<ToastHost><PushButton kind="info" /></ToastHost>)
    fireEvent.click(screen.getByText('push'))
    expect(screen.getByText('x')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(4500) })
    expect(screen.queryByText('x')).toBeNull()
  })

  it('error toasts are sticky by default', async () => {
    render(<ToastHost><PushButton kind="err" /></ToastHost>)
    fireEvent.click(screen.getByText('push'))
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByText('x')).toBeInTheDocument()
  })

  it('sticky=true overrides auto-dismiss', async () => {
    render(<ToastHost><PushButton kind="info" sticky /></ToastHost>)
    fireEvent.click(screen.getByText('push'))
    await act(async () => { vi.advanceTimersByTime(8000) })
    expect(screen.getByText('x')).toBeInTheDocument()
  })

  it('dismiss button removes the toast', () => {
    render(<ToastHost><PushButton kind="info" /></ToastHost>)
    fireEvent.click(screen.getByText('push'))
    fireEvent.click(screen.getByLabelText(/dismiss/i))
    expect(screen.queryByText('x')).toBeNull()
  })
})
