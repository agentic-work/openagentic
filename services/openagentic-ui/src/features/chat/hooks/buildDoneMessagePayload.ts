/**
 * Pure helper: build the final onMessage payload at `done` /
 * `stream_complete` time.
 *
 * Sev-0 #924 + #925 + #926: stream and finalized DOM must be byte-identical.
 *
 * The pre-fix `done` handler in useChatStream.ts filtered
 * contentBlocksRef.current to only `thinking | tool_use` blocks, dropping
 * every other type (text, viz_render, app_render, streaming_table,
 * follow_up, sub_agent, hitl_approval, tool_round, tool_result). The
 * dispatched onMessage payload also omitted `content_blocks`, so the
 * server persisted null and the UI rehydrated from a flat string + a
 * filtered thinkingSteps[] — losing the chronology that the live stream
 * showed.
 *
 * This helper PRESERVES every ContentBlock that the wire emitted, in
 * its original arrival order, and emits a `content_blocks` field on
 * the onMessage payload so:
 *   1. updateMessage / addMessage can carry the chronology onto the
 *      Message object in the chat store
 *   2. The server (chatLoop finalize → ChatStorageService.addMessage)
 *      persists it to `chat_messages.content_blocks` Json column
 *   3. On session reload, MessageBubble reads message.content_blocks
 *      and renders identical DOM to the live-stream state
 *
 * Contract: pure function. No React refs / state / side effects.
 */

import type { ContentBlock } from './useChatStream';
import {
  resolveEmptyCompletionFallback,
} from './useChatStream';
import {
  formatAgentMessage,
  addVisualEnhancements,
} from '@/utils/messageFormatter';

const THINKING_TAG_RE = /<thinking>([\s\S]*?)<\/thinking>/g;
const REASONING_TAG_RE = /<reasoning>([\s\S]*?)<\/reasoning>/g;
const TOOL_CODE_TAG_RE = /<tool_code>([\s\S]*?)<\/tool_code>/g;

function extractAndCleanThinking(content: string): { cleaned: string; thinking: string } {
  if (
    !content.includes('<thinking>') &&
    !content.includes('<reasoning>') &&
    !content.includes('<tool_code>')
  ) {
    return { cleaned: content, thinking: '' };
  }
  let cleaned = content;
  const parts: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = THINKING_TAG_RE.exec(content)) !== null) parts.push(m[1].trim());
  cleaned = cleaned.replace(THINKING_TAG_RE, '');

  while ((m = REASONING_TAG_RE.exec(content)) !== null) parts.push(m[1].trim());
  cleaned = cleaned.replace(REASONING_TAG_RE, '');

  while ((m = TOOL_CODE_TAG_RE.exec(content)) !== null) parts.push(m[1].trim());
  cleaned = cleaned.replace(TOOL_CODE_TAG_RE, '');

  cleaned = cleaned.trim().replace(/\n{3,}/g, '\n\n');
  return { cleaned, thinking: parts.join('\n\n---\n\n') };
}

export interface DoneMessagePayloadInputs {
  /** Full chronological content block sequence — every block emitted by the wire. */
  contentBlocks: ContentBlock[];
  /** Flat concatenation of text_delta frames (legacy back-compat field). */
  assistantMessage: string;
  /** Tool-call summary collected during the turn. */
  mcpCalls: any[];
  /** Optional CoT steps from cotStepsRef. */
  cotSteps: any[];
  /** Pre-extracted thinking content (if the caller already ran extractAndCleanThinkingBlocks). */
  extractedThinking?: string;
  /** Current thinking ref (fallback for thinking persistence). */
  currentThinking?: string;
  /** Message id used to namespace synthesized step ids and as the dispatched message.id. */
  messageId: string;
  /** Last `safeData` payload off the done frame — passes through to metadata. */
  safeData: Record<string, unknown>;
  /** Model identifier captured during the turn (badge display + attachModelIdentifier). */
  responseModel?: string;
  /** Pipeline state for metrics passthrough. */
  pipelineState: {
    stageTiming: Record<string, number>;
    activeToolRound: number;
  };
}

/**
 * Shape of the payload dispatched through onMessage on done. Matches the
 * ChatMessage / Message superset that useChatStore.addMessage / updateMessage
 * accept. The CRITICAL new field is `content_blocks`.
 */
export interface DoneMessagePayload {
  id: string;
  role: 'assistant';
  content: string;
  timestamp: string;
  mcpCalls?: any[];
  thinkingSteps?: any[];
  reasoningTrace?: string;
  toolCalls?: any[];
  toolResults?: any[];
  /**
   * Sev-0 #924 — the entire wire-emit chronology, every type, every
   * block. Persisted server-side as `chat_messages.content_blocks` Json
   * column; read on session reload by MessageBubble to render byte-
   * identical DOM to the live stream.
   */
  content_blocks?: ContentBlock[];
  metadata?: Record<string, unknown>;
}

function hasNonEmptyToolUse(blocks: ContentBlock[]): boolean {
  return blocks.some((b) => b.type === 'tool_use' && (b.toolName || b.content));
}

/**
 * Build the final onMessage payload. Returns null when there is genuinely
 * nothing to render (empty assistant prose, no tool calls, no blocks).
 */
