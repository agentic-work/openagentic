import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * StateMachineToggle — the canonical toggle component for admin v2.
 * Fixes the "I clicked the slider and nothing happened" bug class.
 *
 * State machine (per STANDARDS.md §5.1):
 *   idle → optimistic_on → busy → confirmed
 *                              ↘ error → rollback
 *
 * Behaviour:
 *   - Click flips state immediately (same frame; optimistic). aria-checked
 *     updates synchronously so screen readers + the visual stay in sync.
 *   - onCommit fires; while it's in flight, additional clicks are ignored.
 *   - Resolution: success → confirmed (visual pulse). false-resolve OR
 *     reject → rollback (slide back, optional error toast via onError).
 *   - 90ms minimum busy display so confirmed flashes are visible even when
 *     the network is fast — feedback you can't see isn't feedback.
 *
 * Theme-aware: uses --bg-2/3, --accent, --err, --line-2 from the active
 * theme so it matches everywhere.
 */
export type ToggleStatus = 'idle' | 'busy' | 'confirmed' | 'errored'

export interface StateMachineToggleProps {
  checked: boolean
  /**
   * Called when the user clicks. Receives the *desired* new value.
   * Resolve `true` → committed; resolve `false` or reject → roll back.
   */
  onCommit: (next: boolean) => Promise<boolean>
  /** Called on rejection / false-resolve so caller can fire a toast. */
  onError?: (err: unknown, attemptedValue: boolean) => void
  /** Visual + aria label */
  label: string
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
  'data-testid'?: string
}

export function StateMachineToggle({
  checked,
  onCommit,
  onError,
  label,
  size = 'md',
  disabled,
  className = '',
  ...rest
}: StateMachineToggleProps) {
  // Local optimistic state — diverges from `checked` while a request is in flight.
  const [optimistic, setOptimistic] = useState(checked)
  const [status, setStatus] = useState<ToggleStatus>('idle')
  const inFlight = useRef(false)
  const minBusyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // If parent updates `checked` (e.g. external refresh) and we're not mid-flight, sync.
  useEffect(() => {
    if (!inFlight.current) setOptimistic(checked)
  }, [checked])

  useEffect(() => () => {
    if (minBusyTimer.current) clearTimeout(minBusyTimer.current)
  }, [])

  const flip = useCallback(async () => {
    if (disabled || inFlight.current) return
    const next = !optimistic
    inFlight.current = true
    setOptimistic(next)
    setStatus('busy')
    let minBusyDone = false
    let resolution: { ok: true } | { ok: false; err?: unknown } | null = null
    minBusyTimer.current = setTimeout(() => {
      minBusyDone = true
      if (resolution) finalize(resolution)
    }, 90)

    function finalize(r: { ok: true } | { ok: false; err?: unknown }) {
      if (r.ok === true) {
        setStatus('confirmed')
        setTimeout(() => setStatus('idle'), 600)
      } else {
        setOptimistic(!next)
        setStatus('errored')
        setTimeout(() => setStatus('idle'), 400)
        const errVal = (r as { ok: false; err?: unknown }).err
        if (onError) onError(errVal, next)
      }
      inFlight.current = false
    }

    try {
      const ok = await onCommit(next)
      resolution = ok === false ? { ok: false } : { ok: true }
    } catch (err) {
      resolution = { ok: false, err }
    }
    if (minBusyDone) finalize(resolution)
  }, [disabled, optimistic, onCommit, onError])

  const w = size === 'sm' ? 32 : 36
  const h = size === 'sm' ? 16 : 18
  const knob = h - 4
  const trackBg =
    status === 'errored'
      ? 'var(--ap-err, var(--err))'
      : optimistic
        ? 'var(--ap-accent, var(--accent))'
        : 'var(--ap-bg-3, var(--bg-3))'
  const knobBg =
    optimistic && status !== 'errored' ? 'var(--ap-bg-0, var(--bg-0))' : 'var(--ap-fg-2, var(--fg-2))'
  const knobShadow =
    status === 'busy'
      ? `inset 0 0 0 2px var(--accent, var(--ap-accent))`
      : status === 'confirmed'
        ? `0 0 0 4px color-mix(in srgb, var(--accent, var(--ap-accent)) 0%, transparent)`
        : undefined

  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      aria-label={label}
      disabled={disabled}
      onClick={flip}
      data-status={status}
      className={`relative inline-block rounded-full border border-ln-2 transition-colors duration-150 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
      style={{ width: w, height: h, background: trackBg, padding: 0 }}
      {...rest}
    >
      <span
        aria-hidden="true"
        className="absolute top-[1px] rounded-full transition-all duration-150 ease-out"
        style={{
          left: optimistic ? `${w - knob - 3}px` : '1px',
          width: knob,
          height: knob,
          background: knobBg,
          boxShadow: knobShadow,
          animation:
            status === 'busy'
              ? 'sm-toggle-spin 0.7s linear infinite'
              : status === 'confirmed'
                ? 'sm-toggle-pulse 600ms ease-out'
                : status === 'errored'
                  ? 'sm-toggle-shake 400ms ease-out'
                  : undefined,
        }}
      />
      <style>{`
        @keyframes sm-toggle-spin { to { transform: rotate(360deg); } }
        @keyframes sm-toggle-pulse { 0% { box-shadow: 0 0 0 0 var(--accent, var(--ap-accent)); } 100% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent, var(--ap-accent)) 0%, transparent); } }
        @keyframes sm-toggle-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
      `}</style>
    </button>
  )
}
