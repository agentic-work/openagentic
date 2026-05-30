/**
 * AwChartRenderer — single registry slot that dispatches to any chart in
 * src/lib/charts/. Lets the chatmode compose_visual T1 tool render any of
 * the 14 templates by emitting one wire-format slug ('awchart') and the
 * inner template name in the structured payload.
 *
 * Wire envelope:
 *   {
 *     _meta: { outputTemplate: 'awchart' },
 *     structuredContent: {
 *       template: 'sankey' | 'line' | 'bar' | 'donut' | 'network' | ...,
 *       data: { ... shape per template ... },
 *       title?: string,
 *       caption?: string,
 *       height?: number,
 *     }
 *   }
 *
 * Why one slot instead of one per template: the compose_visual tool emits
 * one wire frame with `outputTemplate: 'awchart'`. The model only has to
 * know the inner template name (which lives inside the data payload),
 * not coordinate two enum lists.
 */
import React from 'react';
import { ChartArtifact } from '../../../../../lib/charts/ChartArtifact';

interface AwChartContent {
  template?: string;
  data?: unknown;
  title?: string;
  caption?: string;
  height?: number;
  /** Some tool-result envelopes nest payload under `props`. Accept both. */
  props?: AwChartContent;
}

interface AwChartRendererProps {
  structuredContent?: AwChartContent;
  /** Some callers pass the payload directly. */
  template?: string;
  data?: unknown;
  title?: string;
  caption?: string;
}

export function AwChartRenderer(props: AwChartRendererProps) {
  // Unwrap whichever shape the caller gave us. The standard chatmode tool-
  // result envelope is `structuredContent`; admin and tests may pass props
  // flat. Both should work.
  const inner: AwChartContent =
    (props.structuredContent?.props ?? props.structuredContent) ??
    {
      template: props.template,
      data: props.data,
      title: props.title,
      caption: props.caption,
    };

  if (!inner.template) {
    return (
      <div role="alert" style={{ padding: 16, color: 'var(--err, #f87171)', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
        AwChart: missing `template` field in payload.
      </div>
    );
  }

  return (
    <ChartArtifact
      template={inner.template}
      data={inner.data}
      title={inner.title}
      caption={inner.caption}
      height={inner.height}
    />
  );
}

AwChartRenderer.displayName = 'AwChartRenderer';
