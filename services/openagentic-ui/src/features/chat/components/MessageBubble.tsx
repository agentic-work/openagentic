/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * MessageBubble - Memoized message rendering component
 * Wrapped with React.memo to prevent unnecessary re-renders
 * when other messages in the list change or streaming content updates.
 */

import React, { memo, useCallback, useMemo, useState, Component, ErrorInfo, ReactNode } from 'react';
import { Edit2, Send, FileText, Image as ImageIcon, AlertTriangle, Copy, Check, ThumbsUp, ThumbsDown, RotateCcw } from '@/shared/icons';
import { ChatMessage } from '@/types/index';
import EnhancedMessageContent from './MessageContent/EnhancedMessageContent';
import InlineModelBadge from './InlineModelBadge';
import { ArtifactErrorBoundary } from '@/shared/components';
// InlineStep type now in activity.types.ts
import type { InlineStep, ThinkingProgress } from './AgenticActivityStream/types/activity.types';
import { AgenticActivityStream, useInlineStepsAdapter } from './AgenticActivityStream';
import { UnifiedActivityTree } from './UnifiedActivityTree';
import type { NormalizedStreamEvent } from '../../../types/NormalizedStreamTypes';

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
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg m-2">
          <div className="flex items-center gap-2 text-red-400 mb-2">
            <AlertTriangle size={16} />
            <span className="font-medium">Message Render Error (ID: {this.props.messageId})</span>
          </div>
          <pre className="text-xs text-red-300 whitespace-pre-wrap break-all">
            {this.state.error?.message}
          </pre>
          <details className="mt-2">
            <summary className="text-xs text-red-400 cursor-pointer">Stack Trace</summary>
            <pre className="text-[10px] text-red-300/70 mt-1 overflow-auto max-h-32">
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
        <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/20 bg-black/20">
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="w-16 h-16 rounded-lg border border-white/20 bg-black/20 flex items-center justify-center">
          {isPdf ? (
            <FileText size={24} className="text-white/70" />
          ) : (
            <ImageIcon size={24} className="text-white/70" />
          )}
        </div>
      )}
      {/* File name tooltip on hover */}
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
        <div className="bg-black/80 text-white text-xs px-2 py-1 rounded whitespace-nowrap max-w-[150px] truncate">
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
        className="hover:bg-white/5 hover:text-[var(--color-text-secondary)]"
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        aria-label={copied ? 'Copied to clipboard' : 'Copy message content'}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>

      {/* Thumbs up */}
      <button
        onClick={handleThumbsUp}
        style={feedback === 'up' ? activeStyle : buttonStyle}
        className="hover:bg-white/5 hover:text-[var(--color-text-secondary)]"
        title="Good response"
        aria-label="Rate as good response"
      >
        <ThumbsUp size={14} />
      </button>

      {/* Thumbs down */}
      <button
        onClick={handleThumbsDown}
        style={feedback === 'down' ? activeStyle : buttonStyle}
        className="hover:bg-white/5 hover:text-[var(--color-text-secondary)]"
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
          className="hover:bg-white/5 hover:text-[var(--color-text-secondary)]"
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

// Streaming ContentBlock type (from useSSEChat)
interface StreamingContentBlock {
  index: number;
  type: 'thinking' | 'text' | 'tool_use';
  content: string;
  isComplete: boolean;
  toolName?: string;
  toolId?: string;
  agentId?: string;
  parentToolId?: string;
  agentRole?: string;
  timestamp?: number;
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
  const argsRaw = toolCall.function?.arguments || toolCall.arguments;
  let args = argsRaw;

