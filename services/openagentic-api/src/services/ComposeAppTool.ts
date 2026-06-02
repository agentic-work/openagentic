/**
 * compose_app — Phase 4 #474 step 3 — T3 mini-app tool.
 *
 * Plan: <internal-plan>
 *
 * Sister tool to compose_visual, but for full mini-apps:
 *   - The model authors a 500–1500 LOC sandboxed HTML/JS document
 *   - Server validates via composeAppValidator (CdnAllowList + size cap +
 *     no-eval + no-nested-iframe) — see services/composeAppValidator.ts
 *   - Server emits a single `app_render` NDJSON frame with the verbatim
 *     html — UI mounts it in an iframe with sandbox="allow-scripts" srcdoc
 *     and a CSP `<meta http-equiv>` locked to ${parent-origin}/api/cdn/lib/
 *     (same-origin path served by the UI)
 *
 * Trust boundary:
 *   - The tool is always injected for every model (see meta-tools.stage).
 *     Capability gating is the model's job, not the platform's.
 *   - composeAppValidator + CdnAllowList + iframe CSP reject malformed
 *     payloads from any model regardless of capability.
 *
 * Architecture rule (mirrors ComposeVisualTool):
 *   - NO regex tool-name matching anywhere in this file.
 *   - The handler is purely synchronous (no I/O) — validation is the only
 *     work; rendering happens in the browser iframe srcdoc.
 */

import crypto from 'crypto';
import { validateComposeAppPayload } from './composeAppValidator.js';
import {
  COMPOSE_APP_TEMPLATES,
  findTemplate,
  listTemplateSlugs,
} from './composeAppTemplates.js';

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export interface ComposeAppInput {
  /** Full HTML document (including <!doctype> + <html>). Optional when
   *  `template` is set — server hydrates the HTML from the registry. */
  html?: string;
  /** Short snake_case identifier shown in the app header / a11y label. */
  title: string;
  /** Stable id for hot-swap on edits — re-rendering with same group_id replaces in place. */
  group_id?: string;
  /** Set true when the model wants Pyodide (Python-in-Worker) bootstrap. */
  pyodide_required?: boolean;
  /** Set true when the page runs Python in the browser (Pyodide). */
  python_exec_required?: boolean;
  /** Optional registry slug. When set, server hydrates HTML from the
   *  template (validated params → htmlTemplate(params)). Same trust gate
   *  as the freestyle path. */
  template?: string;
  /** Hydration data for the chosen template. Shape is template-specific —
   *  validated against the template's paramsSchema. */
  params?: unknown;
}

export interface ComposeAppResult {
  ok: boolean;
  artifact_id?: string;
  error?: string;
  artifact?: {
    kind: 'app_render';
    payload: Record<string, unknown>;
  };
}

interface ComposeAppContext {
  emit: (frameType: string, payload: unknown) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
  /** Phase 4 dev-only: allow public CDNs (jsdelivr/unpkg/cdnjs) when set. */
  allowExternalCdn?: boolean;
  /**
   * A2 (2026-05-12) — parent tool_use_id stamped on app_render so the
   * UI binds the frame to the correct tool card under parallel-tool
   * fan-out. Populated by chatLoop on the dispatch ctx.
   */
  toolUseId?: string;
}

const ALIAS_NAMES = new Set<string>([
  'compose_app',
  'composeApp',
  'compose.app',
  'ComposeApp',
]);

