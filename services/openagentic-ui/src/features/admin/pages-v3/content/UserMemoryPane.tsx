import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  EmptyInline,
  Banner,
  FilterRow,
  MiniGrid,
  Mini,
  SectionBar,
} from '../../primitives-v3'
import {
  type UserContextOverview,
  type UserContextSummary,
  fmtNum,
  fmtBytes,
  fmtRelTime,
} from './hooks'

export interface UserMemoryPaneProps {
  overview?: UserContextOverview
  users: UserContextSummary[]
  isLoading: boolean
  isError: boolean
  search: string
  onSearch: (s: string) => void
  onOpen: (row: UserContextSummary) => void
  selectedId?: string
}

export const UserMemoryPane: React.FC<UserMemoryPaneProps> = ({
  overview,
  users,
  isLoading,
  isError,
  search,
  onSearch,
  onOpen,
  selectedId,
}) => {
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.userId.toLowerCase().includes(q),
    )
  }, [users, search])

  const cols: DtCol<UserContextSummary>[] = [
    {
      key: 'user',
      label: 'USER',
      className: 'name',
      render: (r) => (
        <>
          <div style={{ color: 'var(--fg-0)' }}>{r.name}</div>
          {r.email && r.email !== r.name && (
            <div
              style={{
                color: 'var(--fg-3)',
                fontSize: 10,
                fontFamily: 'var(--font-v3-mono)',
                marginTop: 2,
              }}
            >
              {r.email}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'chat',
      label: 'CHAT',
      className: 'num',
      render: (r) => fmtNum(r.chatEntries),
    },
    {
      key: 'code',
      label: 'CODE',
      className: 'num',
      render: (r) => fmtNum(r.codeEntries),
    },
    {
      key: 'workflow',
      label: 'FLOW',
      className: 'num',
      render: (r) => fmtNum(r.workflowEntries),
    },
    {
      key: 'memory',
      label: 'MEM',
      className: 'num',
      render: (r) => fmtNum(r.memoryEntries),
    },
    {
      key: 'total',
      label: 'TOTAL',
      className: 'num',
      render: (r) => fmtNum(r.totalEntries),
    },
    {
      key: 'last',
      label: 'LAST ACTIVITY',
      className: 'dim',
      render: (r) => fmtRelTime(r.lastActivity),
    },
  ]

  return (
    <>
      {isError && (
        <Banner level="warn" label="warn">
          /api/admin/user-context/overview returned an error — table will be empty
        </Banner>
      )}

      <SectionBar title="cross-mode totals" />
      <Panel>
        <PanelHead
          title="entries by source"
          count={overview ? `${fmtNum(overview.totalUsers)} users` : ''}
        />
        <div style={{ padding: '10px 14px' }}>
          <MiniGrid cols={5}>
            <Mini
              label="total entries"
              value={isLoading ? '…' : fmtNum(overview?.totalEntries)}
              sub={fmtBytes(overview?.storageBytes)}
            />
            <Mini
              label="chat"
              value={isLoading ? '…' : fmtNum(overview?.bySource?.chat)}
              sub="conversational"
            />
            <Mini
              label="code"
              value={isLoading ? '…' : fmtNum(overview?.bySource?.code)}
              sub="codemode sessions"
            />
            <Mini
              label="workflow"
              value={isLoading ? '…' : fmtNum(overview?.bySource?.workflow)}
              sub="flows runs"
            />
            <Mini
              label="memory"
              value={isLoading ? '…' : fmtNum(overview?.bySource?.memory)}
              sub="long-term store"
            />
          </MiniGrid>
        </div>
      </Panel>

      <FilterRow value={search} onSearch={onSearch} searchPlaceholder="search users…" />

      <Panel>
        <PanelHead title="per-user usage" count={isLoading ? '…' : filtered.length} />
        {isLoading ? (
          <EmptyInline pad>loading /api/admin/user-context/overview…</EmptyInline>
        ) : filtered.length === 0 ? (
          <EmptyInline pad>
            {users.length === 0
              ? 'no user-context entries yet'
              : 'no users match the current search'}
          </EmptyInline>
        ) : (
          <Dt
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.userId}
            selectedKey={selectedId}
            onRowClick={onOpen}
            onRowDoubleClick={onOpen}
          />
        )}
      </Panel>
    </>
  )
}
