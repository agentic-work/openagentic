import * as React from 'react'
import { Panel, PanelHead, Dt, type DtCol, EmptyInline } from '../../primitives-v3'
import { type ProviderRow, CapPill } from './types'

interface ModelRow {
  modelId: string
  providerName: string
  providerType: string
  capabilities: { chat?: boolean; embeddings?: boolean; tools?: boolean; vision?: boolean }
  maxTokens?: number
  enabled: boolean
}

export interface ModelsPaneProps {
  rows: ProviderRow[]
  isLoading: boolean
}

export const ModelsPane: React.FC<ModelsPaneProps> = ({ rows, isLoading }) => {
  const flat: ModelRow[] = React.useMemo(() => {
    const out: ModelRow[] = []
    for (const r of rows) {
      const provCaps = r.raw.capabilities ?? {}
      for (const m of r.raw.models ?? []) {
        out.push({
          modelId: m.id,
          providerName: r.displayName,
          providerType: r.type,
          capabilities: m.capabilities ?? {
            chat: provCaps.chat,
            embeddings: provCaps.embeddings,
            tools: provCaps.tools,
            vision: provCaps.vision,
          },
          maxTokens: m.maxTokens,
          enabled: r.enabled,
        })
      }
    }
    return out
  }, [rows])

  const cols: DtCol<ModelRow>[] = [
    { key: 'model', label: 'Model', className: 'mono', render: (r) => r.modelId },
    {
      key: 'provider',
      label: 'Provider',
      className: 'name',
      render: (r) => <>{r.providerName}<span className="sub mono"> {r.providerType}</span></>,
    },
    {
      key: 'caps',
      label: 'Capabilities',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {r.capabilities.chat && <CapPill tone="accent">chat</CapPill>}
          {r.capabilities.tools && <CapPill tone="ok">tools</CapPill>}
          {r.capabilities.vision && <CapPill tone="warn">vision</CapPill>}
          {r.capabilities.embeddings && <CapPill tone="info">embed</CapPill>}
        </span>
      ),
    },
    {
      key: 'maxTokens',
      label: 'Max Tokens',
      width: '110px',
      className: 'num',
      align: 'right',
      render: (r) => (r.maxTokens != null ? r.maxTokens.toLocaleString() : '—'),
    },
    {
      key: 'enabled',
      label: 'Enabled',
      width: '80px',
      render: (r) => (
        <span style={{ color: r.enabled ? 'var(--ok)' : 'var(--fg-3)' }}>
          {r.enabled ? 'yes' : 'no'}
        </span>
      ),
    },
  ]

  return (
    <Panel>
      <PanelHead
        title="Models"
        count={`${flat.length} across ${rows.length} provider${rows.length === 1 ? '' : 's'}`}
      />
      {isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : flat.length === 0 ? (
        <EmptyInline pad>
          no models registered — providers expose models when their seed
          rows include a non-empty <span className="accent">models[]</span> array
        </EmptyInline>
      ) : (
        <Dt<ModelRow>
          columns={cols}
          rows={flat}
          rowKey={(r) => `${r.providerName}::${r.modelId}`}
          rowDataAttrs={(r) => ({
            'provider-type': (r.providerType || '').toLowerCase(),
            status: r.enabled === false ? 'idle' : 'ok',
          })}
        />
      )}
    </Panel>
  )
}
