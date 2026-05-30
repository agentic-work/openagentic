/**
 * compose_visual — `reactflow_arch` template.
 *
 * Why: mermaid_flow is unreliable for arch/topology diagrams (parser fails
 * on special chars in DNS-style node IDs, edge labels, long subgraphs).
 * ReactFlow takes a flat {nodes, edges} JSON payload — LLMs nail JSON,
 * the renderer is deterministic, and rich custom node components are
 * possible without any DSL grammar.
 *
 * Server contract: returns kind='reactflow_arch' with content = the
 * canonical {nodes, edges} JSON string. The UI WidgetRenderer mounts
 * <ReactFlow> with the parsed data.
 */
import { describe, test, expect, vi } from 'vitest';
import {
  COMPOSE_VISUAL_TOOL,
  COMPOSE_VISUAL_TEMPLATES,
  executeComposeVisual,
  type ComposeVisualInput,
} from '../ComposeVisualTool.js';

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

describe('compose_visual — reactflow_arch template (mermaid_flow replacement for arch)', () => {
  test('reactflow_arch is in COMPOSE_VISUAL_TEMPLATES', () => {
    expect(COMPOSE_VISUAL_TEMPLATES).toContain('reactflow_arch');
  });

  test('tool description mentions reactflow_arch and steers arch/topology to it', () => {
    const d = COMPOSE_VISUAL_TOOL.function.description;
    expect(d).toMatch(/reactflow_arch/);
    // The description should explicitly steer arch/topology diagrams to
    // reactflow_arch instead of mermaid_flow, otherwise models keep
    // emitting mermaid for things mermaid is bad at.
    expect(d).toMatch(/arch|topology|architecture/i);
  });

  test('executeComposeVisual accepts a valid {nodes, edges} payload', async () => {
    const { ctx, emits } = makeCtx();
    const input: ComposeVisualInput = {
      template: 'reactflow_arch',
      title: 'frontdoor_appgw_topology',
      data: {
        nodes: [
          { id: 'fd-prod', type: 'default', position: { x: 0, y: 0 }, data: { label: 'Front Door' } },
          { id: 'appgw-w', type: 'default', position: { x: 200, y: -60 }, data: { label: 'AppGW West' } },
          { id: 'appgw-e', type: 'default', position: { x: 200, y: 60 }, data: { label: 'AppGW East' } },
        ],
        edges: [
          { id: 'e1', source: 'fd-prod', target: 'appgw-w' },
          { id: 'e2', source: 'fd-prod', target: 'appgw-e' },
        ],
      },
    };
    const result = await executeComposeVisual(ctx, input);
    expect(result.ok).toBe(true);
    expect(typeof result.artifact_id).toBe('string');

    const visualEmits = emits.filter((e) => e.event === 'visual_render');
    expect(visualEmits).toHaveLength(1);

    const payload = visualEmits[0].payload as Record<string, unknown>;
    expect(payload.template).toBe('reactflow_arch');
    expect(payload.kind).toBe('reactflow_arch');

    // Content is a JSON string so the UI can parse it into ReactFlow's
    // expected {nodes, edges} props.
    expect(typeof payload.content).toBe('string');
    const parsed = JSON.parse(payload.content as string);
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.edges).toHaveLength(2);
    expect(parsed.nodes[0]).toMatchObject({ id: 'fd-prod' });
  });

  test('reactflow_arch rejects missing nodes', async () => {
    const { ctx } = makeCtx();
    const result = await executeComposeVisual(ctx, {
      template: 'reactflow_arch',
      title: 't',
      data: { edges: [] } as unknown as ComposeVisualInput['data'],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nodes/);
  });

  test('reactflow_arch rejects missing edges', async () => {
    const { ctx } = makeCtx();
    const result = await executeComposeVisual(ctx, {
      template: 'reactflow_arch',
      title: 't',
      data: { nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } }] } as unknown as ComposeVisualInput['data'],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/edges/);
  });

  test('reactflow_arch rejects edges referencing unknown node ids', async () => {
    const { ctx } = makeCtx();
    const result = await executeComposeVisual(ctx, {
      template: 'reactflow_arch',
      title: 't',
      data: {
        nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } }],
        edges: [{ id: 'e1', source: 'a', target: 'ghost' }],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ghost|unknown/);
  });
});
