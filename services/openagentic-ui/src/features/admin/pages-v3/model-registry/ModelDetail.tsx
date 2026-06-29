import * as React from 'react'
import {
  Dt,
  type DtCol,
  EmptyInline,
  SectionBar,
  PriorityBadge,
  StatusDot,
  FormGrid,
  FormRow,
} from '../../primitives-v3'
import {
  type ModelRow,
  CapList,
  fmtUsd,
  fmtNum,
  fmtCostPer1M,
  guessTier,
} from './types'
import {
  type AuditLogEntry,
  type ModelUsageRow,
  useAuditLogs,
  useScopedAuditLogs,
} from '../../hooks/useDashboardMetrics'
import { fmtRel } from '../llm-providers/types'

export interface ModelDetailProps {
  row: ModelRow
  tab: string
  modelUsage: ModelUsageRow[] | undefined
  auditLogs: ReturnType<typeof useAuditLogs>
}

export const ModelDetail: React.FC<ModelDetailProps> = ({ row, tab, modelUsage, auditLogs }) => {
  if (tab === 'overview')     return <OverviewTab row={row} />
  if (tab === 'capabilities') return <CapabilitiesTab row={row} />
  if (tab === 'pricing')      return <PricingTab row={row} />
  if (tab === 'usage')        return <UsageTab row={row} modelUsage={modelUsage} />
  if (tab === 'logs')         return <LogsTab row={row} auditLogs={auditLogs} />
  return null
}

const OverviewTab: React.FC<{ row: ModelRow }> = ({ row }) => (
  <>
    <SectionBar title="identification" />
    <FormGrid>
      <FormRow name="Model id" configKey="registry.model"><span className="mono">{row.model}</span></FormRow>
      <FormRow name="Registry id" configKey="registry.id"><span className="mono">{row.id}</span></FormRow>
      <FormRow name="Provider" configKey="registry.provider"><span className="mono">{row.providerDisplay}</span></FormRow>
      <FormRow name="Role" configKey="registry.role"><span className="mono">{row.role}</span></FormRow>
      <FormRow name="Family">
        <span className="mono">{row.family ?? '—'}</span>
      </FormRow>
      <FormRow name="Tier"><PriorityBadge tier={guessTier(row.model)} /></FormRow>
      <FormRow name="Priority">
        <span className="mono">{row.priority}</span>
      </FormRow>
    </FormGrid>
    <SectionBar title="status" />
    <FormGrid>
      <FormRow name="Enabled">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={row.enabled ? 'ok' : 'idle'} />
          <span style={{ color: row.enabled ? 'var(--ok)' : 'var(--fg-3)' }}>
            {row.enabled ? 'yes' : 'no'}
          </span>
        </span>
      </FormRow>
      <FormRow name="Max tokens">
        <span className="mono">{fmtNum(row.maxTokens)}</span>
      </FormRow>
      <FormRow name="FCA score">
        <span className="mono">{row.fca != null ? row.fca.toFixed(2) : '—'}</span>
      </FormRow>
      <FormRow name="Avg latency">
        <span className="mono">{row.avgLatencyMs != null ? `${row.avgLatencyMs} ms` : '—'}</span>
      </FormRow>
    </FormGrid>
  </>
)

const CapabilitiesTab: React.FC<{ row: ModelRow }> = ({ row }) => (
  <>
    <SectionBar title="capability matrix" />
    <FormGrid>
      <FormRow name="Inline pills"><CapList caps={row.caps} /></FormRow>
      <FormRow name="chat">{row.caps.chat ? 'yes' : 'no'}</FormRow>
      <FormRow name="tools">{row.caps.tools ? 'yes' : 'no'}</FormRow>
      <FormRow name="vision">{row.caps.vision ? 'yes' : 'no'}</FormRow>
      <FormRow name="embeddings">{row.caps.embeddings ? 'yes' : 'no'}</FormRow>
      <FormRow name="streaming">{row.caps.streaming ? 'yes' : 'no'}</FormRow>
      <FormRow name="thinking">{row.caps.thinking ? 'yes' : 'no'}</FormRow>
      <FormRow name="image generation">{row.caps.imageGeneration ? 'yes' : 'no'}</FormRow>
    </FormGrid>
  </>
)

const PricingTab: React.FC<{ row: ModelRow }> = ({ row }) => (
  <>
    <SectionBar title="cost model" />
    <FormGrid>
      <FormRow
        name="Cost source"
        desc="registry = CSP-SDK populated · mcr-estimate = MCR fallback"
      >
        <span className="mono" style={{ color: row.costSource === 'unknown' ? 'var(--fg-3)' : undefined }}>
          {row.costSource}
        </span>
      </FormRow>
      <FormRow name="Input · /1M tokens">
        <span className="mono">{fmtCostPer1M(row.inputCostPer1k)}</span>
      </FormRow>
      <FormRow name="Output · /1M tokens">
        <span className="mono">{fmtCostPer1M(row.outputCostPer1k)}</span>
      </FormRow>
      <FormRow name="Input · /1k tokens">
        <span className="mono">
          {row.inputCostPer1k != null ? fmtUsd(row.inputCostPer1k) : '—'}
        </span>
      </FormRow>
      <FormRow name="Output · /1k tokens">
        <span className="mono">
          {row.outputCostPer1k != null ? fmtUsd(row.outputCostPer1k) : '—'}
        </span>
      </FormRow>
    </FormGrid>
  </>
)

const UsageTab: React.FC<{ row: ModelRow; modelUsage: ModelUsageRow[] | undefined }> = ({
  row,
  modelUsage,
}) => {
  const u = (modelUsage ?? []).find((m) => m?.model === row.model)
  if (!u) {
    return (
      <EmptyInline pad>
        no req attributable to <span className="accent">{row.model}</span> in the last 24h
      </EmptyInline>
    )
  }
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

const LogsTab: React.FC<{ row: ModelRow; auditLogs: ReturnType<typeof useAuditLogs> }> = ({ row }) => {
  // Server-side filtered fetch — much wider window than the global feed
  // and won't false-empty when the model isn't in the most-recent 50.
  // Tries resourceId match on either the registry row id or the model
  // string itself; the api uses contains-mode insensitive.
  const scoped = useScopedAuditLogs({ resourceId: row.model, limit: 100 })
  const scopedById = useScopedAuditLogs({ resourceId: row.id, limit: 100 })
  if (scoped.isLoading || scopedById.isLoading) return <EmptyInline pad>loading…</EmptyInline>
  const seen = new Set<string>()
  const matching: AuditLogEntry[] = []
  for (const e of [...(scoped.data?.logs ?? []), ...(scopedById.data?.logs ?? [])]) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    matching.push(e)
  }
  matching.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  if (matching.length === 0) {
    return (
      <EmptyInline pad>
        no audit-log entries reference{' '}
        <span className="accent">{row.model}</span> across the full history.
      </EmptyInline>
    )
  }
  const cols: DtCol<AuditLogEntry>[] = [
    {
      key: 'ts',
      label: 'When',
      width: '90px',
      className: 'mono',
      render: (e) => fmtRel(e.timestamp),
    },
    { key: 'who', label: 'Actor', render: (e) => e.userName ?? e.userEmail ?? '—' },
    { key: 'action', label: 'Action', render: (e) => e.action ?? '—' },
  ]
  return <Dt<AuditLogEntry> columns={cols} rows={matching} rowKey={(e) => e.id} />
}
