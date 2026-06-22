import * as React from 'react'
import {
  Panel,
  Dt,
  type DtCol,
  EmptyInline,
} from '../../primitives-v3'
import { type ModelRow } from './types'

export interface CapabilitiesPaneProps {
  rows: ModelRow[]
  isLoading: boolean
}

const CAP_COLS: Array<{ key: keyof ModelRow['caps']; label: string }> = [
  { key: 'chat', label: 'chat' },
  { key: 'tools', label: 'tools' },
  { key: 'vision', label: 'vision' },
  { key: 'embeddings', label: 'embed' },
  { key: 'streaming', label: 'stream' },
  { key: 'thinking', label: 'think' },
  { key: 'imageGeneration', label: 'image-gen' },
]

const Tick: React.FC<{ on: boolean }> = ({ on }) =>
  on ? (
    <span style={{ color: 'var(--ok)' }}>✓</span>
  ) : (
    <span style={{ color: 'var(--fg-3)' }}>·</span>
  )

export const CapabilitiesPane: React.FC<CapabilitiesPaneProps> = ({ rows, isLoading }) => {
  const cols: DtCol<ModelRow>[] = [
    {
      key: 'model',
      label: 'Model',
      className: 'name',
      render: (r) => (
        <>
          {r.model}
          <span className="sub mono"> {r.providerDisplay}</span>
        </>
      ),
    },
    ...CAP_COLS.map<DtCol<ModelRow>>((c) => ({
      key: c.key as string,
      label: c.label,
      width: '70px',
      align: 'right',
      render: (r) => <Tick on={r.caps[c.key]} />,
    })),
  ]

  return (
    <Panel>
      {isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : rows.length === 0 ? (
        <EmptyInline pad>no models in registry</EmptyInline>
      ) : (
        <Dt<ModelRow>
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
        />
      )}
    </Panel>
  )
}
