import React from 'react';
import { Sankey, type SankeyData } from './components/Sankey';
import { Line, type LineData } from './components/Line';
import { Bar, type BarData } from './components/Bar';
import { Donut, type DonutData } from './components/Donut';
import { Network, type NetworkData } from './components/Network';
import { Area, type AreaData } from './components/Area';
import { Heatmap, type HeatmapData } from './components/Heatmap';
import { Sparkstrip, type SparkstripData } from './components/Sparkstrip';
import { Gauge, type GaugeData } from './components/Gauge';
import { Scatter, type ScatterData } from './components/Scatter';
import { Sequence, type SequenceData } from './components/Sequence';
import { Chord, type ChordData } from './components/Chord';
import { Bundle, type BundleData } from './components/Bundle';
import { ArchDiagram, type ArchDiagramData } from './components/ArchDiagram';
import type { ChartTemplate, ChartProps } from './types';

/**
 * The dispatcher used by chatmode artifacts (compose_visual T1 tool) and
 * by admin pages that want a one-component "render whatever this is" entry
 * point.
 *
 * compose_visual emits a payload like:
 *   { kind: 'chart_template', template: 'sankey', data: {...}, title?, caption? }
 *
 * The UI's WidgetRenderer routes that payload here via:
 *   <ChartArtifact template={payload.template} data={payload.data} ... />
 *
 * Adding a new chart = add a case in the switch below. Type-safe via the
 * ChartTemplate union in ./types.ts.
 *
 * "Unknown template" renders an inline error rather than crashing — the
 * model can produce a malformed payload, and we want to surface that
 * instead of blowing up the chat transcript.
 */
export interface ChartArtifactProps {
  template: ChartTemplate | string;
  data: unknown;
  title?: string;
  caption?: string;
  height?: number;
  disableFrame?: boolean;
  className?: string;
}

export function ChartArtifact(props: ChartArtifactProps) {
  const { template, data, caption, ...rest } = props;
  const chart = renderChart(template, data, rest);
  // #816 — caption is a single-site concern. Leaf chart components
  // (Sankey, Line, Bar, …) destructure their props and drop `caption`,
  // so we wrap here so EVERY template inherits caption support.
  const trimmed = (caption ?? '').trim();
  if (!trimmed) return chart;
  return (
    <figure className="aw-chart-figure" style={{ margin: 0 }}>
      {chart}
      <figcaption
        className="aw-chart-caption"
        style={{
          marginTop: 8,
          color: 'var(--cm-fg-2)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {trimmed}
      </figcaption>
    </figure>
  );
}

function renderChart(
  template: ChartTemplate | string,
  data: unknown,
  rest: Omit<ChartArtifactProps, 'template' | 'data' | 'caption'>,
) {
  // compose_visual is model-generated, so `data` can be null/undefined/a
  // primitive for a known template. Surface that as an inline empty-state
  // instead of passing a non-object down to a leaf chart that would throw
  // on `data.nodes.map(...)` and blow up the chat transcript. Leaf charts
  // still own per-shape normalization (e.g. Sankey coerces nodes/links).
  if (data == null || typeof data !== 'object') {
    return <MalformedDataError template={String(template)} />;
  }

  switch (template) {
    case 'sankey':
      return <Sankey data={data as SankeyData} {...(rest as Omit<ChartProps<SankeyData>, 'data'>)} />;
    case 'line':
      return <Line data={data as LineData} {...(rest as Omit<ChartProps<LineData>, 'data'>)} />;
    case 'bar':
      return <Bar data={data as BarData} {...(rest as Omit<ChartProps<BarData>, 'data'>)} />;
    case 'donut':
      return <Donut data={data as DonutData} {...(rest as Omit<ChartProps<DonutData>, 'data'>)} />;
    case 'network':
      return <Network data={data as NetworkData} {...(rest as Omit<ChartProps<NetworkData>, 'data'>)} />;
    case 'area':
      return <Area data={data as AreaData} {...(rest as Omit<ChartProps<AreaData>, 'data'>)} />;
    case 'heatmap':
      return <Heatmap data={data as HeatmapData} {...(rest as Omit<ChartProps<HeatmapData>, 'data'>)} />;
    case 'sankey3':
      // 3-column Sankey reuses the Sankey component — d3-sankey handles N
      // columns natively from the link structure.
      return <Sankey data={data as SankeyData} {...(rest as Omit<ChartProps<SankeyData>, 'data'>)} />;
    case 'sparkstrip':
      return <Sparkstrip data={data as SparkstripData} {...(rest as Omit<ChartProps<SparkstripData>, 'data'>)} />;
    case 'gauge':
      return <Gauge data={data as GaugeData} {...(rest as Omit<ChartProps<GaugeData>, 'data'>)} />;
    case 'scatter':
      return <Scatter data={data as ScatterData} {...(rest as Omit<ChartProps<ScatterData>, 'data'>)} />;
    case 'sequence':
      return <Sequence data={data as SequenceData} {...(rest as Omit<ChartProps<SequenceData>, 'data'>)} />;
    case 'chord':
      return <Chord data={data as ChordData} {...(rest as Omit<ChartProps<ChordData>, 'data'>)} />;
    case 'bundle':
      return <Bundle data={data as BundleData} {...(rest as Omit<ChartProps<BundleData>, 'data'>)} />;
    case 'arch_diagram':
    case 'arch':
    case 'reactflow_arch':
      // arch_diagram replaces the legacy reactflow_arch template; both
      // slugs route here so existing model output keeps rendering.
      return <ArchDiagram data={data as ArchDiagramData} {...(rest as Omit<ChartProps<ArchDiagramData>, 'data'>)} />;
    default:
      return <UnknownTemplateError template={template} />;
  }
}

function MalformedDataError({ template }: { template: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: 16,
        border: '1px dashed var(--color-err)',
        borderRadius: 'var(--radius-sm, 4px)',
        color: 'var(--color-err)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        background: 'color-mix(in srgb, var(--color-err) 6%, transparent)',
      }}
    >
      ChartArtifact: malformed or missing <code>data</code> for template{' '}
      <code>{template}</code>.
    </div>
  );
}

function UnknownTemplateError({ template }: { template: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: 16,
        border: '1px dashed var(--color-err)',
        borderRadius: 'var(--radius-sm, 4px)',
        color: 'var(--color-err)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        background: 'color-mix(in srgb, var(--color-err) 6%, transparent)',
      }}
    >
      ChartArtifact: unknown template <code>{template}</code>.<br />
      Known templates: sankey · sankey3 · chord · bundle · network · sequence ·
      line · area · sparkstrip · bar · donut · gauge · heatmap · scatter ·
      arch_diagram.
    </div>
  );
}

export const REGISTERED_TEMPLATES: ChartTemplate[] = [
  'sankey',
  'line',
  'bar',
  'donut',
  'network',
  'area',
  'heatmap',
  'sankey3',
  'sparkstrip',
  'gauge',
  'scatter',
  'sequence',
  'chord',
  'bundle',
  'arch_diagram',
  // Add to this list as new components ship — drives discoverability +
  // can be exposed to the model's compose_visual prompt as the
  // authoritative template list.
];
