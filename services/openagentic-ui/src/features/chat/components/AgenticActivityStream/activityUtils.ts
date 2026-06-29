/**
 * AgenticActivityStream — shared pure helpers (no JSX).
 *
 * Extracted verbatim from AgenticActivityStream.tsx during the god-file
 * decomposition (behavior-preserving): duration formatting, T1 meta-tool
 * filtering, tool-output error detection, structured/compact tool summaries,
 * inline-chip extraction, and the tool-cluster expand-state sessionStorage
 * helpers (the `cm.toolCluster.` key prefix lives here).
 */
import { summarizeToolCall, type ToolSummary } from '../../utils/toolSummarizer';
import type { ContentBlock, ToolCall } from './types/activity.types';

/** Loose shape for synthetic RAG-knowledge source rows parsed from block.content. */
interface RagSourceLike {
  title?: string;
  filename?: string;
  file?: string;
  name?: string;
  id?: string;
  content?: string;
  collection?: string;
  source?: string;
  path?: string;
}
interface RagBlockData {
  sources?: RagSourceLike[];
}

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * T1 meta-tool name set — sourced from
 * `services/openagentic-api/src/routes/chat/pipeline/chat/toolRegistry.ts`
 * `getAllBaseTools()`. These are the platform's agentic primitives that the
 * model uses to discover, dispatch, and self-curate workflows. User
 * directive 2026-05-12: they are noise and MUST never render as inline
 * tool cards in the activity stream.
 *
 * Important: the underlying frames (`tool_executing` / `tool_result`) still
 * flow through the wire and accumulate in `toolCallsByMessageId` — only the
 * VISUAL card is suppressed. User-visible output for the artifact-producing
 * meta-tools (compose_visual, compose_app, render_artifact) still renders
 * via the dedicated `visual_render` / `app_render` / `artifact_render`
 * frames. Synth lifecycle renders via SynthCard. Sub-agent execution
 * renders via SubAgentCard at the agent_group position. None of those
 * paths route through the tool-card filter here.
 */
const T1_TOOL_NAMES: ReadonlySet<string> = new Set([
  'tool_search',
  'agent_search',
  'Task',
  'agent_send',
  'agent_list',
  'agent_stop',
  'read_large_result',
  'web_search',
  'web_fetch',
  'synth',
  'pattern_save',
  'pattern_recall',
  'memorize',
  'compose_visual',
  'compose_app',
  'render_artifact',
  'request_clarification',
  'browser_sandbox_exec',
]);

/** True when this tool name belongs to the T1 meta-tool catalog. */
export const isT1Tool = (name: string | undefined | null): boolean =>
  !!name && T1_TOOL_NAMES.has(name);

/**
 * Resolve a content block's tool name with the same fallback chain the
 * render path uses (block.toolName → toolCalls[id].toolName). Returns
 * undefined when the block has no associated tool name yet (streaming
 * pre-name window).
 */
const resolveBlockToolName = (
  block: ContentBlock,
  toolCalls: ReadonlyArray<ToolCall>,
): string | undefined => {
  if (block.toolName) return block.toolName;
  if (block.toolId) {
    const tc = toolCalls.find((t) => t.id === block.toolId);
    return tc?.toolName;
  }
  return undefined;
};

/** A tool-typed block whose resolved tool name is in the T1 hidden set. */
export const isHiddenT1Block = (
  block: ContentBlock,
  toolCalls: ReadonlyArray<ToolCall>,
): boolean => {
  if (block.type !== 'tool_use' && block.type !== 'tool_call') return false;
  return isT1Tool(resolveBlockToolName(block, toolCalls));
};

