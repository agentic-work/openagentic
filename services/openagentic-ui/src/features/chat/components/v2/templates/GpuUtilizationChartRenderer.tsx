/**
 * GpuUtilizationChartRenderer — compose_app:gpu_utilization_chart template.
 *
 * Multi-series time-series line chart (GPU % per node) with optional
 * saturation threshold dashed line. Pure SVG to avoid extra chart libs.
 *
 * Anatomy: line chart pattern from task brief (no exact mock).
 */

import React, { useMemo } from 'react';

export interface GpuSeries {
  node: string;
  values: ReadonlyArray<number>;
}

export interface GpuUtilizationChartRendererProps {
  title?: string;
  subtitle?: string;
  buckets?: ReadonlyArray<string>;
  series?: ReadonlyArray<GpuSeries>;
  threshold?: number;
}

const PALETTE_VARS = [
  'var(--cm-accent, currentColor)',
  'var(--cm-info, currentColor)',
  'var(--cm-success, currentColor)',
  'var(--cm-warn, currentColor)',
  'var(--cm-error, currentColor)',
];

export function GpuUtilizationChartRenderer(props: GpuUtilizationChartRendererProps) {
  const { title, subtitle, buckets, series, threshold = 85 } = props;
  const safeBuckets = Array.isArray(buckets) ? buckets : [];
  const safeSeries = Array.isArray(series) ? series : [];

  const layout = useMemo(() => {
    if (safeBuckets.length < 2 || safeSeries.length === 0) return null;
    const W = 720;
    const H = 320;
    const PAD_L = 44;
    const PAD_R = 130;
    const PAD_T = 12;
    const PAD_B = 28;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    const xs = safeBuckets.map((_, i) => PAD_L + (i / (safeBuckets.length - 1)) * innerW);
    const yScale = (v: number) => PAD_T + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;
    return { W, H, PAD_L, PAD_R, PAD_T, PAD_B, innerW, innerH, xs, yScale };
  }, [safeBuckets, safeSeries]);

  if (!layout) {
    return (
      <div data-testid="gpu-utilization-chart-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no GPU data
      </div>
    );
  }

  const validSeries = safeSeries.filter(
    (s) => Array.isArray(s.values) && s.values.length === safeBuckets.length,
  );

  return (
    <div
      data-testid="gpu-utilization-chart-renderer"
      className="cm-gpu-utilization-chart"
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
          {title && (
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</span>
          )}
          {subtitle && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
      <svg
        viewBox={`0 0 ${layout.W} ${layout.H}`}
        width="100%"
        height={layout.H}
        role="img"
        aria-label={title || 'GPU utilization'}
        style={{ display: 'block' }}
      >
        {/* y-axis gridlines at 0/25/50/75/100 */}
        {[0, 25, 50, 75, 100].map((t) => {
          const y = layout.yScale(t);
          return (
            <g key={`y-${t}`}>
              <line
                x1={layout.PAD_L}
                x2={layout.W - layout.PAD_R}
                y1={y}
                y2={y}
                stroke="var(--cm-border)"
                strokeWidth={0.5}
                strokeDasharray="2 4"
              />
              <text
                x={layout.PAD_L - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                fill="var(--cm-fg-dim)"
                fontFamily="var(--cm-mono, JetBrains Mono, monospace)"
              >
                {t}%
              </text>
            </g>
          );
        })}
        {typeof threshold === 'number' && (
          <g data-testid="gpu-threshold-line">
            <line
              x1={layout.PAD_L}
              x2={layout.W - layout.PAD_R}
              y1={layout.yScale(threshold)}
              y2={layout.yScale(threshold)}
              stroke="var(--cm-error, currentColor)"
              strokeWidth={1}
              strokeDasharray="6 4"
            />
            <text
              x={layout.W - layout.PAD_R - 4}
              y={layout.yScale(threshold) - 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--cm-error, currentColor)"
              fontFamily="var(--cm-mono, JetBrains Mono, monospace)"
            >
              sat {threshold}%
            </text>
          </g>
        )}
        {validSeries.map((s, idx) => {
          const tone = PALETTE_VARS[idx % PALETTE_VARS.length];
          const pts = s.values
            .map((v, i) => `${layout.xs[i].toFixed(1)},${layout.yScale(v).toFixed(1)}`)
            .join(' ');
          return (
            <polyline
              key={`s-${idx}`}
              data-node={s.node}
              points={pts}
              fill="none"
              stroke={tone}
              strokeWidth={1.8}
              strokeLinejoin="round"
            />
          );
        })}
        {safeBuckets.map((b, i) => {
          const step = Math.max(1, Math.floor(safeBuckets.length / 8));
          if (i % step !== 0 && i !== safeBuckets.length - 1) return null;
          return (
            <text
              key={`xlbl-${i}`}
              x={layout.xs[i]}
              y={layout.H - layout.PAD_B + 14}
              textAnchor="middle"
              fontSize={10}
              fill="var(--cm-fg-dim)"
              fontFamily="var(--cm-mono, JetBrains Mono, monospace)"
            >
              {b}
            </text>
          );
        })}
        {/* legend */}
        {validSeries.map((s, idx) => {
          const tone = PALETTE_VARS[idx % PALETTE_VARS.length];
          const ly = layout.PAD_T + idx * 16;
          return (
            <g key={`lg-${idx}`} data-legend={s.node}>
              <rect
                x={layout.W - layout.PAD_R + 10}
                y={ly}
                width={12}
                height={3}
                fill={tone}
              />
              <text
                x={layout.W - layout.PAD_R + 28}
                y={ly + 5}
                fontSize={11}
                fill="var(--cm-fg)"
                fontFamily="var(--cm-mono, JetBrains Mono, monospace)"
              >
                {s.node}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default GpuUtilizationChartRenderer;
