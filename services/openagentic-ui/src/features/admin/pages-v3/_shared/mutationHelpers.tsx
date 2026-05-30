import * as React from 'react'
import { Banner, Btn } from '../../primitives-v3'
import { apiRequest } from '@/utils/api'
import { useAdminInvalidate } from '../../hooks/useAdminQuery'

// ============================================================
// Toast
// ============================================================
export type ToastLevel = 'ok' | 'err' | 'info' | 'warn'

export interface Toast {
  id: number
  level: ToastLevel
  label: string
  message: string
}

export interface ToastApi {
  toasts: Toast[]
  show: (level: ToastLevel, label: string, message: string, ttl?: number) => void
  dismiss: (id: number) => void
}

export function useToast(): ToastApi {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])
  const show = React.useCallback(
    (level: ToastLevel, label: string, message: string, ttl = 3000) => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev, { id, level, label, message }])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, ttl)
    },
    [],
  )
  return { toasts, show, dismiss }
}

export const ToastStack: React.FC<{ api: ToastApi }> = ({ api }) => {
  if (api.toasts.length === 0) return null
  return (
    <>
      {api.toasts.map((t) => (
        <Banner key={t.id} level={t.level} label={t.label}>
          {t.message}
        </Banner>
      ))}
    </>
  )
}

// ============================================================
// Confirm — inline danger confirm (no window.confirm)
// ============================================================
export interface ConfirmState {
  message: string
  onConfirm: () => void
  onCancel?: () => void
}

export interface ConfirmApi {
  pending: ConfirmState | null
  ask: (message: string, onConfirm: () => void, onCancel?: () => void) => void
  clear: () => void
}

export function useConfirm(): ConfirmApi {
  const [pending, setPending] = React.useState<ConfirmState | null>(null)
  const ask = React.useCallback(
    (message: string, onConfirm: () => void, onCancel?: () => void) => {
      setPending({ message, onConfirm, onCancel })
    },
    [],
  )
  const clear = React.useCallback(() => setPending(null), [])
  return { pending, ask, clear }
}

export const ConfirmBanner: React.FC<{ api: ConfirmApi }> = ({ api }) => {
  if (!api.pending) return null
  const { message, onConfirm, onCancel } = api.pending
  return (
    <Banner level="warn" label="confirm">
      {message}
      <span style={{ marginLeft: 12, display: 'inline-flex', gap: 6 }}>
        <Btn
          variant="primary"
          onClick={() => {
            onConfirm()
            api.clear()
          }}
        >
          confirm
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            onCancel?.()
            api.clear()
          }}
        >
          cancel
        </Btn>
      </span>
    </Banner>
  )
}

// ============================================================
// mutateRow — generic single-row apiRequest wrapper
// ============================================================
export interface MutateRowOptions {
  endpoint: string
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  toast: ToastApi
  invalidate: ReturnType<typeof useAdminInvalidate>
  invalidateKeys?: string[][]
  successMessage?: string
  errorPrefix?: string
  onSuccess?: (data: any) => void
  /** When true (default), parses JSON response and returns it. */
  parseJson?: boolean
}

export async function mutateRow(opts: MutateRowOptions): Promise<{ ok: boolean; data?: any; status?: number }> {
  const {
    endpoint,
    method = 'POST',
    body,
    toast,
    invalidate,
    invalidateKeys,
    successMessage,
    errorPrefix = 'request failed',
    onSuccess,
    parseJson = true,
  } = opts
  try {
    const res = await apiRequest(endpoint, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      let parsed: any
      try {
        parsed = JSON.parse(text)
      } catch {
        // not JSON; ignore
      }
      const msg = parsed?.message || parsed?.error || text || `HTTP ${res.status}`
      toast.show('err', 'error', `${errorPrefix}: ${msg.slice(0, 200)}`)
      return { ok: false, status: res.status }
    }
    let data: any
    if (parseJson && res.status !== 204) {
      data = await res.json().catch(() => undefined)
    }
    if (successMessage) toast.show('ok', 'saved', successMessage)
    if (invalidateKeys) {
      for (const key of invalidateKeys) invalidate(key)
    }
    onSuccess?.(data)
    return { ok: true, data, status: res.status }
  } catch (err: any) {
    toast.show('err', 'error', `${errorPrefix}: ${err?.message ?? 'unknown error'}`)
    return { ok: false }
  }
}
