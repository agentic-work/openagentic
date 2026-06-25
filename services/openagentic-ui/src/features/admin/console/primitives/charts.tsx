/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Admin Console primitives — inline-SVG charts.
 *
 * Sparkline / AreaChart / HBars / Donut, ported from the mock's inline-SVG
 * primitives. Every color is a THEME TOKEN: stroke/fill reference
 * `var(--ok|--warn|--err|--info|--accent|--fg-3)` via TONE_VAR — NO hex.
 * Tints use color-mix. Grid/axis text use var(--line-1)/var(--fg-3).
 *
 * SVG `stroke`/`fill` are NOT in the arch-test color-prop list, but we keep
 * them token-only anyway so charts theme-switch correctly (Rule 8b).
 */
import * as React from 'react'
import type { Tone } from '../types'

/** Tone → CSS var. purple→info, teal→accent (the mock's extra tones map
 *  onto the global palette so nothing is hardcoded). */
export const TONE_VAR: Record<Tone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  info: 'var(--info)',
  muted: 'var(--fg-3)',
  accent: 'var(--accent)',
  purple: 'var(--info)',
  teal: 'var(--accent)',
}

const fmt = (n: number): string =>
  n >= 1e9
    ? (n / 1e9).toFixed(2) + 'B'
    : n >= 1e6
      ? (n / 1e6).toFixed(2) + 'M'
      : n >= 1e3
        ? (n / 1e3).toFixed(1) + 'k'
        : '' + Math.round(n)

let _gid = 0
const gid = (p: string) => `${p}-awc-${(_gid++).toString(36)}`

export interface SparklineProps {
  data: number[]
  w?: number
  h?: number
  tone?: Tone
  fill?: boolean
}

/** Sparkline — a tiny token-colored area+line.
 *  On empty data we draw a flat zero-baseline (a faint full-width rule)
 *  instead of returning null, so the KPI card never shows a blank gap where a
 *  trend line belongs — an honest "no movement yet" cue. */
export function Sparkline({ data, w = 160, h = 30, tone = 'accent', fill = true }: SparklineProps) {
  if (!data.length) {
    const y = (h - 2).toFixed(1)
    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="awc-spark"
        role="img"
        aria-label="no trend data yet"
      >
        <line x1={0} y1={y} x2={w} y2={y} stroke="var(--line-1)" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
    )
  }
  const min = Math.min(...data)
  const max = Math.max(...data)
  const rng = max - min || 1
  const pts = data.map((d, i) => [(i / Math.max(1, data.length - 1)) * w, h - ((d - min) / rng) * (h - 4) - 2])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const c = TONE_VAR[tone]
  const g = React.useMemo(() => gid('spark'), [])
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="awc-spark">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.35" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${g})`} />}
      <path d={line} fill="none" stroke={c} strokeWidth="1.5" />
    </svg>
  )
}

export interface AreaSeries {
  name?: string
  data: number[]
}

export interface AreaChartProps {
  series: AreaSeries[]
  w?: number
  h?: number
  labels?: string[]
  tone?: Tone[]
  /** Honest empty-state copy shown (in-frame) when there is no series data. */
  emptyLabel?: string
}

/** AreaChart — multi-series token-colored area chart with axis labels.
 *  When there is no data we render an in-frame honest empty-state (a faint
 *  baseline + a centered message) at the chart's own size, instead of
 *  returning null — a fresh page never shows a blank gap where a chart goes. */
