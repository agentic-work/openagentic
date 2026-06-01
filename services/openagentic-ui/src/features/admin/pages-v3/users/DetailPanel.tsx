import * as React from 'react'
import { Banner, Panel, PanelHead, StatusDot } from '../../primitives-v3'
import {
  useUnlockUser,
  useResetUserWarnings,
  useDeleteUser,
  type ApiUser,
} from '../../hooks/useUserManagement'
import { initialsFor, statusOf, roleOf } from './helpers'
import { ProfileTab, PermissionsTab, TokensTab, SessionsTab, ActivityTab } from './tabs'

export type DetailTab = 'profile' | 'permissions' | 'tokens' | 'sessions' | 'activity'

interface DetailPanelProps {
  user: ApiUser
  tab: DetailTab
  onTabChange: (t: DetailTab) => void
}

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'profile',     label: 'profile' },
  { id: 'permissions', label: 'permissions' },
  { id: 'tokens',      label: 'tokens' },
  { id: 'sessions',    label: 'sessions' },
  { id: 'activity',    label: 'activity' },
]

export const DetailPanel: React.FC<DetailPanelProps> = ({ user, tab, onTabChange }) => {
  const unlock = useUnlockUser(user.id)
  const resetWarn = useResetUserWarnings(user.id)
  const del = useDeleteUser(user.id)
  const lastErr = unlock.error || resetWarn.error || del.error
  const lastSuccess =
    (unlock.isSuccess && 'unlocked') ||
    (resetWarn.isSuccess && 'warnings reset') ||
    (del.isSuccess && 'deleted') ||
    null

  return (
    <Panel>
      <PanelHead
        title={user.name || user.email.split('@')[0]}
        count={user.email}
        right={
          <KebabMenu
            user={user}
            onUnlock={() => {
              unlock.reset(); resetWarn.reset(); del.reset()
              unlock.mutate()
            }}
            onResetWarnings={() => {
              unlock.reset(); resetWarn.reset(); del.reset()
              resetWarn.mutate()
            }}
            onDelete={() => {
              if (!window.confirm(
                `Permanently delete ${user.email}?\n\nThis removes all permissions, sessions, and audit data. ` +
                `This cannot be undone.`,
              )) return
              unlock.reset(); resetWarn.reset(); del.reset()
              del.mutate()
            }}
            busy={unlock.isPending || resetWarn.isPending || del.isPending}
          />
        }
      />
      <Header user={user} />
      {lastErr && (
        <Banner level="err" label="error">
          {lastErr.message || 'mutation failed'}
        </Banner>
      )}
      {lastSuccess && !lastErr && (
        <Banner level="ok" label="ok">
          {lastSuccess === 'unlocked'
            ? `account unlocked — warning count reset`
            : lastSuccess === 'warnings reset'
              ? `scope-violation warnings reset to 0`
              : `user deleted — list will refresh`}
        </Banner>
      )}
      <TabStrip active={tab} onChange={onTabChange} />
      <div style={{ overflowY: 'auto' }}>
        {tab === 'profile'     && <ProfileTab user={user} />}
        {tab === 'permissions' && <PermissionsTab user={user} />}
        {tab === 'tokens'      && <TokensTab user={user} />}
        {tab === 'sessions'    && <SessionsTab user={user} />}
        {tab === 'activity'    && <ActivityTab user={user} />}
      </div>
    </Panel>
  )
}

// ============================================================
// Header — big avatar + name + email + status pill + role pill
// ============================================================
const Header: React.FC<{ user: ApiUser }> = ({ user }) => {
  const s = statusOf(user)
  const dotMap: Record<typeof s, 'ok' | 'warn' | 'err'> = { active: 'ok', warned: 'warn', locked: 'err' }
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '14px 14px',
      borderBottom: '1px solid var(--line-1)',
    }}>
      <BigAvatar initials={initialsFor(user)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--v3-t-display, 14px)',
          color: 'var(--fg-0)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {user.name || user.email.split('@')[0]}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--v3-t-meta, 11px)',
          color: 'var(--fg-3)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {user.email}
        </div>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <StatusDot status={dotMap[s]} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--v3-t-meta, 11px)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--fg-2)',
        }}>{s}</span>
      </span>
      {roleOf(user) === 'admin' && (
        <span style={{
          padding: '1px 6px',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--v3-t-meta, 10px)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          border: '1px solid var(--line-1)',
          color: 'var(--accent)',
          background: 'var(--bg-2)',
        }}>admin</span>
      )}
    </div>
  )
}

