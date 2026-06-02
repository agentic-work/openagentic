import * as React from 'react'

export interface SidePanelTab {
  id: string
  label: string
  count?: number | string
}

export interface SidePanelProps {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  meta?: React.ReactNode
  tabs?: SidePanelTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  children: React.ReactNode
  /** Optional 3-dot / icon-only actions in the head right side. */
  headActions?: React.ReactNode
}

export const SidePanel = ({
  open,
  onClose,
  title,
  meta,
  tabs,
  activeTab,
  onTabChange,
  children,
  headActions,
}: SidePanelProps) => {
  // Close on Esc when open
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop click area — only intercepts when open */}
      {open && (
        <div
          onClick={onClose}
          aria-hidden
          style={{
            position: 'fixed',
            top: 'calc(var(--v3-topbar-h, 44px) + var(--v3-ribbon-h, 28px))',
            right: 0,
            bottom: 0,
            left: 'var(--v3-sidebar-w, 220px)',
            zIndex: 90,
            pointerEvents: 'auto',
          }}
        />
      )}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'detail'}
        className="aw-side-panel glass"
        data-open={open || undefined}
        style={{
          position: 'fixed',
          top: 'calc(var(--v3-topbar-h, 44px) + var(--v3-ribbon-h, 28px))',
          bottom: 0,
          right: 0,
          width: 'var(--v3-panel-w, 580px)',
          /* frosted glass detail panel over the aurora; square the right edge
             so it tucks flush to the viewport while keeping a soft left corner */
          borderRadius: 'var(--glass-radius, 18px) 0 0 var(--glass-radius, 18px)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms cubic-bezier(.6,0,0,1)',
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            borderBottom: '1px solid var(--line-1)',
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
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--v3-t-display, 16px)',
                color: 'var(--fg-0)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </div>
            {meta && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--v3-t-meta, 11px)',
                  color: 'var(--fg-3)',
                  marginTop: 2,
                }}
              >
                {meta}
              </div>
            )}
          </div>
          {headActions}
          <button
            onClick={onClose}
            aria-label="Close detail panel"
            style={{
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

        {tabs && tabs.length > 0 && (
          <div
            role="tablist"
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--line-1)',
              background: 'var(--ctl-surf)',
            }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => onTabChange?.(t.id)}
                style={{
                  background: 'none',
                  border: 0,
                  cursor: 'pointer',
                  padding: '8px 14px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--v3-t-meta)',
                  color: activeTab === t.id ? 'var(--accent)' : 'var(--fg-2)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  position: 'relative',
                  borderBottom: activeTab === t.id ? '1px solid var(--accent)' : '1px solid transparent',
                  marginBottom: -1,
                }}
              >
                {t.label}
                {t.count != null && (
                  <span style={{ color: 'var(--fg-3)', marginLeft: 5 }}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          {children}
        </div>
      </aside>
    </>
  )
}
