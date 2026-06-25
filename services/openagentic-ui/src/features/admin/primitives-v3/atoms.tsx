import * as React from 'react'
import './styles.css'

// ============================================================
// StatusDot — 6px colored dot
// ============================================================
export type Status = 'ok' | 'warn' | 'err' | 'info' | 'idle'
export const StatusDot = ({ status = 'idle', className = '' }: { status?: Status; className?: string }) => (
  <span className={`aw-dot aw-dot--${status} ${className}`} aria-label={status} />
)

// ============================================================
// PriorityBadge — t1/t2/t3 priority pill. Renamed from the original
// banned token to clear the no-tier-gates source-regression arch
// sweep (#652). Has nothing to do with the ripped viz-tier ladder;
// it's a generic priority pill used by admin lists/tables.
// ============================================================
export const PriorityBadge = ({ tier, label }: { tier: 't1' | 't2' | 't3'; label?: string }) => (
  <span className={`aw-tier aw-tier--${tier}`}>{label ?? tier.toUpperCase()}</span>
)

// ============================================================
// Pill — 5-tone status badge with icon prefix
// Replaces ad-hoc <span>healthy</span> rows. Icon glyphs read as
// terminal punctuation (✓ ⚠ ✕ ⓘ ◌), not Material Symbols. Hairline
// 1px border, sharp corners, mono body, neutral background — accent
// stays the only saturated color in the layout.
// ============================================================
export type PillTone = 'ok' | 'warn' | 'err' | 'info' | 'idle'
const PILL_GLYPHS: Record<PillTone, string> = {
  ok: '✓',
  warn: '⚠',
  err: '✕',
  info: 'ⓘ',
  idle: '◌',
}
export const Pill = ({
  tone,
  iconless = false,
  children,
  className = '',
}: {
  tone: PillTone
  iconless?: boolean
  children: React.ReactNode
  className?: string
}) => (
  <span
    className={`aw-pill aw-pill--${tone} ${className}`}
    aria-label={`${tone}: ${typeof children === 'string' ? children : ''}`}
  >
    {!iconless && (
      <span className="aw-pill__icon" aria-hidden="true">
        {PILL_GLYPHS[tone]}
      </span>
    )}
    <span className="aw-pill__body">{children}</span>
  </span>
)

// ============================================================
// Chip — filter chip (lab + v + optional count)
// ============================================================
export const Chip = ({
  label,
  value,
  count,
  on,
  onClick,
  children,
}: {
  label?: string
  value?: string
  count?: number | string
  on?: boolean
  onClick?: () => void
  children?: React.ReactNode
}) => (
  <button type="button" className="aw-chip" data-on={on || undefined} onClick={onClick}>
    {label && <span className="aw-chip__lab">{label}</span>}
    {value && <span className="aw-chip__v">{value}</span>}
    {count != null && <span className="aw-chip__ct">{count}</span>}
    {children}
  </button>
)

// ============================================================
// EmptyInline — terse single-line empty state
// ============================================================
export const EmptyInline = ({
  children,
  pad = false,
}: {
  children: React.ReactNode
  pad?: boolean
}) => (
  <div className="aw-empty" style={pad ? { padding: '48px 14px' } : undefined}>
    {children}
  </div>
)

// ============================================================
// SectionBar — divider header
// ============================================================
export const SectionBar = ({
  title,
  count,
  right,
}: {
  title: string
  count?: number | string
  right?: React.ReactNode
}) => (
  <div className="aw-section-bar">
    <h2 className="aw-section-bar__title">{title}</h2>
    {count != null && <span className="aw-section-bar__ct">{count}</span>}
    {right && <span className="aw-section-bar__right">{right}</span>}
  </div>
)

