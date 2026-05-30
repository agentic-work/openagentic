import React from 'react'
import { ResponsiveContainer, AreaChart, Area, Tooltip as RTooltip } from 'recharts'

/**
 * SparkArea — tiny interactive sparkline for stat cards.
 * Recharts-backed so hover/tooltip work consistently with the big charts.
 */
export function SparkArea({
  data,
  color = 'var(--accent)',
  height = 22,
  tooltipLabel,
}: {
  data: number[]
  color?: string
  height?: number
  /** Label used in the hover tooltip (e.g. "tokens"). Defaults to "value". */
  tooltipLabel?: string
}) {
  if (!data?.length) return null
  const rows = data.map((v, i) => ({ i, v }))
  const gid = `spk-${color.replace(/[^a-z0-9]/gi, '_')}-${data.length}-${data[0] | 0}`
  const label = tooltipLabel ?? 'value'
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <RTooltip
            cursor={{ stroke: color, strokeOpacity: 0.5, strokeDasharray: '2 2' }}
            contentStyle={{
              background: 'var(--color-surface, var(--bg-1))',
              border: '1px solid var(--line-2)',
              borderRadius: 4,
              fontFamily: 'var(--font-mono, ui-monospace)',
              fontSize: 10,
              padding: '3px 6px',
            }}
            labelFormatter={() => ''}
            formatter={(v: any) => [v, label]}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.3}
            fill={`url(#${gid})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 2.5, stroke: color, strokeWidth: 1, fill: 'var(--color-surface, var(--bg-1))' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
