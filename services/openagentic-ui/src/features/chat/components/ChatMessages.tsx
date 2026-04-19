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
import { COTStep } from './ChainOfThoughtDisplay';
import StreamErrorBoundary from '@/shared/components/StreamErrorBoundary';
import MessageBubble from './MessageBubble';
import { type AgentState } from './UnifiedAgentActivity';
import { ContentBlock } from '../hooks/useChatStream';
import { StarterPrompts, type StarterPrompt } from './StarterPrompts';
import { ThinkingSphere, type ThinkingSphereState } from '@/shared/components/ThinkingSphere';
import type { ThinkingProgress } from './AgenticActivityStream/types/activity.types';
import type { NormalizedStreamEvent } from '../../../types/NormalizedStreamTypes';
import ToolApprovalPopup from './ToolApprovalPopup';
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
  thinkingProgress?: ThinkingProgress;  // Thinking progress for real progress indicator
  normalizedEvents?: NormalizedStreamEvent[];  // Normalized stream events for UnifiedActivityTree
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
  thinkingProgress,  // Thinking progress for real progress indicator
  normalizedEvents,  // Normalized stream events for UnifiedActivityTree
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
  // is still populated by useSSEChat from legacy SSE events because
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
        className="w-full max-w-full px-2 sm:px-4 md:px-6 lg:px-10 xl:px-12"
        style={{
          maxWidth: 'min(1800px, 98vw)',
          margin: '0 auto',
          boxSizing: 'border-box'
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

            return (
              <React.Fragment key={message.id}>
                <MessageBubble
                  message={message}
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
                  streamingContentBlocks={message.status === 'streaming' ? contentBlocks : undefined}
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
                 * the legacy event handlers in useSSEChat — we just stop
                 * rendering them as a separate tree here.
                 */}
              </React.Fragment>
            );
          })}

          {/* REMOVED: renderStreamingMessage() - now handled by MessageBubble */}

          {/* Live Agent Execution Trees — rendered INLINE after the last assistant message */}
          {/* NOT at bottom — appears right after the streaming message bubble */}

          {/* Persistent ThinkingSphere - Always visible while LLM is working */}
          {/* Shows throughout the entire streaming process with state-appropriate animations */}
          {(() => {
            // Determine ThinkingSphere state based on current activity
            let sphereState: ThinkingSphereState = 'hidden';

            if (isLoading) {
              // Always show when loading/streaming - this is the key change
              if (activeMcpCalls && activeMcpCalls.length > 0) {
                // Tool execution phase
                sphereState = 'processing';
              } else if (thinkingContent?.trim() || (contentBlocks && contentBlocks.some(b => b.type === 'thinking' && b.content?.trim()))) {
                // Active thinking
                sphereState = 'thinking';
              } else if (streamingContent?.trim() || (contentBlocks && contentBlocks.some(b => b.type === 'text' && b.content?.trim()))) {
                // Generating text response
                sphereState = 'generating';
              } else {
                // Initial connection / waiting for response
                sphereState = 'connecting';
              }
            }

            return (
              <div className="flex justify-center py-6">
                <ThinkingSphere state={sphereState} size={24} />
              </div>
            );
          })()}

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
