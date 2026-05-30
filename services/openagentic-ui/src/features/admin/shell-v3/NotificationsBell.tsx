import * as React from 'react'
import { useAdminQuery } from '../hooks/useAdminQuery'

const LAST_SEEN_KEY = 'aw-notifications-last-seen-v1'

interface NotificationItem {
  id: string
  ts: string
  level: 'info' | 'warn' | 'err'
  source: 'admin-audit' | 'dlp'
  title: string
  detail: string
}

interface NotificationsResponse {
  success: boolean
  window: string
  counts: { total: number; err: number; warn: number; info: number }
  items: NotificationItem[]
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export const NotificationsBell: React.FC = () => {
  const [open, setOpen] = React.useState(false)
  const [lastSeen, setLastSeen] = React.useState<string>(() => {
    try { return localStorage.getItem(LAST_SEEN_KEY) ?? '' } catch { return '' }
  })

  const q = useAdminQuery<NotificationsResponse>(
    ['notifications'],
    '/api/admin/notifications?limit=30',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const items = q.data?.items ?? []
  const unseen = items.filter((it) => !lastSeen || it.ts > lastSeen)
  const unseenCount = unseen.length
  const unseenWarn = unseen.filter((it) => it.level !== 'info').length

  const markAllRead = () => {
    if (items.length === 0) return
    const newest = items[0].ts
    setLastSeen(newest)
    try { localStorage.setItem(LAST_SEEN_KEY, newest) } catch { /* ignore */ }
  }

  // Close on outside-click.
  const ref = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const dotColor = unseenWarn > 0
    ? 'var(--err)'
    : unseenCount > 0
      ? 'var(--warn)'
      : null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="aw-topbar__icon-btn"
        title="Notifications"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 12V7a5 5 0 0 1 10 0v5l1 2H2l1-2zM6 14a2 2 0 0 0 4 0" />
        </svg>
        {dotColor && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dotColor,
              boxShadow: '0 0 0 1px var(--bg-1)',
            }}
          />
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 360,
            maxHeight: '60vh',
            background: 'var(--bg-1)',
            border: '1px solid var(--line-2)',
            color: 'var(--fg-0)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 999,
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 14px',
              borderBottom: '1px solid var(--line-1)',
              fontSize: 12,
              fontFamily: 'var(--font-v3-body)',
            }}
          >
            <span>
              <strong>notifications</strong>
              {q.data?.counts && (
                <span style={{ marginLeft: 8, color: 'var(--fg-3)', fontSize: 11 }}>
                  {q.data.counts.err + q.data.counts.warn} active · {q.data.window}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={markAllRead}
              disabled={items.length === 0}
              style={{
                appearance: 'none',
                border: 'none',
                background: 'transparent',
                color: 'var(--accent)',
                cursor: items.length === 0 ? 'default' : 'pointer',
                fontSize: 11,
                fontFamily: 'var(--font-v3-mono)',
                opacity: items.length === 0 ? 0.5 : 1,
              }}
            >
              mark all read
            </button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {q.isLoading ? (
              <div style={{ padding: 16, color: 'var(--fg-3)', fontSize: 12, textAlign: 'center' }}>
                loading…
              </div>
            ) : q.isError ? (
              <div style={{ padding: 16, color: 'var(--err)', fontSize: 12, textAlign: 'center' }}>
                /api/admin/notifications unreachable
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--fg-3)', fontSize: 12, textAlign: 'center' }}>
                no notifications in the last 7 days
              </div>
            ) : (
              items.map((it) => {
                const tone = it.level === 'err'
                  ? 'var(--err)'
                  : it.level === 'warn'
                    ? 'var(--warn)'
                    : 'var(--fg-3)'
                const isUnseen = !lastSeen || it.ts > lastSeen
                return (
                  <div
                    key={it.id}
                    style={{
                      padding: '8px 14px',
                      borderBottom: '1px solid var(--line-1)',
                      borderLeft: `2px solid ${isUnseen ? tone : 'transparent'}`,
                      background: isUnseen ? 'var(--bg-2)' : 'transparent',
                      fontSize: 12,
                      fontFamily: 'var(--font-v3-body)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{it.title}</span>
                      <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)', fontSize: 10 }}>
                        {relTime(it.ts)}
                      </span>
                    </div>
                    <div style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-v3-mono)', fontSize: 11, marginTop: 2 }}>
                      {it.source} · {it.detail}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default NotificationsBell
