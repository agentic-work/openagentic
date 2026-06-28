import * as React from 'react'
import './styles.css'

type Tone = 'default' | 'ok' | 'warn' | 'err' | 'dim' | 'info' | 'idle'
const toneClass = (cls: string, t: Tone) => (t === 'default' ? cls : `${cls} ${cls}--${t}`)
/** Tones that paint the Kpi/Mini top rail via [data-tone]. `default`,
 *  `dim` produce no rail. `dim` is treated as `idle` for backwards
 *  compatibility (some pages already pass it). */
const dataTone = (t: Tone): string | undefined => {
  if (t === 'ok' || t === 'warn' || t === 'err' || t === 'info') return t
  if (t === 'idle' || t === 'dim') return 'idle'
  return undefined
}

// ============================================================
// KpiGrid + Kpi
// ============================================================
export interface KpiProps {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: Tone
}

export const Kpi = ({ label, value, sub, tone = 'default' }: KpiProps) => (
  <div className="aw-kpi" data-tone={dataTone(tone)}>
    <span className="aw-kpi__label">{label}</span>
    <span className={toneClass('aw-kpi__val', tone)}>{value}</span>
    {sub && <span className="aw-kpi__sub">{sub}</span>}
  </div>
)

export const KpiGrid = ({
  cols = 4,
  children,
}: {
  cols?: 2 | 3 | 4 | 5 | 6
  children: React.ReactNode
}) => (
  <div className="aw-kpi-grid" style={{ ['--cols' as any]: cols }}>
    {children}
  </div>
)

// ============================================================
// ScoringStrip + Score
// ============================================================
export interface ScoreProps {
  label: string
  value: React.ReactNode
  delta?: React.ReactNode
  tone?: Tone
  spark?: number[] // optional sparkline values
  /**
   * Tooltip text shown on hover over the label. Used to explain
   * acronyms (TTFT, TPOT, p95) so operators don't have to memorize
   * the SRE-grade naming. Renders as native HTML title attribute
   * + a small info dot next to the label.
   */
  tip?: string
}

export const Score = ({ label, value, delta, tone = 'default', spark, tip }: ScoreProps) => {
  // Inline spark to avoid circular import on Spark
  const path = spark && spark.length > 1 ? buildPath(spark, 100, 18) : ''
  const areaPath = path ? `${path} L100,18 L0,18 Z` : ''
  const sparkColor =
    tone === 'ok'
      ? 'var(--ok)'
      : tone === 'warn'
        ? 'var(--warn)'
        : tone === 'err'
          ? 'var(--err)'
          : 'var(--accent)'
  const fillId = `score-fill-${label.replace(/\s+/g, '-').slice(0, 32)}`
  return (
    <div className="aw-score" data-tone={dataTone(tone)}>
      <span className="aw-score__label" title={tip}>
        {label}
        {tip && (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              marginLeft: 4,
              width: 12,
              height: 12,
              lineHeight: '12px',
              textAlign: 'center',
              borderRadius: '50%',
              border: '1px solid var(--fg-3)',
              color: 'var(--fg-3)',
              fontSize: 9,
              fontWeight: 600,
              verticalAlign: 'middle',
              cursor: 'help',
              opacity: 0.7,
            }}
          >
            i
          </span>
        )}
      </span>
      <span className={toneClass('aw-score__val', tone)}>{value}</span>
      {delta && <span className="aw-score__delta">{delta}</span>}
      {path && (
        <svg
          style={{ position: 'absolute', inset: 'auto 0 0 0', height: 18, opacity: 0.85, pointerEvents: 'none' }}
          viewBox="0 0 100 18"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sparkColor} stopOpacity="0.32" />
              <stop offset="100%" stopColor={sparkColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${fillId})`} stroke="none" />
          <path d={path} stroke={sparkColor} strokeWidth={1} fill="none" />
        </svg>
      )}
    </div>
  )
}

function buildPath(vals: number[], w: number, h: number): string {
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

export const ScoringStrip = ({
  cols = 8,
  children,
}: {
  cols?: number
  children: React.ReactNode
}) => (
  <div className="aw-scoring-strip" style={{ ['--cols' as any]: cols }}>
    {children}
  </div>
)

// ============================================================
// MiniGrid + Mini
// ============================================================
export const Mini = ({ label, value, sub, tone = 'default' }: KpiProps) => (
  <div className="aw-mini" data-tone={dataTone(tone)}>
    <span className="aw-mini__label">{label}</span>
    <span className={toneClass('aw-mini__val', tone)}>{value}</span>
    {sub && <span className="aw-mini__sub">{sub}</span>}
  </div>
)

export const MiniGrid = ({
  cols = 4,
  children,
}: {
  cols?: number
  children: React.ReactNode
}) => (
  <div className="aw-mini-grid" style={{ ['--cols' as any]: cols }}>
    {children}
  </div>
)
