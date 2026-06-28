import * as React from 'react'
import { SectionBar } from '../../primitives-v3'
import {
  type SharedKBSourceRow,
  type UserContextSummary,
  fmtBytes,
  fmtDate,
  fmtNum,
  fmtRelTime,
} from './hooks'

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
        fontFamily: 'var(--font-mono)',
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
        wordBreak: 'break-all',
      }}
    >
      {value}
    </span>
  </div>
)

// TemplateDetail removed (Phase W 2026-05-19) — PromptTemplate Prisma model dropped,
// /api/admin/prompts/templates returns 404. TemplatesPane + TemplateModal also deleted.

export const SharedKBDetail: React.FC<{ row: SharedKBSourceRow }> = ({ row }) => {
  const url = (row.config as Record<string, unknown>)?.url as string | undefined
  const configJson = React.useMemo(() => {
    try {
      return JSON.stringify(row.config ?? {}, null, 2)
    } catch {
      return '{}'
    }
  }, [row.config])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <SectionBar title="source" />
      <KV label="id" value={row.id} mono />
      <KV label="name" value={row.name} />
      <KV label="type" value={row.type} mono />
      <KV label="enabled" value={row.enabled ? 'yes' : 'no'} />
      <KV label="schedule" value={row.schedule ?? '—'} mono />
      {url && <KV label="url" value={url} mono />}
      <KV label="docs" value={fmtNum(row.doc_count)} />
      <KV label="chunks" value={fmtNum(row.chunk_count)} />
      <KV label="created" value={fmtDate(row.created_at)} mono />
      <KV label="updated" value={fmtDate(row.updated_at)} mono />

      <SectionBar title="last ingest" />
      <KV label="when" value={fmtRelTime(row.last_ingest_at)} />
      <KV label="status" value={row.last_ingest_status ?? 'never run'} mono />
      {row.last_ingest_error && (
        <>
          <SectionBar title="error" />
          <pre
            style={{
              margin: 0,
              padding: '10px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--v3-t-meta)',
              color: 'var(--err)',
              whiteSpace: 'pre-wrap',
              border: '1px solid var(--line-1)',
            }}
          >
            {row.last_ingest_error}
          </pre>
        </>
      )}

      {row.description && (
        <>
          <SectionBar title="description" />
          <div style={{ color: 'var(--fg-1)', fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {row.description}
          </div>
        </>
      )}

      <SectionBar title="config" />
      <pre
        style={{
          margin: 0,
          padding: '10px 14px',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-1)',
          background: 'var(--bg-0)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          border: '1px solid var(--line-1)',
        }}
      >
        {configJson}
      </pre>
    </div>
  )
}

export const UserMemoryDetail: React.FC<{
  row: UserContextSummary
  storageBytes?: number
}> = ({ row }) => (
  <div style={{ display: 'grid', gap: 12 }}>
    <SectionBar title="user" />
    <KV label="id" value={row.userId} mono />
    <KV label="email" value={row.email} mono />
    <KV label="name" value={row.name} />
    <KV label="last activity" value={fmtRelTime(row.lastActivity)} />
    <KV label="last activity (abs)" value={fmtDate(row.lastActivity)} mono />

    <SectionBar title="entries by source" />
    <KV label="chat" value={fmtNum(row.chatEntries)} />
    <KV label="code" value={fmtNum(row.codeEntries)} />
    <KV label="workflow" value={fmtNum(row.workflowEntries)} />
    <KV label="memory" value={fmtNum(row.memoryEntries)} />
    <KV label="total" value={fmtNum(row.totalEntries)} />
    <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>
      drill into {row.userId.slice(0, 8)} via {' '}
      <span className="accent">/api/admin/user-context/entries?userId={row.userId}</span>
    </span>
  </div>
)

// Suppress unused imports warning when used selectively.
export const _ContentDetailUtils = { fmtBytes }
