import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'

/**
 * Toast / ToastHost — global toast queue per STANDARDS.md §4 #9.
 *
 * Usage:
 *   <ToastHost />                           // mount once near the root
 *   const { push } = useToast()
 *   push({ kind: 'info', title: 'Saved', sub: 'live · 3 pods' })
 *
 * Rules:
 *   - One vertical column, bottom-right, max 380px wide.
 *   - kind: 'info' | 'success' | 'warn' | 'err'. err is sticky by default.
 *   - sticky:true overrides auto-dismiss (4s otherwise).
 *   - Optional actions[] for inline buttons (Retry / Show details / etc).
 */

export type ToastKind = 'info' | 'success' | 'warn' | 'err'
export interface ToastOptions {
  kind?: ToastKind
  title: string
  sub?: string
  sticky?: boolean
  actions?: Array<{ id: string; label: string; onClick?: () => void }>
}
export interface Toast extends Required<Pick<ToastOptions, 'kind'>>, Omit<ToastOptions, 'kind'> {
  id: string
}

interface ToastContextValue {
  push: (opts: ToastOptions) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)
let _seq = 0

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Fallback no-op so callers don't crash if host isn't mounted
    return {
      push: () => '',
      dismiss: () => {},
    }
  }
  return ctx
}

export function ToastHost({ children }: { children?: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setItems((s) => s.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((opts: ToastOptions) => {
    const id = `t${++_seq}`
    const t: Toast = { id, kind: opts.kind ?? 'info', ...opts }
    setItems((s) => [...s, t])
    return id
  }, [])

  // Auto-dismiss timers
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const t of items) {
      if (t.sticky) continue
      if (t.kind === 'err') continue
      timers.push(setTimeout(() => dismiss(t.id), 4000))
    }
    return () => { timers.forEach(clearTimeout) }
  }, [items, dismiss])

  const ctx = useMemo<ToastContextValue>(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div
        className="pointer-events-none fixed bottom-6 right-6 z-[200] flex flex-col gap-2"
        style={{ maxWidth: 380 }}
        data-testid="toast-host"
      >
        {items.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const color =
    toast.kind === 'err'
      ? 'var(--ap-err, var(--err))'
      : toast.kind === 'success'
        ? 'var(--ap-ok, var(--ok))'
        : toast.kind === 'warn'
          ? 'var(--ap-warn, var(--warn))'
          : 'var(--ap-info, var(--info))'
  return (
    <div
      role="status"
      aria-live={toast.kind === 'err' ? 'assertive' : 'polite'}
      className="pointer-events-auto bg-bg-2 font-mono text-[11px] flex gap-2 items-start rounded border px-4 py-3 shadow-2xl"
      style={{ borderColor: color, color }}
    >
      <div className="flex-1 leading-relaxed">
        <b className="block text-[11px] mb-1">{toast.title}</b>
        {toast.sub && <span className="text-fg-2 text-[10px]">{toast.sub}</span>}
        {toast.actions && toast.actions.length > 0 && (
          <div className="mt-2 flex gap-2">
            {toast.actions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { a.onClick?.(); onDismiss() }}
                className="rounded border px-2 py-[2px] text-[10px] hover:underline"
                style={{ borderColor: 'currentColor', color: 'inherit', background: 'transparent' }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        aria-label="dismiss toast"
        onClick={onDismiss}
        className="text-fg-3 hover:text-fg-0 cursor-pointer pl-2 text-base"
        style={{ background: 'transparent', border: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
