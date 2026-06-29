import React, { useMemo, useRef, useState } from 'react';
import { onKeyActivate } from '@/utils/a11y';
import { pie as d3Pie, arc as d3Arc } from 'd3-shape';
import { format as d3Format } from 'd3-format';
import { useChartFrame } from '../hooks/useChartFrame';
import { useThemeTokens } from '../hooks/useThemeTokens';
import { ChartTooltip } from './ChartTooltip';
import type { ChartProps } from '../types';

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

export interface DonutData {
  slices: DonutSlice[];
  /** Center "unit" label, e.g. "tokens · 24h". */
  centerSubtitle?: string;
  /** Format spec for slice values + center total. Default '~s' (SI). */
  format?: string;
}

export function Donut({ data, title, height = 460, disableFrame, wheelZoom, onExpand, className }: ChartProps<DonutData>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const tokens = useThemeTokens(svgRef);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);

  const layout = useMemo(() => {
    const W = 480, H = height;
    const r = Math.min(W, H) / 2 - 24;
    const ir = r - 60;
    const total = data.slices.reduce((a, s) => a + Math.max(0, s.value), 0);
    const pieGen = d3Pie<DonutSlice>().value((d) => Math.max(0, d.value)).sort(null).padAngle(0.012);
    const arcGen = d3Arc<any>().innerRadius(ir).outerRadius(r).cornerRadius(3);
    const arcs = pieGen(data.slices);
    return { W, H, r, ir, total, arcs, arcGen };
  }, [data.slices, height]);

  useChartFrame(svgRef, contentRef, { title: title ?? 'donut', disabled: disableFrame, wheelZoom, onExpand });

  if (layout.total === 0) {
    return (
      <div className={className} style={{ padding: 16, color: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11 }}>
        no data
      </div>
    );
  }

  const palette = [tokens.accent, tokens.info, tokens.ok, tokens.warn, tokens.err, tokens.capThinking, tokens.capStreaming, tokens.capTools];
  const fmtV = d3Format(data.format ?? '~s');

  const isolatedSlice = isolated ? data.slices.find((s) => s.name === isolated) : null;
  const centerTitleText = isolatedSlice ? isolatedSlice.name.toUpperCase() : 'TOTAL';
  const centerValText = isolatedSlice ? fmtV(isolatedSlice.value) : fmtV(layout.total);
  const centerSubText = isolatedSlice
    ? `${((isolatedSlice.value / layout.total) * 100).toFixed(1)}% share`
    : (data.centerSubtitle ?? '');

  const hoveredSlice = hover ? data.slices.find((s) => s.name === hover.name) : null;
  const hoverColor = hoveredSlice
    ? (hoveredSlice.color ?? palette[data.slices.indexOf(hoveredSlice) % palette.length])
    : tokens.accent;

  return (
    <div className={className} data-aw-chart-frame style={{ display: 'grid', gridTemplateColumns: `${layout.W}px 1fr`, gap: 24, alignItems: 'center', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.W} ${layout.H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: layout.W, cursor: disableFrame ? 'default' : 'grab' }}
        onMouseLeave={() => setHover(null)}
      >
        <g ref={contentRef}>
          <g transform={`translate(${layout.W / 2},${layout.H / 2})`}>
            {layout.arcs.map((a, i) => {
              const color = a.data.color ?? palette[i % palette.length];
              const dim = isolated !== null && a.data.name !== isolated;
              return (
                <path
                  key={a.data.name}
                  d={layout.arcGen(a as any) ?? ''}
                  fill={color}
                  fillOpacity={dim ? 0.25 : (hover && hover.name === a.data.name ? 1 : 0.95)}
                  stroke={hover && hover.name === a.data.name ? tokens.fg0 : 'none'}
                  strokeWidth={1.5}
                  style={{ cursor: 'pointer', transition: 'fill-opacity 120ms' }}
                  onClick={() => setIsolated((cur) => cur === a.data.name ? null : a.data.name)}
                  onMouseMove={(e) => {
                    const svgEl = svgRef.current; if (!svgEl) return;
                    const rect = svgEl.getBoundingClientRect();
                    setHover({ name: a.data.name, x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }}
                />
              );
            })}
            <text textAnchor="middle" y={-14} style={{ fill: tokens.fg3, fontFamily: tokens.fontMono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              {centerTitleText}
            </text>
            <text textAnchor="middle" y={14} style={{ fill: tokens.fg0, fontFamily: tokens.fontUi, fontSize: 30, fontWeight: 600 }}>
              {centerValText}
            </text>
            <text textAnchor="middle" y={34} style={{ fill: tokens.fg2, fontFamily: tokens.fontMono, fontSize: 11 }}>
              {centerSubText}
            </text>
          </g>
        </g>
      </svg>

      {/* Side legend — also clickable to isolate */}
      <div style={{ fontFamily: tokens.fontMono, fontSize: 12 }}>
        {data.slices.map((s, i) => {
          const color = s.color ?? palette[i % palette.length];
          const pct = (s.value / layout.total) * 100;
          const dim = isolated !== null && s.name !== isolated;
          return (
            <div
              key={s.name}
              role="button"
              tabIndex={0}
              onClick={() => setIsolated((cur) => cur === s.name ? null : s.name)}
              onKeyDown={onKeyActivate(() => setIsolated((cur) => cur === s.name ? null : s.name))}
              style={{
                display: 'grid',
                gridTemplateColumns: '14px 1fr auto auto',
                gap: 10,
                alignItems: 'center',
                padding: '7px 0',
                borderBottom: `1px dashed ${tokens.line2}`,
                cursor: 'pointer',
                opacity: dim ? 0.4 : 1,
                transition: 'opacity 120ms',
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
              <div style={{ color: tokens.fg1 }}>{s.name}</div>
              <div style={{ color: tokens.fg0 }}>{pct.toFixed(1)}%</div>
              <div style={{ color: tokens.fg3 }}>{fmtV(s.value)}</div>
            </div>
          );
        })}
      </div>
      <ChartTooltip
        title={hoveredSlice?.name}
        rows={hoveredSlice ? [{
          color: hoverColor,
          name: 'value',
          value: fmtV(hoveredSlice.value),
        }, {
          color: tokens.fg3,
          name: 'share',
          value: ((hoveredSlice.value / layout.total) * 100).toFixed(1) + '%',
        }] : []}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        anchor={svgRef.current}
        visible={!!hover}
      />
    </div>
  );
}
