import * as React from 'react'
import {
  Banner,
  Btn,
  Dt,
  type DtCol,
  EmptyInline,
  Kpi,
  KpiGrid,
  Panel,
  PanelHead,
  SectionBar,
  StatusDot,
  Toggle,
  type Status,
} from '../../primitives-v3'
import { useAdminQuery, useAdminMutation } from '../../hooks/useAdminQuery'
import {
  EditWebhookEndpointModal,
  type PlatformAllowlistDraft,
} from './EditWebhookEndpointModal'

interface WebhookTestResult {
  success: boolean
  valid: boolean
  matched: string | null
  provided: string | null
  computed: {
    bare: string
    github: string
    slack_v0: string | null
    stripe_v1: string
  }
  payloadBytes: number
  secretLength: number
  timestampUsed: string | null
  message: string
}

// I-4 (2026-05-07): operator-driven HMAC test harness. Operator pastes the
// raw payload + shared secret + (optional) signature their sender produced
// + (optional) timestamp for slack-v0 basestring; we compute every supported
// signature format and report which one matches (or just show the computed
// values for paste-compare diagnostics).
const WebhookTestPanel: React.FC = () => {
  const [payload, setPayload] = React.useState(
    '{"event":"ping","timestamp":"2026-05-07T00:00:00Z"}',
  )
  const [secret, setSecret] = React.useState('')
  const [signature, setSignature] = React.useState('')
  const [timestamp, setTimestamp] = React.useState('')

  const test = useAdminMutation<WebhookTestResult, {
    payload: string
    secret: string
    signature?: string
    timestamp?: string
  }>('/api/admin/webhook-security/test', { method: 'POST' })

  const result = test.data
  const canRun = payload.trim().length > 0 && secret.trim().length > 0

  return (
    <>
      <SectionBar title="hmac test harness" />
      <Panel>
        <PanelHead title="verify a signature" />
        <div style={{ padding: 12, display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg-2)' }}>
            <span>payload (raw body the sender HMAC'd)</span>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={5}
              style={{
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 12,
                padding: 8,
                background: 'var(--bg-0)',
                border: '1px solid var(--line-1)',
                color: 'var(--fg-0)',
              }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg-2)' }}>
            <span>shared secret</span>
            <input
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="paste the same secret your sender uses"
              style={{
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 12,
                padding: '6px 8px',
                background: 'var(--bg-0)',
                border: '1px solid var(--line-1)',
                color: 'var(--fg-0)',
              }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg-2)' }}>
            <span>provided signature (optional — to compare)</span>
            <input
              type="text"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="sha256=… / v0=… / v1=… / bare hex"
              style={{
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 12,
                padding: '6px 8px',
                background: 'var(--bg-0)',
                border: '1px solid var(--line-1)',
                color: 'var(--fg-0)',
              }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--fg-2)' }}>
            <span>timestamp (optional, used for Slack v0 basestring)</span>
            <input
              type="text"
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
              placeholder="unix seconds, e.g. 1736251200"
              style={{
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 12,
                padding: '6px 8px',
                background: 'var(--bg-0)',
                border: '1px solid var(--line-1)',
                color: 'var(--fg-0)',
              }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn
              variant="primary"
              disabled={!canRun || test.isPending}
              onClick={() =>
                test.mutate({
                  payload,
                  secret,
                  signature: signature.trim() || undefined,
                  timestamp: timestamp.trim() || undefined,
                })
              }
            >
              {test.isPending ? 'testing…' : 'compute + verify'}
            </Btn>
            {test.isError && (
              <span style={{ color: 'var(--err)', fontSize: 12 }}>
                {String(test.error?.message ?? 'request failed')}
              </span>
            )}
          </div>

          {result && (
            <div
              style={{
                marginTop: 4,
                padding: 12,
                background: 'var(--bg-1)',
                border: `1px solid ${result.valid ? 'var(--ok)' : signature ? 'var(--err)' : 'var(--line-1)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <StatusDot status={result.valid ? 'ok' : signature ? 'err' : 'idle' as Status} />
                <strong style={{ fontSize: 13, color: 'var(--fg-0)' }}>
                  {result.valid ? `match: ${result.matched}` : signature ? 'no match' : 'computed (no signature provided)'}
                </strong>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  {result.payloadBytes} bytes · secret len {result.secretLength}
                  {result.timestampUsed ? ` · ts ${result.timestampUsed}` : ''}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-v3-mono)', fontSize: 11, lineHeight: 1.6, color: 'var(--fg-1)', wordBreak: 'break-all' }}>
                <div><span style={{ color: 'var(--fg-3)' }}>bare      </span>{result.computed.bare}</div>
                <div><span style={{ color: 'var(--fg-3)' }}>github    </span>{result.computed.github}</div>
                <div><span style={{ color: 'var(--fg-3)' }}>stripe_v1 </span>{result.computed.stripe_v1}</div>
                {result.computed.slack_v0 && (
                  <div><span style={{ color: 'var(--fg-3)' }}>slack_v0  </span>{result.computed.slack_v0}</div>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--fg-3)' }}>
                {result.message}
              </div>
            </div>
          )}
        </div>
      </Panel>
    </>
  )
}

interface PlatformAllowlist {
  enabled?: boolean
  cidrs?: string[]
  signatureHeader?: string
  description?: string
}

interface WebhookSecurityConfig {
  globalEnabled?: boolean
  promptInjectionScanEnabled?: boolean
  dlpScanEnabled?: boolean
  requireHmacGlobal?: boolean
  platformAllowlists?: Record<string, PlatformAllowlist>
}

interface WebhookStats {
  summary?: {
    totalRequests?: number
    accepted?: number
    rejected?: number
    rejectionRate?: string
  }
  byPlatform?: Array<{ platform: string; count: number }>
  topRejections?: Array<{ rejection_reason: string; count: number }>
  injectionStats?: {
    scanned?: number
    detected?: number
    avg_score?: number
    max_score?: number
  }
}

interface AuditLogEntry {
  id: string
  webhook_key?: string
  source_ip?: string
  payload_size?: number
  status: string
  status_code?: number
  rejection_reason?: string
  injection_score?: number
  platform?: string
  created_at: string
}

const fmtTs = (iso: string | undefined): string => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '—'
  }
}

const auditStatus = (s: string): Status => {
  if (s === 'accepted') return 'ok'
  if (s === 'rejected') return 'err'
  return 'idle'
}

interface PlatformRow {
  name: string
  enabled: boolean
  cidrCount: number
  signatureHeader: string
  description: string
}

export const WebhooksPane: React.FC = () => {
  const cfgQ = useAdminQuery<{ config?: WebhookSecurityConfig }>(
    ['webhook-security', 'config'],
    '/api/admin/webhook-security/config',
    { staleTime: 60_000 },
  )
  const statsQ = useAdminQuery<WebhookStats>(
    ['webhook-security', 'stats'],
    '/api/admin/webhook-security/stats?hours=24',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const auditQ = useAdminQuery<{ logs?: AuditLogEntry[] }>(
    ['webhook-security', 'audit-logs'],
    '/api/admin/webhook-security/audit-logs?limit=20',
    { staleTime: 30_000 },
  )

  const config = cfgQ.data?.config
  const stats = statsQ.data ?? {}
  const summary = stats.summary ?? {}
  const logs = auditQ.data?.logs ?? []
  const recentFailures = logs.filter((l) => l.status === 'rejected').length

  // Mutation surfaces wired 2026-05-06.
  const [editing, setEditing] = React.useState<PlatformAllowlistDraft | null>(null)
  const [adding, setAdding] = React.useState(false)
  const killSwitch = useAdminMutation<{ globalEnabled: boolean }, { enabled: boolean }>(
    '/api/admin/webhook-security/kill-switch',
    {
      method: 'POST',
      invalidateKeys: [['webhook-security']],
    },
  )

  const platforms: PlatformRow[] = React.useMemo(() => {
    const allow = config?.platformAllowlists ?? {}
    return Object.entries(allow).map(([name, p]) => ({
      name,
      enabled: !!p?.enabled,
      cidrCount: p?.cidrs?.length ?? 0,
      signatureHeader: p?.signatureHeader ?? '—',
      description: p?.description ?? '',
    }))
  }, [config])

  // Effective delivery rate = accepted / total. If totals are zero we
  // surface a dash rather than fabricate "100%" out of nothing.
  const deliveryRate = React.useMemo(() => {
    const total = summary.totalRequests ?? 0
    const accepted = summary.accepted ?? 0
    if (total <= 0) return null
    return (accepted / total) * 100
  }, [summary])

  const platformCols: DtCol<PlatformRow>[] = [
    { key: 'name', label: 'platform', className: 'name', render: (r) => r.name },
    {
      key: 'enabled',
      label: 'enabled',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={r.enabled ? 'ok' : 'idle'} />
          {r.enabled ? 'on' : 'off'}
        </span>
      ),
    },
    {
      key: 'sig',
      label: 'signature header',
      className: 'mono',
      render: (r) => r.signatureHeader,
    },
    {
      key: 'cidrs',
      label: 'cidrs',
      align: 'right',
      className: 'num',
      render: (r) => String(r.cidrCount),
    },
    {
      key: 'desc',
      label: 'description',
      className: 'dim',
      render: (r) => r.description || '—',
    },
    {
      key: 'edit',
      label: 'edit',
      className: 'r-actions',
      render: (r) => (
        <Btn
          variant="ghost"
          onClick={() => {
            const cfg = config?.platformAllowlists?.[r.name]
            setEditing({
              id: r.name,
              enabled: cfg?.enabled,
              cidrs: cfg?.cidrs,
              signatureHeader: cfg?.signatureHeader,
              description: cfg?.description,
            })
          }}
        >
          edit
        </Btn>
      ),
    },
  ]

  const auditCols: DtCol<AuditLogEntry>[] = [
    {
      key: 'ts',
      label: 'time',
      className: 'dim',
      render: (r) => fmtTs(r.created_at),
    },
    {
      key: 'status',
      label: 'status',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={auditStatus(r.status)} />
          {r.status}
          {r.status_code ? <span style={{ color: 'var(--fg-3)' }}> · {r.status_code}</span> : null}
        </span>
      ),
    },
    {
      key: 'platform',
      label: 'platform',
      render: (r) => r.platform ?? '—',
    },
    {
      key: 'src',
      label: 'source ip',
      className: 'mono',
      render: (r) => r.source_ip ?? '—',
    },
    {
      key: 'reason',
      label: 'reason',
      className: 'dim',
      render: (r) => r.rejection_reason ?? '—',
    },
  ]

  return (
    <div data-density="compact">
      <EditWebhookEndpointModal
        platform={editing}
        addNew={false}
        onClose={() => setEditing(null)}
      />
      <EditWebhookEndpointModal
        platform={adding ? { id: '' } : null}
        addNew
        onClose={() => setAdding(false)}
      />

      {(cfgQ.isError || statsQ.isError) && (
        <Banner level="warn" label="warn">
          one or more <span className="accent">/api/admin/webhook-security/*</span> endpoints
          unreachable
        </Banner>
      )}
      {killSwitch.isError && (
        <Banner level="err" label="error">
          {killSwitch.error?.message ?? 'failed to flip kill switch'}
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="hmac required"
          value={
            cfgQ.isLoading
              ? '…'
              : config?.requireHmacGlobal === undefined
                ? '—'
                : config.requireHmacGlobal
                  ? 'yes'
                  : 'no'
          }
          sub="globalEnabled toggle"
          tone={config?.requireHmacGlobal ? 'ok' : 'warn'}
        />
        <Kpi
          label="delivery rate (24h)"
          value={
            statsQ.isLoading
              ? '…'
              : deliveryRate === null
                ? '—'
                : `${deliveryRate.toFixed(1)}%`
          }
          sub={`${(summary.accepted ?? 0).toLocaleString()} / ${(summary.totalRequests ?? 0).toLocaleString()}`}
          tone={
            deliveryRate === null
              ? 'default'
              : deliveryRate >= 95
                ? 'ok'
                : deliveryRate >= 80
                  ? 'warn'
                  : 'err'
          }
        />
        <Kpi
          label="rejected (24h)"
          value={statsQ.isLoading ? '…' : (summary.rejected ?? 0).toLocaleString()}
          sub={summary.rejectionRate ? `${summary.rejectionRate} rejection rate` : ''}
          tone={(summary.rejected ?? 0) > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="recent failures"
          value={auditQ.isLoading ? '…' : String(recentFailures)}
          sub="last 20 audit entries"
          tone={recentFailures > 0 ? 'err' : 'default'}
        />
      </KpiGrid>

      <SectionBar
        title="kill switch"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Toggle
              on={!!config?.globalEnabled}
              onChange={(v) => killSwitch.mutate({ enabled: v })}
              label="kill switch"
            />
            <span style={{
              fontFamily: 'var(--font-v3-mono)',
              fontSize: 'var(--v3-t-meta)',
              color: config?.globalEnabled ? 'var(--ok)' : 'var(--err)',
            }}>
              {killSwitch.isPending
                ? 'updating…'
                : config?.globalEnabled
                  ? 'inbound webhooks enabled'
                  : 'inbound webhooks DISABLED'}
            </span>
          </span>
        }
      />

      <SectionBar
        title="platforms"
        count={platforms.length}
        right={
          <Btn variant="primary" onClick={() => setAdding(true)}>+ add platform</Btn>
        }
      />
      <Panel>
        <PanelHead title="platform allowlists" count={platforms.length} />
        {cfgQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : cfgQ.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : platforms.length === 0 ? (
          <EmptyInline pad>no platform allowlists configured</EmptyInline>
        ) : (
          <Dt
            columns={platformCols}
            rows={platforms}
            rowKey={(r) => r.name}
            rowDataAttrs={(r: any) => ({
              status: r.enabled === false ? 'idle' : 'ok',
            })}
          />
        )}
      </Panel>

      <WebhookTestPanel />

      <SectionBar title="recent webhook activity" count={logs.length} />
      <Panel>
        <PanelHead title="audit log" count={logs.length} />
        {auditQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : auditQ.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : logs.length === 0 ? (
          <EmptyInline pad>no recent webhook activity</EmptyInline>
        ) : (
          <Dt
            columns={auditCols}
            rows={logs}
            rowKey={(r) => r.id}
            rowDataAttrs={(r: any) => {
              const status = String(r.status ?? r.outcome ?? '').toLowerCase()
              return {
                status: status === 'rejected' || status === 'blocked' || status === 'failed' ? 'err'
                  : status === 'flagged' || status === 'rate_limited' ? 'warn'
                  : status === 'accepted' || status === 'success' ? 'ok'
                  : 'idle',
              }
            }}
          />
        )}
      </Panel>
    </div>
  )
}

export default WebhooksPane
