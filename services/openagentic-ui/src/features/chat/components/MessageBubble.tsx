/**
 * MessageBubble - Memoized message rendering component
 * Wrapped with React.memo to prevent unnecessary re-renders
 * when other messages in the list change or streaming content updates.
 */

import React, { memo, useCallback, useMemo, useState, Component, ErrorInfo, ReactNode } from 'react';
import { Edit2, Send, FileText, Image as ImageIcon, AlertTriangle, Copy, Check, ThumbsUp, ThumbsDown, RotateCcw } from '@/shared/icons';
import { ChatMessage } from '@/types/index';
import EnhancedMessageContent from './MessageContent/EnhancedMessageContent';
// Sev-0 #840 — memo comparator lives in its own lean module so tests
// can import it without dragging the full MessageBubble component tree
// (Lottie / Shiki / Three.js) into jsdom. Rename the binding locally
// so Rollup's tree-shaker keeps the chunk-local var declaration intact
// (the original `export { … }` re-export was being elided, leaving a
// ReferenceError at module top-level when `memo()` ran).
import { shouldSkipMessageBubbleRerender as memoComparator } from './MessageBubble.memo';
// #781 Phase D wire-in — new-pipeline artifact slide-out launchers.
// Render ABOVE legacy EnhancedMessageContent so messages with
// visualizations[] or tool_result._meta.artifactKind get the new
// slide-out UX; legacy ArtifactRenderer remains as fallback until
// Phase D.3 ripping.
import { ArtifactSlideOutLauncher } from './artifacts/ArtifactSlideOutLauncher';
import { extractArtifacts } from './artifacts/extractArtifacts';
// V2 mock-parity components (per chatmode-ux-mock-parity branch).
// MessageHeader replaces the legacy InlineModelBadge + CostPill meta-row.
// Per-message CostPill is REMOVED (per user direction — topbar-only). The
// V2 anatomy at mocks/UX/01-cloud-ops.html lines 184-214 shows avatar +
// name + model pill + timestamp; no per-message cost pill.
import { MessageHeader, LiveTurnStatus } from './v2';
import { ArtifactErrorBoundary } from '@/shared/components';
import { ThinkingSphere } from '@/shared/components/ThinkingSphere';
// InlineStep type now in activity.types.ts
import type { InlineStep, ThinkingProgress } from './AgenticActivityStream/types/activity.types';
import { AgenticActivityStream, useInlineStepsAdapter } from './AgenticActivityStream';
import { UnifiedActivityTree } from './UnifiedActivityTree';
import type { NormalizedStreamEvent } from '../../../types/AnthropicStreamEvent';
// Task #104 — use the canonical streaming block type from useChatStream.
// The previous local `StreamingContentBlock` interface was a structural
// subset of this one; dropping it removes a triple-declaration smell
// (the other two live in useChatStream.ts and activity.types.ts; the
// latter is a legit display-layer type with its own `metadata` nesting).
import type { ContentBlock as StreamingContentBlock, SubAgentEntry } from '../hooks/useChatStream';

// `splitModelLabel` removed 2026-04-30 (P0-2). The hook
// (useChatStream.attachModelIdentifier) now stamps modelTag + modelId on the
// message at frame-receive time using the canonical `splitModelIdentifier`
// helper (split-on-first-hyphen, mock 01:206-212 contract). MessageHeader
// reads message.modelTag / message.modelId directly. Single source of truth.

import { splitModelIdentifier } from '../hooks/useChatStream';
import { InlineGroundingChip, stripGroundingArtifacts } from './GroundingVerdictChip';

// Debug Error Boundary to catch and log render errors with details
class MessageErrorBoundary extends Component<
  { children: ReactNode; messageId: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; messageId: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[MessageBubble] RENDER ERROR:', {
      messageId: this.props.messageId,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="p-4 border rounded-lg m-2"
          style={{
            background: 'color-mix(in srgb, var(--color-err) 10%, transparent)',
            borderColor: 'color-mix(in srgb, var(--color-err) 30%, transparent)',
          }}
        >
          <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--color-err)' }}>
            <AlertTriangle size={16} />
            <span className="font-medium">Message Render Error (ID: {this.props.messageId})</span>
          </div>
          <pre className="text-xs whitespace-pre-wrap break-all" style={{ color: 'var(--color-err)' }}>
            {this.state.error?.message}
          </pre>
          <details className="mt-2">
            <summary className="text-xs cursor-pointer" style={{ color: 'var(--color-err)' }}>Stack Trace</summary>
            <pre className="text-[10px] mt-1 overflow-auto max-h-32" style={{ color: 'var(--color-err)', opacity: 0.7 }}>
              {this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

// ArtifactErrorBoundary is imported from @/shared/components

/**
 * Thumbnail component for attached files
 */
const AttachedFileThumbnail = memo(function AttachedFileThumbnail({
  name,
  data,
  mimeType
}: {
  name: string;
  data: string;
  mimeType: string;
}) {
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';

  // Build data URL for images
  const imageUrl = isImage ? `data:${mimeType};base64,${data}` : undefined;

  return (
    <div className="relative group">
      {isImage && imageUrl ? (
        <div
          className="w-16 h-16 rounded-lg overflow-hidden border"
          style={{ borderColor: 'var(--color-rule)', background: 'var(--color-surface-2)' }}
        >
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div
          className="w-16 h-16 rounded-lg border flex items-center justify-center"
          style={{ borderColor: 'var(--color-rule)', background: 'var(--color-surface-2)' }}
        >
          {isPdf ? (
            <FileText size={24} style={{ color: 'var(--color-fg-muted)' }} />
          ) : (
            <ImageIcon size={24} style={{ color: 'var(--color-fg-muted)' }} />
          )}
        </div>
      )}
      {/* File name tooltip on hover */}
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
        <div
          className="text-xs px-2 py-1 rounded whitespace-nowrap max-w-[150px] truncate"
          style={{ background: 'var(--color-fg)', color: 'var(--color-bg)' }}
        >
          {name}
        </div>
      </div>
    </div>
  );
});

/**
 * FeedbackRow - Claude.ai style action row with copy, feedback, retry
 */
interface FeedbackRowProps {
  content: string;
  onCopy?: () => void;
  onThumbsUp?: (messageId: string) => void;
  onThumbsDown?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
  messageId: string;
  isStreaming?: boolean;
}

const FeedbackRow = memo(function FeedbackRow({
  content,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  onRetry,
  messageId,
  isStreaming,
}: FeedbackRowProps) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [content, onCopy]);

  const handleThumbsUp = useCallback(() => {
    setFeedback(feedback === 'up' ? null : 'up');
    onThumbsUp?.(messageId);
  }, [feedback, messageId, onThumbsUp]);

  const handleThumbsDown = useCallback(() => {
    setFeedback(feedback === 'down' ? null : 'down');
    onThumbsDown?.(messageId);
  }, [feedback, messageId, onThumbsDown]);

  const handleRetry = useCallback(() => {
    onRetry?.(messageId);
  }, [messageId, onRetry]);

  // Don't show during streaming
  if (isStreaming) return null;

  const buttonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 8px',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    transition: 'color 0.15s, background 0.15s',
  };

  const activeStyle: React.CSSProperties = {
    ...buttonStyle,
    color: 'var(--color-primary)',
    background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
  };

  return (
    <div
      className="feedback-row opacity-0 group-hover:opacity-100 transition-opacity"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginTop: 8,
        paddingTop: 8,
      }}
    >
      {/* Copy button */}
      <button
        onClick={handleCopy}
        style={copied ? activeStyle : buttonStyle}
        className="hover:bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] hover:text-[var(--color-text-secondary)]"
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy message content'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>

      {/* Thumbs up */}
      <button
        onClick={handleThumbsUp}
        style={feedback === 'up' ? activeStyle : buttonStyle}
        className="hover:bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] hover:text-[var(--color-text-secondary)]"
        title="Good response"
        aria-label="Rate as good response"
      >
        <ThumbsUp size={14} />
      </button>

      {/* Thumbs down */}
      <button
        onClick={handleThumbsDown}
        style={feedback === 'down' ? activeStyle : buttonStyle}
        className="hover:bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] hover:text-[var(--color-text-secondary)]"
        title="Bad response"
        aria-label="Rate as bad response"
      >
        <ThumbsDown size={14} />
      </button>

      {/* Retry */}
      {onRetry && (
        <button
          onClick={handleRetry}
          style={buttonStyle}
          className="hover:bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] hover:text-[var(--color-text-secondary)]"
          title="Retry this message"
          aria-label="Retry generating this response"
        >
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
});

