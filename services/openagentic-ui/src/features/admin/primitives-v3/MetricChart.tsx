import * as React from 'react'
import './styles.css'
import { Line as AwLine, type LineData, type LineSeries } from '../../../lib/charts/components/Line'
import { Area as AwArea, type AreaData } from '../../../lib/charts/components/Area'
import { Bar as AwBar, type BarData } from '../../../lib/charts/components/Bar'
import { Donut as AwDonut, type DonutData } from '../../../lib/charts/components/Donut'
import { useThemeTokens } from '../../../lib/charts/hooks/useThemeTokens'
import { ExpandableChart } from '../../../lib/charts/ExpandableChart'

export type ColorToken =
  | 'accent'
  | 'ok'
  | 'warn'
  | 'err'
  | 'info'
  | 'fg-0'
  | 'fg-1'
  | 'fg-2'
  | 'fg-3'
  | 'bg-1'
  | 'bg-2'
  | 'line-1'
  | 'line-2'

export interface ChartSeries {
  name: string
  data: number[] | Array<{ x: number | string; y: number }>
  color: ColorToken
  stackId?: string // for stacked-area
}

export interface MetricChartProps {
  variant: 'line' | 'area' | 'stacked-area' | 'bar' | 'bar-h' | 'donut'
  /** Time-series data for line/area/stacked-area/bar. Required for those variants. */
  series?: ChartSeries[]
  /** X-axis labels for time-series. Length must match series[0].data length. */
  xLabels?: string[]
  /** Format y-axis tick + tooltip. */
  yFormat?: 'ms' | 'tok' | 'usd' | 'pct' | ((v: number) => string)
  height?: number
  showLegend?: boolean
  showGrid?: boolean
  /** Flat data for bar-h / donut variants. */
  data?: Array<{ name: string; value: number; color?: ColorToken }>
  /** For donut: center label. */
  centerLabel?: { primary: React.ReactNode; secondary?: React.ReactNode }
  /**
   * Double-click → fullscreen modal with the same chart at large dimensions
   * + wheel-zoom enabled. Default true for line/area/stacked-area/bar/donut
   * (every variant where a larger view shows useful detail). Off for bar-h
   * which is a flat rank list with nothing more to show.
   * Pass `expandable={false}` to suppress for a specific call site.
   */
  expandable?: boolean
  /** Optional title used in the expand-modal header. */
  expandTitle?: string
  /** Optional subtitle used in the expand-modal header. */
  expandSubtitle?: string
}

// ColorToken → format spec for the new chart lib + theme-token CSS var
function yFormatSpec(fmt: MetricChartProps['yFormat']): string {
  if (typeof fmt === 'function') return '~s' // function formatters live on caller; lib uses generic SI
  switch (fmt) {
    case 'usd': return '$,.2f'
    case 'pct': return '.1%'
    default: return '~s'
  }
}

// Map ColorToken → resolved hex (via theme tokens hook in each chart). We
// pre-resolve here at the dispatcher boundary so the chart receives a real
// color string (matches the libraries' per-series color override contract).
function useTokenLookup(): (t: ColorToken | undefined) => string {
  const tokens = useThemeTokens()
  const map: Record<string, string> = {
    accent: tokens.accent, ok: tokens.ok, warn: tokens.warn, err: tokens.err, info: tokens.info,
    'fg-0': tokens.fg0, 'fg-1': tokens.fg1, 'fg-2': tokens.fg2, 'fg-3': tokens.fg3,
    'bg-1': tokens.bg1, 'bg-2': tokens.bg2, 'line-1': tokens.line1, 'line-2': tokens.line2,
  }
  return (t) => (t ? map[t] ?? tokens.accent : tokens.accent)
}

// Coerce series[].data → {t,v}[] for time-series components.
// xLabels gives us synthetic ts when numeric data[] is passed.
function toTimeSeriesPoints(
  raw: number[] | Array<{ x: number | string; y: number }>,
  xLabels: string[] | undefined,
): Array<{ t: number | string; v: number }> {
  if (raw.length === 0) return []
  if (typeof raw[0] === 'number') {
    return (raw as number[]).map((v, i) => ({ t: xLabels?.[i] ?? i, v }))
  }
  return (raw as Array<{ x: number | string; y: number }>).map((p) => ({ t: p.x, v: p.y }))
}

// Time-series points → real Date values if xLabels look like timestamps.
function reifyTimestamps(points: Array<{ t: number | string; v: number }>): Array<{ t: Date | string | number; v: number }> {
  // Heuristic: if t looks like a date string or epoch ms, parse as Date.
  // Otherwise leave as-is (string xLabels treated as categorical).
  return points.map((p) => {
    if (typeof p.t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.t)) return { t: new Date(p.t), v: p.v }
    if (typeof p.t === 'number' && p.t > 1_000_000_000) return { t: new Date(p.t), v: p.v }
    return p
  })
}

