import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  EmptyInline,
} from '../primitives-v3'
import {
  TABS,
  TAB_ORDER,
  leafToTab,
  fmtNum,
  type IntegrationsHubTab,
  type IntegrationPlatform,
  type IntegrationRow,
} from './integrations/types'
import {
  useIntegrationsList,
  useAllIntegrationLogs,
} from './integrations/hooks'
import { SlackPane } from './integrations/SlackPane'
import { MsTeamsPane } from './integrations/MsTeamsPane'
import { LogsPane } from './integrations/LogsPane'
import {
  IntegrationModal,
  type IntegrationModalMode,
  type IntegrationConnectPayload,
  type IntegrationEditChannelsPayload,
} from './integrations/IntegrationModal'
import { apiRequest } from '@/utils/api'
import { useQueryClient } from '@tanstack/react-query'

export interface IntegrationsHubPageProps {
  /** Sub-tab to land on. Mapped from leaf id by AdminPortalHostV3. */
  initialTab?: IntegrationsHubTab | string
}

export const IntegrationsHubPage: React.FC<IntegrationsHubPageProps> = ({ initialTab }) => {
  const safeInitial = leafToTab(initialTab as string | undefined)
  const [tab, setTab] = React.useState<IntegrationsHubTab>(safeInitial)
  const [toast, setToast] = React.useState<{ level: 'ok' | 'err' | 'info'; msg: string } | null>(null)
  const [modal, setModal] = React.useState<{
    open: boolean
    mode: IntegrationModalMode
    initial: IntegrationRow | null
    initialPlatform?: IntegrationPlatform
  }>({ open: false, mode: 'connect', initial: null })
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [actionBusy, setActionBusy] = React.useState<string | null>(null)

  // Honor leaf-driven re-mounts.
  React.useEffect(() => {
    setTab(leafToTab(initialTab as string | undefined))
  }, [initialTab])

  // OAuth popup completion — the callback page postMessages a
  // { type: 'oauth-callback', success, platform, error?, integrationId? }
  // payload back to its opener (this window). On success, refetch the list
  // so the new row appears; on failure, surface the error as a toast.
  const queryClient = useQueryClient()
  React.useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data
      if (!data || typeof data !== 'object' || data.type !== 'oauth-callback') return
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['integrations'] })
        setToast({ level: 'ok', msg: `${data.platform ?? 'integration'} connected` })
        window.setTimeout(() => setToast(null), 4000)
      } else {
        setToast({ level: 'err', msg: `OAuth failed: ${data.error ?? 'unknown error'}` })
        window.setTimeout(() => setToast(null), 6000)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [queryClient])

  const integrationsQ = useIntegrationsList()
  const integrations = integrationsQ.data?.integrations ?? []
  const slackRows = integrations.filter((i) => i.platform === 'slack')
  const teamsRows = integrations.filter((i) => i.platform === 'teams')

  const showToast = React.useCallback((level: 'ok' | 'err' | 'info', msg: string) => {
    setToast({ level, msg })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  const tryOauthStart = React.useCallback(
    async (platform: IntegrationPlatform) => {
      // Try the OAuth start endpoint in a popup. The server returns 503
      // with { missingEnv } when SLACK_CLIENT_ID / MICROSOFT_TEAMS_CLIENT_ID
      // is not set on the api pod — in that case fall back to the
      // credentials-paste modal and tell the operator why.
      // Slack uses "slack"; ms-teams platform uses "ms-teams" on the api.
      const platformParam = platform === 'teams' ? 'ms-teams' : platform
      try {
        const resp = await apiRequest(`/api/admin/integrations/${platformParam}/oauth-start`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        if (resp.ok) {
          const body = await resp.json().catch(() => null)
          const url = body?.authorize_url ?? body?.url
          if (url) {
            window.open(url, `oauth-${platform}`, 'width=720,height=820')
            showToast('info', `${platform} OAuth opened in popup`)
            return
          }
        } else if (resp.status === 503) {
          const body = await resp.json().catch(() => null)
          if (body?.missingEnv) {
            showToast('info', `${body.missingEnv} not set on api pod — use manual credentials`)
          }
        }
      } catch {
        // fall through to manual modal
      }
      setError(null)
      setModal({ open: true, mode: 'connect', initial: null, initialPlatform: platform })
    },
    [showToast],
  )

  const onConnect = React.useCallback(
    async (payload: IntegrationConnectPayload) => {
      setBusy(true)
      setError(null)
      try {
        const resp = await apiRequest('/api/admin/integrations', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`POST failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `${payload.platform} integration "${payload.name}" connected`)
        setModal({ open: false, mode: 'connect', initial: null })
        integrationsQ.refetch?.()
      } catch (err: any) {
        setError(err?.message ?? 'connect failed')
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onEditChannels = React.useCallback(
    async (payload: IntegrationEditChannelsPayload) => {
      setBusy(true)
      setError(null)
      try {
        const resp = await apiRequest(`/api/admin/integrations/${encodeURIComponent(payload.id)}`, {
          method: 'PUT',
          body: JSON.stringify({
            allowed_channels: payload.allowed_channels,
            allowed_workflows: payload.allowed_workflows,
            ...(payload.name && { name: payload.name }),
          }),
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`PUT failed: ${resp.status} ${txt}`)
        }
        showToast('ok', 'channel mapping saved')
        setModal({ open: false, mode: 'connect', initial: null })
        integrationsQ.refetch?.()
      } catch (err: any) {
        setError(err?.message ?? 'save failed')
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  const onDisconnect = React.useCallback(
    async (row: IntegrationRow) => {
      if (!confirm(`Disconnect "${row.name}"? Inbound webhooks will stop firing.`)) return
      setActionBusy(`int-del-${row.id}`)
      try {
        const resp = await apiRequest(`/api/admin/integrations/${encodeURIComponent(row.id)}`, {
          method: 'DELETE',
        })
        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`DELETE failed: ${resp.status} ${txt}`)
        }
        showToast('ok', `disconnected "${row.name}"`)
        integrationsQ.refetch?.()
      } catch (err: any) {
        showToast('err', err?.message ?? 'disconnect failed')
      } finally {
        setActionBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast],
  )

  // Logs tab fans out per-integration log calls. Lift this into the hub
  // even when the tab isn't open so React Query can warm the cache for
  // the operator's first click; the hooks file gates fetches on the
  // existence of an integration list, so this is cheap when empty.
  const logsResult = useAllIntegrationLogs(integrations)

  const totalCount = integrations.length
  const activeCount = integrations.filter((i) => i.status === 'active').length
  const messagesToday = integrationsQ.data?.messagesToday ?? null
  const workflowsTriggered = integrationsQ.data?.workflowsTriggered ?? null

  const metaLine = integrationsQ.isLoading
    ? 'loading…'
    : `${totalCount} integration${totalCount === 1 ? '' : 's'} · ${activeCount} active`

  const onRefresh = () => {
    integrationsQ.refetch?.()
    logsResult.refetch()
  }

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? "Integrations"}
        meta={metaLine}
        actions={
          <>
            <Btn variant="ghost" onClick={onRefresh}>
              refresh
            </Btn>
            {tab === 'slack' && (
              <Btn variant="primary" onClick={() => void tryOauthStart('slack')}>
                + connect Slack
              </Btn>
            )}
            {tab === 'ms-teams' && (
              <Btn variant="primary" onClick={() => void tryOauthStart('teams')}>
                + connect Teams
              </Btn>
            )}
            {tab === 'logs' && (
              <Btn
                variant="primary"
                onClick={() => {
                  setError(null)
                  setModal({ open: true, mode: 'connect', initial: null, initialPlatform: 'slack' })
                }}
              >
                + connect
              </Btn>
            )}
          </>
        }
      />
      <Subtabs items={TABS} active={tab} onChange={(id) => setTab(id as IntegrationsHubTab)} />

      {toast && (
        <Banner level={toast.level} label={toast.level === 'err' ? 'error' : toast.level === 'ok' ? 'ok' : 'info'}>
          {toast.msg}
        </Banner>
      )}
      {integrationsQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/integrations</span>
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="total integrations"
          value={integrationsQ.isLoading ? '…' : String(totalCount)}
          sub={`${slackRows.length} slack · ${teamsRows.length} teams`}
        />
        <Kpi
          label="active"
          value={integrationsQ.isLoading ? '…' : String(activeCount)}
          sub={
            totalCount === 0
              ? 'none registered'
              : `${Math.round((activeCount / totalCount) * 100)}% of total`
          }
          tone={activeCount > 0 ? 'ok' : 'default'}
        />
        <Kpi
          label="messages today"
          value={integrationsQ.isLoading ? '…' : fmtNum(messagesToday)}
          sub="inbound + outbound · 24h"
        />
        <Kpi
          label="workflows triggered"
          value={integrationsQ.isLoading ? '…' : fmtNum(workflowsTriggered)}
          sub="from inbound integration events · 24h"
        />
      </KpiGrid>

      {tab === 'slack' && (
        <SlackPane
          rows={slackRows}
          isLoading={integrationsQ.isLoading}
          isError={integrationsQ.isError}
          onEditChannels={(r) => {
            setError(null)
            setModal({ open: true, mode: 'edit-channels', initial: r })
          }}
          onDisconnect={onDisconnect}
          actionBusy={actionBusy}
        />
      )}
      {tab === 'ms-teams' && (
        <MsTeamsPane
          rows={teamsRows}
          isLoading={integrationsQ.isLoading}
          isError={integrationsQ.isError}
          onEditChannels={(r) => {
            setError(null)
            setModal({ open: true, mode: 'edit-channels', initial: r })
          }}
          onDisconnect={onDisconnect}
          actionBusy={actionBusy}
        />
      )}
      {tab === 'logs' && (
        <LogsPane
          logs={logsResult.logs}
          isLoading={logsResult.isLoading || integrationsQ.isLoading}
          isError={logsResult.isError}
        />
      )}
      {!TAB_ORDER.includes(tab) && (
        <EmptyInline pad>unknown sub-tab: {String(tab)}</EmptyInline>
      )}

      <IntegrationModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.initial}
        initialPlatform={modal.initialPlatform}
        onClose={() => setModal({ open: false, mode: 'connect', initial: null })}
        onConnect={onConnect}
        onEditChannels={onEditChannels}
        isSubmitting={busy}
        error={error}
      />
    </>
  )
}

export default IntegrationsHubPage
