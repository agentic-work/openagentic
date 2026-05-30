import * as React from 'react'
import {
  Banner,
  EmptyInline,
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  SectionBar,
  Dt,
  type DtCol,
  MetricChart,
} from '../../primitives-v3'
import { usePromInstant, usePromRange, type PromSample } from '../../hooks/useProm'

// ============================================================
// PromQL — same fragments as v2 ClusterHealthView
// ============================================================
const Q_PODS_RUNNING = 'sum(kube_pod_status_phase{phase="Running"})'
const Q_PODS_PENDING = 'sum(kube_pod_status_phase{phase="Pending"})'
const Q_PODS_FAILED = 'sum(kube_pod_status_phase{phase="Failed"})'
const Q_RESTARTS_1H = 'sum(increase(kube_pod_container_status_restarts_total[1h]))'
const Q_NODES_READY = 'sum(kube_node_status_condition{condition="Ready",status="true"})'
const Q_DEPLOY_DESIRED = 'sum(kube_deployment_spec_replicas)'
const Q_DEPLOY_AVAILABLE = 'sum(kube_deployment_status_replicas_available)'

const Q_PODS_RUNNING_BY_NS = 'sum by (namespace) (kube_pod_status_phase{phase="Running"})'
const Q_PODS_PENDING_BY_NS = 'sum by (namespace) (kube_pod_status_phase{phase="Pending"})'
const Q_PODS_FAILED_BY_NS = 'sum by (namespace) (kube_pod_status_phase{phase="Failed"})'
const Q_RESTARTS_1H_BY_NS = 'sum by (namespace) (increase(kube_pod_container_status_restarts_total[1h]))'

// Range queries — last 6h, ~60 points
const Q_RANGE_RUNNING = Q_PODS_RUNNING
const Q_RANGE_PENDING = Q_PODS_PENDING
const Q_RANGE_FAILED = Q_PODS_FAILED

// ============================================================
// Helpers
// ============================================================
function firstScalar(samples: PromSample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null
  const v = samples[0]?.value?.[1]
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface NamespaceRow {
  namespace: string
  podsRunning: number
  podsPending: number
  podsFailed: number
  restarts1h: number
}

function indexByNamespace(samples: PromSample[] | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of samples ?? []) {
    const ns = s.metric?.namespace
    if (!ns) continue
    const n = Number(s.value?.[1] ?? 0)
    if (!Number.isFinite(n)) continue
    out.set(ns, (out.get(ns) ?? 0) + n)
  }
  return out
}

function buildRows(
  running: PromSample[] | undefined,
  pending: PromSample[] | undefined,
  failed: PromSample[] | undefined,
  restarts: PromSample[] | undefined,
): NamespaceRow[] {
  const r = indexByNamespace(running)
  const p = indexByNamespace(pending)
  const f = indexByNamespace(failed)
  const x = indexByNamespace(restarts)
  const all = new Set<string>([...r.keys(), ...p.keys(), ...f.keys(), ...x.keys()])
  const rows: NamespaceRow[] = []
  for (const ns of all) {
    rows.push({
      namespace: ns,
      podsRunning: Math.round(r.get(ns) ?? 0),
      podsPending: Math.round(p.get(ns) ?? 0),
      podsFailed: Math.round(f.get(ns) ?? 0),
      restarts1h: Math.round(x.get(ns) ?? 0),
    })
  }
  rows.sort((a, b) => a.namespace.localeCompare(b.namespace))
  return rows
}

function rangeToSeries(samples: PromSample[] | undefined): {
  data: number[]
  labels: string[]
} {
  // Range queries with `sum(...)` (no by-clause) typically return one
  // sample with a `values` array. Take the first if present.
  const first = samples?.[0]
  const pts = first?.values ?? []
  return {
    data: pts.map(([, v]) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }),
    labels: pts.map(([t]) => {
      const d = new Date(t * 1000)
      const z = (n: number) => String(n).padStart(2, '0')
      return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
    }),
  }
}

