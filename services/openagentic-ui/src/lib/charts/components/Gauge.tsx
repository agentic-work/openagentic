import React from 'react';
import { arc as d3Arc } from 'd3-shape';
import { useThemeTokens } from '../hooks/useThemeTokens';
import type { ChartProps } from '../types';

export interface GaugeItem {
  name: string;
  value: number;
  max: number;
  unit?: string;
  sub?: string;
  /** Override the auto-derived color. */
  color?: string;
}

export interface GaugeData {
  gauges: GaugeItem[];
  /** Grid columns, default 4. */
  columns?: number;
  /** Threshold ratios for color band (warn / err). Defaults: warn=0.65, err=0.85. */
  thresholds?: { warn?: number; err?: number };
}

export function Gauge({ data, className }: ChartProps<GaugeData>) {
  const tokens = useThemeTokens();
  const cols = data.columns ?? 4;
  const tWarn = data.thresholds?.warn ?? 0.65;
  const tErr = data.thresholds?.err ?? 0.85;

  const colorOf = (v: number, max: number, override?: string) => {
    if (override) return override;
    const r = v / max;
    if (r >= tErr) return tokens.err;
    if (r >= tWarn) return tokens.warn;
    return tokens.ok;
  };

  const W = 200, H = 130;
  const r = 78, ir = 60;
  const sweep = Math.PI * 1.45;
  const start = -sweep / 2;
  const arcGen = d3Arc<{ start: number; end: number }>()
    .innerRadius(ir)
    .outerRadius(r)
    .cornerRadius(4)
    .startAngle((d) => d.start)
    .endAngle((d) => d.end);

  return (
    <div
      className={className}
      data-aw-chart-frame
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: 14,
      }}
    >
      {data.gauges.map((g) => {
        const frac = Math.max(0, Math.min(1, g.value / g.max));
        const color = colorOf(g.value, g.max, g.color);
        return (
          <div
            key={g.name}
            style={{
              background: tokens.bg2,
              border: `1px solid ${tokens.line2}`,
              borderRadius: 8,
              padding: 14,
              textAlign: 'center',
              fontFamily: tokens.fontUi,
            }}
          >
            <h3 style={{
              margin: '0 0 4px',
              fontSize: 11,
              fontWeight: 500,
              color: tokens.fg2,
              fontFamily: tokens.fontMono,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {g.name}
            </h3>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '0 auto', width: '100%', maxWidth: 200 }}>
              <g transform={`translate(${W / 2},${H * 0.78})`}>
                <path d={arcGen({ start, end: start + sweep }) ?? ''} fill={tokens.line2} />
                <path d={arcGen({ start, end: start + sweep * frac }) ?? ''} fill={color} />
                <text textAnchor="middle" y={-8} style={{ fontSize: 26, fontWeight: 600, fill: tokens.fg0 }}>
                  {g.value.toFixed(g.value < 10 ? 1 : 0)}
                </text>
                <text textAnchor="middle" y={10} style={{ fontSize: 11, fill: tokens.fg3, fontFamily: tokens.fontMono }}>
                  {g.unit ?? ''}
                </text>
              </g>
            </svg>
            {g.sub && (
              <div style={{ marginTop: 6, fontSize: 11, color: tokens.fg3, fontFamily: tokens.fontMono }}>{g.sub}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
