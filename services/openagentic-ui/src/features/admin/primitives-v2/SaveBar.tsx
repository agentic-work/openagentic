import React, { useState } from 'react'

/**
 * SaveBar — uniform save state machine for any multi-field admin form.
 * Per STANDARDS.md §5.3.
 *
 * States:
 *   idle      → "no pending changes"; both buttons disabled
 *   dirty     → "N pending changes · summary"; both buttons enabled
 *   saving    → spinner + "Saving N changes…"; buttons disabled
 *   saved     → green flash + "✓ Saved · just now" (auto-resets to idle in 2.4s)
 *   errored   → red border + "Save failed: …" + retry-enabled Save
 *
 * Caller owns the actual dirty-tracking and passes pendingCount + summary.
 */

type State = 'dirty' | 'saving' | 'saved' | 'errored'

export function SaveBar({
  pendingCount,
  pendingSummary,
  onSave,
  onDiscard,
  className = '',
}: {
  pendingCount: number
  pendingSummary?: string
  onSave: () => Promise<void>
  onDiscard: () => void
  className?: string
}) {
  const [state, setState] = useState<State>('dirty')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const isIdle = pendingCount === 0 && state !== 'saving' && state !== 'saved' && state !== 'errored'
  const showState: State | 'idle' = pendingCount === 0 && state === 'dirty' ? 'idle' : state

  const handleSave = async () => {
    setState('saving')
    setErrMsg(null)
    try {
      await onSave()
      setState('saved')
      setTimeout(() => setState('dirty'), 2400)
    } catch (e: any) {
      setState('errored')
      setErrMsg(e?.message ?? 'unknown error')
    }
  }

  const color =
    showState === 'saving'
      ? 'var(--ap-warn, var(--warn))'
      : showState === 'saved'
        ? 'var(--ap-ok, var(--ok))'
        : showState === 'errored'
          ? 'var(--ap-err, var(--err))'
          : pendingCount > 0
            ? 'var(--ap-accent, var(--accent))'
            : 'var(--ap-ln-3, var(--line-3))'

  let infoText: React.ReactNode
  if (showState === 'saving') infoText = <><Spinner /> Saving {pendingCount} change{pendingCount > 1 ? 's' : ''}…</>
  else if (showState === 'saved') infoText = <>✓ Saved · just now · 3 pods syncing</>
  else if (showState === 'errored') infoText = <>Save failed: {errMsg}</>
  else if (pendingCount > 0) infoText = <><b className="text-fg-0">{pendingCount} pending change{pendingCount > 1 ? 's' : ''}</b>{pendingSummary ? ` · ${pendingSummary}` : ''}</>
  else infoText = <>No pending changes</>

  return (
    <div
      role="region"
      aria-label="Save bar"
      data-state={showState === 'dirty' && pendingCount === 0 ? 'idle' : showState}
      className={`font-mono mt-6 flex items-center gap-4 rounded border px-4 py-3 text-[11px] ${className}`}
      style={{
        borderColor: color,
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        background:
          showState === 'saving' || showState === 'errored' || pendingCount > 0
            ? `linear-gradient(180deg, var(--ctl-surf), color-mix(in srgb, ${color} 8%, var(--ctl-surf)))`
            : 'var(--ctl-surf)',
      }}
    >
      <span className="text-fg-2" style={{ color: pendingCount === 0 ? 'var(--fg-3)' : color }}>
        {infoText}
      </span>
      <div className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={isIdle || showState === 'saving' || showState === 'saved'}
          className="rounded border border-ln-2 bg-transparent text-fg-2 px-3 py-1 text-[11px] disabled:opacity-40 enabled:hover:text-fg-0"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isIdle || showState === 'saving' || showState === 'saved'}
          className="rounded border px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
          style={{
            background: showState === 'errored' ? 'var(--ap-err, var(--err))' : 'var(--ap-accent, var(--accent))',
            color: 'var(--color-on-accent)',
            borderColor: showState === 'errored' ? 'var(--err)' : 'var(--accent)',
          }}
        >
          {showState === 'errored' ? 'Retry save' : 'Save & Apply Live'}
        </button>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="mr-2 inline-block align-middle"
      style={{
        width: 12,
        height: 12,
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'sb-spin 0.7s linear infinite',
      }}
    >
      <style>{`@keyframes sb-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  )
}
