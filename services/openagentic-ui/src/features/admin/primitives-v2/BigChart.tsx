import React from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
  ComposedChart,
} from 'recharts'

export type ChartSeries = {
  name: string
  color: string
  data: number[]
  /** Explicit end-label (unused with recharts; kept for API compat). */
  label?: string | null
}

/**
 * BigChart — recharts-based area chart. Replaces the hand-rolled SVG path
 * implementation so fonts, tooltips, and spacing work correctly at any
 * container width, without us reinventing chart primitives.
 */
export function BigChart({
  series,
  xLabels,
  yFormat = (v: number) => v.toFixed(0),
  height = 220,
}: {
  series: ChartSeries[]
  xLabels?: string[]
  yFormat?: (v: number) => string
  height?: number
}) {
  // Build a row-oriented dataset: each row is one point, with one key per series
  const maxLen = Math.max(0, ...series.map(s => s.data.length))
  const data = Array.from({ length: maxLen }, (_, i) => {
    const row: Record<string, number | string> = {
      _idx: i,
      _label: xLabels && xLabels[Math.round((i / Math.max(1, maxLen - 1)) * (xLabels.length - 1))] || '',
    }
    for (const s of series) row[s.name] = s.data[i] ?? 0
    return row
  })

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 6, left: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`fill-${s.name}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 3" vertical={false} />
          <XAxis
            dataKey="_label"
            interval="preserveStartEnd"
            minTickGap={32}
            tick={{ fill: 'var(--fg-3)', fontSize: 10, fontFamily: 'var(--font-mono, ui-monospace)' }}
            axisLine={{ stroke: 'var(--line-2)' }}
            tickLine={false}
            stroke="var(--line-2)"
          />
          <YAxis
            tickFormatter={yFormat}
            width={44}
            tick={{ fill: 'var(--fg-3)', fontSize: 10, fontFamily: 'var(--font-mono, ui-monospace)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface, var(--bg-1))',
              border: '1px solid var(--line-2)',
              borderRadius: 6,
              fontFamily: 'var(--font-mono, ui-monospace)',
              fontSize: 11,
              padding: '6px 10px',
            }}
            labelStyle={{ color: 'var(--fg-2)' }}
            itemStyle={{ color: 'var(--fg-0)' }}
            formatter={(v: any, name: any) => [typeof v === 'number' ? yFormat(v) : v, name]}
          />
          {series.length > 1 && (
            <Legend
              verticalAlign="top"
              height={22}
              iconSize={8}
              iconType="circle"
              wrapperStyle={{ fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 10, color: 'var(--fg-2)' }}
            />
          )}
          {series.map((s, i) => (
            <Area
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={s.color}
              strokeWidth={1.8}
              fill={`url(#fill-${s.name}-${i})`}
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 3, stroke: s.color, strokeWidth: 1, fill: 'var(--color-surface, var(--bg-1))' }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
