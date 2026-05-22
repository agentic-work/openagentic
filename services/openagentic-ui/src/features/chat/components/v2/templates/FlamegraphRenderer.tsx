/**
 * FlamegraphRenderer — compose_app:flamegraph template.
 *
 * Recursive stack visualization. Each frame { name, value, children[] }.
 * Pure SVG: rows go top-down, each row is one stack depth, frame width
 * is proportional to value. Cool→warm palette via color-mix on cm-accent
 * + cm-error so the user's accent token still drives the look.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-05-troubleshoot-fix-build-validate.html.
 */

import React, { useMemo } from 'react';

export interface FlameFrame {
  name: string;
  value: number;
  children?: ReadonlyArray<FlameFrame>;
}

export interface FlamegraphRendererProps {
  title?: string;
  subtitle?: string;
  unit?: string;
  root?: FlameFrame;
}

interface PositionedFrame {
  name: string;
  value: number;
  depth: number;
  x: number;
  width: number;
}

function layout(frame: FlameFrame, depth: number, x: number, width: number, out: PositionedFrame[]): void {
  out.push({ name: frame.name, value: frame.value, depth, x, width });
  const children = frame.children ?? [];
  if (children.length === 0 || width < 0.5) return;
  const total = children.reduce((s, c) => s + (c.value || 0), 0);
  if (total <= 0) return;
  let cx = x;
  for (const c of children) {
    const w = ((c.value || 0) / total) * width;
    layout(c, depth + 1, cx, w, out);
    cx += w;
  }
}

export function FlamegraphRenderer({ title, subtitle, unit = 'samples', root }: FlamegraphRendererProps) {
  const frames = useMemo<PositionedFrame[]>(() => {
    if (!root || typeof root.value !== 'number' || !root.name) return [];
    const out: PositionedFrame[] = [];
    layout(root, 0, 0, 1000, out);
    return out;
  }, [root]);

  if (frames.length === 0) {
    return (
      <div data-testid="flamegraph-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no flamegraph data
      </div>
    );
  }

  const maxDepth = frames.reduce((m, f) => Math.max(m, f.depth), 0);
  const ROW_H = 22;
  const H = (maxDepth + 1) * ROW_H + 24;

  return (
    <div
      data-testid="flamegraph-renderer"
      className="cm-flamegraph"
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            {title && (
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</div>
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
          <span
            style={{
              fontSize: 11,
              color: 'var(--cm-fg-dim)',
              fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
            }}
          >
            unit: {unit}
          </span>
        </div>
      )}
      <svg
        viewBox={`0 0 1000 ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={title || 'Flamegraph'}
        style={{ display: 'block' }}
      >
        {frames.map((f, i) => {
          const t = maxDepth === 0 ? 0 : f.depth / Math.max(1, maxDepth);
          const fill = `color-mix(in srgb, var(--cm-error) ${Math.round(t * 100)}%, var(--cm-accent))`;
          const showLabel = f.width > 60;
          return (
            <g key={`f-${i}`}>
              <rect
                data-name={f.name}
                data-value={f.value}
                data-depth={f.depth}
                x={f.x + 1}
                y={f.depth * ROW_H + 1}
                width={Math.max(0, f.width - 2)}
                height={ROW_H - 2}
                fill={fill}
                fillOpacity={0.85}
                stroke="var(--cm-bg-2)"
                strokeWidth={0.5}
              >
                <title>{`${f.name} · ${f.value}${unit}`}</title>
              </rect>
              {showLabel && (
                <text
                  x={f.x + 6}
                  y={f.depth * ROW_H + ROW_H / 2 + 4}
                  fontSize={11}
                  fill="var(--cm-bg, currentColor)"
                  fontFamily="var(--cm-mono, JetBrains Mono, monospace)"
                  style={{ pointerEvents: 'none' }}
                >
                  {f.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default FlamegraphRenderer;
