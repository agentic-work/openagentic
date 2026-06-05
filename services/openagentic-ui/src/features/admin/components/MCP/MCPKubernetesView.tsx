/**
 * MCPKubernetesView — Archetype C metrics dashboard.
 *
 * Cluster Health for the deployment namespace (VITE_K8S_NAMESPACE,
 * default "openagentic"), scoped to MCP-related infrastructure. Sources
 * data from kube-state-metrics via the admin prom proxy
 * (POST /api/admin/prom/query).
 *
 * Layout:
 *   PageHeader · KPI strip · Pod table (with EmptyState fallback)
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
  Pill,
  EmptyState,
  type PillTone,
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
  // Restart counts come back as floats from `increase()`, round to integer.
  return Math.round(n).toLocaleString();
}

function phaseTone(phase: string): PillTone {
  const p = phase.toLowerCase();
  if (p === 'running' || p === 'succeeded') return 'ok';
  if (p === 'pending') return 'warn';
  if (p === 'failed' || p === 'unknown') return 'err';
  return 'idle';
}

function relativeAge(createdEpochSeconds: number | null): string {
  if (createdEpochSeconds == null || !Number.isFinite(createdEpochSeconds)) return '—';
  const nowSec = Date.now() / 1000;
  const delta = Math.max(0, nowSec - createdEpochSeconds);
  if (delta < 60) return `${Math.round(delta)}s`;
  if (delta < 3600) return `${Math.round(delta / 60)}m`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h`;
  return `${Math.round(delta / 86400)}d`;
}

// ---------------------------------------------------------------------------
// Pod table row shape — built client-side by joining three KSM queries by pod label
// ---------------------------------------------------------------------------

interface PodRow {
  name: string;
  phase: string;          // Running / Pending / Failed / Unknown / ...
  restarts: number;
  node: string;
  ageSeconds: number | null;
}

function buildPodRows(
  infoSamples: PromSample[] | undefined,
  phaseSamples: PromSample[] | undefined,
  restartSamples: PromSample[] | undefined,
): PodRow[] {
  const phaseByPod = new Map<string, string>();
  for (const s of phaseSamples ?? []) {
    const pod = s.metric?.pod;
    const phase = s.metric?.phase;
    const v = Number(s.value?.[1] ?? 0);
    // kube_pod_status_phase emits one series per phase per pod; the active phase has value 1.
    if (pod && phase && v >= 1) {
      phaseByPod.set(pod, phase);
    }
  }

  // Sum restarts across all containers in a pod.
  const restartsByPod = new Map<string, number>();
  for (const s of restartSamples ?? []) {
    const pod = s.metric?.pod;
    if (!pod) continue;
    const n = Number(s.value?.[1] ?? 0);
    if (Number.isFinite(n)) {
      restartsByPod.set(pod, (restartsByPod.get(pod) ?? 0) + n);
    }
  }

  // kube_pod_info has one series per pod and carries the node label + a created_by_kind etc.
  // The metric value of kube_pod_info is the pod's creation timestamp on most exporter versions
  // (kube-state-metrics ≥1.4); when absent we fall back to '—' age.
  const rows: PodRow[] = [];
  const seen = new Set<string>();
  for (const s of infoSamples ?? []) {
    const pod = s.metric?.pod;
    if (!pod || seen.has(pod)) continue;
    seen.add(pod);
    const node = s.metric?.node ?? '—';
    const created = Number(s.value?.[1] ?? NaN);
    rows.push({
      name: pod,
      phase: phaseByPod.get(pod) ?? 'Unknown',
      restarts: Math.round(restartsByPod.get(pod) ?? 0),
      node,
      ageSeconds: Number.isFinite(created) && created > 0 ? created : null,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

// ---------------------------------------------------------------------------
// Queries — keep the panel focused (per the spec, do NOT add more)
// ---------------------------------------------------------------------------

// Namespace is deployment-specific. It was hardcoded to "agentic-dev" — the
// wrong namespace for OSS installs (the platform deploys into "openagentic"
// by default), so every kube_* tile read "—". Drive it from build-time env
// (VITE_K8S_NAMESPACE) so each deployment scopes these to its own namespace.
// 2026-06-04.
const K8S_NAMESPACE =
  (import.meta.env.VITE_K8S_NAMESPACE as string | undefined) || 'openagentic';
const NS = `namespace="${K8S_NAMESPACE}"`;

const Q_PODS_RUNNING =
  `sum(kube_pod_status_phase{${NS},phase="Running"})`;
const Q_PODS_NOT_RUNNING =
  `sum(kube_pod_status_phase{${NS},phase!="Running"})`;
const Q_NODES_READY =
  'sum(kube_node_status_condition{condition="Ready",status="true"})';
const Q_RESTARTS_1H =
  `sum(increase(kube_pod_container_status_restarts_total{${NS}}[1h]))`;

const Q_POD_INFO = `kube_pod_info{${NS}}`;
const Q_POD_PHASE = `kube_pod_status_phase{${NS}}`;
const Q_POD_RESTARTS = `kube_pod_container_status_restarts_total{${NS}}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const POD_COLUMNS: ResourceTableColumn[] = [
  { id: 'name', label: 'Name' },
  { id: 'status', label: 'Status', width: 140 },
  { id: 'restarts', label: 'Restarts', width: 100 },
  { id: 'node', label: 'Node' },
  { id: 'age', label: 'Age', width: 80 },
];

const MCPKubernetesView: React.FC = () => {
  // Refresh nonce — re-keys the queries on user-triggered Refresh.
  // We use queryKey-by-content via React Query, so calling refetch directly
  // is the cleanest; we collect each useQuery's refetch and fan them out.
  const [, setNonce] = useState(0);

  const podsRunning = usePromInstant(Q_PODS_RUNNING);
  const podsNotRunning = usePromInstant(Q_PODS_NOT_RUNNING);
  const nodesReady = usePromInstant(Q_NODES_READY);
  const restarts1h = usePromInstant(Q_RESTARTS_1H);

  const podInfo = usePromInstant(Q_POD_INFO);
  const podPhase = usePromInstant(Q_POD_PHASE);
  const podRestarts = usePromInstant(Q_POD_RESTARTS);

  const refetchAll = () => {
    setNonce((n) => n + 1);
    podsRunning.refetch();
    podsNotRunning.refetch();
    nodesReady.refetch();
    restarts1h.refetch();
    podInfo.refetch();
    podPhase.refetch();
    podRestarts.refetch();
  };

  const queries = [
    podsRunning,
    podsNotRunning,
    nodesReady,
    restarts1h,
    podInfo,
    podPhase,
    podRestarts,
  ];
  const isInitialLoading = queries.some((q) => q.isLoading && !q.data);
  const firstError = queries.find((q) => q.error)?.error ?? null;

  const podRows = useMemo<PodRow[]>(
    () => buildPodRows(podInfo.data, podPhase.data, podRestarts.data),
    [podInfo.data, podPhase.data, podRestarts.data],
  );

  const headerProps = {
    crumbs: ['Admin', 'Tools', 'Kubernetes'],
    title: 'Kubernetes',
    explainer:
      `Live pod and node health for the ${K8S_NAMESPACE} namespace, sourced from kube-state-metrics via the admin prom proxy.`,
    actions: [{ label: 'Refresh', onClick: refetchAll }],
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
  if (firstError && !podInfo.data && !podsRunning.data) {
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
  const podsNotRunningVal = sumScalars(podsNotRunning.data);
  const nodesReadyVal = firstScalar(nodesReady.data);
  const restarts1hVal = sumScalars(restarts1h.data);

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
          label="Pods not running"
          value={formatNumber(podsNotRunningVal)}
          tone={podsNotRunningVal != null && podsNotRunningVal > 0 ? 'warn' : 'default'}
        />
        <KpiTile
          label="Nodes ready"
          value={formatNumber(nodesReadyVal)}
          tone={nodesReadyVal != null && nodesReadyVal > 0 ? 'ok' : 'default'}
        />
        <KpiTile
          label="Containers restarted (1h)"
          value={formatNumber(restarts1hVal)}
          tone={restarts1hVal != null && restarts1hVal > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* Pod table ─────────────────────────────────────────────── */}
      <ResourceTable
        columns={POD_COLUMNS}
        rows={podRows.map((p) => ({
          id: p.name,
          cells: {
            name: (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.name}</span>
            ),
            status: <Pill tone={phaseTone(p.phase)}>{p.phase}</Pill>,
            restarts: (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  color:
                    p.restarts > 0
                      ? 'var(--ap-warn, var(--warn))'
                      : 'var(--ap-fg-1, var(--fg-1))',
                }}
              >
                {p.restarts}
              </span>
            ),
            node: (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.node}</span>
            ),
            age: (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--ap-fg-2, var(--fg-2))',
                }}
              >
                {relativeAge(p.ageSeconds)}
              </span>
            ),
          },
        }))}
        emptyState={
          <EmptyState
            title="No pods reported"
            hint={`kube-state-metrics may not be deployed or may not be scraping the ${K8S_NAMESPACE} namespace yet.`}
          />
        }
      />
    </div>
  );
};

export default MCPKubernetesView;
