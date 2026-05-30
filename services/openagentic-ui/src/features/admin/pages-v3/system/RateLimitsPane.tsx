import * as React from 'react'
import {
  Banner,
  Btn,
  Dt,
  type DtCol,
  EmptyInline,
  Kpi,
  KpiGrid,
  Panel,
  PanelHead,
  SectionBar,
} from '../../primitives-v3'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import { EditRateLimitTierModal, type RateLimitTier as TierShape } from './EditRateLimitTierModal'

interface RateLimitTier {
  name: string
  displayName?: string
  requestsPerMinute?: number
  requestsPerHour?: number
  requestsPerDay?: number
  tokensPerDay?: number
  tokensPerMinute?: number
  tokensPerHour?: number
  workflowExecutionsPerHour?: number
  concurrentWorkflows?: number
  codeExecutionsPerHour?: number
  description?: string
}

interface RateLimitStats {
  totalUsers?: number
  usersWithCustomLimits?: number
  totalViolations?: number
  tierDistribution?: Record<string, number>
}

interface RateLimitsResponse {
  tiers?: RateLimitTier[]
  globalDefaultTier?: string
}

const fmtNum = (n: number | undefined): string =>
  typeof n !== 'number'
    ? '—'
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}K`
        : String(n)

export const RateLimitsPane: React.FC = () => {
  const cfgQ = useAdminQuery<RateLimitsResponse>(
    ['rate-limits', 'config'],
    '/api/admin/rate-limits',
    { staleTime: 60_000 },
  )
  const statsQ = useAdminQuery<RateLimitStats>(
    ['rate-limits', 'stats'],
    '/api/admin/rate-limits/stats',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const tiers = cfgQ.data?.tiers ?? []
  const globalDefault = cfgQ.data?.globalDefaultTier ?? '—'
  const stats = statsQ.data ?? {}
  const [editing, setEditing] = React.useState<TierShape | null>(null)

  const cols: DtCol<RateLimitTier>[] = [
    {
      key: 'name',
      label: 'tier',
      className: 'name',
      render: (r) => r.displayName ?? r.name,
    },
    {
      key: 'rpm',
      label: 'rpm',
      align: 'right',
      className: 'num',
      render: (r) => fmtNum(r.requestsPerMinute),
    },
    {
      key: 'rph',
      label: 'rph',
      align: 'right',
      className: 'num',
      render: (r) => fmtNum(r.requestsPerHour),
    },
    {
      key: 'rpd',
      label: 'rpd',
      align: 'right',
      className: 'num',
      render: (r) => fmtNum(r.requestsPerDay),
    },
    {
      key: 'tpd',
      label: 'tokens/day',
      align: 'right',
      className: 'num',
      render: (r) => fmtNum(r.tokensPerDay),
    },
    {
      key: 'wf',
      label: 'wf/h',
      align: 'right',
      className: 'num',
      render: (r) => fmtNum(r.workflowExecutionsPerHour),
    },
    {
      key: 'cc',
      label: 'concurrency',
      align: 'right',
      className: 'num',
      render: (r) => fmtNum(r.concurrentWorkflows),
    },
    {
      key: 'edit',
      label: 'edit',
      className: 'r-actions',
      render: (r) => (
        <Btn variant="ghost" onClick={() => setEditing(r as TierShape)}>edit</Btn>
      ),
    },
  ]

  return (
    <div data-density="compact">
      <EditRateLimitTierModal tier={editing} onClose={() => setEditing(null)} />

      {(cfgQ.isError || statsQ.isError) && (
        <Banner level="warn" label="warn">
          one or more <span className="accent">/api/admin/rate-limits</span> endpoints
          unreachable
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="total users"
          value={statsQ.isLoading ? '…' : fmtNum(stats.totalUsers)}
          sub="all tiers"
        />
        <Kpi
          label="custom limits"
          value={statsQ.isLoading ? '…' : fmtNum(stats.usersWithCustomLimits)}
          sub="override-tier users"
        />
        <Kpi
          label="violations"
          value={statsQ.isLoading ? '…' : fmtNum(stats.totalViolations)}
          sub="lifetime"
          tone={(stats.totalViolations ?? 0) > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="global default"
          value={cfgQ.isLoading ? '…' : globalDefault}
          sub="tier assigned to new users"
        />
      </KpiGrid>

      <SectionBar title="tier configuration" count={tiers.length} />
      <Panel>
        <PanelHead title="tiers" count={tiers.length} />
        {cfgQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : cfgQ.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : tiers.length === 0 ? (
          <EmptyInline pad>no tiers configured</EmptyInline>
        ) : (
          <Dt
            columns={cols}
            rows={tiers}
            rowKey={(r) => r.name}
            rowDataAttrs={(r: any) => {
              const usage = Number(r.requestsThisHour ?? 0)
              const limit = Number(r.requestsPerHour ?? 0)
              const ratio = limit > 0 ? usage / limit : 0
              return {
                status: ratio > 1 ? 'err' : ratio > 0.8 ? 'warn' : 'ok',
              }
            }}
          />
        )}
      </Panel>
    </div>
  )
}

export default RateLimitsPane
