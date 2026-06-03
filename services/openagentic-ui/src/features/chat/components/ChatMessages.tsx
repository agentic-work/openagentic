/**
 * Chat Messages Component - Gemini Style
 *
 * Simple chronological message rendering like Google Gemini
 * - Messages render in order they were created (timestamp-based)
 * - User messages appear AFTER they're sent
 * - Assistant responses stream in real-time
 * - No complex grouping or turn-based logic
 * - Tool calls display inline with their parent message
 */

import React, { useMemo, useState, useCallback } from 'react';
import { ChatMessage } from '@/types/index';
import { normalizeMessages } from '../utils/messageNormalizer';
// COTStep — inlined here after ChainOfThoughtDisplay component was ripped
// (367 LOC of dead chrome). Only the type was still used downstream.
export interface COTStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'rag_lookup' | 'fetch' | 'memory' | 'reasoning';
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  startTime?: number;
  endTime?: number;
  request?: any;
  response?: any;
  error?: string;
  content?: string;
}
import StreamErrorBoundary from '@/shared/components/StreamErrorBoundary';
import MessageBubble from './MessageBubble';
import { WidgetRenderer } from './v2/WidgetRenderer';
import { AppRenderer } from './v2/AppRenderer';
import { ToolShortlistChip } from './v2/ToolShortlistChip';
import { ToolArray, type ToolArrayItem, type ToolTier } from './v2/ToolArray';
import { SubAgentCard, StreamingTable, Findings, LiveTurnStatus } from './v2';
import { InlineWidgetStrip } from './v2/InlineWidgetStrip';
import { DownloadTile } from './v2/DownloadTile';
import {
  subAgentVariantFor,
  type SubAgentEntry,
  type ToolShortlist,
} from '../hooks/useChatStream';
import { mergePersistedSubAgents } from './mergePersistedSubAgents';
import { type AgentState } from './UnifiedAgentActivity';
import { ContentBlock } from '../hooks/useChatStream';
import { StarterPrompts, type StarterPrompt } from './StarterPrompts';
// 2026-05-07 — bottom-center floating ThinkingSphere instance ripped per
// user feedback. The inline thinking-block sphere lives in
// ThinkingSection / ThinkingGlobeIndicator and naturally hides when
// streaming ends.
import type { ThinkingProgress } from './AgenticActivityStream/types/activity.types';
import type { NormalizedStreamEvent } from '../../../types/AnthropicStreamEvent';
import ToolApprovalPopup from './ToolApprovalPopup';
import { ContentFilterBanner } from './ContentFilterBanner';
// AgentExecutionTree no longer rendered here — MessageBubble's
// AgenticActivityStream is the single render path for orchestrations
// (consumed from the normalizedEvents SSE stream). The store stays imported
// elsewhere (AgenticActivityStream.tsx) for task description lookups.
// REMOVED UNUSED IMPORTS (now handled by MessageBubble -> AgenticActivityStream):
// - EnhancedMessageContent, SmoothStreamingText, InlineThinkingDisplay
// - InlineMCPIndicator, InlineSteps, InterleavedContent

// Pipeline state interface
interface PipelineState {
  currentStage: string | null;
  stageStartTime: number | null;
  stageTiming: Record<string, number>;
  isToolExecutionPhase: boolean;
  activeToolRound: number;
  maxToolRounds: number;
  bufferedContent: string;
  shouldSuppressContent: boolean;
}

// Thinking metrics interface
interface ThinkingMetrics {
  tokens: number;
  elapsedMs: number;
  tokensPerSecond: number;
}