// Turn info for message aggregation
interface TurnInfo {
  turnId: string;
  isFirst: boolean;
  isLast: boolean;
  turnToolCount: number;
  roundCount?: number;
}

interface MessageBubbleProps {
  message: ChatMessage;
  theme: 'light' | 'dark';
  showMCPIndicators: boolean;
  showModelBadges: boolean;
  showThinkingInline: boolean;
  thinkingContent?: string;
  activeMcpCalls?: any[];
  isEditing: boolean;
  editContent: string;
  onEditStart: (message: ChatMessage) => void;
  onEditChange: (content: string) => void;
  onEditSubmit: (messageId: string) => void;
  onEditCancel: () => void;
  onExpandToCanvas?: (content: any, type: string, title: string, language?: string) => void;
  onExecuteCode?: (code: string, language: string) => void;
  // Turn aggregation props
  turnInfo?: TurnInfo;
  aggregatedMessages?: ChatMessage[];
  // REMOVED: useAgenticActivityStream - AgenticActivityStream is now always used (no fallback to InlineSteps)
  onInterrupt?: () => void;
  // Live streaming content blocks for interleaved thinking
  streamingContentBlocks?: StreamingContentBlock[];
  // Thinking progress for real progress indicator
  thinkingProgress?: ThinkingProgress;
  // Feedback callbacks
  onThumbsUp?: (messageId: string) => void;
  onThumbsDown?: (messageId: string) => void;
  onCopy?: (messageId: string) => void;
  // Normalized stream events (UNIFIED_STREAM=true path)
  normalizedEvents?: NormalizedStreamEvent[];
  // v0.6.7 fix 2 — running cost (USD) from cost_delta events, live during streaming
  runningCost?: number | null;
  /**
   * #646 Option B — sub-agent lifecycle entries (sub_agent_started /
   * sub_agent_completed) for the in-flight streaming message. Forwarded
   * straight into AgenticActivityStream so the rich SubAgentCard renders
   * INLINE at the agent_group's timeline position (mock 01:1077-1140)
   * rather than as a trailing sibling.
   */
  subAgents?: SubAgentEntry[];
  /**
   * #646 Option B — per-message scoped sub-agent map. Wins over the flat
   * `subAgents` array when a key matches `message.id`, so completed
   * sub-agents from previous turns stay scoped to their own turn instead
   * of bleeding into the next assistant message.
   */
  subAgentsByMessageId?: Record<string, SubAgentEntry[]>;
  /**
   * Sev-1 #922 — HITL approvals for THIS message. Threaded straight into
   * AgenticActivityStream so the approval card renders INLINE next to the
   * matching tool_use. The previous per-message footer-strip render in
   * ChatMessages was ripped (Sev-1 #922) because the card stayed anchored
   * to the message-end while the tool card scrolled out of view as the
   * model emitted more content, breaking the visual coupling between
   * tool dispatch and approval prompt.
   */
  hitlApprovals?: Array<{
    requestId: string;
    toolName: string;
    serverName?: string;
    reason: string;
    timeoutMs: number;
    arguments?: unknown;
    status: 'pending' | 'approved' | 'denied' | 'expired';
  }>;
  onApproveHitl?: (requestId: string) => void;
  onDenyHitl?: (requestId: string) => void;
  /**
   * Sev-0 dup-render rip (2026-05-21) — streaming-table data scoped to
   * THIS message. Forwarded straight into AgenticActivityStream so a
   * `viz_render(template=table)` ContentBlock renders the matching
   * native `<StreamingTable>` INLINE at the tool_use position instead
   * of the buggy iframe-srcdoc HTML table. The sibling strip below the
   * bubble in ChatMessages.tsx is RIPPED — AAS owns this render now.
   */
  streamingTables?: import('../hooks/useChatStream').StreamingTable[];
  /**
   * LiveTurnStatus inputs (codemode-style strip rendered RIGHT of the
   * spinning sphere during streaming):
   *   ↑ tokensIn · ↓ tokensOut · elapsed · TTFT · activity summary
   * Only renders for the streaming assistant message (isStreaming=true).
   */
  turnStartedAt?: number | null;
  ttftMs?: number | null;
  liveTokensIn?: number;
  liveTokensOut?: number;
  liveActivity?: string;
}