// ----- Inline chip extraction for collapsed tool rows ---------------------
// Turns the structured summary from getStructuredSummary into a strip of small
// inline chips rendered next to the tool-row label. Restores #330 Tier-1 for
// web_search (favicon + domain) and extends the same pattern to rag_context
// (doc filename + collection hint) and any other rich summary that exposes an
// items[] list (memory_recall, list_datasets, cloud list_* tools, etc.).
export type InlineChip = {
  label: string;       // visible text on the chip
  tooltip?: string;    // title attribute — full URL, filename, path, or hint
  url?: string;        // when present, chip renders as a clickable <a>
  favicon?: string;    // resolves to an <img src=…> — google s2 for URLs, portal icon for cloud, etc.
};
export const extractInlineChips = (toolName: string, tc?: ToolCall, block?: ContentBlock): InlineChip[] => {
  // FAST PATH for RAG Knowledge rows — synthetic client-side blocks carry
  // {docsRetrieved, collections, sources:[{title, collection, source, ...}]}
  // in block.content (JSON-stringified). Parse directly; don't rely on the
  // getStructuredSummary → rag_context pipeline because the synthesized
  // block often lacks an Anthropic-shape wrapper the summarizer expects.
  if (/rag[\s_-]?knowledge|^rag_context/i.test(toolName)) {
    let data: RagBlockData | null = null;
    const raw = block?.content ?? tc?.output;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); } catch { /* ignore */ }
    } else if (raw && typeof raw === 'object') {
      data = raw as RagBlockData;
    }
    const sources: RagSourceLike[] = (data && Array.isArray(data.sources)) ? data.sources : [];
    const chips: InlineChip[] = [];
    for (const s of sources.slice(0, 3)) {
      const titleRaw = s?.title || s?.filename || s?.file || s?.name || s?.id || s?.content;
      if (!titleRaw) continue;
      // Trim markdown headings ("## 5. Flows Workflow Builder...") to something
      // readable in a chip — strip leading ##/numbers/whitespace, cap at 40 chars.
      const title = String(titleRaw).replace(/^[#\s\d.]+/, '').slice(0, 40);
      chips.push({
        label: title || 'source',
        tooltip: (s?.collection || s?.source || s?.path) ? `${titleRaw} — ${s.collection || s.source || s.path}` : String(titleRaw),
      });
    }
    if (chips.length > 0) return chips;
    // Fall through to the normal path if we couldn't parse sources.
  }

  if (!tc && block?.content) {
    tc = { toolName, output: block.content, status: 'success' } as unknown as ToolCall;
  }
  if (!tc) return [];
  const summary = getStructuredSummary(tc);
  if (!summary) return [];
  const isWebSearch = /web.*search|search.*web|websearch|brave.*search|google.*search/i.test(toolName);
  const chips: InlineChip[] = [];

  if (summary.kind === 'links') {
    for (const item of summary.items) {
      if (!item?.url) continue;
      try {
        const domain = new URL(item.url).hostname.replace(/^www\./, '');
        chips.push({
          label: domain,
          tooltip: item.title || item.url,
          url: item.url,
          favicon: item.favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
        });
        if (chips.length >= 3) break;
      } catch { /* skip invalid urls */ }
    }
    return chips;
  }

  // Rich summaries (rag_context, memory_recall, list_datasets, etc.) carry
  // their per-item data in summary.items; expose up to 3 as label+tooltip.
  if (summary.kind === 'rich' && Array.isArray(summary.items)) {
    for (const item of summary.items) {
      if (!item?.title) continue;
      chips.push({
        label: String(item.title).slice(0, 40),
        tooltip: item.hint ? `${item.title} — ${item.hint}` : item.title,
      });
      if (chips.length >= 3) break;
    }
    return chips;
  }

  // Fallback for web_search with non-standard output shapes: if no summary
  // but we have raw results in tc.output, best-effort extract up to 3 URLs.
  if (isWebSearch && tc.output) {
    // Intentionally no-op — getStructuredSummary already handles the standard
    // shapes; this branch is a sentinel to keep the regex check meaningful.
  }

  return chips;
};

