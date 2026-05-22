/**
 * ClusterHealthView — Archetype C metrics dashboard.
 *
 * Cluster-wide health surface under Monitoring & Logs. Sources data from
 * kube-state-metrics via the admin prom proxy (POST /api/admin/prom/query).
 *
 * Scope contrast with MCPKubernetesView: that view is namespace-scoped to
 * `agentic-dev` and focused on MCP infrastructure pods. THIS view is
 * cluster-wide — pods/deployments/restarts/nodes across every namespace,
 * with a per-namespace breakdown table.
 *
 * Layout:
 *   PageHeader · 6-tile KPI strip · Per-namespace ResourceTable (with EmptyState)
 *
 * Tokens only — no hex literals. Loading and error states render the
 * PageHeader (loading-guard hoist pattern) so the chrome is consistent
 * across every render path.
 */

import React, { useMemo, useState } from 'react';
import { usePromInstant, type PromSample } from '../../hooks/useProm';
import {
  PageHeader,
  KpiTile,
  ResourceTable,
  EmptyState,
  type ResourceTableColumn,
} from '../../primitives-v2';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstScalar(samples: PromSample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null;
  const v = samples[0]?.value?.[1];
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sumScalars(samples: PromSample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null;
  let total = 0;
  let any = false;
  for (const s of samples) {
    const v = s?.value?.[1];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) {
      total += n;
      any = true;
    }
  }
  return any ? total : null;
}

function formatNumber(n: number | null): string {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}

// ---------------------------------------------------------------------------
// Per-namespace breakdown — built client-side by joining four KSM queries by
// the `namespace` label. We deliberately avoid a multi-vector PromQL join in
// the proxy because the proxy is simple and any binop with `on(...)` against a
// missing series will silently drop rows.
// ---------------------------------------------------------------------------

interface NamespaceRow {
  namespace: string;
  podsRunning: number;
  podsPending: number;
  podsFailed: number;
  restarts1h: number;
}

function indexByNamespace(samples: PromSample[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of samples ?? []) {
    const ns = s.metric?.namespace;
    if (!ns) continue;
    const n = Number(s.value?.[1] ?? 0);
    if (!Number.isFinite(n)) continue;
    out.set(ns, (out.get(ns) ?? 0) + n);
  }
  return out;
}

function buildNamespaceRows(
  runningByNs: PromSample[] | undefined,
  pendingByNs: PromSample[] | undefined,
  failedByNs: PromSample[] | undefined,
  restartsByNs: PromSample[] | undefined,
): NamespaceRow[] {
  const running = indexByNamespace(runningByNs);
  const pending = indexByNamespace(pendingByNs);
  const failed = indexByNamespace(failedByNs);
  const restarts = indexByNamespace(restartsByNs);

  const namespaces = new Set<string>([
    ...running.keys(),
    ...pending.keys(),
    ...failed.keys(),
    ...restarts.keys(),
  ]);

  const rows: NamespaceRow[] = [];
  for (const ns of namespaces) {
    rows.push({
      namespace: ns,
      podsRunning: Math.round(running.get(ns) ?? 0),
      podsPending: Math.round(pending.get(ns) ?? 0),
      podsFailed: Math.round(failed.get(ns) ?? 0),
      restarts1h: Math.round(restarts.get(ns) ?? 0),
    });
  }
  rows.sort((a, b) => a.namespace.localeCompare(b.namespace));
  return rows;
}

// ---------------------------------------------------------------------------
// Queries — cluster-wide (no namespace selector). Per-namespace breakdown uses
// `sum by (namespace) (...)` to keep the join client-side and avoid relying on
// the prom proxy supporting multi-vector ops.
//
// For the "deployments not at desired replicas" KPI we deliberately fall back
// to two scalar queries (spec_replicas total vs available_replicas total) and
// subtract client-side, instead of pushing a `kube_deployment_spec_replicas !=
// on(namespace,deployment) kube_deployment_status_replicas_available` join
// through the proxy. Same rationale as the per-namespace breakdown.
// ---------------------------------------------------------------------------

const Q_PODS_RUNNING = 'sum(kube_pod_status_phase{phase="Running"})';
const Q_PODS_PENDING = 'sum(kube_pod_status_phase{phase="Pending"})';
const Q_PODS_FAILED = 'sum(kube_pod_status_phase{phase="Failed"})';
const Q_DEPLOY_DESIRED = 'sum(kube_deployment_spec_replicas)';
const Q_DEPLOY_AVAILABLE = 'sum(kube_deployment_status_replicas_available)';
const Q_RESTARTS_1H = 'sum(increase(kube_pod_container_status_restarts_total[1h]))';
const Q_NODES_READY = 'sum(kube_node_status_condition{condition="Ready",status="true"})';