interface ChatMessagesProps {
  theme: 'light' | 'dark';
  messages: ChatMessage[];
  streamingContent?: string;
  smoothStreaming?: boolean;
  isLoading?: boolean;
  thinkingTime?: number;
  thinkingMessage?: string;
  thinkingContent?: string;  // Streaming thinking content from models that support it (e.g., Ollama)
  thinkingMetrics?: ThinkingMetrics | null;
  messagesEndRef?: React.RefObject<HTMLDivElement>;
  activeMcpCalls?: any[];
  currentToolRound?: number;  // Current agentic loop round for visual indicator
  pipelineState?: PipelineState;
  showTypingIndicators?: boolean;
  showMCPIndicators?: boolean;  // New prop to control MCP indicator visibility
  showModelBadges?: boolean;  // Control model badge visibility on messages
  showThinkingInline?: boolean;  // Control inline thinking display visibility
  cotSteps?: COTStep[];  // Chain of Thought steps for streaming display
  agentState?: AgentState;  // Unified agent state for inline activity display
  contentBlocks?: ContentBlock[];  // Interleaved content blocks for thinking/text display
  canonicalContentBlocks?: ContentBlock[];  // Preferred when non-empty (pure-reducer shape)
  thinkingProgress?: ThinkingProgress;  // Thinking progress for real progress indicator
  normalizedEvents?: NormalizedStreamEvent[];  // Normalized stream events for UnifiedActivityTree
  runningCost?: number | null;  // v0.6.7 fix 2 — streaming running cost (USD) from cost_delta
  // LiveTurnStatus inputs (codemode-style live time + ↑/↓ tokens + activity)
  ttftMs?: number | null;
  turnStartedAt?: number | null;
  liveTokensIn?: number;
  liveTokensOut?: number;
  liveActivity?: string;
  currentStage?: string | null;
  // visualRenders / appRenders / artifactRenders props removed — those
  // wire frames now route through the typed-block path (ContentBlock of
  // type viz_render / app_render) and render inline inside
  // AgenticActivityStream at the wire-emit chronological position.
  // Wave 3 (#525) — per-message tool shortlist driven by `tool_shortlist`
  // NDJSON frame from prompt.stage. Renders as ToolShortlistChip in the
  // assistant message header.
  toolShortlists?: Record<string, ToolShortlist>;
  // #502 — sub-agent dispatches for the in-flight assistant message.
  // Driven by sub_agent_started / sub_agent_completed NDJSON envelopes
  // from useChatStream. Rendered as SubAgentCard inside the assistant
  // fragment (mock 01 lines 1083-1133). Body content (nested ToolCards,
  // sa-subthink, sa-return) is a follow-up — for this PR we render the
  // head row + return-value strip only.
  subAgents?: SubAgentEntry[];
  /**
   * P0-1 part 2 — per-message scoped sub-agent state. When supplied, each
   * MessageBubble renders only the sub-agents dispatched DURING ITS OWN
   * turn instead of every bubble showing the latest session-global
   * snapshot. Older message bubbles read their own entries via
   * `subAgentsByMessageId[message.id]`. Missing keys fall back to the flat
   * `subAgents` array for the in-flight (streaming) message so existing
   * test fixtures + live behavior keep working during the rollout.
   */
  subAgentsByMessageId?: Record<string, SubAgentEntry[]>;
  /**
   * P1-6 — per-message streaming-table state from `streaming_table` NDJSON
   * frames. Renders mock 01:385-462 anatomy inline inside the message
   * bubble (right-sizing tables, IAM drift rows, cost summaries). Scoped
   * so older bubbles render only their own tables.
   */
  streamingTablesByMessageId?: Record<string, import('../hooks/useChatStream').StreamingTable[]>;
  /** Phase 27 — per-message findings artifacts (mocks 03, 07, 08, 09). */
  findingsByMessageId?: Record<string, import('../hooks/useChatStream').FindingsArtifact[]>;
  /**
   * #502 — per-message inline-widget artifacts (kpi_grid / savings_card /
   * stages_strip / wave_timeline / runbook / stack_grid / annotated_code).
   * One unified `inline_widget` NDJSON frame; one render dispatcher.
   */
  inlineWidgetsByMessageId?: Record<string, import('../hooks/useChatStream').InlineWidget[]>;
  /**
   * AC-D — per-message download tiles. Each ArtifactEmit renders one
   * <DownloadTile> chip with mimetype-icon + filename + size + click
   * → presigned MinIO URL (download attribute matches filename).
   */
  artifactEmitsByMessageId?: Record<string, import('../hooks/useChatStream').ArtifactEmit[]>;
  // follow-up chip-row props ripped 2026-05-12 (user directive).
  /**
   * Audit §10 step 16 — per-message HITL approval cards (mocks #9, #15).
   * Rendered inline with Approve/Deny buttons. Status drives card state.
   */
  hitlApprovalsByMessageId?: Record<
    string,
    Array<{
      requestId: string;
      toolName: string;
      serverName?: string;
      reason: string;
      timeoutMs: number;
      arguments?: unknown;
      status: 'pending' | 'approved' | 'denied' | 'expired';
    }>
  >;
  onApproveHitl?: (requestId: string) => void;
  onDenyHitl?: (requestId: string) => void;
  /**
   * B8 (2026-05-12) — per-message compliance banner shown when the
   * assistant turn ended with canonical stop_reason='content_filter' /
   * 'safety' / 'recitation'. Replaces the silent-truncate end_turn UX.
   */
  contentFilterBannerByMessageId?: Record<
    string,
    { kind: string; model: string; message: string }
  >;
  onExpandToCanvas?: (content: any, type: string, title: string, language?: string) => void;
  onExecuteCode?: (code: string, language: string) => void;
  onMessageUpdate?: (messageId: string, content: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  // REMOVED: useAgenticActivityStream - AgenticActivityStream is now always used
  onInterrupt?: () => void;  // Interrupt callback for streaming
  onPromptSelect?: (prompt: StarterPrompt) => void;  // Callback for starter prompt selection
  onFeedback?: (messageId: string, feedbackType: 'thumbs_up' | 'thumbs_down' | 'copy') => void;
  // Inline tool approval (HITM)
  pendingApproval?: {
    approvalId?: string;
    intent: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    tools?: Array<{ id: string; name: string; arguments: any }>;
    code?: string;
    expiresAt?: string;
  } | null;
  onApproveTools?: () => void;
  onDenyTools?: () => void;
}

export default function ChatMessages({
  theme,
  messages,
  streamingContent = '',
  smoothStreaming = true,
  isLoading = false,
  thinkingTime,  // Time spent thinking (milliseconds)
  thinkingMessage = '',
  thinkingContent = '',  // Streaming thinking from models that support it
  thinkingMetrics,
  messagesEndRef,
  activeMcpCalls = [],
  currentToolRound = 0,
  pipelineState,
  showMCPIndicators = true,  // Default to true for backwards compatibility
  showModelBadges = true,  // Default to true for backwards compatibility
  showThinkingInline = true,  // Default to true for backwards compatibility
  cotSteps = [],  // Chain of Thought steps
  agentState,  // Unified agent state for inline display
  contentBlocks = [],  // Interleaved content blocks
  canonicalContentBlocks = [],  // Pure-reducer slice; preferred when non-empty
  thinkingProgress,  // Thinking progress for real progress indicator
  normalizedEvents,  // Normalized stream events for UnifiedActivityTree
  runningCost,  // v0.6.7 fix 2 — streaming running cost (USD) from cost_delta
  ttftMs,
  turnStartedAt,
  liveTokensIn,
  liveTokensOut,
  liveActivity,
  currentStage,
  // Wave 3 (#525) — tool shortlist chip state (one entry per assistant message).
  toolShortlists,
  // #502 — sub-agent lifecycle entries (from sub_agent_* envelopes).
  subAgents,
  // P0-1 part 2 — per-message scoped sub-agent state.
  subAgentsByMessageId,
  // P1-6 — per-message streaming-table state.
  streamingTablesByMessageId,
  findingsByMessageId,
  // #502 — per-message inline-widget state.
  inlineWidgetsByMessageId,
  // AC-D — per-message clickable download tiles.
  artifactEmitsByMessageId,
  // follow-up chip-row destructures ripped 2026-05-12 (user directive).
  // Audit §10 step 16 — HITL approval cards (mocks #9, #15).
  hitlApprovalsByMessageId,
  onApproveHitl,
  onDenyHitl,
  // B8 — content_filter compliance banner state (FedRAMP-Hi audit).
  contentFilterBannerByMessageId,
  onExpandToCanvas,
  onExecuteCode,
  onMessageUpdate,
  onEditMessage,
  // REMOVED: useAgenticActivityStream - always use AgenticActivityStream now
  onInterrupt,
  onPromptSelect,
  onFeedback,
  pendingApproval,
  onApproveTools,
  onDenyTools,
}: ChatMessagesProps) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Normalize messages once - sorts chronologically by timestamp
  const normalizedMessages = useMemo(() => {
    return normalizeMessages(messages).filter(msg => {
      // Hide system continuation prompts that were stored as user messages
      // These are internal pipeline messages, not actual user input
      if (msg.role === 'user' && typeof msg.content === 'string') {
        if (msg.content.startsWith('[System instruction]')) return false;
        if (msg.content.startsWith('[system instruction]')) return false;
      }
      return true;
    });
  }, [messages]);

