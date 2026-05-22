import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { SharedMarkdownRenderer } from '../MessageContent/SharedMarkdownRenderer';
import {
  Check,
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Globe,
  FileText,
  Code,
  Terminal,
  Edit3,
  Eye,
  Folder,
  XCircle,
  Zap,
  // Rich-summary icons (resolved from RichSummary.icon name)
  Database,
  Brain,
  Cloud,
  Server,
  Lock,
  Coins,
  Shield,
  Cpu,
  HardDrive,
  Bot,
  FileCode,
  Sparkles,
  Image as ImageIcon,
  Search as SearchIcon,
  Package,
  GitBranch,
  Book,
} from '@/shared/icons';
import ChartRenderer from '../MessageContent/ChartRenderer';
import ShikiCodeBlock from '../MessageContent/ShikiCodeBlock';
// Legacy ArtifactRenderer / StreamingArtifactRenderer / streamingArtifactDetector
// pipeline ripped 2026-05-13 (#781 Phase D.4). Interactive artifacts flow via
// Message.visualizations[] + ArtifactSlideOutLauncher in MessageBubble.
import { MCPToolRenderer, getRendererForTool, GenericMCPRenderer } from './MCPRenderers';
import { CollapsedThinkingBlock, ArtifactErrorBoundary } from '@/shared/components';
import { ThinkingSphere } from '@/shared/components/ThinkingSphere';
import { humanizeToolName, getCategoryColor } from '../../utils/toolNameHumanizer';
import { summarizeToolCall, type ToolSummary, type RichSummary } from '../../utils/toolSummarizer';
import { formatToolInputDelta } from '../../utils/toolInputDelta';
import { detectTableData } from '../../utils/tableRowStream';
import { InlineStreamingTable } from '../InlineStreamingTable';
import { AgentExecutionTimeline } from '@/features/agents/components/AgentExecutionTimeline';
import type { ExecutionStep } from '@/features/agents/hooks/useAgentPlayground';
import { useAgentTreeStore } from '@/stores/useAgentTreeStore';
import { useFollowupChipsStore } from '@/stores/useFollowupChipsStore';
// v0.6.7 task #159 — wire premium UX components into the render path.
// InlineThinkingBlock replaces CollapsedThinkingBlock for thinking blocks
// (collapsed header + live "Thought for Xs · ~N tokens" header). ToolCallCard
// receives the live input_json_delta pane while a tool is executing.
import { InlineThinkingBlock } from '../InlineThinkingBlock';
import { ToolCallCard } from './components/ToolCallCard';
// v0.6.7 task #131 (Phase F₂) — parallel tool fan-out group + sub-card. When
// N ≥ 2 tool_executing events share a toolCallRound (stamped in useChatStream),
// the group is delegated to this premium component which renders a
// flex-wrap grid with per-tool shimmer + independent completion timers,
// matching the mockup in docs/release-plans/v0.6.7-ux-mockups/01-cloud-ops.html.
// Single-tool groups (round of 1) and non-grouped sequences still flow
// through the existing inline ToolCallGroup below.
import { ToolCallGroup as ParallelFanOutGroup } from '../UnifiedAgentActivity/ToolCallGroup';
// Wire-in D (#82) — parallel tool-round container. Rendered when a
// content block carries type 'tool_round' (the server-emitted
// tool_round_start envelope), grouping its children[] under one
// .tool-parallel card per mock 01-cloud-ops.
import { ToolParallelGroup } from '../ToolParallelGroup';
// #646 Option B — sub-agent card render INLINE in the timeline at the
// agent-block position (mock 01:1077-1140). When the parent's stream
// emits a `sub_agent_started` envelope, the matching agent_group below
// renders a rich SubAgentCard wrapper around the AgentExecutionTimeline
// instead of the lightweight purple chrome. Falls back to the bare
// timeline when no SubAgentEntry has arrived yet (graceful degradation).
import { SubAgentCard, StreamingTable } from '../v2';
import { InlineAppBadge } from '../v2/InlineAppBadge';
import { InlineVizBadge } from './InlineVizBadge';
import { subAgentVariantFor } from '../../hooks/useChatStream';

import type {
  AgenticActivityStreamProps,
  SubAgentEntry,
  ToolCall,
  AgenticTask,
  ContentBlock,
  StreamingState,
  ThinkingProgress,
  HitlApprovalEntry,
} from './types/activity.types';

// ============================================================================
// Utility Functions
// ============================================================================

const formatDuration = (ms: number): string => {
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
const isT1Tool = (name: string | undefined | null): boolean =>
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
const isHiddenT1Block = (
  block: ContentBlock,
  toolCalls: ReadonlyArray<ToolCall>,
): boolean => {
  if (block.type !== 'tool_use' && block.type !== 'tool_call') return false;
  return isT1Tool(resolveBlockToolName(block, toolCalls));
};

/**
 * Detect if tool output indicates an error (500, 4xx, error messages, etc.)
 * Used to show correct status icon on tool calls even when "complete"
 */
// ----- Inline chip extraction for collapsed tool rows ---------------------
// Turns the structured summary from getStructuredSummary into a strip of small
// inline chips rendered next to the tool-row label. Restores #330 Tier-1 for
// web_search (favicon + domain) and extends the same pattern to rag_context
// (doc filename + collection hint) and any other rich summary that exposes an
// items[] list (memory_recall, list_datasets, cloud list_* tools, etc.).
type InlineChip = {
  label: string;       // visible text on the chip
  tooltip?: string;    // title attribute — full URL, filename, path, or hint
  url?: string;        // when present, chip renders as a clickable <a>
  favicon?: string;    // resolves to an <img src=…> — google s2 for URLs, portal icon for cloud, etc.
};
const extractInlineChips = (toolName: string, tc: any, block?: any): InlineChip[] => {
  // FAST PATH for RAG Knowledge rows — synthetic client-side blocks carry
  // {docsRetrieved, collections, sources:[{title, collection, source, ...}]}
  // in block.content (JSON-stringified). Parse directly; don't rely on the
  // getStructuredSummary → rag_context pipeline because the synthesized
  // block often lacks an Anthropic-shape wrapper the summarizer expects.
  if (/rag[\s_-]?knowledge|^rag_context/i.test(toolName)) {
    let data: any = null;
    const raw = block?.content ?? tc?.output;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); } catch { /* ignore */ }
    } else if (raw && typeof raw === 'object') {
      data = raw;
    }
    const sources = Array.isArray(data?.sources) ? data.sources : [];
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
    tc = { toolName, output: block.content, status: 'success' };
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

const detectErrorInOutput = (output: unknown): boolean => {
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
    const results = (obj as any).results || (obj as any).agents;
    if (Array.isArray(results) && results.length > 0) {
      // If all agents report explicit status, use that instead of regex
      const hasExplicitStatuses = results.every((r: any) => r.status);
      if (hasExplicitStatuses) {
        return results.some((r: any) => r.status === 'error' || r.status === 'failed');
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

const getToolIcon = (toolName: string): React.ReactNode => {
  const iconProps = { size: 14, strokeWidth: 2 };
  const name = toolName.toLowerCase();

  if (name.includes('search') || name.includes('web')) return <Globe {...iconProps} />;
  if (name.includes('read') || name.includes('view')) return <Eye {...iconProps} />;
  if (name.includes('write') || name.includes('create')) return <FileText {...iconProps} />;
  if (name.includes('edit') || name.includes('modify')) return <Edit3 {...iconProps} />;
  if (name.includes('bash') || name.includes('shell') || name.includes('exec')) return <Terminal {...iconProps} />;
  if (name.includes('glob') || name.includes('grep') || name.includes('find')) return <Folder {...iconProps} />;
  return <Code {...iconProps} />;
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
 * Closes openagentic-omhs#330 Tier 1 — the favicon URLs were already
 * being computed by `summarizeToolCall` and discarded by the string
 * collapse below; this helper exposes them.
 */
const getStructuredSummary = (toolCall: ToolCall): ToolSummary | null => {
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

  return summarizeToolCall(lookupName, toolCall.input, toolCall.output, status as any);
};

const getCompactSummary = (toolCall: ToolCall): string | null => {
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

/**
 * Inline render: a compact "icon + headline + badges + items" row for
 * summarizers that return `kind: 'rich'`. Used by RAG retrieval, cloud
 * resource creation, cost queries, agent delegation, etc. Items render
 * as small chips with optional hint tooltips. Designed to fit on the
 * single-line success row alongside the duration timestamp.
 *
 * openagentic-omhs#330 Tier 2.
 */
/** Map a RichSummary.icon name to a component from `@/shared/icons`. */
const RICH_ICON_MAP = {
  database:    Database,
  brain:       Brain,
  cloud:       Cloud,
  package:     Package,
  server:      Server,
  globe:       Globe,
  lock:        Lock,
  coins:       Coins,
  shield:      Shield,
  cpu:         Cpu,
  'hard-drive': HardDrive,
  bot:         Bot,
  terminal:    Terminal,
  'file-code': FileCode,
  sparkles:    Sparkles,
  image:       ImageIcon,
  search:      SearchIcon,
} as const;

const SummaryRich: React.FC<{ summary: RichSummary }> = ({ summary }) => {
  const toneColor = (tone: 'default' | 'success' | 'warn' | 'danger' | 'info' | undefined) => {
    switch (tone) {
      case 'success': return { bg: 'color-mix(in srgb, #16a34a 18%, transparent)', fg: '#16a34a' };
      case 'warn':    return { bg: 'color-mix(in srgb, #d97706 18%, transparent)', fg: '#d97706' };
      case 'danger':  return { bg: 'color-mix(in srgb, #dc2626 18%, transparent)', fg: '#dc2626' };
      case 'info':    return { bg: 'color-mix(in srgb, var(--color-primary) 18%, transparent)', fg: 'var(--color-primary)' };
      default:        return { bg: 'color-mix(in srgb, var(--color-text) 8%, transparent)', fg: 'var(--color-text-secondary)' };
    }
  };
  const IconComp = RICH_ICON_MAP[summary.icon] || Cloud;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <IconComp size={13} style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }} />
      <span
        style={{
          fontSize: 11,
          color: 'var(--color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 500,
          flexShrink: 0,
          maxWidth: '40%',
        }}
      >
        {summary.primary}
      </span>
      {summary.secondary && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: 0.8,
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          · {summary.secondary}
        </span>
      )}
      {summary.badges?.slice(0, 3).map((b, i) => {
        const c = toneColor(b.tone);
        return (
          <span
            key={i}
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 4,
              background: c.bg,
              color: c.fg,
              flexShrink: 0,
              letterSpacing: '0.2px',
              textTransform: 'uppercase' as const,
            }}
          >
            {b.label}
          </span>
        );
      })}
      {summary.items && summary.items.length > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 4,
            overflow: 'hidden',
            flexShrink: 1,
            minWidth: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {summary.items.slice(0, 3).map((item, i) => {
            const inner = (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
                  color: 'var(--color-text-secondary)',
                  fontSize: 10,
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.hint ? `${item.title} — ${item.hint}` : item.title}
              >
                {item.favicon && (
                  <img
                    src={item.favicon}
                    alt=""
                    width={11}
                    height={11}
                    style={{ flexShrink: 0, borderRadius: 2 }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                {item.badge && (() => {
                  // Per-item status pill (✓ / ✕ / running / etc) — used by
                  // delegate_to_agents to surface sub-agent outcomes at a
                  // glance. openagentic-omhs#330 Tier 4.
                  const c = toneColor(item.badgeTone);
                  return (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '0 4px',
                        borderRadius: 3,
                        background: c.bg,
                        color: c.fg,
                        flexShrink: 0,
                        marginLeft: 2,
                        letterSpacing: '0.2px',
                      }}
                    >
                      {item.badge}
                    </span>
                  );
                })()}
              </span>
            );
            return item.url ? (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                {inner}
              </a>
            ) : (
              <React.Fragment key={i}>{inner}</React.Fragment>
            );
          })}
          {summary.items.length > 3 && (
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', opacity: 0.6 }}>
              +{summary.items.length - 3}
            </span>
          )}
        </span>
      )}
    </span>
  );
};

/**
 * Inline render: a compact row of favicon + title pills, one per result
 * URL, opening in a new tab. Used for `summary.kind === 'links'` (web
 * search / web fetch). Defensively limits to 4 pills to keep the
 * single-line summary visually balanced; expanding the step still shows
 * the full result JSON.
 */
const SummaryLinks: React.FC<{ items: Array<{ title: string; url: string; favicon?: string }> }> = ({ items }) => {
  const visible = items.slice(0, 4);
  const overflow = items.length - visible.length;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {visible.map((item, i) => (
        <a
          key={`${item.url}-${i}`}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          title={item.url}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 6px 1px 4px',
            borderRadius: 4,
            background: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontSize: 11,
            lineHeight: 1.4,
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1,
          }}
        >
          {item.favicon && (
            <img
              src={item.favicon}
              alt=""
              width={12}
              height={12}
              style={{ flexShrink: 0, borderRadius: 2 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
        </a>
      ))}
      {overflow > 0 && (
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', opacity: 0.7 }}>
          +{overflow} more
        </span>
      )}
    </span>
  );
};

// ============================================================================
// Status Indicators
// ============================================================================

interface StatusDotProps {
  status: 'pending' | 'running' | 'success' | 'error';
  size?: number;
}

/**
 * Filled circle status indicator:
 * - success: filled green
 * - error: filled red
 * - running: animated spinner
 * - pending: hollow gray dot
 */
const StatusDot: React.FC<StatusDotProps> = memo(({ status, size = 14 }) => {
  if (status === 'running') {
    return <Loader2 size={size} className="animate-spin" style={{ color: 'var(--color-primary)' }} />;
  }
  if (status === 'success') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#2ea043',
        flexShrink: 0,
      }}>
        <Check size={size * 0.6} style={{ color: '#fff' }} />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#da3633',
        flexShrink: 0,
      }}>
        <XCircle size={size * 0.6} style={{ color: '#fff' }} />
      </span>
    );
  }
  // pending
  return (
    <span style={{
      display: 'inline-block',
      width: size * 0.5,
      height: size * 0.5,
      borderRadius: '50%',
      border: '1.5px solid var(--color-text-muted)',
      flexShrink: 0,
    }} />
  );
});

