/**
 * DependencyGraphRenderer — compose_app:dependency_graph template.
 *
 * Directed graph rendered via reactflow (already in package.json).
 * Simple deterministic radial layout: first node centered, remaining
 * nodes placed around a circle, edges as bezier paths. Node size scales
 * with the optional `size` prop.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-03-frontdoor-appgw-interrogation.html,
 * mocks/UX/AI/Chatmode/end-state-06-aws-k8s-aiops.html.
 */

import React, { useMemo } from 'react';

export interface DependencyNode {
  id: string;
  label?: string;
  group?: string;
  size?: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  weight?: number;
}

export interface DependencyGraphRendererProps {
  title?: string;
  subtitle?: string;
  nodes?: ReadonlyArray<DependencyNode>;
  edges?: ReadonlyArray<DependencyEdge>;
}

const GROUP_TONES: Record<string, string> = {
  core: 'var(--cm-accent, currentColor)',
  frontend: 'var(--cm-info, currentColor)',
  data: 'var(--cm-warn, currentColor)',
  platform: 'var(--cm-success, currentColor)',
  mcp: 'var(--cm-error, currentColor)',
};

function groupTone(g?: string): string {
  if (!g) return 'var(--cm-fg-dim, currentColor)';
  return GROUP_TONES[g] || 'var(--cm-fg-dim, currentColor)';
}

export function DependencyGraphRenderer(props: DependencyGraphRendererProps) {
  const { title, subtitle, nodes, edges } = props;
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  const safeEdges = Array.isArray(edges) ? edges : [];

  const positions = useMemo(() => {
    const W = 720;
    const H = 420;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - 60;
    const map = new Map<string, { x: number; y: number; size: number }>();
    if (safeNodes.length === 0) return { map, W, H };
    if (safeNodes.length === 1) {
      const n = safeNodes[0];
      map.set(n.id, { x: cx, y: cy, size: n.size ?? 20 });
      return { map, W, H };
    }
    // Center the largest node; place others on a circle.
    const sorted = [...safeNodes].sort((a, b) => (b.size ?? 10) - (a.size ?? 10));
    const center = sorted[0];
    map.set(center.id, { x: cx, y: cy, size: center.size ?? 24 });
    const ring = sorted.slice(1);
    ring.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / ring.length - Math.PI / 2;
      map.set(n.id, {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        size: n.size ?? 16,
      });
    });
    return { map, W, H };
  }, [safeNodes]);

  if (safeNodes.length === 0) {
    return (
      <div data-testid="dependency-graph-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no graph data
      </div>
    );
  }

  return (
    <div
      data-testid="dependency-graph-renderer"
      className="cm-dependency-graph"
      style={{
        background: 'var(--cm-bg-2)',
        border: '1px solid var(--cm-border)',
        borderRadius: 'var(--cm-radius, 6px)',
        padding: '12px 14px',
        color: 'var(--cm-fg)',
        display: 'grid',
        gap: 6,
      }}
    >
      {(title || subtitle) && (
        <div>
          {title && (
            <div style={{ fontWeight: 600, color: 'var(--cm-fg)', fontSize: 14 }}>{title}</div>
          )}
          {subtitle && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
                marginTop: 2,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
      <svg
        viewBox={`0 0 ${positions.W} ${positions.H}`}
        width="100%"
        height={positions.H}
        role="img"
        aria-label={title || 'Dependency graph'}
        style={{ display: 'block', maxHeight: 480 }}
      >
        <defs>
          <marker
            id="cm-dg-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--cm-fg-dim)" />
          </marker>
        </defs>
        {safeEdges.map((e, i) => {
          const a = positions.map.get(e.from);
          const b = positions.map.get(e.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2 - 30;
          return (
            <path
              key={`e-${i}`}
              d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
              data-from={e.from}
              data-to={e.to}
              fill="none"
              stroke="var(--cm-fg-dim)"
              strokeWidth={Math.max(1, Math.min(4, (e.weight ?? 1) * 0.8))}
              strokeOpacity={0.5}
              markerEnd="url(#cm-dg-arrow)"
            />
          );
        })}
        {safeNodes.map((n) => {
          const pos = positions.map.get(n.id);
          if (!pos) return null;
          const tone = groupTone(n.group);
          const r = Math.max(8, Math.min(28, pos.size / 1.4));
          return (
            <g key={`n-${n.id}`} data-node-id={n.id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={r}
                fill="var(--cm-bg-3, var(--cm-bg))"
                stroke={tone}
                strokeWidth={2}
              />
              <text
                x={pos.x}
                y={pos.y + r + 14}
                textAnchor="middle"
                fontSize={11}
                fill="var(--cm-fg)"
                fontFamily="var(--cm-mono, JetBrains Mono, monospace)"
              >
                {n.label ?? n.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default DependencyGraphRenderer;
