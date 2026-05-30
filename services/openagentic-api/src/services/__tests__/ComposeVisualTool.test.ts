/**
 * compose_visual — template-driven inline visualizer.
 *
 * Replaces RenderArtifactTool with a TEMPLATE-FIRST contract: the model
 * picks one of 8 strict templates (sankey, bar_chart, line_chart,
 * mermaid_flow, table, kpi_grid, svg_raw, html_raw) and supplies a
 * shape-validated `data` payload. The server renders the template into
 * SVG/HTML — the model never authors free-form code unless it picks
 * `svg_raw` or `html_raw` (the escape hatches).
 *
 * Why: gpt-oss:20b can't reliably author hundreds of lines of consistent
 * SVG. It CAN reliably emit a small JSON object. Templates flip the
 * authoring burden to the server, where it's deterministic and tested.
 *
 * Architecture rule: NO regex tool-name matching, NO hardcoded keyword
 * routing. Template selection is data-driven via the `template` field.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  COMPOSE_VISUAL_TOOL,
  COMPOSE_VISUAL_TEMPLATES,
  isComposeVisualTool,
  executeComposeVisual,
  type ComposeVisualInput,
} from '../ComposeVisualTool.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function makeCtx() {
  const emits: Array<{ event: string; payload: unknown }> = [];
  return {
    emits,
    ctx: {
      emit: (event: string, payload: unknown) => emits.push({ event, payload }),
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

describe('compose_visual — tool surface', () => {
  test('exports the tool definition with correct shape', () => {
    expect(COMPOSE_VISUAL_TOOL.type).toBe('function');
    expect(COMPOSE_VISUAL_TOOL.function.name).toBe('compose_visual');
    expect(COMPOSE_VISUAL_TOOL.function.description.length).toBeGreaterThan(200);
    expect(COMPOSE_VISUAL_TOOL.function.parameters.required).toEqual(['template', 'data']);
  });

  test('lists known-good templates only (mermaid ripped)', () => {
    expect(COMPOSE_VISUAL_TEMPLATES).toEqual([
      'sankey',
      'sankey_3col',
      'bar_chart',
      'line_chart',
      'table',
      'kpi_grid',
      'svg_raw',
      'html_raw',
      'chord',
      'sunburst',
      'radial_tree',
      'treemap',
      'parallel_coords',
      'heatmap',
      'arch_diagram',
      'arch',
      'reactflow_arch',
    ]);
  });

  test('isComposeVisualTool accepts canonical + common aliases', () => {
    expect(isComposeVisualTool('compose_visual')).toBe(true);
    expect(isComposeVisualTool('composeVisual')).toBe(true);
    expect(isComposeVisualTool('compose.visual')).toBe(true);
    expect(isComposeVisualTool('ComposeVisual')).toBe(true);
    // Non-aliases
    expect(isComposeVisualTool('render_artifact')).toBe(false);
    expect(isComposeVisualTool('visualize.show_widget')).toBe(false);
    expect(isComposeVisualTool('aws_list')).toBe(false);
  });
});

describe('compose_visual — sankey template', () => {
  test('emits a visual_render frame with kind=chart + JSON nodes/links', async () => {
    // #781 — sankey now emits JSON payload for client-side React Flow
    // rendering. Replaces the legacy server-side SVG sankey.
    const { ctx, emits } = makeCtx();
    const input: ComposeVisualInput = {
      template: 'sankey',
      title: 'cost_6mo',
      data: {
        flows: [
          { from: 'prod-openagentic', to: 'core-api', value: 12450 },
          { from: 'prod-openagentic', to: 'data', value: 8460 },
          { from: 'dev-openagentic', to: 'sandbox', value: 1820 },
        ],
      },
    };
    const res = await executeComposeVisual(ctx, input);
    expect(res.ok).toBe(true);
    expect(res.artifact_id).toMatch(/[a-f0-9]+/);

    const frame = emits.find((e) => e.event === 'visual_render');
    expect(frame).toBeDefined();
    const payload = frame!.payload as any;
    expect(payload.template).toBe('sankey');
    expect(payload.kind).toBe('chart');
    const parsed = JSON.parse(payload.content);
    expect(parsed.kind).toBe('sankey');
    // N flows → N links
    expect(parsed.links).toHaveLength(3);
    // Unique source/target node names → N nodes
    const nodeIds = parsed.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('prod-openagentic');
    expect(nodeIds).toContain('core-api');
    expect(nodeIds).toContain('dev-openagentic');
  });

  test('rejects malformed flows', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'sankey',
      title: 'bad',
      data: { flows: [] },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/at least one flow/i);
  });

  test('rejects non-numeric flow values', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'sankey',
      title: 'bad',
      data: { flows: [{ from: 'a', to: 'b', value: 'NaN' as any }] },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/value must be a positive number/i);
  });
});

describe('compose_visual — bar_chart template', () => {
  test('emits kind=chart with JSON {kind:bar, data:[{label,value}]}', async () => {
    // #781 — bar_chart now emits JSON payload for client-side Recharts
    // BarChart rendering. Replaces the legacy server-side SVG bars.
    const { ctx, emits } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'bar_chart',
      title: 'monthly_cost',
      data: {
        x: ['Jan', 'Feb', 'Mar', 'Apr'],
        y: [100, 250, 180, 320],
      },
    });
    expect(res.ok).toBe(true);
    const frame = emits.find((e) => e.event === 'visual_render');
    const payload = frame!.payload as any;
    expect(payload.kind).toBe('chart');
    const parsed = JSON.parse(payload.content);
    expect(parsed.kind).toBe('bar');
    expect(parsed.data).toHaveLength(4);
    expect(parsed.data[0]).toEqual({ label: 'Jan', value: 100 });
    expect(parsed.data[3]).toEqual({ label: 'Apr', value: 320 });
  });

  test('rejects mismatched x and y lengths', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'bar_chart',
      title: 'bad',
      data: { x: ['a', 'b'], y: [1] },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/x and y must have the same length/i);
  });
});

describe('compose_visual — table template', () => {
  test('emits html with table.thead and tbody rows', async () => {
    const { ctx, emits } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'table',
      title: 'costs',
      data: {
        columns: ['Resource Group', 'Service', 'USD'],
        rows: [
          ['core-api', 'compute', 12450],
          ['data', 'sql', 8460],
        ],
      },
    });
    expect(res.ok).toBe(true);
    const frame = emits.find((e) => e.event === 'visual_render');
    const payload = frame!.payload as any;
    expect(payload.kind).toBe('html');
    expect(payload.content).toContain('<table');
    expect(payload.content).toContain('<thead');
    expect((payload.content.match(/<tr/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test('rejects rows with mismatched column count', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'table',
      title: 'bad',
      data: {
        columns: ['a', 'b'],
        rows: [['x']], // 1 cell, 2 columns
      },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/row 0 has 1 cells/i);
  });
});

describe('compose_visual — kpi_grid template', () => {
  test('emits html with N kpi cards matching data length', async () => {
    const { ctx, emits } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'kpi_grid',
      title: 'dashboard',
      data: {
        kpis: [
          { label: 'Cost', value: '$66,630', trend: 'up', delta: '+12%' },
          { label: 'Resources', value: 24 },
          { label: 'Health', value: 'OK' },
        ],
      },
    });
    expect(res.ok).toBe(true);
    const frame = emits.find((e) => e.event === 'visual_render');
    const html = (frame!.payload as any).content as string;
    const cardCount = (html.match(/data-kpi-card/g) || []).length;
    expect(cardCount).toBe(3);
    expect(html).toContain('$66,630');
    expect(html).toContain('+12%');
  });
});

describe('compose_visual — mermaid ripped (2026-05-15)', () => {
  test('mermaid template is rejected with unknown-template error', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'mermaid' as any,
      title: 'flow',
      data: { diagram_src: 'flowchart TD\n  A --> B' },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/template/i);
  });

  test('diagram alias is also rejected', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'diagram' as any,
      title: 'seq',
      data: { diagram_src: 'sequenceDiagram\n  U->>S: req' },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/template/i);
  });

  test('description steers model to arch_diagram for architecture', () => {
    const desc = COMPOSE_VISUAL_TOOL.function.description;
    expect(desc.toLowerCase()).not.toContain('mermaid');
    expect(desc).toContain('arch_diagram');
  });
});

describe('compose_visual — escape-hatch templates', () => {
  test('svg_raw emits the SVG verbatim', async () => {
    const { ctx, emits } = makeCtx();
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const res = await executeComposeVisual(ctx, {
      template: 'svg_raw',
      title: 'circle',
      data: { svg },
    });
    expect(res.ok).toBe(true);
    const frame = emits.find((e) => e.event === 'visual_render');
    expect((frame!.payload as any).kind).toBe('svg');
    expect((frame!.payload as any).content).toBe(svg);
  });

  test('html_raw emits the HTML verbatim with kind=html', async () => {
    const { ctx, emits } = makeCtx();
    const html = '<div style="padding:8px">hello</div>';
    const res = await executeComposeVisual(ctx, {
      template: 'html_raw',
      title: 'hi',
      data: { html },
    });
    expect(res.ok).toBe(true);
    const frame = emits.find((e) => e.event === 'visual_render');
    expect((frame!.payload as any).kind).toBe('html');
    expect((frame!.payload as any).content).toBe(html);
  });
});

describe('compose_visual — validation', () => {
  test('rejects unknown template', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'pie_chart' as any,
      title: 'x',
      data: {} as any,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/template/i);
  });

  test('rejects missing data', async () => {
    const { ctx } = makeCtx();
    const res = await executeComposeVisual(ctx, {
      template: 'sankey',
      title: 'x',
    } as any);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/data/i);
  });

  test('hot-swap: same group_id reuses artifact_id base', async () => {
    const { ctx, emits } = makeCtx();
    void emits; // referenced for parity with other tests; not asserted here
    const r1 = await executeComposeVisual(ctx, {
      template: 'svg_raw',
      title: 'a',
      data: { svg: '<svg><rect/></svg>' },
      group_id: 'cost-flow',
    });
    const r2 = await executeComposeVisual(ctx, {
      template: 'svg_raw',
      title: 'a',
      data: { svg: '<svg><circle/></svg>' },
      group_id: 'cost-flow',
    });
    expect(r1.artifact_id?.startsWith('cost-flow:')).toBe(true);
    expect(r2.artifact_id?.startsWith('cost-flow:')).toBe(true);
    expect(r1.artifact_id).not.toBe(r2.artifact_id); // unique suffix
  });
});