const Q_PODS_RUNNING_BY_NS =
  'sum by (namespace) (kube_pod_status_phase{phase="Running"})';
const Q_PODS_PENDING_BY_NS =
  'sum by (namespace) (kube_pod_status_phase{phase="Pending"})';
const Q_PODS_FAILED_BY_NS =
  'sum by (namespace) (kube_pod_status_phase{phase="Failed"})';
const Q_RESTARTS_1H_BY_NS =
  'sum by (namespace) (increase(kube_pod_container_status_restarts_total[1h]))';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const NS_COLUMNS: ResourceTableColumn[] = [
  { id: 'namespace', label: 'Namespace' },
  { id: 'running', label: 'Pods running', width: 130 },
  { id: 'pending', label: 'Pods pending', width: 130 },
  { id: 'failed', label: 'Pods failed', width: 120 },
  { id: 'restarts', label: 'Restarts (1h)', width: 130 },
];

const ClusterHealthView: React.FC = () => {
  // Refresh nonce — used for ergonomic callback identity across renders.
  const [, setNonce] = useState(0);

  // KPI queries (6 tiles — deployments-not-at-desired derives from two)
  const podsRunning = usePromInstant(Q_PODS_RUNNING);
  const podsPending = usePromInstant(Q_PODS_PENDING);
  const podsFailed = usePromInstant(Q_PODS_FAILED);
  const deployDesired = usePromInstant(Q_DEPLOY_DESIRED);
  const deployAvailable = usePromInstant(Q_DEPLOY_AVAILABLE);
  const restarts1h = usePromInstant(Q_RESTARTS_1H);
  const nodesReady = usePromInstant(Q_NODES_READY);

  // Per-namespace breakdown queries
  const podsRunningByNs = usePromInstant(Q_PODS_RUNNING_BY_NS);
  const podsPendingByNs = usePromInstant(Q_PODS_PENDING_BY_NS);
  const podsFailedByNs = usePromInstant(Q_PODS_FAILED_BY_NS);
  const restartsByNs = usePromInstant(Q_RESTARTS_1H_BY_NS);

  const refetchAll = () => {
    setNonce((n) => n + 1);
    podsRunning.refetch();
    podsPending.refetch();
    podsFailed.refetch();
    deployDesired.refetch();
    deployAvailable.refetch();
    restarts1h.refetch();
    nodesReady.refetch();
    podsRunningByNs.refetch();
    podsPendingByNs.refetch();
    podsFailedByNs.refetch();
    restartsByNs.refetch();
  };

  const queries = [
    podsRunning,
    podsPending,
    podsFailed,
    deployDesired,
    deployAvailable,
    restarts1h,
    nodesReady,
    podsRunningByNs,
    podsPendingByNs,
    podsFailedByNs,
    restartsByNs,
  ];
  const isInitialLoading = queries.some((q) => q.isLoading && !q.data);
  const firstError = queries.find((q) => q.error)?.error ?? null;

  const namespaceRows = useMemo<NamespaceRow[]>(
    () =>
      buildNamespaceRows(
        podsRunningByNs.data,
        podsPendingByNs.data,
        podsFailedByNs.data,
        restartsByNs.data,
      ),
    [podsRunningByNs.data, podsPendingByNs.data, podsFailedByNs.data, restartsByNs.data],
  );

  const headerProps = {
    crumbs: ['Admin', 'Monitoring', 'Cluster Health'],
    title: 'Cluster Health',
    explainer:
      'Live deployment, pod, and resource health from kube-state-metrics across the cluster.',
    actions: [{ label: 'Refresh', onClick: refetchAll, primary: true }],
  };

  // ── Loading guard (chrome must render in BOTH states) ───────────────
  if (isInitialLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <PageHeader {...headerProps} />
        <div
          style={{
            padding: '40px 16px',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--ap-fg-3, var(--fg-3))',
          }}
        >
          Loading cluster metrics…
        </div>
      </div>
    );
  }

  // ── Error guard ─────────────────────────────────────────────────────
  if (firstError && queries.every((q) => !q.data)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <PageHeader {...headerProps} />
        <div
          role="alert"
          style={{
            padding: '20px 18px',
            background: 'var(--ap-err-soft, var(--err-soft))',
            color: 'var(--ap-err, var(--err))',
            border: '1px solid var(--ap-err, var(--err))',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 13 }}>
            Could not load cluster metrics:{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {String(firstError instanceof Error ? firstError.message : firstError)}
            </span>
          </div>
          <button
            type="button"
            onClick={refetchAll}
            style={{
              fontFamily: 'var(--font-ui, inherit)',
              fontSize: 12,
              fontWeight: 500,
              padding: '6px 14px',
              borderRadius: 3,
              background: 'var(--ap-accent, var(--accent))',
              color: 'var(--ap-fg-on-accent, white)',
              border: '1px solid var(--ap-accent, var(--accent))',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Loaded state ────────────────────────────────────────────────────
  const podsRunningVal = sumScalars(podsRunning.data);
  const podsPendingVal = sumScalars(podsPending.data);
  const podsFailedVal = sumScalars(podsFailed.data);
  const deployDesiredVal = firstScalar(deployDesired.data);
  const deployAvailableVal = firstScalar(deployAvailable.data);
  const deployBehindVal =
    deployDesiredVal != null && deployAvailableVal != null
      ? Math.max(0, deployDesiredVal - deployAvailableVal)
      : null;
  const restarts1hVal = sumScalars(restarts1h.data);
  const nodesReadyVal = firstScalar(nodesReady.data);

  // Empty-state heuristic — if every cluster-wide KPI returned no series, KSM
  // is almost certainly not reporting at all (vs partial/missing metrics).
  const allEmpty =
    podsRunning.data?.length === 0 &&
    podsPending.data?.length === 0 &&
    podsFailed.data?.length === 0 &&
    nodesReady.data?.length === 0 &&
    podsRunningByNs.data?.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader {...headerProps} />

      {/* KPI strip ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <KpiTile
          label="Pods running"
          value={formatNumber(podsRunningVal)}
          tone={podsRunningVal != null && podsRunningVal > 0 ? 'ok' : 'default'}
        />
        <KpiTile
          label="Pods pending"
          value={formatNumber(podsPendingVal)}
          tone={podsPendingVal != null && podsPendingVal > 0 ? 'warn' : 'default'}
        />
        <KpiTile
          label="Pods failed"
          value={formatNumber(podsFailedVal)}
          tone={podsFailedVal != null && podsFailedVal > 0 ? 'err' : 'default'}
        />
        <KpiTile
          label="Deployments behind desired"
          value={formatNumber(deployBehindVal)}
          tone={deployBehindVal != null && deployBehindVal > 0 ? 'warn' : 'default'}
        />
        <KpiTile
          label="Container restarts (1h)"
          value={formatNumber(restarts1hVal)}
          tone={restarts1hVal != null && restarts1hVal > 0 ? 'warn' : 'default'}
        />
        <KpiTile
          label="Nodes ready"
          value={formatNumber(nodesReadyVal)}
          tone={nodesReadyVal != null && nodesReadyVal > 0 ? 'ok' : 'default'}
        />
      </div>

      {/* Per-namespace breakdown ───────────────────────────────── */}
      {allEmpty ? (
        <EmptyState
          title="kube-state-metrics not reporting"
          hint="No cluster-wide pod/node series returned. Confirm kube-state-metrics is deployed and scraped by Prometheus — see /docs/runbooks/observability for the standard install."
        />
      ) : (
        <ResourceTable
          columns={NS_COLUMNS}
          rows={namespaceRows.map((r) => ({
            id: r.namespace,
            cells: {
              namespace: (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {r.namespace}
                </span>
              ),
              running: (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--ap-fg-1, var(--fg-1))',
                  }}
                >
                  {r.podsRunning}
                </span>
              ),
              pending: (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color:
                      r.podsPending > 0
                        ? 'var(--ap-warn, var(--warn))'
                        : 'var(--ap-fg-1, var(--fg-1))',
                  }}
                >
                  {r.podsPending}
                </span>
              ),
              failed: (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color:
                      r.podsFailed > 0
                        ? 'var(--ap-err, var(--err))'
                        : 'var(--ap-fg-1, var(--fg-1))',
                  }}
                >
                  {r.podsFailed}
                </span>
              ),
              restarts: (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color:
                      r.restarts1h > 0
                        ? 'var(--ap-warn, var(--warn))'
                        : 'var(--ap-fg-1, var(--fg-1))',
                  }}
                >
                  {r.restarts1h}
                </span>
              ),
            },
          }))}
          emptyState={
            <EmptyState
              title="No namespace metrics"
              hint="kube-state-metrics returned no per-namespace pod data. For deeper restart history and event traces, open Grafana."
            />
          }
        />
      )}
    </div>
  );
};

export default ClusterHealthView;
