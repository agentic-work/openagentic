/**
 * ToolSearchTool — synthetic meta-tool for model-invoked MCP tool discovery.
 *
 * Spec: docs/superpowers/specs/2026-05-02-tool-selection-at-scale-research.md
 *
 * Sits in the always-injected meta-tool slot. When the model emits
 * `tool_use` with name="tool_search", `executeToolSearch` POSTs the query
 * to /api/internal/tool-search (which wraps ToolSemanticCacheService over
 * Milvus mcp_tools_cache) and returns a DispatchedToolResult whose
 * `discoveredTools` field carries the resolved OpenAI tool defs. The
 * chatLoop's discoveryHook then appends those defs to the next iteration's
 * tools array — Anthropic Tool Search GA pattern.
 */

const DESCRIPTION = [
  'Search the live MCP tool catalog and EXPAND your tool set MID-TURN.',
  '',
  'How discovery works: when you call tool_search, the matching tool',
  'definitions (full input_schema, parameter docs, server name) are',
  'appended to YOUR CURRENT tool array immediately — you can invoke any',
  'discovered tool in the SAME turn, on the next tool_use, without',
  'waiting another conversation round-trip. Refusing to act without',
  'searching is wrong; the catalog is large and discoverable.',
  '',
  'Use FIRST when the user asks for cloud resources (Azure/AWS/GCP),',
  'kubernetes/k8s state, github operations, web fetch, or anything',
  'operational not handled by your always-on meta-tools (Task,',
  'compose_visual, compose_app, render_artifact, request_clarification,',
  'synth, memorize).',
  '',
  'When you hit "tool not found" or your tools list does not contain a',
  'verb that matches what you need, search FIRST. Do not ask the user.',
  '',
  'Use plain-language queries — search is semantic. Examples:',
  '  - "azure subscriptions list"',
  '  - "create azure cognitive services deployment"',
  '  - "kubernetes pod logs"',
  '  - "github pull request review"',
  '  - "list front door profiles + endpoints"',
  '',
  'WHAT IT RETURNS: 5–8 real tool defs (k controls count, 1–20). Each',
  'def includes name + description + full JSON Schema parameters — no',
  'second round-trip needed before you can call them.',
].join('\n');