export function buildDoneMessagePayload(
  inputs: DoneMessagePayloadInputs,
): DoneMessagePayload | null {
  const {
    contentBlocks,
    assistantMessage,
    mcpCalls,
    cotSteps,
    extractedThinking,
    currentThinking,
    messageId,
    safeData,
    pipelineState,
  } = inputs;

  // Reuse the existing empty-completion gate. shouldRender:false → null,
  // matching the prior behavior (the `done` handler skipped onMessage entirely).
  const resolution = resolveEmptyCompletionFallback({
    assistantMessage: assistantMessage || '',
    mcpCallsLength: mcpCalls.length,
    hasToolUseBlocks: hasNonEmptyToolUse(contentBlocks),
  });

  if (!resolution.shouldRender) return null;

  // Defense in depth — if literally nothing is here, return null so the
  // caller doesn't dispatch a zero-information assistant bubble.
  if (
    !resolution.content &&
    contentBlocks.length === 0 &&
    mcpCalls.length === 0 &&
    cotSteps.length === 0 &&
    !extractedThinking &&
    !currentThinking
  ) {
    return null;
  }

  // Clean any inline <thinking> tags out of the flat assistant text
  // (the canonical thinking lives in dedicated thinking ContentBlocks now).
  const { cleaned, thinking: inlineThinking } = extractAndCleanThinking(
    resolution.content || '',
  );

  const formattedContent = cleaned
    ? addVisualEnhancements(formatAgentMessage(cleaned))
    : '';

  // Thinking-for-persistence resolution order:
  //   1. caller-supplied extractedThinking (pre-computed)
  //   2. currentThinkingRef snapshot (caller passes it in)
  //   3. inline thinking pulled from the assistantMessage text
  //   4. concatenated text from thinking-type ContentBlocks
  const thinkingBlocks = contentBlocks.filter(
    (b) => b.type === 'thinking' && b.content,
  );
  const thinkingFromBlocks = thinkingBlocks
    .map((b) => b.content)
    .join('\n\n---\n\n');
  const thinkingToSave =
    extractedThinking || currentThinking || inlineThinking || thinkingFromBlocks || '';

  // Interleaved steps: every block in chronological order. Thinking blocks
  // map to {type:'thinking', title:'Reasoning'}. Tool-use blocks map to
  // {type:'mcp', title:<toolName>, details:{args, result}}. Other block
  // types (text, viz_render, app_render, follow_up, sub_agent, hitl_approval,
  // tool_round, tool_result) are NOT mapped to thinkingSteps[] — they are
  // first-class entries in `content_blocks` and the renderer consumes them
  // directly. (Pre-fix, every non-thinking/non-tool_use block was dropped
  // entirely. Now they survive on the `content_blocks` field.)
  let finalThinkingSteps: any[] | undefined;
  const interleavedSteps: any[] = [];
  contentBlocks.forEach((block, idx) => {
    if (block.type === 'thinking') {
      interleavedSteps.push({
        id: block.id || `thinking-block-${idx}`,
        type: 'thinking' as const,
        title: 'Reasoning',
        content: block.content,
        status: 'completed',
      });
    } else if (block.type === 'tool_use') {
      let argsParsed: any;
      try {
        argsParsed = block.content ? JSON.parse(block.content) : undefined;
      } catch {
        argsParsed = block.content;
      }
      let resultParsed: any;
      try {
        resultParsed = (block as any).result
          ? typeof (block as any).result === 'string'
            ? JSON.parse((block as any).result)
            : (block as any).result
          : undefined;
      } catch {
        resultParsed = (block as any).result;
      }
      interleavedSteps.push({
        id: block.id || `tool-block-${idx}`,
        type: 'mcp' as const,
        title: block.toolName || 'Tool',
        content: block.toolName || '',
        status: (block as any).error ? 'error' : 'completed',
        toolId: block.toolId,
        duration: (block as any).duration,
        details: {
          args: argsParsed,
          result: resultParsed,
        },
      });
    }
    // Other block types intentionally NOT pushed here — they render via
    // the content_blocks chronology.
  });

  const cotStepsCopy = cotSteps.length > 0 ? JSON.parse(JSON.stringify(cotSteps)) : [];
  if (interleavedSteps.length > 0 || cotStepsCopy.length > 0) {
    finalThinkingSteps = [...interleavedSteps, ...cotStepsCopy];
  }

  const finalToolCalls = (safeData as any)?.toolCalls || undefined;
  const finalToolResults = (safeData as any)?.toolResults || undefined;

  // Deep-clone the content blocks so downstream consumers (chat store
  // immer slices) can't accidentally mutate the live stream's blocks.
  // Use structuredClone when available, JSON-clone otherwise.
  const clonedBlocks: ContentBlock[] =
    typeof structuredClone === 'function'
      ? (structuredClone(contentBlocks) as ContentBlock[])
      : (JSON.parse(JSON.stringify(contentBlocks)) as ContentBlock[]);

  const payload: DoneMessagePayload = {
    id: messageId,
    role: 'assistant',
    content: formattedContent,
    timestamp: new Date().toISOString(),
    mcpCalls: mcpCalls.length > 0 ? mcpCalls : undefined,
    thinkingSteps: finalThinkingSteps,
    reasoningTrace: thinkingToSave || undefined,
    toolCalls: finalToolCalls,
    toolResults: finalToolResults,
    // Sev-0 #924 — full chronology, every type, in wire-emit order.
    content_blocks: clonedBlocks.length > 0 ? clonedBlocks : undefined,
    metadata: {
      ...JSON.parse(JSON.stringify(safeData ?? {})),
      thinkingContent: thinkingToSave || undefined,
      thinkingBlocks: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
      mcpCalls: mcpCalls.length > 0 ? mcpCalls : undefined,
      pipelineMetrics: {
        stageTiming: pipelineState.stageTiming,
        toolRounds: pipelineState.activeToolRound,
      },
    },
  };

  return payload;
}
