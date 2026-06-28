/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Admin Console primitives — layout + content scaffolds.
 *
 * PageHead (with mode badge), Banner, Section, ChartCard, KpiStrip,
 * TabsBar, FormSection. All token-only.
 */
import * as React from 'react'
import type { LeafMode, Tone } from '../types'
import { Sparkline } from './charts'

/* ---------------- PageHead ---------------- */
export interface PageHeadAction {
  label: string
  ic?: React.ReactNode
  primary?: boolean
  danger?: boolean
  onClick?: () => void
}

export interface PageHeadProps {
  title: string
  sub?: React.ReactNode
  actions?: PageHeadAction[]
  mode?: LeafMode
}

const MODE_LABEL: Record<LeafMode, string> = {
  editable: 'editable',
  readonly: 'read-only',
  hitl: 'mutating · HITL',
  deprecated: 'deprecated',
}

export function PageHead({ title, sub, actions = [], mode }: PageHeadProps) {
  return (
    <div className="awc-pagehead">
      <div>
        <h1>{title}</h1>
        {sub != null && <div className="awc-sub">{sub}</div>}
      </div>
      <div className="awc-actions">
        {mode && (
          <span className="awc-mode-badge" data-mode={mode}>
            <span className="awc-d" />
            {MODE_LABEL[mode]}
          </span>
        )}
        {actions.map((a, i) => (
          <button
            key={i}
            className={
              'awc-btn' + (a.primary ? ' awc-pri' : '') + (a.danger ? ' awc-danger' : '')
            }
            onClick={a.onClick}
          >
            {a.ic}
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------- Banner ---------------- */
export function Banner({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <div className="awc-banner" data-tone={tone}>
      {children}
    </div>
  )
}

/* ---------------- Section ---------------- */
export function Section({
  title,
  sub,
  right,
  children,
}: {
  title: string
  sub?: React.ReactNode
  right?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="awc-section">
      <div className="awc-section-head">
        <h2>{title}</h2>
        {sub != null && <span className="awc-sub">{sub}</span>}
        {right && <div className="awc-right">{right}</div>}
      </div>
      {children}
    </div>
  )
}

/* ---------------- ChartCard ---------------- */
export function ChartCard({
  title,
  sub,
  children,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="awc-chartcard">
      <div className="awc-chartcard__ch">{title}</div>
      {sub != null && <div className="awc-chartcard__csub">{sub}</div>}
      {children}
    </div>
  )
}

/* ---------------- KpiStrip ---------------- */
export interface Kpi {
  label: string
  val: React.ReactNode
  unit?: string
  sub?: React.ReactNode
  tone?: Tone
  deltaDir?: 'up' | 'down' | 'flat'
  spark?: number[]
}

export function KpiStrip({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="awc-kpigrid">
      {kpis.map((k, i) => (
        <div className="awc-kpi" key={i} data-tone={k.tone}>
          <div className="awc-kpi__lab">{k.label}</div>
          <div className="awc-kpi__val">
            {k.val}
            {k.unit && <small> {k.unit}</small>}
          </div>
          {k.sub != null && (
            <div className="awc-kpi__delta" data-dir={k.deltaDir ?? 'flat'}>
              {k.sub}
            </div>
          )}
          {k.spark && (
            <div style={{ marginTop: 9 }}>
              <Sparkline data={k.spark} tone={k.tone ?? 'accent'} w={180} h={26} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---------------- TabsBar ---------------- */
export interface TabItem {
  id: string
  label: React.ReactNode
  cnt?: number
}

export function TabsBar({
  items,
  active,
  onTab,
}: {
  items: TabItem[]
  active: string
  onTab: (id: string) => void
}) {
  return (
    <div className="awc-tabs">
      {items.map((it) => (
        <button
          key={it.id}
          className={'awc-tab' + (it.id === active ? ' awc-on' : '')}
          onClick={() => onTab(it.id)}
        >
          {it.label}
          {it.cnt != null && <span className="awc-tab__cnt">{it.cnt}</span>}
        </button>
      ))}
    </div>
  )
}

/* ---------------- FormSection ---------------- */
export interface FormRow {
  label: string
  desc?: string
  type?: 'toggle' | 'select' | 'number' | 'text' | 'textarea' | 'json' | 'badge'
  value?: string | number | boolean
  opts?: string[]
  suffix?: string
  req?: boolean
  locked?: boolean
  badge?: React.ReactNode
}

export function FormSection({
  title,
  sub,
  rows,
  mode,
}: {
  title: string
  sub?: string
  rows: FormRow[]
  mode?: LeafMode
}) {
  return (
    <div className="awc-form-section">
      <div className="awc-fs-head">
        {title}
        {sub && <span className="awc-fs-sub">· {sub}</span>}
      </div>
      {rows.map((r, i) => {
        const locked = mode === 'readonly' || mode === 'deprecated' || r.locked
        return (
          <div className="awc-form-row" key={i}>
            <div>
              <div className="awc-lab">
                {r.label}
                {r.req && <span style={{ color: 'var(--err)' }}> *</span>}
              </div>
              {r.desc && <div className="awc-desc">{r.desc}</div>}
            </div>
            <div className="awc-ctl">
              <FormControl row={r} locked={!!locked} />
              {locked && r.type !== 'badge' && <span className="awc-lockedtag">🔒 locked</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FormControl({ row, locked }: { row: FormRow; locked: boolean }) {
  switch (row.type) {
    case 'toggle':
      return <button type="button" className={'awc-toggle' + (row.value ? ' awc-on' : '')} disabled={locked} />
    case 'select':
      return (
        <select className="awc-inp" disabled={locked} defaultValue={String(row.value ?? '')}>
          {(row.opts ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )
    case 'number':
      return (
        <>
          <input className="awc-inp awc-num" type="text" defaultValue={row.value != null ? String(row.value) : ''} disabled={locked} />
          {row.suffix && <span style={{ color: 'var(--fg-2)', fontSize: 12 }}>{row.suffix}</span>}
        </>
      )
    case 'textarea':
    case 'json':
      return <textarea className="awc-inp" disabled={locked} defaultValue={String(row.value ?? '')} />
    case 'badge':
      return <>{row.badge}</>
    default:
      return <input className="awc-inp" type="text" defaultValue={row.value != null ? String(row.value) : ''} disabled={locked} />
  }
}
