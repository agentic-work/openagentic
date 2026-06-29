/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * TopBar — the rewrite chrome top bar.
 *
 * Left→right: rail toggle, bracket logo, scope selector pill (env badge),
 * cmd-K search, S/M/L density toggle, dark/light toggle, notifications
 * bell (count), "Admin Agent" pill, avatar. Matches the mock exactly.
 * Every affordance is token-only.
 */
import * as React from 'react'
import type { Tone } from '../types'

export interface ScopeInfo {
  name: string
  env: string
  /** env badge tone. */
  envTone: Tone
}

export interface TopBarProps {
  scope: ScopeInfo
  density: 'compact' | 'cozy' | 'comfortable'
  theme: 'dark' | 'light'
  bellCount?: number
  avatarInitials: string
  avatarTitle?: string
  onToggleRail: () => void
  onLogoClick: () => void
  onOpenScope: () => void
  onOpenCmdK: () => void
  onSetDensity: (d: 'compact' | 'cozy' | 'comfortable') => void
  onToggleTheme: () => void
  onOpenNotif: () => void
  onOpenAgent: () => void
  /** Exit the admin console back to chat (closes the showAdminPortal overlay). */
  onExit?: () => void
  /** Sign the admin user out (local-JWT logout via AuthContext). */
  onSignOut?: () => void
}

export function TopBar({
  scope,
  density,
  theme,
  bellCount = 0,
  avatarInitials,
  avatarTitle,
  onToggleRail,
  onLogoClick,
  onOpenScope,
  onOpenCmdK,
  onSetDensity,
  onToggleTheme,
  onOpenNotif,
  onOpenAgent,
  onExit,
  onSignOut,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement>(null)
  // Close the avatar menu on outside-click / Esc.
  React.useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])
  const hasMenu = Boolean(onExit || onSignOut)
  return (
    <header className="awc-topbar">
      <button className="awc-railtoggle" onClick={onToggleRail} title="Toggle navigation">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <button className="awc-logo" onClick={onLogoClick}>
        <span className="awc-logo__dot" />
        <span className="awc-brackets">
          <span className="br">[</span>openagentic<span className="br">]</span>
        </span>
      </button>

      <button className="awc-scope" onClick={onOpenScope}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 12l9 4 9-4" />
          <path d="M3 17l9 4 9-4" />
        </svg>
        <span className="awc-scope__name">{scope.name}</span>
        <span className="awc-scope__env" data-tone={scope.envTone}>
          {scope.env}
        </span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <button className="awc-cmdk" onClick={onOpenCmdK}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span>Search resources, agents, flows, actions…</span>
        <span className="awc-cmdk__kbd">⌘K</span>
      </button>

      <div className="awc-dens" title="Density">
        <button className={density === 'compact' ? 'awc-on' : ''} onClick={() => onSetDensity('compact')}>
          S
        </button>
        <button className={density === 'cozy' ? 'awc-on' : ''} onClick={() => onSetDensity('cozy')}>
          M
        </button>
        <button className={density === 'comfortable' ? 'awc-on' : ''} onClick={() => onSetDensity('comfortable')}>
          L
        </button>
      </div>

      <button className="awc-tb-ico" onClick={onToggleTheme} title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      </button>

      <button className="awc-tb-ico" onClick={onOpenNotif} title="Notifications">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {bellCount > 0 && <span className="awc-tb-ico__badge">{bellCount}</span>}
      </button>

      <button className="awc-agentpill" onClick={onOpenAgent}>
        <span className="awc-agentpill__av">✦</span>
        <span>Admin Agent</span>
      </button>

      {hasMenu ? (
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className="awc-avatar"
            title={avatarTitle}
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            style={{ cursor: 'pointer', border: 'none' }}
          >
            {avatarInitials}
          </button>
          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                minWidth: 180,
                background: 'var(--bg-1)',
                border: '1px solid var(--line-2)',
                borderRadius: 10,
                padding: 6,
                zIndex: 70,
                boxShadow: '0 18px 50px -16px color-mix(in srgb, var(--bg-0) 80%, transparent)',
              }}
            >
              <div
                style={{
                  padding: '6px 10px 8px',
                  fontSize: 11,
                  color: 'var(--fg-3)',
                  borderBottom: '1px solid var(--line-1)',
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {avatarTitle}
              </div>
              {onExit && (
                <button
                  role="menuitem"
                  className="awc-menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onExit()
                  }}
                  style={menuItemStyle}
                >
                  Back to chat
                </button>
              )}
              {onSignOut && (
                <button
                  role="menuitem"
                  className="awc-menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onSignOut()
                  }}
                  style={menuItemStyle}
                >
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="awc-avatar" title={avatarTitle}>
          {avatarInitials}
        </div>
      )}
    </header>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--fg-1)',
  background: 'transparent',
  border: 'none',
  borderRadius: 7,
  cursor: 'pointer',
}