export function isComposeAppTool(name: string): boolean {
  if (!name) return false;
  return ALIAS_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Tool description (Anthropic encyclopedia-article rubric: when to use, when
// NOT, what it returns, canonical example).
// ---------------------------------------------------------------------------

function buildTemplateCatalogue(): string[] {
  if (COMPOSE_APP_TEMPLATES.length === 0) return [];
  const lines: string[] = ['', 'PREFER A TEMPLATE WHEN ONE FITS — every template hydrates server-side from a tiny JSON params object, so you emit ~200 bytes instead of 1500 LOC of HTML, and small models still clear the quality bar:'];
  for (const t of COMPOSE_APP_TEMPLATES) {
    lines.push(`  - ${t.slug} — ${t.title}`);
  }
  lines.push('Call with { template: "<slug>", params: { ... }, title }. Server validates params against the template schema and runs the hydrated HTML through the same validator + CSP + CDN allow-list as freestyle. Pick freestyle (html) only when no template fits.');
  return lines;
}

const DESCRIPTION = [
  'Compose an inline interactive mini-app — a sandboxed HTML/JS document',
  "that renders alongside your prose response. Fires when one chart can't",
  'carry the answer: cost dashboards with linked filters, dependency',
  'graphs, multi-panel migration plans, simulators, runbooks, audit',
  'matrices, etc. Dispatch as a `tool_use` block named "compose_app";',
  'writing the schema or raw <html>/<svg> as prose renders nothing.',
  '',
  "Prefer the template path: pick a registered slug and supply a tiny",
  'JSON `params` object. Server hydrates the HTML from the template ~200',
  'bytes of input — same validator + CSP + CDN allow-list as freestyle.',
  'Reach for freestyle (html) only when no template fits. (Dispatch',
  'discipline beyond the verb check is enforced server-side via',
  'tool_choice forcing; see Phase A.4.)',
  ...buildTemplateCatalogue(),
  '',
  'USE THIS TOOL when the user asks to:',
  '  build an interactive dashboard, mini-app, simulator, what-if explorer,',
  '  multi-panel diagram with linked filters, animated flow, force graph,',
  '  decision tree with click-through detail, or "anything I can interact with".',
  '',
  'DO NOT USE for one-shot charts — pick compose_visual instead. DO NOT USE',
  'for plain prose, tables, or when a single bar/line/sankey would suffice.',
  '',
  'LIBRARY ALLOW-LIST (script src URLs MUST start with one of these — all',
  'served same-origin by the UI; the browser never reaches an external host):',
  '  /api/cdn/lib/d3@7/dist/d3.min.js',
  '  /api/cdn/lib/d3-sankey@0/dist/d3-sankey.min.js',
  '  /api/cdn/lib/d3-hierarchy@3/dist/d3-hierarchy.min.js',
  '  /api/cdn/lib/d3-chord@3/dist/d3-chord.min.js',
  '  /api/cdn/lib/echarts@5/dist/echarts.min.js',
  '  /api/cdn/lib/plotly@2/plotly.min.js',
  '  /api/cdn/lib/cytoscape@3/cytoscape.min.js',
  '  /api/cdn/lib/pyodide/0.27/pyodide.js   (only when pyodide_required=true)',
  '',
  'HARD RULES (server validates and rejects on any violation):',
  '  - No <iframe> nesting (sandbox-escape risk).',
  '  - No eval(...) and no `new Function(...)`.',
  '  - Payload <= 1 MiB.',
  '  - Public CDNs (jsdelivr / unpkg / cdnjs / skypack / esm.sh) are blocked.',
  '  - Absolute URLs to any other host are blocked. Use ONLY the same-origin',
  '    /api/cdn/lib/ proxy path — there is no external CDN hostname.',
  '',
  'PYODIDE: set pyodide_required=true when you need browser-side Python',
  '(NumPy / pandas / matplotlib). Matplotlib MUST use the Agg backend',
  '(HTML5 backend is broken in Web Workers).',
  '',
  'WHAT IT RETURNS: an `artifact_id`. The mini-app mounts inline immediately.',
  'Reuse the same `group_id` to hot-swap on edits without losing scroll position.',
  '',
  'CANONICAL EXAMPLE — Azure cost dashboard:',
  '  compose_app({',
  '    title: "azure_cost_2026q1",',
  '    html: "<!doctype html><html><head><title>Azure Costs</title>" +',
  '          "<script src=\\"/api/cdn/lib/echarts@5/dist/echarts.min.js\\"></script>" +',
  '          "</head><body><div id=\\"chart\\" style=\\"height:480px\\"></div>" +',
  '          "<script>/* echarts init + click filters here */</script>" +',
  '          "</body></html>",',
  '    group_id: "azure-cost-q1"',
  '  })',
].join('\n');

/**
 * Phase A.1 — `input_examples` sourced from the `COMPOSE_APP_TEMPLATES`
 * registry's `exampleParams` field. Every registered template
 * auto-contributes one canonical example to the model's prompt-time
 * schema — no hand-rolled drift between schemas and examples.
 * Anthropic spec: "Examples are included in the prompt alongside your
 * tool schema, showing Claude concrete patterns for well-formed tool
 * calls." See `__tests__/artifact-tools-input-examples.test.ts`.
 */
const INPUT_EXAMPLES: ReadonlyArray<Record<string, unknown>> = COMPOSE_APP_TEMPLATES.map(
  (tpl) => ({
    template: tpl.slug,
    title: tpl.title,
    params: tpl.exampleParams as Record<string, unknown>,
  }),
);

export const COMPOSE_APP_TOOL = {
  type: 'function',
  function: {
    name: 'compose_app',
    /** Phase A.3 — strict mode REMOVED (A.6 live-verify finding: see
     * ComposeVisualTool for full rationale). A.4 tool_choice forcing handles
     * dispatch enforcement; strict is not required. */
    description: DESCRIPTION,
    input_examples: INPUT_EXAMPLES,
    parameters: {
      type: 'object',
      required: ['title'],
      properties: {
        html: {
          type: 'string',
          description:
            'Freestyle path — full HTML document including <!doctype html> + ' +
            '<html> + <head> + <body>. Use ONLY when no registry template fits. ' +
            'ALL <script src="..."> URLs must start with /api/cdn/lib/ — ' +
            'a same-origin path served by the UI. Public ' +
            'CDNs (jsdelivr, unpkg, cdnjs) and any other absolute host are ' +
            'blocked. No <iframe>, no eval(), no new Function(). ' +
            'Either `template` or `html` is required.',
        },
        template: {
          type: 'string',
          enum: listTemplateSlugs(),
          description:
            'Preferred path — registry slug. Server hydrates the HTML from ' +
            'the matching template using the typed `params` object. Same ' +
            'validator + CSP + CDN allow-list as the freestyle path; templates ' +
            'are NOT a privilege escalation. Pick this whenever a template fits.',
        },
        params: {
          type: 'object',
          description:
            'Hydration data for the chosen template. Validated server-side ' +
            'against the template-specific zod schema; rejected payloads come ' +
            'back as a tool error so you can correct and retry. Required when ' +
            '`template` is set.',
          additionalProperties: true,
        },
        title: {
          type: 'string',
          description: 'Short snake_case identifier shown in the app header.',
        },
        group_id: {
          type: 'string',
          description:
            'Stable id for hot-swap on edits. Re-rendering with the same ' +
            'group_id replaces the previous mini-app in place.',
        },
        pyodide_required: {
          type: 'boolean',
          description:
            'Set true when the page bootstraps Pyodide (Python-in-Worker). ' +
            'Avoid the ~15 MB cold load when not needed.',
        },
        python_exec_required: {
          type: 'boolean',
          description:
            'Set true when the page runs Python in the browser (Pyodide).',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function executeComposeApp(
  ctx: ComposeAppContext,
  input: ComposeAppInput,
): Promise<ComposeAppResult> {
  if (typeof input?.title !== 'string' || input.title.length === 0) {
    return { ok: false, error: 'title is required (non-empty string).' };
  }

  // Decide path: template (registry) > html (freestyle). Both unset is an
  // error; both set warns and prefers the template.
  const hasTemplate = typeof input?.template === 'string' && input.template.length > 0;
  const hasHtml = typeof input?.html === 'string' && input.html.length > 0;

  if (!hasTemplate && !hasHtml) {
    return {
      ok: false,
      error: 'either `template` (registry slug) or `html` (freestyle) is required.',
    };
  }

  let renderedHtml: string;

  if (hasTemplate) {
    if (hasHtml) {
      ctx.logger.warn(
        { title: input.title, template: input.template },
        '[compose_app] both template and html supplied; ignoring html',
      );
    }

    const tpl = findTemplate(input.template!);
    if (!tpl) {
      const error = `compose_app rejected — unknown template "${input.template}". Known: ${listTemplateSlugs().join(', ')}`;
      ctx.logger.warn(
        { title: input.title, template: input.template },
        '[compose_app] unknown template',
      );
      return { ok: false, error };
    }

    // Validate params against the template schema.
    const parsed = tpl.paramsSchema.safeParse(input.params);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      const error = `compose_app rejected — invalid params for template "${tpl.slug}": ${issues}`;
      ctx.logger.warn(
        { title: input.title, template: tpl.slug, issues },
        '[compose_app] params failed schema',
      );
      return { ok: false, error };
    }

    try {
      renderedHtml = tpl.htmlTemplate(parsed.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.error(
        { title: input.title, template: tpl.slug, error: message },
        '[compose_app] template hydration threw',
      );
      return { ok: false, error: `compose_app rejected — template hydration failed: ${message}` };
    }
  } else {
    renderedHtml = input.html as string;
  }

  // EVERY payload — registry-hydrated or freestyle — flows through the same
  // validator. The registry is NOT a privilege escalation.
  const validation = validateComposeAppPayload(renderedHtml, {
    allowExternalCdn: ctx.allowExternalCdn === true,
  });
  if (!validation.ok) {
    const error = `compose_app rejected — ${validation.errors.join('; ')}`;
    ctx.logger.warn(
      {
        title: input.title,
        template: input.template ?? null,
        violations: validation.errors,
        bytes: renderedHtml.length,
      },
      '[compose_app] payload rejected',
    );
    return { ok: false, error };
  }

  const artifact_id =
    input.group_id != null
      ? `${input.group_id}:${crypto.randomBytes(4).toString('hex')}`
      : crypto.randomBytes(8).toString('hex');

  // #487 — emit the nonce-attached HTML and the nonce itself so the
  // AppRenderer can assemble a CSP that drops `'unsafe-inline'` and
  // uses `'nonce-XXX'` instead. validation.hardenedHtml + .nonce are
  // populated by the validator on success.
  const payload = {
    artifact_id,
    html: validation.hardenedHtml ?? renderedHtml,
    title: input.title,
    group_id: input.group_id ?? null,
    pyodide_required: input.pyodide_required === true,
    python_exec_required: input.python_exec_required === true,
    session_id: ctx.sessionId ?? null,
    template: input.template ?? null,
    nonce: validation.nonce ?? null,
    // A2 (2026-05-12) — parent tool_use_id so parallel-tool fan-out
    // binds the frame to the correct tool card.
    tool_use_id: ctx.toolUseId ?? null,
    // A3 (2026-05-12) — template slug under _meta. For freestyle HTML
    // (no template), the kind slug ('app_render') is used so the UI's
    // FrameRendererRegistry can still route by name.
    _meta: {
      outputTemplate: input.template ?? 'app_render',
    },
  };

  ctx.emit('app_render', payload);
  ctx.logger.info(
    {
      artifact_id,
      title: input.title,
      template: input.template ?? null,
      bytes: renderedHtml.length,
      pyodide_required: payload.pyodide_required,
      python_exec_required: payload.python_exec_required,
    },
    '[compose_app] emitted',
  );

  return {
    ok: true,
    artifact_id,
    // Audit §10 step 6 — chatLoop emits NDJSON opcode `4` (ARTIFACT) from
    // this. Legacy `app_render` frame still fires above for backward
    // compat. `payload.template` is already stamped (line above; nullable
    // for free-style HTML) so FrameRendererRegistry can dispatch to the
    // matching React component.
    artifact: {
      kind: 'app_render' as const,
      payload,
    },
  };
}
