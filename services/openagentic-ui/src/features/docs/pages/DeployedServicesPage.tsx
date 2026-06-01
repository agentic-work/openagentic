/**
 * DeployedServicesPage — live cluster topology + per-service image SHAs.
 *
 * Hits GET /api/cluster/services every 30s; renders each Deployment/StatefulSet
 * as a React Flow node showing image tag + sha256 short digest + replica
 * health, with edges representing known service-to-service calls.
 *
 * Visible to ALL authenticated users (admin + RO) — cluster topology is
 * platform documentation, not operational data.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeProps,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ── Types matching /api/cluster/services response ───────────────────────────
interface ReleaseInfo {
  version: string;
  codename: string;
  releaseDate?: string;
}
interface ServiceRow {
  name: string;
  displayName: string;
  kind: 'Deployment' | 'StatefulSet';
  image: string;
  imageDigest: string | null;
  tag: string;
  shaShort: string | null;
  replicas: { desired: number; ready: number; available: number };
  status: 'available' | 'progressing' | 'unavailable' | 'unknown';
  lastTransitionTime: string | null;
  labels: Record<string, string>;
  category: 'core' | 'data' | 'mcp' | 'agent' | 'auxiliary';
  edges: string[];
}
interface ClusterResponse {
  release: ReleaseInfo;
  namespace: string;
  scrapedAt: string;
  services: ServiceRow[];
}

// ── Category → colour ───────────────────────────────────────────────────────
const CATEGORY_STYLE: Record<ServiceRow['category'], { bg: string; border: string; label: string }> = {
  core:       { bg: '#1e3a5f', border: '#3b82f6', label: 'Core' },
  data:       { bg: '#3f1d4a', border: '#a855f7', label: 'Data' },
  mcp:        { bg: '#1f3a2a', border: '#10b981', label: 'MCP' },
  agent:      { bg: '#3a2e1d', border: '#f59e0b', label: 'Agent' },
  auxiliary:  { bg: '#2a2a2a', border: '#6b7280', label: 'Aux' },
};

const STATUS_DOT: Record<ServiceRow['status'], string> = {
  available: '#10b981',
  progressing: '#f59e0b',
  unavailable: '#ef4444',
  unknown: '#6b7280',
};

// ── Custom node ─────────────────────────────────────────────────────────────
const ServiceNode: React.FC<NodeProps> = ({ data }) => {
  const svc = data.svc as ServiceRow;
  const [showFullDigest, setShowFullDigest] = useState(false);
  const style = CATEGORY_STYLE[svc.category];

  return (
    <div
      style={{
        background: style.bg,
        border: `1.5px solid ${style.border}`,
        borderRadius: 10,
        padding: '10px 12px',
        minWidth: 220,
        color: '#e5e7eb',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: style.border }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{svc.displayName}</div>
        <span
          style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: 4,
            background: STATUS_DOT[svc.status],
            boxShadow: `0 0 6px ${STATUS_DOT[svc.status]}`,
          }}
          title={svc.status}
        />
      </div>

      <div style={{ marginTop: 4, color: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }}>
        {svc.kind} · {svc.replicas.ready}/{svc.replicas.desired} ready
      </div>

      <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 10, color: '#cbd5e1', wordBreak: 'break-all' }}>
        <span style={{ color: '#94a3b8' }}>tag:</span> <span style={{ color: '#fbbf24' }}>{svc.tag}</span>
      </div>

      {svc.shaShort && (
        <div
          style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 10, color: '#cbd5e1', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); setShowFullDigest(s => !s); }}
          title="Click to expand full sha256 digest"
        >
          <span style={{ color: '#94a3b8' }}>sha:</span>{' '}
          <span style={{ color: '#22d3ee' }}>
            {showFullDigest && svc.imageDigest ? svc.imageDigest : svc.shaShort}
          </span>
        </div>
      )}

      <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9ca3af' }}>
        <span>{style.label}</span>
        {svc.lastTransitionTime && (
          <span title={`Last transition: ${svc.lastTransitionTime}`}>
            {new Date(svc.lastTransitionTime).toLocaleDateString()}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: style.border }} />
    </div>
  );
};

const NODE_TYPES = { service: ServiceNode };

// ── ELK-free simple grid layout (deterministic, no extra dep) ───────────────
function layout(services: ServiceRow[]): { nodes: Node[]; edges: Edge[] } {
  const byCategory = new Map<ServiceRow['category'], ServiceRow[]>();
  for (const s of services) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }
  const order: ServiceRow['category'][] = ['core', 'mcp', 'agent', 'data', 'auxiliary'];
  const nodes: Node[] = [];
  const positionByName = new Map<string, { x: number; y: number }>();
  let col = 0;
  for (const cat of order) {
    const list = byCategory.get(cat) || [];
    list.forEach((svc, row) => {
      const x = col * 320;
      const y = row * 180 + 40;
      nodes.push({
        id: svc.name,
        type: 'service',
        position: { x, y },
        data: { svc },
      });
      positionByName.set(svc.name, { x, y });
    });
    if (list.length > 0) col += 1;
  }

  const edges: Edge[] = [];
  for (const s of services) {
    for (const target of s.edges) {
      if (positionByName.has(target)) {
        edges.push({
          id: `${s.name}->${target}`,
          source: s.name,
          target,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
          style: { stroke: '#6b7280', strokeWidth: 1, opacity: 0.6 },
        });
      }
    }
  }
  return { nodes, edges };
}

// ── Page component ──────────────────────────────────────────────────────────
const DeployedServicesPage: React.FC = () => {
  const [data, setData] = useState<ClusterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch('/api/cluster/services', { credentials: 'include' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ message: r.statusText }));
        throw new Error(body.message || `HTTP ${r.status}`);
      }
      const json = (await r.json()) as ClusterResponse;
      setData(json);
      setError(null);
      setRefreshedAt(new Date());
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };
    return layout(data.services);
  }, [data]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border, #2a2a2a)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--color-text, #f3f4f6)' }}>
            Deployed Services
          </h1>
          {data?.release && (
            <span style={{
              padding: '3px 10px', borderRadius: 14, fontSize: 12, fontWeight: 600,
              background: 'rgba(59,130,246,0.18)', color: '#60a5fa',
            }}>
              v{data.release.version} — {data.release.codename}
            </span>
          )}
          {data && (
            <span style={{ fontSize: 11, color: 'var(--color-textMuted, #94a3b8)', fontFamily: 'monospace' }}>
              namespace: {data.namespace}
            </span>
          )}
        </div>
        <p style={{ marginTop: 6, marginBottom: 0, color: 'var(--color-textSecondary, #9ca3af)', fontSize: 13 }}>
          Live topology of every service running in this cluster — image tag, container sha256 digest, replica
          health. Refreshes every 30s. Click a service's <code>sha</code> to expand the full digest.
        </p>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-textMuted, #6b7280)' }}>
          {loading && !data && '⏳ Loading cluster state…'}
          {error && <span style={{ color: '#ef4444' }}>⚠ {error}</span>}
          {refreshedAt && !error && (
            <>Last refreshed {refreshedAt.toLocaleTimeString()} {data && `· ${data.services.length} services`}</>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: '8px 24px', display: 'flex', gap: 14, fontSize: 11, color: 'var(--color-textSecondary, #9ca3af)', borderBottom: '1px solid var(--color-border, #2a2a2a)' }}>
        {(Object.keys(CATEGORY_STYLE) as ServiceRow['category'][]).map(cat => (
          <span key={cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: CATEGORY_STYLE[cat].border }} />
            {CATEGORY_STYLE[cat].label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10 }}>
          {(Object.keys(STATUS_DOT) as ServiceRow['status'][]).map(s => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: STATUS_DOT[s] }} />
              {s}
            </span>
          ))}
        </span>
      </div>

      {/* React Flow canvas */}
      <div style={{ flex: 1, minHeight: 500 }}>
        {nodes.length > 0 ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#3a3a3a" />
            <Controls />
            <MiniMap
              nodeColor={(n) => CATEGORY_STYLE[(n.data as any)?.svc?.category as ServiceRow['category']]?.border || '#6b7280'}
              maskColor="rgba(0,0,0,0.5)"
              style={{ background: '#1a1a1a' }}
            />
          </ReactFlow>
        ) : (
          !loading && !error && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-textMuted, #6b7280)' }}>
              No services returned. The cluster endpoint may be running outside k8s.
            </div>
          )
        )}
      </div>

      {/* Per-service raw table for accessibility / copy-paste */}
      {data && data.services.length > 0 && (
        <details style={{ borderTop: '1px solid var(--color-border, #2a2a2a)', padding: '8px 24px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--color-textSecondary, #9ca3af)' }}>
            Raw table ({data.services.length} services)
          </summary>
          <div style={{ marginTop: 8, overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11, fontFamily: 'monospace', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--color-textMuted, #94a3b8)', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>name</th>
                  <th style={{ padding: '4px 8px' }}>image</th>
                  <th style={{ padding: '4px 8px' }}>sha256 digest</th>
                  <th style={{ padding: '4px 8px' }}>ready</th>
                  <th style={{ padding: '4px 8px' }}>status</th>
                </tr>
              </thead>
              <tbody>
                {data.services.map(s => (
                  <tr key={s.name} style={{ borderTop: '1px solid var(--color-border, #2a2a2a)' }}>
                    <td style={{ padding: '4px 8px', color: '#e5e7eb' }}>{s.name}</td>
                    <td style={{ padding: '4px 8px', color: '#fbbf24' }}>{s.image}</td>
                    <td style={{ padding: '4px 8px', color: '#22d3ee', wordBreak: 'break-all' }}>{s.imageDigest || '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{s.replicas.ready}/{s.replicas.desired}</td>
                    <td style={{ padding: '4px 8px', color: STATUS_DOT[s.status] }}>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
};

export default DeployedServicesPage;
