import * as React from 'react'
import { useAdminQuery } from '../hooks/useAdminQuery'

interface AuditLogItem {
  id: string
  created_at: string
  admin_email?: string | null
  admin_user_id?: string | null
  action: string
  resource_type: string
  resource_id: string
  details?: any
}

interface AuditLogsResponse {
  logs: AuditLogItem[]
  pagination?: { total: number; page: number; limit: number }
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

interface ActivityDrawerProps {
  open: boolean
  onClose: () => void
}

export const ActivityDrawer: React.FC<ActivityDrawerProps> = ({ open, onClose }) => {
  const q = useAdminQuery<AuditLogsResponse>(
    ['audit-logs', 'drawer'],
    '/api/admin/audit-logs?limit=50',
    {
      staleTime: 15_000,
      refetchInterval: open ? 30_000 : false,
      enabled: open,
    },
  )

  if (!open) return null
  const items = q.data?.logs ?? []
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'color-mix(in srgb, var(--color-shadow) 25%, transparent)',
          zIndex: 998,
        }}
      />
      <aside
        role="dialog"
        aria-label="Activity drawer"
        style={{
          position: 'fixed',
          top: 'var(--v3-topbar-h, 44px)',
          right: 0,
          bottom: 0,
          width: 360,
          background: 'var(--bg-1)',
          borderLeft: '1px solid var(--line-2)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 999,
          fontFamily: 'var(--font-v3-body)',
          color: 'var(--fg-0)',
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
          }}
        >
          <span>
            <strong>activity</strong>
            <span style={{ marginLeft: 8, color: 'var(--fg-3)', fontSize: 11 }}>
              tenant audit log · most recent
            </span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => q.refetch()}
              style={{
                appearance: 'none',
                border: 'none',
                background: 'transparent',
                color: 'var(--fg-3)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              title="refresh"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                appearance: 'none',
                border: 'none',
                background: 'transparent',
                color: 'var(--fg-3)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              title="close"
            >
              ✕
            </button>
          </span>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {q.isLoading ? (
            <div style={{ padding: 16, color: 'var(--fg-3)', fontSize: 12, textAlign: 'center' }}>
              loading…
            </div>
          ) : q.isError ? (
            <div style={{ padding: 16, color: 'var(--err)', fontSize: 12, textAlign: 'center' }}>
              /api/admin/audit-logs unreachable
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--fg-3)', fontSize: 12, textAlign: 'center' }}>
              no recent activity
            </div>
          ) : (
            items.map((it) => (
              <div
                key={it.id}
                style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--line-1)',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontWeight: 500 }}>
                    <span style={{ color: 'var(--accent)' }}>{it.action}</span>
                    {' · '}
                    <span style={{ color: 'var(--fg-2)' }}>{it.resource_type}</span>
                  </span>
                  <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                    {relTime(it.created_at)}
                  </span>
                </div>
                <div
                  style={{
                    color: 'var(--fg-2)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    marginTop: 2,
                    wordBreak: 'break-all',
                  }}
                >
                  {(it.admin_email ?? it.admin_user_id ?? 'system')} → {it.resource_id}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  )
}

export default ActivityDrawer
