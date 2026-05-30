import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { StateMachineToggle } from '../StateMachineToggle'

describe('StateMachineToggle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders aria-checked reflecting initial state', () => {
    render(<StateMachineToggle checked={true} onCommit={async () => true} label="Bedrock" />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('flips optimistically the same frame as click', async () => {
    let resolved!: (v: boolean) => void
    const onCommit = vi.fn(() => new Promise<boolean>((r) => { resolved = r }))
    render(<StateMachineToggle checked={false} onCommit={onCommit} label="Bedrock" />)
    fireEvent.click(screen.getByRole('switch'))
    // immediate optimistic flip
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(onCommit).toHaveBeenCalledWith(true)
    // confirm
    await act(async () => { resolved(true); await Promise.resolve(); vi.advanceTimersByTime(100) })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('rolls back on error and signals errored state', async () => {
    let rejecter!: () => void
    const onCommit = vi.fn(() => new Promise<boolean>((_res, rej) => {
      rejecter = () => rej(new Error('500'))
    }))
    const onError = vi.fn()
    render(<StateMachineToggle checked={false} onCommit={onCommit} onError={onError} label="X" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      rejecter()
      await Promise.resolve(); await Promise.resolve()
      vi.advanceTimersByTime(100)
    })
    // rolled back to false
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(onError).toHaveBeenCalled()
  })

  it('treats onCommit returning false as a rollback', async () => {
    const onCommit = vi.fn(async () => false)
    render(<StateMachineToggle checked={false} onCommit={onCommit} label="X" />)
    fireEvent.click(screen.getByRole('switch'))
    // resolve microtasks then fire the 90ms minBusyTimer
    await act(async () => {
      await Promise.resolve(); await Promise.resolve()
      vi.advanceTimersByTime(100)
    })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('ignores clicks while a request is in flight', async () => {
    const onCommit = vi.fn(() => new Promise<boolean>(() => {}))
    render(<StateMachineToggle checked={false} onCommit={onCommit} label="X" />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('switch'))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('respects disabled prop', async () => {
    const onCommit = vi.fn(async () => true)
    render(<StateMachineToggle checked={false} onCommit={onCommit} disabled label="X" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onCommit).not.toHaveBeenCalled()
  })
})
