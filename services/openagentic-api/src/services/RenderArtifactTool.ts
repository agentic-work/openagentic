/**
 * RenderArtifactTool — structured artifact emission for chatmode.
 *
 * REPLACES the regex-based `stripUnsolicitedArtifactFences` middleware.
 * Instead of the model embedding `​```html` text fences in its assistant
 * message and the api post-processing them with regex, the model calls
 * this tool with `{ kind, content, title?, group_id?, placement? }`.
 * The api emits a single NDJSON `artifact_render` frame; the UI mounts
 * the renderer off the structured payload. NO fence parsing anywhere.
 *
 * Hot-swap: calls sharing the same `group_id` replace the previous
 * artifact in place (matches the user's "next turn re-streams a new
 * artifact with same id, panel hot-swaps without flicker" mock-spec).
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

/**
 * The five canonical artifact kinds. Matches the renderer surface in
 * `services/openagentic-ui/src/features/chat/components/MessageContent/ArtifactRenderer.tsx`.
 */
export const RENDER_ARTIFACT_KINDS = [
  'html',
  'svg',
  'react',
  'python_plot',
] as const;

export type RenderArtifactKind = (typeof RENDER_ARTIFACT_KINDS)[number];

const DESCRIPTION = [
  'Embed a hand-authored HTML / SVG / React / Python-plot widget inline.',
  'Escape-hatch path for visuals that don\'t fit compose_visual or',
  'compose_app — reach for it only when neither template-driven tool',
  'works. Dispatch as a `tool_use` block named "render_artifact";',
  'writing `<html>…`, `<svg>…`, or `{"kind":...}` in prose renders',
  'nothing. (Dispatch discipline beyond the verb check is enforced',
  'server-side via tool_choice forcing; see Phase A.4.)',
  '',
  'PREFER compose_visual FIRST for any of: sankey, sequence diagrams,',
  'bar/line/charts, table, kpi grid, chord, sunburst, treemap, heatmap,',
  '**architecture / topology / traffic-flow diagrams (use template',
  "'reactflow_arch')**. compose_visual takes a tiny JSON params object",
  'and renders deterministically server-side; it is the primary path.',
  '',
  'PREFER compose_app for interactive multi-panel mini-apps with linked',
  'filters or simulators.',
  '',
  'WHEN TO USE render_artifact: only when neither compose_visual nor',
  'compose_app fits — i.e. for hand-authored single-shot HTML / React /',
  'Python-plot PNG, or for legacy back-compat. The kinds are:',
  "  - 'html'        full HTML widget (sandboxed iframe, self-contained)",
  "  - 'react'       JSX/TSX widget (compiled in-iframe via Babel)",
  "  - 'python_plot' base64 PNG you produced via synth (sandboxed Python)",
  "  - 'svg'         raw SVG you've authored",
  '',
  'For architecture / sequence / state / flowchart / class / ER / network',
  'diagrams, DO NOT use render_artifact. Use compose_visual with',
  'template:"arch_diagram" — the server lays out resource-typed nodes via',
  'dagre and renders d3 stencils that inherit chat theme tokens. Mermaid',
  'has been removed from this platform.',
  '',
  'WORKFLOW: when in doubt, render with SENSIBLE DEFAULTS rather than',
  'asking. Pick the most-recent timeframe (last 6 months for cost), all',
  'configured cloud providers/subscriptions, sensible grouping (by',
  'service). State the assumption in your prose response so the user',
  'can narrow it. NEVER ask request_clarification first when',
  'render_artifact (or compose_visual) plus sensible defaults could',
  'already satisfy the request.',
  '',
  'DO NOT USE for plain code blocks the user just wants to read.',
  'DO NOT USE for explanatory prose.',
  'DO NOT USE for sankey, arch / topology, or normal charts — those',
  'belong in compose_visual.',
  '',
  'WHAT IT RETURNS: an `artifact_id`. Renders inline immediately. Reuse',
  'the same `group_id` to hot-swap on edits ("make the chart bigger").',
  '',
  'CANONICAL EXAMPLE — html escape-hatch (no compose_visual fit):',
  '  render_artifact({',
  '    kind: "html",',
  '    content: "<!doctype html><html><body><div id=\\"x\\">…</div>" +',
  '             "<script>/* hand-rolled widget */</script></body></html>",',
  '    title: "custom widget",',
  '    group_id: "custom-2026q1"',
  '  })',
].join('\n');

/**
 * Phase A.1 — `input_examples` covering the 4 declared kinds. These are
 * the escape-hatch path (compose_visual / compose_app are preferred);
 * the examples remind the model of the SHAPE so when it does pick
 * render_artifact, it dispatches correctly via tool_use instead of
 * emitting raw HTML in prose. Anthropic spec ref. See
 * `__tests__/artifact-tools-input-examples.test.ts`.
 */
const INPUT_EXAMPLES: ReadonlyArray<Record<string, unknown>> = [
  {
    kind: 'html',
    title: 'inline_widget',
    content:
      '<!doctype html><html><head><meta charset="utf-8"><title>w</title></head>' +
      '<body><div id="x" style="font-family:sans-serif;padding:1rem">' +
      'Hand-rolled widget body</div></body></html>',
    group_id: 'custom-html-001',
  },
  {
    kind: 'svg',
    title: 'mini_chart',
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">' +
      '<rect width="200" height="100" fill="#0b0f14"/>' +
      '<polyline fill="none" stroke="#4ade80" stroke-width="2" ' +
      'points="0,80 40,60 80,70 120,30 160,40 200,20"/>' +
      '</svg>',
  },
  {
    kind: 'react',
    title: 'react_counter_widget',
    content:
      'function Counter() {\n' +
      '  const [n, setN] = React.useState(0);\n' +
      '  return React.createElement("button",' +
      ' { onClick: () => setN(n+1) }, `count: ${n}`);\n' +
      '}\n' +
      'ReactDOM.createRoot(document.getElementById("root")).render(' +
      'React.createElement(Counter));',
  },
  {
    kind: 'python_plot',
    title: 'matplotlib_bar_png',
    // 1x1 transparent PNG — placeholder showing the base64-encoded
    // shape. Real emissions come back from synth_execute as a
    // matplotlib Agg-rendered base64 string.
    content:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    placement: 'inline',
  },
];

