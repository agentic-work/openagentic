import * as React from 'react'
import {
  Dt,
  EmptyInline,
  SectionBar,
  StatusDot,
  FormGrid,
  FormRow,
} from '../../primitives-v3'
import {
  type ProviderRow,
  CapPill,
  fmtRel,
  fmtUsd,
  statusColor,
  statusTone,
} from './types'
import {
  useDashboardMetrics,
  useAuditLogs,
  useScopedAuditLogs,
  type AuditLogEntry,
} from '../../hooks/useDashboardMetrics'

export interface ProviderDetailProps {
  row: ProviderRow
  tab: string
  metrics: ReturnType<typeof useDashboardMetrics>
  auditLogs: ReturnType<typeof useAuditLogs>
}

export const ProviderDetail: React.FC<ProviderDetailProps> = ({ row, tab, metrics, auditLogs }) => {
  if (tab === 'overview') return <OverviewTab row={row} />
  if (tab === 'models')   return <ModelsTab row={row} />
  if (tab === 'auth')     return <AuthTab row={row} />
  if (tab === 'logs')     return <LogsTab row={row} auditLogs={auditLogs} />
  if (tab === 'cost')     return <CostTab row={row} metrics={metrics} />
  return null
}

const OverviewTab: React.FC<{ row: ProviderRow }> = ({ row }) => (
  <>
    <SectionBar title="status" />
    <FormGrid>
      <FormRow name="Status" desc="from /api/admin/llm-providers/health">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={statusTone(row.status)} />
          <span style={{ color: statusColor(row.status) }}>{row.status}</span>
        </span>
      </FormRow>
      <FormRow name="Last checked"><span className="mono">{fmtRel(row.lastChecked)}</span></FormRow>
      {row.error && (
        <FormRow name="Last error">
          <span style={{ color: 'var(--err)' }}>{row.error}</span>
        </FormRow>
      )}
    </FormGrid>
    <SectionBar title="config" />
    <FormGrid>
      <FormRow name="Type" configKey="provider.type"><span className="mono">{row.type}</span></FormRow>
      <FormRow name="Region" configKey="provider.config.region"><span className="mono">{row.region}</span></FormRow>
      <FormRow name="Endpoint" configKey="provider.config.endpoint"><span className="mono">{row.endpoint ?? '—'}</span></FormRow>
      <FormRow name="Tier" configKey="provider.priority">{row.tier}</FormRow>
      <FormRow name="Models registered">{row.modelCount}</FormRow>
    </FormGrid>
  </>
)

const ModelsTab: React.FC<{ row: ProviderRow }> = ({ row }) => {
  const models = row.raw.models ?? []
  if (models.length === 0) {
    return <EmptyInline pad>no models registered for this provider</EmptyInline>
  }
  return (
    <Dt
      columns={[
        { key: 'id', label: 'Model', className: 'mono', render: (m: any) => m.id },
        {
          key: 'caps',
          label: 'Capabilities',
          render: (m: any) => {
            const c = m.capabilities ?? {}
            return (
              <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                {c.chat && <CapPill tone="accent">chat</CapPill>}
                {c.tools && <CapPill tone="ok">tools</CapPill>}
                {c.vision && <CapPill tone="warn">vision</CapPill>}
                {c.embeddings && <CapPill tone="info">embed</CapPill>}
              </span>
            )
          },
        },
        {
          key: 'max',
          label: 'Max Tokens',
          className: 'num',
          align: 'right',
          render: (m: any) => m.maxTokens?.toLocaleString() ?? '—',
        },
      ]}
      rows={models}
      rowKey={(m: any) => m.id}
    />
  )
}

