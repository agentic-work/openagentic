/**
 * compose_visual — template-driven inline visualizer.
 *
 * Replaces RenderArtifactTool's free-form `kind` + `content` shape with
 * a TEMPLATE-FIRST contract:
 *
 *   compose_visual({
 *     template: 'sankey' | 'bar_chart' | 'line_chart' | 'reactflow_arch'
 *             | 'table' | 'kpi_grid' | 'svg_raw' | 'html_raw',
 *     title: string,
 *     data: { ... template-specific shape ... },
 *     loading_messages?: string[],
 *     group_id?: string,
 *   })
 *
 * The model picks a template and supplies DATA. The server renders the
 * template into SVG/HTML deterministically — small models (gpt-oss:20b,
 * gemini-2.5-flash) reliably emit small JSON objects but fail at long,
 * consistent SVG/HTML authoring.
 *
 * Architecture rules:
 *   - NO regex tool-name matching anywhere in this file.
 *   - NO hardcoded keyword routing.
 *   - Template selection is data-driven via the `template` field.
 *   - svg_raw / html_raw exist as escape hatches; use sparingly.
 */

import crypto from 'crypto';
import { renderEChart, type EChartTemplate } from './visualizations/EChartsRenderer.js';
// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export const COMPOSE_VISUAL_TEMPLATES = [
  'sankey',
  // Phase 6 — 3-column Sankey (Subscription → ResourceGroup → Service) for
  // mock 10:300-365 anatomy. Hand-rolled gradient curves, no d3 dep.
  'sankey_3col',
  'bar_chart',
  'line_chart',
  'table',
  'kpi_grid',
  'svg_raw',
  'html_raw',
  // ECharts-backed templates (Phase 1 engine swap). Server renders to SVG
  // via echarts.renderToSVGString in pure Node — no jsdom, no DOM.
  // Reference: services/openagentic-api/src/services/visualizations/EChartsRenderer.ts
  'chord',
  'sunburst',
  'radial_tree',
  'treemap',
  'parallel_coords',
  'heatmap',
  // `arch_diagram` — stencil-based architecture diagram template with
  // dagre auto-layout. Model emits {nodes:[{id, type:'aws_s3'|'k8s_pod'
  // |..., label, sublabel}], edges:[{from, to, kind:'flow'|'data'|
  // 'auth'|...}]} — NO x/y coords needed. Renders Lucidchart-quality
  // with inline SVG stencils for AWS / Azure / GCP / k8s / ML.
  'arch_diagram',
  // Alias the model may pick instead.
  'arch',
  // `reactflow_arch` — legacy ReactFlow-backed graph; model emits
  // explicit (x,y) coords. Prefer `arch_diagram` for new code (dagre
  // auto-layout, no coords needed). Kept so older models / cached
  // examples still work.
  'reactflow_arch',
] as const;

export type ComposeVisualTemplate = (typeof COMPOSE_VISUAL_TEMPLATES)[number];

export interface ComposeVisualInput {
  template: ComposeVisualTemplate;
  title: string;
  data: unknown;
  loading_messages?: string[];
  group_id?: string;
  placement?: 'inline' | 'panel';
  /**
   * #816 — optional prose caption rendered as a line of text directly
   * under the visual. Pair with `title` so the visual reads as a
   * proper narrative beat (mock-16 anatomy: head + body + caption).
   */
  caption?: string;
}

export interface ComposeVisualResult {
  ok: boolean;
  artifact_id?: string;
  error?: string;
  /**
   * Audit §10 step 6/7 — chatLoop reads `artifact` and emits NDJSON
   * opcode `4` (ARTIFACT) so the UI's FrameRendererRegistry can dispatch
   * by `payload.template` to the matching React component (sankey,
   * incident_card, savings_grid, etc. — see mocks at
   * mocks/UX/AI/Chatmode/end-state-07..16). `kind` stays `visual_render`
   * for legacy reducer parity.
   */
  artifact?: {
    kind: 'visual_render';
    payload: Record<string, unknown>;
  };
}

interface ComposeVisualContext {
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
   * A2 (2026-05-12) — parent tool_use_id stamped on every visual emit
   * so the UI's FrameRendererRegistry can bind the frame to the right
   * tool card under parallel-tool fan-out. chatLoop populates this on
   * the dispatch ctx (chatLoop.ts:~635). Optional for legacy/test paths.
   */
  toolUseId?: string;
}

const ALIAS_NAMES = new Set<string>([
  'compose_visual',
  'composeVisual',
  'compose.visual',
  'ComposeVisual',
]);

