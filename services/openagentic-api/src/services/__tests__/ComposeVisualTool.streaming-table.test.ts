/**
 * compose_visual table-template emits structured `streaming_table` NDJSON frame (#500)
 *
 * Background: `streamingTableEmitter.ts` defines the `streaming_table` frame
 * shape that the UI's `applyStreamingTableFrame()` reducer + InlineStreamingTable
 * primitive consume. The primitive supports sticky headers, sev-coloured cells
 * (`{sev:'ok'|'warn'|'err',text}`), mono/tnum cell classes, and incremental
 * row appends — features that the static-HTML render in renderTable() can't
 * provide.
 *
 * Live evidence (2026-04-30 k8s pods probe): when the model used a markdown
 * table to render 28 pods, the UI fell back to vanilla markdown tables.
 * No richer primitive fired. Issue #500 traces this gap.
 *
 * Fix: when `executeComposeVisual` runs with `template: 'table'`, it must
 * emit a `streaming_table` frame ALONGSIDE the existing `visual_render`
 * frame, so the UI's reducer can pick the richer primitive.
 *
 * The visual_render frame stays for backward compatibility (older UI builds
 * still consume it). The new streaming_table frame is additive.
 */
import { describe, test, expect, vi } from 'vitest';
import { executeComposeVisual } from '../ComposeVisualTool.js';

function makeCtx() {
  const emits: Array<{ event: string; payload: any }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: any) => emits.push({ event, payload }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sessionId: 'test-session',
      userId: 'test-user',
    },
  };
}

describe('compose_visual table → streaming_table NDJSON emit (#500)', () => {
  test('emits streaming_table frame with rows-as-keyed-objects', async () => {
    const { emits, ctx } = makeCtx();
    const result = await executeComposeVisual(ctx as any, {
      template: 'table',
      title: 'Pods in openagentic',
      data: {
        columns: ['name', 'status', 'restarts'],
        rows: [
          ['openagentic-api-0', 'Running', 0],
          ['openagentic-postgres-extensions-0', 'Pending', 0],
        ],
      },
    });

    expect(result.ok).toBe(true);
    const streamingTableFrames = emits.filter((e) => e.event === 'streaming_table');
    expect(streamingTableFrames.length).toBe(1);
    const frame = streamingTableFrames[0].payload;

    expect(frame.title).toBe('Pods in openagentic');
    expect(frame.artifact_id).toBe(result.artifact_id);
    expect(frame.columns).toEqual([
      { key: 'name', label: 'name' },
      { key: 'status', label: 'status' },
      { key: 'restarts', label: 'restarts' },
    ]);
    // Rows MUST be keyed objects (per InlineStreamingTable contract), not
    // positional arrays. The keys match `columns[*].key` exactly.
    expect(frame.rows).toEqual([
      {
        name: 'openagentic-api-0',
        status: 'Running',
        restarts: 0,
      },
      {
        name: 'openagentic-postgres-extensions-0',
        status: 'Pending',
        restarts: 0,
      },
    ]);
  });

  test('still emits the visual_render frame for backward compatibility', async () => {
    // Older UI builds (and the standalone WidgetRenderer) consume `visual_render`.
    // Adding the streaming_table frame must NOT replace it.
    const { emits, ctx } = makeCtx();
    await executeComposeVisual(ctx as any, {
      template: 'table',
      data: { columns: ['a'], rows: [['x']] },
    });

    const visualFrames = emits.filter((e) => e.event === 'visual_render');
    expect(visualFrames.length).toBe(1);
    expect(visualFrames[0].payload.template).toBe('table');
    expect(visualFrames[0].payload.kind).toBe('html');
  });

  test('does NOT emit streaming_table for non-table templates', async () => {
    // Sankey, bar_chart, line_chart, mermaid_flow etc. must not emit
    // streaming_table — that frame is only meaningful for tabular data.
    const { emits, ctx } = makeCtx();
    await executeComposeVisual(ctx as any, {
      template: 'kpi_grid',
      data: {
        kpis: [
          { label: 'Pods', value: 28 },
          { label: 'Errors', value: 0 },
        ],
      },
    });

    const streamingTableFrames = emits.filter((e) => e.event === 'streaming_table');
    expect(streamingTableFrames.length).toBe(0);
  });

  test('emits streaming_table even when title is missing (defaults to empty string)', async () => {
    const { emits, ctx } = makeCtx();
    await executeComposeVisual(ctx as any, {
      template: 'table',
      // no title field
      data: { columns: ['k'], rows: [['v']] },
    });
    const frame = emits.find((e) => e.event === 'streaming_table')?.payload;
    expect(frame).toBeDefined();
    expect(frame.title).toBe('');
  });
});