export const MetricChart = ({
  variant,
  series,
  xLabels,
  yFormat,
  height = 280,
  data,
  centerLabel,
  expandable,
  expandTitle,
  expandSubtitle,
}: MetricChartProps) => {
  const lookup = useTokenLookup()
  const fmtSpec = yFormatSpec(yFormat)

  // Each variant builds its data once and renders the underlying chart
  // via `render`. When expandable=true, ExpandableChart wraps it so dblclick
  // opens a fullscreen modal with the same chart at large dimensions.
  const renderChart = ({
    h, wheelZoom, onExpand, disable,
  }: {
    h: number
    wheelZoom: 'modifier' | 'always' | 'off'
    onExpand?: () => void
    disable: boolean
  }) => {
    if (variant === 'line') {
      const seriesArr = series ?? []
      const lineSeries: LineSeries[] = seriesArr.map((s) => ({
        name: s.name,
        color: lookup(s.color),
        data: reifyTimestamps(toTimeSeriesPoints(s.data, xLabels)),
      }))
      const lineData: LineData = { series: lineSeries, yFormat: fmtSpec }
      return <AwLine data={lineData} height={h} disableFrame={disable} wheelZoom={wheelZoom} onExpand={onExpand} />
    }
    if (variant === 'area' || variant === 'stacked-area') {
      const seriesArr = series ?? []
      const areaData: AreaData = {
        mode: variant === 'stacked-area' ? 'stacked' : 'overlay',
        yFormat: fmtSpec,
        xLabels: xLabels && xLabels.length > 0 ? xLabels : undefined,
        series: seriesArr.map((s) => ({
          name: s.name,
          color: lookup(s.color),
          data: reifyTimestamps(toTimeSeriesPoints(s.data, xLabels)),
        })),
      }
      return <AwArea data={areaData} height={h} disableFrame={disable} wheelZoom={wheelZoom} onExpand={onExpand} />
    }
    if (variant === 'bar') {
      const seriesArr = series ?? []
      if (seriesArr.length === 0 || !xLabels) return null
      const barData: BarData = {
        categories: xLabels,
        mode: 'grouped',
        yFormat: fmtSpec,
        series: seriesArr.map((s) => ({
          name: s.name,
          color: lookup(s.color),
          values: (s.data as number[]).map((d) => typeof d === 'number' ? d : (d as any).y ?? 0),
        })),
      }
      return <AwBar data={barData} height={h} disableFrame={disable} wheelZoom={wheelZoom} onExpand={onExpand} />
    }
    if (variant === 'bar-h') {
      // Inline pure-DOM rank list — no SVG zoom, no onExpand wiring (modal
      // would just show the same list bigger; not useful enough to bother).
      return <BarHorizontal data={data ?? []} height={h} lookup={lookup} format={fmtSpec} />
    }
    if (variant === 'donut') {
      const donutData: DonutData = {
        format: fmtSpec,
        slices: (data ?? []).map((d) => ({
          name: d.name,
          value: d.value,
          color: lookup(d.color),
        })),
        centerSubtitle: typeof centerLabel?.secondary === 'string' ? centerLabel.secondary : undefined,
      }
      return <AwDonut data={donutData} height={h} disableFrame={disable} wheelZoom={wheelZoom} onExpand={onExpand} />
    }
    return null
  }

  // bar-h is a pure rank list — no SVG, modal would be redundant. Skip.
  // Explicit `expandable={false}` opts out for a specific call site.
  const wantExpand = expandable !== false && variant !== 'bar-h'
  if (!wantExpand) {
    return renderChart({ h: height, wheelZoom: 'off', disable: true })
  }

  // Expandable mode: inline chart enables onExpand → dblclick opens modal
  // with the same chart at full size + wheel-zoom enabled.
  const inferredTitle = expandTitle ?? (typeof centerLabel?.primary === 'string' ? centerLabel.primary : variant)
  return (
    <ExpandableChart
      title={inferredTitle}
      subtitle={expandSubtitle}
      inlineHeight={height}
      expandedHeight={680}
      renderChart={({ wheelZoom, height: h, onExpand }) =>
        renderChart({ h, wheelZoom, onExpand, disable: !onExpand })
      }
    />
  )
}

// ============================================================
// BarHorizontal — inline horizontal bar for top-N rank lists
// (separate from <Bar> because it has no time/category axis; pure rank).
// ============================================================
const BarHorizontal: React.FC<{
  data: Array<{ name: string; value: number; color?: ColorToken }>
  height: number
  lookup: (t: ColorToken | undefined) => string
  format: string
}> = ({ data, height, lookup, format }) => {
  const tokens = useThemeTokens()
  if (data.length === 0) {
    return <div style={{ padding: 12, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>no items</div>
  }
  const max = Math.max(...data.map((d) => Math.max(0, d.value)), 1)
  const rowH = Math.max(20, Math.floor((height - 10) / data.length))
  const fmtV = (v: number) => {
    // tiny inline formatter; mirrors d3-format spec where reasonable
    if (format.endsWith('%')) return `${(v * 100).toFixed(1)}%`
    if (format.startsWith('$')) return `$${v.toFixed(2)}`
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
    if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`
    return v.toFixed(0)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 4 }}>
      {data.map((d, i) => {
        const pct = (Math.max(0, d.value) / max) * 100
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 64px', alignItems: 'center', gap: 8, height: rowH }}>
            <span style={{ fontFamily: tokens.fontMono, fontSize: 11, color: tokens.fg1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d.name}
            </span>
            <div style={{ background: tokens.line2, height: 10, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ background: lookup(d.color ?? 'accent'), height: '100%', width: `${pct}%`, borderRadius: 2, transition: 'width 240ms' }} />
            </div>
            <span style={{ fontFamily: tokens.fontMono, fontSize: 11, color: tokens.fg0, textAlign: 'right' }}>
              {fmtV(d.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