export const detectErrorInOutput = (output: unknown): boolean => {
  if (!output) return false;

  // For structured objects, check explicit status fields FIRST.
  // Orchestration results (delegate_to_agents) include agent sub-results whose
  // output may contain HTML, URLs, or other content that accidentally matches
  // error keywords. Trust explicit status fields over regex scanning.
  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>;

    // MCP-style explicit error
    if (obj.error || obj.isError || obj.success === false) {
      return true;
    }

    // Orchestration result with explicit agent statuses — trust them
    const results = obj.results || obj.agents;
    if (Array.isArray(results) && results.length > 0) {
      // If all agents report explicit status, use that instead of regex
      const hasExplicitStatuses = results.every((r: { status?: string }) => r.status);
      if (hasExplicitStatuses) {
        return results.some((r: { status?: string }) => r.status === 'error' || r.status === 'failed');
      }
    }
  }

  const outputStr = typeof output === 'string'
    ? output
    : JSON.stringify(output);

  // Skip regex error detection for orchestration JSON that contains agent results
  // with explicit "status":"success" — the embedded HTML/output can false-positive
  if (/"status"\s*:\s*"success"/.test(outputStr) && /"results"\s*:\s*\[/.test(outputStr)) {
    // This looks like an orchestration result with successful agents — trust it
    // Only flag as error if there's an explicit error status in the results
    return /"status"\s*:\s*"(error|failed)"/.test(outputStr);
  }

  // Check for HTTP error status codes
  if (/\b(500|501|502|503|504|400|401|403|404|405|408|422|429)\b/.test(outputStr)) {
    if (/error|failed|failure|exception|status.*(500|4\d\d)|"code":\s*(500|4\d\d)/i.test(outputStr)) {
      return true;
    }
  }

  // Check for error keywords in output
  if (/\b(error|exception|failed|failure|unauthorized|forbidden|not found|timed?\s*out|refused|rejected)\b/i.test(outputStr)) {
    const lowered = outputStr.toLowerCase();
    if (
      lowered.includes('"error"') ||
      lowered.includes("'error'") ||
      lowered.includes('error:') ||
      lowered.includes('failed:') ||
      lowered.includes('exception:') ||
      /status["']?\s*:\s*["']?(error|failed)/i.test(outputStr) ||
      /Internal Server Error/i.test(outputStr)
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Generate a compact 1-line result summary from tool output.
 *
 * Delegates to the shared per-tool summarizer (toolSummarizer.ts) so every
 * place that renders tool chips (inline chip + grouped activity stream)
 * produces the same text. Web-search results return a links structure that
 * AgenticActivityStream still collapses to a text preview here (the grouped
 * view doesn't render favicons — only the individual chip does).
 */
/**
 * Compute the structured tool summary (text OR links). The richer-shape
 * counterpart to `getCompactSummary` for callers that want to render
 * favicons + clickable URL pills inline (web_search, web_fetch, etc).
 *
 * Why both? Most callsites in this file collapse the summary into a single
 * line of overflow-ellipsised text where rich link rendering would never
 * fit. Only the per-step tree row at the success branch has horizontal
 * room for favicons, so it consumes this structured form. Other callsites
 * stay on the string-flattened `getCompactSummary` to preserve their
 * existing layout assumptions.
 *
 * Closes openagentic#330 Tier 1 — the favicon URLs were already
 * being computed by `summarizeToolCall` and discarded by the string
 * collapse below; this helper exposes them.
 */
export const getStructuredSummary = (toolCall: ToolCall): ToolSummary | null => {
  if (!toolCall.output && !toolCall.input) return null;

  const raw = String(toolCall.status || '');
  const status =
    raw === 'running' ? 'executing' :
    raw === 'success' ? 'completed' :
    raw === 'error' ? 'failed' :
    raw === 'pending' ? 'pending' :
    undefined;

  const looksLikeMcpId = (s?: string) =>
    !!s && /^[a-z][a-z0-9_]+$/i.test(s) && s.includes('_');
  const lookupName =
    (looksLikeMcpId(toolCall.displayName) && toolCall.displayName) ||
    (looksLikeMcpId(toolCall.toolName) && toolCall.toolName) ||
    toolCall.displayName ||
    toolCall.toolName;

  return summarizeToolCall(lookupName, toolCall.input, toolCall.output, status);
};

export const getCompactSummary = (toolCall: ToolCall): string | null => {
  const summary = getStructuredSummary(toolCall);
  if (!summary) return null;
  if (summary.kind === 'text' && summary.text) return summary.text;
  if (summary.kind === 'links' && summary.items.length > 0) {
    // Grouped view has no room for favicons — collapse to title count + first title
    const first = summary.items[0];
    if (summary.items.length === 1) return first.title;
    return `${summary.items.length} results · ${first.title}`;
  }
  return null;
};

const CLUSTER_STORAGE_PREFIX = 'cm.toolCluster.';

export const readClusterExpand = (key: string | undefined): boolean | null => {
  if (!key || typeof window === 'undefined') return null;
  try {
    const v = window.sessionStorage.getItem(CLUSTER_STORAGE_PREFIX + key);
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch {
    return null;
  }
};

export const writeClusterExpand = (key: string | undefined, expanded: boolean): void => {
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CLUSTER_STORAGE_PREFIX + key, expanded ? '1' : '0');
  } catch {
    /* swallow */
  }
};