  /**
   * Group consecutive assistant messages with tool calls into "activity turns"
   * This allows us to render ONE aggregated InlineSteps per turn instead of 12+ separate pills
   *
   * Returns:
   * - turnGroups: Map of turnId -> array of message indices in that turn
   * - messageTurnInfo: Map of messageId -> { turnId, isFirst, isLast, turnToolCount }
   */
  const { turnGroups, messageTurnInfo } = useMemo(() => {
    const groups = new Map<string, number[]>();
    const info = new Map<string, { turnId: string; isFirst: boolean; isLast: boolean; turnToolCount: number; roundCount?: number }>();

    let currentTurnId: string | null = null;
    let currentTurnMessages: number[] = [];
    let turnCounter = 0;

    normalizedMessages.forEach((msg, idx) => {
      const hasToolCalls = (msg.mcpCalls && msg.mcpCalls.length > 0) ||
                          (msg.toolCalls && msg.toolCalls.length > 0);
      const isAssistant = msg.role === 'assistant';
      const isTool = msg.role === 'tool';
      const isStreaming = msg.status === 'streaming';
      const hasThinking = msg.reasoningTrace || msg.metadata?.thinkingContent || msg.thinkingSteps?.length;

      // Check if previous message was part of the current turn
      const prevMsgWasInTurn = currentTurnId && currentTurnMessages.length > 0;

      // Group consecutive assistant + tool messages that are part of the same agentic loop
      // A message should be grouped if:
      // 1. It's an assistant message with tool calls (starts/continues a turn)
      // 2. It's an assistant message following tool calls (might be intermediate or final response)
      // 3. It's streaming (always include in current turn if any)
      // 4. It's a tool result message within an active turn (tool responses to assistant tool calls)
      // The turn ends when we hit a user message or an assistant message that doesn't fit the pattern
      const shouldStartTurn = isAssistant && (hasToolCalls || hasThinking) && !currentTurnId;
      const shouldContinueTurn = (isAssistant && prevMsgWasInTurn && (hasToolCalls || isStreaming)) ||
                                 (isTool && prevMsgWasInTurn);

      if (shouldStartTurn || shouldContinueTurn) {
        // Start new turn or continue existing
        if (!currentTurnId) {
          currentTurnId = `turn-${++turnCounter}`;
          currentTurnMessages = [];
        }
        currentTurnMessages.push(idx);
      } else {
        // End current turn if any
        if (currentTurnId && currentTurnMessages.length > 0) {
          groups.set(currentTurnId, [...currentTurnMessages]);

          // Calculate total tool count for this turn
          let totalTools = 0;
          currentTurnMessages.forEach(i => {
            const m = normalizedMessages[i];
            totalTools += (m.mcpCalls?.length || 0) + (m.toolCalls?.length || 0);
          });

          // Mark messages with turn info
          const roundCount = currentTurnMessages.length;
          currentTurnMessages.forEach((i, turnIdx) => {
            info.set(normalizedMessages[i].id, {
              turnId: currentTurnId!,
              isFirst: turnIdx === 0,
              isLast: turnIdx === currentTurnMessages.length - 1,
              turnToolCount: totalTools,
              roundCount,
            });
          });
        }
        currentTurnId = null;
        currentTurnMessages = [];
      }
    });

    // Handle final turn
    if (currentTurnId && currentTurnMessages.length > 0) {
      groups.set(currentTurnId, [...currentTurnMessages]);

      let totalTools = 0;
      currentTurnMessages.forEach(i => {
        const m = normalizedMessages[i];
        totalTools += (m.mcpCalls?.length || 0) + (m.toolCalls?.length || 0);
      });

      const roundCount = currentTurnMessages.length;
      currentTurnMessages.forEach((i, turnIdx) => {
        info.set(normalizedMessages[i].id, {
          turnId: currentTurnId!,
          isFirst: turnIdx === 0,
          isLast: turnIdx === currentTurnMessages.length - 1,
          turnToolCount: totalTools,
          roundCount,
        });
      });
    }

    return { turnGroups: groups, messageTurnInfo: info };
  }, [normalizedMessages]);