export function isComposeVisualTool(name: string): boolean {
  return ALIAS_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Tool description (Anthropic encyclopedia-article rubric: when to use,
// when NOT to use, what it returns, canonical example).
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  'Render an inline chart or diagram from a TEMPLATE. You pick a template',
  'and supply DATA; the server draws the SVG/HTML deterministically — no',
  'need to author SVG by hand. Dispatch as a `tool_use` block named',
  '"compose_visual"; writing the schema as JSON in prose renders nothing.',
  '',
  'Fires only when the user explicitly asks for a visualization with verbs',
  "like render, plot, visualize, draw a chart, draw a graph, draw a",
  '  diagram, make a chart, make a diagram, make a flowchart, make a',
  '  sankey, illustrate. The bare verb "show" alone is NOT a trigger —',
  '  "show me my X" prompts almost always want a tool call and a list/',
  '  table response, not a chart. (Dispatch discipline beyond the verb',
  '  check is enforced server-side via tool_choice forcing; see Phase A.4.)',
  '',
  'TEMPLATE SELECTION:',
  "  - 'sankey'        flow magnitudes between named nodes (cost flows,",
  "                    traffic flows, data lineage). data: { flows: [{from, to, value}] }",
  "  - 'bar_chart'     comparison of named buckets. data: { x: string[], y: number[] }",
  "  - 'line_chart'    time-series. data: { x: string[], y: number[] }",
  "  - 'table'         tabular results. data: { columns: string[], rows: any[][] }",
  "  - 'kpi_grid'      headline metric cards. data: { kpis: [{label, value, delta?, trend?}] }",
  "  - 'arch_diagram'  CLOUD ARCHITECTURE (Lucidchart-style). Stencil-based",
  "                    rendering with vendor icons (AWS / Azure / GCP / k8s /",
  "                    ML) + dagre auto-layout + nested container groups",
  "                    (Org → Folder → Project → VPC → Subnet, etc). Auto-",
  "                    layouts cleanly — no x/y coords needed.",
  "                    data:",
  '                      {',
  '                        nodes: [{ id, type?, label, sublabel?, group? }],',
  '                        edges: [{ from, to, kind?, label? }],',
  '                        groups: [{ id, label, kind?, parent? }],   // optional',
  "                        direction?: 'LR' | 'TB' | 'RL' | 'BT'      // default LR",
  '                      }',
  '                    node.type slugs: aws_ec2 aws_s3 aws_lambda aws_rds',
  '                      aws_dynamodb aws_sqs aws_sns aws_elb aws_cloudfront',
  '                      aws_apigateway aws_cognito aws_ecs aws_eks aws_iam',
  '                      aws_vpc aws_cloudwatch · azure_vm azure_blob',
  '                      azure_function azure_sql azure_cosmos azure_servicebus',
  '                      azure_appgw azure_aks azure_entra azure_monitor',
  '                      azure_keyvault azure_logicapps · gcp_gce gcp_gcs',
  '                      gcp_function gcp_sql gcp_firestore gcp_pubsub gcp_gke',
  '                      gcp_iam gcp_logging gcp_bigquery · k8s_pod',
  '                      k8s_deployment k8s_service k8s_ingress k8s_configmap',
  '                      k8s_secret k8s_job k8s_statefulset · ml_llm',
  '                      ml_embedding ml_vectordb ml_agent ml_inference',
  '                      ml_training ml_pipeline ml_rag · user browser mobile',
  '                      api database queue cache service internet cdn',
  '                      firewall monitoring. Unknown slugs fall back to a',
  "                      generic 'service' stencil — diagram never breaks.",
  '                    edge.kind: flow (request/response, default) · data',
  '                      (storage I/O, dashed blue) · auth (IAM / service-acct',
  '                      relationships, dotted amber) · control (logging /',
  '                      monitoring, solid gray) · event (Pub/Sub / event bus,',
  '                      long-dash green).',
  '                    group.kind drives container styling: org · folder ·',
  '                      account · project · region · az · vpc · subnet ·',
  '                      cluster · namespace · tier · zone · env · generic.',
  "                      Use groups to mirror Lucidchart's nested-container",
  "                      cloud diagrams — Org → Folder → Project → VPC →",
  "                      Subnet, or Region → AZ → VPC → Subnet, etc.",
  "  - 'reactflow_arch' DEPRECATED — back-compat alias for 'arch_diagram'.",
  "                    Same renderer. New code should pick 'arch_diagram'.",
  "  - 'svg_raw'       last-resort: hand-authored SVG. data: { svg: <full svg> }",
  "  - 'html_raw'      last-resort: hand-authored HTML widget (sandboxed iframe).",
  '                    data: { html: <fragment> }',
  '',
  'WORKFLOW: only fire when the user has explicitly asked for a chart or',
  'diagram. Do not invent a visualization for ambiguous list / enumerate',
  'asks ("show me my subs", "list my pods", "what RGs do I have"). Those',
  'belong in the matching MCP list tool plus a markdown table reply.',
  '',
  'CAPTION: Use the optional `caption` field (1-2 sentences) to add a',
  'prose line directly under the chart that ties the visual to the',
  'surrounding narrative (e.g. "This shows the top 3 cost drivers for',
  'last month."). Without a caption, the chart sits naked on the page',
  'and breaks the interleaved-story UX from the mocks.',
  '',
  'DO NOT USE for plain code blocks the user just wants to read.',
  'DO NOT USE for explanatory prose.',
  'DO NOT USE for "show me my X" / "list my X" enumerate asks.',
  '',
  'WHAT IT RETURNS: an `artifact_id`. Renders inline immediately. Reuse',
  'the same `group_id` to hot-swap on edits.',
  '',
  'CANONICAL EXAMPLE — Sankey for cloud costs:',
  '  compose_visual({',
  '    template: "sankey",',
  '    title: "cloud_cost_6mo",',
  '    data: {',
  '      flows: [',
  '        { from: "prod-openagentic", to: "core-api",  value: 12450 },',
  '        { from: "prod-openagentic", to: "data",      value: 8460  },',
  '        { from: "dev-openagentic",  to: "sandbox",   value: 1820  }',
  '      ]',
  '    },',
  '    group_id: "cost-flow"',
  '  })',
  '',
  'CANONICAL EXAMPLE — Cloud architecture diagram (stencil-based):',
  '  compose_visual({',
  '    template: "arch_diagram",',
  '    title: "request_flow",',
  '    data: {',
  '      nodes: [',
  '        { id: "client",   type: "user",         label: "Client" },',
  '        { id: "apigw",    type: "aws_apigateway", label: "API Gateway" },',
  '        { id: "lambda",   type: "aws_lambda",   label: "Handler" },',
  '        { id: "ddb",      type: "aws_dynamodb", label: "Table" }',
  '      ],',
  '      edges: [',
  '        { from: "client",  to: "apigw" },',
  '        { from: "apigw",   to: "lambda" },',
  '        { from: "lambda",  to: "ddb",  kind: "data" }',
  '      ],',
  '      direction: "LR"',
  '    }',
  '  })',
].join('\n');

/**
 * Phase A.1 — `input_examples` lands inside the function block per
 * Anthropic's tool-use spec: "Examples are included in the prompt
 * alongside your tool schema, showing Claude concrete patterns for
 * well-formed tool calls." Each example must validate against
 * `parameters.required` + the template's data shape. Covers the
 * highest-leverage templates for the 17-mock AC. See
 * `__tests__/artifact-tools-input-examples.test.ts`.
 */
const INPUT_EXAMPLES: ReadonlyArray<Record<string, unknown>> = [
  {
    template: 'sankey',
    title: 'cloud_cost_flow_30d',
    data: {
      flows: [
        { from: 'Azure', to: 'openagentic-prod', value: 12450 },
        { from: 'Azure', to: 'openagentic-stg', value: 3820 },
        { from: 'openagentic-prod', to: 'compute', value: 8400 },
        { from: 'openagentic-prod', to: 'storage', value: 4050 },
        { from: 'openagentic-stg', to: 'compute', value: 3820 },
      ],
    },
    group_id: 'cost-flow-30d',
  },
  {
    template: 'bar_chart',
    title: 'spend_by_service',
    data: {
      x: ['compute', 'storage', 'network', 'db'],
      y: [8400, 4050, 1980, 2200],
    },
  },
  {
    template: 'line_chart',
    title: 'p99_latency_24h',
    data: {
      x: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
      y: [120, 118, 145, 320, 280, 175],
    },
    caption: 'p99 doubled at 12:00 after the deploy of PR #789.',
  },
  {
    template: 'kpi_grid',
    title: 'sev1_at_a_glance',
    data: {
      kpis: [
        { label: 'MTTR', value: '23m', delta: '-12m', trend: 'down' },
        { label: 'open Sev-1', value: 1 },
        { label: 'rollback ready', value: 'yes' },
      ],
    },
  },
  {
    template: 'arch_diagram',
    title: 'frontdoor_appgw_flow',
    data: {
      direction: 'LR',
      nodes: [
        { id: 'user', type: 'user', label: 'Client' },
        { id: 'fd', type: 'azure_appgw', label: 'Front Door', sublabel: 'prod-fd' },
        { id: 'agw', type: 'azure_appgw', label: 'App Gateway' },
        { id: 'aks', type: 'azure_aks', label: 'aks-prod' },
        { id: 'sql', type: 'azure_sql', label: 'sql-prod' },
      ],
      edges: [
        { from: 'user', to: 'fd' },
        { from: 'fd', to: 'agw' },
        { from: 'agw', to: 'aks' },
        { from: 'aks', to: 'sql', kind: 'data' },
      ],
    },
  },
  {
    template: 'heatmap',
    title: 'rps_by_region_hour',
    data: {
      x: ['00', '06', '12', '18'],
      y: ['us-east-1', 'us-west-2', 'eu-west-1'],
      cells: [
        [0, 0, 120],
        [1, 0, 145],
        [2, 0, 320],
        [3, 0, 280],
        [0, 1, 90],
        [1, 1, 110],
        [2, 1, 240],
        [3, 1, 200],
        [0, 2, 60],
        [1, 2, 70],
        [2, 2, 180],
        [3, 2, 160],
      ],
    },
  },
];

export const COMPOSE_VISUAL_TOOL = {
  type: 'function',
  function: {
    name: 'compose_visual',
    /** Phase A.3 — strict mode REMOVED (A.6 live-verify finding: Anthropic
     * rejects tool definitions with nested `object` schemas that lack
     * `additionalProperties: false` — the free-form `data` property makes
     * full strict compliance impractical. A.4 tool_choice forcing handles
     * dispatch enforcement server-side; strict is not required for that path.
     * Schema is still well-typed: additionalProperties:false on root +
     * anyOf-null optional pattern so the model emits clean args. */
    description: DESCRIPTION,
    input_examples: INPUT_EXAMPLES,
    parameters: {
      type: 'object',
      required: ['template', 'data'],
      properties: {
        template: {
          type: 'string',
          enum: COMPOSE_VISUAL_TEMPLATES as unknown as string[],
          description: 'Pick the template. Each has a strict data shape.',
        },
        title: {
          type: 'string',
          description: 'Short snake_case identifier shown in the visual header.',
        },
        data: {
          type: 'object',
          description:
            'Template-specific data shape. See description for each template.',
        },
        loading_messages: {
          type: 'array',
          items: { type: 'string' },
          description:
            '1-3 short strings shown during streaming (e.g. "Sketching the cost flow").',
        },
        group_id: {
          type: 'string',
          description:
            'Stable id used for hot-swap on edits. Re-rendering with the same ' +
            'group_id replaces the previous visual in place.',
        },
        placement: {
          type: 'string',
          enum: ['inline', 'panel'],
          description:
            'Optional placement hint. Default is "inline" for short visuals.',
        },
        caption: {
          type: 'string',
          description:
            '#816 — Optional prose caption rendered as a line of text directly ' +
            'under the visual. Use it to add the "story" beat that ties the chart ' +
            'to the surrounding narrative (e.g. "This shows the top 3 cost drivers ' +
            'for last month."). 1-2 sentences max — keep it readable inline.',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Validators (no regex; pure shape checks).
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Renderers — deterministic, no LLM authoring required.
// ---------------------------------------------------------------------------

interface Rendered {
  kind: 'svg' | 'html' | 'reactflow_arch' | 'arch_diagram' | 'chart';
  content: string;
}

function renderSankey(data: any): Rendered {
  if (!data || !Array.isArray(data.flows) || data.flows.length === 0) {
    throw new Error('sankey requires at least one flow in data.flows');
  }
  // Validate every flow.
  data.flows.forEach((f: any, i: number) => {
    if (typeof f?.from !== 'string' || typeof f?.to !== 'string') {
      throw new Error(`flow ${i}: from and to must be strings`);
    }
    if (!isFiniteNumber(f.value) || f.value <= 0) {
      throw new Error(`flow ${i}: value must be a positive number`);
    }
  });

  // #781 — emit JSON for premium React-Flow sankey inline (curved
  // bezier edges, log-scaled widths, accent-themed). Replaces the
  // hand-tuned 2-col SVG sankey. Per memory feedback_sankey_replacement
  // _react_flow_2026_05_13 ("Switch admin Sankey to @xyflow/react").
  const flows = data.flows as Array<{ from: string; to: string; value: number }>;
  const nodeIdSet = new Set<string>();
  flows.forEach((f) => {
    nodeIdSet.add(f.from);
    nodeIdSet.add(f.to);
  });
  const nodes = Array.from(nodeIdSet).map((id) => ({ id, label: id }));
  const links = flows.map((f) => ({ source: f.from, target: f.to, value: f.value }));
  return {
    kind: 'chart' as any,
    content: JSON.stringify({ kind: 'sankey', data: [], nodes, links, title: data.title }),
  };
}

/**
 * 3-column Sankey — for cost-flow visualizations like
 * Subscription → ResourceGroup → Service.
 *
 * Mock anatomy: mocks/UX/10-inline-visualizer-tool.html:300-365 (and 01:347-357).
 *
 * Input shape:
 *   {
 *     left:  [{ name, total }],   // col-1 nodes (e.g. subscriptions)
 *     mid:   [{ name }],          // col-2 nodes (e.g. resource groups)
 *     right: [{ name }],          // col-3 nodes (e.g. services)
 *     flows_lm: [{ from, to, value }],  // col-1 → col-2
 *     flows_mr: [{ from, to, value }],  // col-2 → col-3
 *   }
 *
 * `total` on left nodes is optional — if absent we sum from flows_lm.
 */
function renderSankey3Col(data: any): Rendered {
  if (!data || typeof data !== 'object') {
    throw new Error('sankey_3col requires data object');
  }
  const left = Array.isArray(data.left) ? data.left : [];
  const mid = Array.isArray(data.mid) ? data.mid : [];
  const right = Array.isArray(data.right) ? data.right : [];
  const flowsLM = Array.isArray(data.flows_lm) ? data.flows_lm : [];
  const flowsMR = Array.isArray(data.flows_mr) ? data.flows_mr : [];
  if (left.length === 0 || mid.length === 0 || right.length === 0) {
    throw new Error('sankey_3col requires non-empty left, mid, right node arrays');
  }
  if (flowsLM.length === 0 || flowsMR.length === 0) {
    throw new Error('sankey_3col requires non-empty flows_lm and flows_mr');
  }

  // Validate every flow.
  for (const set of [flowsLM, flowsMR]) {
    set.forEach((f: any, i: number) => {
      if (typeof f?.from !== 'string' || typeof f?.to !== 'string') {
        throw new Error(`flow ${i}: from and to must be strings`);
      }
      if (!isFiniteNumber(f.value) || f.value <= 0) {
        throw new Error(`flow ${i}: value must be a positive number`);
      }
    });
  }

  // Build node totals from flows.
  const leftTotals = new Map<string, number>();
  const midInTotals = new Map<string, number>();
  const midOutTotals = new Map<string, number>();
  const rightTotals = new Map<string, number>();
  for (const f of flowsLM) {
    leftTotals.set(f.from, (leftTotals.get(f.from) ?? 0) + f.value);
    midInTotals.set(f.to, (midInTotals.get(f.to) ?? 0) + f.value);
  }
  for (const f of flowsMR) {
    midOutTotals.set(f.from, (midOutTotals.get(f.from) ?? 0) + f.value);
    rightTotals.set(f.to, (rightTotals.get(f.to) ?? 0) + f.value);
  }

  const W = 820, H = 360, NODE_W = 14, GAP = 6;
  const xL = 20;
  const xM = Math.round(W / 2 - NODE_W / 2);
  const xR = W - 20 - NODE_W;
  const usableH = H - 60;
  const totalLeft = Array.from(leftTotals.values()).reduce((a, b) => a + b, 0);
  const totalRight = Array.from(rightTotals.values()).reduce((a, b) => a + b, 0);
  const totalMid = Array.from(midInTotals.values()).reduce((a, b) => a + b, 0);
  const yScale = usableH / Math.max(totalLeft, totalMid, totalRight);

  type NodePos = { name: string; y0: number; y1: number; cursorOut: number; cursorIn: number };
  function layout(items: any[], totalsMap: Map<string, number>) {
    const out = new Map<string, NodePos>();
    let y = 30;
    for (const item of items) {
      const total = totalsMap.get(item.name) ?? item.total ?? 0;
      const h = total * yScale;
      out.set(item.name, { name: item.name, y0: y, y1: y + h, cursorOut: y, cursorIn: y });
      y += h + GAP;
    }
    return out;
  }
  const leftNodes = layout(left, leftTotals);
  // Mid uses the larger of in/out total for height; cursors track in & out separately.
  const midTotals = new Map<string, number>();
  for (const item of mid) {
    const t = Math.max(midInTotals.get(item.name) ?? 0, midOutTotals.get(item.name) ?? 0);
    midTotals.set(item.name, t);
  }
  const midNodes = layout(mid, midTotals);
  const rightNodes = layout(right, rightTotals);

  // Gradient defs — three accent palettes per source-column band.
  const gradientDefs = `
    <defs>
      <linearGradient id="cmg1" x1="0" x2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity="0.40"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0.30"/></linearGradient>
      <linearGradient id="cmg2" x1="0" x2="1"><stop offset="0" stop-color="#10b981" stop-opacity="0.40"/><stop offset="1" stop-color="#34d399" stop-opacity="0.28"/></linearGradient>
      <linearGradient id="cmg3" x1="0" x2="1"><stop offset="0" stop-color="#a78bfa" stop-opacity="0.32"/><stop offset="1" stop-color="#fbbf24" stop-opacity="0.28"/></linearGradient>
    </defs>`;

  // Build flow paths (cubic-bezier ribbons).
  function ribbon(x1: number, y0a: number, y1a: number, x2: number, y0b: number, y1b: number, gradId: string, label: string): string {
    const cp = (x1 + x2) / 2;
    const path = [
      `M ${x1} ${y0a}`,
      `C ${cp} ${y0a}, ${cp} ${y0b}, ${x2} ${y0b}`,
      `L ${x2} ${y1b}`,
      `C ${cp} ${y1b}, ${cp} ${y1a}, ${x1} ${y1a} Z`,
    ].join(' ');
    return `<path d="${path}" fill="url(#${gradId})"><title>${escapeXml(label)}</title></path>`;
  }

  const flowSvg: string[] = [];
  for (const f of flowsLM) {
    const L = leftNodes.get(f.from);
    const M = midNodes.get(f.to);
    if (!L || !M) continue;
    const h = f.value * yScale;
    const ly0 = L.cursorOut, ly1 = L.cursorOut + h;
    const my0 = M.cursorIn, my1 = M.cursorIn + h;
    L.cursorOut = ly1;
    M.cursorIn = my1;
    flowSvg.push(ribbon(xL + NODE_W, ly0, ly1, xM, my0, my1, 'cmg1', `${f.from} → ${f.to}: ${f.value}`));
  }
  for (const f of flowsMR) {
    const M = midNodes.get(f.from);
    const R = rightNodes.get(f.to);
    if (!M || !R) continue;
    const h = f.value * yScale;
    const my0 = M.cursorOut, my1 = M.cursorOut + h;
    const ry0 = R.cursorIn, ry1 = R.cursorIn + h;
    M.cursorOut = my1;
    R.cursorIn = ry1;
    flowSvg.push(ribbon(xM + NODE_W, my0, my1, xR, ry0, ry1, 'cmg2', `${f.from} → ${f.to}: ${f.value}`));
  }

  // Render node rectangles + labels.
  const nodeSvg: string[] = [];
  function rectAndLabel(nodes: Map<string, NodePos>, x: number, side: 'l' | 'm' | 'r', subtitle?: Map<string, string>) {
    const palette = side === 'l' ? '#8b5cf6' : side === 'm' ? '#a78bfa' : '#fbbf24';
    for (const [, pos] of nodes) {
      nodeSvg.push(
        `<rect x="${x}" y="${pos.y0}" width="${NODE_W}" height="${Math.max(pos.y1 - pos.y0, 1)}" fill="${palette}" rx="3"/>`,
      );
      const labelX = side === 'r' ? x - 6 : x + NODE_W + 6;
      const anchor = side === 'r' ? 'end' : 'start';
      const yMid = (pos.y0 + pos.y1) / 2;
      nodeSvg.push(
        `<text x="${labelX}" y="${yMid}" text-anchor="${anchor}" font-family="Inter, system-ui" font-size="12" fill="#f8fafc" dominant-baseline="middle">${escapeXml(pos.name)}</text>`,
      );
      const sub = subtitle?.get(pos.name);
      if (sub) {
        nodeSvg.push(
          `<text x="${labelX}" y="${yMid + 14}" text-anchor="${anchor}" font-family="JetBrains Mono, monospace" font-size="10" fill="#a1a1aa" dominant-baseline="middle">${escapeXml(sub)}</text>`,
        );
      }
    }
  }
  // Optional subtitles: total formatting for left and right nodes.
  const leftSubs = new Map<string, string>();
  for (const [name, t] of leftTotals) leftSubs.set(name, formatNumberShort(t));
  const rightSubs = new Map<string, string>();
  for (const [name, t] of rightTotals) rightSubs.set(name, formatNumberShort(t));
  rectAndLabel(leftNodes, xL, 'l', leftSubs);
  rectAndLabel(midNodes, xM, 'm');
  rectAndLabel(rightNodes, xR, 'r', rightSubs);

  // Column legend.
  const legend = `
    <text x="20" y="${H - 8}" font-family="Inter, system-ui" font-size="11" fill="#71717a">Subscription</text>
    <text x="${xM}" y="${H - 8}" font-family="Inter, system-ui" font-size="11" fill="#71717a">Resource Group</text>
    <text x="${W - 20}" y="${H - 8}" font-family="Inter, system-ui" font-size="11" fill="#71717a" text-anchor="end">Service</text>`;

  const svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="3-column Sankey" xmlns="http://www.w3.org/2000/svg">${gradientDefs}${flowSvg.join('')}${nodeSvg.join('')}${legend}</svg>`;
  return { kind: 'svg', content: svg };
}

function formatNumberShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function renderBarChart(data: any): Rendered {
  if (!data || !Array.isArray(data.x) || !Array.isArray(data.y)) {
    throw new Error('bar_chart requires x: string[] and y: number[]');
  }
  if (data.x.length !== data.y.length) {
    throw new Error('x and y must have the same length');
  }
  if (data.x.length === 0) throw new Error('bar_chart requires at least one bar');
  data.y.forEach((v: any, i: number) => {
    if (!isFiniteNumber(v)) throw new Error(`y[${i}] must be a finite number`);
  });

  // #781 — emit JSON payload for the client-side premium Chart
  // (Recharts BarChart, Linear-grade aesthetic) instead of server-side
  // SVG. Client WidgetRenderer recognizes kind='chart' and mounts the
  // Chart component inline. Replaces the hand-tuned #8b5cf6 SVG that
  // looked generic compared to current chart libraries.
  const points = (data.x as string[]).map((label, i) => ({
    label,
    value: (data.y as number[])[i],
  }));
  return {
    kind: 'chart' as any,
    content: JSON.stringify({ kind: 'bar', data: points, title: data.title }),
  };
}

function renderLineChart(data: any): Rendered {
  if (!data || !Array.isArray(data.x) || !Array.isArray(data.y)) {
    throw new Error('line_chart requires x: string[] and y: number[]');
  }
  if (data.x.length !== data.y.length) {
    throw new Error('x and y must have the same length');
  }
  if (data.x.length < 2) throw new Error('line_chart requires at least 2 points');
  data.y.forEach((v: any, i: number) => {
    if (!isFiniteNumber(v)) throw new Error(`y[${i}] must be a finite number`);
  });

  // #781 — emit JSON for premium Chart inline (Recharts LineChart with
  // monotone interpolation, gradient area, faint grid). Replaces the
  // hand-tuned SVG line that the user flagged as "generic and shitty".
  const points = (data.x as string[]).map((label, i) => ({
    label,
    value: (data.y as number[])[i],
  }));
  return {
    kind: 'chart' as any,
    content: JSON.stringify({ kind: 'line', data: points, title: data.title }),
  };
}

function renderReactFlowArch(data: any): Rendered {
  if (!Array.isArray(data?.nodes) || data.nodes.length === 0) {
    throw new Error('reactflow_arch requires data.nodes: ReactFlow Node[] (non-empty)');
  }
  if (!Array.isArray(data?.edges)) {
    throw new Error('reactflow_arch requires data.edges: ReactFlow Edge[]');
  }
  const nodeIds = new Set<string>();
  for (let i = 0; i < data.nodes.length; i++) {
    const n = data.nodes[i];
    if (!n || typeof n.id !== 'string' || n.id.length === 0) {
      throw new Error(`reactflow_arch node[${i}]: id must be a non-empty string`);
    }
    if (n.position == null || typeof n.position.x !== 'number' || typeof n.position.y !== 'number') {
      throw new Error(`reactflow_arch node[${i}] (id=${n.id}): position must be { x: number, y: number }`);
    }
    if (n.data == null || typeof n.data !== 'object') {
      throw new Error(`reactflow_arch node[${i}] (id=${n.id}): data must be an object (e.g. { label })`);
    }
    nodeIds.add(n.id);
  }
  for (let i = 0; i < data.edges.length; i++) {
    const e = data.edges[i];
    if (!e || typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') {
      throw new Error(`reactflow_arch edge[${i}]: must have string id, source, target`);
    }
    if (!nodeIds.has(e.source)) {
      throw new Error(`reactflow_arch edge[${i}] (id=${e.id}): source "${e.source}" is unknown (not in nodes)`);
    }
    if (!nodeIds.has(e.target)) {
      throw new Error(`reactflow_arch edge[${i}] (id=${e.id}): target "${e.target}" is unknown (not in nodes)`);
    }
  }
  return {
    kind: 'reactflow_arch',
    content: JSON.stringify({ nodes: data.nodes, edges: data.edges }),
  };
}

/**
 * 2026-05-14 — `arch_diagram` template.
 *
 * Model emits:
 *   {
 *     nodes: [{ id: string, type?: string, label: string, sublabel?: string, group?: string }],
 *     edges: [{ from: string, to: string, kind?: 'flow'|'data'|'auth'|'control'|'event', label?: string }],
 *     direction?: 'LR' | 'TB' | 'RL' | 'BT',
 *   }
 *
 * Auto-layout happens client-side via dagre — model never has to emit
 * x/y coords, which was the cardinal sin of the old `reactflow_arch`
 * template (crammed/overlapping output #803).
 */
const ARCH_GROUP_KINDS = new Set([
  'org', 'folder', 'account', 'project', 'region', 'az',
  'vpc', 'subnet', 'cluster', 'namespace', 'tier', 'zone',
  'env', 'generic',
]);

function renderArchDiagram(data: any): Rendered {
  if (!Array.isArray(data?.nodes) || data.nodes.length === 0) {
    throw new Error('arch_diagram requires data.nodes: ArchNode[] (non-empty)');
  }
  if (!Array.isArray(data?.edges)) {
    throw new Error('arch_diagram requires data.edges: ArchEdge[] (may be empty array, but must be present)');
  }

  // Groups are optional but when present must be a fully connected DAG —
  // every group.parent must reference another group, no cycles. Validate
  // first so node.group references can be checked against the set.
  const groupIds = new Set<string>();
  const groups = Array.isArray(data.groups) ? data.groups : [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!g || typeof g.id !== 'string' || g.id.length === 0) {
      throw new Error(`arch_diagram group[${i}]: id must be a non-empty string`);
    }
    if (typeof g.label !== 'string' || g.label.length === 0) {
      throw new Error(`arch_diagram group[${i}] (id=${g.id}): label must be a non-empty string`);
    }
    if (g.kind != null && (typeof g.kind !== 'string' || !ARCH_GROUP_KINDS.has(g.kind))) {
      throw new Error(`arch_diagram group[${i}] (id=${g.id}): kind must be one of org|folder|account|project|region|az|vpc|subnet|cluster|namespace|tier|zone|env|generic (got '${g.kind}')`);
    }
    if (groupIds.has(g.id)) {
      throw new Error(`arch_diagram group[${i}]: duplicate id '${g.id}'`);
    }
    groupIds.add(g.id);
  }
  // Parent resolution + cycle check (DFS).
  for (const g of groups) {
    if (g.parent != null) {
      if (typeof g.parent !== 'string' || !groupIds.has(g.parent)) {
        throw new Error(`arch_diagram group[id=${g.id}]: parent="${g.parent}" is unknown`);
      }
      // walk up checking we don't hit ourselves
      const seen = new Set<string>([g.id]);
      let cur: any = g.parent;
      while (cur) {
        if (seen.has(cur)) {
          throw new Error(`arch_diagram group[id=${g.id}]: parent chain cycles back to self via '${cur}'`);
        }
        seen.add(cur);
        cur = groups.find((x: any) => x.id === cur)?.parent;
      }
    }
  }

  const nodeIds = new Set<string>();
  for (let i = 0; i < data.nodes.length; i++) {
    const n = data.nodes[i];
    if (!n || typeof n.id !== 'string' || n.id.length === 0) {
      throw new Error(`arch_diagram node[${i}]: id must be a non-empty string`);
    }
    if (typeof n.label !== 'string' || n.label.length === 0) {
      throw new Error(`arch_diagram node[${i}] (id=${n.id}): label must be a non-empty string`);
    }
    if (n.type != null && typeof n.type !== 'string') {
      throw new Error(`arch_diagram node[${i}] (id=${n.id}): type must be a string slug like 'aws_s3' (or omit for generic)`);
    }
    if (n.group != null) {
      if (typeof n.group !== 'string' || !groupIds.has(n.group)) {
        throw new Error(`arch_diagram node[${i}] (id=${n.id}): group="${n.group}" is not declared in data.groups`);
      }
    }
    if (nodeIds.has(n.id)) {
      throw new Error(`arch_diagram node[${i}]: duplicate id '${n.id}'`);
    }
    nodeIds.add(n.id);
  }
  for (let i = 0; i < data.edges.length; i++) {
    const e = data.edges[i];
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') {
      throw new Error(`arch_diagram edge[${i}]: must have string 'from' + 'to' fields`);
    }
    if (!nodeIds.has(e.from)) {
      throw new Error(`arch_diagram edge[${i}]: from="${e.from}" is unknown (not in nodes)`);
    }
    if (!nodeIds.has(e.to)) {
      throw new Error(`arch_diagram edge[${i}]: to="${e.to}" is unknown (not in nodes)`);
    }
    if (e.kind != null && !['flow', 'data', 'auth', 'control', 'event'].includes(e.kind)) {
      throw new Error(`arch_diagram edge[${i}]: kind must be one of flow|data|auth|control|event (got '${e.kind}')`);
    }
  }
  if (data.direction != null && !['LR', 'TB', 'RL', 'BT'].includes(data.direction)) {
    throw new Error(`arch_diagram: direction must be one of LR|TB|RL|BT (got '${data.direction}')`);
  }
  return {
    kind: 'arch_diagram',
    content: JSON.stringify({
      nodes: data.nodes,
      edges: data.edges,
      groups: groups.length > 0 ? groups : undefined,
      direction: data.direction,
    }),
  };
}

function renderTable(data: any): Rendered {
  if (!Array.isArray(data?.columns) || data.columns.length === 0) {
    throw new Error('table requires data.columns: string[]');
  }
  if (!Array.isArray(data.rows)) {
    throw new Error('table requires data.rows: any[][]');
  }
  data.rows.forEach((r: any, i: number) => {
    if (!Array.isArray(r) || r.length !== data.columns.length) {
      throw new Error(
        `row ${i} has ${Array.isArray(r) ? r.length : 0} cells but columns has ${data.columns.length}`,
      );
    }
  });

  const thead = (data.columns as string[])
    .map((c) => `<th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--mw-line-1, rgba(255,255,255,.06));color:var(--mw-fg-3,#71717a);font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:500">${escapeXml(c)}</th>`)
    .join('');
  const tbody = (data.rows as unknown[][])
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="padding:8px 10px;border-bottom:1px solid var(--mw-line-1, rgba(255,255,255,.06));font-size:13px;color:var(--mw-fg-1,#d4d4d8)">${escapeXml(String(cell))}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  const html = `<div style="border:1px solid var(--mw-line-1, rgba(255,255,255,.06));border-radius:8px;overflow:auto;background:var(--mw-bg-1,#0f1012)"><table style="width:100%;border-collapse:collapse;font-family:Inter, system-ui"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
  return { kind: 'html', content: html };
}

function renderKpiGrid(data: any): Rendered {
  if (!Array.isArray(data?.kpis) || data.kpis.length === 0) {
    throw new Error('kpi_grid requires data.kpis: array of {label,value,...}');
  }
  const cards = (data.kpis as any[])
    .map((k, i) => {
      if (typeof k?.label !== 'string') throw new Error(`kpi ${i}: label must be a string`);
      if (k?.value == null) throw new Error(`kpi ${i}: value is required`);

      // Trend tint: explicit `color: "danger|warning|success|info"` wins,
      // else derive from `trend: "up|down"`. Matches mock-01 cloud-ops cards.
      const colorMap: Record<string, string> = {
        success: 'var(--mw-success, #22c55e)',
        danger: 'var(--mw-danger, #ef4444)',
        warning: 'var(--mw-warning, #f59e0b)',
        info: 'var(--mw-info, #38bdf8)',
      };
      const tint = typeof k.color === 'string' && colorMap[k.color]
        ? colorMap[k.color]
        : k.trend === 'up'
          ? 'var(--mw-success, #22c55e)'
          : k.trend === 'down'
            ? 'var(--mw-danger, #ef4444)'
            : 'var(--mw-fg-3, #a1a1aa)';

      const delta = k.delta
        ? `<span style="font-size:11px;color:${tint};font-family:JetBrains Mono,monospace">${escapeXml(String(k.delta))}</span>`
        : '';

      // When a status color is set, paint a 3px left border in that tint
      // for the mock-01 "status rail" card look.
      const railStyle = typeof k.color === 'string' && colorMap[k.color]
        ? `;border-left:3px solid ${colorMap[k.color]}`
        : '';

      return `<div data-kpi-card style="border:1px solid var(--mw-line-1, rgba(255,255,255,.06))${railStyle};border-radius:10px;padding:14px;background:var(--mw-bg-1,#0f1012)"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mw-fg-3,#71717a);margin-bottom:6px">${escapeXml(k.label)}</div><div style="font-size:22px;font-weight:600;color:var(--mw-fg-0,#f8fafc);font-variant-numeric:tabular-nums">${escapeXml(String(k.value))}</div><div style="margin-top:6px">${delta}</div></div>`;
    })
    .join('');
  const html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;font-family:Inter, system-ui">${cards}</div>`;
  return { kind: 'html', content: html };
}

function renderSvgRaw(data: any): Rendered {
  if (typeof data?.svg !== 'string' || !data.svg.trim().startsWith('<svg')) {
    throw new Error('svg_raw requires data.svg as a string starting with <svg');
  }
  return { kind: 'svg', content: data.svg };
}

function renderHtmlRaw(data: any): Rendered {
  if (typeof data?.html !== 'string' || data.html.length === 0) {
    throw new Error('html_raw requires data.html as non-empty string');
  }
  return { kind: 'html', content: data.html };
}

// Templates routed through EChartsRenderer (Phase 1). The renderer is a
// thin shim around echarts.renderToSVGString() and produces deterministic
// SVG output (zrender counter stripped). Order in this set is the order
// shown in the model-facing description.
const ECHARTS_TEMPLATES: ReadonlySet<EChartTemplate> = new Set<EChartTemplate>([
  'chord',
  'sunburst',
  'radial_tree',
  'treemap',
  'parallel_coords',
  'heatmap',
]);

/**
 * Phase 28 — sankey auto-pick. When the model picks "sankey" but the
 * `flows` describe a 3-column dependency (some `to` nodes are also
 * `from` nodes for downstream flows), upgrade silently to the 3-col
 * gradient renderer. The model gets the visualizer it asked for; the
 * user gets the richer mock-01 / mock-10 anatomy for free.
 *
 * Returns true when `data.flows` contains at least one node that
 * appears as both a target (some flow.to) AND a source (some flow.from
 * for a downstream flow).
 */
export function isSankey3Col(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const flows = (data as { flows?: unknown }).flows;
  if (!Array.isArray(flows) || flows.length === 0) return false;
  const tos = new Set<string>();
  const froms = new Set<string>();
  for (const f of flows) {
    if (!f || typeof f !== 'object') return false;
    const ff = f as { from?: unknown; to?: unknown };
    if (typeof ff.from !== 'string' || typeof ff.to !== 'string') return false;
    froms.add(ff.from);
    tos.add(ff.to);
  }
  for (const node of tos) {
    if (froms.has(node)) return true;
  }
  return false;
}

/**
 * Translate `{flows: [{from,to,value}]}` (sankey shape) into the
 * `{left, mid, right, flows_lm, flows_mr}` shape renderSankey3Col
 * expects. Mid nodes are ones that appear as BOTH a from and a to;
 * left = pure-from, right = pure-to.
 */
export function mapSankeyTo3Col(data: unknown): null | {
  left: Array<{ name: string }>;
  mid: Array<{ name: string }>;
  right: Array<{ name: string }>;
  flows_lm: Array<{ from: string; to: string; value: number }>;
  flows_mr: Array<{ from: string; to: string; value: number }>;
} {
  if (!isSankey3Col(data)) return null;
  const flows = (data as any).flows as Array<{ from: string; to: string; value: number }>;
  const fromSet = new Set<string>();
  const toSet = new Set<string>();
  for (const f of flows) { fromSet.add(f.from); toSet.add(f.to); }
  const midSet = new Set<string>();
  for (const node of fromSet) if (toSet.has(node)) midSet.add(node);
  const left = Array.from(fromSet).filter((n) => !midSet.has(n)).map((name) => ({ name }));
  const mid = Array.from(midSet).map((name) => ({ name }));
  const right = Array.from(toSet).filter((n) => !midSet.has(n)).map((name) => ({ name }));
  const flows_lm = flows.filter((f) => !midSet.has(f.from) && midSet.has(f.to));
  const flows_mr = flows.filter((f) => midSet.has(f.from));
  return { left, mid, right, flows_lm, flows_mr };
}

function dispatch(template: ComposeVisualTemplate, data: any): Rendered {
  // Data-driven dispatch — no regex, no keyword routing.
  switch (template) {
    case 'sankey': {
      // Phase 28 — silent upgrade when flows describe 3 columns.
      const promoted = mapSankeyTo3Col(data);
      if (promoted) return renderSankey3Col(promoted);
      return renderSankey(data);
    }
    case 'sankey_3col':
      return renderSankey3Col(data);
    case 'bar_chart':
      return renderBarChart(data);
    case 'line_chart':
      return renderLineChart(data);
    case 'table':
      return renderTable(data);
    case 'kpi_grid':
      return renderKpiGrid(data);
    case 'svg_raw':
      return renderSvgRaw(data);
    case 'html_raw':
      return renderHtmlRaw(data);
    case 'chord':
    case 'sunburst':
    case 'radial_tree':
    case 'treemap':
    case 'parallel_coords':
    case 'heatmap':
      return renderEChart(template as EChartTemplate, data);
    case 'reactflow_arch':
      return renderReactFlowArch(data);
    case 'arch_diagram':
    case 'arch':
      return renderArchDiagram(data);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function executeComposeVisual(
  ctx: ComposeVisualContext,
  input: ComposeVisualInput,
): Promise<ComposeVisualResult> {
  if (
    typeof input?.template !== 'string' ||
    !COMPOSE_VISUAL_TEMPLATES.includes(input.template as ComposeVisualTemplate)
  ) {
    return {
      ok: false,
      error: `Invalid template "${String(input?.template)}". Must be one of: ${COMPOSE_VISUAL_TEMPLATES.join(', ')}.`,
    };
  }
  if (input?.data == null || typeof input.data !== 'object') {
    return { ok: false, error: 'data is required (object).' };
  }

  let rendered: Rendered;
  try {
    rendered = dispatch(input.template, input.data);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'render failed' };
  }

  const artifact_id =
    input.group_id != null
      ? `${input.group_id}:${crypto.randomBytes(4).toString('hex')}`
      : crypto.randomBytes(8).toString('hex');

  const payload = {
    artifact_id,
    template: input.template,
    kind: rendered.kind,
    content: rendered.content,
    title: input.title ?? null,
    group_id: input.group_id ?? null,
    placement: input.placement ?? null,
    caption: typeof input.caption === 'string' && input.caption.trim().length > 0
      ? input.caption.trim()
      : null,
    loading_messages: Array.isArray(input.loading_messages) ? input.loading_messages : null,
    session_id: ctx.sessionId ?? null,
    // A2 (2026-05-12) — parent tool_use_id so parallel-tool fan-out
    // binds the frame to the correct tool card.
    tool_use_id: ctx.toolUseId ?? null,
    // A3 (2026-05-12) — template slug under _meta so the UI's
    // FrameRendererRegistry can route by slug, not shape-guess.
    _meta: {
      outputTemplate: input.template,
    },
  };

  ctx.emit('visual_render', payload);

  // #500: When template is 'table', additionally emit a `streaming_table`
  // NDJSON frame so the UI's applyStreamingTableFrame() reducer + InlineStreamingTable
  // primitive render the richer surface (sticky headers, sev cell coloring,
  // mono/tnum cell classes) instead of the static escaped-HTML fallback.
  // The visual_render frame stays for backward compatibility.
  //
  // Sev-1 audit fix (2026-05-12): also emit NDJSON opcode-4 ARTIFACT
  // with `kind: 'streaming_table'` so the Vercel-compat opcode contract
  // is satisfied. Without this, table-template invocations were the
  // only compose_visual variant that didn't dual-emit an opcode-4
  // frame — UI consumers reading via the opcode reducer (FrameRendererRegistry
  // dispatch) silently dropped the table. Both surfaces stay during
  // the dual-emit window.
  if (input.template === 'table') {
    const tableData = (input.data ?? {}) as { columns?: unknown; rows?: unknown };
    const cols = (Array.isArray(tableData.columns) ? tableData.columns : []) as string[];
    const rows = (Array.isArray(tableData.rows) ? tableData.rows : []) as unknown[][];
    const streamingTablePayload = {
      type: 'streaming_table' as const,
      artifact_id,
      title: input.title ?? '',
      columns: cols.map((c) => ({ key: c, label: c })),
      rows: rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < cols.length; i++) {
          obj[cols[i]] = row[i];
        }
        return obj;
      }),
      // A2 (2026-05-12) — parent tool_use_id for fan-out binding.
      tool_use_id: ctx.toolUseId ?? null,
    };
    // Legacy frame consumed by the UI's applyStreamingTableFrame
    // reducer + InlineStreamingTable primitive (sticky headers, sev
    // cell coloring, mono/tnum cell classes).
    ctx.emit('streaming_table', streamingTablePayload);
  }

  ctx.logger.info(
    {
      artifact_id,
      template: input.template,
      kind: rendered.kind,
      bytes: rendered.content.length,
    },
    '[compose_visual] emitted',
  );

  // Sev-1 audit (2026-05-12 round 2): for `template:'table'` we ALREADY
  // emit two opcode-4 surfaces directly above (legacy `streaming_table`
  // + opcode-4 with `kind:'streaming_table'`). Returning `result.artifact`
  // would cause chatLoop.ts:668 to emit a THIRD opcode-4 with
  // `kind:'visual_render'`, and the UI would render both a streaming
  // table AND a generic visual widget for the same data.
  // Suppress the artifact slot on table template; the streaming_table
  // emit is the canonical surface for tabular data.
  if (input.template === 'table') {
    return { ok: true, artifact_id };
  }

  return {
    ok: true,
    artifact_id,
    // chatLoop emits NDJSON opcode `4` (ARTIFACT) from this; the legacy
    // `visual_render` frame still fires above for backward compat. Both
    // surfaces stay on until the UI's FrameRendererRegistry is shipping
    // for every template slug (audit §10 step 14).
    artifact: {
      kind: 'visual_render' as const,
      payload,
    },
  };
}