StatusDot.displayName = 'StatusDot';

// ============================================================================
// Category Badge — icon-led pill (icon + category name). Replaces the
// text-only badge so users can scan tool steps by category at a glance
// (☁️ AWS, ☁️ Azure, ⎈ Kubernetes, etc). openagentic-omhs#330.
// ============================================================================

const CATEGORY_ICON_MAP: Record<string, React.FC<any>> = {
  AWS:           Cloud,
  Azure:         Cloud,
  GCP:           Cloud,
  Kubernetes:    Cpu,
  Database:      Database,
  Knowledge:     Book,
  Memory:        Brain,
  Web:           Globe,
  GitHub:        GitBranch,
  Network:       Globe,
  Security:      Shield,
  Monitoring:    Eye,
  Diagrams:      Sparkles,
  Orchestration: Bot,
  Platform:      Server,
  Synth:         Sparkles,
  Tool:          Zap,
};

const CategoryBadge: React.FC<{ category: string; small?: boolean }> = memo(({ category, small }) => {
  const bgColor = getCategoryColor(category);
  const Icon = CATEGORY_ICON_MAP[category] || Zap;
  return (
    <span
      className="activity-category-badge"
      style={{
        background: bgColor,
        fontSize: small ? 9 : 10,
        padding: small ? '1px 5px 1px 4px' : '2px 7px 2px 5px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: small ? 3 : 4,
      }}
    >
      <Icon size={small ? 9 : 11} strokeWidth={2.25} style={{ flexShrink: 0 }} />
      <span>{category}</span>
    </span>
  );
});

CategoryBadge.displayName = 'CategoryBadge';

// ============================================================================
// F.1 — Streaming tool-argument preview
// ============================================================================
//
// Shows `input_json_delta` deltas live under a running tool row so users see
// the arguments form as the LLM emits them (match claude.ai's tool-card
// feel). The formatter is extracted to utils/toolInputDelta.ts so it can be
// unit-tested without dragging the whole component tree into the test env.
const ToolInputDeltaPreview: React.FC<{ partialJson: string; theme: 'light' | 'dark' }> = memo(
  ({ partialJson }) => {
    const { display, truncated, parsed } = formatToolInputDelta(partialJson);
    if (!display) return null;
    return (
      <div
        data-testid="tool-input-delta-preview"
        style={{
          marginLeft: 24,
          marginTop: 2,
          padding: '4px 10px',
          borderLeft: '2px solid var(--color-border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          lineHeight: 1.45,
          color: 'var(--color-text-muted)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          opacity: 0.85,
        }}
      >
        {display}
        {truncated && <span style={{ opacity: 0.55 }}> ({parsed ? 'truncated' : 'streaming...'})</span>}
      </div>
    );
  }
);

ToolInputDeltaPreview.displayName = 'ToolInputDeltaPreview';

// ============================================================================
// F.2 — Tool progress heartbeat tick
// ============================================================================
//
// Renders a faint "(15s) Executing azure_resource_graph_query..." line
// under a running tool row when the backend heartbeat fires. The message
// is shaped by the server (tool-execution.helper.ts emits every 5s), and
// we just display it verbatim with a subtle pulsing dot so users feel the
// tool is alive during long paginated cloud calls.

const ToolProgressTick: React.FC<{ message: string; elapsed?: number }> = memo(
  ({ message, elapsed }) => {
    if (!message) return null;
    return (
      <div
        data-testid="tool-progress-tick"
        style={{
          marginLeft: 24,
          marginTop: 2,
          padding: '2px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderLeft: '2px solid var(--color-border)',
          fontSize: 11,
          lineHeight: 1.45,
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
          opacity: 0.8,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: 'var(--color-primary, #6366f1)',
            animation: 'pulse 1.2s ease-in-out infinite',
            flexShrink: 0,
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {typeof elapsed === 'number' ? `(${elapsed}s) ` : ''}
          {message}
        </span>
      </div>
    );
  }
);

ToolProgressTick.displayName = 'ToolProgressTick';

// ============================================================================
// Inline Thinking Display
// ============================================================================

interface InlineThinkingProps {
  content: string;
  isStreaming?: boolean;
  isComplete?: boolean;
  thinkingProgress?: ThinkingProgress;
}

const ThinkingGlobeIndicator: React.FC<{
  isAnimating: boolean;
  size?: number;
  progress?: number;
  phase?: 'thinking' | 'tools' | 'generating';
  layoutId?: string;
}> = ({ isAnimating, size = 16, progress, phase = 'thinking', layoutId }) => {
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = progress !== undefined
    ? circumference - (progress / 100) * circumference
    : circumference;

  const phaseColors = {
    thinking: { primary: 'var(--cm-thinking)', glow: 'var(--cm-thinking-glow)' },
    tools: { primary: 'var(--cm-info)', glow: 'var(--cm-info-glow)' },
    generating: { primary: 'var(--cm-ok)', glow: 'var(--cm-ok-glow)' },
  };
  const colors = phaseColors[phase];

  const containerStyle = { width: size, height: size, position: 'relative' as const, flexShrink: 0 };

  const content = (
    <>
      <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={strokeWidth} />
        <circle
          cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={colors.primary} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={progress !== undefined ? progressOffset : 0}
          style={{
            transition: progress !== undefined ? 'stroke-dashoffset 0.3s ease-out' : 'none',
            filter: isAnimating ? `drop-shadow(0 0 2px ${colors.glow})` : 'none',
            animation: isAnimating && progress === undefined ? 'thinking-spin 2s linear infinite' : 'none',
          }}
        />
      </svg>
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: size * 0.5,
        height: size * 0.5,
      }}>
        {/* 2026-05-07 — was a static `/think.svg` square that pulse-scaled.
            User asked to swap for the existing canvas-based ThinkingSphere
            (sparkles + rotating arcs) so the inline thinking indicator
            matches the rest of the app's animated aesthetic. */}
        <ThinkingSphere state={isAnimating ? 'thinking' : 'hidden'} size={size * 0.5} />
      </div>
      <style>{`
        @keyframes thinking-spin { from { stroke-dashoffset: 0; } to { stroke-dashoffset: ${circumference}; } }
      `}</style>
    </>
  );

  if (layoutId) {
    return (
      <motion.div
        layoutId={layoutId}
        style={containerStyle}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {content}
      </motion.div>
    );
  }

  return <div style={containerStyle}>{content}</div>;
};

const InlineThinking: React.FC<InlineThinkingProps> = memo(({
  content,
  isStreaming,
  isComplete,
  thinkingProgress,
}) => {
  const [showFull, setShowFull] = useState(false);
  const layoutId = useMemo(() => `thinking-globe-${Math.random().toString(36).slice(2, 9)}`, []);

  if (!content) return null;

  const shouldShowContent = isStreaming || showFull;
  const preview = content.split('\n')[0].substring(0, 100) + (content.length > 100 ? '...' : '');

  return (
    <LayoutGroup>
      <div
        className="cm-thinking inline-thinking-natural"
        style={{
          marginBottom: 8,
          opacity: isComplete && !showFull ? 0.6 : 1,
          transition: 'opacity 0.2s ease',
        }}
      >
        {!shouldShowContent && (
          <button
            onClick={() => setShowFull(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 12,
              width: '100%',
              textAlign: 'left',
            }}
          >
            <ChevronRight size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <ThinkingGlobeIndicator
              isAnimating={false}
              size={12}
              phase="thinking"
              layoutId={layoutId}
            />
            <span style={{
              fontStyle: 'italic',
              flex: 1,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              lineHeight: '1.4',
              fontSize: 12,
              color: 'var(--color-text-secondary)',
            }}>
              {(() => {
                // Extract first meaningful sentence from thinking content
                // Skip internal reasoning like tool signatures, JSON, code
                const lines = content.split('\n').filter(l => l.trim().length > 10);
                const meaningful = lines.find(l =>
                  !l.includes('signature') && !l.includes('function(') &&
                  !l.includes('{') && !l.includes('args:') && !l.includes('::') &&
                  /[A-Z]/.test(l.charAt(0))
                ) || lines[0] || content.substring(0, 150);
                return meaningful.substring(0, 150) + (meaningful.length > 150 ? '...' : '');
              })()}
            </span>
            {thinkingProgress && (
              <span style={{ flexShrink: 0, fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' }}>
                ~{(thinkingProgress.tokensUsed / 1000).toFixed(1)}k tokens
              </span>
            )}
          </button>
        )}

        {shouldShowContent && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              padding: '10px 14px',
              background: 'var(--thinking-bg, rgba(139, 92, 246, 0.05))',
              border: '1px solid var(--thinking-border, rgba(139, 92, 246, 0.2))',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 8,
            }}>
              <ThinkingGlobeIndicator
                isAnimating={!!isStreaming}
                size={18}
                progress={thinkingProgress?.percentage}
                phase={thinkingProgress?.phase || 'thinking'}
                layoutId={layoutId}
              />

              <span style={{
                fontWeight: 500,
                fontSize: 13,
                color: isStreaming ? 'var(--cm-thinking)' : 'var(--cm-fg-2)',
              }}>
                {isStreaming ? 'Thinking...' : 'Thought process'}
              </span>

              {isStreaming && thinkingProgress && (
                <span style={{
                  fontSize: 11,
                  color: 'var(--color-primary, #A855F7)',
                  fontWeight: 500,
                }}>
                  {thinkingProgress.percentage.toFixed(0)}%
                </span>
              )}

              {thinkingProgress && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                }}>
                  {thinkingProgress.tokensUsed.toLocaleString()} tokens
                </span>
              )}

              {!isStreaming && (
                <button
                  onClick={() => setShowFull(false)}
                  style={{
                    marginLeft: thinkingProgress ? 8 : 'auto',
                    padding: 2,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <ChevronDown size={14} />
                </button>
              )}
            </div>

            <pre style={{
              margin: 0,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontStyle: 'italic',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: isStreaming ? 200 : 150,
              overflowY: 'auto',
              lineHeight: 1.6,
              borderLeft: '2px solid var(--thinking-accent, rgba(139, 92, 246, 0.3))',
              paddingLeft: 12,
              opacity: 0.85,
            }}>
              {content}
              {isStreaming && (
                <span className="thinking-cursor" style={{
                  color: 'var(--color-primary, #A855F7)',
                  animation: 'blink 1s infinite',
                  marginLeft: 2,
                }}>|</span>
              )}
            </pre>
            <style>{`
              @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
            `}</style>
          </motion.div>
        )}
      </div>
    </LayoutGroup>
  );
});

InlineThinking.displayName = 'InlineThinking';

// Legacy ThinkingBlock kept for non-interleaved mode (backward compat)
interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  duration?: number;
  isExpanded: boolean;
  onToggle: () => void;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = memo(({
  content,
  isStreaming,
  duration,
  isExpanded,
  onToggle
}) => {
  if (!content) return null;

  return (
    <div style={{ marginBottom: 12 }} className="thinking-block-container">
      <button
        onClick={onToggle}
        className="thinking-block-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: isExpanded ? '8px 8px 0 0' : 8,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
        <ThinkingGlobeIndicator isAnimating={!!isStreaming} size={14} phase="thinking" />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {isStreaming ? 'Reasoning...' : 'Thought process'}
        </span>
        <span style={{ flex: 1 }} />
        {duration && !isStreaming && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {formatDuration(duration)}
          </span>
        )}
      </button>

      {isExpanded && (
        <div
          className="thinking-block-content"
          style={{
            padding: '12px 16px',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
          }}
        >
          <pre style={{
            margin: 0,
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
            lineHeight: 1.6,
          }}>
            {content}
            {isStreaming && (
              <span className="animate-pulse" style={{
                display: 'inline-block',
                width: 2,
                height: 14,
                marginLeft: 2,
                backgroundColor: 'var(--color-primary)',
                verticalAlign: 'text-bottom',
              }} />
            )}
          </pre>
        </div>
      )}
    </div>
  );
});

ThinkingBlock.displayName = 'ThinkingBlock';

// ============================================================================
// Thinking Budget Utilization Badge
// ============================================================================

interface ThinkingBudgetBadgeProps {
  tokensUsed: number;
  tokenBudget: number;
  isStreaming: boolean;
}

const ThinkingBudgetBadge: React.FC<ThinkingBudgetBadgeProps> = memo(({
  tokensUsed,
  tokenBudget,
  isStreaming,
}) => {
  if (isStreaming || tokenBudget <= 0) return null;

  const percentage = Math.min(100, Math.round((tokensUsed / tokenBudget) * 100));
  const formattedUsed = tokensUsed >= 1000
    ? `${(tokensUsed / 1000).toFixed(1)}K`
    : String(tokensUsed);
  const formattedBudget = tokenBudget >= 1000
    ? `${(tokenBudget / 1000).toFixed(0)}K`
    : String(tokenBudget);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--color-text-muted)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      <Zap size={10} style={{ color: percentage > 75 ? 'var(--color-warning, #F97316)' : 'var(--color-text-muted)' }} />
      <span>{formattedUsed}/{formattedBudget} thinking tokens</span>
      <span style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>({percentage}%)</span>
    </motion.div>
  );
});

ThinkingBudgetBadge.displayName = 'ThinkingBudgetBadge';

// ============================================================================
// Tree Step Item - REDESIGNED with left-border, category badge, compact summary
// ============================================================================

interface TreeStepItemProps {
  toolCall: ToolCall;
  isLast: boolean;
  isStreamingDone: boolean;
  childAgents?: ToolCall[];
  depth?: number;
}

