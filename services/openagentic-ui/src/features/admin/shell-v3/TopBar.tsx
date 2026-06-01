import * as React from 'react'
import { useTheme } from '../hooks/useTheme'
import { CompanyLogo } from '@/components/CompanyLogo'
import { NotificationsBell } from './NotificationsBell'
import './styles.css'

export interface Crumb { id?: string; label: string }

export interface TopBarProps {
  crumbs: Crumb[]
  onToggleSidebar?: () => void
  onOpenCmdK?: () => void
  onOpenActivity?: () => void
  /** Close admin console (return to chat / code / flows). */
  onClose?: () => void
  /**
   * Open the Admin AI Agent floating dock. Wired by AdminPortalHostV3 to
   * the controlled `<AdminAgentDock open onOpenChange />` mount. When
   * omitted, the agent pill still renders but the click is a no-op.
   * Restored 2026-05-17 (Sev-1 #932) — the pill used to be a static
   * `<div>` with no handler, so clicking it did nothing.
   */
  onOpenAgent?: () => void
  scope?: { env: string; region: string }
  user?: { initials: string; name?: string }
  agentLabel?: string
  version?: string
}

export const TopBar = ({
  crumbs,
  onToggleSidebar,
  onOpenCmdK,
  onOpenActivity,
  onClose,
  onOpenAgent,
  scope = { env: 'agentic-dev', region: 'us-west' },
  user = { initials: 'tw' },
  agentLabel = 'admin agent',
  version,
}: TopBarProps) => {
  const { density, setDensity } = useTheme()
  return (
    <header className="aw-topbar">
      <div className="aw-topbar__brand">
        {/* Shared CompanyLogo — same asset used in chat / code / flows
            sidebar headers so brand identity is consistent across all
            four product surfaces. */}
        <CompanyLogo variant="compact" width={160} height={28} />
        {version && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--fg-3)' }}>
            v{version}
          </span>
        )}
      </div>

      <button
        className="aw-topbar__icon-btn"
        title="Collapse sidebar"
        onClick={onToggleSidebar}
        aria-label="Collapse sidebar"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M4 3h8v10H4z" />
          <path d="M7 3v10" />
        </svg>
      </button>

      <nav className="aw-topbar__crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            <span className={`aw-topbar__crumb ${i === crumbs.length - 1 ? 'aw-topbar__crumb--head' : ''}`}>
              {c.label}
            </span>
            {i < crumbs.length - 1 && <span className="aw-topbar__crumb-sep">/</span>}
          </React.Fragment>
        ))}
      </nav>

      <div className="aw-topbar__actions">
        {/* Density toggle */}
        <div className="aw-topbar__density" role="tablist" aria-label="Density">
          {(['compact', 'cozy', 'comfortable'] as const).map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={density === d}
              onClick={() => setDensity(d)}
              title={d}
            >
              {d === 'compact' ? 'cmp' : d === 'cozy' ? 'coz' : 'cmf'}
            </button>
          ))}
        </div>

        {/* B'-13: theme toggle removed from topbar. Settings & More
            (chat SettingsMenu) is the single SoT for theme + accent
            across the entire admin console. The previous duplicate
            sun/moon button competed with the dashboard styling and
            confused operators about where canonical theme state was
            controlled. */}

        {/* Scope chip */}
        <button className="aw-topbar__chip" type="button">
          <span className="aw-topbar__chip-label">env</span>
          <span style={{ color: 'var(--fg-0)' }}>{scope.env}</span>
          <span style={{ color: 'var(--fg-3)' }}>·</span>
          <span style={{ color: 'var(--fg-0)' }}>{scope.region}</span>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M2 4l3 3 3-3" />
          </svg>
        </button>

        {/* Cmd+K search */}
        <button className="aw-topbar__search" onClick={onOpenCmdK} type="button">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M11 11l3 3" />
          </svg>
          <span>Search resources, pages, agents…</span>
          <kbd>⌘K</kbd>
        </button>

        <NotificationsBell />

        {/* C3: Activity drawer trigger — separate from notifications because
            this is the FULL audit-log tail (every action, regardless of
            severity). The bell is for severity-flagged events; this is for
            "show me what just happened across the tenant". */}
        <button
          className="aw-topbar__icon-btn"
          title="Activity"
          aria-label="Activity"
          onClick={onOpenActivity}
          type="button"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M2 8h3l2-5 2 10 2-5h3" />
          </svg>
        </button>

        {/* Admin agent pill — clickable trigger for the floating Admin AI
            dock. Previously this was a static `<div>` with no handler, so
            clicking did nothing. Now wired through `onOpenAgent` →
            AdminPortalHostV3 opens the controlled `<AdminAgentDock />`
            (floating bottom modal). (Sev-1 #932) */}
        <button
          type="button"
          className="aw-topbar__agent"
          aria-label="Open Admin Agent"
          onClick={onOpenAgent}
          // Keep the surface looking like a pill even though it's a button.
          style={{ cursor: onOpenAgent ? 'pointer' : 'default' }}
        >
          <span className="aw-topbar__agent-led" />
          <span className="aw-topbar__agent-name">{agentLabel}</span>
          <kbd
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              background: 'var(--bg-3)',
              border: '1px solid var(--line-2)',
              padding: '1px 4px',
              color: 'var(--fg-2)',
            }}
          >
            ⌘
          </kbd>
        </button>

        <div className="aw-topbar__user" title={user.name ?? user.initials}>
          {user.initials}
        </div>

        {/* Close admin console — returns to chat / code / flows. */}
        {onClose && (
          <button
            type="button"
            className="aw-topbar__close"
            aria-label="Close admin console"
            title="Close admin console"
            onClick={onClose}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
            <span className="aw-topbar__close-label">close</span>
          </button>
        )}
      </div>
    </header>
  )
}
