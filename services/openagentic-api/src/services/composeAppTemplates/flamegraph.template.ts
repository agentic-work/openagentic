/**
 * flamegraph — d3-flame-graph stack visualization.
 *
 * Phase 6 mocks-parity work. Audit slug: `flamegraph`. Recursive tree of
 * { name, value, children[] }.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

interface FrameNode {
  name: string;
  value: number;
  children?: FrameNode[];
}

// Zod can't natively express recursive types without z.lazy + an explicit
// type assertion. z.ZodType<T> annotation gets fooled by ZodLazy's wider
// inference under strict mode; cast via `as` is the documented escape hatch.
const FrameSchema: z.ZodType<FrameNode> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    value: z.number().nonnegative(),
    children: z.array(FrameSchema).optional(),
  }),
) as z.ZodType<FrameNode>;

const ParamsSchema = z.object({
  title: z.string().min(1),
  root: FrameSchema,
  subtitle: z.string().optional(),
  /** Unit suffix on tooltip values (e.g. "ms", "samples"). Default "samples". */
  unit: z.string().default('samples'),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'CPU flamegraph — chat-pipeline turn (450ms)',
  subtitle: 'sampled @ 99Hz, p99 turn',
  unit: 'samples',
  root: {
    name: 'all',
    value: 450,
    children: [
      {
        name: 'runChatV3',
        value: 380,
        children: [
          {
            name: 'streamProvider',
            value: 240,
            children: [
              { name: 'openai.beta.chat.completions.stream', value: 180 },
              { name: 'translateOpenAIDeltaChunk', value: 40 },
              { name: 'emit(stream_delta)', value: 20 },
            ],
          },
          {
            name: 'dispatchToolCall',
            value: 110,
            children: [
              { name: 'tool_search', value: 60 },
              { name: 'compose_app', value: 30 },
              { name: 'memorize', value: 20 },
            ],
          },
          { name: 'auditLog.append', value: 30 },
        ],
      },
      {
        name: 'preflight',
        value: 50,
        children: [
          { name: 'intentClassifier.classify', value: 28 },
          { name: 'redis.get(cache)', value: 12 },
          { name: 'milvus.semanticTopK', value: 10 },
        ],
      },
      { name: 'postflight', value: 20 },
    ],
  },
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  // Inline minimal d3-flame-graph CSS — the lib itself ships a stylesheet,
  // but the CDN allow-list only validates <script src>. We inline the bits we
  // need so we don't have to load an external <link rel="stylesheet">.
  const css = `
.fg-host { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 8px; }
#fg-chart { width: 100%; }
#fg-chart svg { width: 100%; height: 480px; display: block; }
.d3-flame-graph rect { stroke: color-mix(in srgb, var(--cm-bg) 25%, transparent); fill-opacity: 0.95; cursor: pointer; }
.d3-flame-graph rect:hover { stroke: var(--cm-fg); stroke-width: 1px; }
.d3-flame-graph-label { color: var(--cm-bg); font-family: ui-monospace, monospace; font-size: 11px; pointer-events: none; user-select: none; }
.d3-flame-graph-tip { background: var(--cm-bg-3); color: var(--cm-fg); border: 1px solid var(--cm-border); padding: 6px 10px; border-radius: 6px; font-family: ui-monospace, monospace; font-size: 12px; pointer-events: none; }
.fg-meta { font-family: ui-monospace, monospace; font-size: 11px; color: var(--cm-fg-dim); margin-top: 6px; }
`;

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="fg-host">
  <div id="fg-chart"></div>
  <div class="fg-meta">unit: ${escHtml(params.unit)} · click a frame to zoom; click root to reset</div>
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('fg-data').textContent);
const host = document.getElementById('fg-chart');
const width = host.getBoundingClientRect().width || 800;
const chart = flamegraph().width(width).height(480).cellHeight(18).transitionDuration(250).minFrameSize(2).title('');
chart.tooltip(true);
chart.label(function (d) {
  return d.data.name + ' — ' + d.data.value + ' ' + data.unit;
});
d3.select('#fg-chart').datum(data.root).call(chart);
window.addEventListener('resize', function () {
  const w = host.getBoundingClientRect().width || 800;
  chart.width(w);
  d3.select('#fg-chart').datum(data.root).call(chart);
});
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.d3, CDN_LIB.d3FlameGraph],
    jsonPayloads: { 'fg-data': params },
    inlineScripts: [script],
  });
}

export const FLAMEGRAPH_TEMPLATE: ComposeAppTemplate = {
  slug: 'flamegraph',
  title: 'Flame graph (d3-flame-graph)',
  description:
    'd3-flame-graph stack visualization. Supply { root: { name, value, children?: [...] } } recursive tree where value is sample count or duration. Click frames to zoom. Use for CPU profiles, allocation traces, span trees, any hierarchical cost view.',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.d3, CDN_LIB.d3FlameGraph],
  exampleParams,
};
