import React from 'react'

export type KpiTone = 'default' | 'ok' | 'warn' | 'err' | 'acc'
export type KpiDeltaTone = 'up' | 'down' | 'neutral'

export interface KpiTileProps {
  label: string
  value: React.ReactNode
  unit?: string
  tone?: KpiTone
  delta?: React.ReactNode
  deltaTone?: KpiDeltaTone
  /** Optional sparkline (SVG) — chart internals come from existing primitives. */
  children?: React.ReactNode
}

/**
 * KpiTile — the unified metric tile reused by every Archetype C dashboard.
 * Layout: small uppercase label · large display-font value · delta · spark.
 * Charts (sparklines) are passed in as children — KpiTile does not draw them.
 */
export function KpiTile({ label, value, unit, tone = 'default', delta, deltaTone = 'neutral', children }: KpiTileProps) {
  return (
    <div
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)',
        borderRadius: 'var(--radius-chip)',
        boxShadow: 'var(--glass-card-shadow)',
        padding: '12px 14px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ap-fg-3, var(--fg-3))',
        }}
      >
        {label}
      </span>
      <span
        data-tone={tone}
        style={{
          fontFamily: 'var(--font-disp, Fraunces, Georgia, serif)',
          fontWeight: 500,
          fontSize: 28,
          lineHeight: 1.05,
          color: TONE_TO_COLOR[tone],
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
        {unit && (
          <span style={{ fontSize: 14, color: 'var(--ap-fg-2, var(--fg-2))', marginLeft: 4 }}>{unit}</span>
        )}
      </span>
      {delta != null && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: DELTA_TO_COLOR[deltaTone],
          }}
        >
          {delta}
        </span>
      )}
      {children && <div style={{ marginTop: 4, height: 28 }}>{children}</div>}
    </div>
  )
}

const TONE_TO_COLOR: Record<KpiTone, string> = {
  default: 'var(--ap-fg-0, var(--fg-0))',
  ok:      'var(--ap-ok, var(--ok))',
  warn:    'var(--ap-warn, var(--warn))',
  err:     'var(--ap-err, var(--err))',
  acc:     'var(--ap-accent, var(--accent))',
}

const DELTA_TO_COLOR: Record<KpiDeltaTone, string> = {
  up:      'var(--ap-ok, var(--ok))',
  down:    'var(--ap-err, var(--err))',
  neutral: 'var(--ap-fg-2, var(--fg-2))',
}
