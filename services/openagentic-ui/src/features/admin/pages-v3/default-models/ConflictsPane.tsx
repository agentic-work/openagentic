import * as React from 'react'
import {
  Panel,
  Dt,
  type DtCol,
  EmptyInline,
} from '../../primitives-v3'
import { type RoleRow } from './types'

export interface ConflictsPaneProps {
  rows: RoleRow[]
  isLoading: boolean
  isError: boolean
}

interface ConflictRow {
  role: string
  model: string
  reason: string
}

export const ConflictsPane: React.FC<ConflictsPaneProps> = ({ rows, isLoading, isError }) => {
  if (isError) {
    return (
      <Panel>
        <EmptyInline pad>failed to load defaults — conflicts cannot be computed</EmptyInline>
      </Panel>
    )
  }
  if (isLoading) {
    return (
      <Panel>
        <EmptyInline pad>loading…</EmptyInline>
      </Panel>
    )
  }
  const conflicts: ConflictRow[] = rows
    .filter((r) => r.isStale)
    .map((r) => ({
      role: r.meta.label,
      model: r.assignedModel ?? '',
      reason: 'pinned model not in enabled registry',
    }))

  if (conflicts.length === 0) {
    return (
      <Panel>
        <EmptyInline pad>
          {/* TODO: dedicated /api/admin/llm-providers/default-models/conflicts */}
          {/* endpoint — would surface FCA-floor violations, capability mismatches, */}
          {/* and provider-disabled assignments without a client-side rebuild. */}
          no conflicts detected — every role is pinned to an enabled registry model
          (or unset)
        </EmptyInline>
      </Panel>
    )
  }

  const cols: DtCol<ConflictRow>[] = [
    { key: 'role', label: 'Role', className: 'name', render: (r) => r.role },
    { key: 'model', label: 'Pinned Model', className: 'mono', render: (r) => r.model },
    {
      key: 'reason',
      label: 'Reason',
      render: (r) => <span style={{ color: 'var(--err)' }}>{r.reason}</span>,
    },
  ]

  return (
    <Panel>
      <Dt<ConflictRow>
        columns={cols}
        rows={conflicts}
        rowKey={(r) => `${r.role}::${r.model}`}
      />
    </Panel>
  )
}
