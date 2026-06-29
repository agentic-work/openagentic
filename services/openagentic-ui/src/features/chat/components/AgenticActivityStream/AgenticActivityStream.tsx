import React, { useState, useEffect, useMemo } from 'react';
import { SharedMarkdownRenderer } from '../MessageContent/SharedMarkdownRenderer';
import { XCircle } from '@/shared/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { humanizeToolName } from '../../utils/toolNameHumanizer';
import { detectTableData } from '../../utils/tableRowStream';
import { InlineStreamingTable } from '../InlineStreamingTable';
import { AgentExecutionTimeline } from '@/features/agents/components/AgentExecutionTimeline';
import type { ExecutionStep } from '@/features/agents/hooks/useAgentPlayground';
import { useAgentTreeStore } from '@/stores/useAgentTreeStore';
import { useFollowupChipsStore } from '@/stores/useFollowupChipsStore';
// v0.6.7 task #159 — InlineThinkingBlock replaces CollapsedThinkingBlock for
// thinking blocks; ToolCallCard receives the live input_json_delta pane.
import { InlineThinkingBlock } from '../InlineThinkingBlock';
import { ToolCallCard } from './components/ToolCallCard';
// v0.6.7 task #131 (Phase F2) — parallel tool fan-out group (UnifiedAgentActivity
// variant), imported under an alias to avoid the name collision with the local
// serial-cluster group (now TreeToolCallGroup). Do NOT rename this symbol.
import { ToolCallGroup as ParallelFanOutGroup } from '../UnifiedAgentActivity/ToolCallGroup';
// Wire-in D (#82) — parallel tool-round container (server tool_round envelope).
import { ToolParallelGroup } from '../ToolParallelGroup';
// #646 Option B — sub-agent card render INLINE at the agent-block position;
// StreamingTable renders compose_visual(template=table) natively inline.
import { SubAgentCard, StreamingTable } from '../v2';
import { InlineAppBadge } from '../v2/InlineAppBadge';
import { InlineVizBadge } from './InlineVizBadge';
import { subAgentVariantFor } from '../../hooks/useChatStream';

// God-file decomposition (behavior-preserving) — helpers + sub-components
// extracted into sibling modules. The main component below is a thinner
// composition that wires them together.
import {
  formatDuration,
  isT1Tool,
  isHiddenT1Block,
  getCompactSummary,
  detectErrorInOutput,
} from './activityUtils';
import { StatusDot } from './StatusIndicators';
import { ToolProgressTick } from './ToolStreamIndicators';
import { ThinkingBudgetBadge } from './ThinkingComponents';
import { TreeStepsContainer } from './TreeSteps';
import { HitlInlineCard } from './HitlInlineCard';
import { TreeToolCallGroup } from './TreeToolCallGroup';

import type {
  AgenticActivityStreamProps,
  SubAgentEntry,
  ContentBlock,
  HitlApprovalEntry,
} from './types/activity.types';

// ============================================================================
// Local type aids (type-only; no runtime change)
// ============================================================================

/**
 * Streaming-only fields stamped on tool_use blocks by useChatStream that are
 * not (yet) part of the shared ContentBlock type. Read defensively via cast.
 */
type ToolProgressFields = { progressMessage?: string; progressElapsed?: number };

/**
 * Loose shape for the window/useAgentTreeStore agent-tree lookup used to
 * surface a sub-agent's task on agent_start steps.
 */
