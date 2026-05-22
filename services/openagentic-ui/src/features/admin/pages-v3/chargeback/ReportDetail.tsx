import * as React from 'react'
import { SectionBar, BarList, type BarItem } from '../../primitives-v3'
import { type ChargebackReportRow, fmtUsd, fmtNum, fmtDate } from './hooks'

const KV: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      fontSize: 12,
    }}
  >
    <span
      style={{
        color: 'var(--fg-3)',
        fontFamily: 'var(--font-v3-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {label}
    </span>
    <span
      style={{
        color: 'var(--fg-1)',
        fontFamily: mono ? 'var(--font-v3-mono)' : undefined,
        textAlign: 'right',
      }}
    >
      {value}
    </span>
  </div>
)

export const ReportDetail: React.FC<{ row: ChargebackReportRow }> = ({ row }) => {
  const totalTokens =
    (row.totalInputTokens ?? 0) +
    (row.totalOutputTokens ?? 0) +
    (row.totalCachedTokens ?? 0) +
    (row.totalThinkingTokens ?? 0)

  const providerBars: BarItem[] = React.useMemo(() => {
    const m = row.costByProvider ?? {}
    return Object.entries(m)
      .map(([k, v]) => ({ name: k, value: v ?? 0, display: fmtUsd(v ?? 0) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [row.costByProvider])

  const modelBars: BarItem[] = React.useMemo(() => {
    const m = row.costByModel ?? {}
    return Object.entries(m)
      .map(([k, v]) => ({ name: k, value: v ?? 0, display: fmtUsd(v ?? 0) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [row.costByModel])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <SectionBar title="summary" />
      <KV label="id" value={row.id} mono />
      <KV label="period" value={row.period} mono />
      <KV
        label="target"
        value={
          row.userName ??
          row.userEmail ??
          row.groupName ??
          (row.userId
            ? `user:${row.userId.slice(0, 8)}`
            : row.groupId
              ? `group:${row.groupId.slice(0, 8)}`
              : 'all')
        }
      />
      <KV label="status" value={row.status} mono />
      <KV label="created" value={fmtDate(row.createdAt)} mono />
      <KV label="requests" value={fmtNum(row.requestCount)} />
      <KV label="tokens (total)" value={fmtNum(totalTokens)} />
      <KV label="cost (total)" value={fmtUsd(row.totalCost)} />

      <SectionBar title="token breakdown" />
      <KV label="input" value={fmtNum(row.totalInputTokens)} />
      <KV label="output" value={fmtNum(row.totalOutputTokens)} />
      <KV label="cached" value={fmtNum(row.totalCachedTokens)} />
      <KV label="thinking" value={fmtNum(row.totalThinkingTokens)} />

      <SectionBar title="cost breakdown" />
      <KV label="llm" value={fmtUsd(row.totalLlmCost)} />
      <KV label="mcp" value={fmtUsd(row.totalMcpCost)} />
      <KV label="compute" value={fmtUsd(row.totalComputeCost)} />
      <KV label="storage" value={fmtUsd(row.totalStorageCost)} />

      {providerBars.length > 0 && (
        <>
          <SectionBar title="cost by provider" />
          <div style={{ paddingTop: 4 }}>
            <BarList items={providerBars} />
          </div>
        </>
      )}

      {modelBars.length > 0 && (
        <>
          <SectionBar title="cost by model" />
          <div style={{ paddingTop: 4 }}>
            <BarList items={modelBars} />
          </div>
        </>
      )}
    </div>
  )
}