const TreeStepItem: React.FC<TreeStepItemProps> = memo(({
  toolCall,
  isLast,
  isStreamingDone,
  childAgents = [],
  depth = 0,
}) => {
  const [showDetail, setShowDetail] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Determine effective status
  const rawStatus = toolCall.status === 'calling' ? 'running' : toolCall.status;
  // If streaming is done and tool is still 'running', it either succeeded silently or failed.
  // Check output for errors; default to 'success' for historical (not 'error' — that shows red X everywhere).
  const effectiveStatus = (rawStatus === 'running' && isStreamingDone)
    ? (detectErrorInOutput(toolCall.output) ? 'error' : 'success')
    : rawStatus;
  const hasError = effectiveStatus === 'error' || detectErrorInOutput(toolCall.output);
  const finalStatus = hasError ? 'error' : effectiveStatus;

  const hasOutput = Boolean(toolCall.output);
  const hasInput = Boolean(toolCall.input);
  const isExpandable = hasOutput || hasInput; // Allow expanding for running tools too
  const isAgentSpawn = toolCall.toolName === 'spawn_parallel_agents';

  // Live elapsed time counter for running tools
  useEffect(() => {
    if (finalStatus !== 'running') return;
    const start = toolCall.startTime || Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [finalStatus, toolCall.startTime]);

  // Humanize the tool name
  const humanized = useMemo(() => humanizeToolName(toolCall.toolName), [toolCall.toolName]);

  // Compact summary — structured form preserves favicon/link items so the
  // success row can render them as pills (web_search, web_fetch). Falls
  // back to the flat string for tools that return text-only summaries.
  const structuredSummary = useMemo(() => getStructuredSummary(toolCall), [toolCall.output, toolCall.toolName]);
  const summary = useMemo(() => getCompactSummary(toolCall), [toolCall.output, toolCall.toolName]);

  // Brief input preview for running tools (e.g. "resourceGroupName: myRG, ...")
  const inputPreview = useMemo(() => {
    if (!toolCall.input || finalStatus !== 'running') return null;
    try {
      const obj = typeof toolCall.input === 'string' ? JSON.parse(toolCall.input) : toolCall.input;
      if (typeof obj === 'object' && obj !== null) {
        const entries = Object.entries(obj);
        if (entries.length === 0) return null;
        // Show first 2 key=value pairs as a compact preview
        const preview = entries.slice(0, 2).map(([k, v]) => {
          const val = typeof v === 'string' ? v : JSON.stringify(v);
          const truncVal = val && val.length > 40 ? val.slice(0, 40) + '...' : val;
          return `${k}: ${truncVal}`;
        }).join(', ');
        return entries.length > 2 ? preview + ` (+${entries.length - 2} more)` : preview;
      }
    } catch { /* ignore */ }
    return null;
  }, [toolCall.input, finalStatus]);

  // Error message extraction — prefer a clean message field if the
  // tool output is a structured error object; fall back to the first
  // `error:` / `exception:` match; only last-resort shows a truncated
  // JSON fragment so the user isn't staring at `": 5,\n "unknown": 1`
  // leaked from the middle of an error payload.
  const errorMessage = useMemo(() => {
    if (!hasError) return null;
    if (!toolCall.output) return 'error';
    const out = toolCall.output;
    if (typeof out === 'object' && out !== null) {
      const obj = out as Record<string, unknown>;
      const msg = (obj.error || obj.message || obj.detail || obj.reason);
      if (typeof msg === 'string' && msg.trim()) {
        return msg.length > 80 ? msg.slice(0, 80) + '…' : msg;
      }
    }
    const outStr = typeof out === 'string' ? out : JSON.stringify(out);
    const match = outStr.match(/(?:error|failed|exception)[:\s]*(.{1,80})/i);
    if (match) return match[1].trim();
    // Last resort — don't paste ANY raw JSON fragment, just say error.
    return 'error';
  }, [hasError, toolCall.output]);

  // Formatted output for detail view
  const outputForDetail = useMemo(() => {
    if (!toolCall.output) return null;
    if (typeof toolCall.output === 'string') return toolCall.output;
    return JSON.stringify(toolCall.output, null, 2);
  }, [toolCall.output]);

  // Input for detail view
  const inputForDetail = useMemo(() => {
    if (!toolCall.input) return null;
    if (typeof toolCall.input === 'string') return toolCall.input;
    return JSON.stringify(toolCall.input, null, 2);
  }, [toolCall.input]);

  // CSS class for the step border
  const stepClass = finalStatus === 'running'
    ? 'activity-step activity-step--running'
    : finalStatus === 'error'
      ? 'activity-step activity-step--error'
      : finalStatus === 'success'
        ? 'activity-step activity-step--success'
        : 'activity-step activity-step--pending';

  // Display label — match mockup 02-kubernetes-health-report.html: raw MCP
  // tool function name in JetBrains Mono, e.g. `kubectl_get_events` not
  // "Cluster Health". Humanized form is kept only for sub-agents (where
  // the role is the signal) and during running state when activeForm is
  // more descriptive than a function name (e.g. "Listing Kubernetes pods").
  const rawToolName = toolCall.toolName || 'tool';
  const baseLabel = toolCall.agentId
    ? toolCall.agentRole || rawToolName
    : isAgentSpawn && childAgents.length > 0
      ? `Orchestrating ${childAgents.length} agent${childAgents.length !== 1 ? 's' : ''}`
      : rawToolName;
  const displayLabel = finalStatus === 'running' && humanized.activeForm && !toolCall.agentId
    ? humanized.activeForm
    : baseLabel;

  const isAgent = toolCall.agentId || isAgentSpawn;

  // Format elapsed seconds to Xm Ys or Xs
  const elapsedStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  return (
    <div style={{ position: 'relative' }}>
      {/* Main step row */}
      <div
        className={stepClass}
        style={{
          paddingTop: depth > 0 ? 2 : 4,
          paddingBottom: depth > 0 ? 2 : 4,
          cursor: isExpandable ? 'pointer' : 'default',
        }}
        onClick={() => isExpandable && setShowDetail(!showDetail)}
        role={isExpandable ? 'button' : undefined}
        tabIndex={isExpandable ? 0 : undefined}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: depth > 0 ? 22 : 26,
        }}>
          {/* Status dot */}
          <StatusDot
            status={finalStatus as 'pending' | 'running' | 'success' | 'error'}
            size={depth > 0 ? 12 : 14}
          />

          {/* Mockup-parity: tiny colored dot encoding the tool's category
              instead of the large "Kubernetes" / "Monitoring" pill. Mock 02
              has just `<span class="t-name">kubectl_get_events</span>` with
              no category badge — the tool name is the signal. The dot lets
              a user scan vs. mono text column for cluster/cloud/web-type
              tools quickly without the badge eating horizontal space. */}
          {!isAgent && (
            <span
              aria-label={`${humanized.category} tool`}
              title={humanized.category}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: humanized.color,
                flexShrink: 0,
              }}
            />
          )}

          {/* Agent indicator */}
          {isAgent && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}>
              Agent
            </span>
          )}

          {/* Tool label — matches mock .t-name: JetBrains Mono, 12px,
              weight 500. For sub-agents / running activeForm strings,
              keep a non-mono fallback since they're human sentences. */}
          <span style={{
            fontFamily: isAgent || (finalStatus === 'running' && humanized.activeForm && !toolCall.agentId)
              ? undefined
              : "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: depth > 0 ? 12 : 13,
            fontWeight: 500,
            color: depth > 0 ? 'var(--color-text-secondary)' : 'var(--color-text, var(--fg-0))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            maxWidth: finalStatus === 'running' ? '40%' : undefined,
            flex: finalStatus === 'running' ? undefined : 1,
          }}>
            {displayLabel}
          </span>

          {/* Running: show progress message if different from activeForm */}
          {finalStatus === 'running' && toolCall.progressMessage && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              opacity: 0.8,
            }}>
              {toolCall.progressMessage}
            </span>
          )}

          {/* Completed: show compact result preview inline. Dispatch by
              summary kind so each tool gets the richest representation
              its summarizer produces:
                - 'rich'  → SummaryRich (icon + headline + badges + items)
                - 'links' → SummaryLinks (favicon + title pills)
                - 'text'  → flat text span
              Anything else (kind 'none' or null) renders nothing.
              See openagentic-omhs#330. */}
          {finalStatus === 'success' && structuredSummary?.kind === 'rich' ? (
            <SummaryRich summary={structuredSummary} />
          ) : finalStatus === 'success' && structuredSummary?.kind === 'links' && structuredSummary.items.length > 0 ? (
            <SummaryLinks items={structuredSummary.items} />
          ) : finalStatus === 'success' && summary ? (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              opacity: 0.7,
            }}>
              {summary}
            </span>
          ) : null}

          {/* Compact result summary or error message */}
          {finalStatus === 'error' && errorMessage && (
            <span style={{
              fontSize: 11,
              color: '#da3633',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {errorMessage}
            </span>
          )}
          {finalStatus === 'success' && summary && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {summary}
            </span>
          )}

          {/* Duration / Elapsed timer */}
          <span style={{
            fontSize: depth > 0 ? 10 : 11,
            color: finalStatus === 'error' ? '#da3633' : finalStatus === 'running' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontWeight: finalStatus === 'running' ? 500 : 400,
          }}>
            {finalStatus === 'running' ? elapsedStr :
             toolCall.duration ? formatDuration(toolCall.duration) : ''}
          </span>

          {/* Expand indicator */}
          {isExpandable && !showDetail && (
            <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          {showDetail && (
            <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
        </div>
      </div>

      {/* Nested agent children */}
      {childAgents.length > 0 && (
        <div style={{ paddingLeft: 16 }}>
          {childAgents.map((agent, aIdx) => (
            <TreeStepItem
              key={agent.id}
              toolCall={agent}
              isLast={aIdx === childAgents.length - 1}
              isStreamingDone={isStreamingDone}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* Expanded detail — Shiki-highlighted Input/Result sections that
          match mock 02's `<pre class="json">` + `<pre class="result">`
          styling. The section labels use the mockup terminology (Input /
          Result / Error) rather than Request/Response so the live tool
          cards scan like the mock. */}
      {showDetail && (inputForDetail || outputForDetail) && (
        <div className="activity-detail-panel" style={{ marginLeft: 16 }}>
          {inputForDetail && (
            <div
              style={{
                borderBottom: outputForDetail
                  ? '1px solid color-mix(in srgb, var(--color-border) 30%, transparent)'
                  : 'none',
                padding: '10px 12px',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--fg-3, var(--color-text-muted))',
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Input
              </div>
              <ShikiCodeBlock
                language={(() => {
                  try { JSON.parse(inputForDetail); return 'json'; } catch { return 'text'; }
                })()}
                code={inputForDetail.length > 2000 ? inputForDetail.slice(0, 2000) + '\n// …truncated' : inputForDetail}
                theme="dark"
                onCopy={async (t: string) => {
                  try { await navigator.clipboard.writeText(t); } catch { /* swallow */ }
                }}
              />
            </div>
          )}
          {outputForDetail && (
            <div style={{ padding: '10px 12px' }}>
              <div
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: hasError
                    ? 'var(--err, #ef4444)'
                    : 'var(--fg-3, var(--color-text-muted))',
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                {hasError ? 'Error' : 'Result'}
              </div>
              <ShikiCodeBlock
                language={(() => {
                  try { JSON.parse(outputForDetail); return 'json'; } catch { return 'text'; }
                })()}
                code={outputForDetail.length > 4000 ? outputForDetail.slice(0, 4000) + '\n// …truncated' : outputForDetail}
                theme="dark"
                onCopy={async (t: string) => {
                  try { await navigator.clipboard.writeText(t); } catch { /* swallow */ }
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});

TreeStepItem.displayName = 'TreeStepItem';

// ============================================================================
// Tree Steps Container - REDESIGNED with category chips in collapsed state
// ============================================================================

interface TreeStepsContainerProps {
  toolCalls: ToolCall[];
  isStreaming: boolean;
  totalDuration?: number;
  isHistorical?: boolean;
}

const TreeStepsContainer: React.FC<TreeStepsContainerProps> = memo(({
  toolCalls,
  isStreaming,
  totalDuration,
  isHistorical = false,
}) => {
  const runningCount = toolCalls.filter(t => t.status === 'calling').length;
  const errorCount = toolCalls.filter(t => t.status === 'error' || detectErrorInOutput(t.output)).length;
  const successCount = toolCalls.filter(t => t.status === 'success' && !detectErrorInOutput(t.output)).length;
  const allComplete = runningCount === 0 && !isStreaming;
  // Historical loads (session switch, page reload) ALWAYS start collapsed.
  // Active streaming starts expanded so user can watch progress.
  const [isExpanded, setIsExpanded] = useState(isHistorical ? false : !allComplete);

  // Auto-collapse 300ms after all complete
  useEffect(() => {
    if (allComplete && toolCalls.length > 0) {
      const t = setTimeout(() => setIsExpanded(false), 300);
      return () => clearTimeout(t);
    }
  }, [allComplete, toolCalls.length]);

  // Build grouped category summary for collapsed state: "4x Azure . 3x K8s . 2x Web"
  const categorySummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tc of toolCalls) {
      if (tc.parentToolId) continue; // skip nested
      const h = humanizeToolName(tc.toolName);
      counts[h.category] = (counts[h.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));
  }, [toolCalls]);

  // Summary icon
  const summaryIcon = errorCount > 0 ? (
    <StatusDot status="error" size={16} />
  ) : allComplete ? (
    <StatusDot status="success" size={16} />
  ) : (
    <StatusDot status="running" size={16} />
  );

  // Summary text
  const stepCount = toolCalls.filter(tc => !tc.parentToolId).length;
  const summaryText = isStreaming
    ? `Running ${stepCount} step${stepCount !== 1 ? 's' : ''}...`
    : `${stepCount} step${stepCount !== 1 ? 's' : ''} completed`;

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header line */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {summaryIcon}
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
        }}>
          {summaryText}
        </span>
        {errorCount > 0 && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            background: '#da3633',
            padding: '0 6px',
            borderRadius: 8,
          }}>
            {errorCount} failed
          </span>
        )}
        {!isStreaming && totalDuration != null && totalDuration > 0 && (
          <span style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            ({formatDuration(totalDuration)})
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>

      {/* Collapsed: per-tool one-line summary (Claude Code style) */}
      {!isExpanded && toolCalls.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          paddingLeft: 24,
          paddingBottom: 4,
        }}>
          {toolCalls.filter(tc => !tc.parentToolId).slice(0, 6).map((tc) => {
            const h = humanizeToolName(tc.toolName);
            const sum = getCompactSummary(tc);
            const isErr = tc.status === 'error' || detectErrorInOutput(tc.output);
            return (
              <div key={tc.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                lineHeight: '18px',
              }}>
                <StatusDot status={isErr ? 'error' : tc.status === 'calling' ? 'running' : 'success'} size={11} />
                <span
                  aria-label={`${h.category} tool`}
                  title={h.category}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: h.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontWeight: 500,
                  color: 'var(--color-text, var(--fg-0))',
                  whiteSpace: 'nowrap',
                }}>{h.label}</span>
                {sum && <span style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sum}</span>}
                {tc.duration != null && tc.duration > 0 && (
                  <span style={{ opacity: 0.4, fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {formatDuration(tc.duration)}
                  </span>
                )}
              </div>
            );
          })}
          {toolCalls.filter(tc => !tc.parentToolId).length > 6 && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', paddingLeft: 17 }}>
              +{toolCalls.filter(tc => !tc.parentToolId).length - 6} more
            </span>
          )}
        </div>
      )}

      {/* Expanded: full step list */}
      {isExpanded && (
        <div style={{ paddingLeft: 4, paddingTop: 2 }}>
          {toolCalls.filter(tc => !tc.parentToolId).map((toolCall, idx, filtered) => {
            const children = toolCall.toolName === 'spawn_parallel_agents'
              ? toolCalls.filter(tc => tc.parentToolId === toolCall.id && tc.agentId)
              : [];
            return (
              <TreeStepItem
                key={toolCall.id}
                toolCall={toolCall}
                isLast={idx === filtered.length - 1}
                isStreamingDone={!isStreaming}
                childAgents={children}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

TreeStepsContainer.displayName = 'TreeStepsContainer';

// ============================================================================
// Grouped Tool Calls - Tree style (consecutive tool_use blocks)
// ============================================================================

// ============================================================================
// HITL inline approval card (Sev-1 #922) — rendered IMMEDIATELY adjacent to
// the matching tool_use block so the approval prompt stays glued to the
// tool that triggered it. Theme tokens only (CLAUDE.md rule 8b).
//
// Defined BEFORE ToolCallGroup so the cluster renderer can embed it inside
// the per-child tool-card wrapper (fixes #922+#831 serial-cluster migration).
// ============================================================================

interface HitlInlineCardProps {
  entry: HitlApprovalEntry;
  onApprove?: (requestId: string) => void;
  onDeny?: (requestId: string) => void;
}

const HitlInlineCard: React.FC<HitlInlineCardProps> = ({ entry, onApprove, onDeny }) => {
  return (
    <div
      data-testid="hitl-approval-card"
      data-status={entry.status}
      data-tool-name={entry.toolName}
      data-request-id={entry.requestId}
      style={{
        border: '1px solid var(--cm-line-2)',
        borderRadius: 6,
        padding: '10px 12px',
        background: 'var(--cm-bg-1)',
        fontFamily: 'var(--font-v3-mono, monospace)',
        fontSize: 12,
        margin: '4px 0',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--cm-fg-1)' }}>
        ⚠ Approval required: <code>{entry.toolName}</code>
      </div>
      <div style={{ color: 'var(--cm-fg-2)', marginBottom: 8 }}>
        {entry.reason}
      </div>
      {entry.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            data-testid="hitl-approve-btn"
            onClick={() => onApprove?.(entry.requestId)}
            style={{
              border: '1px solid var(--cm-success)',
              background: 'transparent',
              color: 'var(--cm-success)',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
            }}
          >
            Approve
          </button>
          <button
            data-testid="hitl-deny-btn"
            onClick={() => onDeny?.(entry.requestId)}
            style={{
              border: '1px solid var(--cm-error)',
              background: 'transparent',
              color: 'var(--cm-error)',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
            }}
          >
            Deny
          </button>
        </div>
      )}
      {entry.status !== 'pending' && (
        <div style={{ color: 'var(--cm-fg-2)' }}>
          status: <code>{entry.status}</code>
        </div>
      )}
    </div>
  );
};

HitlInlineCard.displayName = 'HitlInlineCard';

interface ToolCallGroupProps {
  blocks: ContentBlock[];
  toolCalls: ToolCall[];
  theme: string;
  isStreaming?: boolean;
  isHistorical?: boolean;
  /** Stable session-scoped id for sessionStorage expand-state persistence. */
  clusterKey?: string;
  /**
   * #922 + #831 — HITL approval entries keyed by ContentBlock.id. When a
   * child tool-card's block.id is present in the map, the matching
   * HitlInlineCard renders INSIDE that child's tool-card wrapper so the
   * approval prompt stays glued to the specific tool that triggered it
   * even as the cluster grows with additional consecutive tool_use blocks.
   *
   * Pre-fix the HITL nodes were appended as siblings AFTER the whole
   * cluster wrapper — when the model emitted N tools back-to-back, the
   * card "migrated" to the end of the cluster (visually below tool #N),
   * far from the gated tool. Customer-visible "where did my approval
   * prompt go?" regression.
   */
  hitlByBlockId?: ReadonlyMap<string, HitlApprovalEntry>;
  onApproveHitl?: (requestId: string) => void;
  onDenyHitl?: (requestId: string) => void;
}

const CLUSTER_STORAGE_PREFIX = 'cm.toolCluster.';

const readClusterExpand = (key: string | undefined): boolean | null => {
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

const writeClusterExpand = (key: string | undefined, expanded: boolean): void => {
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CLUSTER_STORAGE_PREFIX + key, expanded ? '1' : '0');
  } catch {
    /* swallow */
  }
};

/** Tree node for building hierarchical tool call structure */
interface ToolTreeNode {
  block: ContentBlock;
  children: ToolTreeNode[];
}

/** Expandable tool item with category badge, summary, and structured detail */
const ExpandableToolItem: React.FC<{
  block: any;
  toolCall: any;
  isRunning: boolean;
  hasError: boolean;
  isLastRunning: boolean;
  children?: ToolTreeNode[];
  allToolCalls: ToolCall[];
  depth?: number;
  isHistorical?: boolean;
  // v0.6.7 task #159 — threaded through so the embedded ToolCallCard
  // (live input_json_delta pane) can inherit the surrounding theme.
  theme?: 'light' | 'dark';
}> = memo(({ block, toolCall, isRunning, hasError, isLastRunning, children = [], allToolCalls, depth = 0, isHistorical = false, theme = 'dark' }) => {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isChildrenOpen, setIsChildrenOpen] = useState(!isHistorical);
  const toolName = block.toolName || toolCall?.toolName || 'Tool';
  const isAgentSpawn = toolName === 'spawn_parallel_agents';
  const isAgentBlock = !!block.agentId;
  const hasChildren = children.length > 0;

  // Humanize
  const humanized = useMemo(() => humanizeToolName(toolName), [toolName]);

  // Compact summary
  const summary = useMemo(() => {
    if (!toolCall) return null;
    return getCompactSummary(toolCall);
  }, [toolCall]);

  // Error message — prefer a proper .error/.message/.detail field from a
  // structured error object. Fall back to first `error:` / `failed:` /
  // `exception:` regex match. Never leak a middle-of-JSON fragment
  // (`": 5,\n "unknown": 1`) into the tool row — just say "error" if we
  // can't find a clean message.
  const errorMsg = useMemo(() => {
    if (!hasError) return null;
    if (!toolCall?.output) return 'error';
    const out = toolCall.output;
    if (typeof out === 'object' && out !== null) {
      const obj = out as Record<string, unknown>;
      const msg = obj.error || obj.message || obj.detail || obj.reason;
      if (typeof msg === 'string' && msg.trim()) {
        return msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
      }
    }
    const outStr = typeof out === 'string' ? out : JSON.stringify(out);
    const match = outStr.match(/(?:error|failed|exception)[:\s]*([^"}{\n]{1,60})/i);
    if (match) return match[1].trim();
    return 'error';
  }, [hasError, toolCall?.output]);

  // Format tool input/output for display
  const toolInput = toolCall?.input || toolCall?.arguments;
  const toolOutput = toolCall?.output;
  const inputStr = toolInput
    ? (typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput, null, 2))
    : null;
  const outputStr = toolOutput
    ? (typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2))
    : null;

  // Determine step status
  const status: 'running' | 'success' | 'error' | 'pending' = isRunning
    ? 'running'
    : hasError
      ? 'error'
      : 'success';

  const stepClass = `activity-step activity-step--${status}`;

  return (
    <div>
      <div
        className={stepClass}
        style={{
          paddingTop: depth > 0 ? 2 : 4,
          paddingBottom: depth > 0 ? 2 : 4,
          cursor: (hasChildren || (!isRunning && (inputStr || outputStr))) ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (hasChildren) {
            setIsChildrenOpen(!isChildrenOpen);
          } else if (!isRunning) {
            setIsDetailOpen(!isDetailOpen);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: depth > 0 ? 22 : 26,
        }}>
          {/* Status */}
          <StatusDot status={status} size={depth > 0 ? 12 : 14} />

          {/* Category badge or Agent badge */}
          {isAgentBlock ? (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}>
              Agent
            </span>
          ) : isAgentSpawn ? (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}>
              Orchestration
            </span>
          ) : (
            /* Mock 02 parity — tiny colored dot (6px) encoding tool
               category instead of the verbose "Kubernetes"/"Monitoring"
               pill. The mock shows bare `<span class="t-name">` with
               only the raw MCP function name. */
            <span
              aria-label={`${humanized.category} tool`}
              title={humanized.category}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: humanized.color,
                flexShrink: 0,
              }}
            />
          )}

          {/* Tool name in JetBrains Mono to match mock .t-name. For
              sub-agents (role is the signal) or delegate-to-agent
              synthetic rows (description text, not a function name)
              keep sans. */}
          <span style={{
            fontFamily: isAgentBlock || isAgentSpawn
              ? undefined
              : "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: depth > 1 ? 12 : 13,
            fontWeight: 500,
            color: depth > 1 ? 'var(--color-text-secondary)' : 'var(--color-text, var(--fg-0))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {isAgentBlock
              ? (block.agentRole || toolName)
              : isAgentSpawn
                ? `Delegate to ${children.length} Agent${children.length !== 1 ? 's' : ''}`
                : (toolName || humanized.label)}
          </span>

          {/* Summary or error */}
          {hasError && errorMsg && (
            <span style={{
              fontSize: 11,
              color: '#da3633',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {errorMsg}
            </span>
          )}
          {!isRunning && !hasError && summary && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {summary}
            </span>
          )}

          {/* Duration */}
          <span style={{
            fontSize: 11,
            color: hasError ? '#da3633' : 'var(--color-text-muted)',
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
          }}>
            {isRunning ? 'running...' :
             toolCall?.duration ? formatDuration(toolCall.duration) : ''}
          </span>

          {/* Expand indicator */}
          {!isRunning && !hasChildren && (inputStr || outputStr) && (
            isDetailOpen
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          {hasChildren && (
            isChildrenOpen
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  <ChevronRight size={12} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{children.length}</span>
                </span>
          )}
        </div>
      </div>

      {/* Agent streamed content */}
      {isAgentBlock && block.content && block.content.trim() && (isRunning || isDetailOpen || isChildrenOpen) && (
        <div style={{
          marginLeft: 16,
          padding: '4px 10px',
          borderLeft: '2px solid var(--color-border)',
          marginBottom: 4,
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>
            {block.content.length > 2000 ? block.content.slice(0, 2000) + '...' : block.content}
          </pre>
        </div>
      )}

      {/* v0.6.7 task #159 — live input_json_delta pane for executing tools.
          Uses the premium ToolCallCard with status="calling" and the
          partial JSON piped into inputDeltaContent. The card is rendered
          *below* the summary row so the row keeps its compact Claude-Code
          look and the live JSON streams inside the card with a blinking
          caret + "streaming…" label. Phase F.1 (tool_input_delta) behavior
          is preserved — block.content still carries the partial JSON.
          #515 — drop the content-truthy gate so fast tools (no/small
          delta payload) still get a streaming card on dispatch (mock 01
          parity: card visible the moment a tool is dispatched). */}
      {!isAgentBlock && isRunning && !hasChildren && (
        <div style={{ marginLeft: depth > 0 ? 12 : 16, marginTop: 2, marginBottom: 4 }}>
          <ToolCallCard
            toolName={toolName}
            displayName={humanized.label}
            toolInput={toolInput}
            toolOutput={undefined}
            status="calling"
            startTime={block.startTime}
            progressMessage={block.progressMessage}
            inputDeltaContent={block.content}
            collapsible={true}
            isCollapsed={true}
            theme={theme}
          />
        </div>
      )}

      {/* Nested children */}
      {hasChildren && isChildrenOpen && (
        <div style={{ paddingLeft: 16 }}>
          {children.map((child, cIdx) => {
            const childToolCall = allToolCalls.find(tc => tc.id === child.block.toolId);
            const childHasError = child.block.isComplete ? detectErrorInOutput(childToolCall?.output) : false;
            const childIsRunning = !child.block.isComplete;
            const childIsLast = cIdx === children.length - 1;
            return (
              <ExpandableToolItem
                key={child.block.id}
                block={child.block}
                toolCall={childToolCall}
                isRunning={childIsRunning}
                hasError={childHasError}
                isLastRunning={childIsRunning && childIsLast}
                children={child.children}
                allToolCalls={allToolCalls}
                depth={depth + 1}
                isHistorical={isHistorical}
                theme={theme}
              />
            );
          })}
        </div>
      )}

      {/* Expandable detail panel
          First try a specialized MCPToolRenderer (WebSearchRenderer, WebFetchRenderer,
          SerenaFileRenderer, etc.) — these render rich views with favicons + links
          for web_search, line-numbered excerpts for file reads, etc. If the tool
          has no specialized renderer, fall back to raw Request/Response JSON dump. */}
      {isDetailOpen && !isRunning && !isAgentBlock && !hasChildren && (() => {
        const Specialized = getRendererForTool(toolName);
        const hasSpecialized = Specialized !== GenericMCPRenderer;
        if (hasSpecialized) {
          return (
            <div className="activity-detail-panel" style={{ marginLeft: 16 }}>
              <Specialized
                toolName={toolName}
                toolId={toolCall?.id || block.toolId || ''}
                input={toolInput}
                output={toolOutput}
                status={hasError ? 'error' : 'success'}
                isComplete={true}
                duration={toolCall?.duration}
              />
            </div>
          );
        }
        return (
          <div className="activity-detail-panel" style={{ marginLeft: 16 }}>
            {inputStr && (
              <div
                style={{
                  borderBottom: outputStr
                    ? '1px solid color-mix(in srgb, var(--color-border) 30%, transparent)'
                    : 'none',
                  padding: '10px 12px',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--fg-3, var(--color-text-muted))',
                    marginBottom: 6,
                    fontWeight: 600,
                  }}
                >
                  Input
                </div>
                <ShikiCodeBlock
                  language={(() => {
                    try { JSON.parse(inputStr); return 'json'; } catch { return 'text'; }
                  })()}
                  code={inputStr.length > 2000 ? inputStr.slice(0, 2000) + '\n// …truncated' : inputStr}
                  theme="dark"
                  onCopy={async (t: string) => {
                    try { await navigator.clipboard.writeText(t); } catch { /* swallow */ }
                  }}
                />
              </div>
            )}
            {outputStr && (
              <div style={{ padding: '10px 12px' }}>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: hasError
                      ? 'var(--err, #ef4444)'
                      : 'var(--fg-3, var(--color-text-muted))',
                    marginBottom: 6,
                    fontWeight: 600,
                  }}
                >
                  {hasError ? 'Error' : 'Result'}
                </div>
                <ShikiCodeBlock
                  language={(() => {
                    try { JSON.parse(outputStr); return 'json'; } catch { return 'text'; }
                  })()}
                  code={outputStr.length > 4000 ? outputStr.slice(0, 4000) + '\n// …truncated' : outputStr}
                  theme="dark"
                  onCopy={async (t: string) => {
                    try { await navigator.clipboard.writeText(t); } catch { /* swallow */ }
                  }}
                />
              </div>
            )}
            {!inputStr && !outputStr && (
              <div style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>No data available</div>
            )}
          </div>
        );
      })()}
    </div>
  );
});
ExpandableToolItem.displayName = 'ExpandableToolItem';

/**
 * B3 / mock 06:267-349 — completed tool-card opens to INPUT/RESULT panels.
 *
 * Round 18 chatmode parity gap: the "11 tools completed" group rendered each
 * tool as a one-line summary row that was a dead-click. Mock 06 specifies
 * each completed tool MUST be independently openable to a body with an
 * INPUT pill and a RESULT pill — same anatomy as the in-flight v2/ToolCard.
 *
 * `<CollapsedToolRow>` is the openable inline row used inside the
 * `!isExpanded` branch of `<ToolCallGroup>`. Click toggles a body with
 * `data-testid="tool-input"` + `data-testid="tool-result"` panels rendered
 * via `ShikiCodeBlock` (same renderer as the expanded detail panel —
 * keeps JSON-pretty + copy semantics consistent across both paths).
 *
 * Test contract: `services/openagentic-ui/src/features/chat/components/
 * __tests__/AgenticActivityStream.collapsedRowClickToExpand.test.tsx`.
 */
interface CollapsedToolRowProps {
  block: any;
  toolCall?: ToolCall;
  rowOpen: boolean;
  onToggle: () => void;
}

const CollapsedToolRow: React.FC<CollapsedToolRowProps> = memo(({ block, toolCall, rowOpen, onToggle }) => {
  const name = block.toolName || 'Tool';
  const h = humanizeToolName(name);
  const tc = toolCall;
  const sum = tc ? getCompactSummary(tc) : null;
  const isErr = block.isComplete && (block.error || (tc && detectErrorInOutput(tc.output)));
  const inlineChips = extractInlineChips(name, tc, block);

  const toolInput = tc?.input || tc?.arguments;
  const toolOutput = tc?.output;
  const inputStr = toolInput
    ? (typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput, null, 2))
    : null;
  const outputStr = toolOutput
    ? (typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2))
    : null;
  const hasBody = !!(inputStr || outputStr);

  return (
    <div data-collapsed-row data-tool-name={name} data-tool-status={isErr ? 'err' : (!block.isComplete ? 'running' : 'ok')}>
      <button
        type="button"
        aria-expanded={rowOpen}
        onClick={(e) => { e.stopPropagation(); if (hasBody) onToggle(); }}
        disabled={!hasBody}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: '18px',
          background: 'transparent',
          border: 'none',
          padding: '2px 0',
          width: '100%',
          textAlign: 'left',
          cursor: hasBody ? 'pointer' : 'default',
        }}
      >
        <StatusDot status={isErr ? 'error' : !block.isComplete ? 'running' : 'success'} size={11} />
        <span
          aria-label={`${h.category} tool`}
          title={h.category}
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: h.color,
            flexShrink: 0,
          }}
        />
        <span style={{
          fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          fontWeight: 500,
          color: 'var(--color-text, var(--fg-0))',
          whiteSpace: 'nowrap',
        }}>{h.label}</span>
        {sum && <span style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sum}</span>}
        {inlineChips.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            {inlineChips.map((chip, i) => {
              const pillStyle: React.CSSProperties = {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '1px 6px',
                borderRadius: 3,
                background: 'color-mix(in srgb, var(--color-border) 25%, transparent)',
                color: 'var(--color-text-secondary)',
                textDecoration: 'none',
                maxWidth: 160,
              };
              const inner = (
                <>
                  {chip.favicon && (
                    <img
                      src={chip.favicon}
                      alt=""
                      width={12}
                      height={12}
                      style={{ borderRadius: 2, flexShrink: 0 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chip.label}
                  </span>
                </>
              );
              if (chip.url) {
                return (
                  <a
                    key={chip.url + i}
                    href={chip.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={chip.tooltip}
                    onClick={(e) => e.stopPropagation()}
                    style={pillStyle}
                  >
                    {inner}
                  </a>
                );
              }
              return (
                <span key={chip.label + i} title={chip.tooltip} style={pillStyle}>
                  {inner}
                </span>
              );
            })}
          </span>
        )}
        {block.duration != null && block.duration > 0 && (
          <span style={{ opacity: 0.4, fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {formatDuration(block.duration)}
          </span>
        )}
        {hasBody && (
          rowOpen
            ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} aria-hidden />
            : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} aria-hidden />
        )}
      </button>
      {rowOpen && hasBody && (
        <div
          data-tool-card-body
          style={{
            marginLeft: 22,
            marginTop: 4,
            marginBottom: 6,
            borderLeft: '1px solid color-mix(in srgb, var(--color-border) 40%, transparent)',
            paddingLeft: 10,
          }}
        >
          {inputStr && (
            <section data-testid="tool-input" style={{ marginBottom: outputStr ? 8 : 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--fg-3, var(--color-text-muted))', fontWeight: 600,
              }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 3, background: 'var(--bg-3, rgba(255,255,255,0.06))',
                  color: 'var(--fg-2, var(--color-text-secondary))', fontSize: 9,
                }}>INPUT</span>
              </div>
              <ShikiCodeBlock
                language={(() => { try { JSON.parse(inputStr); return 'json'; } catch { return 'text'; } })()}
                code={inputStr.length > 2000 ? inputStr.slice(0, 2000) + '\n// …truncated' : inputStr}
                theme="dark"
                onCopy={async (t: string) => { try { await navigator.clipboard.writeText(t); } catch { /* swallow */ } }}
              />
            </section>
          )}
          {outputStr && (
            <section data-testid="tool-result">
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: isErr ? 'var(--err, #ef4444)' : 'var(--fg-3, var(--color-text-muted))',
                fontWeight: 600,
              }}>
                <span style={{
                  padding: '1px 6px', borderRadius: 3, background: 'var(--bg-3, rgba(255,255,255,0.06))',
                  color: 'var(--fg-2, var(--color-text-secondary))', fontSize: 9,
                }}>{isErr ? 'ERROR' : (<>RESULT</>)}</span>
              </div>
              <ShikiCodeBlock
                language={(() => { try { JSON.parse(outputStr); return 'json'; } catch { return 'text'; } })()}
                code={outputStr.length > 4000 ? outputStr.slice(0, 4000) + '\n// …truncated' : outputStr}
                theme="dark"
                onCopy={async (t: string) => { try { await navigator.clipboard.writeText(t); } catch { /* swallow */ } }}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
});
CollapsedToolRow.displayName = 'CollapsedToolRow';

const ToolCallGroup: React.FC<ToolCallGroupProps> = memo(({ blocks, toolCalls, theme, isStreaming, isHistorical = false, clusterKey, hitlByBlockId, onApproveHitl, onDenyHitl }) => {
  const allComplete = blocks.every(b => b.isComplete);
  const isCluster = blocks.length >= 2;
  const storedExpand = useMemo(() => readClusterExpand(clusterKey), [clusterKey]);
  // Stream ≡ final-render invariant (CLAUDE.md rule 8a + user direction
  // 2026-05-17 PM: "stream and finished result have to be EXACTLY THE
  // SAME"). Default to expanded so children stay visible at all times —
  // no flip from "individual cards" → "cluster summary" when the 2nd
  // tool arrives mid-stream, no auto-collapse 300ms after completion.
  // User's manual click-to-collapse persists via sessionStorage.
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    if (storedExpand !== null) return storedExpand;
    return true;
  });
  // B3 / mock 06:267-349 — per-row open state for the collapsed summary view.
  // Tracks which inline rows the user has opened to inspect INPUT/RESULT
  // without expanding the whole group tree.
  const [openRowIds, setOpenRowIds] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (): void => {
    setIsExpanded((prev) => {
      const next = !prev;
      writeClusterExpand(clusterKey, next);
      return next;
    });
  };

  // Build tree structure
  const tree = useMemo((): ToolTreeNode[] => {
    const toolIdSet = new Set(blocks.map(b => b.toolId).filter(Boolean));
    const childMap = new Map<string, ToolTreeNode[]>();
    const roots: ToolTreeNode[] = [];

    for (const block of blocks) {
      const node: ToolTreeNode = { block, children: [] };
      if (block.parentToolId && toolIdSet.has(block.parentToolId)) {
        const siblings = childMap.get(block.parentToolId) || [];
        siblings.push(node);
        childMap.set(block.parentToolId, siblings);
      } else {
        roots.push(node);
      }
    }

    const attachChildren = (node: ToolTreeNode): void => {
      if (node.block.toolId) {
        const children = childMap.get(node.block.toolId);
        if (children) {
          node.children = children;
          children.forEach(attachChildren);
        }
      }
    };
    roots.forEach(attachChildren);
    return roots;
  }, [blocks]);

  const totalCount = blocks.length;
  const errorCount = blocks.filter(b => {
    const tc = toolCalls.find(t => t.id === b.toolId);
    return detectErrorInOutput(tc?.output);
  }).length;

  const totalDuration = blocks.reduce((sum, b) => {
    const tc = toolCalls.find(t => t.id === b.toolId);
    return sum + (tc?.duration || 0);
  }, 0);

  // Category summary for collapsed view
  const categorySummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of blocks) {
      if (b.parentToolId) continue;
      const name = b.toolName || toolCalls.find(tc => tc.id === b.toolId)?.toolName || '';
      const h = humanizeToolName(name);
      counts[h.category] = (counts[h.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));
  }, [blocks, toolCalls]);

  const summaryIcon = errorCount > 0 ? (
    <StatusDot status="error" size={16} />
  ) : allComplete ? (
    <StatusDot status="success" size={16} />
  ) : (
    <StatusDot status="running" size={16} />
  );

  const clusterNamesPreview = useMemo(() => {
    if (!isCluster) return { head: '', extra: 0 };
    const names = blocks.map((b) => {
      const tc = toolCalls.find((t) => t.id === b.toolId);
      const raw = b.toolName || tc?.toolName || 'tool';
      return humanizeToolName(raw).label;
    });
    if (names.length <= 2) return { head: names.join(', '), extra: 0 };
    return { head: names.slice(0, 2).join(', '), extra: names.length - 2 };
  }, [blocks, toolCalls, isCluster]);

  return (
    <div
      data-testid={isCluster ? 'tool-cluster' : undefined}
      data-tool-count={blocks.length}
      style={{ marginBottom: 4 }}
    >
      {/* Header */}
      <button
        data-testid={isCluster ? 'tool-cluster-header' : undefined}
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {summaryIcon}
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
        }}>
          {totalCount === 1
            ? (() => {
                const singleTool = blocks[0];
                const singleName = singleTool.toolName || toolCalls.find(tc => tc.id === singleTool.toolId)?.toolName || 'Tool';
                const h = humanizeToolName(singleName);
                return allComplete
                  ? errorCount > 0 ? `${h.label} failed` : h.label
                  : `${h.label}...`;
              })()
            : allComplete
              ? errorCount > 0
                ? `${totalCount} tools completed (${totalCount - errorCount} succeeded, ${errorCount} failed)`
                : `${totalCount} tools completed`
              : `Running ${totalCount} tools...`}
        </span>
        {isCluster && clusterNamesPreview.head && (
          <span
            data-testid="tool-cluster-names"
            style={{
              fontSize: 12,
              color: 'var(--cm-fg-2, var(--color-text-muted))',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 380,
            }}
          >
            {clusterNamesPreview.head}
            {clusterNamesPreview.extra > 0 ? ` +${clusterNamesPreview.extra} more` : ''}
          </span>
        )}
        {errorCount > 0 && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--cm-fg-on-accent, var(--color-text-on-primary))',
            background: 'var(--cm-err, var(--color-error))',
            padding: '0 6px',
            borderRadius: 8,
          }}>
            {errorCount} failed
          </span>
        )}
        {totalDuration > 0 && (
          <span style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            ({formatDuration(totalDuration)})
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>

      {/* Collapsed: per-tool one-line summary (Claude Code style).
          B3 / mock 06:267-349 — each row is now an openable
          <CollapsedToolRow> with INPUT/RESULT panels.
          Slice B (2026-05-16): cluster-collapsed view (N>=2) renders the
          one-line summary in the header alone — skip the inline row strip so
          the cluster reads as a single compact block, not 2-6 stacked rows. */}
      {!isExpanded && !isCluster && blocks.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          paddingLeft: 24,
          paddingBottom: 4,
        }}>
          {blocks.slice(0, 6).map((block) => {
            const tc = toolCalls.find(t => t.id === block.toolId);
            const rowOpen = openRowIds.has(block.id);
            return (
              <CollapsedToolRow
                key={block.id}
                block={block}
                toolCall={tc}
                rowOpen={rowOpen}
                onToggle={() => {
                  setOpenRowIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(block.id)) next.delete(block.id);
                    else next.add(block.id);
                    return next;
                  });
                }}
              />
            );
          })}
        </div>
      )}

      {/* Expanded: hierarchical step list */}
      {isExpanded && (
        <div style={{ paddingLeft: 4, paddingTop: 2 }}>
          {tree.map((node, idx) => {
            const toolCall = toolCalls.find(tc => tc.id === node.block.toolId);
            const isRunning = !node.block.isComplete && isStreaming !== false;
            const hasError = node.block.isComplete
              ? detectErrorInOutput(toolCall?.output)
              : (!node.block.isComplete && isStreaming === false);
            const isLast = idx === tree.length - 1;
            const childToolName = node.block.toolName || toolCall?.toolName || 'tool';
            const childStatus: 'running' | 'success' | 'error' = isRunning
              ? 'running'
              : hasError
                ? 'error'
                : 'success';

            const item = (
              <ExpandableToolItem
                key={node.block.id}
                block={node.block}
                toolCall={toolCall}
                isRunning={isRunning}
                hasError={hasError}
                isLastRunning={isRunning && isLast}
                children={node.children}
                allToolCalls={toolCalls}
                depth={0}
                isHistorical={isHistorical}
                theme={theme === 'light' || theme === 'dark' ? theme : 'dark'}
              />
            );

            if (isCluster) {
              // #922+#831 — when a HITL approval is paired with THIS specific
              // child block (by ContentBlock.id), embed the HitlInlineCard
              // INSIDE the per-child tool-card wrapper. Pre-fix the HITL
              // card was appended after the whole cluster wrapper, so a
              // growing cluster pushed the card to the bottom of the message
              // and broke the visual coupling to the gated tool.
              const childHitlEntry = hitlByBlockId?.get(node.block.id);
              return (
                <div
                  key={node.block.id}
                  data-testid="tool-card"
                  data-tool-name={childToolName}
                  data-status={childStatus}
                >
                  {item}
                  {childHitlEntry && (
                    <div
                      data-testid="hitl-approval-strip"
                      data-block-id={node.block.id}
                    >
                      <HitlInlineCard
                        entry={childHitlEntry}
                        onApprove={onApproveHitl}
                        onDeny={onDenyHitl}
                      />
                    </div>
                  )}
                </div>
              );
            }
            return item;
          })}
        </div>
      )}
    </div>
  );
});