const AuthTab: React.FC<{ row: ProviderRow }> = ({ row }) => {
  const ac = row.raw.authConfig ?? {}
  return (
    <FormGrid>
      <FormRow name="Auth type" configKey="provider.authConfig.type">
        <span className="mono">{ac.type ?? '—'}</span>
      </FormRow>
      <FormRow name="Has API key">
        <span style={{ color: ac.hasApiKey ? 'var(--ok)' : 'var(--fg-3)' }}>
          {ac.hasApiKey ? 'yes' : 'no'}
        </span>
      </FormRow>
      <FormRow name="Has credentials">
        <span style={{ color: ac.hasCredentials ? 'var(--ok)' : 'var(--fg-3)' }}>
          {ac.hasCredentials ? 'yes' : 'no'}
        </span>
      </FormRow>
      {/* TODO: rotate-key / refresh-credentials actions when mutation surface lands. */}
    </FormGrid>
  )
}

const LogsTab: React.FC<{ row: ProviderRow; auditLogs: ReturnType<typeof useAuditLogs> }> = ({ row }) => {
  // Server-side scoped fetch via /audit-logs?resourceId — fans out two
  // queries (provider name + provider id) and merges so either form of
  // resourceId in the audit row matches.
  const byName = useScopedAuditLogs({ resourceId: row.name, limit: 100 })
  const byId = useScopedAuditLogs({ resourceId: row.id, limit: 100 })
  if (byName.isLoading || byId.isLoading) return <EmptyInline pad>loading…</EmptyInline>
  const seen = new Set<string>()
  const logs: AuditLogEntry[] = []
  for (const e of [...(byName.data?.logs ?? []), ...(byId.data?.logs ?? [])]) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    logs.push(e)
  }
  logs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
  if (logs.length === 0) {
    return (
      <EmptyInline pad>
        no audit-log entries reference{' '}
        <span className="accent">{row.name}</span> across the full history.
      </EmptyInline>
    )
  }
  return (
    <Dt
      columns={[
        {
          key: 'ts',
          label: 'When',
          width: '90px',
          className: 'mono',
          render: (e: AuditLogEntry) => fmtRel(e.timestamp),
        },
        {
          key: 'who',
          label: 'Actor',
          render: (e: AuditLogEntry) => e.userName ?? e.userEmail ?? '—',
        },
        { key: 'action', label: 'Action', render: (e: AuditLogEntry) => e.action ?? '—' },
      ]}
      rows={logs}
      rowKey={(e: AuditLogEntry) => e.id}
    />
  )
}

const CostTab: React.FC<{ row: ProviderRow; metrics: ReturnType<typeof useDashboardMetrics> }> = ({ row, metrics }) => {
  if (!metrics.data) return <EmptyInline pad>loading…</EmptyInline>
  const series = metrics.data?.costByModel ?? []
  const myModelIds = new Set((row.raw.models ?? []).map((m) => m.id))
  const mine = series.filter((s) => myModelIds.has(s.model))
  const total = mine.reduce(
    (sum, s) => sum + s.data.reduce((a, b) => a + (Number(b.value) || 0), 0),
    0,
  )
  if (mine.length === 0) {
    return (
      <EmptyInline pad>
        {/* TODO: cloud providers that auto-discover models won't appear here */}
        {/* until /api/admin/llm-providers/:id/cost-history is wired. */}
        no cost data attributable to this provider's registered models
      </EmptyInline>
    )
  }
  return (
    <>
      <div
        style={{
          padding: '8px 14px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-2)',
        }}
      >
        24h total: <span style={{ color: 'var(--fg-0)' }}>{fmtUsd(total)}</span> across{' '}
        {mine.length} model{mine.length === 1 ? '' : 's'}
      </div>
      <Dt
        columns={[
          { key: 'model', label: 'Model', className: 'mono', render: (r: any) => r.model },
          {
            key: 'cost',
            label: '24h cost',
            className: 'num',
            align: 'right',
            render: (r: any) => fmtUsd(r.total),
          },
        ]}
        rows={mine.map((s) => ({
          model: s.model,
          total: s.data.reduce((a, b) => a + (Number(b.value) || 0), 0),
        }))}
        rowKey={(r: any) => r.model}
      />
    </>
  )
}
