/**
 * LatencyHeatmapRenderer — compose_app:latency_heatmap template.
 *
 * Service × time-bucket heatmap. Hand-rolled SVG grid (no echarts dep in
 * UI bundle). Cell intensity scales from --cm-success to --cm-error via
 * a color-mix interpolation, with high cells rendered at full opacity.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-06-aws-k8s-aiops.html.
 */

import React, { useMemo } from 'react';

export interface LatencyHeatmapRendererProps {
  title?: string;
  services?: ReadonlyArray<string>;
  buckets?: ReadonlyArray<string>;
  values?: ReadonlyArray<readonly [number, number, number]>; // [serviceIdx, bucketIdx, value]
  unit?: string;
  max?: number;
}

function cellColor(intensity: number): string {
  // Intensity 0..1 → green → yellow → red via color-mix.
  if (intensity <= 0.5) {
    const pct = Math.round((intensity / 0.5) * 100);
    return `color-mix(in srgb, var(--cm-warn) ${pct}%, var(--cm-success))`;
  }
  const pct = Math.round(((intensity - 0.5) / 0.5) * 100);
  return `color-mix(in srgb, var(--cm-error) ${pct}%, var(--cm-warn))`;
}

export function LatencyHeatmapRenderer(props: LatencyHeatmapRendererProps) {
  const { title, services, buckets, values, unit = 'ms', max } = props;
  const safeServices = Array.isArray(services) ? services : [];
  const safeBuckets = Array.isArray(buckets) ? buckets : [];
  const safeValues = Array.isArray(values) ? values : [];

  const cellMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of safeValues) {
      if (Array.isArray(v) && v.length >= 3) m.set(`${v[0]}|${v[1]}`, Number(v[2]) || 0);
    }
    return m;
  }, [safeValues]);

  if (safeServices.length === 0 || safeBuckets.length === 0) {
    return (
      <div data-testid="latency-heatmap-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no heatmap data
      </div>
    );
  }

  const computedMax = max ?? Math.max(1, ...safeValues.map((v) => Number(v[2]) || 0));

  const CELL = 36;
  const ROW_LABEL_W = 96;
  const COL_LABEL_H = 22;
  const W = ROW_LABEL_W + safeBuckets.length * CELL + 16;
  const H = COL_LABEL_H + safeServices.length * CELL + 24;

  return (
    <div
      data-testid="latency-heatmap-renderer"
      className="cm-latency-heatmap"
      style={{
        background: 'var(--cm-bg-2)',
        border: '1px solid var(--cm-border)',
        borderRadius: 'var(--cm-radius, 6px)',
        padding: '12px 14px',
        color: 'var(--cm-fg)',
        display: 'grid',
        gap: 8,
      }}
    >
      {title && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</span>
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
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label={title || 'Latency heatmap'}
          style={{ display: 'block', fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)' }}
        >
          {/* Column labels */}
          {safeBuckets.map((b, bi) => (
            <text
              key={`b-${bi}`}
              x={ROW_LABEL_W + bi * CELL + CELL / 2}
              y={COL_LABEL_H - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--cm-fg-dim)"
            >
              {b}
            </text>
          ))}
          {safeServices.map((svc, si) =>
            safeBuckets.map((_, bi) => {
              const v = cellMap.get(`${si}|${bi}`) ?? 0;
              const intensity = computedMax > 0 ? Math.min(1, v / computedMax) : 0;
              return (
                <g key={`c-${si}-${bi}`}>
                  <rect
                    data-row={si}
                    data-col={bi}
                    data-value={v}
                    x={ROW_LABEL_W + bi * CELL + 1}
                    y={COL_LABEL_H + si * CELL + 1}
                    width={CELL - 2}
                    height={CELL - 2}
                    rx={3}
                    fill={cellColor(intensity)}
                    fillOpacity={0.3 + 0.7 * intensity}
                    stroke="var(--cm-border)"
                    strokeWidth={0.5}
                  >
                    <title>{`${safeServices[si]} · ${safeBuckets[bi]} · ${v}${unit}`}</title>
                  </rect>
                  <text
                    x={ROW_LABEL_W + bi * CELL + CELL / 2}
                    y={COL_LABEL_H + si * CELL + CELL / 2 + 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill={intensity > 0.55 ? 'var(--cm-bg)' : 'var(--cm-fg)'}
                  >
                    {v}
                  </text>
                </g>
              );
            }),
          )}
          {/* Row labels */}
          {safeServices.map((s, si) => (
            <text
              key={`s-${si}`}
              x={ROW_LABEL_W - 8}
              y={COL_LABEL_H + si * CELL + CELL / 2 + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--cm-fg)"
            >
              {s}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

export default LatencyHeatmapRenderer;