  // Parse arguments if they're a string
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      // Keep as string if parsing fails
    }
  }

  const hasResult = toolResult !== undefined;

  // Detect if the result contains an error
  const hasError = detectErrorInResult(toolResult);

  // Get result summary
  let summary = '';
  if (hasResult && toolResult) {
    if (typeof toolResult === 'string') {
      summary = toolResult.substring(0, 100) + (toolResult.length > 100 ? '...' : '');
    } else if (toolResult.content?.[0]?.text) {
      const text = toolResult.content[0].text;
      summary = text.substring(0, 100) + (text.length > 100 ? '...' : '');
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
    id: `tool-${index}-${toolCall.id || Date.now()}`,
    type: getStepType(toolName),
    title: toolName,
    summary: hasResult ? summary : undefined,
    status,
    model,
    details: {
      args,
      result: toolResult,
      command: getStepType(toolName) === 'bash' ? (args?.command || args?.script) : undefined,
      output: toolResult?.content?.[0]?.text || (typeof toolResult === 'string' ? toolResult : undefined),
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
          // Tool/MCP step — only add if not already present from mcpCalls/toolCalls
          const stepId = `interleaved-tool-${message.id}-${idx}`;
          if (!existingToolIds.has(step.id) && !existingToolIds.has(stepId)) {
            interleavedSteps.push({
              id: stepId,
              type: step.type || 'mcp',
              title: String(step.title || step.content || 'Tool'),
              status: 'completed',
              model: messageModel,
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
  const hasSteps = steps.length > 0 || (showThinkingInline && isStreaming && thinkingContent);

  // Convert steps to AgenticActivityStream format when enabled
  const activityStreamData = useInlineStepsAdapter({
    steps,
    currentThinking: isStreaming && showThinkingInline ? thinkingContent : undefined,
    isStreaming,
    currentModel: message.model,
  });

  // For completed messages with steps, add text content to activity stream
  // so the interleaved thinking/tools/text layout persists after streaming ends
  const finalContentBlocks = useMemo(() => {
    if (!isStreaming && message.content && hasSteps && activityStreamData.contentBlocks.length > 0) {
      const blocks = [...activityStreamData.contentBlocks];
      // Strip thinking/reasoning tags from content before adding as text block
      let textContent = message.content;
      if (typeof textContent === 'string') {
        textContent = textContent.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
        textContent = textContent.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');
        textContent = textContent.replace(/<tool_code>[\s\S]*?<\/tool_code>/g, '');
        textContent = textContent.trim();
      }
      // Skip adding artifact content as a text block — it renders via EnhancedMessageContent instead
      const isArtifactContent = textContent && (
        textContent.includes('```artifact:') ||
        textContent.includes('```html') ||
        textContent.includes('<!DOCTYPE') ||
        textContent.includes('<html')
      );
      if (textContent && !isArtifactContent) {
        blocks.push({
          id: `text-${message.id}`,
          type: 'text' as const,
          content: textContent,
          timestamp: Date.now(),
          isComplete: true,
        });
      }
      return blocks;
    }
    return activityStreamData.contentBlocks;
  }, [isStreaming, message.content, message.id, hasSteps, activityStreamData.contentBlocks]);

  // Whether the activity stream includes text content (completed messages with interleaved blocks)
  const activityStreamHasText = finalContentBlocks.some(b => b.type === 'text');

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

  // Detect artifact content that MUST render through EnhancedMessageContent (artifact:html, raw HTML docs)
  const hasArtifactContent = !!(message.content && typeof message.content === 'string' && (
    message.content.includes('```artifact:') ||
    message.content.includes('```html') ||
    message.content.includes('<!DOCTYPE') ||
    message.content.includes('<html')
  ));

  return (
    <MessageErrorBoundary messageId={message.id}>
    <div
      data-message-id={message.id}
      data-message-role={message.role}
      className="w-full"
      style={{ willChange: 'contents' }}
    >
      {/* Message container */}
      <div className={`flex gap-4 p-4 ${isUser ? 'justify-end' : 'justify-center'}`}>
        {/* Message content */}
        <div className={`flex-1 w-full ${isUser ? 'text-right' : ''}`}>
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
                    className="flex-1 px-4 py-2 rounded-2xl resize-none"
                    style={{
                      background: 'var(--user-accent-primary, rgb(124, 58, 237))',
                      color: 'white',
                      border: '2px solid rgba(255, 255, 255, 0.3)',
                      minHeight: '44px'
                    }}
                    autoFocus
                  />
                  <button
                    onClick={() => onEditSubmit(message.id)}
                    aria-label="Submit edited message"
                    className="p-2 rounded-full hover:bg-white/10 transition-colors"
                    style={{ color: 'var(--user-accent-primary, rgb(124, 58, 237))' }}
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
                    className="text-white rounded-2xl px-4 py-2"
                    style={{
                      background: 'var(--user-accent-primary, rgb(124, 58, 237))'
                    }}
                  >
                    {message.content}
                  </div>
                  {/* Edit button - shows on hover */}
                  <button
                    onClick={() => onEditStart(message)}
                    aria-label="Edit message and resubmit"
                    className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-white/10"
                    style={{ color: 'var(--color-text-secondary)' }}
                    title="Edit message (resubmit)"
                  >
                    <Edit2 size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Assistant message */}
          {isAssistant && (
            <div className="group space-y-2">
              {/* Model badge — always visible for assistant messages, regardless of renderer */}
              {showModelBadges && message.model && !isStreaming && (
                <div className="flex items-center gap-2 mb-1">
                  <InlineModelBadge model={message.model} theme={theme} />
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
                  <AgenticActivityStream
                    isStreaming={isStreaming}
                    streamingState={activityStreamData.streamingState}
                    contentBlocks={isStreaming && streamingContentBlocks && streamingContentBlocks.length > 0
                      ? streamingContentBlocks.map(block => ({
                          id: `stream-${block.index}`,
                          type: block.type === 'tool_use' ? 'tool_call' : block.type,
                          timestamp: Date.now(),
                          content: block.content,
                          isComplete: block.isComplete,
                          toolId: block.toolId,
                          toolName: block.toolName,
                          agentId: block.agentId,
                          parentToolId: block.parentToolId,
                          agentRole: block.agentRole,
                          metadata: block.toolName ? { toolName: block.toolName } : undefined,
                        }))
                      : finalContentBlocks}
                    tasks={activityStreamData.tasks}
                    toolCalls={activityStreamData.toolCalls}
                    theme={theme}
                    thinkingProgress={isStreaming ? thinkingProgress : undefined}
                    onInterrupt={onInterrupt}
                  />
                  </ArtifactErrorBoundary>
              )}

              {/* Message content - EnhancedMessageContent for finished messages (has Shiki, proper tables) */}
              {/* Suppressed when: (a) streaming with content blocks, or (b) activity stream has text blocks (completed interleaved view) */}
              {/* Exception: artifact content MUST always render through EnhancedMessageContent for proper artifact:html handling */}
              {message.content && !(isStreaming && streamingContentBlocks && streamingContentBlocks.length > 0) && (!activityStreamHasText || hasArtifactContent) && (
                <ArtifactErrorBoundary fallbackContent={message.content}>
                  <div className="max-w-none">
                    <EnhancedMessageContent
                      message={message}
                      content={message.content}
                      theme={theme}
                      showModelBadges={false}
                      onExpandToCanvas={onExpandToCanvas}
                      onExecuteCode={onExecuteCode}
                      isStreaming={isStreaming}
                    />
                  </div>
                </ArtifactErrorBoundary>
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
          )}
        </div>
      </div>
    </div>
    </MessageErrorBoundary>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for optimal memoization
  // Return true if props are equal (no re-render needed)

  // Always re-render if the message itself changed
  if (prevProps.message !== nextProps.message) {
    // Deep check relevant message properties
    if (
      prevProps.message.id !== nextProps.message.id ||
      prevProps.message.content !== nextProps.message.content ||
      prevProps.message.status !== nextProps.message.status ||
      prevProps.message.role !== nextProps.message.role ||
      prevProps.message.mcpCalls !== nextProps.message.mcpCalls ||
      prevProps.message.toolCalls !== nextProps.message.toolCalls ||
      prevProps.message.toolResults !== nextProps.message.toolResults ||
      prevProps.message.thinkingSteps !== nextProps.message.thinkingSteps ||
      prevProps.message.reasoningTrace !== nextProps.message.reasoningTrace ||
      prevProps.message.model !== nextProps.message.model ||
      prevProps.message.attachedImages !== nextProps.message.attachedImages
    ) {
      return false;
    }
  }

  // Re-render if editing state changed for this message
  if (prevProps.isEditing !== nextProps.isEditing) {
    return false;
  }

  // Re-render if edit content changed while editing
  if (nextProps.isEditing && prevProps.editContent !== nextProps.editContent) {
    return false;
  }

  // Re-render if theme changed
  if (prevProps.theme !== nextProps.theme) {
    return false;
  }

  // Re-render if thinking content changed for streaming messages
  if (
    nextProps.message.status === 'streaming' &&
    prevProps.thinkingContent !== nextProps.thinkingContent
  ) {
    return false;
  }

  // Re-render if active MCP calls changed
  if (prevProps.activeMcpCalls !== nextProps.activeMcpCalls) {
    return false;
  }

  // Re-render if display options changed
  if (
    prevProps.showMCPIndicators !== nextProps.showMCPIndicators ||
    prevProps.showModelBadges !== nextProps.showModelBadges ||
    prevProps.showThinkingInline !== nextProps.showThinkingInline
  ) {
    return false;
  }

  // Re-render if turn info changed
  if (prevProps.turnInfo !== nextProps.turnInfo) {
    return false;
  }

  // Re-render if aggregated messages changed
  if (prevProps.aggregatedMessages !== nextProps.aggregatedMessages) {
    return false;
  }

  // Re-render if streaming content blocks changed (for live interleaved thinking display)
  if (prevProps.streamingContentBlocks !== nextProps.streamingContentBlocks) {
    // Check if content actually changed (not just array reference)
    const prevBlocks = prevProps.streamingContentBlocks || [];
    const nextBlocks = nextProps.streamingContentBlocks || [];
    if (prevBlocks.length !== nextBlocks.length) {
      return false;
    }
    // Check if any block content changed
    for (let i = 0; i < nextBlocks.length; i++) {
      if (prevBlocks[i]?.content !== nextBlocks[i]?.content ||
          prevBlocks[i]?.type !== nextBlocks[i]?.type) {
        return false;
      }
    }
  }

  // Re-render if normalized events changed (UNIFIED_STREAM path)
  if (prevProps.normalizedEvents !== nextProps.normalizedEvents) {
    const prevLen = prevProps.normalizedEvents?.length ?? 0;
    const nextLen = nextProps.normalizedEvents?.length ?? 0;
    if (prevLen !== nextLen) {
      return false;
    }
  }

  // Props are equal, no re-render needed
  return true;
});

export default MessageBubble;
