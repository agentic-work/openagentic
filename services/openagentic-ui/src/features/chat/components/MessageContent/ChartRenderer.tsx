/**
 * ChartRenderer — chatmode message-content chart shim.
 *
 * Cutover 2026-05-14: dropped recharts. Translates legacy `chartSpec`
 * payloads (recharts-shape: {type, data:[{name, ...}], xAxis, yAxis,
 * dataKeys}) into the canonical shapes consumed by src/lib/charts/
 * components and delegates rendering there. Public API + props
 * preserved so InlineMCPCall + AgenticActivityStream keep working.
 */
import React, { useMemo } from 'react';
import { Bar as AwBar, type BarData } from '../../../../lib/charts/components/Bar';
import { Line as AwLine, type LineData } from '../../../../lib/charts/components/Line';
import { Area as AwArea, type AreaData } from '../../../../lib/charts/components/Area';
import { Donut as AwDonut, type DonutData } from '../../../../lib/charts/components/Donut';
import { Scatter as AwScatter, type ScatterData } from '../../../../lib/charts/components/Scatter';
import { useThemeTokens } from '../../../../lib/charts/hooks/useThemeTokens';

interface ChartSpec {
  type: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'radar' | 'doughnut' | 'bubble';
  data: Array<Record<string, any>>;
  title?: string;
  xAxis?: string;
  yAxis?: string;
  dataKeys?: string[];
  colors?: string[];
}

interface ChartRendererProps {
  chartSpec: string | ChartSpec;
  theme: 'light' | 'dark';
  height?: number;
}

function parseSpec(input: string | ChartSpec | undefined): ChartSpec | null {
  if (!input) return null;
  if (typeof input === 'object') return input;
  try {
    const fence = input.match(/```(?:json|chart)?\s*([\s\S]*?)```/);
    return JSON.parse(fence ? fence[1] : input) as ChartSpec;
  } catch {
    return null;
  }
}

function detectKeys(spec: ChartSpec): string[] {
  if (spec.dataKeys?.length) return spec.dataKeys;
  const first = spec.data?.[0];
  if (!first) return ['value'];
  return Object.keys(first).filter(
    (k) => typeof first[k] === 'number' && k !== spec.xAxis,
  );
}

const ChartRenderer: React.FC<ChartRendererProps> = ({ chartSpec, height = 360 }) => {
  const spec = useMemo(() => parseSpec(chartSpec), [chartSpec]);
  const tokens = useThemeTokens();

  if (!spec || !Array.isArray(spec.data) || spec.data.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          border: `1px solid ${tokens.warn}`,
          background: tokens.bg1,
          color: tokens.warn,
          fontSize: 12,
        }}
      >
        Invalid chart data
      </div>
    );
  }

  const type = (spec.type ?? 'bar').toLowerCase();
  const xKey = spec.xAxis ?? 'name';
  const keys = detectKeys(spec);
  const categories = spec.data.map((row) => String(row[xKey] ?? row.name ?? ''));

  const chrome: React.CSSProperties = {
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${tokens.line}`,
    background: tokens.bg1,
  };
  const titleStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 12,
    textAlign: 'center',
    color: tokens.fg1,
  };

  let body: React.ReactNode;
  if (type === 'pie' || type === 'doughnut') {
    const data: DonutData = {
      slices: spec.data.map((row) => ({
        name: String(row[xKey] ?? row.name ?? ''),
        value: Number(row.value ?? row[keys[0]] ?? 0),
      })),
    };
    body = <AwDonut data={data} height={height} />;
  } else if (type === 'line') {
    const data: LineData = {
      series: keys.map((k) => ({
        name: k,
        data: spec.data.map((row) => ({ t: String(row[xKey] ?? row.name ?? ''), v: Number(row[k]) })),
      })),
      unit: spec.yAxis,
    };
    body = <AwLine data={data} height={height} />;
  } else if (type === 'area') {
    const data: AreaData = {
      series: keys.map((k) => ({
        name: k,
        data: spec.data.map((row) => ({ t: String(row[xKey] ?? row.name ?? ''), v: Number(row[k]) })),
      })),
      mode: keys.length > 1 ? 'stacked' : 'overlay',
      xLabels: categories,
    };
    body = <AwArea data={data} height={height} />;
  } else if (type === 'scatter' || type === 'bubble') {
    const xField = spec.xAxis ?? 'x';
    const yField = spec.yAxis ?? 'y';
    const data: ScatterData = {
      points: spec.data.map((row, i) => ({
        x: Number(row[xField] ?? row.x ?? i),
        y: Number(row[yField] ?? row.y ?? row.value ?? 0),
        label: String(row.name ?? ''),
        size: type === 'bubble' ? Number(row.size ?? row.z ?? 1) : undefined,
      })),
    };
    body = <AwScatter data={data} height={height} />;
  } else {
    const data: BarData = {
      categories,
      series: keys.map((k) => ({ name: k, values: spec.data.map((row) => Number(row[k])) })),
      mode: keys.length > 1 ? 'stacked' : 'grouped',
    };
    body = <AwBar data={data} height={height} />;
  }

  return (
    <div style={chrome}>
      {spec.title && <div style={titleStyle}>{spec.title}</div>}
      <div style={{ width: '100%', height }}>{body}</div>
    </div>
  );
};

export default ChartRenderer;
