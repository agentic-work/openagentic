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
import { useAdminQuery, useAdminInvalidate, useAdminMutation } from '../../hooks/useAdminQuery'
import { apiRequest } from '@/utils/api'
import { AddRuleModal } from './AddRuleModal'

interface DLPRule {
  id: string
  category: string
  name: string
  description?: string
  pattern?: string
  flags?: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  enabled: boolean
  hits?: number
}

interface DLPExemption {
  id: string
  toolPattern: string
  scanPoint?: string
  exemptCategories?: string[]
  reason?: string
  enabled: boolean
}

interface DLPAuditEvent {
  id: string
  timestamp: string
  toolName?: string
  scanPoint?: string
  action: string
  severity?: string
  category?: string
  ruleName?: string
  userName?: string
  matchSnippet?: string
}

const fmtTs = (iso: string | undefined): string => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '—'
  }
}

const sevTone = (s: string | undefined): Status => {
  if (s === 'critical') return 'err'
  if (s === 'high') return 'err'
  if (s === 'medium') return 'warn'
  if (s === 'low') return 'info'
  return 'idle'
}

const actionTone = (a: string): Status => {
  if (a === 'block') return 'err'
  if (a === 'redact') return 'warn'
  if (a === 'allow') return 'ok'
  return 'idle'
}

