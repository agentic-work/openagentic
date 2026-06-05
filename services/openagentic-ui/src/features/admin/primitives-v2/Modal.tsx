/**
 * Modal — Phase 1 admin-overhaul primitive that replaces every hand-rolled
 * confirm dialog. Backed by docs/admin-console-overhaul/00-existing-state.md
 * §11.4 (visual CRUD feedback) + §11.2 (copy budget).
 *
 * Why this exists:
 *   The 26 destructive `useConfirm()` callsites today have ZERO typed-name
 *   confirmation. The shared/hooks/useConfirm hook does not even support a
 *   typed-confirm field. This primitive is the platform answer.
 *
 * API:
 *   <Modal
 *     open
 *     onClose={() => setOpen(false)}
 *     title="Delete MCP server"      // ≤ 6 words
 *     body="Removes server. Audit logs retained."  // ≤ 28 words / 2 sentences
 *     variant="destructive"          // 'confirm' | 'destructive' | 'form'
 *     requireConfirmText="kubernetes-mcp-server"   // optional typed-confirm
 *     primary={{ label: 'Delete', onClick, loading }}  // label ≤ 3 words
 *     secondary={{ label: 'Cancel', onClick }}         // label ≤ 2 words
 *   >
 *     {/* form variant accepts children *}/
 *   </Modal>
 *
 * Token discipline: all colors via --ap-* (no hex literals in source).
 */

import React, { useEffect, useRef, useState } from 'react'

export type ModalVariant = 'confirm' | 'destructive' | 'form'

export interface ModalCta {
  label: string
  onClick: () => void
  loading?: boolean
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  body?: React.ReactNode
  variant?: ModalVariant
  /** When set, renders a typed-confirm input. Primary CTA stays disabled
   *  until the user types this string EXACTLY (case-sensitive, trim-sensitive). */
  requireConfirmText?: string
  primary: ModalCta
  secondary: ModalCta
  /** form-variant body content. Rendered alongside `body`. */
  children?: React.ReactNode
  /** override default test id */
  testId?: string
}

export function Modal({
  open,
  onClose,
  title,
  body,
  variant = 'confirm',
  requireConfirmText,
  primary,
  secondary,
  children,
  testId = 'modal',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`).current

  // Reset typed-confirm whenever the dialog reopens.
  useEffect(() => {
    if (open) setConfirmText('')
  }, [open])

  // Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Initial-focus + focus-trap
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const focusables = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )

    // Move focus to the first focusable on open.
    const f = focusables()
    if (f.length > 0) {
      // microtask to let portal render
      requestAnimationFrame(() => f[0]?.focus())
    }

    // Trap Tab inside the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKey)
    return () => dialog.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const requireMatch = !!requireConfirmText
  const matched = requireMatch ? confirmText === requireConfirmText : true
  const primaryDisabled = !matched || !!primary.loading

  const isDestructive = variant === 'destructive'
  const primaryColorVar = isDestructive ? 'var(--ap-err, var(--err))' : 'var(--ap-accent, var(--accent))'

  return (
    <div
      data-testid={`${testId}-backdrop`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ap-bg-overlay, color-mix(in srgb, var(--color-shadow) 55%, transparent))',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        data-variant={variant}
        className="glass"
        onClick={(e) => e.stopPropagation()}
        style={{
          minWidth: 420,
          maxWidth: 560,
          color: 'var(--ap-fg-1, var(--fg-1))',
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <h2
          id={titleId}
          style={{
            margin: 0,
            fontFamily: 'var(--font-disp, var(--font-display, ui-serif))',
            fontStyle: 'italic',
            fontSize: 22,
            lineHeight: 1.1,
            letterSpacing: '-0.005em',
            color: 'var(--ap-fg-0, var(--fg-0))',
          }}
        >
          {title}
        </h2>

        {body && (
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.5,
              color: 'var(--ap-fg-2, var(--fg-2))',
            }}
          >
            {body}
          </div>
        )}

        {children && <div style={{ marginTop: 4 }}>{children}</div>}

        {requireMatch && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              htmlFor={`${testId}-confirm-input`}
              style={{
                fontSize: 11.5,
                color: 'var(--ap-fg-3, var(--fg-3))',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Type <code style={{
                background: 'var(--ctl-surf)',
                color: 'var(--ap-fg-1, var(--fg-1))',
                padding: '1px 5px',
                borderRadius: 4,
                fontSize: 11.5,
              }}>{requireConfirmText}</code> to confirm
            </label>
            <input
              id={`${testId}-confirm-input`}
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                padding: '8px 10px',
                border: '1px solid var(--glass-border)',
                borderRadius: 8,
                background: 'var(--ctl-surf)',
                color: 'var(--ap-fg-1, var(--fg-1))',
                outline: 'none',
              }}
            />
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 6,
          }}
        >
          <button
            type="button"
            data-testid={`${testId}-secondary`}
            onClick={secondary.onClick}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              border: '1px solid var(--ap-ln-2, var(--line-2))',
              background: 'transparent',
              color: 'var(--ap-fg-1, var(--fg-1))',
              cursor: 'pointer',
            }}
          >
            {secondary.label}
          </button>
          <button
            type="button"
            data-testid={`${testId}-primary`}
            data-variant={isDestructive ? 'destructive' : undefined}
            onClick={() => {
              if (primaryDisabled) return
              primary.onClick()
            }}
            disabled={primaryDisabled}
            aria-busy={primary.loading || undefined}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid transparent',
              background: primaryColorVar,
              color: 'var(--ap-fg-on-accent, white)',
              cursor: primaryDisabled ? 'not-allowed' : 'pointer',
              opacity: primaryDisabled ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {primary.loading && (
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  border: '2px solid currentColor',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'modal-spin 0.7s linear infinite',
                }}
              >
                <style>{`@keyframes modal-spin { to { transform: rotate(360deg); } }`}</style>
              </span>
            )}
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  )
}