/**
 * Detect if tool output indicates an error (500, 4xx, error messages, etc.)
 * Used to show correct status on tool calls
 */
const detectErrorInResult = (result: unknown): boolean => {
  if (!result) return false;

  const resultStr = typeof result === 'string'
    ? result
    : JSON.stringify(result);

  // Check for HTTP error status codes in error context
  if (/\b(500|501|502|503|504|400|401|403|404|405|408|422|429)\b/.test(resultStr)) {
    if (/error|failed|failure|exception|status.*(500|4\d\d)|"code":\s*(500|4\d\d)/i.test(resultStr)) {
      return true;
    }
  }

  // Check for error keywords
  const lowered = resultStr.toLowerCase();
  if (
    lowered.includes('"error"') ||
    lowered.includes("'error'") ||
    lowered.includes('error:') ||
    lowered.includes('failed:') ||
    lowered.includes('exception:') ||
    /Internal Server Error/i.test(resultStr)
  ) {
    return true;
  }

  // Check for MCP-style error responses
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;
    if (obj.error || obj.isError || obj.success === false) {
      return true;
    }
  }

  return false;
};

/**
 * Determine step type based on tool name
 */
const getStepType = (toolName: string): InlineStep['type'] => {
  const nameLower = toolName.toLowerCase();
  if (nameLower.includes('bash') || nameLower.includes('shell') || nameLower.includes('execute')) {
    return 'bash';
  } else if (nameLower.includes('search') || nameLower.includes('web') || nameLower.includes('grep')) {
    return 'search';
  } else if (nameLower.includes('read') || nameLower.includes('glob')) {
    return 'read';
  } else if (nameLower.includes('write') || nameLower.includes('edit')) {
    return 'write';
  }
  return 'tool';
};

/**
 * Convert MCP calls to Step format
 * @param isHistorical - true if this is from a saved message (not currently streaming)
 */
const mcpCallToStep = (mcpCall: any, index: number, model?: string, isHistorical: boolean = false): InlineStep => {
  const toolName = mcpCall.tool || mcpCall.name || mcpCall.function?.name || 'tool';
  const args = mcpCall.args || mcpCall.arguments || mcpCall.function?.arguments;

  // Detect if the result contains an error
  const hasError = detectErrorInResult(mcpCall.result);

  // Determine status: error if result has error, completed if has result or historical, otherwise running
  let status: InlineStep['status'];
  if (hasError) {
    status = 'error';
  } else if (mcpCall.status === 'completed' || mcpCall.result || isHistorical) {
    status = 'completed';
  } else {
    status = 'running';
  }

  // Get result summary
  let summary = '';
  if (mcpCall.result) {
    if (typeof mcpCall.result === 'string') {
      summary = mcpCall.result.substring(0, 100) + (mcpCall.result.length > 100 ? '...' : '');
    } else if (mcpCall.result.content?.[0]?.text) {
      const text = mcpCall.result.content[0].text;
      summary = text.substring(0, 100) + (text.length > 100 ? '...' : '');
    }
  }

  return {
    id: `mcp-${index}-${mcpCall.id || Date.now()}`,
    type: getStepType(toolName),
    title: toolName,
    summary: (status === 'completed' || status === 'error') ? summary : undefined,
    status,
    model,
    details: {
      args,
      result: mcpCall.result,
      command: getStepType(toolName) === 'bash' ? (args?.command || args?.script) : undefined,
      output: mcpCall.result?.content?.[0]?.text || (typeof mcpCall.result === 'string' ? mcpCall.result : undefined),
    },
    startTime: mcpCall.startTime,
    endTime: mcpCall.endTime || ((status === 'completed' || status === 'error') ? Date.now() : undefined),
    progressMessage: mcpCall.progressMessage,
  };
};

/**
 * Convert standard toolCalls (like Gemini function calls) to Step format
 * @param isHistorical - true if this is from a saved message (not currently streaming)
 */
const toolCallToStep = (toolCall: any, index: number, toolResult?: any, model?: string, isHistorical: boolean = false): InlineStep => {
  const toolName = toolCall.function?.name || toolCall.name || 'tool';
  // E1.5 (2026-05-12) — read canonical V2 persisted shape `input`
  // (chat_messages.tool_calls[]) BEFORE legacy `arguments` /
  // `function.arguments`. Without this, every reloaded expand panel
  // showed INPUT {} because legacy keys weren't on the persisted row.
  // Pinned by MessageBubble.toolCallShapeNormalization.test.tsx (E1.5).
  const argsRaw =
    toolCall.input ??
    toolCall.function?.arguments ??
    toolCall.arguments;
  let args = argsRaw;

  // Parse arguments if they're a string
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      // Keep as string if parsing fails
    }
  }

  // E1.5 — persisted tool_result rows have shape
  // `{name, tool_use_id, content, is_error, _meta}`. Older callers had
  // `result` directly. Normalize so downstream `summary` / `details.result`
  // see the structured content object, not the wrapper envelope.
  const normalizedResult =
    toolResult && typeof toolResult === 'object' && 'content' in toolResult
      ? (toolResult as any).content
      : toolResult;

  const hasResult = normalizedResult !== undefined;

  // Detect if the result contains an error. Honor explicit is_error stamp
  // from the persisted wrapper too (V2 tool_result frame).
  const hasError =
    (toolResult && typeof toolResult === 'object' && (toolResult as any).is_error === true) ||
    detectErrorInResult(normalizedResult);

  // Get result summary
  let summary = '';
  if (hasResult && normalizedResult) {
    if (typeof normalizedResult === 'string') {
      summary = normalizedResult.substring(0, 100) + (normalizedResult.length > 100 ? '...' : '');
    } else if ((normalizedResult as any).content?.[0]?.text) {
      const text = (normalizedResult as any).content[0].text;
      summary = text.substring(0, 100) + (text.length > 100 ? '...' : '');
    } else if (typeof (normalizedResult as any).summary === 'string') {
      // V2 envelope: structuredContent = { summary, data }
      summary = (normalizedResult as any).summary.substring(0, 100);
    }
  }

  // Determine status: error if result has error, completed if has result or historical, otherwise running
  let status: InlineStep['status'];
  if (hasError) {
    status = 'error';
  } else if (hasResult || isHistorical) {
    status = 'completed';
  } else {
    status = 'running';
  }

  return {
    id: `tool-${index}-${toolCall.id || toolCall.tool_use_id || Date.now()}`,
    type: getStepType(toolName),
    title: toolName,
    summary: hasResult ? summary : undefined,
    status,
    model,
    details: {
      args,
      result: normalizedResult,
      command: getStepType(toolName) === 'bash' ? (args?.command || args?.script) : undefined,
      output:
        (normalizedResult as any)?.content?.[0]?.text ??
        (typeof normalizedResult === 'string' ? normalizedResult : undefined),
    },
  };
};

