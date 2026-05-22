import React from 'react'
import { SparkArea } from './SparkArea'

type Variant = 'ok' | 'warn' | 'err' | 'info'

const variantTextClass: Record<Variant, string> = {
  ok: 'text-ok', warn: 'text-warn', err: 'text-err', info: 'text-info',
}
const variantColor: Record<Variant, string> = {
  ok: 'var(--ok)', warn: 'var(--warn)', err: 'var(--err)', info: 'var(--info)',
}

export function StatCard({
  label,
  value,
  dir,
  delta,
  sub,
  sparkData,
  variant,
  liveKey,
}: {
  label: string
  value: string
  dir?: 'up' | 'down'
  delta?: string
  sub?: string
  sparkData: number[]
  variant?: Variant
  liveKey?: string
}) {
  const sparkColor = variant ? variantColor[variant] : 'var(--accent)'
  const valueClass = variant ? variantTextClass[variant] : 'text-fg-0'
  return (
    <div
      className="scell bg-bg-1 px-3 py-2.5 hover:bg-bg-2 cursor-pointer transition-colors"
      {...(liveKey ? { 'data-stat': liveKey } : {})}
    >
      <div className="lab font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-fg-3">
        {label}
      </div>
      <div className={`val font-mono font-bold text-[22px] leading-none mt-1 tabular-nums ${valueClass}`}>
        {value}
      </div>
      <div className="meta flex justify-between items-center mt-1 font-mono text-[10px] text-fg-3">
        {delta ? (
          <span className={dir === 'up' ? 'text-ok' : dir === 'down' ? 'text-err' : 'text-fg-2'}>
            {dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''} {delta}
          </span>
        ) : (
          <span>{sub ?? ''}</span>
        )}
        {delta && sub && <span className="text-fg-3 text-[10px]">{sub}</span>}
      </div>
      <div className="spark h-[18px] w-full mt-1.5">
        <SparkArea data={sparkData} color={sparkColor} />
      </div>
    </div>
  )
}