  // Sev-0 #838 — fold persisted sub-agents from message.visualizations
  // into the per-message map so AgenticActivityStream renders inline at
  // the Task tool_use position even after reload. Live entries win on
  // key collision so the streaming reducer's snapshot isn't clobbered
  // by stale persistence. Test: __tests__/mergePersistedSubAgents.test.ts.
  const effectiveSubAgentsByMessageId = useMemo(
    () => mergePersistedSubAgents(subAgentsByMessageId, normalizedMessages) as Record<
      string,
      SubAgentEntry[]
    >,
    [subAgentsByMessageId, normalizedMessages],
  );

  // Memoized edit handlers to prevent MessageBubble re-renders
  const handleEditStart = useCallback((message: ChatMessage) => {
    setEditingMessageId(message.id);
    setEditContent(message.content);
  }, []);

  const handleEditChange = useCallback((content: string) => {
    setEditContent(content);
  }, []);

  const handleEditSubmit = useCallback((messageId: string) => {
    if (editContent.trim() && onEditMessage) {
      onEditMessage(messageId, editContent.trim());
      setEditingMessageId(null);
      setEditContent('');
    }
  }, [editContent, onEditMessage]);

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditContent('');
  }, []);

  // REMOVED: agentTrees subscription + activeTreeEntries memo.
  // These existed to feed the inline AgentExecutionTree render, which has
  // been deleted to fix the "double agents" duplicate-render bug. The store
  // is still populated by useChatStream from legacy SSE events because
  // AgenticActivityStream.tsx peeks at it for agent task descriptions.

  /**
   * REMOVED: renderStreamingMessage()
   * 
   * This function was causing DUPLICATE RENDERING of thinking blocks and content.
   * It was a parallel render path that competed with MessageBubble's rendering.
   * 
   * The fix: MessageBubble now receives contentBlocks via streamingContentBlocks prop
   * and uses AgenticActivityStream (which uses InterleavedContent) as the single
   * source of truth for all interleaved content rendering.
   * 
   * See: MessageBubble.tsx -> AgenticActivityStream -> InterleavedContent
   */

  return (
    <div className="h-full w-full gpu-accelerated">
      <div
        data-transcript-root
        className="cm-v2 cm-chat w-full max-w-full px-4 sm:px-6 md:px-8"
        style={{
          // Content column width. 902px == --transcript-max-width
          // (single source of truth in styles/design-tokens.css). Layout
          // (display:flex, flex-direction:column, gap:32px) is owned by
          // .cm-chat (chatmode-v2.css:68-74) so the inline style only
          // pins the column width.
          maxWidth: 'var(--transcript-max-width)',
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <StreamErrorBoundary>
          {/* Empty state with starter prompts when no messages */}
          {normalizedMessages.length === 0 && !isLoading && onPromptSelect && (
            <div className="flex items-center justify-center min-h-[60vh] py-12">
              <StarterPrompts onSelect={onPromptSelect} />
            </div>
          )}

          {/* Render all messages in chronological order - using memoized MessageBubble */}
          {normalizedMessages.map((message, idx) => {
            const turnInfo = messageTurnInfo.get(message.id);
            const isPartOfTurn = !!turnInfo;

            // For grouped turns: get all messages in this turn to aggregate steps
            let aggregatedMessages: typeof normalizedMessages | undefined;
            if (turnInfo?.isFirst && turnGroups.has(turnInfo.turnId)) {
              const turnIndices = turnGroups.get(turnInfo.turnId)!;
              aggregatedMessages = turnIndices.map(i => normalizedMessages[i]);
            }

            // Wave 3 (#525) — per-message tool shortlist (assistant only).
            const toolShortlist =
              message.role === 'assistant' && toolShortlists
                ? toolShortlists[message.id]
                : undefined;

            // Sev-1 #922 — resolve HITL approvals for THIS assistant message
            // so MessageBubble can hand them straight to AgenticActivityStream.
            // Live-state first, then fall back to the persisted-visualization
            // shape (#91) so historical approval cards survive session
            // reload. Cards are deduped by requestId because the api
            // dual-emitted `hitl_approval` + `mcp_approval_required` before
            // the rip — old session rows still carry both frames.
            const messageHitlApprovals = (() => {
              if (message.role !== 'assistant') return undefined;
              const live = hitlApprovalsByMessageId?.[message.id] ?? [];
              if (live.length > 0) return live;
              const persisted = (message as any).visualizations;
              if (!Array.isArray(persisted)) return undefined;
              const seenIds = new Set<string>();
              const out = persisted
                .filter((f: any) => f && (f.type === 'hitl_approval' || f.type === 'mcp_approval_required') && f.data)
                .filter((f: any) => {
                  const rid = typeof f.data.requestId === 'string' ? f.data.requestId : '';
                  if (!rid || seenIds.has(rid)) return false;
                  seenIds.add(rid);
                  return true;
                })
                .map((f: any) => ({
                  requestId: f.data.requestId,
                  toolName: f.data.toolName ?? 'unknown',
                  serverName: f.data.serverName,
                  reason: f.data.reason ?? '',
                  timeoutMs: f.data.timeoutMs ?? 60_000,
                  arguments: f.data.arguments,
                  status: 'expired' as const,
                }));
              return out.length > 0 ? out : undefined;
            })();

            // Terminal Glass (Phase 4) — staggered load-in. Only the FIRST turn
            // rises into place (idx 0 = first user → d3, idx 1 = first assistant
            // → d4), continuing the orchestrated cascade from the sidebar (d1) /
            // main panel (d2) / composer (d5). Later messages don't carry a rise
            // class, so this is a one-shot on load — not a per-scroll effect.
            const riseClass = idx === 0 ? 'rise rise-d3' : idx === 1 ? 'rise rise-d4' : undefined;

            return (
              <React.Fragment key={message.id}>
                <MessageBubble
                  message={message}
                  riseClass={riseClass}
                  theme={theme}
                  showMCPIndicators={showMCPIndicators}
                  showModelBadges={showModelBadges}
                  showThinkingInline={showThinkingInline}
                  thinkingContent={message.status === 'streaming' ? thinkingContent : undefined}
                  activeMcpCalls={message.status === 'streaming' ? activeMcpCalls : undefined}
                  isEditing={editingMessageId === message.id}
                  editContent={editingMessageId === message.id ? editContent : ''}
                  onEditStart={handleEditStart}
                  onEditChange={handleEditChange}
                  onEditSubmit={handleEditSubmit}
                  onEditCancel={handleEditCancel}
                  onExpandToCanvas={onExpandToCanvas}
                  onExecuteCode={onExecuteCode}
                  // Turn aggregation props
                  turnInfo={turnInfo}
                  aggregatedMessages={aggregatedMessages}
                  // REMOVED: useAgenticActivityStream - always use AgenticActivityStream now
                  onInterrupt={onInterrupt}
                  // FIXED: Pass contentBlocks to MessageBubble for streaming messages
                  // MessageBubble's AgenticActivityStream handles interleaved rendering
                  // renderStreamingMessage() has been REMOVED to prevent duplicate rendering
                  streamingContentBlocks={
                    // F1-6 (2026-05-17) — keep passing the canonical/legacy
                    // contentBlocks slot at finalize too, but ONLY for the
                    // most-recent assistant message in the list. Blocks
                    // emitted AFTER the final text_delta (e.g. `follow_up`
                    // chip rows at end_turn) must survive the streaming →
                    // finalize handoff. Previously this was `undefined`
                    // post-stream and AAS fell back to finalContentBlocks
                    // (rebuilt from steps), which never contained those
                    // late blocks. Scoped to last assistant message so we
                    // don't leak the in-memory reducer state into older
                    // bubbles in the conversation.
                    (message.status === 'streaming'
                      || (message.role === 'assistant'
                          && idx === normalizedMessages.length - 1
                          && (canonicalContentBlocks.length > 0 || contentBlocks.length > 0)))
                      ? (canonicalContentBlocks.length > 0 ? canonicalContentBlocks : contentBlocks)
                      : undefined
                  }
                  thinkingProgress={message.status === 'streaming' ? thinkingProgress : undefined}
                  normalizedEvents={
                    // Pass normalizedEvents to streaming messages AND the last assistant message
                    // (so the unified tree persists after streaming completes)
                    normalizedEvents && normalizedEvents.length > 0 && message.role === 'assistant' &&
                    (message.status === 'streaming' || idx === normalizedMessages.length - 1)
                      ? normalizedEvents : undefined
                  }
                  onThumbsUp={onFeedback ? (msgId: string) => onFeedback(msgId, 'thumbs_up') : undefined}
                  onThumbsDown={onFeedback ? (msgId: string) => onFeedback(msgId, 'thumbs_down') : undefined}
                  onCopy={onFeedback ? (msgId: string) => onFeedback(msgId, 'copy') : undefined}
                  runningCost={message.status === 'streaming' ? runningCost : undefined}
                  // #646 Option B — sub-agent props forwarded into AgenticActivityStream
                  // so the rich SubAgentCard renders INLINE at the agent_group's
                  // timeline position (mock 01:1077-1140). Trailing strip below was
                  // RIPPED — AAS owns this render now.
                  subAgents={subAgents}
                  subAgentsByMessageId={effectiveSubAgentsByMessageId}
                  hitlApprovals={messageHitlApprovals}
                  onApproveHitl={onApproveHitl}
                  onDenyHitl={onDenyHitl}
                  // Sev-0 dup-render rip (2026-05-21) — forward streaming-table
                  // data into the bubble so AAS can render the native
                  // <StreamingTable> INLINE at the viz_render(template=table)
                  // tool_use position. The sibling strip below the bubble that
                  // used to render these is RIPPED — single source of truth.
                  streamingTables={
                    message.role === 'assistant'
                      ? streamingTablesByMessageId?.[message.id]
                      : undefined
                  }
                  // LiveTurnStatus inputs — only thread these through for the
                  // currently streaming message so the strip renders directly
                  // to the right of the spinning ThinkingSphere with live
                  // ↑in / ↓out tokens + a one-line activity summary.
                  turnStartedAt={message.status === 'streaming' ? turnStartedAt : null}
                  ttftMs={message.status === 'streaming' ? ttftMs : null}
                  liveTokensIn={message.status === 'streaming' ? liveTokensIn : undefined}
                  liveTokensOut={message.status === 'streaming' ? liveTokensOut : undefined}
                  liveActivity={message.status === 'streaming' ? liveActivity : undefined}
                />
                {/*
                 * REMOVED: inline <AgentExecutionTree> render.
                 *
                 * Was duplicating the agent tree because MessageBubble already
                 * renders the same orchestration via AgenticActivityStream from
                 * the normalizedEvents stream. The backend dual-emits both
                 * legacy `agent_*` events (which feed useAgentTreeStore that
                 * fed this inline tree) AND `normalized_event` (which feeds
                 * MessageBubble). With both paths active, every orchestration
                 * showed two agent trees side-by-side ("double agents" bug).
                 *
                 * The store is still used by AgenticActivityStream for task
                 * description lookups (line 2081 of that file), so we keep
                 * the legacy event handlers in useChatStream — we just stop
                 * rendering them as a separate tree here.
                 */}
                {/*
                 * #646 Option B — sub-agent card render moved INTO
                 * AgenticActivityStream's timeline (between the parent's
                 * narration tool calls and the parent's final synthesis
                 * prose), matching mock 01:1077-1140 where
                 * `<article class="subagent">` slots inside the parent
                 * agent's timeline. The trailing `cm-subagent-strip` IIFE
                 * was ripped here — MessageBubble now forwards `subAgents`
                 * + `subAgentsByMessageId` straight into AAS, which owns
                 * the SubAgentCard render at the agent_group position.
                 */}
                {/*
                 * Sev-0 dup-render rip (2026-05-21) — RIPPED. The sibling
                 * `<StreamingTable>` strip that used to render BELOW the
                 * MessageBubble was producing a third duplicate render of
                 * `compose_visual({template:'table'})` data (alongside the
                 * InlineVizBadge iframe and the ToolCard JSON wall). AAS
                 * now owns the streaming-table render INLINE at the
                 * viz_render(template=table) wire-emit position via the
                 * `streamingTables` prop threaded from MessageBubble.
                 *
                 * The reducer (`applyStreamingTableFrame`) still populates
                 * `streamingTablesByMessageId[message.id]` so persistence
                 * and the AAS inline render path both see the data — only
                 * the sibling-after-bubble JSX is gone.
                 *
                 * Live evidence:
                 *   reports/verify-cadence/one-shot-redeploy-2026-05-21/07-table-dup-fullpage.png
                 * Pin: __tests__/MessageBubble.dup-render-rip.test.tsx
                 */}
                {/*
                 * Phase 27 — findings strip (mocks 03, 07, 08, 09).
                 * Severity-tagged audit/review list emitted by
                 * `findings_emit` NDJSON frame.
                 */}
                {(() => {
                  const findings = findingsByMessageId?.[message.id];
                  if (!findings || findings.length === 0 || message.role !== 'assistant') return null;
                  return (
                    <div className="cm-v2" data-testid="findings-strip">
                      {findings.map((art) => (
                        <Findings key={art.artifactId} items={art.items} />
                      ))}
                    </div>
                  );
                })()}
                {/*
                 * #502 — unified inline-widget render dispatcher. Drives
                 * KpiGrid / SavingsCard / StagesStrip / WaveTimeline /
                 * Runbook / StackGrid / AnnotatedCode from one NDJSON
                 * frame keyed by `kind`. Component decides what to render
                 * (test at v2/__tests__/InlineWidgetStrip.test.tsx).
                 */}
                {message.role === 'assistant' && (
                  <InlineWidgetStrip widgets={inlineWidgetsByMessageId?.[message.id] ?? []} />
                )}
                {/*
                 * Persistence Sev-1 — saved-on-message fallback. When the
                 * live per-message reducer maps are empty (i.e. on session
                 * reload after refresh), render directly from the
                 * `message.visualizations` array the API persisted to
                 * chat_messages.visualizations during the streaming turn.
                 *
                 * Frame types handled:
                 *   - visual_render    → WidgetRenderer (ECharts/SVG/HTML)
                 *   - app_render       → AppRenderer (sandboxed iframe srcdoc)
                 *   - artifact_render  → WidgetRenderer (mermaid/svg/html) +
                 *                        AppRenderer (react)
                 *   - streaming_table  → StreamingTable
                 *   - inline_widget    → InlineWidgetStrip
                 *   - sub_agent_complete / sub_agent_completed → SubAgentCard
                 *   - findings_emit    → Findings (severity-tagged artifact)
                 *   - artifact_emit    → DownloadTile (presigned MinIO link)
                 *
                 * Live-render-already-fired guard: if the matching live map
                 * has any entry for this messageId, skip the fallback to
                 * avoid double-rendering. Otherwise render the saved frames.
                 *
                 * E1 (2026-05-12): extended past the original 5-frame set to
                 * cover the full inline-frame catalogue persisted by api/
                 * persistableInlineFrames.ts. Reload-survival regression cage
                 * lives in ChatMessages.persistedE1Hydration.test.tsx.
                 */}
                {(() => {
                  if (message.role !== 'assistant') return null;
                  const persisted = (message as any).visualizations;
                  if (!Array.isArray(persisted) || persisted.length === 0) return null;
                  const liveTables = streamingTablesByMessageId?.[message.id];
                  const liveWidgets = inlineWidgetsByMessageId?.[message.id];
                  const liveSubAgents = subAgentsByMessageId?.[message.id];
                  const liveFindings = findingsByMessageId?.[message.id];
                  const liveArtifactEmits = artifactEmitsByMessageId?.[message.id];
                  // visual_render / app_render / artifact_render persisted
                  // hydration is handled by the typed-block path
                  // (Message.content_blocks → ContentBlock[type=viz_render|
                  // app_render] → AgenticActivityStream inline render).
                  // The persisted strip below covers only the frame types
                  // that haven't migrated to content_blocks yet.
                  const streamingTablesFromSaved = persisted
                    .filter((f: any) => f && f.type === 'streaming_table' && f.data)
                    .map((f: any) => f.data);
                  const inlineWidgetsFromSaved = persisted
                    .filter((f: any) => f && f.type === 'inline_widget' && f.data)
                    .map((f: any) => f.data);
                  // sub_agent_complete (legacy) + sub_agent_completed (canonical)
                  // both fold to the same SubAgentCard render — emitter site
                  // varied historically, persisted blobs may carry either.
                  const subAgentCompleteFromSaved = persisted
                    .filter(
                      (f: any) =>
                        f &&
                        (f.type === 'sub_agent_complete' || f.type === 'sub_agent_completed') &&
                        f.data,
                    )
                    .map((f: any) => f.data);
                  const findingsFromSaved = persisted
                    .filter((f: any) => f && f.type === 'findings_emit' && f.data)
                    .map((f: any) => f.data);
                  const artifactEmitsFromSaved = persisted
                    .filter((f: any) => f && f.type === 'artifact_emit' && f.data)
                    .map((f: any) => f.data);
                  const hasLive =
                    (liveTables && liveTables.length > 0) ||
                    (liveWidgets && liveWidgets.length > 0) ||
                    (liveSubAgents && liveSubAgents.length > 0) ||
                    (liveFindings && liveFindings.length > 0) ||
                    (liveArtifactEmits && liveArtifactEmits.length > 0);
                  if (hasLive) return null;
                  return (
                    <div className="cm-v2 cm-persisted-strip" data-testid="persisted-visualizations">
                      {streamingTablesFromSaved.length > 0 && (
                        <div data-testid="persisted-streaming-tables">
                          {streamingTablesFromSaved.map((tbl: any, idx: number) => (
                            <StreamingTable
                              key={`saved-tbl-${idx}-${tbl.artifactId ?? idx}`}
                              table={tbl}
                            />
                          ))}
                        </div>
                      )}
                      {inlineWidgetsFromSaved.length > 0 && (
                        <InlineWidgetStrip widgets={inlineWidgetsFromSaved} />
                      )}
                      {/* Sev-0 #838 — persisted sub-agent cards now flow through
                          mergePersistedSubAgents → effectiveSubAgentsByMessageId →
                          AgenticActivityStream, rendering INLINE at the Task
                          tool_use position regardless of hydration source. The
                          old trailing `<div data-testid="persisted-sub-agents">`
                          render path is RIPPED. The persisted slice is still
                          extracted into `subAgentCompleteFromSaved` above so the
                          guard logic for other persisted blocks continues to
                          work; it just no longer renders here. */}
                      {findingsFromSaved.length > 0 && (
                        <div data-testid="persisted-findings">
                          {findingsFromSaved.map((fnd: any, idx: number) => (
                            <Findings
                              key={`saved-fnd-${idx}-${fnd.artifact_id ?? fnd.artifactId ?? idx}`}
                              items={Array.isArray(fnd.items) ? fnd.items : []}
                            />
                          ))}
                        </div>
                      )}
                      {artifactEmitsFromSaved.length > 0 && (
                        <div data-testid="persisted-download-tiles">
                          {artifactEmitsFromSaved.map((a: any, idx: number) => (
                            <DownloadTile
                              key={`saved-ae-${idx}-${a.artifactId ?? idx}`}
                              artifact={a}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/*
                 * AC-D — download-tile strip. One <DownloadTile> per
                 * artifact_emit. Click → presigned MinIO URL.
                 */}
                {(() => {
                  const tiles =
                    message.role === 'assistant'
                      ? artifactEmitsByMessageId?.[message.id] ?? []
                      : [];
                  if (tiles.length === 0) return null;
                  return (
                    <div className="cm-v2" data-testid="download-tile-strip">
                      {tiles.map((a) => (
                        <DownloadTile key={a.artifactId} artifact={a} />
                      ))}
                    </div>
                  );
                })()}
                {/* Sev-1 #922 (2026-05-17) — per-message HITL footer strip
                    RIPPED. AAS now owns the HITL render INLINE next to the
                    matching tool_use block (CLAUDE.md rule 8a chronological
                    interleave). HITL approvals are threaded into AAS via the
                    `hitlApprovals` prop on MessageBubble; see the
                    `messageHitlApprovals` resolver above. The original
                    footer-strip is preserved in git history at this site
                    (search: "Audit §10 step 16" pre-2026-05-17).
                */}
                {/* B8 (2026-05-12) — content_filter compliance banner.
                    Rendered when canonical stop_reason was content_filter /
                    safety / recitation. Replaces the silent-truncate
                    end_turn UX so the user sees a distinct compliance
                    signal per FedRAMP-Hi audit. */}
                {message.role === 'assistant' &&
                  contentFilterBannerByMessageId?.[message.id] && (
                    <ContentFilterBanner
                      kind={contentFilterBannerByMessageId[message.id].kind}
                      model={contentFilterBannerByMessageId[message.id].model}
                      message={contentFilterBannerByMessageId[message.id].message}
                    />
                  )}
                {/* follow-up chip-row render ripped 2026-05-12 (user directive). */}
                {/*
                 * Wave 3 (#525) — tool-shortlist chip rendered in the
                 * assistant header row. Driven by the `tool_shortlist`
                 * NDJSON frame (Wave 2 backend). Renders null when no
                 * frame received (toolShortlist undef).
                 */}
                {toolShortlist && (
                  <div
                    data-message-id={message.id}
                    data-testid="tool-shortlist-chip-row"
                  >
                    <ToolShortlistChip
                      totalAvailable={toolShortlist.totalAvailable}
                      count={toolShortlist.count}
                      intent={toolShortlist.intent}
                      kept={toolShortlist.kept}
                    />
                  </div>
                )}
                {/* Phase 2 — mock 10:227-241 inline tool-loadout chip row.
                    Renders ABOVE the activity stream so the user can see
                    which tools were available for the turn. Tier inferred
                    from the tool-name namespace (no separator → T1
                    internal; otherwise T2 MCP-connected). */}
                {toolShortlist && toolShortlist.kept && toolShortlist.kept.length > 0 && (
                  <div className="cm-v2" data-testid="tool-array-row">
                    <ToolArray
                      tools={toolShortlist.kept.map((name): ToolArrayItem => {
                        const t: ToolTier =
                          /[._:]|__/.test(name) ? 2 : 1;
                        return { name, tier: t };
                      })}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {/* REMOVED: renderStreamingMessage() - now handled by MessageBubble */}

          {/* Live Agent Execution Trees — rendered INLINE after the last assistant message */}
          {/* NOT at bottom — appears right after the streaming message bubble */}

          {/* LiveTurnStatus has been moved INTO MessageBubble so the strip
              renders directly to the right of the spinning ThinkingSphere
              instead of as a trailing block below all messages. The
              co-located version inherits live ↑in / ↓out token bumps from
              every NDJSON delta + a short activity summary. */}

          {/* visual_render / app_render / artifact_render sidecars were ripped.
              Those frames now flow through applyCanonicalFrame into typed
              ContentBlocks (viz_render / app_render) that render inline at
              their wire-emit chronological position inside
              AgenticActivityStream — no parent-level pooling. */}

          {/* 2026-05-07 — RIPPED bottom-center floating ThinkingSphere.
              User feedback: "the sphere should be where the square is
              and disappear when thinking/request is done." The square
              indicator lived INSIDE the inline thinking block; the
              sphere now lives in that same spot (ThinkingSection.tsx
              MiniThinkingIndicator + AgenticActivityStream
              ThinkingGlobeIndicator), and naturally hides when
              `isAnimating` becomes false at end-of-stream. The extra
              floating sphere here was a distinct visual element with
              no square-equivalent and is no longer needed. */}

          {/* HITL approval modal — full-screen overlay via portal */}
          <ToolApprovalPopup
            visible={!!pendingApproval}
            approvalId={pendingApproval?.approvalId}
            intent={pendingApproval?.intent || ''}
            riskLevel={pendingApproval?.riskLevel || 'medium'}
            tools={pendingApproval?.tools}
            code={pendingApproval?.code}
            expiresAt={pendingApproval?.expiresAt}
            onApprove={onApproveTools || (() => {})}
            onDeny={onDenyTools || (() => {})}
          />

          {/* Scroll anchor */}
          <div ref={messagesEndRef} className="h-4" />
        </StreamErrorBoundary>
      </div>
    </div>
  );
}