/**
 * Memoized message bubble component
 * Only re-renders when its own props change
 */
const MessageBubble = memo(function MessageBubble({
  message,
  theme,
  showMCPIndicators,
  showModelBadges,
  showThinkingInline,
  thinkingContent,
  activeMcpCalls,
  isEditing,
  editContent,
  onEditStart,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onExpandToCanvas,
  onExecuteCode,
  turnInfo,
  aggregatedMessages,
  // REMOVED: useAgenticActivityStream - always use AgenticActivityStream now
  onInterrupt,
  streamingContentBlocks,
  thinkingProgress,
  onThumbsUp,
  onThumbsDown,
  onCopy,
  normalizedEvents,
  runningCost,
  subAgents,
  subAgentsByMessageId,
  hitlApprovals,
  onApproveHitl,
  onDenyHitl,
  turnStartedAt,
  ttftMs,
  liveTokensIn,
  liveTokensOut,
  liveActivity,
  streamingTables,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';
  const isStreaming = message.status === 'streaming';

  // Skip tool messages - they're shown inline with their parent
  if (message.role === 'tool') {
    return null;
  }

  // Skip system messages
  if (isSystem) {
    return null;
  }

  // TURN AGGREGATION: Skip non-first messages in a turn (they're aggregated into the first)
  // But don't skip if it has substantial content to display
  const hasSubstantialContent = message.content && message.content.trim().length > 50;
  if (turnInfo && !turnInfo.isFirst && !hasSubstantialContent && !isStreaming) {
    return null;
  }

  // Handle keyboard events for edit
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onEditSubmit(message.id);
    }
    if (e.key === 'Escape') {
      onEditCancel();
    }
  }, [message.id, onEditSubmit, onEditCancel]);

  // Build steps from thinking content, tool calls, and MCP calls
  // TURN AGGREGATION: If aggregatedMessages provided, build from ALL messages in turn
  const steps = useMemo(() => {
    const result: InlineStep[] = [];

    // Determine which messages to process: aggregated or just this one
    const messagesToProcess = aggregatedMessages || [message];

    messagesToProcess.forEach((msg, msgIdx) => {
      const messageModel = msg.model;
      const idPrefix = aggregatedMessages ? `${msgIdx}-` : '';

      // Add standard toolCalls (like Gemini function calls)
      // CRITICAL: For historical (non-streaming) messages, mark as completed
      const isHistoricalMsg = msg.status !== 'streaming';
      if (showMCPIndicators && msg.toolCalls && msg.toolCalls.length > 0) {
        msg.toolCalls.forEach((toolCall: any, idx: number) => {
          // Try to find matching result from toolResults array
          const toolResult = msg.toolResults?.[idx];
          const step = toolCallToStep(toolCall, idx, toolResult, messageModel, isHistoricalMsg);
          step.id = `${idPrefix}${step.id}`;
          result.push(step);

          // Extract agent sub-results from delegate_to_agents / spawn_parallel_agents
          const toolName = toolCall.function?.name || toolCall.name || '';
          if (toolName === 'delegate_to_agents' || toolName === 'spawn_parallel_agents') {
            // Find matching tool result: either from toolResults array or from aggregated tool messages
            let resultContent = toolResult;
            if (!resultContent && aggregatedMessages) {
              const tcId = toolCall.id || toolCall.function?.id;
              const toolMsg = aggregatedMessages.find(
                (m: any) => m.role === 'tool' && m.toolCallId === tcId
              );
              if (toolMsg) resultContent = toolMsg.content;
            }
            // Also try: search ALL messages in aggregatedMessages for tool results (not just role=tool)
            if (!resultContent && aggregatedMessages) {
              // Fallback: check if any message has toolResults matching this toolCall
              for (const m of aggregatedMessages) {
                if (m.toolResults) {
                  const matchIdx = m.toolCalls?.findIndex((tc: any) => tc.id === toolCall.id);
                  if (matchIdx !== undefined && matchIdx >= 0 && m.toolResults[matchIdx]) {
                    resultContent = m.toolResults[matchIdx];
                    break;
                  }
                }
              }
            }
            if (resultContent) {
              try {
                let resultData = resultContent;
                if (typeof resultData === 'string') resultData = JSON.parse(resultData);
                // Handle { content: [{ text: "..." }] } format
                if (resultData?.content?.[0]?.text) {
                  resultData = JSON.parse(resultData.content[0].text);
                }
                // Extract agents array from various response formats
                const agents = resultData?.results || resultData?.agents || [];
                if (Array.isArray(agents)) {
                  agents.forEach((agent: any, agentIdx: number) => {
                    const agentStep: InlineStep = {
                      id: `${idPrefix}agent-${idx}-${agentIdx}-${agent.agentId || agentIdx}`,
                      type: 'tool' as const,
                      title: agent.role || agent.agentRole || `Agent ${agentIdx + 1}`,
                      status: agent.status === 'success' ? 'completed' : agent.status === 'error' ? 'error' : 'completed',
                      model: agent.metrics?.modelUsed || messageModel,
                      summary: typeof agent.output === 'string' ? agent.output.substring(0, 100) : '',
                      duration: agent.metrics?.durationMs,
                      agentId: agent.agentId || `agent-${agentIdx}`,
                      agentRole: agent.role || `Agent ${agentIdx + 1}`,
                      details: {
                        result: agent.output,
                      },
                    };
                    result.push(agentStep);
                  });
                }
              } catch {
                // Tool result not parseable as agent data — skip
              }
            }
          }
        });
      }

      // Add completed MCP calls from message
      if (showMCPIndicators && msg.mcpCalls && msg.mcpCalls.length > 0) {
        msg.mcpCalls.forEach((mcpCall: any, idx: number) => {
          const step = mcpCallToStep(mcpCall, idx, messageModel, isHistoricalMsg);
          step.id = `${idPrefix}${step.id}`;
          result.push(step);
        });
      }
    });

    // Add active MCP calls (for streaming - only for current message)
    // These are NOT historical - they are actively executing
    if (showMCPIndicators && activeMcpCalls && activeMcpCalls.length > 0) {
      console.log('[MessageBubble] Active MCP calls received:', activeMcpCalls.length, activeMcpCalls);
      const messageModel = message.model;
      activeMcpCalls.forEach((mcpCall: any, idx: number) => {
        // Don't add duplicates
        const existingIds = result.map(s => s.id);
        // Pass isHistorical=false for active calls
        const newStep = mcpCallToStep(mcpCall, idx + 1000, messageModel, false);
        if (!existingIds.includes(newStep.id)) {
          result.push(newStep);
        }
      });
    }

    // Add interleaved thinking + tool steps from thinkingSteps.
    // thinkingSteps now preserves the original streaming order (thinking → tool → thinking → tool).
    // We prepend them to `result` so they appear BEFORE any mcpCalls/toolCalls that were added above,
    // and we skip tool steps that duplicate mcpCalls already in `result`.
    const messageModel = message.model;

    if (showThinkingInline && Array.isArray(message.thinkingSteps) && message.thinkingSteps.length > 0) {
      const existingToolIds = new Set(result.map(s => s.id));
      const interleavedSteps: typeof result = [];

      message.thinkingSteps.forEach((step: any, idx: number) => {
        if (!step || typeof step !== 'object') return;

        if (step.type === 'thinking') {
          interleavedSteps.push({
            id: `thinking-step-${message.id}-${idx}`,
            type: 'thinking',
            title: String(step.title || step.description || `Step ${idx + 1}`),
            status: 'completed',
            model: messageModel,
            details: {
              content: String(step.content || step.thinking || step.description || ''),
            },
          });
        } else {
          // Tool/MCP step — only add if not already present from mcpCalls/toolCalls.
          // Pass through `details` (args + result) and `duration` so the
          // activity-stream adapter can populate ToolCall.input/.output and
          // surface rich summaries (favicons on web_search, resource names on
          // cloud creates, etc.). Without these, tool chips render as
          // bare title-only stubs. openagentic-omhs#330.
          const stepId = `interleaved-tool-${message.id}-${idx}`;
          if (!existingToolIds.has(step.id) && !existingToolIds.has(stepId)) {
            interleavedSteps.push({
              id: stepId,
              type: step.type || 'mcp',
              title: String(step.title || step.content || 'Tool'),
              status: step.status || 'completed',
              model: messageModel,
              details: step.details,
              duration: step.duration,
            });
          }
        }
      });

      // Prepend interleaved steps, then remove any duplicate tool entries from `result`
      // that are already represented in the interleaved sequence
      const interleavedToolNames = new Set(
        interleavedSteps.filter(s => s.type !== 'thinking').map(s => s.title)
      );
      const dedupedResult = result.filter(s => !interleavedToolNames.has(s.title));
      result.length = 0;
      result.push(...interleavedSteps, ...dedupedResult);
    }

    // Fallback: reasoningTrace as single thinking block (only if no thinkingSteps)
    const hasThinkingFromSteps = result.some(s => s.type === 'thinking');
    if (showThinkingInline && !isStreaming && !hasThinkingFromSteps) {
      let thinkingContentToShow: string | null = null;

      if (message.reasoningTrace) {
        try {
          thinkingContentToShow = typeof message.reasoningTrace === 'string'
            ? message.reasoningTrace
            : (message.reasoningTrace as any)?.reasoning || JSON.stringify(message.reasoningTrace);
        } catch {
          thinkingContentToShow = String(message.reasoningTrace);
        }
      }

      if (!thinkingContentToShow && message.metadata?.thinkingContent) {
        thinkingContentToShow = message.metadata.thinkingContent;
      }

      if (thinkingContentToShow && thinkingContentToShow.length > 0) {
        result.unshift({
          id: `thinking-${message.id}`,
          type: 'thinking',
          title: 'Reasoning',
          status: 'completed',
          model: messageModel,
          details: {
            content: thinkingContentToShow,
          },
        });
      }
    }

    return result;
  }, [message.toolCalls, message.toolResults, message.mcpCalls, message.thinkingSteps, message.reasoningTrace, message.metadata?.thinkingContent, message.id, message.model, activeMcpCalls, showMCPIndicators, showThinkingInline, isStreaming, aggregatedMessages]);

  // Determine if we should show the steps display
  // Sev-0 #924/#925/#926 — also true when the persisted message carries
  // content_blocks (the canonical chronology). On rehydration, the
  // legacy toolCalls/thinkingSteps[] may be empty for messages saved
  // with only the new content_blocks shape; AAS must still render.
  const _persistedBlocksForHasSteps = (message as any).content_blocks as any[] | undefined;
  const _hasPersistedBlocksForHasSteps = Array.isArray(_persistedBlocksForHasSteps) && _persistedBlocksForHasSteps.length > 0;
  const hasSteps: boolean =
    steps.length > 0 ||
    Boolean(showThinkingInline && isStreaming && thinkingContent) ||
    _hasPersistedBlocksForHasSteps;

  // Convert steps to AgenticActivityStream format when enabled
  const activityStreamData = useInlineStepsAdapter({
    steps,
    currentThinking: isStreaming && showThinkingInline ? thinkingContent : undefined,
    isStreaming,
    currentModel: message.model,
  });

  // Sev-0 #924/#925/#926 — when the message carries the canonical
  // `content_blocks` chronology (persisted on done finalize), prefer it
  // over the reconstructed activityStreamData.contentBlocks. The
  // adapter-reconstructed path can only emit thinking + tool_use blocks
  // (it reads from `thinkingSteps[]`, which excludes text / viz_render /
  // app_render / streaming_table / follow_up / sub_agent / hitl_approval /
  // tool_round / tool_result). When content_blocks is present we render
  // byte-identical DOM to the live stream. When absent (legacy messages
  // persisted before Phase 3) we fall back to the reconstruction path.
  const persistedContentBlocks = (message as any).content_blocks as
    | any[]
    | undefined;
  const hasPersistedBlocks =
    !isStreaming &&
    Array.isArray(persistedContentBlocks) &&
    persistedContentBlocks.length > 0;

  // Phase 6 (2026-05-22) — buildFinalContentBlocks deleted (flat-string
  // tail rip). Direct passthrough of activity blocks; Phase 3 of the rip
  // owns the persistence + reload symmetry. Server is the source of truth
  // for the persisted chronology when present.
  const finalContentBlocks = useMemo(
    () => {
      if (hasPersistedBlocks) {
        return persistedContentBlocks as any[];
      }
      return activityStreamData.contentBlocks as any[];
    },
    [
      hasPersistedBlocks,
      persistedContentBlocks,
      activityStreamData.contentBlocks,
    ],
  );

  // Whether the activity stream includes text content (completed messages with interleaved blocks)
  const activityStreamHasText = finalContentBlocks.some(b => b.type === 'text');

  // #971 follow-up (Sev-1, 2026-05-20) — second-tier guard for the
  // artifact duplicate. AgenticActivityStream inline-mounts
  // `viz_render` blocks via <InlineVizBadge> and `app_render` blocks
  // via <InlineAppBadge> at their chronological position. When those
  // blocks are present in finalContentBlocks, the per-message
  // ArtifactSlideOutLauncher chip row below (which iterates
  // extractArtifacts(message) over the SAME source data —
  // message.visualizations[] + tool_result._meta.artifactKind) is a
  // visual duplicate of what AAS already mounted. Suppress the chip
  // row in that case. The launcher render is KEPT active when AAS
  // does NOT inline-mount (legacy persisted messages, fallback
  // artifacts the AAS render path doesn't handle) — see the JSX
  // gate at the artifact-launcher-list block.
  const activityStreamHasInlineArtifacts = finalContentBlocks.some(
    b => b.type === 'viz_render' || b.type === 'app_render',
  );

  // DEBUG: Write comprehensive diagnostic to localStorage
  if (message.role === 'assistant' && !isStreaming) {
    try {
      localStorage.setItem('__thinkingDebug', JSON.stringify({
        ts: Date.now(),
        msgId: message.id,
        stepsCount: steps.length,
        stepsTypes: steps.map(s => s.type),
        hasSteps,
        adapterBlockCount: activityStreamData.contentBlocks.length,
        adapterBlockTypes: activityStreamData.contentBlocks.map(b => b.type),
        finalBlockCount: finalContentBlocks.length,
        finalBlockTypes: finalContentBlocks.map(b => b.type),
        thinkingStepsCount: message.thinkingSteps?.length || 0,
        reasoningTraceLen: typeof message.reasoningTrace === 'string' ? message.reasoningTrace.length : 0,
        showThinkingInline,
        // THE KEY: is the activity stream rendered?
        renderCondition: hasSteps || false,
      }));
    } catch {}
  }

  return (
    <MessageErrorBoundary messageId={message.id}>
    <div
      data-message-id={message.id}
      data-message-role={message.role}
      className="w-full"
      style={{ willChange: 'contents' }}
    >
      {/* Message container — task #166 mockup: 760px chat column
          centered, 32px gap between messages (via mockup-v067.css sibling
          selectors), assistant left-aligned with avatar, user right-aligned
          in a 640px bubble. We keep flex so existing behavior is preserved;
          the mockup CSS targets [data-message-role=...]. */}
      <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
        {/* Message content */}
        <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
          {/* User message bubble - uses user's accent color */}
          {isUser && (
            <div className="inline-block max-w-prose">
              {isEditing ? (
                <div className="flex items-end gap-2">
                  <textarea
                    value={editContent}
                    onChange={(e) => onEditChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Edit message content"
                    className="flex-1 px-4 py-2 rounded-input border-2 border-rule-strong bg-surface text-fg shadow-hard-xs resize-none focus:outline-none focus:border-accent"
                    style={{ minHeight: '44px' }}
                    autoFocus
                  />
                  <button
                    onClick={() => onEditSubmit(message.id)}
                    aria-label="Submit edited message"
                    className="p-2 rounded-full hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)] transition-colors"
                    style={{ color: 'var(--user-accent-primary, var(--cm-accent))' }}
                  >
                    <Send size={16} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="group relative inline-block">
                  {/* Attached file thumbnails - shown above message */}
                  {message.attachedImages && message.attachedImages.length > 0 && (
                    <div className="flex gap-2 justify-end mb-2">
                      {message.attachedImages.map((file, idx) => (
                        <AttachedFileThumbnail
                          key={`${file.name}-${idx}`}
                          name={file.name}
                          data={file.data}
                          mimeType={file.mimeType}
                        />
                      ))}
                    </div>
                  )}
                  <div
                    className="rounded-none border-2 border-rule-strong bg-surface text-fg shadow-hard-sm px-4 py-3 text-left"
                    data-testid="user-message-bubble"
                    style={{
                      // Editorial typography — mirror codemode .cm-markdown.
                      // Inter first, tighter letter-spacing, full font-feature
                      // set for single-story 'a' + ligatures + tabular nums.
                      fontFamily: 'var(--font-body)',
                      fontSize: 15,
                      lineHeight: 1.6,
                      letterSpacing: '-0.005em',
                      fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1, "tnum" 1, "cv11" 1',
                      WebkitFontSmoothing: 'antialiased',
                      textRendering: 'optimizeLegibility',
                      // Wider than the old 640 — user asked for ~800 so the
                      // chat feels closer to codemode's breathing room and
                      // long paragraphs don't wrap awkwardly.
                      // 2026-04-24: now uses the shared transcript token so
                      // user bubble width matches codemode's transcript.
                      maxWidth: 'var(--transcript-max-width)',
                      display: 'inline-block',
                    }}
                  >
                    {message.content}
                  </div>
                  {/* Mockup 03 pattern — meta-row under user bubble:
                      `HH:MM · YYYY-MM-DD`. Keeps the bubble clean and
                      gives the user-identity + time context the mockup
                      shows for security/audit trails. */}
                  {message.timestamp && (
                    <div
                      data-testid="user-message-meta"
                      style={{
                        marginTop: 4,
                        fontSize: 10,
                        color: 'var(--fg-3, var(--cm-text-muted))',
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'right',
                      }}
                    >
                      {(() => {
                        const d = new Date(message.timestamp);
                        const hh = String(d.getHours()).padStart(2, '0');
                        const mm = String(d.getMinutes()).padStart(2, '0');
                        const yyyy = d.getFullYear();
                        const mo = String(d.getMonth() + 1).padStart(2, '0');
                        const dd = String(d.getDate()).padStart(2, '0');
                        return `${hh}:${mm} · ${yyyy}-${mo}-${dd}`;
                      })()}
                    </div>
                  )}
                  {/* Edit button - shows on hover */}
                  <button
                    onClick={() => onEditStart(message)}
                    aria-label="Edit message and resubmit"
                    className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)]"
                    style={{ color: 'var(--color-text-secondary)' }}
                    title="Edit message (resubmit)"
                  >
                    <Edit2 size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Assistant message — mock 01:184-214 cm-msg-asst 2-col grid.
              col-1: 28x28 cm-avatar gradient. col-2: cm-msg-body holds the
              MessageHeader (noAvatar) + activity stream + content. The
              `group` class survives so the existing hover-edit affordance
              keeps working. */}
          {isAssistant && (
            <div className="cm-v2 cm-msg-asst group" data-testid="assistant-row">
              {/* 2026-05-07 — when streaming, swap the static purple-gradient
                  avatar square for the animated ThinkingSphere. When the
                  stream completes (`isStreaming` flips false), we render
                  the static avatar back, so the sphere disappears at end
                  of turn — exactly what the user asked for: "the sphere
                  should be where the square is and disappear when
                  thinking/request is done." */}
              {isStreaming ? (
                <div
                  className="cm-avatar cm-av-asst"
                  aria-hidden
                  style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  data-testid="assistant-thinking-sphere"
                >
                  <ThinkingSphere state="thinking" size={28} />
                </div>
              ) : (
                /*
                 * Done state — small static accent-coloured orb that
                 * replaces the prior solid blue square. Pure CSS radial
                 * gradient + one glossy highlight, theme-token-driven via
                 * --accent / --accent-line so it tracks the user's accent
                 * picker.
                 */
                <div
                  className="cm-avatar cm-av-asst"
                  aria-hidden
                  data-testid="assistant-static-orb"
                  style={{ background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <div
                    style={{
                      position: 'relative',
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      // Decorative 3D orb: the accent darkened toward black /
                      // lightened toward white is sphere shading math, not a
                      // theme surface — black/white are the legit shade endpoints.
                      background:
                        'radial-gradient(circle at 32% 30%, var(--accent, var(--cm-accent)) 0%, color-mix(in srgb, var(--accent, var(--cm-accent)) 65%, black) 80%, color-mix(in srgb, var(--accent, var(--cm-accent)) 40%, black) 100%)',
                      boxShadow:
                        '0 0 0 1px var(--accent-line, color-mix(in srgb, var(--cm-accent) 32%, transparent)), 0 1px 6px color-mix(in srgb, var(--accent, var(--cm-accent)) 35%, transparent)',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: 4,
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: 'color-mix(in srgb, var(--cm-accent) 30%, white)',
                        filter: 'blur(0.5px)',
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="cm-msg-body space-y-2">
              {/* LiveTurnStatus — codemode-style strip rendered DIRECTLY to the
                  right of the spinning ThinkingSphere during streaming. Shows
                  ↑in · ↓out tokens · elapsed · TTFT · activity summary. */}
              {isStreaming && turnStartedAt != null && (
                <div data-testid="live-turn-status-row" style={{ marginTop: '4px' }}>
                  <LiveTurnStatus
                    turnStartedAt={turnStartedAt}
                    firstTokenAt={ttftMs != null ? turnStartedAt + ttftMs : null}
                    tokensIn={liveTokensIn ?? 0}
                    tokensOut={liveTokensOut ?? 0}
                    activitySummary={liveActivity ?? 'thinking'}
                    isStreaming={isStreaming}
                  />
                </div>
              )}
              {showModelBadges && (
                <div data-testid="assistant-meta-row">
                  <MessageHeader
                    name="Assistant"
                    variant="asst"
                    modelTag={
                      message.modelTag
                        ?? splitModelIdentifier(message.model)?.tag
                        ?? undefined
                    }
                    modelId={
                      message.modelId
                        ?? (splitModelIdentifier(message.model)?.id || undefined)
                    }
                    timestamp={
                      message.timestamp
                        ? new Date(message.timestamp).toLocaleTimeString([], {
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : undefined
                    }
                    noAvatar
                  />
                </div>
              )}
              {/* Unified Activity Tree — enhanced thinking/tool/agent display (additive, not replacement) */}
              {normalizedEvents && normalizedEvents.length > 0 && (
                <UnifiedActivityTree
                  events={normalizedEvents}
                  isStreaming={isStreaming}
                  theme={theme === 'dark' ? 'dark' : 'light'}
                />
              )}
              {/* Activity stream for streaming content, tool calls, and artifact rendering */}
              {(hasSteps || (isStreaming && streamingContentBlocks && streamingContentBlocks.length > 0)) && (
                  <ArtifactErrorBoundary fallbackContent={message.content || ''}>
                  {(() => {
                    // #646 Option B — resolve which SubAgentEntry list to thread
                    // into AgenticActivityStream. Prefer the per-message scoped
                    // map (so completed sub-agents stay glued to their own
                    // turn). Fall back to the flat `subAgents` array only when
                    // this is the in-flight streaming message (matches the
                    // ChatMessages trailing-strip resolution at lines 502-509
                    // before the strip was ripped). Any null/empty path passes
                    // an empty array so AgenticActivityStream's default kicks in.
                    const scoped = subAgentsByMessageId?.[message.id];
                    const aasSubAgents: SubAgentEntry[] =
                      scoped && scoped.length > 0
                        ? scoped
                        : isStreaming && subAgents
                          ? subAgents
                          : [];
                    return (
                  <AgenticActivityStream
                    isStreaming={isStreaming}
                    streamingState={activityStreamData.streamingState}
                    subAgents={aasSubAgents}
                    hitlApprovals={hitlApprovals}
                    onApproveHitl={onApproveHitl}
                    onDenyHitl={onDenyHitl}
                    streamingTables={streamingTables}
                    contentBlocks={
                      // Phase 6 (2026-05-22) — StreamEngine deleted. AAS owns
                      // ALL block types during the live stream via the React
                      // path. The dual-painter split (engine paints simple +
                      // AAS paints artifacts) is gone; AAS handles the full
                      // chronology, and on finalize falls through to the
                      // persisted `finalContentBlocks`.
                      streamingContentBlocks && streamingContentBlocks.length > 0
                          ? streamingContentBlocks.map(block => ({
                              id: `stream-${block.index}`,
                              // Wire-in D (#82) — preserve tool_round so the
                              // parallel-group renderer can pick it up. All
                              // other tool_use blocks still normalize to the
                              // legacy 'tool_call' type.
                              type: block.type === 'tool_use'
                                ? 'tool_call'
                                : block.type,
                              timestamp: block.timestamp ?? Date.now(),
                              content: block.content,
                              isComplete: block.isComplete,
                              toolId: block.toolId,
                              toolName: block.toolName,
                              agentId: block.agentId,
                              parentToolId: block.parentToolId,
                              agentRole: block.agentRole,
                              // v0.6.7 task #159 — thread startTime/duration so
                              // InlineThinkingBlock can derive startedAt/endedAt
                              // and ToolCallCard can render live elapsed timers.
                              startTime: (block as any).startTime,
                              duration: (block as any).duration,
                              // E1.5 (2026-05-12) — propagate the structured
                              // input/result objects through to ToolCallGroup
                              // / ToolCard so the JSON view renders without
                              // a parse round-trip (avoids escape soup).
                              input: (block as any).input,
                              result: (block as any).resultRaw ?? (block as any).result,
                              metadata: block.toolName ? { toolName: block.toolName } : undefined,
                              // Wire-in D (#82) — thread tool_round container
                              // fields straight through to the adapter layer.
                              roundId: block.roundId,
                              toolIds: block.toolIds,
                              children: block.children as any,
                              durationMs: block.durationMs,
                              succeeded: block.succeeded,
                              failed: block.failed,
                              // #919 F1-6 — propagate follow_up chip items.
                              items: (block as any).items,
                              // 2026-05-19 — app_render / viz_render render-critical
                              // fields. The InlineAppBadge → AppRenderer chain
                              // reads `block.html` to mount the iframe; without
                              // it AppRenderer's empty-html guard returns null
                              // and the user sees an empty "Mini app" stub.
                              // Same for `viz_render` block.kind discriminator.
                              title: (block as any).title,
                              html: (block as any).html,
                              nonce: (block as any).nonce,
                              pyodideRequired: (block as any).pyodideRequired,
                              kind: (block as any).kind,
                              groupId: (block as any).groupId,
                              // generate_image — image_render block fields.
                              // AAS reads block.imageUrl to mount the inline
                              // <img>. imageUrl is always same-origin (the
                              // tool + reducer reject external hosts).
                              imageUrl: (block as any).imageUrl,
                              prompt: (block as any).prompt,
                              model: (block as any).model,
                              provider: (block as any).provider,
                            }))
                          : finalContentBlocks
                    }
                    tasks={activityStreamData.tasks}
                    toolCalls={activityStreamData.toolCalls}
                    theme={theme}
                    thinkingProgress={isStreaming ? thinkingProgress : undefined}
                    onInterrupt={onInterrupt}
                  />
                    );
                  })()}
                  {/* Phase 6 (2026-05-22) — StreamEngine handoff mount
                      DELETED. AAS above handles the full chronology
                      during the live stream via the React path. */}
                  </ArtifactErrorBoundary>
              )}

              {/* #781 Phase D — new-pipeline artifact launchers (visualizations[]
                  or tool_result._meta.artifactKind). Render as compact buttons
                  above the message content; clicking opens ArtifactSlideOut.
                  #971 follow-up (Sev-1, 2026-05-20) — short-circuit when AAS
                  has already inline-mounted the corresponding viz_render /
                  app_render blocks. Same source data, otherwise rendered
                  twice (inline iframe via InlineVizBadge/InlineAppBadge +
                  launcher chip here). Legacy/fallback path preserved when
                  AAS does NOT inline-mount. */}
              {(() => {
                if (activityStreamHasInlineArtifacts) return null;
                const artifacts = extractArtifacts(message);
                if (artifacts.length === 0) return null;
                return (
                  <div
                    data-testid="artifact-launcher-list"
                    style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}
                  >
                    {artifacts.map((a) => (
                      <ArtifactSlideOutLauncher
                        key={a.id}
                        kind={a.kind}
                        title={a.title}
                        payload={a.payload}
                        status={a.status}
                      />
                    ))}
                  </div>
                );
              })()}

              {/* Message content - EnhancedMessageContent for finished messages (has Shiki, proper tables) */}
              {/* Suppressed when: (a) streaming with content blocks, or (b) activity stream has text blocks (completed interleaved view).
                  #966 (2026-05-20) — DROPPED the hasArtifactContent carve-out. AAS is authoritative for inline artifacts (image://, artifact:html, <html, <!DOCTYPE) via InlineVizBadge / InlineAppBadge / SharedMarkdownRenderer. Rendering EnhancedMessageContent in addition produced a literal double-render of the entire assistant body. */}
              {message.content && !(isStreaming && streamingContentBlocks && streamingContentBlocks.length > 0) && !activityStreamHasText && (
                <ArtifactErrorBoundary fallbackContent={message.content}>
                  <div className="max-w-none">
                    <EnhancedMessageContent
                      message={message}
                      // 2026-05-18 PM — strip grounding verdict line + the
                      // <grounding-sources> JSON block from the prose so
                      // neither leaks into the rendered body. The chip
                      // below renders them in their proper UI form.
                      content={
                        message.role === 'assistant'
                          ? stripGroundingArtifacts(message.content)
                          : message.content
                      }
                      theme={theme}
                      showModelBadges={false}
                      onExpandToCanvas={onExpandToCanvas}
                      onExecuteCode={onExecuteCode}
                      isStreaming={isStreaming}
                    />
                  </div>
                </ArtifactErrorBoundary>
              )}

              {/* #940 P1 (2026-05-18) — grounding T1 verdict chip.
                  When the user toggled the chat-input-toolbar SearchCheck
                  pill ON for this turn, the system-prompt addendum (set in
                  runChat.ts) instructed the model to verify factual claims
                  via the existing web_search MCP tool and end its final
                  text with a canonical "Grounding: ..." verdict line.
                  InlineGroundingChip parses message.content for that line
                  and renders an inline chip with the verdict + source
                  count. Renders nothing when the line isn't present
                  (grounding off, or model didn't comply). Chip only on
                  assistant role + non-streaming final state. */}
              {message.role === 'assistant' && !isStreaming && (
                <InlineGroundingChip assistantText={message.content} />
              )}

              {/* Feedback row - Claude.ai style actions */}
              {message.content && (
                <FeedbackRow
                  content={message.content}
                  messageId={message.id}
                  isStreaming={isStreaming}
                  onThumbsUp={onThumbsUp}
                  onThumbsDown={onThumbsDown}
                  onCopy={() => onCopy?.(message.id)}
                />
              )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </MessageErrorBoundary>
  );
}, memoComparator);

export default MessageBubble;
