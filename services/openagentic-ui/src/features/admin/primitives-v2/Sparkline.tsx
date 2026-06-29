import React from 'react'
import { smoothPath } from './smoothPath'

export function Sparkline({ data, color = 'var(--accent)' }: { data: number[]; color?: string }) {
  if (!data.length) return null
  const max = Math.max(...data), min = Math.min(...data)
  const w = 60, h = 18
  const step = w / Math.max(1, data.length - 1)
  const pts: [number, number][] = data.map((v, i) => [
    i * step,
    h - ((v - min) / (max - min || 1)) * (h - 2) - 1,
  ])
  const path = smoothPath(pts)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full block">
      <path fill="none" stroke={color} strokeWidth={1.3} strokeLinecap="round" d={path} />
    </svg>
  )
}
