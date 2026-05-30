import * as React from 'react'
import {
  Panel,
  PanelHead,
  Banner,
  EmptyInline,
  StatusDot,
  FormGrid,
  FormRow,
  LockedTag,
  Dt,
  type DtCol,
  SectionBar,
  Btn,
} from '../../primitives-v3'
import {
  type IntegrationRow,
  type TeamsConfigShape,
  fmtRelative,
  integrationStatusDot,
  maskSecret,
} from './types'

export interface MsTeamsPaneProps {
  rows: IntegrationRow[]
  isLoading: boolean
  isError: boolean
  onEditChannels?: (r: IntegrationRow) => void
  onDisconnect?: (r: IntegrationRow) => void
  actionBusy?: string | null
}

export const MsTeamsPane: React.FC<MsTeamsPaneProps> = ({
  rows,
  isLoading,
  isError,
  onEditChannels,
  onDisconnect,
  actionBusy,
}) => {
  if (isError) {
    return (
      <Banner level="err" label="error">
        failed to load <span className="accent">/api/admin/integrations</span>
      </Banner>
    )
  }
  if (isLoading) {
    return <EmptyInline pad>loading /api/admin/integrations…</EmptyInline>
  }
  if (rows.length === 0) {
    return (
      <Panel>
        <PanelHead title="microsoft teams integrations" count={0} />
        <EmptyInline pad>
          no Microsoft Teams integrations registered. Use the v2 view (
          <span className="accent">?v3=0</span>) to add one.
        </EmptyInline>
      </Panel>
    )
  }

  return (
    <>
      <Banner level="info" label="read-only">
        Bot Framework OAuth + webhook config rendered from{' '}
        <span className="accent">/api/admin/integrations</span>. Secrets are
        omitted from the list response by design.
      </Banner>
      {rows.map((row) => (
        <TeamsIntegrationCard
          key={row.id}
          row={row}
          onEditChannels={onEditChannels}
          onDisconnect={onDisconnect}
          actionBusy={actionBusy}
        />
      ))}
    </>
  )
}

// ============================================================
// Single-integration card
// ============================================================
function TeamsIntegrationCard({
  row,
  onEditChannels,
  onDisconnect,
  actionBusy,
}: {
  row: IntegrationRow
  onEditChannels?: (r: IntegrationRow) => void
  onDisconnect?: (r: IntegrationRow) => void
  actionBusy?: string | null
}) {
  const cfg = (row.config ?? {}) as TeamsConfigShape

  const channelCols: DtCol<string>[] = [
    {
      key: 'channel',
      label: 'CHANNEL',
      className: 'mono',
      render: (c) => <span style={{ color: 'var(--fg-1)' }}>{c}</span>,
    },
  ]
  const workflowCols: DtCol<string>[] = [
    {
      key: 'workflow',
      label: 'WORKFLOW ID',
      className: 'mono',
      render: (w) => <span style={{ color: 'var(--fg-1)' }}>{w}</span>,
    },
  ]

  return (
    <>
      <SectionBar
        title={row.name}
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusDot status={integrationStatusDot(row.status)} />
            <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>{row.status}</span>
            {onEditChannels && (
              <Btn variant="ghost" onClick={() => onEditChannels(row)}>
                edit channels
              </Btn>
            )}
            {onDisconnect && (
              <Btn
                variant="ghost"
                disabled={actionBusy === `int-del-${row.id}`}
                onClick={() => onDisconnect(row)}
              >
                {actionBusy === `int-del-${row.id}` ? '…' : 'disconnect'}
              </Btn>
            )}
          </span>
        }
      />
      <Panel>
        <PanelHead
          title="oauth + webhook config"
          right={
            <span
              style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}
            >
              last activity {fmtRelative(row.lastActivity)}
            </span>
          }
        />
        <FormGrid>
          <FormRow
            name="Bot App ID"
            desc="Microsoft App registration identifier"
            configKey="config.appId"
            status={<LockedTag />}
          >
            <span style={{ fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-1)' }}>
              {cfg.appId ?? <em style={{ color: 'var(--fg-3)' }}>unset</em>}
            </span>
          </FormRow>
          <FormRow
            name="Bot App Password"
            desc="Client secret used for Bot Framework auth"
            configKey="config.appPassword"
            status={<LockedTag />}
          >
            <span style={{ fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-1)' }}>
              {cfg.appPassword ? maskSecret(String(cfg.appPassword)) : <em style={{ color: 'var(--fg-3)' }}>not exposed</em>}
            </span>
          </FormRow>
          <FormRow
            name="Tenant ID"
            desc="Azure AD tenant the bot is registered in"
            configKey="config.tenantId"
            status={<LockedTag />}
          >
            <span style={{ fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-1)' }}>
              {cfg.tenantId ?? <em style={{ color: 'var(--fg-3)' }}>unset</em>}
            </span>
          </FormRow>
          <FormRow
            name="Inbound webhook"
            desc="Bot Framework posts events here"
            configKey="webhookUrl"
            status={<LockedTag />}
          >
            <span style={{ fontFamily: 'var(--font-v3-mono)', color: 'var(--fg-1)', wordBreak: 'break-all' }}>
              {row.webhookUrl}
            </span>
          </FormRow>
        </FormGrid>
      </Panel>

      <Panel>
        <PanelHead
          title="connected channels"
          count={row.channelCount ?? row.channels.length}
        />
        {row.channels.length === 0 ? (
          <EmptyInline pad>no channels bound to this integration.</EmptyInline>
        ) : (
          <Dt columns={channelCols} rows={row.channels} rowKey={(c, i) => `${row.id}:${c}:${i}`} />
        )}
      </Panel>

      <Panel>
        <PanelHead
          title="bound workflows"
          count={row.workflowCount ?? row.workflowIds.length}
        />
        {row.workflowIds.length === 0 ? (
          <EmptyInline pad>no workflows bound to this integration.</EmptyInline>
        ) : (
          <Dt columns={workflowCols} rows={row.workflowIds} rowKey={(w, i) => `${row.id}:${w}:${i}`} />
        )}
      </Panel>
    </>
  )
}

export default MsTeamsPane
