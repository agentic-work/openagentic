import * as React from 'react'
import {
  Banner,
  EmptyInline,
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  SectionBar,
  Dt,
  type DtCol,
  SidePanel,
  Feed,
  FeedRow,
  type Status,
} from '../../primitives-v3'
import { useAdminQuery } from '../../hooks/useAdminQuery'

interface FeedbackStats {
  totalFeedback?: number
  uniqueMessages?: number
  uniqueUsers?: number
  satisfactionRate?: number | null
  byType?: Record<string, number>
}

interface ModelStats {
  model: string
  thumbs_up?: number
  thumbs_down?: number
  copy?: number
  total?: number
  satisfactionRate?: number | null
}

interface RecentFeedback {
  id: string
  feedbackType: string
  rating?: number | null
  comment?: string | null
  model?: string | null
  createdAt: string
  user?: { id?: string; name?: string | null; email?: string | null }
  message?: { id: string; content: string; role: string } | null
}

const fmtTs = (ts: string | undefined): string => {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  } catch {
    return '—'
  }
}

const feedbackStatus = (type: string): Status => {
  if (type === 'thumbs_up') return 'ok'
  if (type === 'thumbs_down') return 'err'
  if (type === 'copy') return 'info'
  return 'idle'
}

const fmtPct = (n: number | null | undefined): string =>
  typeof n === 'number' ? `${(n * 100).toFixed(1)}%` : '—'

export const FeedbackPane: React.FC = () => {
  const statsQ = useAdminQuery<FeedbackStats>(
    ['feedback', 'stats'],
    '/api/admin/feedback/stats',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const byModelQ = useAdminQuery<{ models?: ModelStats[] }>(
    ['feedback', 'by-model'],
    '/api/admin/feedback/by-model',
    { staleTime: 60_000, refetchInterval: 60_000 },
  )
  const recentQ = useAdminQuery<{ feedback?: RecentFeedback[] }>(
    ['feedback', 'recent'],
    '/api/admin/feedback/recent?limit=50',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )

  const [detail, setDetail] = React.useState<RecentFeedback | null>(null)

  const stats = statsQ.data ?? {}
  const models = byModelQ.data?.models ?? []
  const recent = recentQ.data?.feedback ?? []

  const modelCols: DtCol<ModelStats>[] = [
    { key: 'model', label: 'model', className: 'name', render: (r) => r.model },
    { key: 'up', label: 'up', align: 'right', className: 'num', render: (r) => (r.thumbs_up ?? 0).toLocaleString() },
    { key: 'down', label: 'down', align: 'right', className: 'num', render: (r) => (r.thumbs_down ?? 0).toLocaleString() },
    { key: 'copy', label: 'copy', align: 'right', className: 'num', render: (r) => (r.copy ?? 0).toLocaleString() },
    { key: 'total', label: 'total', align: 'right', className: 'num', render: (r) => (r.total ?? 0).toLocaleString() },
    {
      key: 'sat',
      label: 'sat',
      align: 'right',
      className: 'num',
      render: (r) => fmtPct(r.satisfactionRate ?? null),
    },
  ]

  return (
    <>
      <SectionBar title="feedback overview" />
      {statsQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/feedback/stats</span>
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="total feedback"
          value={statsQ.isLoading ? '…' : (stats.totalFeedback ?? 0).toLocaleString()}
          sub={`${(stats.uniqueMessages ?? 0).toLocaleString()} messages rated`}
        />
        <Kpi
          label="satisfaction"
          value={statsQ.isLoading ? '…' : fmtPct(stats.satisfactionRate)}
          sub="thumbs-up share"
          tone={
            typeof stats.satisfactionRate === 'number'
              ? stats.satisfactionRate >= 0.85
                ? 'ok'
                : stats.satisfactionRate >= 0.6
                  ? 'warn'
                  : 'err'
              : 'default'
          }
        />
        <Kpi
          label="users"
          value={statsQ.isLoading ? '…' : (stats.uniqueUsers ?? 0).toLocaleString()}
          sub="distinct raters"
        />
        <Kpi
          label="thumbs up"
          value={statsQ.isLoading ? '…' : (stats.byType?.thumbs_up ?? 0).toLocaleString()}
          sub={`${(stats.byType?.thumbs_down ?? 0).toLocaleString()} down · ${(stats.byType?.copy ?? 0).toLocaleString()} copy`}
        />
      </KpiGrid>

      <SectionBar title="per-model breakdown" />
      <Panel>
        <PanelHead title="feedback by model" count={models.length} />
        {byModelQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : byModelQ.isError ? (
          <EmptyInline pad>failed to fetch /api/admin/feedback/by-model</EmptyInline>
        ) : models.length === 0 ? (
          <EmptyInline pad>no per-model feedback recorded</EmptyInline>
        ) : (
          <Dt
            columns={modelCols}
            rows={models}
            rowKey={(r) => r.model}
          />
        )}
      </Panel>

      <SectionBar title="recent feedback" />
      <Panel>
        <PanelHead title="latest events" count={recent.length} />
        {recentQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : recentQ.isError ? (
          <EmptyInline pad>failed to fetch /api/admin/feedback/recent</EmptyInline>
        ) : recent.length === 0 ? (
          <EmptyInline pad>no recent feedback</EmptyInline>
        ) : (
          <Feed>
            {recent.slice(0, 100).map((f) => (
              <div
                key={f.id}
                onClick={() => setDetail(f)}
                style={{ cursor: 'pointer' }}
              >
                <FeedRow
                  ts={fmtTs(f.createdAt)}
                  status={feedbackStatus(f.feedbackType)}
                  who={f.user?.name ?? f.user?.email ?? '—'}
                  act={
                    <>
                      <span className="accent">{f.feedbackType}</span>
                      {f.model && (
                        <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>
                          on {f.model}
                        </span>
                      )}
                      {f.comment && (
                        <span style={{ color: 'var(--fg-2)', marginLeft: 6 }}>
                          · {f.comment.slice(0, 80)}
                          {f.comment.length > 80 ? '…' : ''}
                        </span>
                      )}
                    </>
                  }
                  right={
                    typeof f.rating === 'number' ? (
                      <span style={{ fontFamily: 'var(--font-v3-mono)' }}>
                        {f.rating}/5
                      </span>
                    ) : null
                  }
                />
              </div>
            ))}
          </Feed>
        )}
      </Panel>

      <SidePanel
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? detail.feedbackType : ''}
        meta={detail ? `${detail.user?.email ?? '—'} · ${fmtTs(detail.createdAt)}` : ''}
      >
        {detail && (
          <>
            <SectionBar title="comment" />
            <pre
              style={{
                margin: 0,
                padding: '10px 14px',
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 'var(--v3-t-meta)',
                color: 'var(--fg-1)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                borderBottom: '1px solid var(--line-1)',
              }}
            >
              {detail.comment ?? '(no comment)'}
            </pre>
            {detail.message && (
              <>
                <SectionBar title="rated message" />
                <pre
                  style={{
                    margin: 0,
                    padding: '10px 14px',
                    fontFamily: 'var(--font-v3-mono)',
                    fontSize: 'var(--v3-t-meta)',
                    color: 'var(--fg-1)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    background: 'var(--bg-0)',
                  }}
                >
                  {detail.message.content}
                </pre>
              </>
            )}
          </>
        )}
      </SidePanel>
    </>
  )
}

export default FeedbackPane