ToolCallGroup.displayName = 'ToolCallGroup';

// ============================================================================
// Main Component
// ============================================================================

export const AgenticActivityStream: React.FC<AgenticActivityStreamProps> = ({
  isStreaming,
  streamingState,
  contentBlocks,
  tasks = [],
  toolCalls = [],
  theme = 'dark',
  thinkingProgress,
  onInterrupt,
  className = '',
  subAgents = [],
  hitlApprovals = [],
  onApproveHitl,
  onDenyHitl,
  streamingTables = [],
}) => {
  // Sev-0 dup-render rip (2026-05-21) — fast lookup by artifactId so the
  // viz_render(template=table) render branch can swap an iframe for a
  // native <StreamingTable> at O(1). The same artifact_id is shared by
  // the visual_render frame (→ ContentBlock with id=artifactId) and the
  // streaming_table frame (→ StreamingTableEntry.artifactId).
  const streamingTableByArtifactId = useMemo(() => {
    const m = new Map<string, typeof streamingTables[number]>();
    for (const t of streamingTables) {
      if (t && typeof t.artifactId === 'string' && t.artifactId.length > 0) {
        m.set(t.artifactId, t);
      }
    }
    return m;
  }, [streamingTables]);
  // Historical = not currently streaming (loaded from session history or page reload)
  const isHistorical = !isStreaming;

  // 2026-05-19 — user-facing follow-up chip toggle (lives in
  // ChatInputToolbar.tsx via `useFollowupChipsStore`). When the toggle is
  // OFF, the `follow_up` ContentBlock render branch short-circuits to null
  // — the toolbar pill and the inline chip row stay in sync platform-wide.
  // Pre-fix: ChipsRow honored the store but AAS rendered chips inline through
  // its own JSX path, so users observed chips even with the toggle OFF.
  const followupChipsEnabled = useFollowupChipsStore((s) => s.enabled);

  // #646 Option B — lookup table from agent role → SubAgentEntry. The
  // incoming prop `subAgents?: ReadonlyArray<SubAgentEntry>` carries
  // sub_agent_started / sub_agent_completed lifecycle entries; we convert
  // it to a Map so the agent_group branch below can decide per-role
  // whether to upgrade to a rich SubAgentCard or fall back to the
  // lightweight AgentExecutionTimeline. Roles are case-sensitive (server
  // emits the canonical kebab-case role name on sub_agent_started).
  const subAgentByRole = useMemo(() => {
    const m = new Map<string, SubAgentEntry>();
    for (const sa of subAgents ?? []) m.set(sa.role, sa);
    return m;
  }, [subAgents]);

  // Sev-1 #922 — HITL approvals indexed by toolName, in arrival order.
  // The render loop pulls the earliest unrendered entry for a matching
  // toolName when it emits each tool_use card. After the iteration, any
  // entries still in the unrendered set are spilled as a fallback at the
  // end of the stream (orphan approvals — hitl_approval frame raced
  // ahead of tool_executing).
  const hitlByToolName = useMemo(() => {
    const m = new Map<string, HitlApprovalEntry[]>();
    for (const entry of hitlApprovals ?? []) {
      if (!entry || typeof entry.toolName !== 'string') continue;
      const arr = m.get(entry.toolName) ?? [];
      arr.push(entry);
      m.set(entry.toolName, arr);
    }
    return m;
  }, [hitlApprovals]);

  const [isExpanded, setIsExpanded] = useState(!isHistorical);
  const [thinkingExpanded, setThinkingExpanded] = useState(!isHistorical);

  const hasInterleavedContent = useMemo(() => {
    const hasThinking = contentBlocks.some(b => b.type === 'thinking');
    const hasText = contentBlocks.some(b => b.type === 'text');
    const hasToolUse = contentBlocks.some(b => b.type === 'tool_use' || b.type === 'tool_call');
    // viz_render + app_render are typed-block artifacts that must render
    // inline at their wire-emit chronological position; treat them as
    // interleaved content so AAS mounts when an assistant turn produced
    // only artifacts and no thinking/text/tool_use.
    const hasArtifact = contentBlocks.some(b => b.type === 'viz_render' || b.type === 'app_render');
    // F1-6 (2026-05-17) — follow_up chip row counts as interleaved content
    // so a turn with ONLY a follow_up block (degenerate, but possible on
    // session reload) still mounts AAS.
    const hasFollowUp = contentBlocks.some(b => b.type === 'follow_up');
    return hasThinking || hasText || hasToolUse || hasArtifact || hasFollowUp;
  }, [contentBlocks]);

  const thinkingContent = useMemo(() => {
    if (hasInterleavedContent) return '';
    return contentBlocks
      .filter(b => b.type === 'thinking')
      .map(b => b.content)
      .join('\n');
  }, [contentBlocks, hasInterleavedContent]);

  const isThinkingActive = streamingState === 'thinking';

  const totalDuration = useMemo(() => {
    return toolCalls.reduce((sum, t) => sum + (t.duration || 0), 0);
  }, [toolCalls]);

  // Auto-collapse tool details after streaming completes (thinking blocks stay visible)
  useEffect(() => {
    if (!isStreaming && streamingState === 'complete') {
      const timer = setTimeout(() => {
        // Only collapse tool expansion, NOT thinking — thinking blocks should persist
        setIsExpanded(false);
        // setThinkingExpanded(false); // REMOVED: thinking blocks must persist after streaming
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, streamingState]);

  // Nothing to show
  if (toolCalls.length === 0 && !thinkingContent && !hasInterleavedContent) return null;

  // #922+#831 — block-level HITL assignment, hoisted out of the JSX IIFE
  // so `renderContentBlock` and the tool-card inline embed paths can both
  // look up "what HITL entry pairs with THIS specific tool_use block?".
  //
  // Walks tool_use/tool_call blocks in chronological order, pairs each
  // with the earliest unconsumed HITL entry whose toolName matches.
  // Remaining unpaired entries are tracked as orphans and rendered at the
  // end of the stream (existing fallback contract — unchanged from #922 v1).
  const { hitlAssignedByBlockId, hitlOrphans } = useMemo(() => {
    const assigned = new Map<string, HitlApprovalEntry>();
    const pool = new Map<string, HitlApprovalEntry[]>();
    for (const [toolName, entries] of hitlByToolName.entries()) {
      pool.set(toolName, [...entries]);
    }
    for (const b of contentBlocks) {
      if (b.type !== 'tool_use' && b.type !== 'tool_call') continue;
      const tn = b.toolName;
      if (!tn) continue;
      const bucket = pool.get(tn);
      if (!bucket || bucket.length === 0) continue;
      const entry = bucket.shift()!;
      assigned.set(b.id, entry);
    }
    const orphans: HitlApprovalEntry[] = [];
    for (const bucket of pool.values()) {
      for (const e of bucket) orphans.push(e);
    }
    return { hitlAssignedByBlockId: assigned, hitlOrphans: orphans };
  }, [contentBlocks, hitlByToolName]);

  // Render a single content block (thinking, text, or tool_use)
  const renderContentBlock = (block: ContentBlock, index: number) => {
    // Wire-in D (#82) — parallel tool-round container. Delegates to
    // ToolParallelGroup which lays out child tool cards in a
    // .tool-parallel grid with a live "Running N in parallel…" header
    // that flips to a "succeeded · failed · Xms" breakdown on
    // tool_round_end.
    if (block.type === 'tool_round') {
      return (
        <ToolParallelGroup
          key={block.id}
          block={block as unknown as import('../../hooks/useChatStream').ToolRoundBlock}
          renderChild={(child, i) => renderContentBlock(child as ContentBlock, i)}
        />
      );
    }
    if (block.type === 'thinking') {
      const isLastBlock = index === contentBlocks.length - 1;
      const isActivelyStreaming = isStreaming && isLastBlock && !block.isComplete;
      // v0.6.7 task #159 — derive startedAt/endedAt/tokenCount for
      // InlineThinkingBlock. `startTime` comes from useChatStream; when
      // the block is complete we compute endedAt = startTime + duration,
      // falling back to (startTime + 0) if duration is missing. The token
      // count prefers an explicit thinkingProgress reading, then falls
      // back to the ~4-chars-per-token estimate inside InlineThinkingBlock.
      const startedAt = block.startTime;
      const endedAt = !isActivelyStreaming && block.isComplete && block.startTime
        ? block.startTime + (block.duration ?? 0)
        : undefined;
      const tokenCount = thinkingProgress?.tokensUsed && isActivelyStreaming
        ? thinkingProgress.tokensUsed
        : undefined;
      return (
        <div key={block.id}>
          <InlineThinkingBlock
            content={block.content}
            isStreaming={isActivelyStreaming}
            startedAt={startedAt}
            endedAt={endedAt}
            tokenCount={tokenCount}
          />
          {block.isComplete && !isActivelyStreaming && thinkingProgress && thinkingProgress.tokenBudget > 0 && (
            <ThinkingBudgetBadge
              tokensUsed={thinkingProgress.tokensUsed}
              tokenBudget={thinkingProgress.tokenBudget}
              isStreaming={false}
            />
          )}
        </div>
      );
    } else if (block.type === 'text') {
      const blockIsComplete = block.isComplete === true;
      const isLastBlock = index === contentBlocks.length - 1;
      const isActiveTextBlock = isStreaming && isLastBlock && !blockIsComplete;

      // Legacy text-fence artifact detector (StreamingArtifactRenderer +
      // streamingArtifactDetector) ripped 2026-05-13 (#781 Phase D.4).
      // Interactive artifacts now arrive via Message.visualizations[] +
      // tool_result _meta.artifactKind, rendered by ArtifactSlideOutLauncher
      // in MessageBubble.

      return (
        <div key={block.id} className="interleaved-text-block">
          <SharedMarkdownRenderer
            content={block.content}
            theme={theme}
            isStreaming={isActiveTextBlock}
          />
        </div>
      );
    } else if (block.type === 'viz_render') {
      // Sev-0 dup-render rip (2026-05-21) — `compose_visual({template:'table'})`
      // emits BOTH a `visual_render` frame (HTML iframe content) AND a
      // `streaming_table` frame (structured columns/rows) with the same
      // artifact_id. Pre-fix the UI mounted THREE renders of the same
      // data (iframe + ToolCard JSON wall + sibling StreamingTable strip).
      // Post-fix: when this is a table viz_render and we have the matching
      // structured data, render the native React <StreamingTable> INLINE
      // at the wire-emit position. The iframe path is RIPPED for tables.
      //
      // Live evidence:
      //   reports/verify-cadence/one-shot-redeploy-2026-05-21/07-table-dup-fullpage.png
      // User contract: "Keep the NATIVE React StreamingTable component —
      // that IS the premium look. Render it INLINE inside the MessageBubble
      // at the tool_use position. Kill the iframe-srcdoc renderer entirely
      // for compose_visual blocks with template:'table'."
      if (block.template === 'table') {
        const tbl = streamingTableByArtifactId.get(block.id);
        if (tbl) {
          return (
            <div key={block.id} className="interleaved-viz-render cm-v2">
              <StreamingTable table={tbl as any} />
            </div>
          );
        }
        // No matching structured-data frame arrived yet (or ever). The
        // iframe-srcdoc path stays dead — render an empty placeholder
        // wrapper so chronological order is preserved if the data lands
        // later. Better to show nothing here than a non-themed iframe.
        return (
          <div
            key={block.id}
            className="interleaved-viz-render"
            data-testid="viz-render-table-pending"
            data-block-id={block.id}
          />
        );
      }
      return (
        <div key={block.id} className="interleaved-viz-render">
          <InlineVizBadge block={block} />
        </div>
      );
    } else if (block.type === 'app_render') {
      return (
        <div key={block.id} className="interleaved-app-render">
          <InlineAppBadge block={block} />
        </div>
      );
    } else if (block.type === 'follow_up') {
      // Sev-0 F1-6 (2026-05-17) — end-of-turn follow-up chip row. Mirrors
      // the `.followups` block from all 17 northstar mocks
      // (`mocks/UX/AI/Chatmode/end-state-{01..17}.html`). Theme tokens only
      // (CLAUDE.md rule 8b — no hex/rgb literals).
      //
      // 2026-05-19 — honor the user-facing toggle. When the composer
      // toolbar's "Follow-up suggestions" pill is OFF, this branch returns
      // null so chips disappear platform-wide (not just from ChipsRow).
      if (!followupChipsEnabled) return null;
      const items = Array.isArray(block.items) ? block.items : [];
      if (items.length === 0) return null;
      return (
        <div
          key={block.id}
          data-testid="followups"
          className="interleaved-followups"
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 14,
          }}
        >
          {items.map((item, i) => (
            <button
              type="button"
              key={`${block.id}-chip-${i}`}
              data-testid="followup-chip"
              onClick={() => {
                // Best-effort: dispatch a custom event the composer can
                // listen for. Plumbing to the composer happens at a higher
                // level (out of scope for the F1-6 render slice).
                try {
                  const ev = new CustomEvent('followup-chip-clicked', {
                    detail: { prompt: item },
                    bubbles: true,
                  });
                  (window as any)?.dispatchEvent?.(ev);
                } catch {
                  // ignore — render must be side-effect-free in tests
                }
              }}
              style={{
                appearance: 'none',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: '0.875rem',
                lineHeight: 1.2,
                padding: '7px 12px',
                borderRadius: '999px',
                border: '1px solid var(--cm-line-2)',
                background: 'var(--cm-bg-1)',
                color: 'var(--cm-fg-1)',
                textAlign: 'left',
                transition:
                  'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
              }}
            >
              {item}
            </button>
          ))}
        </div>
      );
    } else if (block.type === 'tool_use' || block.type === 'tool_call') {
      const toolCall = toolCalls.find(tc => tc.id === block.toolId);
      const toolName = block.toolName || toolCall?.toolName || 'Tool';
      const hasError = detectErrorInOutput(toolCall?.output);
      const isRunning = !block.isComplete;
      const isAgentBlock = !!(block as any).agentId;
      // T1-hide (2026-05-12) — direct single-block render of a T1
      // meta-tool emits nothing. The grouping path above already
      // strips T1 from group lists, but this branch can be reached
      // via tool_round children + other paths that bypass the grouper.
      if (!isAgentBlock && isT1Tool(toolName)) {
        return null;
      }
      const agentContent = isAgentBlock ? block.content : null;
      const humanized = humanizeToolName(toolName);
      const summary = toolCall ? getCompactSummary(toolCall) : null;

      const status: 'running' | 'success' | 'error' = isRunning
        ? 'running'
        : hasError
          ? 'error'
          : 'success';

      const stepClass = `activity-step activity-step--${status}`;

      return (
        <div key={block.id} data-testid="tool-card" data-tool-name={toolName} data-status={status}>
          <div
            className={stepClass}
            style={{ paddingTop: 4, paddingBottom: 4 }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 26,
            }}>
              <StatusDot status={status} size={14} />

              {isAgentBlock ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                  color: 'var(--color-primary)',
                  border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
                }}>
                  Agent
                </span>
              ) : (
                /* Mock 02 parity — tiny colored category dot, not a pill.
                   The mock tool row shows only `<span class="t-name">` so
                   the raw function name (`kubectl_get_events`) is the
                   primary scan target, with the category encoded in the
                   dot color instead of the verbose "Kubernetes" pill. */
                <span
                  aria-label={`${humanized.category} tool`}
                  title={humanized.category}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: humanized.color,
                    flexShrink: 0,
                  }}
                />
              )}

              <span style={{
                fontFamily: isAgentBlock
                  ? undefined
                  : "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-text, var(--fg-0))',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {isAgentBlock ? ((block as any).agentRole || toolName) : (toolName || humanized.label)}
              </span>

              {!isRunning && !hasError && summary && (
                <span style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '30%',
                  flexShrink: 1,
                }}>
                  {summary}
                </span>
              )}

              <span style={{
                fontSize: 11,
                color: hasError ? '#da3633' : 'var(--color-text-muted)',
                flexShrink: 0,
                fontFamily: 'var(--font-mono)',
              }}>
                {isRunning ? 'running...' :
                 hasError ? 'error' :
                 toolCall?.duration ? formatDuration(toolCall.duration) : ''}
              </span>
            </div>
          </div>

          {/* Show agent's streamed content below the agent line */}
          {isAgentBlock && agentContent && agentContent.trim() && (
            <div style={{
              marginLeft: 24,
              padding: '4px 10px',
              borderLeft: '2px solid var(--color-border)',
              marginBottom: 4,
            }}>
              <SharedMarkdownRenderer
                content={agentContent}
                theme={theme}
                isStreaming={isRunning}
              />
            </div>
          )}

          {/* v0.6.7 task #159 — ToolCallCard now owns the live streaming
              input (input_json_delta) pane. It renders a tool-call-card
              wrapper with a header + collapsible input pane; while
              status === 'calling' and inputDeltaContent is present, it
              shows the partial JSON with a blinking caret + a "streaming…"
              label. The Phase F.1 flow is preserved: block.content still
              carries the partial JSON, just piped into ToolCallCard's
              inputDeltaContent prop. */}
          {!isAgentBlock && isRunning && block.content && block.content.trim() && (
            <div style={{ marginLeft: 24, marginTop: 2 }}>
              <ToolCallCard
                toolName={toolName}
                displayName={humanized.label}
                toolInput={toolCall?.input}
                toolOutput={undefined}
                status="calling"
                startTime={block.startTime}
                progressMessage={(block as any).progressMessage}
                inputDeltaContent={block.content}
                collapsible={true}
                isCollapsed={true}
                theme={theme}
              />
            </div>
          )}

          {/* F.2 tool_progress heartbeat — show "Executing... (15s)" under the
              tool row so the user knows long Azure/AWS/GCP calls are still
              alive. Server emits every 5s during execution. */}
          {!isAgentBlock && isRunning && (block as any).progressMessage && (
            <ToolProgressTick
              message={(block as any).progressMessage as string}
              elapsed={(block as any).progressElapsed as number | undefined}
            />
          )}

          {/* F.3 — when a completed tool returned a row-array (common for
              list_/query_ paginated MCP calls), reveal rows progressively
              in an inline table instead of dumping the whole array. */}
          {!isAgentBlock && !isRunning && toolCall?.output != null && (() => {
            const tableData = detectTableData(toolCall.output);
            if (!tableData) return null;
            return (
              <InlineStreamingTable
                data={tableData}
                title={`${tableData.rows.length} ${tableData.rows.length === 1 ? 'row' : 'rows'}`}
              />
            );
          })()}

          {/* #922+#831 — HITL approval card embedded INSIDE the tool-card
              wrapper. Only the tool_round-child path reaches this branch;
              the main tool_group path embeds HITL via ToolCallGroup +
              the single-block AAS wrapper above. */}
          {(() => {
            const entry = hitlAssignedByBlockId.get(block.id);
            if (!entry) return null;
            return (
              <div
                data-testid="hitl-approval-strip"
                data-block-id={block.id}
              >
                <HitlInlineCard
                  entry={entry}
                  onApprove={onApproveHitl}
                  onDeny={onDenyHitl}
                />
              </div>
            );
          })()}
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className={className}
      data-theme={theme}
      data-testid="agentic-activity-stream"
      data-streaming={isStreaming ? 'true' : 'false'}
      style={{ marginBottom: 16 }}
    >
      {/* Interrupt button during streaming */}
      {isStreaming && onInterrupt && streamingState !== 'complete' && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 8,
        }}>
          <button
            onClick={onInterrupt}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--color-border, #333)',
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 12,
            }}
          >
            <XCircle size={14} />
            Stop
          </button>
        </div>
      )}

      {/* Interleaved content - render blocks in order like Claude */}
      {hasInterleavedContent ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(() => {
            // Build groups: consecutive tool blocks merge, consecutive thinking blocks merge,
            // agent blocks (with agentId) merge into agent_group, everything else stays solo
            const groups: Array<
              | { type: 'single'; block: ContentBlock; index: number }
              | { type: 'tool_group'; blocks: ContentBlock[]; startIndex: number }
              | { type: 'thinking_group'; blocks: ContentBlock[]; startIndex: number }
              | { type: 'agent_group'; blocks: ContentBlock[]; startIndex: number }
            > = [];
            // Sev-0 #841 — reload-promotion counter for persisted `Task` blocks.
            //
            // Live streaming: the reducer stamps `agentId` + `agentRole` onto
            // each Task tool_use block as `sub_agent_started` arrives, so
            // those blocks naturally route into agent_group below.
            //
            // Persisted reload: the steps→adapter conversion sees
            // `Message.toolCalls` (no agentId / agentRole). Without help,
            // those blocks get killed by the T1-hide filter and the entire
            // sub-agent UX disappears on reload. Pair the i-th persisted
            // `Task` tool_use with the i-th SubAgentEntry from
            // mergePersistedSubAgents and synthesize agentRole so the
            // existing agent_group → SubAgentCard render path lights up.
            //
            // Live blocks (already-stamped agentRole) are skipped in this
            // promotion — we only patch the ones missing role info.
            let nextSubAgentIndex = 0;
            const subAgentsForPromotion = subAgents ?? [];
            let i = 0;
            while (i < contentBlocks.length) {
              let block = contentBlocks[i];
              const isToolBlock = block.type === 'tool_use' || block.type === 'tool_call';
              let isAgentBlock = isToolBlock && !!block.agentId;

              // #841 promotion — Task tool_use without agentRole pairs with
              // the next unconsumed SubAgentEntry (reload-only path; live
              // streaming already sets agentRole upstream).
              if (
                isToolBlock &&
                !isAgentBlock &&
                !block.agentRole &&
                block.toolName === 'Task' &&
                nextSubAgentIndex < subAgentsForPromotion.length
              ) {
                const sa = subAgentsForPromotion[nextSubAgentIndex++];
                block = { ...block, agentRole: sa.role, agentId: block.toolId ?? `persisted-task-${i}` };
                isAgentBlock = true;
              }

              // T1-hide (2026-05-12) — filter T1 meta-tool blocks from the
              // inline render path. The block stays in `contentBlocks` for
              // telemetry / persistence; we skip it ONLY when forming
              // visible groups. Agent-typed blocks (block.agentId set) are
              // never T1-filtered — the sub-agent render path is
              // user-visible (SubAgentCard via agent_group).
              if (isToolBlock && !isAgentBlock && isHiddenT1Block(block, toolCalls)) {
                i++;
                continue;
              }

              if (isAgentBlock) {
                // Collect consecutive agent blocks (blocks with agentId) into an agent_group
                const agentGroup: ContentBlock[] = [block];
                const startIdx = i;
                while (i + 1 < contentBlocks.length) {
                  const next = contentBlocks[i + 1];
                  const nextIsTool = next.type === 'tool_use' || next.type === 'tool_call';
                  if (nextIsTool && !!next.agentId) {
                    i++;
                    agentGroup.push(contentBlocks[i]);
                  } else {
                    break;
                  }
                }
                groups.push({ type: 'agent_group', blocks: agentGroup, startIndex: startIdx });
              } else if (isToolBlock) {
                // Slice B (2026-05-16): merge ALL consecutive tool_use blocks
                // into one cluster. The walk is sequential — any non-tool
                // block (text / thinking / viz_render / app_render / agent
                // block) immediately falls through to its own case and breaks
                // the merge window, so chronological order is preserved
                // (CLAUDE.md rule 8(a)). Prior #814 guard restricted merging
                // to blocks sharing a defined toolCallRound, but that left
                // serial dispatches rendering as N independent tool-cards
                // with no summary — the exact Q12 user complaint.
                //
                // T1-hide rules unchanged: T1 blocks are dropped pre-group;
                // we still skip them inside the consecutive-merge window
                // so a hidden T1 row doesn't break a real merge run.
                const toolGroup: ContentBlock[] = [block];
                const startIdx = i;
                while (
                  i + 1 < contentBlocks.length &&
                  (contentBlocks[i + 1].type === 'tool_use' || contentBlocks[i + 1].type === 'tool_call') &&
                  !contentBlocks[i + 1].agentId
                ) {
                  i++;
                  if (isHiddenT1Block(contentBlocks[i], toolCalls)) continue;
                  toolGroup.push(contentBlocks[i]);
                }
                if (toolGroup.length > 0) {
                  groups.push({ type: 'tool_group', blocks: toolGroup, startIndex: startIdx });
                }
              } else if (block.type === 'thinking') {
                // Merge consecutive thinking blocks into one
                const thinkingGroup: ContentBlock[] = [block];
                const startIdx = i;
                while (i + 1 < contentBlocks.length && contentBlocks[i + 1].type === 'thinking') {
                  i++;
                  thinkingGroup.push(contentBlocks[i]);
                }
                groups.push({ type: 'thinking_group', blocks: thinkingGroup, startIndex: startIdx });
              } else {
                groups.push({ type: 'single', block, index: i });
              }
              i++;
            }

            // #922+#831 — hitlAssignedByBlockId + hitlOrphans are hoisted
            // to the component body above so renderContentBlock + the
            // tool-card inline embed paths can both read them. Local
            // shadowing was removed when the embed-inside-tool-card
            // contract replaced the sibling-append fallback.

            // Helper — for a list of blocks, return the JSX nodes for any
            // HITL approval cards that should render after them.
            const renderHitlForBlocks = (blocks: ContentBlock[]): React.ReactNode[] => {
              const out: React.ReactNode[] = [];
              for (const b of blocks) {
                const entry = hitlAssignedByBlockId.get(b.id);
                if (!entry) continue;
                out.push(
                  <div
                    key={`hitl-${entry.requestId}`}
                    data-testid="hitl-approval-strip"
                    data-block-id={b.id}
                  >
                    <HitlInlineCard
                      entry={entry}
                      onApprove={onApproveHitl}
                      onDeny={onDenyHitl}
                    />
                  </div>,
                );
              }
              return out;
            };

            const renderedGroups = groups.map((group, gIdx) => {
              // #922+#831 — HITL inline placement is now block-scoped:
              //   - `tool_group` (single OR cluster): HITL is embedded
              //     INSIDE the matching per-child tool-card div (AAS owns
              //     the single-block wrap, ToolCallGroup owns each child
              //     for cluster). The wrap helper below MUST skip appending
              //     HITL siblings for this group type so we don't render
              //     the card twice.
              //   - `agent_group`: sibling-append still applies (sub-agent
              //     positioning is intentionally outside the parent agent's
              //     tool card). Behavior unchanged from #922 v1.
              //   - `single` block types (text / viz_render / app_render /
              //     follow_up): no HITL pairing possible (non-tool blocks)
              //     so wrap is a no-op.
              const blocksForHitl: ContentBlock[] =
                group.type === 'agent_group' ? group.blocks : [];
              const hitlNodes = renderHitlForBlocks(blocksForHitl);
              const wrap = (node: React.ReactNode): React.ReactNode => {
                if (hitlNodes.length === 0) return node;
                return (
                  <React.Fragment key={`group-frag-${gIdx}`}>
                    {node}
                    {hitlNodes}
                  </React.Fragment>
                );
              };

              if (group.type === 'agent_group') {
                // #646 Option B — split the agent_group by agentRole so each
                // unique sub-agent gets its own visual unit. When N parallel
                // sub-agents are spawned in one Task fan-out the agent_group
                // contains interleaved blocks for all roles; we want one
                // SubAgentCard per role at THIS timeline position (mock
                // 01:1077-1140 shows one `<article class="subagent">` per
                // dispatched role, between parent narration and the parent's
                // Summary). Roles without a matching SubAgentEntry fall back
                // to the bare AgentExecutionTimeline (sub_agent_started
                // envelope hasn't arrived yet — graceful degradation).
                const blocksByRole = new Map<string, ContentBlock[]>();
                const roleOrder: string[] = [];
                for (const b of group.blocks) {
                  const role = b.agentRole || b.agentId || '__unknown__';
                  if (!blocksByRole.has(role)) {
                    blocksByRole.set(role, []);
                    roleOrder.push(role);
                  }
                  blocksByRole.get(role)!.push(b);
                }

                const buildSteps = (blocks: ContentBlock[]): ExecutionStep[] =>
                  blocks.map((b) => {
                    const tc = toolCalls.find(t => t.id === b.toolId);
                    let stepType: ExecutionStep['type'] = 'agent_start';
                    if (b.toolName && b.toolName !== (b.agentRole || b.agentId)) {
                      stepType = b.isComplete ? 'tool_result' : 'tool_call';
                    } else if (b.isComplete) {
                      stepType = b.content === 'error' ? 'agent_error' : 'agent_complete';
                    }
                    let stepData = tc ? { arguments: tc.input, result: tc.output, cost: 0, tokensUsed: 0 } : undefined;
                    if (stepType === 'agent_start' && b.agentId) {
                      try {
                        const trees = (window as any).__agentTrees || useAgentTreeStore?.getState?.()?.trees;
                        if (trees) {
                          for (const tree of Object.values(trees) as any[]) {
                            const agent = tree?.agents?.[b.agentId];
                            if (agent?.task) {
                              stepData = { task: agent.task, cost: 0, tokensUsed: 0 } as any;
                              break;
                            }
                          }
                        }
                      } catch {}
                    }
                    return {
                      type: stepType,
                      agentId: b.agentId || '',
                      agentRole: b.agentRole,
                      toolName: b.toolName,
                      data: stepData,
                      timestamp: b.timestamp,
                    };
                  });

                return wrap(
                  <div
                    key={`agent-group-${group.startIndex}`}
                    data-testid="agent-group-inline"
                    style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    {roleOrder.map((role) => {
                      const blocks = blocksByRole.get(role)!;
                      const steps = buildSteps(blocks);
                      const stillExecuting = blocks.some(b => !b.isComplete);
                      const sa = subAgentByRole.get(role);

                      // Lightweight timeline showing the agent's tool steps
                      // (always rendered). When a SubAgentCard is available
                      // the timeline becomes the card's body; otherwise it
                      // stands alone with the legacy purple chrome.
                      const timeline = (
                        <AgentExecutionTimeline
                          steps={steps}
                          executing={stillExecuting}
                        />
                      );

                      if (sa) {
                        // mock 01:1077-1140 — rich SubAgentCard render INLINE
                        // at the dispatch position, with the live tool
                        // timeline as the card's children body. agentRole is
                        // the lookup key (block.agentRole) — referenced both
                        // here and on the SubAgentEntry, so the contract test
                        // sees both names in the same code path.
                        const niceName = sa.role
                          .replace(/[-_]/g, ' ')
                          .replace(/\b\w/g, (c) => c.toUpperCase());
                        const returnValue =
                          sa.status === 'ok' && sa.stats
                            ? `${sa.stats.turns} turn${sa.stats.turns === 1 ? '' : 's'}, ${sa.stats.tokens} tok`
                            : sa.status === 'error'
                              ? `error: ${sa.error || 'sub-agent failed'}`
                              : undefined;
                        return (
                          <SubAgentCard
                            key={`sa-${group.startIndex}-${role}`}
                            name={niceName}
                            role={sa.role}
                            description={sa.description}
                            variant={subAgentVariantFor(sa.role)}
                            status={sa.status}
                            toolsUsed={sa.stats?.toolsUsed}
                            error={sa.error}
                            stats={sa.stats ? {
                              turns: sa.stats.turns,
                              tokens: sa.stats.tokens,
                              wallMs: sa.stats.wallMs,
                            } : undefined}
                            output={sa.output}
                            returnValue={returnValue}
                          >
                            {timeline}
                          </SubAgentCard>
                        );
                      }

                      // Fallback: no SubAgentEntry yet — legacy purple chrome.
                      return (
                        <div
                          key={`agent-fallback-${group.startIndex}-${role}`}
                          style={{
                            borderLeft: '2px solid var(--color-primary, #7c4dff)',
                            paddingLeft: 12,
                          }}
                        >
                          {timeline}
                        </div>
                      );
                    })}
                  </div>,
                );
              }

              if (group.type === 'tool_group') {
                // Task #131 — when N ≥ 2 tool blocks in this group all share
                // the same toolCallRound (i.e. they were dispatched as one
                // parallel fan-out by the backend's executeToolCalls), render
                // them with the premium ParallelFanOutGroup. Otherwise fall
                // through to the existing Claude-Code-style inline grouped
                // list. The fallthrough preserves the #159-wired live-input
                // card, sub-agent nesting, and category-badge one-liners.
                //
                // Slice B (2026-05-16): N>=2 groups render as a `tool-cluster`
                // (collapsed by default) owned by the inner component. Single
                // tool blocks keep the outer `tool-card` testid for #842 +
                // verification probes.
                const rounds = new Set(group.blocks.map(b => b.toolCallRound));
                const isParallelFanOut =
                  group.blocks.length >= 2 &&
                  rounds.size === 1 &&
                  !rounds.has(undefined);
                const firstId = group.blocks[0]?.id ?? group.blocks[0]?.toolId ?? 'no-id';
                const clusterKey = `${group.startIndex}.${firstId}`;
                const isSingle = group.blocks.length === 1;
                if (isParallelFanOut) {
                  // ParallelFanOutGroup (UnifiedAgentActivity variant) does
                  // not expose per-child tool-card slots; fall back to the
                  // sibling-append placement for HITL nodes so the user can
                  // still act on an approval prompt that lands inside a
                  // parallel fan-out cluster. Group-level only — visual
                  // anchor is best-effort here, not the strict
                  // tool-card-descendant invariant the serial-cluster
                  // path now enforces (#922+#831).
                  const parallelHitlNodes = renderHitlForBlocks(group.blocks);
                  return (
                    <React.Fragment key={`parallel-frag-${group.startIndex}`}>
                      <div
                        key={`parallel-tool-group-${group.startIndex}`}
                        data-tool-card-kind="parallel-fanout"
                        data-tool-count={group.blocks.length}
                      >
                        <ParallelFanOutGroup
                          blocks={group.blocks}
                          toolCalls={toolCalls}
                          theme={theme === 'light' || theme === 'dark' ? theme : 'dark'}
                          isStreaming={isStreaming}
                          isHistorical={isHistorical}
                          clusterKey={clusterKey}
                        />
                      </div>
                      {parallelHitlNodes}
                    </React.Fragment>
                  );
                }
                // #922+#831 — when this group is a single tool_use, AAS owns
                // the outer `data-testid="tool-card"` wrapper. Embed the
                // matching HITL card INSIDE that wrapper so the approval
                // prompt is a DOM descendant of the gated tool's card. When
                // it's a multi-block cluster, pass hitlByBlockId down to
                // ToolCallGroup which embeds the HITL inside each per-child
                // tool-card div (the children own the testid in that path).
                const singleBlockId = isSingle ? group.blocks[0]?.id : undefined;
                const singleHitlEntry = singleBlockId
                  ? hitlAssignedByBlockId.get(singleBlockId)
                  : undefined;
                return (
                  <div
                    key={`tool-group-${group.startIndex}`}
                    data-testid={isSingle ? 'tool-card' : undefined}
                    data-tool-name={
                      isSingle
                        ? group.blocks[0]?.toolName ||
                          toolCalls.find(tc => tc.id === group.blocks[0]?.toolId)?.toolName ||
                          undefined
                        : undefined
                    }
                    data-tool-card-kind="serial-group"
                    data-tool-count={group.blocks.length}
                  >
                    <ToolCallGroup
                      blocks={group.blocks}
                      toolCalls={toolCalls}
                      theme={theme}
                      isStreaming={isStreaming}
                      isHistorical={isHistorical}
                      clusterKey={clusterKey}
                      hitlByBlockId={isSingle ? undefined : hitlAssignedByBlockId}
                      onApproveHitl={isSingle ? undefined : onApproveHitl}
                      onDenyHitl={isSingle ? undefined : onDenyHitl}
                    />
                    {singleHitlEntry && (
                      <div
                        data-testid="hitl-approval-strip"
                        data-block-id={singleBlockId}
                      >
                        <HitlInlineCard
                          entry={singleHitlEntry}
                          onApprove={onApproveHitl}
                          onDeny={onDenyHitl}
                        />
                      </div>
                    )}
                  </div>
                );
              }

              if (group.type === 'thinking_group') {
                // Render each thinking block individually (Claude Code style — each thinking round persists)
                return (
                  <div key={`thinking-group-${group.startIndex}`}>
                    {group.blocks.map((block, blockIdx) => {
                      const globalIdx = group.startIndex + blockIdx;
                      // Sev-0 #834 (2026-05-14) — drop the isLastContentBlock
                      // gate. The old gate snapped thinking blocks to their
                      // "Thought for X.Xs" terminal header the moment the
                      // model emitted ANY follow-on block (text, tool_use),
                      // even while thinking_delta frames were still arriving
                      // → the COT block looked coalesced/post-hoc instead of
                      // streaming live. `!block.isComplete` is the canonical
                      // signal: thinking_block_stop flips isComplete=true;
                      // until then the block IS actively producing tokens.
                      const isActivelyStreaming = isStreaming && !block.isComplete;
                      const tokenCount = Math.ceil((block.content?.length || 0) / 4);
                      if (!block.content && !isActivelyStreaming) return null;
                      // v0.6.7 task #159 — InlineThinkingBlock replaces
                      // CollapsedThinkingBlock so each thinking round shows
                      // a live "Thinking..." header that locks to
                      // "Thought for X.Xs · ~N tokens" when complete.
                      const startedAt = block.startTime;
                      const endedAt = !isActivelyStreaming && block.isComplete && block.startTime
                        ? block.startTime + (block.duration ?? 0)
                        : undefined;
                      return (
                        <InlineThinkingBlock
                          key={block.id || `thinking-${globalIdx}`}
                          content={block.content}
                          isStreaming={isActivelyStreaming}
                          startedAt={startedAt}
                          endedAt={endedAt}
                          tokenCount={tokenCount}
                        />
                      );
                    })}
                  </div>
                );
              }

              const { block, index } = group;
              return wrap(renderContentBlock(block, index));
            });

            // Sev-1 #922 — orphan HITL approvals (toolName didn't pair with
            // any tool_use in this stream) render at the end as a fallback
            // so the user can still act on them. Same testid + same card
            // chrome — just no inline pairing. Source moved to the hoisted
            // useMemo above (#922+#831).
            const orphanNodes = hitlOrphans.length > 0 ? (
              <div
                key="hitl-orphan-strip"
                data-testid="hitl-approval-strip"
                data-orphan="true"
              >
                {hitlOrphans.map((entry) => (
                  <HitlInlineCard
                    key={`hitl-orphan-${entry.requestId}`}
                    entry={entry}
                    onApprove={onApproveHitl}
                    onDeny={onDenyHitl}
                  />
                ))}
              </div>
            ) : null;

            return (
              <>
                {renderedGroups}
                {orphanNodes}
              </>
            );
          })()}
        </div>
      ) : (
        /* Legacy: Single merged thinking block (v0.6.7 task #159: uses
           InlineThinkingBlock for the new collapsed header style) */
        thinkingContent && (
          <InlineThinkingBlock
            content={thinkingContent}
            isStreaming={isThinkingActive}
          />
        )
      )}

      {/* Tree steps container - ONLY show if NOT using interleaved content */}
      {toolCalls.length > 0 && !hasInterleavedContent && (
        <TreeStepsContainer
          toolCalls={toolCalls}
          isStreaming={isStreaming}
          totalDuration={totalDuration}
          isHistorical={isHistorical}
        />
      )}
    </div>
  );
};

export default AgenticActivityStream;