const BigAvatar: React.FC<{ initials: string }> = ({ initials }) => (
  <span
    aria-hidden
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 36,
      height: 36,
      borderRadius: '50%',
      background: 'var(--bg-2)',
      border: '1px solid var(--line-1)',
      color: 'var(--fg-1)',
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: 0,
    }}
  >
    {initials}
  </span>
)

interface KebabMenuProps {
  user: ApiUser
  onUnlock: () => void
  onResetWarnings: () => void
  onDelete: () => void
  busy: boolean
}

const KebabMenu: React.FC<KebabMenuProps> = ({
  user,
  onUnlock,
  onResetWarnings,
  onDelete,
  busy,
}) => {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement | null>(null)

  // Click-outside dismiss + Esc dismiss.
  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const canUnlock = user.is_locked === true
  const canResetWarnings = (user.scope_warning_count ?? 0) > 0

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        title="actions"
        aria-label="actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 0,
          cursor: busy ? 'wait' : 'pointer',
          padding: 4,
          color: open ? 'var(--accent)' : 'var(--fg-2)',
          lineHeight: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 200,
            background: 'var(--bg-1)',
            border: '1px solid var(--line-1)',
            boxShadow: '0 8px 20px color-mix(in srgb, var(--color-shadow) 40%, transparent)',
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <KebabItem
            disabled={!canUnlock}
            title={canUnlock ? 'reset lock + warnings' : 'account is not locked'}
            onClick={() => { setOpen(false); onUnlock() }}
          >
            unlock account
          </KebabItem>
          <KebabItem
            disabled={!canResetWarnings}
            title={canResetWarnings ? `clear ${user.scope_warning_count} warning(s)` : 'no warnings'}
            onClick={() => { setOpen(false); onResetWarnings() }}
          >
            reset warnings
          </KebabItem>
          <div style={{ borderTop: '1px solid var(--line-1)' }} />
          <KebabItem
            danger
            onClick={() => { setOpen(false); onDelete() }}
          >
            delete user…
          </KebabItem>
        </div>
      )}
    </div>
  )
}

const KebabItem: React.FC<{
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
}> = ({ children, onClick, disabled, danger, title }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    title={title}
    style={{
      background: 'none',
      border: 0,
      cursor: disabled ? 'not-allowed' : 'pointer',
      padding: '8px 12px',
      textAlign: 'left',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--v3-t-meta, 11px)',
      color: disabled
        ? 'var(--fg-3)'
        : danger
          ? 'var(--err)'
          : 'var(--fg-1)',
      opacity: disabled ? 0.5 : 1,
    }}
  >
    {children}
  </button>
)

// ============================================================
// Tab strip — uppercase label row, accent underline on active
// ============================================================
const TabStrip: React.FC<{ active: DetailTab; onChange: (t: DetailTab) => void }> = ({ active, onChange }) => (
  <div role="tablist" style={{
    display: 'flex',
    gap: 0,
    borderBottom: '1px solid var(--line-1)',
    background: 'var(--bg-1)',
  }}>
    {TABS.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        style={{
          background: 'none',
          border: 0,
          cursor: 'pointer',
          padding: '8px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--v3-t-meta, 11px)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: active === t.id ? 'var(--accent)' : 'var(--fg-2)',
          borderBottom: active === t.id ? '1px solid var(--accent)' : '1px solid transparent',
          marginBottom: -1,
        }}
      >
        {t.label}
      </button>
    ))}
  </div>
)

export default DetailPanel
