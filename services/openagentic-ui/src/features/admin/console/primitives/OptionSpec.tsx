/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Admin Console primitives — OptionSpec ("All configurable options").
 *
 * The second half of every leaf's two-part contract: below the page body,
 * a faithful inventory table of every configurable option (from
 * ADMIN_INV[leafId]). Each row: type-icon swatch | Option | Type tag |
 * mock Control | Detail/wiring. TYPE_META maps option type → icon + tone +
 * a representative mock control. Token-only — the swatch tint is a
 * color-mix of the tone token, NOT a hex.
 */
import * as React from 'react'
import { ADMIN_INV } from '../ADMIN_INV'
import type { OptionSpecType, Tone } from '../types'
import { Section } from './layout'
import { Pill } from './atoms'

interface TypeMeta {
  ic: string
  tone: Tone
  ctl: (detail: string, label: string) => React.ReactNode
}

/** Tone → CSS var, for the icon swatch tint. */
const TONE_VAR: Record<Tone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  info: 'var(--info)',
  muted: 'var(--fg-3)',
  accent: 'var(--accent)',
  purple: 'var(--info)',
  teal: 'var(--accent)',
}

const TYPE_META: Record<OptionSpecType, TypeMeta> = {
  toggle: { ic: '⊙', tone: 'ok', ctl: () => <button type="button" className="awc-toggle awc-on" /> },
  select: {
    ic: '▾',
    tone: 'info',
    ctl: (d) => {
      const opt = (d.match(/:(.*)/) ? d.split(/[:|]/)[1] : d)
        .split(/[/,|]/)[0]
        .trim()
        .slice(0, 28) || 'option'
      return (
        <select className="awc-inp" style={{ maxWidth: 240 }} defaultValue={opt}>
          <option>{opt}</option>
          <option>…</option>
        </select>
      )
    },
  },
  'number-input': {
    ic: '#',
    tone: 'accent',
    ctl: (d) => {
      const m = d.match(/default ([\d.]+)/)
      return <input className="awc-inp awc-num" defaultValue={m ? m[1] : '0'} />
    },
  },
  'text-input': {
    ic: '⌨',
    tone: 'accent',
    ctl: () => <input className="awc-inp" style={{ maxWidth: 240 }} placeholder="text…" />,
  },
  'action-button': {
    ic: '▸',
    tone: 'purple',
    ctl: (d, l) => {
      const pri = /primary|primary;|^\+|pri/.test(d) || /^\+/.test(l)
      const danger = /destructive|danger|delete/.test(d)
      return (
        <button
          type="button"
          className={'awc-btn awc-sm' + (pri ? ' awc-pri' : '') + (danger ? ' awc-danger' : '')}
        >
          {l}
        </button>
      )
    },
  },
  table: { ic: '▦', tone: 'info', ctl: () => <Pill tone="info">data table</Pill> },
  chart: { ic: '📈', tone: 'teal', ctl: () => <Pill tone="accent">inline chart</Pill> },
  tab: { ic: '⊞', tone: 'accent', ctl: () => <Pill tone="muted">tab group</Pill> },
  'side-panel': { ic: '▤', tone: 'purple', ctl: () => <Pill tone="info">drill-in →</Pill> },
  form: { ic: '≣', tone: 'accent', ctl: () => <Pill tone="muted">form fields</Pill> },
  badge: { ic: '◷', tone: 'warn', ctl: () => <Pill tone="warn">banner / badge</Pill> },
  list: { ic: '☰', tone: 'muted', ctl: () => <Pill tone="muted">list / feed</Pill> },
  kpi: { ic: '◆', tone: 'ok', ctl: () => <Pill tone="ok">KPI tile</Pill> },
}

export function OptionSpec({ leafId }: { leafId: string }) {
  const inv = ADMIN_INV[leafId]
  if (!inv) return null
  return (
    <Section
      title="All configurable options"
      sub={`${inv.opts.length} options · faithful inventory · ${inv.domain}`}
      right={<Pill tone="info">every option present</Pill>}
    >
      <div className="awc-tablewrap">
        <div style={{ overflow: 'auto' }}>
          <table className="awc-dt">
            <thead>
              <tr>
                <th style={{ width: 38 }} />
                <th>Option</th>
                <th>Type</th>
                <th>Control</th>
                <th>Detail / wiring</th>
              </tr>
            </thead>
            <tbody>
              {inv.opts.map(([label, type, detail], i) => {
                const tm = TYPE_META[type] ?? { ic: '•', tone: 'muted' as Tone, ctl: () => null }
                const tv = TONE_VAR[tm.tone]
                return (
                  <tr key={i}>
                    <td>
                      <span
                        className="awc-feed-ic"
                        style={{
                          background: `color-mix(in srgb, ${tv} 13%, transparent)`,
                          color: tv,
                        }}
                      >
                        {tm.ic}
                      </span>
                    </td>
                    <td className="awc-name">{label}</td>
                    <td>
                      <span className="awc-tag">{type}</span>
                    </td>
                    <td>{tm.ctl(detail, label)}</td>
                    <td
                      style={{
                        whiteSpace: 'normal',
                        color: 'var(--fg-2)',
                        fontSize: 12,
                        maxWidth: 540,
                        lineHeight: 1.4,
                      }}
                    >
                      {detail}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  )
}