export const DlpPane: React.FC = () => {
  const rulesQ = useAdminQuery<{ rules?: DLPRule[] }>(
    ['dlp', 'rules'],
    '/api/admin/dlp/rules',
    { staleTime: 60_000 },
  )
  const exemptionsQ = useAdminQuery<{ exemptions?: DLPExemption[] }>(
    ['dlp', 'exemptions'],
    '/api/admin/dlp/exemptions',
    { staleTime: 60_000 },
  )
  const auditQ = useAdminQuery<{ events?: DLPAuditEvent[] }>(
    ['dlp', 'audit-log'],
    '/api/admin/dlp/audit-log?hours=24&limit=50',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )

  const rules = rulesQ.data?.rules ?? []
  const exemptions = exemptionsQ.data?.exemptions ?? []
  const events = auditQ.data?.events ?? []

  const invalidate = useAdminInvalidate()
  const [addOpen, setAddOpen] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [errMsg, setErrMsg] = React.useState<string | null>(null)

  const globalToggle = useAdminMutation<{ success: boolean; globalDisabled: boolean }, { disabled: boolean }>(
    '/api/admin/dlp/global',
    {
      method: 'PUT',
      invalidateKeys: [['dlp']],
    },
  )

  const toggleRule = async (ruleId: string, currentlyEnabled: boolean) => {
    setErrMsg(null)
    setPendingId(ruleId)
    try {
      const res = await apiRequest(`/api/admin/dlp/rules/${ruleId}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${res.status} - ${text}`)
      }
      invalidate(['dlp'])
    } catch (err: any) {
      setErrMsg(err?.message ?? 'failed to toggle rule')
    } finally {
      setPendingId(null)
    }
  }

  const deleteExemption = async (id: string, pattern: string) => {
    if (!window.confirm(`Delete exemption for "${pattern}"?`)) return
    setErrMsg(null)
    setPendingId(id)
    try {
      const res = await apiRequest(`/api/admin/dlp/exemptions/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${res.status} - ${text}`)
      }
      invalidate(['dlp'])
    } catch (err: any) {
      setErrMsg(err?.message ?? 'failed to delete exemption')
    } finally {
      setPendingId(null)
    }
  }

  const enabledRules = rules.filter((r) => r.enabled).length
  const redactions24h = events.filter((e) => e.action === 'redact').length
  const blocks24h = events.filter((e) => e.action === 'block').length

  const ruleCols: DtCol<DLPRule>[] = [
    { key: 'name', label: 'rule', className: 'name', render: (r) => r.name },
    {
      key: 'cat',
      label: 'category',
      render: (r) => r.category,
    },
    {
      key: 'sev',
      label: 'severity',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={sevTone(r.severity)} />
          {r.severity}
        </span>
      ),
    },
    {
      key: 'enabled',
      label: 'enabled',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Toggle
            on={r.enabled}
            onChange={() => toggleRule(r.id, r.enabled)}
            label={r.enabled ? 'disable rule' : 'enable rule'}
          />
          {pendingId === r.id ? '…' : (r.enabled ? 'on' : 'off')}
        </span>
      ),
    },
    {
      key: 'hits',
      label: 'hits',
      align: 'right',
      className: 'num',
      render: (r) => (r.hits ?? 0).toLocaleString(),
    },
  ]

  const exemptCols: DtCol<DLPExemption>[] = [
    {
      key: 'pattern',
      label: 'tool pattern',
      className: 'mono',
      render: (r) => r.toolPattern,
    },
    {
      key: 'point',
      label: 'scan point',
      render: (r) => r.scanPoint ?? '—',
    },
    {
      key: 'cats',
      label: 'exempt',
      className: 'dim',
      render: (r) =>
        r.exemptCategories && r.exemptCategories.length > 0
          ? r.exemptCategories.join(', ')
          : '—',
    },
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
      key: 'reason',
      label: 'reason',
      className: 'dim',
      render: (r) => r.reason ?? '—',
    },
    {
      key: 'delete',
      label: 'delete',
      className: 'r-actions',
      render: (r) => (
        <Btn
          variant="ghost"
          disabled={pendingId === r.id}
          onClick={() => deleteExemption(r.id, r.toolPattern)}
        >
          {pendingId === r.id ? '…' : 'delete'}
        </Btn>
      ),
    },
  ]

  const auditCols: DtCol<DLPAuditEvent>[] = [
    {
      key: 'ts',
      label: 'time',
      className: 'dim',
      render: (r) => fmtTs(r.timestamp),
    },
    {
      key: 'action',
      label: 'action',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={actionTone(r.action)} />
          {r.action}
        </span>
      ),
    },
    {
      key: 'sev',
      label: 'severity',
      render: (r) => r.severity ?? '—',
    },
    {
      key: 'category',
      label: 'category',
      render: (r) => r.category ?? '—',
    },
    {
      key: 'rule',
      label: 'rule',
      className: 'dim',
      render: (r) => r.ruleName ?? '—',
    },
    {
      key: 'user',
      label: 'user',
      className: 'dim',
      render: (r) => r.userName ?? '—',
    },
  ]

  return (
    <div data-density="compact">
      <AddRuleModal open={addOpen} onClose={() => setAddOpen(false)} />

      {(rulesQ.isError || exemptionsQ.isError || auditQ.isError) && (
        <Banner level="warn" label="warn">
          one or more <span className="accent">/api/admin/dlp/*</span> endpoints unreachable
        </Banner>
      )}
      {errMsg && (
        <Banner level="err" label="error">{errMsg}</Banner>
      )}
      {globalToggle.data?.globalDisabled && (
        <Banner level="warn" label="dlp paused">
          global DLP scanning is currently <span className="accent">disabled</span> — flip the toggle below to re-enable
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="rules"
          value={rulesQ.isLoading ? '…' : String(rules.length)}
          sub={`${enabledRules} enabled · ${rules.length - enabledRules} disabled`}
        />
        <Kpi
          label="exemptions"
          value={exemptionsQ.isLoading ? '…' : String(exemptions.length)}
          sub="tool-pattern overrides"
        />
        <Kpi
          label="redactions (24h)"
          value={auditQ.isLoading ? '…' : String(redactions24h)}
          sub="from audit log"
          tone={redactions24h > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="blocks (24h)"
          value={auditQ.isLoading ? '…' : String(blocks24h)}
          sub="hard rejections"
          tone={blocks24h > 0 ? 'err' : 'default'}
        />
      </KpiGrid>

      <SectionBar
        title="global state"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Toggle
              on={!globalToggle.data?.globalDisabled}
              onChange={(v) => globalToggle.mutate({ disabled: !v })}
              label="dlp scanning"
            />
            <span style={{
              fontFamily: 'var(--font-v3-mono)',
              fontSize: 'var(--v3-t-meta)',
              color: globalToggle.data?.globalDisabled ? 'var(--err)' : 'var(--ok)',
            }}>
              {globalToggle.isPending
                ? 'updating…'
                : globalToggle.data?.globalDisabled ? 'dlp DISABLED' : 'dlp scanning enabled'}
            </span>
          </span>
        }
      />

      {/* I-5: rules + exemptions side-by-side instead of stacked full-width.
          Each pane held a Dt with at most 6 columns of meta — there's room
          for two columns at lg+. Mobile / compact viewports collapse back
          to the stacked layout. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <SectionBar title="dlp rules" count={rules.length} />
          <Panel>
            <PanelHead title="rules" count={rules.length} />
            {rulesQ.isLoading ? (
              <EmptyInline pad>loading…</EmptyInline>
            ) : rulesQ.isError ? (
              <EmptyInline pad>endpoint unreachable</EmptyInline>
            ) : rules.length === 0 ? (
              <EmptyInline pad>no dlp rules configured</EmptyInline>
            ) : (
              <Dt
                columns={ruleCols}
                rows={rules}
                rowKey={(r) => r.id}
                rowDataAttrs={(r: any) => ({
                  status: r.enabled === false ? 'idle'
                    : r.severity === 'critical' || r.severity === 'high' ? 'err'
                    : r.severity === 'medium' ? 'warn'
                    : 'ok',
                })}
              />
            )}
          </Panel>
        </div>
        <div>
          <SectionBar
            title="tool exemptions"
            count={exemptions.length}
            right={<Btn variant="primary" onClick={() => setAddOpen(true)}>+ add exemption</Btn>}
          />
          <Panel>
            <PanelHead title="exemptions" count={exemptions.length} />
            {exemptionsQ.isLoading ? (
              <EmptyInline pad>loading…</EmptyInline>
            ) : exemptionsQ.isError ? (
              <EmptyInline pad>endpoint unreachable</EmptyInline>
            ) : exemptions.length === 0 ? (
              <EmptyInline pad>no exemptions configured</EmptyInline>
            ) : (
              <Dt columns={exemptCols} rows={exemptions} rowKey={(r) => r.id} />
            )}
          </Panel>
        </div>
      </div>

      <SectionBar title="recent dlp events" count={events.length} />
      <Panel>
        <PanelHead title="audit log (24h)" count={events.length} />
        {auditQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : auditQ.isError ? (
          <EmptyInline pad>endpoint unreachable</EmptyInline>
        ) : events.length === 0 ? (
          <EmptyInline pad>no dlp events in the last 24h</EmptyInline>
        ) : (
          <Dt
            columns={auditCols}
            rows={events}
            rowKey={(r) => r.id}
            rowDataAttrs={(r: any) => {
              const sev = String(r.severity ?? '').toLowerCase()
              const action = String(r.action ?? '').toLowerCase()
              return {
                status: sev === 'critical' || action === 'block' ? 'err'
                  : sev === 'high' || action === 'redact' ? 'warn'
                  : 'idle',
              }
            }}
          />
        )}
      </Panel>
    </div>
  )
}

export default DlpPane
