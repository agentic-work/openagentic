/**
 * Chart renderer — chatmode artifact entry point.
 *
 * Cutover 2026-05-14: ripped recharts + @xyflow/react. This file is now a
 * thin shim onto the shared `src/lib/charts/` components (Bar / Line / Area
 * / Donut / Sankey). Public API (props + data-testid contracts + caption
 * rendering) preserved so existing chatmode message renderers + tests
 * keep working.
 *
 * Why the shim instead of replacing call sites: ChartRenderer.tsx +
 * DataVisualization.tsx still call `<Chart>` directly through the
 * chatmode message-content pipeline. Migrating both call sites + their
 * tests is a separate sweep; this commit cuts recharts out of THIS file
 * without touching the rest of the chat surface.
 */
import React from 'react';
import { Bar as AwBar, type BarData } from '../../../../../lib/charts/components/Bar';
import { Line as AwLine, type LineData } from '../../../../../lib/charts/components/Line';
import { Area as AwArea, type AreaData } from '../../../../../lib/charts/components/Area';
import { Donut as AwDonut, type DonutData } from '../../../../../lib/charts/components/Donut';
import { Sankey as AwSankey, type SankeyData } from '../../../../../lib/charts/components/Sankey';
import { useThemeTokens } from '../../../../../lib/charts/hooks/useThemeTokens';

export interface ChartDataPoint {
  label: string;
  value: number;
}

export interface SankeyNode {
  id: string;
  label: string;
  value?: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface ChartProps {
  kind: 'bar' | 'line' | 'area' | 'pie' | 'sankey' | 'flow';
  data: ChartDataPoint[];
  title?: string;
  /** #816 — one-sentence narrative shown BELOW the chart body. */
  caption?: string;
  nodes?: SankeyNode[];
  links?: SankeyLink[];
  /** Test-only pixel hints (legacy ResponsiveContainer workaround). The
   * new chart lib responds to its own viewBox + parent width, so these
   * are accepted but only used to size the wrapper div in tests. */
  testWidth?: number;
  testHeight?: number;
}

const ChartCaption: React.FC<{ caption?: string }> = ({ caption }) => {
  const trimmed = (caption ?? '').trim();
  const tokens = useThemeTokens();
  if (!trimmed) return null;
  return (
    <figcaption
      className="aw-chart-caption"
      style={{
        marginTop: 8,
        padding: '8px 12px',
        fontSize: 12,
        color: tokens.fg2,
        fontFamily: tokens.fontUi,
        lineHeight: 1.5,
      }}
    >
      {trimmed}
    </figcaption>
  );
};

export const Chart: React.FC<ChartProps> = ({
  kind,
  data,
  title,
  caption,
  nodes,
  links,
  testWidth,
  testHeight,
}) => {
  const tokens = useThemeTokens();
  const isSankey = kind === 'sankey' || kind === 'flow';

  const hasData = isSankey
    ? (nodes?.length ?? 0) > 0 && (links?.length ?? 0) > 0
    : data.length > 0;

  if (!hasData) {
    return (
      <div
        data-testid="chart-empty"
        style={{
          padding: 24,
          color: tokens.fg3,
          fontFamily: tokens.fontMono,
          fontSize: 12,
          textAlign: 'center',
          border: `1px dashed ${tokens.line2}`,
          borderRadius: 6,
        }}
      >
        No data
      </div>
    );
  }

  const height = testHeight ?? 280;

  // Render the chart body for the selected kind. Unknown kinds fall back
  // to bar so a malformed model payload doesn't crash the transcript.
  let body: React.ReactNode;
  switch (kind) {
    case 'bar':
    default: {
      const barData: BarData = {
        categories: data.map((d) => d.label),
        mode: 'grouped',
        series: [{ name: 'value', values: data.map((d) => d.value) }],
      };
      body = <AwBar data={barData} height={height} disableFrame />;
      break;
    }
    case 'line': {
      const lineData: LineData = {
        series: [{
          name: 'value',
          data: data.map((d) => ({ t: d.label, v: d.value })),
        }],
      };
      body = <AwLine data={lineData} height={height} disableFrame />;
      break;
    }
    case 'area': {
      const areaData: AreaData = {
        mode: 'overlay',
        xLabels: data.map((d) => d.label),
        series: [{
          name: 'value',
          data: data.map((d) => ({ t: d.label, v: d.value })),
        }],
      };
      body = <AwArea data={areaData} height={height} disableFrame />;
      break;
    }
    case 'pie': {
      const donutData: DonutData = {
        slices: data.map((d) => ({ name: d.label, value: d.value })),
      };
      body = <AwDonut data={donutData} height={height} disableFrame />;
      break;
    }
    case 'sankey':
    case 'flow': {
      // Infer node kind from link topology:
      //   - Only outgoing edges → 'source'
      //   - Only incoming → 'sink'
      //   - Both → 'sink' (default; mid-tier reuses sink color)
      const sourceIds = new Set((links ?? []).map((l) => l.source));
      const targetIds = new Set((links ?? []).map((l) => l.target));
      const sankeyData: SankeyData = {
        nodes: (nodes ?? []).map((n) => ({
          id: n.id,
          label: n.label,
          kind: sourceIds.has(n.id) && !targetIds.has(n.id) ? 'source' : 'sink',
        })),
        links: (links ?? []).map((l) => ({
          source: l.source,
          target: l.target,
          value: l.value,
          sourceId: l.source,
        })),
      };
      body = <AwSankey data={sankeyData} height={height} disableFrame />;
      break;
    }
  }

  return (
    <figure
      data-testid="chart-root"
      className="aw-chart-figure"
      style={{
        margin: 0,
        width: testWidth ?? '100%',
      }}
    >
      {title && (
        <figcaption
          className="aw-chart-title"
          style={{
            margin: '0 0 8px',
            fontSize: 13,
            fontWeight: 600,
            color: tokens.fg0,
            fontFamily: tokens.fontUi,
          }}
        >
          {title}
        </figcaption>
      )}
      {body}
      <ChartCaption caption={caption} />
    </figure>
  );
};