export function AreaChart({
  series,
  w = 640,
  h = 190,
  labels = [],
  tone = ['accent', 'purple', 'ok', 'warn'],
  emptyLabel = 'No usage yet — start a chat or run a flow',
}: AreaChartProps) {
  const ids = React.useMemo(() => series.map(() => gid('area')), [series.length])
  if (!series.length || !series[0].data.length) {
    const baseY = (h - 22).toFixed(1)
    return (
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        className="awc-chart-empty"
        role="img"
        aria-label={emptyLabel}
      >
        <line x1={40} y1={baseY} x2={w - 12} y2={baseY} stroke="var(--line-1)" strokeWidth="1" strokeDasharray="4 4" />
        <text
          x={w / 2}
          y={h / 2}
          fill="var(--fg-3)"
          fontSize="12"
          textAnchor="middle"
          fontFamily="var(--font-v3-mono)"
        >
          {emptyLabel}
        </text>
      </svg>
    )
  }
  const pad = { l: 40, r: 12, t: 12, b: 22 }
  const iw = w - pad.l - pad.r
  const ih = h - pad.t - pad.b
  let max = 0
  series.forEach((s) => s.data.forEach((v) => { if (v > max) max = v }))
  max = max * 1.12 || 1
  const n = series[0].data.length
  const xs = (i: number) => pad.l + (i / Math.max(1, n - 1)) * iw
  const ys = (v: number) => pad.t + ih - (v / max) * ih
  const grid: React.ReactNode[] = []
  for (let gi = 0; gi <= 4; gi++) {
    const y = pad.t + ih - (gi / 4) * ih
    grid.push(
      <g key={`g${gi}`}>
        <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="var(--line-1)" strokeWidth="1" />
        <text x={pad.l - 6} y={y + 3} fill="var(--fg-3)" fontSize="9" textAnchor="end" fontFamily="var(--font-v3-mono)">
          {fmt(Math.round((max * gi) / 4))}
        </text>
      </g>,
    )
  }
  const xlab: React.ReactNode[] = []
  labels.forEach((l, i) => {
    if (i % Math.ceil(n / 6) === 0 || i === n - 1) {
      xlab.push(
        <text key={`x${i}`} x={xs(i)} y={h - 6} fill="var(--fg-3)" fontSize="9" textAnchor="middle" fontFamily="var(--font-v3-mono)">
          {l}
        </text>,
      )
    }
  })
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`}>
      {grid}
      {xlab}
      {series.map((s, si) => {
        const c = TONE_VAR[tone[si % tone.length]]
        const ln = s.data.map((v, i) => (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(v).toFixed(1)).join(' ')
        return (
          <g key={si}>
            <defs>
              <linearGradient id={ids[si]} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c} stopOpacity="0.22" />
                <stop offset="1" stopColor={c} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${ln} L${xs(n - 1)} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`} fill={`url(#${ids[si]})`} />
            <path d={ln} fill="none" stroke={c} strokeWidth="1.7" />
          </g>
        )
      })}
    </svg>
  )
}

export interface HBarItem {
  l: string
  v: number
  tone?: Tone
  disp?: string
}

/** HBars — horizontal token-colored bar list. */
export function HBars({ items, max }: { items: HBarItem[]; max?: number }) {
  const mx = max || Math.max(...items.map((i) => i.v)) || 1
  return (
    <div>
      {items.map((it, i) => (
        <div className="awc-bar-row" key={i}>
          <div className="awc-bar-row__bl">{it.l}</div>
          <div className="awc-bar-row__bt">
            <i
              style={{
                width: `${Math.max(2, (it.v / mx) * 100)}%`,
                ...(it.tone ? { background: TONE_VAR[it.tone] } : null),
              }}
            />
          </div>
          <div className="awc-bar-row__bv">{it.disp != null ? it.disp : fmt(it.v)}</div>
        </div>
      ))}
    </div>
  )
}

export interface DonutSeg {
  v: number
  tone: Tone
}

/** Donut — token-colored ring with a center label. */
export function Donut({ segs, label }: { segs: DonutSeg[]; label?: string }) {
  const total = segs.reduce((a, s) => a + s.v, 0) || 1
  const size = 140
  const r = size / 2 - 12
  const cx = size / 2
  const cy = size / 2
  const C = 2 * Math.PI * r
  let off = 0
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-3)" strokeWidth="14" />
        {segs.map((s, i) => {
          const len = (s.v / total) * C
          const node = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={TONE_VAR[s.tone]}
              strokeWidth="14"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-off}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          )
          off += len
          return node
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-0)' }}>
          {label ?? fmt(total)}
        </div>
      </div>
    </div>
  )
}