export const ClusterPane: React.FC = () => {
  // Instant queries — KPI strip + per-namespace breakdown
  const podsRunning = usePromInstant(Q_PODS_RUNNING)
  const podsPending = usePromInstant(Q_PODS_PENDING)
  const podsFailed = usePromInstant(Q_PODS_FAILED)
  const restarts1h = usePromInstant(Q_RESTARTS_1H)
  const nodesReady = usePromInstant(Q_NODES_READY)
  const deployDesired = usePromInstant(Q_DEPLOY_DESIRED)
  const deployAvailable = usePromInstant(Q_DEPLOY_AVAILABLE)

  const runningByNs = usePromInstant(Q_PODS_RUNNING_BY_NS)
  const pendingByNs = usePromInstant(Q_PODS_PENDING_BY_NS)
  const failedByNs = usePromInstant(Q_PODS_FAILED_BY_NS)
  const restartsByNs = usePromInstant(Q_RESTARTS_1H_BY_NS)

  // Range queries — 6h trend
  const rangeRunning = usePromRange(Q_RANGE_RUNNING, { minutes: 360 })
  const rangePending = usePromRange(Q_RANGE_PENDING, { minutes: 360 })
  const rangeFailed = usePromRange(Q_RANGE_FAILED, { minutes: 360 })

  const running = firstScalar(podsRunning.data) ?? 0
  const pending = firstScalar(podsPending.data) ?? 0
  const failed = firstScalar(podsFailed.data) ?? 0
  const restarts = firstScalar(restarts1h.data) ?? 0
  const nodes = firstScalar(nodesReady.data) ?? 0
  const desired = firstScalar(deployDesired.data) ?? 0
  const available = firstScalar(deployAvailable.data) ?? 0
  const deployGap = Math.max(0, desired - available)

  const rows = buildRows(
    runningByNs.data,
    pendingByNs.data,
    failedByNs.data,
    restartsByNs.data,
  )

  const runningSeries = rangeToSeries(rangeRunning.data)
  const pendingSeries = rangeToSeries(rangePending.data)
  const failedSeries = rangeToSeries(rangeFailed.data)
  const trendLabels =
    runningSeries.labels.length > 0
      ? runningSeries.labels
      : pendingSeries.labels.length > 0
        ? pendingSeries.labels
        : failedSeries.labels
  const trendHasData =
    runningSeries.data.length > 0 ||
    pendingSeries.data.length > 0 ||
    failedSeries.data.length > 0

  const cols: DtCol<NamespaceRow>[] = [
    { key: 'ns', label: 'namespace', className: 'mono', render: (r) => r.namespace },
    { key: 'r', label: 'running', align: 'right', className: 'num', render: (r) => r.podsRunning.toLocaleString() },
    {
      key: 'p',
      label: 'pending',
      align: 'right',
      className: 'num',
      render: (r) => (
        <span style={{ color: r.podsPending > 0 ? 'var(--warn)' : 'var(--fg-2)' }}>
          {r.podsPending.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'f',
      label: 'failed',
      align: 'right',
      className: 'num',
      render: (r) => (
        <span style={{ color: r.podsFailed > 0 ? 'var(--err)' : 'var(--fg-2)' }}>
          {r.podsFailed.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'x',
      label: 'restarts (1h)',
      align: 'right',
      className: 'num',
      render: (r) => (
        <span style={{ color: r.restarts1h > 0 ? 'var(--warn)' : 'var(--fg-2)' }}>
          {r.restarts1h.toLocaleString()}
        </span>
      ),
    },
  ]

  const anyError =
    podsRunning.isError ||
    podsPending.isError ||
    podsFailed.isError ||
    restarts1h.isError ||
    nodesReady.isError

  return (
    <>
      <SectionBar
        title="cluster health (live)"
        right={<span style={{ color: 'var(--fg-3)' }}>kube-state-metrics</span>}
      />
      {anyError && (
        <Banner level="err" label="prom error">
          one or more <span className="accent">/api/admin/prom/query</span> calls
          failed — KPIs may be stale or empty
        </Banner>
      )}

      <KpiGrid cols={5}>
        <Kpi
          label="pods running"
          value={podsRunning.isLoading ? '…' : running.toLocaleString()}
          sub="across all namespaces"
          tone="ok"
        />
        <Kpi
          label="pods pending"
          value={podsPending.isLoading ? '…' : pending.toLocaleString()}
          sub="awaiting schedule"
          tone={pending > 0 ? 'warn' : 'default'}
        />
        <Kpi
          label="pods failed"
          value={podsFailed.isLoading ? '…' : failed.toLocaleString()}
          sub="terminated · errored"
          tone={failed > 0 ? 'err' : 'default'}
        />
        <Kpi
          label="restarts (1h)"
          value={restarts1h.isLoading ? '…' : Math.round(restarts).toLocaleString()}
          sub="container_status_restarts"
          tone={restarts >= 5 ? 'warn' : 'default'}
        />
        <Kpi
          label="nodes ready"
          value={nodesReady.isLoading ? '…' : Math.round(nodes).toLocaleString()}
          sub={`${available.toLocaleString()}/${desired.toLocaleString()} replicas · ${deployGap.toLocaleString()} short`}
          tone={deployGap > 0 ? 'warn' : 'ok'}
        />
      </KpiGrid>

      <SectionBar title="per-namespace breakdown" />
      <Panel>
        <PanelHead title="namespaces" count={rows.length} />
        {runningByNs.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : rows.length === 0 ? (
          <EmptyInline pad>kube-state-metrics returned no namespaces</EmptyInline>
        ) : (
          <Dt
            columns={cols}
            rows={rows}
            rowKey={(r) => r.namespace}
            rowDataAttrs={(r: any) => {
              const failed = Number(r.podsFailing ?? r.podsFailed ?? 0)
              const pending = Number(r.podsPending ?? 0)
              return {
                status: failed > 0 ? 'err' : pending > 0 ? 'warn' : 'ok',
              }
            }}
          />
        )}
      </Panel>

      <SectionBar title="6h pod-status trend" />
      <Panel>
        <PanelHead title="running · pending · failed" count={`${runningSeries.data.length} pts`} />
        {rangeRunning.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : !trendHasData ? (
          <EmptyInline pad>no trend data returned by prom</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="area"
              series={[
                { name: 'running', data: runningSeries.data, color: 'ok' },
                { name: 'pending', data: pendingSeries.data, color: 'warn' },
                { name: 'failed', data: failedSeries.data, color: 'err' },
              ]}
              xLabels={trendLabels}
              showLegend
              height={200}
            />
          </div>
        )}
      </Panel>
    </>
  )
}

export default ClusterPane
