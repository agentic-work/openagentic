import * as React from 'react'
import {
  Feed,
  FeedRow,
  EmptyInline,
  Banner,
  SectionBar,
  FilterRow,
  Chip,
} from '../../primitives-v3'
import {
  type IntegrationLogEntry,
  fmtClock,
  fmtRelative,
  logStatusDot,
} from './types'

type PlatformFilter = 'all' | 'slack' | 'teams'
type DirectionFilter = 'all' | 'inbound' | 'outbound'
type StatusFilter = 'all' | 'success' | 'error' | 'dropped'

const PLATFORM_ORDER: PlatformFilter[] = ['all', 'slack', 'teams']
const DIRECTION_ORDER: DirectionFilter[] = ['all', 'inbound', 'outbound']
const STATUS_ORDER: StatusFilter[] = ['all', 'success', 'error', 'dropped']

export interface LogsPaneProps {
  logs: IntegrationLogEntry[]
  isLoading: boolean
  isError: boolean
}

export const LogsPane: React.FC<LogsPaneProps> = ({ logs, isLoading, isError }) => {
  const [platform, setPlatform] = React.useState<PlatformFilter>('all')
  const [direction, setDirection] = React.useState<DirectionFilter>('all')
  const [status, setStatus] = React.useState<StatusFilter>('all')

  const filtered = React.useMemo(() => {
    return logs.filter((e) => {
      if (platform !== 'all' && e.platform !== platform) return false
      if (direction !== 'all' && e.direction !== direction) return false
      if (status !== 'all' && e.status !== status) return false
      return true
    })
  }, [logs, platform, direction, status])

  const counts = React.useMemo(() => {
    const c = {
      platform: { all: logs.length, slack: 0, teams: 0 } as Record<string, number>,
      direction: { all: logs.length, inbound: 0, outbound: 0 } as Record<string, number>,
      status: { all: logs.length, success: 0, error: 0, dropped: 0 } as Record<string, number>,
    }
    for (const e of logs) {
      if (e.platform) c.platform[e.platform] = (c.platform[e.platform] ?? 0) + 1
      if (e.direction) c.direction[e.direction] = (c.direction[e.direction] ?? 0) + 1
      if (e.status) c.status[e.status] = (c.status[e.status] ?? 0) + 1
    }
    return c
  }, [logs])

  return (
    <>
      <FilterRow>
        {PLATFORM_ORDER.map((p) => (
          <Chip
            key={`p-${p}`}
            label="platform"
            value={p}
            count={counts.platform[p] ?? 0}
            on={platform === p}
            onClick={() => setPlatform(p)}
          />
        ))}
        {DIRECTION_ORDER.map((d) => (
          <Chip
            key={`d-${d}`}
            label="dir"
            value={d}
            count={counts.direction[d] ?? 0}
            on={direction === d}
            onClick={() => setDirection(d)}
          />
        ))}
        {STATUS_ORDER.map((s) => (
          <Chip
            key={`s-${s}`}
            label="status"
            value={s}
            count={counts.status[s] ?? 0}
            on={status === s}
            onClick={() => setStatus(s)}
          />
        ))}
      </FilterRow>

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/integrations/*/logs</span> — endpoint
          may be unavailable on this api build
        </Banner>
      )}

      <SectionBar
        title="recent integration events"
        count={filtered.length}
        right={
          <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
            union of /:id/logs · newest first
          </span>
        }
      />
      {isLoading && filtered.length === 0 ? (
        <EmptyInline pad>loading integration logs…</EmptyInline>
      ) : filtered.length === 0 ? (
        <EmptyInline pad>
          {logs.length === 0
            ? 'no integration events recorded yet.'
            : 'no events match the current filters.'}
        </EmptyInline>
      ) : (
        <Feed>
          {filtered.map((e) => (
            <FeedRow
              key={e.id}
              ts={fmtClock(e.timestamp)}
              status={logStatusDot(e.status)}
              who={
                <>
                  <span style={{ fontFamily: 'var(--font-v3-mono)' }}>
                    {e.platform ? `${e.platform}/` : ''}
                    {e.integrationName ?? '—'}
                  </span>
                  {e.user && <> · {e.user}</>}
                </>
              }
              act={
                <>
                  <span className="accent">{e.direction ?? 'unknown'}</span>
                  {e.channel && (
                    <>
                      {' · '}
                      <span style={{ color: 'var(--fg-2)' }}>{e.channel}</span>
                    </>
                  )}
                  {e.messagePreview && (
                    <>
                      {' · '}
                      <span style={{ color: 'var(--fg-3)' }}>
                        {truncate(e.messagePreview, 80)}
                      </span>
                    </>
                  )}
                </>
              }
              right={fmtRelative(e.timestamp)}
            />
          ))}
        </Feed>
      )}
    </>
  )
}

function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export default LogsPane