export const TOOL_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'tool_search',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What you are trying to do, in plain language. e.g. "azure cognitive services deployment", "kubernetes pod logs", "github pull request review".',
        },
        k: {
          type: 'integer',
          description: 'How many tools to retrieve. Default 8.',
          default: 8,
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

export function isToolSearchTool(name: string): boolean {
  return name === 'tool_search';
}

export interface ToolSearchInput {
  query: string;
  k?: number;
}

/**
 * Q1-fix-2 (2026-05-12): the chatLoop passes the most recent user-turn
 * text on `ctx.userPromptHint` so /api/internal/tool-search can union
 * cloud-detection across the model's narrowed query AND the original
 * user intent. Without this, a tri-cloud prompt like "cost spike across
 * Azure/AWS/GCP" followed by a model query like "Azure cost query tool"
 * returns azure-only results and the model never invokes AWS/GCP tools.
 */
const HINT_MAX_CHARS = 2048;

export interface ToolSearchResult {
  ok: boolean;
  output?: string;
  error?: string;
  discoveredTools?: ReadonlyArray<any>;
}

const DEFAULT_K = 8;

// G19 — adaptive cold/warm tool_search timeout (ported from upstream, 2026-06-06;
// landed after the OSS fork, never synced). The FIRST tool_search of the process
// pays a longer COLD budget so a cold Milvus/embedding path (first query after pod
// start, or a single Ollama shared by chat + nomic-embed under load) can resolve
// instead of aborting to ZERO tools — which the model reads as "no tools found" and
// re-searches forever until DISCOVERY_NO_NEW_THRESHOLD forces synthesis. Warm calls
// use the normal budget. Both env-overridable (raise on a single-shared-Ollama box).
const WARM_FORWARD_TIMEOUT_MS = 5_000;
const COLD_FORWARD_TIMEOUT_MS = 20_000;

// Process-level warmup latch: true until the first forward is attempted.
let toolSearchIsCold = true;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolveForwardTimeoutMs(isCold: boolean): number {
  return isCold
    ? envInt('TOOL_SEARCH_COLD_TIMEOUT_MS', COLD_FORWARD_TIMEOUT_MS)
    : envInt('TOOL_SEARCH_TIMEOUT_MS', WARM_FORWARD_TIMEOUT_MS);
}

function apiBaseUrl(): string {
  return (
    process.env.INTERNAL_API_URL
    || process.env.API_BASE_URL
    || 'http://127.0.0.1:8000'
  ).replace(/\/+$/, '');
}

function renderResultText(
  query: string,
  tools: ReadonlyArray<any>,
  connectedServers?: ReadonlyArray<string>,
): string {
  if (!tools.length) {
    // #51 (2026-06-01) — HONEST no-match message.
    //
    // The old empty branch ("no tools found, try different phrasing")
    // combined with a thresholdless backend produced the live azure spin:
    // the model kept rephrasing and re-searching forever. Now that the
    // relevance floor returns [] for a genuinely-unmatched capability, this
    // message must do the user-facing work — name what IS connected, state
    // that the cloud/ops servers require credentials/OBO and are not
    // available this session, and tell the model NOT to search again but to
    // tell the user plainly. That ends the turn with a helpful answer.
    const connected = (connectedServers ?? []).filter(Boolean);
    const connectedLine = connected.length
      ? `Connected capabilities this session: ${connected.join(', ')}.`
      : `No MCP servers are connected this session.`;
    return (
      `No connected tool matches '${query}'. ${connectedLine}\n`
      + `Azure, GCP, GitHub, Kubernetes, Prometheus and other cloud/ops servers are NOT connected `
      + `(they require credentials or Azure AD On-Behalf-Of, and you are not authenticated to them this session). `
      + `Do NOT search again for this capability. Tell the user plainly that it is not available — name what IS `
      + `connected and, if relevant, that the missing capability needs its credentials/login configured.`
    );
  }
  const names = tools
    .map((t: any) => t?.function?.name)
    .filter((n: any): n is string => typeof n === 'string');
  return (
    `Found ${tools.length} tool${tools.length === 1 ? '' : 's'} matching '${query}':\n\n`
    + names.map((n) => `- ${n}`).join('\n')
    + `\n\nFull tool definitions are now available — call any of them by name on your next turn.`
  );
}

export async function executeToolSearch(
  ctx: any,
  input: ToolSearchInput,
): Promise<ToolSearchResult> {
  const query = String(input?.query ?? '').trim();
  const k = Number.isFinite(input?.k) ? Number(input!.k) : DEFAULT_K;
  if (!query) {
    return { ok: true, discoveredTools: [], output: 'tool_search: query was empty.' };
  }

  const url = `${apiBaseUrl()}/api/internal/tool-search`;
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET ?? '';

  // Q1-fix-2 — pull recent user-turn text off ctx (chatLoop sets this on
  // dispatchCtx). When present, the route forwards it to the service so
  // cloud-detection can union both strings before deciding to fire the
  // multi-cloud diversity path.
  const hintRaw = typeof ctx?.userPromptHint === 'string' ? ctx.userPromptHint : '';
  const userPromptHint =
    hintRaw.length > HINT_MAX_CHARS ? hintRaw.slice(0, HINT_MAX_CHARS) : hintRaw;

  const requestBody: Record<string, unknown> = { query, k };
  if (userPromptHint && userPromptHint.length > 0) {
    requestBody.userPromptHint = userPromptHint;
  }

  // G19 — first call of the process pays the cold (longer) timeout. Flip the latch
  // BEFORE the await so a concurrent second call is already treated as warm.
  const isCold = toolSearchIsCold;
  toolSearchIsCold = false;
  const forwardTimeoutMs = resolveForwardTimeoutMs(isCold);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), forwardTimeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': internalSecret,
      } as any,
      body: JSON.stringify(requestBody),
      signal: ac.signal,
    } as any);
    clearTimeout(timer);

    if (!resp.ok) {
      return {
        ok: true,
        discoveredTools: [],
        output: `tool_search('${query}'): backend error ${resp.status} — no tools returned.`,
      };
    }

    const body: any = await resp.json().catch(() => ({}));
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    // #51 — the route forwards the live connected-server list on the body
    // so the no-match message can name what IS connected.
    const connectedServers = Array.isArray(body?.connectedServers)
      ? (body.connectedServers as string[])
      : undefined;
    return {
      ok: true,
      discoveredTools: tools,
      output: renderResultText(query, tools, connectedServers),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: true,
      discoveredTools: [],
      output: `tool_search('${query}'): network/timeout error — no tools returned.`,
    };
  }
}
