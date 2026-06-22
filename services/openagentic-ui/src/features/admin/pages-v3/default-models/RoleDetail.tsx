import * as React from 'react'
import {
  Dt,
  type DtCol,
  EmptyInline,
  SectionBar,
  PriorityBadge,
  Btn,
  FormGrid,
  FormRow,
} from '../../primitives-v3'
import {
  type RoleRow,
  type AltScore,
  fmtNum,
  fmtUsd,
  guessTier,
  rankAltModels,
  AUTO_VALUE,
} from './types'
import type { LlmRegistryRow } from '../../hooks/useDashboardMetrics'

export interface RoleDetailProps {
  row: RoleRow
  tab: string
  registry: LlmRegistryRow[] | undefined
  onSwitchTo: (model: string) => void
}

export const RoleDetail: React.FC<RoleDetailProps> = ({ row, tab, registry, onSwitchTo }) => {
  if (tab === 'overview')   return <OverviewTab row={row} />
  if (tab === 'alternates') return <AlternatesTab row={row} registry={registry} onSwitchTo={onSwitchTo} />
  if (tab === 'usage')      return <UsageTab row={row} />
  return null
}

const OverviewTab: React.FC<{ row: RoleRow }> = ({ row }) => {
  const tier = row.isAuto ? null : guessTier(row.assignedModel)
  return (
    <>
      <SectionBar title="role" />
      <FormGrid>
        <FormRow name="Use case">{row.meta.useCase}</FormRow>
        <FormRow name="Description"><span style={{ color: 'var(--fg-2)' }}>{row.meta.description}</span></FormRow>
        <FormRow name="Applied to">
          <span className="mono" style={{ color: 'var(--fg-2)' }}>
            {row.meta.appliedTo.join(', ')}
          </span>
        </FormRow>
      </FormGrid>
      <SectionBar title="assignment" />
      <FormGrid>
        <FormRow name="Assigned" configKey={`default_models.${row.key}`}>
          {row.assignedModel == null ? (
            <span style={{ color: 'var(--fg-3)' }}>unset</span>
          ) : row.isAuto ? (
            <span className="mono" style={{ color: 'var(--accent)' }}>{AUTO_VALUE}</span>
          ) : (
            <span className="mono" style={{ color: row.isStale ? 'var(--err)' : 'var(--fg-0)' }}>
              {row.assignedModel}
            </span>
          )}
        </FormRow>
        <FormRow name="Provider">
          <span className="mono">
            {row.isAuto
              ? 'smart-router'
              : row.match
              ? ((row.match as any).provider_display_name ?? row.match.provider)
              : '—'}
          </span>
        </FormRow>
        {tier && (
          <FormRow name="Tier"><PriorityBadge tier={tier} /></FormRow>
        )}
        <FormRow name="FCA score">
          <span className="mono">
            {row.match?.functionCallingAccuracy != null
              ? Number(row.match.functionCallingAccuracy).toFixed(2)
              : '—'}
          </span>
        </FormRow>
        <FormRow name="Cost / 1k">
          <span className="mono">
            {row.match?.inputCostPer1k != null
              ? fmtUsd(Number(row.match.inputCostPer1k) * 1000)
              : '—'}
          </span>
        </FormRow>
        <FormRow name="Stale">
          <span style={{ color: row.isStale ? 'var(--err)' : 'var(--fg-3)' }}>
            {row.isStale ? 'yes — model not in enabled registry' : 'no'}
          </span>
        </FormRow>
      </FormGrid>
    </>
  )
}

const AlternatesTab: React.FC<{
  row: RoleRow
  registry: LlmRegistryRow[] | undefined
  onSwitchTo: (model: string) => void
}> = ({ row, registry, onSwitchTo }) => {
  const ranked: AltScore[] = React.useMemo(
    () => rankAltModels(registry, row.assignedModel),
    [registry, row.assignedModel],
  )
  if (!registry) {
    return <EmptyInline pad>loading registry…</EmptyInline>
  }
  if (ranked.length === 0) {
    return (
      <EmptyInline pad>
        no alternate enabled models in the registry
      </EmptyInline>
    )
  }
  const cols: DtCol<AltScore>[] = [
    { key: 'model', label: 'Model', className: 'mono', render: (a) => a.model },
    { key: 'provider', label: 'Provider', render: (a) => a.provider },
    {
      key: 'fca',
      label: 'FCA',
      width: '60px',
      className: 'num',
      align: 'right',
      render: (a) => (a.fca == null ? '—' : a.fca.toFixed(2)),
    },
    {
      key: 'cost',
      label: 'Cost / 1M',
      width: '90px',
      className: 'num',
      align: 'right',
      render: (a) => (a.inputCostPer1k == null ? '—' : fmtUsd(a.inputCostPer1k * 1000)),
    },
    {
      key: 'score',
      label: 'Sim Score',
      width: '90px',
      className: 'num',
      align: 'right',
      render: (a) => a.score.toFixed(2),
    },
    {
      key: 'switch',
      label: '',
      width: '90px',
      className: 'r-actions',
      render: (a) => (
        <Btn
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            onSwitchTo(a.model)
          }}
          aria-label={`switch ${row.meta.label} to ${a.model}`}
        >
          switch to
        </Btn>
      ),
    },
  ]
  return (
    <>
      <SectionBar
        title="ranked alternates"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            client-side sim · 0.5×cost + 0.5×quality
          </span>
        }
      />
      <Dt<AltScore>
        columns={cols}
        rows={ranked.slice(0, 20)}
        rowKey={(a) => a.model}
      />
    </>
  )
}

const UsageTab: React.FC<{ row: RoleRow }> = ({ row }) => {
  if (!row.usage) {
    return (
      <EmptyInline pad>
        {/* TODO: per-role usage history is not exposed; modelUsage is */}
        {/* indexed by model id only — a role re-pinned today won't have */}
        {/* historical bar attribution. Wire /api/admin/llm-providers/default-models/usage */}
        no req attributable to{' '}
        <span className="accent">{row.assignedModel ?? row.meta.label}</span> in 24h
      </EmptyInline>
    )
  }
  const u = row.usage
  return (
    <>
      <SectionBar title="24h usage" />
      <FormGrid>
        <FormRow name="Requests"><span className="mono">{fmtNum(u.count)}</span></FormRow>
        <FormRow name="Tokens"><span className="mono">{fmtNum(u.tokens)}</span></FormRow>
        <FormRow name="Cost"><span className="mono">{fmtUsd(u.cost)}</span></FormRow>
      </FormGrid>
    </>
  )
}
