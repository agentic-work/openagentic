import React, { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3Line, area as d3Area, curveMonotoneX } from 'd3-shape';
import { max as d3Max, min as d3Min } from 'd3-array';
import { useThemeTokens } from '../hooks/useThemeTokens';
import type { ChartProps } from '../types';

export interface SparkstripKpi {
  name: string;
  unit?: string;
  /** Current value displayed as the headline number. */
  cur: number;
  /** % change vs the start of the trend window (signed). */
  delta?: number;
  /** Series of values over time (chronological order). */
  trend: number[];
  /** Direction that is "good" for this metric — drives color of delta/sparkline. */
  good?: 'up' | 'down' | 'flat';
}

export interface SparkstripData {
  kpis: SparkstripKpi[];
  /** Grid columns, default 4. */
  columns?: number;
}

/**
 * KPI strip — N cards, each with current value + signed delta + 24h spark.
 * Sparkline color encodes direction-good (green) / direction-bad (red).
 * No useChartFrame — these are dense glanceable widgets, no need for
 * pan/zoom chrome.
 */
export function Sparkstrip({ data, className }: ChartProps<SparkstripData>) {
  const tokens = useThemeTokens();
  const cols = data.columns ?? 4;

  const fmt = (v: number) => {
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    if (Math.abs(v) >= 10) return v.toFixed(0);
    return v.toFixed(1);
  };

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
      {data.kpis.map((k) => {
        const dir = (k.delta ?? 0) > 0.5 ? 'up' : (k.delta ?? 0) < -0.5 ? 'down' : 'flat';
        const isGood =
          (k.good === 'up' && dir === 'up') ||
          (k.good === 'down' && dir === 'down');
        const isBad =
          (k.good === 'up' && dir === 'down') ||
          (k.good === 'down' && dir === 'up');
        const color = isGood ? tokens.ok : isBad ? tokens.err : tokens.fg3;

        const trendData = k.trend.length > 0 ? k.trend : [0];
        const minV = d3Min(trendData) ?? 0;
        const maxV = d3Max(trendData) ?? 1;
        const span = maxV - minV || 1;
        const W = 260, H = 50;
        const x = scaleLinear().domain([0, Math.max(1, trendData.length - 1)]).range([0, W]);
        const y = scaleLinear().domain([minV - span * 0.12, maxV + span * 0.12]).range([H - 4, 4]);
        const line = d3Line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX);
        const area = d3Area<number>().x((_, i) => x(i)).y0(H).y1((v) => y(v)).curve(curveMonotoneX);

        return (
          <div
            key={k.name}
            style={{
              background: tokens.bg2,
              border: `1px solid ${tokens.line2}`,
              borderRadius: 8,
              padding: '14px 16px',
              fontFamily: tokens.fontUi,
            }}
          >
            <h3 style={{
              margin: '0 0 6px',
              fontSize: 11,
              fontWeight: 500,
              color: tokens.fg2,
              fontFamily: tokens.fontMono,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {k.name}
            </h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: tokens.fg0 }}>
                {fmt(k.cur)}
                {k.unit && <span style={{ fontSize: 11, color: tokens.fg3, marginLeft: 4, fontFamily: tokens.fontMono }}>{k.unit}</span>}
              </span>
              {k.delta !== undefined && (
                <span style={{
                  fontFamily: tokens.fontMono, fontSize: 11,
                  padding: '2px 7px', borderRadius: 3,
                  color: dir === 'up' ? tokens.ok : dir === 'down' ? tokens.err : tokens.fg3,
                  background: dir === 'up'
                    ? 'color-mix(in srgb, var(--color-ok) 12%, transparent)'
                    : dir === 'down'
                    ? 'color-mix(in srgb, var(--color-err) 12%, transparent)'
                    : 'transparent',
                }}>
                  {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '·'} {Math.abs(k.delta).toFixed(1)}%
                </span>
              )}
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', width: '100%', height: H }}>
              <path d={area(trendData) ?? ''} fill={color} fillOpacity={0.18} />
              <path d={line(trendData) ?? ''} fill="none" stroke={color} strokeWidth={1.5} />
              <circle cx={x(trendData.length - 1)} cy={y(k.cur)} r={2.5} fill={color} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