// ============================================================
// EmptySectionGate — wraps a SectionBar + its body. When isEmpty
// is true, collapses to a one-line "▸ TITLE (no data)" affordance
// the operator can expand. Default-collapsed sections drop healthy-
// cluster dashboard scroll from 7.5× viewport to ~2×.
// ============================================================
export const EmptySectionGate = ({
  title,
  count,
  right,
  isEmpty,
  emptyReason = 'no data',
  defaultExpanded = false,
  children,
}: {
  title: string
  count?: number | string
  right?: React.ReactNode
  isEmpty: boolean
  emptyReason?: string
  defaultExpanded?: boolean
  children: React.ReactNode
}) => {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  if (!isEmpty) {
    return (
      <>
        <SectionBar title={title} count={count} right={right} />
        {children}
      </>
    )
  }
  return (
    <>
      <button
        type="button"
        className="aw-section-bar aw-section-bar--collapsed"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="aw-section-bar__chev">{expanded ? '▾' : '▸'}</span>
        <h2 className="aw-section-bar__title">{title}</h2>
        <span className="aw-section-bar__empty">{emptyReason}</span>
      </button>
      {expanded && children}
    </>
  )
}

// ============================================================
// Banner — info / warn / err / ok
// ============================================================
export const Banner = ({
  level = 'info',
  label,
  children,
}: {
  level?: 'info' | 'warn' | 'err' | 'ok'
  label?: string
  children: React.ReactNode
}) => (
  <div className={`aw-banner aw-banner--${level}`}>
    {label && <span className="aw-banner__lab">{label}</span>}
    <span>{children}</span>
  </div>
)

// ============================================================
// Toggle — on/off switch
// ============================================================
export const Toggle = ({
  on = false,
  onChange,
  label,
  disabled = false,
}: {
  on?: boolean
  onChange?: (next: boolean) => void
  label?: string
  // `disabled` is honored: when set, click/keyboard toggling is suppressed and
  // the control is reflected as disabled. Previously callers passed it but the
  // prop wasn't typed; gating onChange behind it preserves the no-op-when-off
  // intent without altering the enabled-state render path.
  disabled?: boolean
}) => (
  <span
    className="aw-tog"
    data-on={on || undefined}
    data-disabled={disabled || undefined}
    role="switch"
    aria-checked={on}
    aria-disabled={disabled || undefined}
    aria-label={label}
    tabIndex={disabled ? -1 : 0}
    onClick={() => { if (!disabled) onChange?.(!on) }}
    onKeyDown={(e) => {
      if (disabled) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        onChange?.(!on)
      }
    }}
  />
)

// ============================================================
// Spark — hand-rolled SVG sparkline (no chart lib)
// ============================================================
export const Spark = ({
  values,
  width = 80,
  height = 16,
  variant = 'default',
}: {
  values: number[]
  width?: number
  height?: number
  variant?: 'default' | 'ok' | 'warn' | 'err'
}) => {
  const path = sparkPath(values, width, height)
  // Closed-area path for the gradient fill — same shape as `path`
  // but pulled to the baseline before closing, so the area-under-line
  // can paint a tinted fade.
  const areaPath = path
    ? `${path} L${width},${height} L0,${height} Z`
    : ''
  // Stable id per render so multiple sparks don't collide on shared
  // <defs> across SVGs.
  const gradId = React.useId()
  return (
    <svg
      className={`aw-spark ${variant !== 'default' ? `aw-spark--${variant}` : ''}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {areaPath && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {areaPath && (
        <path
          d={areaPath}
          fill={`url(#${gradId})`}
          stroke="none"
          style={{
            color:
              variant === 'ok'
                ? 'var(--ok)'
                : variant === 'warn'
                  ? 'var(--warn)'
                  : variant === 'err'
                    ? 'var(--err)'
                    : 'var(--accent)',
          }}
        />
      )}
      <path d={path} />
    </svg>
  )
}

export function sparkPath(vals: number[], w = 80, h = 16): string {
  if (!vals || vals.length === 0) return ''
  if (vals.length === 1) return `M0,${h / 2} L${w},${h / 2}`
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  const range = max - min || 1
  return vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ============================================================
// Btn — button (primary / ghost / default)
// ============================================================
export const Btn = ({
  variant = 'default',
  children,
  ...rest
}: {
  variant?: 'default' | 'primary' | 'ghost'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...rest}
    className={`aw-btn ${variant !== 'default' ? `aw-btn--${variant}` : ''} ${rest.className ?? ''}`}
  >
    {children}
  </button>
)

// ============================================================
// BarFill — inline progress bar (used in tables)
// ============================================================
export const BarFill = ({ percent }: { percent: number }) => (
  <span className="aw-bar-fill" style={{ ['--w' as any]: `${Math.max(0, Math.min(100, percent))}%` }} />
)
