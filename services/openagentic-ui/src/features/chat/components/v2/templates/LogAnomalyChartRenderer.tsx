/**
 * LogAnomalyChartRenderer — compose_app:log_anomaly_chart template.
 *
 * Time-series log counts with anomaly band shading and anomaly point
 * markers. Pure SVG (no chart lib dep).
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-06-aws-k8s-aiops.html,
 * mocks/UX/AI/Chatmode/end-state-08-incident-triage.html.
 */

import React, { useMemo } from 'react';

export interface LogPoint {
  ts: string;
  count: number;
  lower_band?: number;
  upper_band?: number;
  is_anomaly?: boolean;
}

export interface LogAnomalyChartRendererProps {
  title?: string;
  source?: string;
  subtitle?: string;
  points?: ReadonlyArray<LogPoint>;
}

export function LogAnomalyChartRenderer(props: LogAnomalyChartRendererProps) {
  const { title, source, subtitle, points } = props;
  const safe = Array.isArray(points) ? points : [];

  const layout = useMemo(() => {
    if (safe.length < 2) return null;
    const W = 720;
    const H = 280;
    const PAD_L = 44;
    const PAD_R = 12;
    const PAD_T = 12;
    const PAD_B = 28;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;

    const maxCount = Math.max(
      ...safe.map((p) =>
        Math.max(p.count || 0, p.upper_band ?? 0, p.lower_band ?? 0),
      ),
      1,
    );

    const xs = safe.map((_, i) => PAD_L + (i / (safe.length - 1)) * innerW);
    const yScale = (v: number) => PAD_T + innerH - (v / maxCount) * innerH;

    const linePts = safe.map((p, i) => `${xs[i].toFixed(1)},${yScale(p.count).toFixed(1)}`).join(' ');

    const bandPolygon = safe.every((p) => p.upper_band != null && p.lower_band != null)
      ? (() => {
          const upper = safe.map((p, i) => `${xs[i].toFixed(1)},${yScale(p.upper_band!).toFixed(1)}`);
          const lower = safe
            .slice()
            .reverse()
            .map(
              (p, i) =>
                `${xs[safe.length - 1 - i].toFixed(1)},${yScale(p.lower_band!).toFixed(1)}`,
            );
          return [...upper, ...lower].join(' ');
        })()
      : null;

    const anomalies = safe
      .map((p, i) => (p.is_anomaly ? { x: xs[i], y: yScale(p.count), p } : null))
      .filter((x): x is { x: number; y: number; p: LogPoint } => x !== null);

    return { W, H, PAD_L, PAD_R, PAD_T, PAD_B, innerW, innerH, linePts, bandPolygon, xs, yScale, maxCount, anomalies };
  }, [safe]);

  if (!layout) {
    return (
      <div data-testid="log-anomaly-chart-renderer" style={{ color: 'var(--cm-fg-dim)', fontSize: 12 }}>
        no log data
      </div>
    );
  }

  // y-axis ticks: 0, 50%, max
  const ticks = [0, layout.maxCount / 2, layout.maxCount];

  return (
    <div
      data-testid="log-anomaly-chart-renderer"
      className="cm-log-anomaly-chart"
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
      {(title || source) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          {title && (
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--cm-fg)' }}>{title}</span>
          )}
          {source && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--cm-fg-dim)',
                fontFamily: 'var(--cm-mono, JetBrains Mono, monospace)',
              }}
            >
              {source}
            </span>
          )}
        </div>
      )}
      {subtitle && (
        <div style={{ fontSize: 11, color: 'var(--cm-fg-dim)', marginTop: -2 }}>{subtitle}</div>
      )}
      <svg
        viewBox={`0 0 ${layout.W} ${layout.H}`}
        width="100%"
        height={layout.H}
        role="img"
        aria-label={title || 'Log anomaly chart'}
        style={{ display: 'block' }}
      >
        {ticks.map((t, i) => {
          const y = layout.yScale(t);
          return (
            <g key={`tick-${i}`}>
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
                {Math.round(t)}
              </text>
            </g>
          );
        })}
        {layout.bandPolygon && (
          <polygon
            data-testid="log-anomaly-band"
            points={layout.bandPolygon}
            fill="var(--cm-warn, currentColor)"
            fillOpacity={0.12}
            stroke="var(--cm-warn, currentColor)"
            strokeOpacity={0.35}
            strokeDasharray="3 3"
          />
        )}
        <polyline
          data-testid="log-anomaly-line"
          points={layout.linePts}
          fill="none"
          stroke="var(--cm-accent, currentColor)"
          strokeWidth={1.8}
        />
        {layout.anomalies.map((a, i) => (
          <circle
            key={`a-${i}`}
            cx={a.x}
            cy={a.y}
            r={4}
            fill="var(--cm-error, currentColor)"
            stroke="var(--cm-bg)"
            strokeWidth={1.5}
            data-testid="log-anomaly-marker"
          >
            <title>{`${a.p.ts}: ${a.p.count}`}</title>
          </circle>
        ))}
        {safe.map((p, i) => (
          <text
            key={`x-${i}`}
            x={layout.xs[i]}
            y={layout.H - layout.PAD_B + 14}
            textAnchor="middle"
            fontSize={10}
            fill="var(--cm-fg-dim)"
            fontFamily="var(--cm-mono, JetBrains Mono, monospace)"
            style={{ display: i % Math.max(1, Math.floor(safe.length / 8)) === 0 ? undefined : 'none' }}
          >
            {p.ts}
          </text>
        ))}
      </svg>
    </div>
  );
}

export default LogAnomalyChartRenderer;
