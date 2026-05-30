import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  FormGrid,
  FormRow,
  SavedTag,
  DirtyTag,
  EmptyInline,
  SidePanel,
  SectionBar,
  Chip,
  StatusDot,
  type Status,
  MetricChart,
  BarList,
  Toggle,
  v3InputStyle,
} from '../primitives-v3'
import {
  useSynthConfig,
  useSynthApprovals,
  useSynthStats,
  useSynthHistory,
  type SynthApprovalRow,
  type SynthConfig,
  type SynthHistoryRow,
} from '../hooks/useDashboardMetrics'
import { useAdminMutation } from '../hooks/useAdminQuery'
import { SynthRejectModal } from './synth/SynthRejectModal'

// ============================================================
// Public sub-tab type — leaf id strips the "synth-" prefix.
// ============================================================
export type SynthesisTab = 'management' | 'approvals' | 'stats' | 'config'

// `synth-management` is the legacy leaf id; v3 normalizes to "config".
const TAB_ALIASES: Record<string, SynthesisTab> = {
  management: 'config',
  config: 'config',
  approvals: 'approvals',
  stats: 'stats',
}

const TAB_ORDER: SynthesisTab[] = ['config', 'approvals', 'stats']

const TABS = [
  { id: 'config',    label: 'Config' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'stats',     label: 'Stats' },
]

