/**
 * #502 InlineWidgetStrip — render dispatcher for the unified
 * `inline_widget` NDJSON frame.
 *
 * Reads each InlineWidget's discriminated `kind` and renders the
 * matching v2 primitive. The `data` payload mirrors the primitive's
 * prop shape one-to-one (KpiTile[], SavingsCardCell[], StageItem[],
 * { rows: WaveRow[] }, { steps: RunbookStep[]; budget?: string },
 * StackLayer[], { lines: string[]; annotatedLines: number[] }), so we
 * pass it through directly.
 *
 * Intentionally tiny — the render decision lives here; the seven
 * primitives own their own visual treatment via chatmode-v2.css. See
 * mocks/UX/01-09 for the canonical anatomies.
 */

import type { InlineWidget } from '../../hooks/useChatStream';
import { KpiGrid, type KpiTile } from './KpiGrid';
import { SavingsCard, type SavingsCardCell } from './SavingsCard';
import { StagesStrip, type StageItem } from './StagesStrip';
import { WaveTimeline, type WaveRow } from './WaveTimeline';
import { Runbook, type RunbookStep } from './Runbook';
import { StackGrid, type StackLayer } from './StackGrid';
import { AnnotatedCode } from './AnnotatedCode';

export interface InlineWidgetStripProps {
  widgets: ReadonlyArray<InlineWidget>;
}

export function InlineWidgetStrip({ widgets }: InlineWidgetStripProps) {
  if (!widgets || widgets.length === 0) return null;
  const rendered = widgets
    .map((w) => renderOne(w))
    .filter((x): x is JSX.Element => x !== null);
  if (rendered.length === 0) return null;
  return (
    <div className="cm-v2 cm-inline-widgets" data-testid="inline-widget-strip">
      {rendered}
    </div>
  );
}

function renderOne(w: InlineWidget): JSX.Element | null {
  const d = w.data as Record<string, unknown>;
  switch (w.kind) {
    case 'kpi_grid':
      return <KpiGrid key={w.artifactId} tiles={(d.tiles ?? []) as KpiTile[]} />;
    case 'savings_card':
      return (
        <SavingsCard
          key={w.artifactId}
          cells={(d.cells ?? []) as SavingsCardCell[]}
          ariaLabel={w.title}
        />
      );
    case 'stages_strip':
      return <StagesStrip key={w.artifactId} stages={(d.stages ?? []) as StageItem[]} />;
    case 'wave_timeline':
      return (
        <WaveTimeline
          key={w.artifactId}
          title={w.title ?? ''}
          rows={(d.rows ?? []) as WaveRow[]}
        />
      );
    case 'runbook':
      return (
        <Runbook
          key={w.artifactId}
          title={w.title ?? ''}
          budget={typeof d.budget === 'string' ? d.budget : undefined}
          steps={(d.steps ?? []) as RunbookStep[]}
        />
      );
    case 'stack_grid':
      return <StackGrid key={w.artifactId} layers={(d.layers ?? []) as StackLayer[]} />;
    case 'annotated_code':
      return (
        <AnnotatedCode
          key={w.artifactId}
          lines={(d.lines ?? []) as Array<string | React.ReactNode>}
          annotatedLines={(d.annotatedLines ?? []) as number[]}
          ariaLabel={w.title}
          language={typeof d.language === 'string' ? d.language : undefined}
        />
      );
    default:
      return null;
  }
}