export const RENDER_ARTIFACT_TOOL = {
  type: 'function',
  function: {
    name: 'render_artifact',
    /** Phase A.3 — strict mode REMOVED (A.6 live-verify finding: see
     * ComposeVisualTool for full rationale). A.4 tool_choice forcing handles
     * dispatch enforcement; strict is not required. */
    description: DESCRIPTION,
    input_examples: INPUT_EXAMPLES,
    parameters: {
      type: 'object',
      required: ['kind', 'content'],
      properties: {
        kind: {
          type: 'string',
          enum: RENDER_ARTIFACT_KINDS,
          description:
            'The artifact kind. `html` = full HTML page (sandboxed iframe). ' +
            '`svg` = inline SVG. `react` = JSX/TSX (compiled in-iframe via ' +
            'Babel standalone). `python_plot` = base64 PNG produced by ' +
            'Pyodide matplotlib. For architecture / sequence / flowchart ' +
            'diagrams use compose_visual template:"arch_diagram" (d3 + dagre ' +
            'auto-layout) — not render_artifact. Mermaid is removed from this ' +
            'platform.',
        },
        content: {
          type: 'string',
          description:
            'The artifact body verbatim. Will not be modified server-side. ' +
            'For `python_plot`, this is the base64 PNG. For `react`, the ' +
            'JSX/TSX source (Recharts + ReactFlow are pre-imported in the ' +
            'iframe scope for charting / diagram authoring).',
        },
        title: {
          type: 'string',
          description:
            'A short human-readable title shown in the artifact header.',
        },
        group_id: {
          type: 'string',
          description:
            'Stable id used for hot-swap. Re-rendering with the same ' +
            'group_id replaces the previous artifact in place (e.g., when ' +
            "the user asks 'make the chart bigger').",
        },
        placement: {
          type: 'string',
          enum: ['inline', 'panel'],
          description:
            'Optional placement hint. Default is "inline" for short ' +
            'artifacts and "panel" (right-rail dock) for long ones — the ' +
            'UI decides if you do not specify.',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Name-match (for the tool dispatcher's allow-list)
// ---------------------------------------------------------------------------

const ALIAS_NAMES = new Set<string>([
  'render_artifact',
  'renderArtifact',
  'RenderArtifact',
  'render-artifact',
]);

/**
 * Strict name match — used by the tool dispatcher when the model emits
 * a slight variant of the canonical name. This is a STRING ALLOW-LIST,
 * not a regex against user content. The architecture-grep test allows it.
 */
export function isRenderArtifactTool(name: string): boolean {
  return ALIAS_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface RenderArtifactInput {
  kind: RenderArtifactKind;
  content: string;
  title?: string;
  group_id?: string;
  placement?: 'inline' | 'panel';
}

export interface RenderArtifactResult {
  ok: boolean;
  artifact_id?: string;
  error?: string;
}

interface RenderArtifactContext {
  emit: (frameType: string, payload: unknown) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
  /**
   * A2 (2026-05-12) — parent tool_use_id stamped on artifact_render so
   * the UI binds the frame to the right tool card under parallel-tool
   * fan-out. Populated by chatLoop on the dispatch ctx.
   */
  toolUseId?: string;
}

/**
 * Handle a `render_artifact` tool call. Validates the input, emits one
 * `artifact_render` NDJSON frame, returns a structured tool-result the
 * model can read back to confirm the artifact was rendered.
 */
export async function executeRenderArtifact(
  ctx: RenderArtifactContext,
  input: RenderArtifactInput,
): Promise<RenderArtifactResult> {
  // Validate kind.
  if (!RENDER_ARTIFACT_KINDS.includes(input?.kind as RenderArtifactKind)) {
    return {
      ok: false,
      error: `Invalid kind "${String(input?.kind)}". Must be one of: ${RENDER_ARTIFACT_KINDS.join(', ')}.`,
    };
  }
  // Validate content.
  if (typeof input?.content !== 'string' || input.content.length === 0) {
    return {
      ok: false,
      error: 'content is required and must be a non-empty string.',
    };
  }

  const artifact_id =
    input.group_id != null
      ? `${input.group_id}:${crypto.randomBytes(4).toString('hex')}`
      : crypto.randomBytes(8).toString('hex');

  const payload = {
    artifact_id,
    kind: input.kind,
    content: input.content,
    title: input.title ?? null,
    group_id: input.group_id ?? null,
    placement: input.placement ?? null,
    session_id: ctx.sessionId ?? null,
    // A2 (2026-05-12) — parent tool_use_id so parallel-tool fan-out
    // binds the frame to the correct tool card.
    tool_use_id: ctx.toolUseId ?? null,
    // A3 (2026-05-12) — kind slug under _meta so the UI's
    // FrameRendererRegistry can route by slug, not shape-guess.
    _meta: {
      outputTemplate: input.kind,
    },
  };

  ctx.emit('artifact_render', payload);
  ctx.logger.info({
    artifact_id,
    kind: input.kind,
    group_id: input.group_id ?? null,
    title: input.title ?? null,
    bytes: input.content.length,
  }, '[render_artifact] emitted');

  return { ok: true, artifact_id };
}
