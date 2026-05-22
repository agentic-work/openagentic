import React from 'react'

/**
 * PageHeader — the universal page-header skeleton every admin surface uses.
 * Pattern (proposal-atlas.html):
 *   crumbs · H1 · explainer · primary actions · (optional) tabs
 *
 * Every admin page must render exactly one PageHeader at the top. No bespoke
 * layouts. The component is theme-aware: it reads from --ap-* tokens scoped
 * under .admin-portal, so accent / surfaces / borders all follow the user
 * theme. There are no hex literals in this file by design.
 */

export type PageAction =
  | { kind?: 'button'; label: string; primary?: boolean; onClick?: () => void; disabled?: boolean }
  | {
      kind: 'chips'
      options: Array<{ label: string; on?: boolean }>
      onChange?: (label: string) => void
    }

export type PageTab = {
  id: string
  label: string
  count?: number | string
}

export interface PageHeaderProps {
  /** Breadcrumb segments. The last segment is rendered as the current page. */
  crumbs: string[]
  /** Page title — rendered as H1. */
  title: string
  /** One-line plain-language description; supports inline <strong>/<em>. */
  explainer?: React.ReactNode
  /** Right-aligned page-level actions (buttons or a chip-group). */
  actions?: PageAction[]
  /** Optional tab strip rendered immediately under the row. */
  tabs?: PageTab[]
  /** id of the currently-selected tab. */
  activeTabId?: string
  /** Fired when a tab is clicked. */
  onTabChange?: (id: string) => void
  /** Optional data-testid override (default: "page-header"). */
  testId?: string
  /** When true, the header sticks to the top of its scroll container. */
  sticky?: boolean
}

export function PageHeader({
  crumbs,
  title,
  explainer,
  actions = [],
  tabs,
  activeTabId,
  onTabChange,
  testId = 'page-header',
  sticky,
}: PageHeaderProps) {
  return (
    <header
      data-testid={testId}
      className="border-b border-ln-1"
      style={{
        padding: '20px 32px 16px',
        background: 'var(--ap-bg-0, var(--bg-0))',
        ...(sticky
          ? {
              position: 'sticky',
              top: 0,
              zIndex: 10,
              background: 'var(--ap-bg-1)',
            }
          : {}),
      }}
    >
      <div
        className="flex items-center"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10.5px',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ap-fg-3, var(--fg-3))',
          marginBottom: 6,
        }}
      >
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <React.Fragment key={`${i}-${c}`}>
              <span className={isLast ? 'cur' : ''} style={isLast ? { color: 'var(--ap-fg-1, var(--fg-1))' } : undefined}>
                {c}
              </span>
              {!isLast && (
                <span style={{ padding: '0 8px', color: 'var(--ap-fg-3, var(--fg-3))' }}>/</span>
              )}
            </React.Fragment>
          )
        })}
      </div>

      <div className="grid items-center gap-4" style={{ gridTemplateColumns: '1fr auto' }}>
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-disp, Fraunces, Georgia, serif)',
              fontWeight: 500,
              fontSize: 26,
              lineHeight: 1.1,
              letterSpacing: '-0.012em',
              color: 'var(--ap-fg-0, var(--fg-0))',
            }}
          >
            {title}
          </h1>
          {explainer && (
            <div
              style={{
                marginTop: 6,
                color: 'var(--ap-fg-1, var(--fg-1))',
                fontSize: 13.5,
                lineHeight: 1.5,
                maxWidth: 720,
              }}
            >
              {explainer}
            </div>
          )}
        </div>
        {actions.length > 0 && (
          <div className="flex items-center gap-2">
            {actions.map((a, i) =>
              'kind' in a && a.kind === 'chips' ? (
                <ChipGroup key={i} options={a.options} onChange={a.onChange} />
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={(a as Extract<PageAction, { label: string }>).onClick}
                  disabled={(a as Extract<PageAction, { label: string }>).disabled}
                  style={{
                    fontFamily: 'var(--font-ui, inherit)',
                    fontSize: 12,
                    fontWeight: 500,
                    padding: '6px 14px',
                    borderRadius: 3,
                    border: '1px solid var(--ap-ln-2, var(--ln-2))',
                    background: (a as Extract<PageAction, { label: string }>).primary
                      ? 'var(--ap-accent, var(--accent))'
                      : 'var(--ap-bg-1, var(--bg-1))',
                    color: (a as Extract<PageAction, { label: string }>).primary
                      ? 'var(--ap-fg-on-accent, white)'
                      : 'var(--ap-fg-1, var(--fg-1))',
                    borderColor: (a as Extract<PageAction, { label: string }>).primary
                      ? 'var(--ap-accent, var(--accent))'
                      : 'var(--ap-ln-2, var(--ln-2))',
                    cursor: (a as Extract<PageAction, { label: string }>).disabled ? 'not-allowed' : 'pointer',
                    opacity: (a as Extract<PageAction, { label: string }>).disabled ? 0.5 : 1,
                  }}
                >
                  {(a as Extract<PageAction, { label: string }>).label}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      {tabs && tabs.length > 0 && (
        <div
          role="tablist"
          className="flex items-stretch overflow-x-auto"
          style={{
            borderBottom: '1px solid var(--ap-ln-1, var(--ln-1))',
            margin: '16px -32px -16px',
            padding: '0 32px',
          }}
        >
          {tabs.map((t) => {
            const isActive = t.id === activeTabId
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => onTabChange?.(t.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '10px 16px',
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: isActive ? 'var(--ap-fg-0, var(--fg-0))' : 'var(--ap-fg-2, var(--fg-2))',
                  borderBottom: isActive ? '2px solid var(--ap-accent, var(--accent))' : '2px solid transparent',
                  marginBottom: -1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  flexShrink: 0,
                  cursor: 'pointer',
                }}
              >
                <span>{t.label}</span>
                {t.count != null && (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 2,
                      background: isActive ? 'var(--ap-accent-soft, var(--accent-soft))' : 'var(--ap-bg-2, var(--bg-2))',
                      color: isActive ? 'var(--ap-accent, var(--accent))' : 'var(--ap-fg-2, var(--fg-2))',
                    }}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </header>
  )
}

function ChipGroup({
  options,
  onChange,
}: {
  options: Array<{ label: string; on?: boolean }>
  onChange?: (label: string) => void
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        border: '1px solid var(--ap-ln-2, var(--ln-2))',
        borderRadius: 3,
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {options.map((o, i) => (
        <button
          key={i}
          type="button"
          aria-pressed={!!o.on}
          onClick={() => onChange?.(o.label)}
          style={{
            background: o.on ? 'var(--ap-accent-soft, var(--accent-soft))' : 'transparent',
            color: o.on ? 'var(--ap-accent, var(--accent))' : 'var(--ap-fg-2, var(--fg-2))',
            border: 'none',
            borderRight: i === options.length - 1 ? 'none' : '1px solid var(--ap-ln-1, var(--ln-1))',
            padding: '5px 10px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}