type AgentTreeLike = { agents?: Record<string, { task?: unknown } | undefined> };

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
  // Light-mode prose readability fix (2026-05-31): the top-level wrapper below
  // sets a data-theme scope that openagentic-theme.css uses to pin --color-text
  // for ALL descendant assistant prose (.interleaved-text-block → .prose). The
  // `theme` prop defaults to 'dark' and our caller (MessageBubble) never passes
  // it, so in light mode the wrapper stayed data-theme="dark" and forced cream
  // text on light paper — illegible. Drive the wrapper scope from the GLOBAL
  // app theme instead so prose follows light/dark; child code/tool widgets keep
  // their own hardcoded theme="dark" sub-scopes (syntax highlighting).
  const { resolvedTheme } = useTheme();
  const wrapperTheme = resolvedTheme === 'light' ? 'light' : 'dark';
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

  // #646 Option B — lookup table from agent role → SubAgentEntry[].
  // #1113 (2026-05-25) — promoted from single-entry Map to multi-entry list:
  // N parallel Tasks sharing the same `subagent_type` (e.g. 3 × cloud_operations)
  // produced 3 SubAgentEntry rows in subAgents[] but the old Map.set(role, sa)
  // last-write-wins collapsed them to one, so every agent_group iteration
  // pulled the LAST entry and rendered all N cards with the SAME description
  // (live evidence on 0.7.1-cd220a7e: 3 cards all titled "GCP IAM audit"
  // despite api logs showing 3 distinct dispatches "Azure / AWS / GCP").
  // Now we keep the dispatch-order list and the iterator (line ~3870) pops
  // one per agent_group via a per-render counter (see roleConsumed map).
  // Roles are case-sensitive (server emits canonical kebab-case on
  // sub_agent_started).
  const subAgentsByRole = useMemo(() => {
    const m = new Map<string, SubAgentEntry[]>();
    for (const sa of subAgents ?? []) {
      const existing = m.get(sa.role) ?? [];
      existing.push(sa);
      m.set(sa.role, existing);
    }
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
    const hasArtifact = contentBlocks.some(b => b.type === 'viz_render' || b.type === 'app_render' || b.type === 'image_render');
    // F1-6 (2026-05-17) — follow_up chip row counts as interleaved content
    // so a turn with ONLY a follow_up block (degenerate, but possible on
    // session reload) still mounts AAS.
    // 'follow_up' is a runtime block type not yet in ContentBlockType (owned by
    // activity.types in another shard) — compare via string cast.
    const hasFollowUp = contentBlocks.some(b => (b.type as string) === 'follow_up');
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

  // #922+#831 — block-level HITL assignment, hoisted out of the JSX IIFE
  // so `renderContentBlock` and the tool-card inline embed paths can both
  // look up "what HITL entry pairs with THIS specific tool_use block?".
  //
  // Walks tool_use/tool_call blocks in chronological order, pairs each
  // with the earliest unconsumed HITL entry whose toolName matches.
  // Remaining unpaired entries are tracked as orphans and rendered at the
  // end of the stream (existing fallback contract — unchanged from #922 v1).
  // Hook must run unconditionally — keep it above the early return below.
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

  // Nothing to show
  if (toolCalls.length === 0 && !thinkingContent && !hasInterleavedContent) return null;

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
              <StreamingTable table={tbl as unknown as React.ComponentProps<typeof StreamingTable>['table']} />
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
    } else if (block.type === 'image_render') {
      // generate_image — inline generated raster image. The src is ALWAYS a
      // same-origin /api/images/:id url (the tool + SDK reducer reject
      // external hosts), so the model can never satisfy an image request by
      // fabricating an <img src="https://unsplash..."> tag — it must call
      // generate_image, which lands here. Theme tokens only (CLAUDE.md 8b).
      const imgSrc = block.imageUrl;
      if (!imgSrc) return null;
      const altText =
        block.prompt || block.title || 'Generated image';
      return (
        <div
          key={block.id}
          className="interleaved-image-render"
          data-testid="image-render"
          data-block-id={block.id}
          style={{
            margin: '10px 0',
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--cm-line-2)',
            background: 'var(--cm-bg-1)',
            maxWidth: 640,
          }}
        >
          <img
            src={imgSrc}
            alt={altText}
            loading="lazy"
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
            }}
          />
          {block.prompt ? (
            <div
              style={{
                padding: '6px 10px',
                fontSize: '0.8125rem',
                color: 'var(--cm-fg-2)',
                borderTop: '1px solid var(--cm-line-2)',
              }}
            >
              {block.prompt}
            </div>
          ) : null}
        </div>
      );
    } else if ((block.type as string) === 'follow_up') {
      // Sev-0 F1-6 (2026-05-17) — end-of-turn follow-up chip row. Mirrors
      // the `.followups` block from all 17 northstar mocks
      // (`mocks/UX/AI/Chatmode/end-state-{01..17}.html`). Theme tokens only
      // (CLAUDE.md rule 8b — no hex/rgb literals).
      //
      // 2026-05-19 — honor the user-facing toggle. When the composer
      // toolbar's "Follow-up suggestions" pill is OFF, this branch returns
      // null so chips disappear platform-wide (not just from ChipsRow).
      if (!followupChipsEnabled) return null;
      // follow_up blocks carry a string[] `items` field not on ContentBlock
      // (owned by activity.types in another shard) — cast locally to read it.
      const followUpItems = (block as { items?: unknown }).items;
      const items: string[] = Array.isArray(followUpItems) ? (followUpItems as string[]) : [];
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
                  window?.dispatchEvent?.(ev);
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
      const isAgentBlock = !!block.agentId;
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
                {isAgentBlock ? (block.agentRole || toolName) : (toolName || humanized.label)}
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
                color: hasError ? 'var(--color-err)' : 'var(--color-text-muted)',
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
                progressMessage={(block as ToolProgressFields).progressMessage}
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
          {!isAgentBlock && isRunning && (block as ToolProgressFields).progressMessage && (
            <ToolProgressTick
              message={(block as ToolProgressFields).progressMessage as string}
              elapsed={(block as ToolProgressFields).progressElapsed}
            />
          )}

          {/* F.3 — when a completed tool returned a row-array (common for
              list_/query_ paginated MCP calls), reveal rows progressively
              in an inline table instead of dumping the whole array.
              Sev-0 #1069 (2026-05-23) — gated OFF when the model already
              emitted an explicit compose_visual block in this turn. The
              auto-detect was rendering a SECOND table directly beneath
              the canonical StreamingTable from the compose_visual:table
              branch (line 3192) — same data, two surfaces, identical
              cells. User: "the cards are duped- shitting the good one
              out at the end and the fucked up one inline". Model owns
              artifact intent; defer to its explicit emission when present. */}
          {!isAgentBlock && !isRunning && toolCall?.output != null && (() => {
            const hasExplicitArtifact = contentBlocks.some(
              b => b.type === 'viz_render' || b.type === 'app_render' || b.type === 'image_render'
            );
            if (hasExplicitArtifact) return null;
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
              the main tool_group path embeds HITL via TreeToolCallGroup +
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
      data-theme={wrapperTheme}
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
              border: '1px solid var(--color-border)',
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

            // #1113 — per-role dispatch counter shared across all agent_groups
            // in this message. Each agent_group represents one Task call; when
            // N parallel Tasks all share role=cloud_operations the groups are
            // emitted in dispatch order and we consume one SubAgentEntry per
            // group (FIFO from subAgentsByRole.get(role)). Initialized fresh
            // per render — recomputed alongside renderedGroups.
            const roleConsumedIdx = new Map<string, number>();

            const renderedGroups = groups.map((group, gIdx) => {
              // #922+#831 — HITL inline placement is now block-scoped:
              //   - `tool_group` (single OR cluster): HITL is embedded
              //     INSIDE the matching per-child tool-card div (AAS owns
              //     the single-block wrap, TreeToolCallGroup owns each child
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
                    let stepData:
                      | { arguments: unknown; result: unknown; cost: number; tokensUsed: number }
                      | { task: unknown; cost: number; tokensUsed: number }
                      | undefined =
                      tc ? { arguments: tc.input, result: tc.output, cost: 0, tokensUsed: 0 } : undefined;
                    if (stepType === 'agent_start' && b.agentId) {
                      try {
                        const trees = (window as { __agentTrees?: Record<string, AgentTreeLike> }).__agentTrees || useAgentTreeStore?.getState?.()?.trees;
                        if (trees) {
                          for (const tree of Object.values(trees as Record<string, AgentTreeLike>)) {
                            const agent = tree?.agents?.[b.agentId];
                            if (agent?.task) {
                              stepData = { task: agent.task, cost: 0, tokensUsed: 0 };
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
                      // #1113 — consume from the per-role dispatch FIFO so
                      // N parallel Tasks sharing role each get their OWN
                      // SubAgentEntry (distinct description / model / status)
                      // instead of all rendering the last-write-wins entry.
                      const roleEntries = subAgentsByRole.get(role) ?? [];
                      const consumedIdx = roleConsumedIdx.get(role) ?? 0;
                      const sa = roleEntries[consumedIdx];
                      if (sa) roleConsumedIdx.set(role, consumedIdx + 1);

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
                            borderLeft: '2px solid var(--color-primary)',
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
                // TreeToolCallGroup which embeds the HITL inside each per-child
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
                    <TreeToolCallGroup
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
