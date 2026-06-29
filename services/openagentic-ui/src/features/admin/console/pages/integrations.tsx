/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Integrations domain pages (blueprint §2 — INTEGRATIONS, 3 leaves) at mock
 * fidelity (the admin-console mock invSet slack / ms-teams /
 * integration-logs) and WIRED to the real admin endpoints.
 *
 * Each leaf is a body-only component — PageHead + content, NEVER its own
 * OptionSpec (AdminConsole appends the option-spec inventory = the two-part
 * leaf contract). Every number comes from a live hook or renders an honest
 * "—"; tables render real rows or an honest-empty Banner; no value is
 * fabricated. Every color resolves via a global theme token (var(--*)).
 *
 * Data sources (all real admin routes, mounted under /api/admin):
 *   GET /api/admin/integrations            → integration list (Slack/Teams rows)
 *                                            { integrations:[{ id, name, platform,
 *                                            status, webhook_id, allowed_channels,
 *                                            allowed_workflows, created_at,
 *                                            updated_at }] }  (config/secrets
 *                                            EXCLUDED server-side)
 *   GET /api/admin/integrations/:id/logs   → per-integration delivery log
 *                                            { logs:[{ id, integration_id,
 *                                            direction, platform, channel_id,
 *                                            user_id, message_text, workflow_id,
 *                                            execution_id, status, error,
 *                                            response_data, created_at }],
 *                                            total, limit, offset }
 *
 * STATUS (blueprint §2):
 *   slack            → REAL    (Slack row + binding/settings; secrets masked)
 *   ms-teams         → REAL    (Teams row + tenant connection + settings)
 *   integration-logs → PARTIAL — the integration LIST is REAL; the unified
 *                      delivery feed is composed by fanning the existing per-id
 *                      `/logs` sub-route across every integration row (no
 *                      cross-integration `/logs` rollup exists yet).
 */
import * as React from 'react'
import {
  Banner,
  DataTable,
  FormSection,
  KpiStrip,
  PageHead,
  Pill,
  Section,
  StatusDot,
  Tag,
  type DtColumn,
  type Kpi,
} from '../primitives'
import type { Tone } from '../types'
import { useAdminQuery } from '../../hooks/useAdminQuery'
import type { LeafPageProps } from './registry'
import {
  IntegrationModal,
  type IntegrationEditing,
  type NotifyFn,
} from './IntegrationsDialogs'

/* ============================================================
 * format helpers (honest "—" on missing) — port of flows.tsx's
 * ============================================================ */
function fmtNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(Math.round(n))
}
function relTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const t = d.getTime()
  if (Number.isNaN(t)) return String(ts).slice(0, 16)
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}
function utcStamp(ts: string | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16)
  const z = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())} ` +
    `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
  )
}
/** Stringify an unknown payload so it never renders as a raw object (no React #31). */
function asText(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
function statusTone(s: string | undefined | null): Tone {
  const v = String(s ?? '').toLowerCase()
  if (v === 'active' || v === 'success' || v === 'ok' || v === 'connected') return 'ok'
  if (v === 'error' || v === 'failed' || v === 'failure') return 'err'
  if (v === 'pending' || v === 'inactive' || v === 'disabled') return 'muted'
  return 'muted'
}
function statusLabel(s: string | undefined | null): string {
  const v = String(s ?? '').toLowerCase()
  return v || 'unknown'
}

/* ============================================================
 * shared loading / error helper
 * ============================================================ */
function LoadErr({
  isLoading,
  isError,
  label,
}: {
  isLoading: boolean
  isError: boolean
  label: string
}) {
  if (isError) {
    return (
      <Banner tone="err">
        Failed to load {label}. The endpoint returned an error — no data is shown rather than a
        fabricated value.
      </Banner>
    )
  }
  if (isLoading) {
    return <Banner tone="info">Loading {label}…</Banner>
  }
  return null
}

/* ============================================================
 * row shapes (permissive — mirror the real admin envelopes)
 * ============================================================ */
interface IntegrationRow extends Record<string, unknown> {
  id: string
  name?: string
  platform?: string
  status?: string
  webhook_id?: string | null
  allowed_channels?: string[]
  allowed_workflows?: string[]
  created_at?: string | null
  updated_at?: string | null
}
interface IntegrationsResponse {
  integrations?: IntegrationRow[]
}

interface IntegrationLogRow extends Record<string, unknown> {
  id: string
  integration_id?: string
  direction?: string
  platform?: string
  channel_id?: string | null
  user_id?: string | null
  message_text?: string | null
  workflow_id?: string | null
  execution_id?: string | null
  status?: string
  error?: string | null
  response_data?: unknown
  created_at?: string | null
}
interface IntegrationLogsResponse {
  logs?: IntegrationLogRow[]
  total?: number
  limit?: number
  offset?: number
}

/* ============================================================
 * hooks (no dedicated typed hook exists for integrations)
 * ============================================================ */
function useIntegrations() {
  return useAdminQuery<IntegrationsResponse>(['integrations'], '/api/admin/integrations', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
/** Per-integration delivery log. `enabled` gates the fetch so the composed feed
 *  only fans out across integrations that actually exist. */
function useIntegrationLogs(integrationId: string | undefined, limit = 100) {
  const enabled = Boolean(integrationId)
  return useAdminQuery<IntegrationLogsResponse>(
    ['integration-logs', String(integrationId ?? ''), String(limit)],
    `/api/admin/integrations/${encodeURIComponent(integrationId ?? '')}/logs?limit=${limit}`,
    { staleTime: 15_000, refetchInterval: 30_000, enabled },
  )
}

/** First integration row for a given platform ('slack' | 'teams'). */
function pickPlatform(rows: IntegrationRow[], platform: string): IntegrationRow | undefined {
  return rows.find((r) => String(r.platform ?? '').toLowerCase() === platform)
}

/** Map a list row → the (secret-free) editing shape the write modal expects. */
function toEditing(row: IntegrationRow): IntegrationEditing {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    allowed_channels: row.allowed_channels,
    allowed_workflows: row.allowed_workflows,
  }
}

/** Transient inline status toast — token-only, auto-dismisses (mirrors models.tsx). */
function useNotify(): { node: React.ReactNode; notify: NotifyFn } {
  const [msg, setMsg] = React.useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify: NotifyFn = React.useCallback((tone, text) => {
    setMsg({ tone, text })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 4500)
  }, [])
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const node = msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null
  return { node, notify }
}

/* ============================================================
 * 1. slack · is — Slack connection status + channel binding + settings
 * ============================================================ */
function SlackPage(_props: LeafPageProps) {
  const integ = useIntegrations()
  const rows = integ.data?.integrations ?? []
  const slack = pickPlatform(rows, 'slack')
  const logsQ = useIntegrationLogs(slack?.id, 100)
  const logRows: IntegrationLogRow[] = logsQ.data?.logs ?? []

  const { node: toast, notify } = useNotify()
  const [modal, setModal] = React.useState<{ editing: IntegrationEditing | null } | null>(null)

  const allowed = (slack?.allowed_channels ?? []).filter(Boolean)
  const workflows = (slack?.allowed_workflows ?? []).filter(Boolean)

  // Derive ACTIVE channels + inbound status from the real delivery log
  // (/api/admin/integrations/:id/logs) — the integration is active in channels
  // it actually exchanges events with, not only the (often empty) allow-list.
  const inboundLogs = logRows.filter((l) => String(l.direction) === 'inbound')
  const outboundLogs = logRows.filter((l) => String(l.direction) === 'outbound')
  const chanMap = new Map<string, { count: number; inbound: number; outbound: number; last?: string | null }>()
  for (const l of logRows) {
    const c = l.channel_id || '—'
    const cur = chanMap.get(c) ?? { count: 0, inbound: 0, outbound: 0, last: null }
    cur.count++
    if (String(l.direction) === 'inbound') cur.inbound++
    else if (String(l.direction) === 'outbound') cur.outbound++
    if (l.created_at && (!cur.last || l.created_at > cur.last)) cur.last = l.created_at
    chanMap.set(c, cur)
  }
  const activeChannels = Array.from(chanMap.entries()).filter(([c]) => c !== '—')

  const strip: Kpi[] = [
    {
      label: 'Connection',
      val: slack ? statusLabel(slack.status) : '—',
      tone: slack ? statusTone(slack.status) : 'muted',
      sub: slack?.name ?? undefined,
    },
    {
      label: 'Active channels',
      val: slack ? activeChannels.length : '—',
      tone: activeChannels.length ? 'accent' : 'muted',
      sub: allowed.length ? `${allowed.length} allow-listed` : 'all channels (no allow-list)',
    },
    {
      label: 'Events (last 100)',
      val: slack ? logRows.length : '—',
      unit: logRows.length ? 'msgs' : undefined,
      tone: logRows.length ? 'info' : 'muted',
      sub: slack ? `${inboundLogs.length} in · ${outboundLogs.length} out` : undefined,
    },
    {
      label: 'Inbound webhook',
      val: inboundLogs.length ? 'active' : slack?.webhook_id ? 'configured' : '—',
      tone: inboundLogs.length || slack?.webhook_id ? 'ok' : 'warn',
      sub: inboundLogs.length ? 'receiving events' : workflows.length ? `${workflows.length} bound flows` : undefined,
    },
  ]

  interface ChanRow extends Record<string, unknown> {
    channel: string
    count: number
    inbound: number
    outbound: number
    last?: string | null
  }
  const chanRows: ChanRow[] = activeChannels.map(([channel, s]) => ({
    channel,
    count: s.count,
    inbound: s.inbound,
    outbound: s.outbound,
    last: s.last,
  }))
  const chanCols: DtColumn<ChanRow>[] = [
    {
      label: 'Channel',
      val: (r) => r.channel,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone="ok" />
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>
            {r.channel}
          </span>
          {allowed.includes(r.channel) && <Tag>allow-listed</Tag>}
        </span>
      ),
    },
    { label: 'Events', r: true, val: (r) => r.count, render: (r) => <span className="awc-name">{r.count}</span> },
    { label: 'In / Out', r: true, render: (r) => <Tag>{r.inbound} in · {r.outbound} out</Tag> },
    { label: 'Last event', r: true, render: (r) => <span style={{ color: 'var(--fg-2)' }}>{relTime(r.last)}</span> },
  ]

  const actCols: DtColumn<IntegrationLogRow>[] = [
    {
      label: 'When',
      val: (r) => String(r.created_at ?? ''),
      sortVal: (r) => String(r.created_at ?? ''),
      render: (r) => (
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)', fontSize: 11 }}>
          {relTime(r.created_at)}
        </span>
      ),
    },
    {
      label: 'Dir',
      render: (r) => (
        <Pill tone={String(r.direction) === 'inbound' ? 'info' : 'accent'} dot>
          {String(r.direction ?? '—')}
        </Pill>
      ),
    },
    {
      label: 'Channel',
      render: (r) => <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>{r.channel_id ?? '—'}</span>,
    },
    {
      label: 'User',
      render: (r) => <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>{r.user_id ?? '—'}</span>,
    },
    {
      label: 'Message',
      val: (r) => String(r.message_text ?? ''),
      render: (r) => (
        <span
          style={{
            color: 'var(--fg-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            maxWidth: 360,
          }}
        >
          {String(r.message_text ?? '—').slice(0, 140)}
        </span>
      ),
    },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={String(r.status) === 'success' ? 'ok' : String(r.status) === 'error' ? 'err' : 'muted'} dot>
          {String(r.status ?? '—')}
        </Pill>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Slack"
        sub={
          slack
            ? `workspace connection + channel routing · ${slack.name ?? '—'} · ${statusLabel(slack.status)}`
            : 'workspace connection + channel routing · /api/admin/integrations'
        }
        actions={[
          { label: 'Refresh', ic: '↻ ', onClick: () => integ.refetch() },
          slack
            ? {
                label: 'Edit integration',
                ic: '✎ ',
                primary: true,
                onClick: () => setModal({ editing: toEditing(slack) }),
              }
            : {
                label: 'Add Slack integration',
                ic: '＋ ',
                primary: true,
                onClick: () => setModal({ editing: null }),
              },
        ]}
        mode="editable"
      />
      {toast}
      <LoadErr isLoading={integ.isLoading} isError={integ.isError} label="integrations" />
      {integ.data && !slack && (
        <Banner tone="warn">
          No Slack integration is configured. Connect a Slack workspace to bind channels and run
          inbound events as the linked user — nothing is shown rather than a fabricated connection.
        </Banner>
      )}
      {slack && (
        <>
          <KpiStrip kpis={strip} />
          <Section title="Connection" sub="bot identity + workspace status · secrets are masked server-side" />
          <FormSection
            title="Workspace"
            rows={[
              {
                label: 'Status',
                type: 'badge',
                badge: (
                  <Pill tone={statusTone(slack.status)} dot>
                    {statusLabel(slack.status)}
                  </Pill>
                ),
              },
              { label: 'Integration name', type: 'text', value: slack.name ?? '—', locked: true },
              { label: 'Platform', type: 'text', value: 'slack', locked: true },
              { label: 'Connected', type: 'text', value: utcStamp(slack.created_at), locked: true },
              { label: 'Last updated', type: 'text', value: relTime(slack.updated_at), locked: true },
            ]}
            mode="readonly"
          />
          <Section
            title="Active channels"
            sub="derived from the live delivery log — channels this workspace actually exchanges events with"
          />
          <DataTable<ChanRow>
            cols={chanCols}
            rows={chanRows}
            search="search channels…"
            pageSize={8}
            empty={
              logsQ.isLoading
                ? 'Loading channel activity…'
                : 'No channel activity yet — the bot has not exchanged any events'
            }
          />
          <Section
            title="Recent activity"
            sub="inbound events + slash + outbound posts · /api/admin/integrations/:id/logs (last 100)"
          />
          <LoadErr isLoading={logsQ.isLoading} isError={logsQ.isError} label="delivery log" />
          <DataTable<IntegrationLogRow>
            cols={actCols}
            rows={logRows}
            search="search messages · user · channel…"
            chips={{
              active: 'all',
              opts: [
                { id: 'all', label: 'all', cnt: logRows.length },
                { id: 'inbound', label: 'inbound', cnt: inboundLogs.length },
                { id: 'outbound', label: 'outbound', cnt: outboundLogs.length },
              ],
              filter: (row, chip) => chip === 'all' || String((row as IntegrationLogRow).direction) === chip,
            }}
            pageSize={12}
            empty="No delivery-log events recorded for this integration yet"
          />
          <Section
            title="Settings"
            sub="event + slash URLs and secrets · edit via the write modal (secrets write-only)"
          />
          <Banner tone="info">
            <b>Bot token</b> and <b>signing secret</b> are encrypted at rest and excluded from this
            read — they render as <b>masked</b>, never the plaintext value. Use <b>Edit integration</b>{' '}
            to rotate them (entering a new value replaces the stored credential).
          </Banner>
          <FormSection
            title="Inbound + secrets"
            rows={[
              {
                label: 'Webhook id',
                type: 'text',
                value: slack.webhook_id ?? '— (events arrive via the signed /hooks/slack receiver)',
                locked: true,
                desc: 'inbound event + slash-command receiver id',
              },
              { label: 'Signing secret', type: 'text', value: '•••• masked', locked: true },
              { label: 'Bot token', type: 'text', value: '•••• masked', locked: true },
              {
                label: 'Enabled',
                type: 'toggle',
                value: String(slack.status ?? '').toLowerCase() === 'active',
                locked: true,
              },
            ]}
            mode="readonly"
          />
        </>
      )}
      {modal && (
        <IntegrationModal
          platform="slack"
          editing={modal.editing}
          notify={notify}
          onSaved={() => {
            integ.refetch()
            logsQ.refetch()
          }}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}

/* ============================================================
 * 2. ms-teams · it — Microsoft Teams tenant connection + settings
 * ============================================================ */
function MsTeamsPage(_props: LeafPageProps) {
  const integ = useIntegrations()
  const rows = integ.data?.integrations ?? []
  const teams = pickPlatform(rows, 'teams')
  const channels = (teams?.allowed_channels ?? []).filter(Boolean)
  const workflows = (teams?.allowed_workflows ?? []).filter(Boolean)

  const { node: toast, notify } = useNotify()
  const [modal, setModal] = React.useState<{ editing: IntegrationEditing | null } | null>(null)

  const strip: Kpi[] = [
    {
      label: 'Connection',
      val: teams ? statusLabel(teams.status) : '—',
      tone: teams ? statusTone(teams.status) : 'muted',
      sub: teams?.name ?? undefined,
    },
    {
      label: 'Linked teams / channels',
      val: teams ? channels.length : '—',
      tone: channels.length ? 'accent' : 'muted',
    },
    {
      label: 'Bound workflows',
      val: teams ? workflows.length : '—',
      tone: workflows.length ? 'info' : 'muted',
    },
    {
      label: 'Inbound webhook',
      val: teams?.webhook_id ? 'configured' : '—',
      tone: teams?.webhook_id ? 'ok' : 'warn',
    },
  ]

  interface ChannelRow extends Record<string, unknown> {
    channel: string
  }
  const channelRows: ChannelRow[] = channels.map((c) => ({ channel: c }))
  const channelCols: DtColumn<ChannelRow>[] = [
    {
      label: 'Team / Channel',
      val: (r) => r.channel,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <StatusDot tone="ok" />
          <span className="awc-name" style={{ fontFamily: 'var(--font-v3-mono)' }}>
            {r.channel}
          </span>
        </span>
      ),
    },
    { label: 'Routing', render: () => <Tag>inbound + outbound</Tag> },
  ]

  return (
    <>
      <PageHead
        title="Microsoft Teams"
        sub={
          teams
            ? `tenant connection · ${teams.name ?? '—'} · ${statusLabel(teams.status)}`
            : 'tenant connection · /api/admin/integrations'
        }
        actions={[
          { label: 'Refresh', ic: '↻ ', onClick: () => integ.refetch() },
          teams
            ? {
                label: 'Edit integration',
                ic: '✎ ',
                primary: true,
                onClick: () => setModal({ editing: toEditing(teams) }),
              }
            : {
                label: 'Add Teams integration',
                ic: '＋ ',
                primary: true,
                onClick: () => setModal({ editing: null }),
              },
        ]}
        mode="editable"
      />
      {toast}
      <LoadErr isLoading={integ.isLoading} isError={integ.isError} label="integrations" />
      {integ.data && !teams && (
        <Banner tone="warn">
          No Microsoft Teams integration is configured. Register a Teams app + tenant to enable
          inbound/outbound messaging — nothing is shown rather than a fabricated connection.
        </Banner>
      )}
      {teams && (
        <>
          <KpiStrip kpis={strip} />
          <Section title="Connection" sub="app registration + tenant status · secrets are masked server-side" />
          <FormSection
            title="Tenant"
            rows={[
              {
                label: 'Status',
                type: 'badge',
                badge: (
                  <Pill tone={statusTone(teams.status)} dot>
                    {statusLabel(teams.status)}
                  </Pill>
                ),
              },
              { label: 'Integration name', type: 'text', value: teams.name ?? '—', locked: true },
              { label: 'Platform', type: 'text', value: 'teams', locked: true },
              { label: 'Connected', type: 'text', value: utcStamp(teams.created_at), locked: true },
              { label: 'Last updated', type: 'text', value: relTime(teams.updated_at), locked: true },
            ]}
            mode="readonly"
          />
          <Section title="Linked teams / channels" sub="allowed_channels — inbound + outbound routing" />
          <DataTable<ChannelRow>
            cols={channelCols}
            rows={channelRows}
            search="search teams / channels…"
            pageSize={8}
            empty="No teams or channels linked to this tenant yet"
          />
          <Section title="Settings" sub="app registration + secrets · edit via the write modal (secrets write-only)" />
          <Banner tone="info">
            <b>App id</b> and <b>client secret</b> are encrypted at rest and excluded from this read —
            they render as <b>masked</b>, never the plaintext value. Use <b>Edit integration</b> to
            rotate them (entering new values replaces the stored credentials).
          </Banner>
          <FormSection
            title="App registration + secrets"
            rows={[
              {
                label: 'Webhook id',
                type: 'text',
                value: teams.webhook_id ?? '—',
                locked: true,
                desc: 'inbound message receiver id',
              },
              { label: 'App id (client id)', type: 'text', value: '•••• masked', locked: true },
              { label: 'Client secret', type: 'text', value: '•••• masked', locked: true },
              {
                label: 'Enabled',
                type: 'toggle',
                value: String(teams.status ?? '').toLowerCase() === 'active',
                locked: true,
              },
            ]}
            mode="readonly"
          />
        </>
      )}
      {modal && (
        <IntegrationModal
          platform="teams"
          editing={modal.editing}
          notify={notify}
          onSaved={() => integ.refetch()}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}

/* ============================================================
 * 3. integration-logs · il — unified inbound/outbound delivery feed
 *
 * PARTIAL: no cross-integration `/logs` rollup exists. We compose the
 * unified feed by fanning the existing per-id `/logs` sub-route across every
 * integration row. `IntegrationLogsCollector` renders ONE hook per integration
 * id (stable order over the integration list = rules-of-hooks safe) and lifts
 * its rows to the parent via a key-stable callback so the parent can merge,
 * filter, sort, and render a single DataTable.
 * ============================================================ */

/** Invisible collector — one per integration id; emits that integration's logs. */
function IntegrationLogsCollector({
  integrationId,
  onLogs,
}: {
  integrationId: string
  onLogs: (id: string, logs: IntegrationLogRow[], isError: boolean, isLoading: boolean) => void
}) {
  const q = useIntegrationLogs(integrationId)
  // Report this integration's slice up to the parent whenever it settles.
  React.useEffect(() => {
    onLogs(integrationId, q.data?.logs ?? [], q.isError, q.isLoading)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationId, q.data, q.isError, q.isLoading])
  return null
}

function IntegrationLogsPage(_props: LeafPageProps) {
  const integ = useIntegrations()
  const integrations = integ.data?.integrations ?? []

  // Merge per-integration log slices keyed by integration id (stable identity).
  const [slices, setSlices] = React.useState<
    Record<string, { logs: IntegrationLogRow[]; isError: boolean; isLoading: boolean }>
  >({})
  const handleLogs = React.useCallback(
    (id: string, logs: IntegrationLogRow[], isError: boolean, isLoading: boolean) => {
      setSlices((prev) => {
        const cur = prev[id]
        if (cur && cur.isError === isError && cur.isLoading === isLoading && cur.logs === logs) {
          return prev
        }
        return { ...prev, [id]: { logs, isError, isLoading } }
      })
    },
    [],
  )

  const [openId, setOpenId] = React.useState<string | null>(null)

  // Platform label by integration id (logs carry their own platform too).
  const platformById = React.useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of integrations) m[r.id] = String(r.platform ?? '').toLowerCase()
    return m
  }, [integrations])

  const allLogs: IntegrationLogRow[] = React.useMemo(() => {
    const merged: IntegrationLogRow[] = []
    for (const id of Object.keys(slices)) merged.push(...slices[id].logs)
    merged.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    return merged
  }, [slices])

  const open = allLogs.find((r) => r.id === openId) ?? null
  const anySliceLoading = Object.values(slices).some((s) => s.isLoading)
  const anySliceError = Object.values(slices).some((s) => s.isError)

  const platformOf = (r: IntegrationLogRow): string =>
    String(r.platform ?? platformById[String(r.integration_id ?? '')] ?? '').toLowerCase()
  const directionOf = (r: IntegrationLogRow): string => String(r.direction ?? '').toLowerCase()

  const logStatusTone = (s: string | undefined | null): Tone => {
    const v = String(s ?? '').toLowerCase()
    if (v === 'success') return 'ok'
    if (v === 'error') return 'err'
    if (v === 'pending') return 'warn'
    return 'muted'
  }

  const strip: Kpi[] = [
    {
      label: 'Events',
      val: integ.data ? fmtNum(allLogs.length) : '—',
      tone: 'accent',
      sub: `${integrations.length} integration${integrations.length === 1 ? '' : 's'}`,
    },
    {
      label: 'Inbound',
      val: integ.data ? allLogs.filter((r) => directionOf(r) === 'inbound').length : '—',
      tone: 'info',
    },
    {
      label: 'Outbound',
      val: integ.data ? allLogs.filter((r) => directionOf(r) === 'outbound').length : '—',
      tone: 'info',
    },
    {
      label: 'Errors',
      val: integ.data ? allLogs.filter((r) => String(r.status ?? '').toLowerCase() === 'error').length : '—',
      tone: allLogs.some((r) => String(r.status ?? '').toLowerCase() === 'error') ? 'err' : 'ok',
    },
  ]

  const cols: DtColumn<IntegrationLogRow>[] = [
    {
      label: 'When',
      val: (r) => relTime(r.created_at),
      sortVal: (r) => String(r.created_at ?? ''),
    },
    {
      label: 'Integration',
      val: (r) => platformOf(r) || '—',
      render: (r) => <Tag>{platformOf(r) || '—'}</Tag>,
    },
    {
      label: 'Direction',
      render: (r) => (
        <Pill tone={directionOf(r) === 'inbound' ? 'info' : 'accent'} dot>
          {directionOf(r) || '—'}
        </Pill>
      ),
    },
    {
      label: 'Event',
      val: (r) => r.channel_id ?? r.workflow_id ?? r.message_text ?? '—',
      render: (r) => (
        <span>
          <span className="awc-name">
            {r.channel_id ? `#${r.channel_id}` : r.workflow_id ? 'workflow' : 'message'}
          </span>
          {(r.message_text || r.workflow_id) && (
            <div
              style={{
                fontSize: 10.5,
                color: 'var(--fg-3)',
                fontFamily: 'var(--font-v3-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 280,
              }}
            >
              {r.workflow_id ? `wf ${String(r.workflow_id).slice(0, 12)}` : String(r.message_text).slice(0, 60)}
            </div>
          )}
        </span>
      ),
    },
    {
      label: 'Status',
      render: (r) => (
        <Pill tone={logStatusTone(r.status)} dot>
          {String(r.status ?? '—')}
        </Pill>
      ),
    },
    {
      label: 'Payload',
      val: (r) => String(r.id).slice(0, 8),
      render: (r) => (
        <span style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          {String(r.id).slice(0, 8)}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHead
        title="Integration Logs"
        sub="inbound / outbound event trail · composed across /api/admin/integrations/:id/logs"
        actions={[{ label: 'Export CSV', ic: '⤓ ' }]}
        mode="readonly"
      />

      {/* Invisible per-integration collectors — one hook each, stable order. */}
      {integrations.map((r) => (
        <IntegrationLogsCollector key={r.id} integrationId={r.id} onLogs={handleLogs} />
      ))}

      <Banner tone="info">
        This feed is <b>composed</b>: there is no cross-integration <b>/logs</b> rollup yet
        (blueprint PARTIAL), so the unified trail is built by fanning the per-integration{' '}
        <b>/logs</b> sub-route. Rows are real; an additive <b>admin-integrations /logs</b> rollup
        route would let the table page server-side.
      </Banner>

      <LoadErr isLoading={integ.isLoading} isError={integ.isError} label="integrations" />
      {integ.data && integrations.length === 0 && (
        <Banner tone="warn">
          No integrations are configured — there is no delivery trail to show. Connect Slack or Teams
          to populate this log.
        </Banner>
      )}
      {anySliceError && (
        <Banner tone="warn">
          One or more per-integration log reads errored — only the integrations that returned are
          merged below, never a fabricated row.
        </Banner>
      )}

      {integ.data && integrations.length > 0 && (
        <>
          <KpiStrip kpis={strip} />
          <Section
            title="Delivery trail"
            sub={anySliceLoading ? 'loading per-integration logs…' : `${allLogs.length} events merged`}
            right={
              <Pill tone="ok" dot>
                live
              </Pill>
            }
          />
          <DataTable<IntegrationLogRow>
            cols={cols}
            rows={allLogs}
            onRow={(r) => setOpenId(r.id)}
            search="search events · integration · channel · workflow · status…"
            chips={{
              active: 'all',
              opts: [
                { id: 'all', label: 'all', cnt: allLogs.length },
                { id: 'slack', label: 'slack', cnt: allLogs.filter((r) => platformOf(r) === 'slack').length },
                { id: 'teams', label: 'teams', cnt: allLogs.filter((r) => platformOf(r) === 'teams').length },
                { id: 'inbound', label: 'inbound', cnt: allLogs.filter((r) => directionOf(r) === 'inbound').length },
                { id: 'outbound', label: 'outbound', cnt: allLogs.filter((r) => directionOf(r) === 'outbound').length },
                { id: 'error', label: 'errors', cnt: allLogs.filter((r) => String(r.status ?? '').toLowerCase() === 'error').length },
              ],
              filter: (row, chip) => {
                const r = row as IntegrationLogRow
                if (chip === 'all') return true
                if (chip === 'inbound' || chip === 'outbound') return directionOf(r) === chip
                if (chip === 'error') return String(r.status ?? '').toLowerCase() === 'error'
                return platformOf(r) === chip
              },
            }}
            pageSize={12}
            empty="No integration events recorded"
          />
          {open && (
            <Section
              title={`Event ${String(open.id).slice(0, 12)}`}
              sub={`${platformOf(open) || '—'} · ${directionOf(open) || '—'}`}
              right={
                <button className="awc-btn awc-sm awc-ghost" onClick={() => setOpenId(null)}>
                  close
                </button>
              }
            >
              <FormSection
                title="Event"
                rows={[
                  {
                    label: 'Status',
                    type: 'badge',
                    badge: (
                      <Pill tone={logStatusTone(open.status)} dot>
                        {String(open.status ?? '—')}
                      </Pill>
                    ),
                  },
                  { label: 'Integration', type: 'text', value: platformOf(open) || '—', locked: true },
                  { label: 'Direction', type: 'text', value: directionOf(open) || '—', locked: true },
                  { label: 'Channel', type: 'text', value: open.channel_id ?? '—', locked: true },
                  { label: 'User', type: 'text', value: open.user_id ?? '—', locked: true },
                  { label: 'Workflow', type: 'text', value: open.workflow_id ?? '—', locked: true },
                  { label: 'Execution', type: 'text', value: open.execution_id ?? '—', locked: true },
                  { label: 'When', type: 'text', value: utcStamp(open.created_at), locked: true },
                  ...(open.message_text
                    ? [{ label: 'Message', type: 'textarea' as const, value: String(open.message_text), locked: true }]
                    : []),
                  ...(open.error
                    ? [{ label: 'Error', type: 'textarea' as const, value: asText(open.error), locked: true }]
                    : []),
                  { label: 'Raw payload', type: 'textarea', value: asText(open.response_data), locked: true },
                ]}
                mode="readonly"
              />
            </Section>
          )}
        </>
      )}
    </>
  )
}

/* ============================================================
 * exports — all 3 Integrations leaf ids → page component
 * ============================================================ */
export const integrationsPages: Record<string, React.ComponentType<LeafPageProps>> = {
  slack: SlackPage,
  'ms-teams': MsTeamsPage,
  'integration-logs': IntegrationLogsPage,
}