// ============================================================
// Helpers
// ============================================================
function fmtMs(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}
function fmtUsd(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(n < 1 ? 4 : 2)}`
}
function fmtPct(n: number | undefined, denom: number | undefined): string {
  if (!denom || denom === 0 || typeof n !== 'number') return '—'
  return `${((n / denom) * 100).toFixed(1)}%`
}
function fmtAgo(iso: string | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const dms = Date.now() - t
  if (dms < 60_000) return `${Math.round(dms / 1000)}s ago`
  if (dms < 3_600_000) return `${Math.round(dms / 60_000)}m ago`
  if (dms < 86_400_000) return `${Math.round(dms / 3_600_000)}h ago`
  return `${Math.round(dms / 86_400_000)}d ago`
}
function riskTone(r: string | undefined): 'default' | 'ok' | 'warn' | 'err' {
  switch ((r ?? '').toLowerCase()) {
    case 'low': return 'ok'
    case 'medium': return 'warn'
    case 'high':
    case 'critical': return 'err'
    default: return 'default'
  }
}
function riskStatus(r: string | undefined): Status {
  switch ((r ?? '').toLowerCase()) {
    case 'low': return 'ok'
    case 'medium': return 'warn'
    case 'high':
    case 'critical': return 'err'
    default: return 'idle'
  }
}

// ============================================================
// Page props + component
// ============================================================
export interface SynthesisHubPageProps {
  /**
   * Initial sub-tab — set by the host shell from the leaf id minus
   * the "synth-" prefix (e.g. "synth-stats" → "stats").
   */
  initialTab?: SynthesisTab | string
}

export const SynthesisHubPage: React.FC<SynthesisHubPageProps> = ({
  initialTab = 'config',
}) => {
  const safeInitial: SynthesisTab =
    TAB_ALIASES[initialTab as string] ?? 'config'

  const [tab, setTab] = React.useState<SynthesisTab>(safeInitial)
  const [toast, setToast] = React.useState<{ level: 'ok' | 'err' | 'info'; msg: string } | null>(null)
  const [selected, setSelected] = React.useState<SynthApprovalRow | null>(null)
  const [rejectFor, setRejectFor] = React.useState<SynthApprovalRow | null>(null)
  const [rejectError, setRejectError] = React.useState<string | null>(null)

  // Re-mount when the host pushes a fresh leaf id.
  React.useEffect(() => {
    setTab(safeInitial)
  }, [safeInitial])

  const showToast = React.useCallback((level: 'ok' | 'err' | 'info', msg: string) => {
    setToast({ level, msg })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  // ---------- mutations ----------
  const approveMut = useAdminMutation<unknown, { approvalId: string }>(
    '', // computed per-call below
    { method: 'POST', invalidateKeys: [['synth', 'approvals'], ['synth', 'stats'], ['synth', 'history']] },
  )
  const rejectMut = useAdminMutation<unknown, { approvalId: string; reason: string }>(
    '',
    { method: 'POST', invalidateKeys: [['synth', 'approvals'], ['synth', 'stats'], ['synth', 'history']] },
  )

  // useAdminMutation closes over endpoint at hook-init — but we need per-id
  // endpoints. Re-implement inline via the underlying mutation: we hand-build
  // a callable that uses fetch via apiRequest.
  const approveById = React.useCallback(
    async (id: string) => {
      const { apiRequest } = await import('@/utils/api')
      const resp = await apiRequest(`/api/admin/synth/approvals/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'admin approved via v3 hub' }),
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`approve failed: ${resp.status} ${text}`)
      }
      // Let useAdminMutation invalidation logic share via direct queryClient access.
      apQ.refetch?.()
      statsQ.refetch?.()
      histQ.refetch?.()
    },
    [],
  )
  const rejectById = React.useCallback(
    async (id: string, reason: string) => {
      const { apiRequest } = await import('@/utils/api')
      const resp = await apiRequest(`/api/admin/synth/approvals/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`reject failed: ${resp.status} ${text}`)
      }
      apQ.refetch?.()
      statsQ.refetch?.()
      histQ.refetch?.()
    },
    [],
  )
  // Suppress "unused" — we kept the mutation hook around to share the
  // invalidation key list shape; per-id lookups go via the hand-built
  // callbacks above so we don't need a hooked endpoint.
  void approveMut
  void rejectMut

  const [approveBusy, setApproveBusy] = React.useState<string | null>(null)
  const [rejectBusy, setRejectBusy] = React.useState(false)

  const onApprove = React.useCallback(
    async (row: SynthApprovalRow) => {
      if (!confirm(`Approve "${row.intent.slice(0, 60)}…"?`)) return
      try {
        setApproveBusy(row.id)
        await approveById(row.id)
        showToast('ok', `approved ${row.id.slice(0, 8)}`)
        if (selected?.id === row.id) setSelected(null)
      } catch (err: any) {
        showToast('err', err?.message ?? 'approve failed')
      } finally {
        setApproveBusy(null)
      }
    },
    [approveById, showToast, selected],
  )

  const onRejectSubmit = React.useCallback(
    async (reason: string) => {
      if (!rejectFor) return
      setRejectBusy(true)
      setRejectError(null)
      try {
        await rejectById(rejectFor.id, reason)
        showToast('ok', `rejected ${rejectFor.id.slice(0, 8)}`)
        if (selected?.id === rejectFor.id) setSelected(null)
        setRejectFor(null)
      } catch (err: any) {
        setRejectError(err?.message ?? 'reject failed')
      } finally {
        setRejectBusy(false)
      }
    },
    [rejectFor, rejectById, showToast, selected],
  )

  const cfgQ = useSynthConfig()
  const apQ = useSynthApprovals()
  const statsQ = useSynthStats(7)
  const histQ = useSynthHistory(50)

  const approvals = apQ.data?.approvals ?? []
  const stats = statsQ.data?.stats
  const history = histQ.data?.history ?? []

  const successRate =
    stats && stats.totalSyntheses > 0
      ? (stats.successfulSyntheses / stats.totalSyntheses) * 100
      : null

  const sevenDaySyntheses = React.useMemo(() => {
    // Prefer the dailyUsage rollup from /stats (server-summed); fall back
    // to client-side count over /history when it's empty.
    if (stats?.dailyUsage && stats.dailyUsage.length > 0) {
      return stats.dailyUsage.reduce((acc, d) => acc + (d.count ?? 0), 0)
    }
    if (!history.length) return null
    const cutoff = Date.now() - 7 * 86_400_000
    return history.filter(
      (h) => Number.isFinite(new Date(h.createdAt).getTime()) && new Date(h.createdAt).getTime() >= cutoff,
    ).length
  }, [stats, history])

  const refreshAll = () => {
    cfgQ.refetch?.()
    apQ.refetch?.()
    statsQ.refetch?.()
    histQ.refetch?.()
  }

  const anyError = cfgQ.isError || apQ.isError || statsQ.isError || histQ.isError
  const anyLoading = cfgQ.isLoading || apQ.isLoading || statsQ.isLoading || histQ.isLoading

  const meta = (
    <>
      <StatusDot status={anyError ? 'err' : anyLoading ? 'idle' : 'ok'} />
      <span style={{ marginLeft: 6 }}>
        {anyLoading
          ? 'loading…'
          : `${approvals.length} pending · ${
              sevenDaySyntheses == null ? '—' : sevenDaySyntheses
            } synthesized (7d)`}
      </span>
    </>
  )

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? "Tool Synthesis"}
        meta={meta}
        actions={
          <Btn variant="ghost" onClick={refreshAll}>
            refresh
          </Btn>
        }
      />

      <Subtabs items={TABS} active={tab} onChange={(id) => setTab(id as SynthesisTab)} />

      {toast && (
        <Banner level={toast.level} label={toast.level === 'err' ? 'error' : toast.level === 'ok' ? 'ok' : 'info'}>
          {toast.msg}
        </Banner>
      )}
      {anyError && (
        <Banner level="warn" label="warn">
          one or more <span className="accent">/api/admin/synth/*</span> endpoints failed —
          values below may be partial
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="pending approvals"
          value={apQ.isLoading ? '…' : String(approvals.length)}
          sub={
            approvals.length === 0
              ? 'all caught up'
              : `${approvals.filter((a) => /high|critical/i.test(a.riskLevel)).length} high+`
          }
          tone={approvals.length === 0 ? 'ok' : approvals.length > 5 ? 'warn' : 'default'}
        />
        <Kpi
          label="synthesized (7d)"
          value={
            statsQ.isLoading && histQ.isLoading
              ? '…'
              : sevenDaySyntheses == null
                ? '—'
                : sevenDaySyntheses.toLocaleString()
          }
          sub={
            stats
              ? `${stats.successfulSyntheses} ok · ${stats.failedSyntheses} fail`
              : 'rolling 7-day window'
          }
        />
        <Kpi
          label="avg generation"
          value={statsQ.isLoading ? '…' : fmtMs(stats?.avgExecutionMs)}
          sub="end-to-end synth + exec"
        />
        <Kpi
          label="success rate"
          value={
            statsQ.isLoading
              ? '…'
              : successRate == null
                ? '—'
                : `${successRate.toFixed(1)}%`
          }
          sub={stats ? `${stats.totalSyntheses} total` : 'no data'}
          tone={
            successRate == null
              ? 'default'
              : successRate >= 95
                ? 'ok'
                : successRate >= 80
                  ? 'warn'
                  : 'err'
          }
        />
      </KpiGrid>

      {tab === 'config' && (
        <ConfigPane
          q={cfgQ}
          onSaved={(msg) => showToast('ok', msg)}
          onError={(msg) => showToast('err', msg)}
        />
      )}
      {tab === 'approvals' && (
        <ApprovalsPane
          rows={approvals}
          isLoading={apQ.isLoading}
          isError={apQ.isError}
          approveBusy={approveBusy}
          onRowClick={(r) => setSelected(r)}
          onApprove={(r) => void onApprove(r)}
          onReject={(r) => {
            setRejectError(null)
            setRejectFor(r)
          }}
        />
      )}
      {tab === 'stats' && (
        <StatsPane
          stats={stats}
          history={history}
          statsLoading={statsQ.isLoading}
          historyLoading={histQ.isLoading}
        />
      )}

      <SidePanel
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.intent ?? '—'}
        meta={
          selected
            ? `${selected.riskLevel.toUpperCase()} · ${selected.userEmail ?? selected.userId} · ${fmtAgo(selected.createdAt)}`
            : ''
        }
        headActions={
          selected && (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <Btn
                variant="ghost"
                onClick={() => {
                  setRejectError(null)
                  setRejectFor(selected)
                }}
              >
                reject
              </Btn>
              <Btn
                variant="primary"
                disabled={approveBusy === selected.id}
                onClick={() => void onApprove(selected)}
              >
                {approveBusy === selected.id ? 'approving…' : 'approve'}
              </Btn>
            </span>
          )
        }
      >
        {selected && <ApprovalDetail row={selected} />}
      </SidePanel>

      <SynthRejectModal
        open={rejectFor !== null}
        approvalId={rejectFor?.id ?? null}
        onClose={() => setRejectFor(null)}
        onSubmit={onRejectSubmit}
        isSubmitting={rejectBusy}
        error={rejectError}
      />
    </>
  )
}

// ============================================================
// ConfigPane — editable render of /api/admin/synth/config.
// Loads current config into local draft state; PUT /config dispatches
// the diff (we send the whole draft — server merges).
// ============================================================
const ConfigPane: React.FC<{
  q: ReturnType<typeof useSynthConfig>
  onSaved: (msg: string) => void
  onError: (msg: string) => void
}> = ({ q, onSaved, onError }) => {
  const cfg: SynthConfig | undefined = q.data?.config
  const [draft, setDraft] = React.useState<SynthConfig>({})
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (cfg) setDraft(cfg)
  }, [cfg])

  const isDirty = React.useMemo(() => {
    if (!cfg) return false
    const keys = new Set([...Object.keys(cfg), ...Object.keys(draft)]) as Set<keyof SynthConfig>
    for (const k of keys) {
      const a = (cfg as any)[k]
      const b = (draft as any)[k]
      if (Array.isArray(a) || Array.isArray(b)) {
        if (JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])) return true
      } else if (a !== b) return true
    }
    return false
  }, [cfg, draft])

  const set = <K extends keyof SynthConfig>(k: K, v: SynthConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const onDiscard = () => cfg && setDraft(cfg)

  const onSave = async () => {
    setBusy(true)
    try {
      const { apiRequest } = await import('@/utils/api')
      const resp = await apiRequest('/api/admin/synth/config', {
        method: 'PUT',
        body: JSON.stringify(draft),
      })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`PUT /api/admin/synth/config failed: ${resp.status} ${txt}`)
      }
      await q.refetch?.()
      onSaved('synth config saved')
    } catch (err: any) {
      onError(err?.message ?? 'save failed')
    } finally {
      setBusy(false)
    }
  }

  if (q.isLoading) {
    return <EmptyInline pad>loading /api/admin/synth/config…</EmptyInline>
  }
  if (q.isError) {
    return (
      <Banner level="err" label="error">
        failed to load <span className="accent">/api/admin/synth/config</span>
      </Banner>
    )
  }
  if (!cfg) {
    return (
      <EmptyInline pad>
        endpoint returned no config — check that synth is initialized on the api
        service
      </EmptyInline>
    )
  }

  const status = isDirty ? <DirtyTag /> : <SavedTag />
  const csv = (xs: string[] | undefined) => (xs ?? []).join(', ')
  const parseCsv = (s: string): string[] =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)

  return (
    <>
      <SectionBar
        title="overall switches"
        right={
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <Btn variant="ghost" disabled={!isDirty || busy} onClick={onDiscard}>
              discard
            </Btn>
            <Btn variant="primary" disabled={!isDirty || busy} onClick={onSave}>
              {busy ? 'saving…' : 'save'}
            </Btn>
          </span>
        }
      />
      <FormGrid>
        <FormRow
          name="enabled"
          desc="master switch — when off, all synth requests reject at the gateway"
          configKey="SYNTH_ENABLED"
          status={status}
        >
          <Toggle on={!!draft.enabled} onChange={(v) => set('enabled', v)} />
        </FormRow>
        <FormRow
          name="visible to LLM"
          desc="when off, the LLM can't see synth tools (synth still works for direct API calls)"
          configKey="SYNTH_VISIBLE_TO_LLM"
          status={status}
        >
          <Toggle on={!!draft.visibleToLLM} onChange={(v) => set('visibleToLLM', v)} />
        </FormRow>
      </FormGrid>

      <SectionBar title="model" />
      <FormGrid>
        <FormRow name="provider" configKey="SYNTH_PROVIDER" status={status}>
          <select
            value={draft.provider ?? ''}
            onChange={(e) => set('provider', e.target.value)}
            style={v3InputStyle}
          >
            {['anthropic', 'bedrock', 'ollama', 'openai', 'google', 'azure', 'auto'].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow name="model" configKey="SYNTH_MODEL" status={status}>
          <input
            value={draft.model ?? ''}
            onChange={(e) => set('model', e.target.value)}
            style={v3InputStyle}
            placeholder="model id"
          />
        </FormRow>
        <FormRow
          name="synthesis temperature"
          desc="0 = precise · 1 = creative"
          configKey="SYNTH_TEMPERATURE"
          status={status}
        >
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={draft.synthesisTemperature ?? 0.2}
            onChange={(e) => set('synthesisTemperature', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="max synthesis tokens"
          configKey="SYNTH_MAX_TOKENS"
          status={status}
        >
          <input
            type="number"
            min={256}
            max={32768}
            value={draft.maxSynthesisTokens ?? 4096}
            onChange={(e) => set('maxSynthesisTokens', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
      </FormGrid>

      <SectionBar title="execution limits" />
      <FormGrid>
        <FormRow name="timeout (s)" configKey="SYNTH_TIMEOUT" status={status}>
          <input
            type="number"
            min={10}
            max={600}
            value={draft.timeoutSeconds ?? 60}
            onChange={(e) => set('timeoutSeconds', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="max concurrent executions"
          configKey="SYNTH_MAX_CONCURRENT"
          status={status}
        >
          <input
            type="number"
            min={1}
            max={100}
            value={draft.maxConcurrentExecutions ?? 5}
            onChange={(e) => set('maxConcurrentExecutions', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="max memory (MB)"
          configKey="SYNTH_MAX_MEMORY_MB"
          status={status}
        >
          <input
            type="number"
            min={64}
            max={4096}
            value={draft.maxMemoryMb ?? 512}
            onChange={(e) => set('maxMemoryMb', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="max daily syntheses / user"
          configKey="SYNTH_MAX_DAILY_PER_USER"
          status={status}
        >
          <input
            type="number"
            min={1}
            max={10000}
            value={draft.maxDailySynthesesPerUser ?? 100}
            onChange={(e) => set('maxDailySynthesesPerUser', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="user daily budget (USD)"
          configKey="SYNTH_USER_DAILY_BUDGET"
          status={status}
        >
          <input
            type="number"
            min={0}
            max={1000}
            step={0.01}
            value={draft.defaultUserDailyBudgetUsd ?? 5}
            onChange={(e) => set('defaultUserDailyBudgetUsd', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
      </FormGrid>

      <SectionBar title="approvals" />
      <FormGrid>
        <FormRow
          name="auto-approve low-risk"
          configKey="SYNTH_AUTO_APPROVE_LOW"
          status={status}
        >
          <Toggle on={!!draft.autoApproveLowRisk} onChange={(v) => set('autoApproveLowRisk', v)} />
        </FormRow>
        <FormRow
          name="auto-approve medium-risk"
          configKey="SYNTH_AUTO_APPROVE_MEDIUM"
          status={status}
        >
          <Toggle
            on={!!draft.autoApproveMediumRisk}
            onChange={(v) => set('autoApproveMediumRisk', v)}
          />
        </FormRow>
        <FormRow
          name="approval timeout (s)"
          desc="how long to wait for a human before falling through to default action"
          configKey="SYNTH_APPROVAL_TIMEOUT"
          status={status}
        >
          <input
            type="number"
            min={60}
            max={86400}
            value={draft.approvalTimeoutSeconds ?? 300}
            onChange={(e) => set('approvalTimeoutSeconds', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="timeout action"
          desc="reject (safer) · approve (auto-approve on timeout)"
          configKey="SYNTH_APPROVAL_TIMEOUT_ACTION"
          status={status}
        >
          <select
            value={draft.approvalTimeoutAction ?? 'reject'}
            onChange={(e) => set('approvalTimeoutAction', e.target.value as any)}
            style={v3InputStyle}
          >
            <option value="reject">reject</option>
            <option value="approve">approve</option>
          </select>
        </FormRow>
      </FormGrid>

      <SectionBar title="capabilities" />
      <FormGrid>
        <FormRow
          name="allowed (csv)"
          desc="if non-empty, synth can ONLY use these"
          configKey="SYNTH_ALLOWED_CAPS"
          status={status}
        >
          <input
            value={csv(draft.allowedCapabilities)}
            onChange={(e) => set('allowedCapabilities', parseCsv(e.target.value))}
            style={v3InputStyle}
            placeholder="e.g. http_get, kv_read"
          />
        </FormRow>
        <FormRow
          name="blocked (csv)"
          desc="hard-rejected even if listed in allowed"
          configKey="SYNTH_BLOCKED_CAPS"
          status={status}
        >
          <input
            value={csv(draft.blockedCapabilities)}
            onChange={(e) => set('blockedCapabilities', parseCsv(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="admin-only (csv)"
          configKey="SYNTH_ADMIN_ONLY_CAPS"
          status={status}
        >
          <input
            value={csv(draft.adminOnlyCapabilities)}
            onChange={(e) => set('adminOnlyCapabilities', parseCsv(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
      </FormGrid>

      <SectionBar title="security" />
      <FormGrid>
        <FormRow
          name="auth mode"
          desc="user_only — synth runs only as the authenticated user; never service accounts"
          configKey="SYNTH_AUTH_MODE"
          status={status}
        >
          <input
            value={draft.authMode ?? ''}
            onChange={(e) => set('authMode', e.target.value)}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="credential source"
          configKey="SYNTH_CREDENTIAL_SOURCE"
          status={status}
        >
          <input
            value={draft.credentialSource ?? ''}
            onChange={(e) => set('credentialSource', e.target.value)}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow
          name="session-based oauth"
          desc="when on, users re-auth at each session (no stored credentials)"
          configKey="SYNTH_SESSION_OAUTH"
          status={status}
        >
          <Toggle on={!!draft.sessionBasedOAuth} onChange={(v) => set('sessionBasedOAuth', v)} />
        </FormRow>
      </FormGrid>

      <SectionBar title="semantic tool search" />
      <FormGrid>
        <FormRow
          name="enabled"
          desc="search Milvus for an existing tool before synthesizing a new one"
          configKey="SYNTH_USE_SEMANTIC_SEARCH"
          status={status}
        >
          <Toggle
            on={!!draft.useSemanticToolSearch}
            onChange={(v) => set('useSemanticToolSearch', v)}
          />
        </FormRow>
        <FormRow name="top-k" configKey="SYNTH_SEMANTIC_TOPK" status={status}>
          <input
            type="number"
            min={1}
            max={50}
            value={draft.semanticSearchTopK ?? 5}
            onChange={(e) => set('semanticSearchTopK', Number(e.target.value))}
            style={v3InputStyle}
          />
        </FormRow>
      </FormGrid>
    </>
  )
}

// ============================================================
// ApprovalsPane — Dt of pending approvals
// ============================================================
const ApprovalsPane: React.FC<{
  rows: SynthApprovalRow[]
  isLoading: boolean
  isError: boolean
  approveBusy: string | null
  onRowClick: (r: SynthApprovalRow) => void
  onApprove: (r: SynthApprovalRow) => void
  onReject: (r: SynthApprovalRow) => void
}> = ({ rows, isLoading, isError, approveBusy, onRowClick, onApprove, onReject }) => {
  const cols: DtCol<SynthApprovalRow>[] = [
    {
      key: 'risk',
      label: 'RISK',
      width: '70px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={riskStatus(r.riskLevel)} />
          <span style={{ textTransform: 'uppercase', fontFamily: 'var(--font-v3-mono)' }}>
            {r.riskLevel}
          </span>
        </span>
      ),
    },
    {
      key: 'intent',
      label: 'TOOL / INTENT',
      render: (r) => (
        <span style={{ color: 'var(--fg-0)' }}>
          {(r.intent ?? '').slice(0, 80) || '(no intent)'}
        </span>
      ),
    },
    {
      key: 'user',
      label: 'REQUESTED BY',
      width: '180px',
      className: 'mono',
      render: (r) => r.userEmail ?? r.userName ?? r.userId ?? '—',
    },
    {
      key: 'pending',
      label: 'PENDING SINCE',
      width: '120px',
      className: 'mono',
      render: (r) => fmtAgo(r.createdAt),
    },
    {
      key: 'actions',
      label: '',
      width: '160px',
      align: 'right',
      className: 'r-actions',
      render: (r) => (
        <span
          style={{ display: 'inline-flex', gap: 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Btn
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onReject(r)
            }}
          >
            reject
          </Btn>
          <Btn
            variant="primary"
            disabled={approveBusy === r.id}
            onClick={(e) => {
              e.stopPropagation()
              onApprove(r)
            }}
          >
            {approveBusy === r.id ? '…' : 'approve'}
          </Btn>
        </span>
      ),
    },
  ]

  return (
    <Panel>
      <PanelHead title="pending approvals" count={rows.length} />
      {isLoading ? (
        <EmptyInline pad>loading /api/admin/synth/approvals…</EmptyInline>
      ) : isError ? (
        <EmptyInline pad>failed to fetch /api/admin/synth/approvals</EmptyInline>
      ) : (
        <Dt
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => onRowClick(r)}
          rowDataAttrs={() => ({ status: 'warn' })}
          empty={
            <EmptyInline pad>
              all caught up — no pending tool synthesis approvals
            </EmptyInline>
          }
        />
      )}
    </Panel>
  )
}

// ============================================================
// ApprovalDetail — full code + audit summary in the SidePanel
// ============================================================
const ApprovalDetail: React.FC<{ row: SynthApprovalRow }> = ({ row }) => {
  return (
    <>
      <SectionBar title="summary" />
      <div
        style={{
          padding: '10px 14px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-1)',
          display: 'grid',
          gridTemplateColumns: '110px 1fr',
          rowGap: 4,
          columnGap: 12,
          borderBottom: '1px solid var(--line-1)',
        }}
      >
        <span style={{ color: 'var(--fg-3)' }}>id</span>
        <span>{row.id}</span>
        <span style={{ color: 'var(--fg-3)' }}>tool id</span>
        <span>{row.toolId}</span>
        <span style={{ color: 'var(--fg-3)' }}>requester</span>
        <span>{row.userEmail ?? row.userName ?? row.userId}</span>
        <span style={{ color: 'var(--fg-3)' }}>risk</span>
        <span style={{ color: `var(--${riskStatus(row.riskLevel)})` }}>
          {row.riskLevel.toUpperCase()}
        </span>
        <span style={{ color: 'var(--fg-3)' }}>requested</span>
        <span>{new Date(row.createdAt).toUTCString()}</span>
        {row.expiresAt && (
          <>
            <span style={{ color: 'var(--fg-3)' }}>expires</span>
            <span>{new Date(row.expiresAt).toUTCString()}</span>
          </>
        )}
        <span style={{ color: 'var(--fg-3)' }}>status</span>
        <span>{row.status ?? 'pending'}</span>
      </div>

      <SectionBar title="intent" />
      <pre
        style={{
          margin: 0,
          padding: '10px 14px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-1)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          borderBottom: '1px solid var(--line-1)',
        }}
      >
        {row.intent}
      </pre>

      <SectionBar title="synthesized code" />
      <pre
        style={{
          margin: 0,
          padding: '10px 14px',
          fontFamily: 'var(--font-v3-mono)',
          fontSize: 'var(--v3-t-meta)',
          color: 'var(--fg-1)',
          background: 'var(--bg-0)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 'unset',
        }}
      >
        {row.code || '(no code attached)'}
      </pre>
    </>
  )
}

// ============================================================
// StatsPane — KPIs + daily volume chart + top-tools BarList +
//             recent history table
// ============================================================
const StatsPane: React.FC<{
  stats: ReturnType<typeof useSynthStats>['data'] extends infer D
    ? D extends { stats?: infer S } ? S | undefined : undefined
    : undefined
  history: SynthHistoryRow[]
  statsLoading: boolean
  historyLoading: boolean
}> = ({ stats, history, statsLoading, historyLoading }) => {
  // Daily volume — prefer server rollup, fall back to client-side derivation.
  const daily = React.useMemo(() => {
    if (stats?.dailyUsage && stats.dailyUsage.length > 0) {
      return stats.dailyUsage.map((d) => ({
        label: (d.date ?? '').slice(5), // MM-DD
        count: d.count ?? 0,
        cost: d.cost ?? 0,
      }))
    }
    if (!history.length) return []
    const byDate: Record<string, { count: number; cost: number }> = {}
    for (const h of history) {
      const k = (h.createdAt ?? '').slice(0, 10)
      if (!k) continue
      if (!byDate[k]) byDate[k] = { count: 0, cost: 0 }
      byDate[k].count += 1
      byDate[k].cost += h.costUsd ?? 0
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ label: d.slice(5), count: v.count, cost: v.cost }))
  }, [stats, history])

  const topCaps = stats?.topCapabilities ?? []
  const risk = stats?.riskBreakdown ?? {}

  // Recent history Dt — last 25 to keep the panel tight.
  const histCols: DtCol<SynthHistoryRow>[] = [
    {
      key: 'when',
      label: 'WHEN',
      width: '110px',
      className: 'mono',
      render: (r) => fmtAgo(r.createdAt),
    },
    {
      key: 'user',
      label: 'USER',
      width: '180px',
      className: 'mono',
      render: (r) => r.userEmail ?? r.userId ?? '—',
    },
    {
      key: 'intent',
      label: 'INTENT',
      render: (r) => (
        <span style={{ color: 'var(--fg-0)' }}>{(r.intent ?? '').slice(0, 80)}</span>
      ),
    },
    {
      key: 'risk',
      label: 'RISK',
      width: '80px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={riskStatus(r.riskLevel)} />
          <span style={{ fontFamily: 'var(--font-v3-mono)' }}>{r.riskLevel}</span>
        </span>
      ),
    },
    {
      key: 'status',
      label: 'STATUS',
      width: '80px',
      render: (r) => (
        <span style={{ color: r.success ? 'var(--ok)' : 'var(--err)' }}>
          {r.success ? 'ok' : 'fail'}
        </span>
      ),
    },
    {
      key: 'time',
      label: 'TIME',
      width: '80px',
      align: 'right',
      className: 'num',
      render: (r) => fmtMs(r.executionTimeMs),
    },
    {
      key: 'cost',
      label: 'COST',
      width: '80px',
      align: 'right',
      className: 'num',
      render: (r) => fmtUsd(r.costUsd),
    },
  ]

  return (
    <>
      {/* Risk breakdown KPI strip — always 4 cells, blank when stats empty */}
      <KpiGrid cols={4}>
        <Kpi
          label="low risk"
          value={statsLoading ? '…' : (risk.low ?? 0).toLocaleString()}
          tone="ok"
        />
        <Kpi
          label="medium risk"
          value={statsLoading ? '…' : (risk.medium ?? 0).toLocaleString()}
          tone="warn"
        />
        <Kpi
          label="high risk"
          value={statsLoading ? '…' : (risk.high ?? 0).toLocaleString()}
          tone="err"
        />
        <Kpi
          label="critical risk"
          value={statsLoading ? '…' : (risk.critical ?? 0).toLocaleString()}
          tone="err"
        />
      </KpiGrid>

      <SectionBar
        title="daily volume"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            7-day · /api/admin/synth/stats
          </span>
        }
      />
      <Panel>
        <PanelHead title="syntheses per day" count={daily.length} />
        {statsLoading && historyLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : daily.length === 0 ? (
          <EmptyInline pad>no synthesis activity in the selected window</EmptyInline>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            <MetricChart
              variant="bar"
              series={[
                {
                  name: 'syntheses',
                  data: daily.map((d) => d.count),
                  color: 'accent',
                },
              ]}
              xLabels={daily.map((d) => d.label)}
              yFormat="tok"
              height={180}
            />
          </div>
        )}
      </Panel>

      <SectionBar
        title="top synthesized tools"
        count={topCaps.length}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            by usage count · server rollup
          </span>
        }
      />
      <Panel>
        <PanelHead title="capability rankings" />
        {statsLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : topCaps.length === 0 ? (
          <EmptyInline pad>
            /stats returned no topCapabilities — check that the api service is
            on a build that includes the rollup
          </EmptyInline>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            <BarList
              items={topCaps.slice(0, 10).map((c) => ({
                name: <span style={{ fontFamily: 'var(--font-v3-mono)' }}>{c.name}</span>,
                value: c.count,
              }))}
            />
          </div>
        )}
      </Panel>

      <SectionBar
        title="recent syntheses"
        count={history.length}
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            last 50 · /api/admin/synth/history
          </span>
        }
      />
      <Panel>
        <PanelHead title="history" count={history.length} />
        {historyLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : (
          <Dt
            columns={histCols}
            rows={history.slice(0, 25)}
            rowKey={(r, i) => `${r.toolId}-${i}`}
            rowDataAttrs={(r: any) => {
              const s = String(r.status ?? r.outcome ?? '').toLowerCase()
              return {
                status: s === 'approved' || s === 'success' ? 'ok'
                  : s === 'rejected' || s === 'failed' ? 'err'
                  : s === 'pending' ? 'warn'
                  : 'idle',
              }
            }}
            empty={<EmptyInline pad>no synthesis history yet</EmptyInline>}
          />
        )}
      </Panel>
    </>
  )
}

export default SynthesisHubPage
