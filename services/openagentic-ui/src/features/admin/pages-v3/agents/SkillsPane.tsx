import * as React from 'react'
import {
  FilterRow,
  Chip,
  Dt,
  type DtCol,
  Banner,
  EmptyInline,
} from '../../primitives-v3'
import { fmtRelative } from './types'
import type {
  AdminAgentSkillRow,
  AdminAgentRow,
} from '../../hooks/useDashboardMetrics'

export interface SkillsPaneProps {
  rows: AdminAgentSkillRow[]
  isLoading: boolean
  isError: boolean
  agents: AdminAgentRow[]
  search: string
  onSearch: (s: string) => void
  typeFilter: string
  onTypeFilter: (t: string) => void
  onPickSkillAgents: (skillId: string, agents: AdminAgentRow[]) => void
}

// Stable chip values; "all" is the no-filter sentinel.
const STATIC_TYPES = ['all', 'prompt_module', 'tool_bundle', 'workflow', 'code_template']

function skillUsage(skill: AdminAgentSkillRow, agents: AdminAgentRow[]): {
  count: number
  who: AdminAgentRow[]
} {
  const who = agents.filter((a) => (a.skills ?? []).includes(skill.id) || (a.skills ?? []).includes(skill.name))
  return { count: who.length, who }
}

export const SkillsPane: React.FC<SkillsPaneProps> = ({
  rows,
  isLoading,
  isError,
  agents,
  search,
  onSearch,
  typeFilter,
  onTypeFilter,
  onPickSkillAgents,
}) => {
  // Build the chip list dynamically from the current rows so unusual
  // skill types (e.g. "prompt_injection" from older imports) still get
  // their own chip without a registry edit.
  const dynamicTypes = React.useMemo(() => {
    const set = new Set<string>(STATIC_TYPES)
    for (const r of rows) if (r.type) set.add(r.type)
    return Array.from(set)
  }, [rows])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (!q) return true
      return (
        (r.display_name ?? r.name ?? '').toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.tags ?? []).some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [rows, search, typeFilter])

  const cols: DtCol<AdminAgentSkillRow>[] = [
    {
      key: 'skill',
      label: 'Skill',
      className: 'name',
      render: (r) => (
        <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>
            {r.display_name ?? r.name}
          </span>
          {r.description && (
            <span
              style={{
                color: 'var(--fg-3)',
                fontSize: 'var(--v3-t-meta)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 360,
              }}
            >
              {r.description}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      width: '140px',
      className: 'mono',
      render: (r) => r.type ?? '—',
    },
    {
      key: 'source',
      label: 'Source',
      width: '120px',
      className: 'dim',
      render: (r) => r.source ?? '—',
    },
    {
      key: 'tags',
      label: 'Tags',
      width: '180px',
      className: 'dim',
      render: (r) => {
        const tags = r.tags ?? []
        if (tags.length === 0) return <span style={{ color: 'var(--fg-3)' }}>—</span>
        return (
          <span
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'inline-block',
              maxWidth: 170,
            }}
            title={tags.join(', ')}
          >
            {tags.slice(0, 3).join(' · ')}
            {tags.length > 3 ? ` · +${tags.length - 3}` : ''}
          </span>
        )
      },
    },
    {
      key: 'usedBy',
      label: 'Used by',
      width: '90px',
      align: 'right',
      className: 'num',
      render: (r) => {
        const usage = skillUsage(r, agents)
        if (usage.count === 0 && (r.usage_count ?? 0) === 0) {
          return <span style={{ color: 'var(--fg-3)' }}>0</span>
        }
        return usage.count > 0 ? usage.count.toLocaleString() : (r.usage_count ?? 0).toLocaleString()
      },
    },
    {
      key: 'created',
      label: 'Created',
      width: '110px',
      className: 'mono',
      render: (r) => fmtRelative(r.created_at),
    },
  ]

  return (
    <>
      <FilterRow
        searchPlaceholder="search skills · names, descriptions, tags…"
        value={search}
        onSearch={onSearch}
        right={
          <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
            {filtered.length} / {rows.length} match
          </span>
        }
      >
        {dynamicTypes.map((v) => (
          <Chip
            key={v}
            label="type"
            value={v}
            on={typeFilter === v}
            onClick={() => onTypeFilter(v)}
          />
        ))}
      </FilterRow>

      {isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/agents/skills</span> — list may be stale
        </Banner>
      )}

      {isLoading && rows.length === 0 ? (
        <EmptyInline pad>loading skills…</EmptyInline>
      ) : filtered.length === 0 ? (
        <EmptyInline pad>
          {search || typeFilter !== 'all'
            ? 'no skills match the current filters.'
            : 'no skills registered yet.'}
        </EmptyInline>
      ) : (
        <div style={{ padding: '4px 14px 12px' }}>
          <Dt
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => onPickSkillAgents(r.id, skillUsage(r, agents).who)}
            onRowDoubleClick={(r) => onPickSkillAgents(r.id, skillUsage(r, agents).who)}
            rowDataAttrs={(r: any) => {
              const usedBy = skillUsage(r, agents).count
              return {
                status: r.enabled === false ? 'idle' : usedBy > 0 ? 'ok' : 'warn',
              }
            }}
          />
        </div>
      )}
    </>
  )
}

export default SkillsPane
