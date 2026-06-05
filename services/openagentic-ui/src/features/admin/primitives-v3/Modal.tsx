import * as React from 'react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number | string
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, footer, width = 600 }) => {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'color-mix(in srgb, var(--color-shadow) 45%, transparent)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        className="glass"
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '92vw',
          maxHeight: '92vh',
          overflow: 'auto',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            position: 'relative',
            padding: '12px 14px',
            borderBottom: '1px solid var(--line-1)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background:
                'linear-gradient(90deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 40%, transparent) 25%, transparent 60%)',
              pointerEvents: 'none',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--v3-t-display, 16px)',
              color: 'var(--fg-0)',
              fontWeight: 500,
            }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label="close"
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 0,
              cursor: 'pointer',
              padding: 4,
              color: 'var(--fg-2)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '12px 14px', flex: 1, overflowY: 'auto' }}>{children}</div>

        {footer && (
          <div
            style={{
              padding: '10px 14px',
              borderTop: '1px solid var(--line-1)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 6,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// Standardized monospace input style used across all v3 modals — frosted
// glass field surface (var(--ctl-surf) + glass border) per the Terminal Glass
// control language.
export const v3InputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--ctl-surf)',
  color: 'var(--fg-0)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--ctl-radius-sm)',
  padding: '5px 9px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--v3-t-meta, 11px)',
  outline: 'none',
}

export const v3TextareaStyle: React.CSSProperties = {
  ...v3InputStyle,
  minHeight: 120,
  resize: 'vertical',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.5,
}
