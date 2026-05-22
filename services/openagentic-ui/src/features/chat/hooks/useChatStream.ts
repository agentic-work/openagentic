/**
 * useSSEChat Hook
 * Server-Sent Events (SSE) implementation for real-time chat streaming
 * Features: Message streaming, pipeline state tracking, error recovery, MCP tool handling
 * Pipeline stages: auth → validation → prompt → mcp → completion → response
 * Methods:
 * - sendMessage: Sends user message and initiates SSE stream
 * - stopStreaming: Aborts current stream
 * - resetError: Clears error state
 * Handles: Token usage tracking, thinking blocks, tool calls, message formatting
 * @see docs/chat/streaming-architecture.md
 */

import { useState, useCallback, useRef, useEffect, startTransition } from 'react';
// flushSync removed - React 18 batching is sufficient for streaming updates
import { apiEndpoint } from '@/utils/api';
import type { NormalizedStreamEvent } from '../../../types/AnthropicStreamEvent';

import { formatAgentMessage, addVisualEnhancements } from '@/utils/messageFormatter';
import { useAuth } from '@/app/providers/AuthContext';
import { ChatMessage } from '@/types/index';
import { useChatStore } from '@/stores/useChatStore';
import { useAgentTreeStore } from '@/stores/useAgentTreeStore';
// Task #158 — in-browser Python/JS sandbox.
// The manager module is imported lazily inside the event handler so the
// ~6 MiB Pyodide wasm loader stays out of the initial chunk for users
// who never trigger a sandbox run.
import type {
  BrowserExecRequest,
  BrowserExecResult,
} from '../../../sandbox/types';

import {
  applyCanonicalFrame,
  initialFrameState,
  type FrameState,
  type WireFrame,
} from './streamReducer/applyCanonicalFrame';
// F1 (2026-05-18) — SDK SoT for ContentBlock. The UI-local `ContentBlock`
// type below is now a strict alias of `UIContentBlock` from
// `@agentic-work/llm-sdk` so the wire+persistence shape is owned in ONE
// place. The legacy interface is kept as a wrapper for back-compat with
// the ~30 callsites that import `ContentBlock` from this module — they
// transitively see the SDK shape with zero source changes.
import type { UIContentBlock } from '@agentic-work/llm-sdk';
// Step 3 (2026-05-18) — publish wire frames to the StreamEngine frame bus.
// This is a no-op when no subscribers are registered (i.e. when the
// VITE_FEATURE_STREAM_ENGINE flag is OFF and MessageBubble does NOT
// mount the engine wrapper). When ON, the engine taps frames here and
// applies them to its owned DOM container for glitchless rendering.
import { publishStreamFrame } from '../components/MessageBubble/StreamEnginedActivityStream';
// Sev-0 #924/#925/#926 — pure helper that builds the final onMessage
// payload at done time, preserving the FULL content_blocks chronology
// (every type — thinking, text, tool_use, viz_render, app_render,
// streaming_table, follow_up, sub_agent, hitl_approval, tool_round,
// tool_result). Replaces the inline filter that dropped non-thinking/
// non-tool_use blocks and lost artifact + text chronology on finalize.
import { buildDoneMessagePayload } from './buildDoneMessagePayload';

// Pipeline stages from ChatPipeline backend
export type PipelineStage = 'auth' | 'validation' | 'prompt' | 'mcp' | 'completion' | 'response';

// Pipeline state to track current processing phase
export interface PipelineState {
  currentStage: PipelineStage | null;
  stageStartTime: number | null;
  stageTiming: Record<string, number>;
  isToolExecutionPhase: boolean;
  activeToolRound: number;
  maxToolRounds: number;
  bufferedContent: string;
  shouldSuppressContent: boolean;
}

// Animation modes for streaming - simplified
export type AnimationMode = 'smooth' | 'none';

/**
 * Content block for interleaved thinking. F1 (2026-05-18) — this is now a
 * strict re-export of `UIContentBlock` from `@agentic-work/llm-sdk`. The
 * SDK owns the SoT shape; the alias here keeps the ~30 existing call sites
 * importing `ContentBlock` from `useChatStream` working with zero source
 * changes. New code should import `UIContentBlock` directly from
 * `@agentic-work/llm-sdk`.
 *
 * The SDK shape is a structural superset of the legacy local interface —
 * every previously-typed field exists on `UIContentBlock` with identical
 * semantics. See:
 *   - SDK SoT:   openagentic-sdk/src/lib/ui-stream/types.ts (UIContentBlock)
 *   - Follow-up: docs/superpowers/specs/2026-05-18-streaming-engine-design.md
 *                §"Follow-up tickets" (F1+F2 deeper rip)
 */
export type ContentBlock = UIContentBlock;

/**
 * Wire-in D (#82) — tool_round container block. The chat pipeline wraps
 * a batch of parallel tool_executing / tool_complete frames with a
 * tool_round_start / tool_round_end envelope so the UI can render them
 * as children of a single .tool-parallel card (mock 01-cloud-ops).
 */
export interface ToolRoundBlock extends ContentBlock {
  type: 'tool_round';
  roundId: string;
  toolIds: string[];
  children: ContentBlock[];
  isComplete: boolean;
  startTime?: number;
  durationMs?: number;
  succeeded?: number;
  failed?: number;
}

/**
 * Minimal structural type for the frames applyRoundFrame consumes. The
 * real NDJSON payloads carry more fields (timestamp, toolNames, _seq,
 * etc.) but only these are load-bearing for the correlation reducer.
 */
export type RoundFrame =
  | {
      type: 'tool_round_start';
      roundId: string;
      toolCount?: number;
      toolIds?: string[];
      toolNames?: string[];
      timestamp?: string;
    }
  | {
      type: 'tool_round_end';
      roundId: string;
      succeeded?: number;
      failed?: number;
      durationMs?: number;
      timestamp?: string;
    }
  | {
      type: 'tool_executing';
      roundId?: string;
      toolCallId?: string;
      name?: string;
      arguments?: unknown;
    }
  | {
      type: 'tool_complete' | 'tool_result' | 'tool_error';
      roundId?: string;
      toolCallId?: string;
      name?: string;
      result?: unknown;
      error?: string;
      durationMs?: number;
      /**
       * Phase 4 — two-channel envelope UI side. Carries outputTemplate
       * + size / elapsed / cost / artifactHandle so the reducer can
       * stamp the slug onto the matching ContentBlock for downstream
       * FrameRendererRegistry lookup.
       */
      _meta?: {
        outputTemplate?: string;
        size?: number;
        elapsed?: number;
        cost?: number;
        artifactHandle?: string;
      };
    };

/**
 * Pure reducer that folds a round-aware stream frame onto the current
 * contentBlocks list.
 *
 *   tool_round_start      → push a new tool_round block with empty children
 *   tool_executing (w/ roundId matching open round) → append to children
 *   tool_executing (no match / unknown roundId)     → append as sibling
 *   tool_complete / tool_result / tool_error (w/ roundId match)
 *                         → update the matching child in place
 *   tool_round_end        → mark round isComplete + stamp durationMs /
 *                           succeeded / failed
 *
 * Non-matching frames fall through untouched. All outputs are new arrays
 * so downstream React state setters see a fresh reference.
 */
export function applyRoundFrame(
  blocks: ContentBlock[],
  frame: RoundFrame,
): ContentBlock[] {
  // ── tool_round_start ────────────────────────────────────────────
  if (frame.type === 'tool_round_start') {
    // Dedupe: if a tool_round block already exists for this roundId, the
    // second tool_round_start is a no-op (defensive against duplicate
    // envelopes from the sequencer).
    if (
      blocks.some(
        (b) => b.type === 'tool_round' && b.roundId === frame.roundId,
      )
    ) {
      return blocks;
    }
    const round: ToolRoundBlock = {
      id: `tool-round-${frame.roundId}`,
      index: blocks.length,
      type: 'tool_round',
      content: '',
      roundId: frame.roundId,
      toolIds: Array.isArray(frame.toolIds) ? [...frame.toolIds] : [],
      children: [],
      isComplete: false,
      startTime: Date.now(),
    };
    return [...blocks, round];
  }

  // ── tool_round_end ──────────────────────────────────────────────
  if (frame.type === 'tool_round_end') {
    return blocks.map((b) => {
      if (b.type !== 'tool_round' || b.roundId !== frame.roundId) return b;
      return {
        ...b,
        isComplete: true,
        durationMs: typeof frame.durationMs === 'number' ? frame.durationMs : b.durationMs,
        succeeded: typeof frame.succeeded === 'number' ? frame.succeeded : b.succeeded,
        failed: typeof frame.failed === 'number' ? frame.failed : b.failed,
      };
    });
  }

  // ── tool_executing ──────────────────────────────────────────────
  if (frame.type === 'tool_executing') {
    const targetRoundIdx =
      frame.roundId
        ? blocks.findIndex(
            (b) => b.type === 'tool_round' && b.roundId === frame.roundId,
          )
        : -1;

    const child: ContentBlock = {
      id: `tool-exec-${frame.toolCallId || frame.name || Math.random().toString(36).slice(2)}`,
      index: targetRoundIdx >= 0
        ? (blocks[targetRoundIdx].children?.length ?? 0)
        : blocks.length,
      type: 'tool_use',
      content: JSON.stringify(frame.arguments ?? {}),
      isComplete: false,
      toolName: frame.name,
      toolId: frame.toolCallId,
      startTime: Date.now(),
    };

    if (targetRoundIdx < 0) {
      // No matching round — graceful fallback, render as top-level sibling.
      return [...blocks, child];
    }

    return blocks.map((b, i) => {
      if (i !== targetRoundIdx) return b;
      return {
        ...b,
        children: [...(b.children ?? []), child],
      };
    });
  }

  // ── tool_complete / tool_result / tool_error ─────────────────────
  if (
    frame.type === 'tool_complete' ||
    frame.type === 'tool_result' ||
    frame.type === 'tool_error'
  ) {
    if (!frame.roundId) return blocks;
    const roundIdx = blocks.findIndex(
      (b) => b.type === 'tool_round' && b.roundId === frame.roundId,
    );
    if (roundIdx < 0) return blocks;

    const round = blocks[roundIdx];
    const children = round.children ?? [];
    const childIdx = children.findIndex(
      (c) =>
        (frame.toolCallId && c.toolId === frame.toolCallId) ||
        (frame.name && c.toolName === frame.name && !c.isComplete),
    );
    if (childIdx < 0) return blocks;

    const prevChild = children[childIdx];
    // Phase 4 — forward `_meta.outputTemplate` from the tool_result frame
    // onto the matching ContentBlock so render-time can resolve the
    // FrameRendererRegistry component. Only stamps on success-path frames
    // (tool_result / tool_complete); tool_error keeps the existing error
    // shape unchanged.
    const frameMeta =
      frame.type === 'tool_result' || frame.type === 'tool_complete'
        ? (frame as any)?._meta
        : undefined;
    const outputTemplate: string | undefined = frameMeta?.outputTemplate;
    const nextChild: ContentBlock = {
      ...prevChild,
      isComplete: true,
      ...(frame.type === 'tool_error'
        ? { error: frame.error }
        : { result: frame.result }),
      ...(outputTemplate ? { outputTemplate } : {}),
      duration:
        typeof frame.durationMs === 'number'
          ? frame.durationMs
          : Date.now() - (prevChild.startTime || Date.now()),
    };

    const nextChildren = children.slice();
    nextChildren[childIdx] = nextChild;
    return blocks.map((b, i) =>
      i === roundIdx ? { ...b, children: nextChildren } : b,
    );
  }

  return blocks;
}

// Pipeline-aware event types that match backend ChatPipeline
interface PipelineEvents {
  'pipeline:start': { messageId: string; stage: PipelineStage };
  'pipeline:stage': { stage: PipelineStage; data: any };
  'pipeline:tool_round': { round: number; maxRounds: number };
  'pipeline:content_suppressed': { stage: PipelineStage; reason: string };
  'pipeline:complete': { metrics: any };
}

// Create initial pipeline state
const createInitialPipelineState = (): PipelineState => ({
  currentStage: null,
  stageStartTime: null,
  stageTiming: {},
  isToolExecutionPhase: false,
  activeToolRound: 0,
  maxToolRounds: 5, // Match backend maxToolCallRounds
  bufferedContent: '',
  shouldSuppressContent: false
});

// Determine if content should be suppressed based on pipeline stage
const shouldSuppressContentForStage = (stage: PipelineStage | null, toolRound: number): boolean => {
  if (!stage) return false;
  
  // Suppress content during tool execution phases
  if (stage === 'mcp' && toolRound > 0) return true;
  
  // Allow content during final completion phase
  if (stage === 'completion' || stage === 'response') return false;
  
  // Suppress during early stages
  if (stage === 'auth' || stage === 'validation' || stage === 'prompt') return true;
  
  return false;
};

// Map backend stage names to our pipeline stages
const mapBackendStage = (eventType: string): PipelineStage | null => {
  switch (eventType) {
    case 'auth_start':
    case 'auth_complete':
      return 'auth';
    case 'validation_start':
    case 'validation_complete':
      return 'validation';
    case 'prompt_start':
    case 'prompt_complete':
    case 'prompt_engineering':
      return 'prompt';
    case 'mcp_start':
    case 'mcp_complete':
    case 'tool_execution_start':
    case 'tool_execution_complete':
    case 'completion_restart':
    case 'tool_executing':
    case 'tool_result':
    case 'tool_call_delta':
      return 'mcp';
    case 'completion_start':
    case 'completion_complete':
      return 'completion';
    case 'response_start':
    case 'stream_complete':
    case 'done':
      return 'response';
    default:
      return null;
  }
};

// Get animation mode from user preferences
const getAnimationMode = (): AnimationMode => {
  if (typeof window === 'undefined') return 'none';
  
  const saved = localStorage.getItem('chat-animation-mode');
  if (saved === 'smooth' || saved === 'none') return saved;
  
  // Default to smooth for better UX now that we have proper pipeline awareness
  return 'smooth';
};

// Extract thinking blocks and return both cleaned content and thinking
function extractAndCleanThinkingBlocks(content: string): { cleaned: string; thinking: string } {
  // Fast path: skip expensive regex if no thinking tags present
  if (!content.includes('<thinking>') && !content.includes('<reasoning>') && !content.includes('<tool_code>')) {
    return { cleaned: content, thinking: '' };
  }

  let cleanContent = content;
  const thinkingParts: string[] = [];

  // Extract and remove <thinking> blocks
  let match;
  const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
  while ((match = thinkingRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(thinkingRegex, '');

  // Extract and remove <reasoning> blocks
  const reasoningRegex = /<reasoning>([\s\S]*?)<\/reasoning>/g;
  while ((match = reasoningRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(reasoningRegex, '');

  // Extract and remove <tool_code> blocks
  const toolCodeRegex = /<tool_code>([\s\S]*?)<\/tool_code>/g;
  while ((match = toolCodeRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(toolCodeRegex, '');

  // Clean up any extra whitespace
  cleanContent = cleanContent.trim().replace(/\n{3,}/g, '\n\n');

  return {
    cleaned: cleanContent,
    thinking: thinkingParts.join('\n\n---\n\n')
  };
}

// Backward compatibility wrapper
function cleanThinkingBlocks(content: string): string {
  return extractAndCleanThinkingBlocks(content).cleaned;
}

/**
 * Model identifier split for the assistant message header pill.
 *
 * Mock 01 (mocks/UX/01-cloud-ops.html:206-212) shows the model in two
 * halves — the family `tag` in accent color, the rest in muted color:
 *
 *   <span class="model"><span class="tag">claude</span>3.5 sonnet</span>
 *
 * The wire frame `message_received` carries a single string like
 * `claude-opus-4-7`; we split on the FIRST hyphen so the family stays
 * a single word. Returns null for empty / whitespace / leading-hyphen
 * inputs so the consumer can suppress the badge entirely.
 */
export interface ModelIdentifier {
  tag: string;
  id: string;
}

export function splitModelIdentifier(
  raw: string | null | undefined,
): ModelIdentifier | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s.length === 0) return null;
  // A leading hyphen is malformed wire data — suppress.
  if (s.startsWith('-')) return null;
  const i = s.indexOf('-');
  if (i < 0) {
    // Single-word identifier ("qwen", "phi"). Show as the family tag.
    return { tag: s, id: '' };
  }
  let tag = s.slice(0, i);
  // Bedrock ARN-style ids carry dotted vendor prefixes — `global.anthropic.claude-...`,
  // `us.amazon.nova-...`, `anthropic.claude-3-...`. Mock 01:206-212 expects
  // a short family tag. Strip everything up to the LAST dot in the pre-hyphen
  // segment, leaving only the family name. Single-segment tags pass through.
  const lastDot = tag.lastIndexOf('.');
  if (lastDot >= 0) {
    tag = tag.slice(lastDot + 1);
  }
  return { tag, id: s.slice(i + 1) };
}

/**
 * P1-5 of chatmode UX parity — suppress orphan / trivial artifact slide-outs.
 *
 * The server fires `artifact_open` for any structured response, but plain
 * prose with no fences / SVG / Mermaid / chart syntax should NEVER pop the
 * slide-out. Called at `artifact_close` time with the accumulated final
 * content; returns true only when the content has real substance.
 *
 * - Always false for empty / whitespace-only (any kind).
 * - For `markdown`: true if the content is ≥200 chars OR contains a fence
 *   / `<svg>` / Mermaid keyword (graph|sequenceDiagram|flowchart) / a
 *   markdown table (≥2 pipes per line for ≥2 lines).
 * - For all other kinds (`code`, `mermaid`, `chart`, `csv`): true once
 *   non-whitespace content exists. Those kinds never confuse with prose.
 */
export function isArtifactWorthShowing(content: string, kind: string): boolean {
  const c = (content || '').trim();
  if (c.length === 0) return false;
  if (kind !== 'markdown') return true;
  if (c.length >= 200) return true;
  if (/```/.test(c)) return true;
  if (/<svg[\s>]/i.test(c)) return true;
  if (/\b(?:graph|sequenceDiagram|flowchart|gantt|classDiagram|stateDiagram|erDiagram|journey|pie|gitGraph)\b/i.test(c)) {
    return true;
  }
  // Markdown table: at least two consecutive lines each containing 2+ pipes.
  const lines = c.split('\n');
  let pipedRun = 0;
  for (const line of lines) {
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount >= 2) {
      pipedRun += 1;
      if (pipedRun >= 2) return true;
    } else {
      pipedRun = 0;
    }
  }
  return false;
}

/**
 * Sev-0 2026-05-08 — empty-completion fallback contract.
 *
 * When `done` / `stream_complete` arrives with no assistant text AND no
 * tool calls AND no tool_use blocks (model emitted zero tokens after a
 * tool-use chain or after thinking), the historical condition skipped
 * the message-creation branch entirely → the UI hung on
 * "waiting for first token" forever.
 *
 * Pure decision function. The render branch consults this to know:
 *  - whether to create a message at all (always, now)
 *  - what content to seed the message with (original, empty for tool-only,
 *    or italic placeholder for the truly-empty case)
 */
export interface EmptyCompletionInputs {
  assistantMessage: string;
  mcpCallsLength: number;
  hasToolUseBlocks: boolean;
}

export interface EmptyCompletionResolution {
  shouldRender: boolean;
  content: string;
  usedFallback: boolean;
}

export function resolveEmptyCompletionFallback(
  inputs: EmptyCompletionInputs,
): EmptyCompletionResolution {
  const trimmed = (inputs.assistantMessage || '').trim();
  if (trimmed.length > 0) {
    return { shouldRender: true, content: inputs.assistantMessage, usedFallback: false };
  }
  if (inputs.mcpCallsLength > 0 || inputs.hasToolUseBlocks) {
    return { shouldRender: true, content: '', usedFallback: false };
  }
  return {
    shouldRender: true,
    content: '_Model finished without producing an answer. Try rephrasing or check the activity stream above._',
    usedFallback: true,
  };
}

/**
 * E1.5 (2026-05-12) — wire-shape normalizers for tool_executing / tool_result.
 *
 * The V2 chat pipeline canonical payload (see api/.../pipeline/chat/builders.ts
 * `buildToolExecuting`, `buildToolResult`) is:
 *
 *   tool_executing: { name, tool_use_id, input }
 *   tool_result:    { name, tool_use_id, content, is_error, _meta }
 *
 * Legacy OpenAI-shape callers (Gemini, V1 paths) used `arguments` /
 * `toolCallId` / `result` instead. The UI reducer was reading the legacy
 * names, so every panel showed `INPUT {}` and `RESULT undefined` because
 * the canonical wire frame's `input` / `content` were never read.
 *
 * The normalizer prefers the canonical names but falls through to legacy
 * so older sub-agent / Gemini / mock paths keep working. RED test:
 * useChatStream.e15WireShapeNormalizer.test.ts.
 */
export function extractToolExecutingArgs(safeData: any): unknown {
  if (safeData == null || typeof safeData !== 'object') return undefined;
  if ('input' in safeData && safeData.input !== undefined) return safeData.input;
  if ('arguments' in safeData && safeData.arguments !== undefined) return safeData.arguments;
  return undefined;
}

export function extractToolExecutingToolUseId(safeData: any): string | undefined {
  if (safeData == null || typeof safeData !== 'object') return undefined;
  if (typeof safeData.tool_use_id === 'string') return safeData.tool_use_id;
  if (typeof safeData.toolCallId === 'string') return safeData.toolCallId;
  return undefined;
}

export function extractToolResultContent(safeData: any): unknown {
  if (safeData == null || typeof safeData !== 'object') return undefined;
  if ('content' in safeData && safeData.content !== undefined) return safeData.content;
  if ('result' in safeData && safeData.result !== undefined) return safeData.result;
  return undefined;
}

/**
 * P1-6 — streaming-table primitive (mock 01:385-462).
 *
 * Server emits one `streaming_table` frame per table; the UI keys by
 * `artifact_id` (hot-swap on re-emit) and renders inline. Mirrors the
 * compose_visual / compose_app append-or-hot-swap pattern.
 */
export type SevSeverity = 'ok' | 'warn' | 'err';

export interface SevCell {
  kind: 'sev';
  value: string;
  severity: SevSeverity;
}

export type StreamingTableCell = string | SevCell;

export interface StreamingTableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  cellClass?: 'mono' | 'tnum';
  /**
   * Mock-07 (tri-cloud cost spikes) — when a numeric column carries
   * `colorize: 'delta-currency'`, the renderer applies cm-red / cm-amber /
   * cm-green class to each cell based on the absolute-value threshold:
   *   |v| >= 5000 → red
   *   |v| >= 2000 → amber
   *   otherwise   → green
   * Backwards-compat: absent flag → no coloring (existing behavior).
   */
  colorize?: 'delta-currency';
  /**
   * Mock-07 line 110 — when a column has `dim:true`, its cells render in
   * the dim-fg colour (cm-fg-3). Used for "root cause" / inline annotation
   * columns. Optional.
   */
  dim?: boolean;
}

export interface StreamingTableFilter {
  /** Column key the filter pill selects on. */
  column: string;
  /** Default option label (e.g. "all clouds"). Defaults to "all". */
  default?: string;
}

export interface StreamingTable {
  artifactId: string;
  title: string;
  countText?: string;
  columns: StreamingTableColumn[];
  rows: Array<Record<string, StreamingTableCell>>;
  /** Optional filter pill (mock-07 line 219). */
  filter?: StreamingTableFilter;
}

export interface StreamingTableFrame {
  type: 'streaming_table';
  artifact_id: string;
  title: string;
  count_text?: string;
  columns: Array<{
    key: string;
    label: string;
    align?: 'left' | 'right';
    cell_class?: 'mono' | 'tnum';
    /** Mock-07 — numeric column coloring (currently 'delta-currency'). */
    colorize?: 'delta-currency';
    /** Mock-07 — dim-styled column. */
    dim?: boolean;
  }>;
  rows: Array<Record<string, StreamingTableCell>>;
  /** Mock-07 — optional filter pill spec. */
  filter?: {
    column: string;
    default?: string;
  };
}

/**
 * Pure reducer: fold a `streaming_table` wire frame into the per-message
 * map. Drops malformed payloads silently (empty messageId, empty
 * artifact_id, or empty columns — there is nothing useful to render).
 * Hot-swaps in place when the artifact_id matches an existing entry under
 * the same messageId; appends otherwise.
 */
export function applyStreamingTableFrame(
  map: Record<string, StreamingTable[]>,
  messageId: string,
  frame: StreamingTableFrame,
): Record<string, StreamingTable[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  const cols = Array.isArray(frame.columns) ? frame.columns : [];
  if (cols.length === 0) return map;
  const next: StreamingTable = {
    artifactId,
    title: typeof frame.title === 'string' ? frame.title : '',
    countText: typeof frame.count_text === 'string' && frame.count_text.length > 0
      ? frame.count_text
      : undefined,
    columns: cols.map((c) => ({
      key: typeof c.key === 'string' ? c.key : '',
      label: typeof c.label === 'string' ? c.label : '',
      align: c.align === 'right' ? 'right' : c.align === 'left' ? 'left' : undefined,
      cellClass:
        c.cell_class === 'mono' || c.cell_class === 'tnum' ? c.cell_class : undefined,
      colorize: c.colorize === 'delta-currency' ? 'delta-currency' : undefined,
      dim: c.dim === true ? true : undefined,
    })),
    rows: Array.isArray(frame.rows) ? frame.rows : [],
    filter:
      frame.filter && typeof frame.filter.column === 'string' && frame.filter.column.length > 0
        ? {
            column: frame.filter.column,
            default:
              typeof frame.filter.default === 'string' && frame.filter.default.length > 0
                ? frame.filter.default
                : undefined,
          }
        : undefined,
  };
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((t) => t.artifactId === artifactId);
  if (idx >= 0) {
    const replaced = [...existing];
    replaced[idx] = next;
    return { ...map, [messageId]: replaced };
  }
  return { ...map, [messageId]: [...existing, next] };
}

/**
 * Phase 27 — findings_emit NDJSON frame. Severity-tagged audit/review
 * lists rendered inline by v2/Findings (mocks 03, 07, 08, 09).
 */
export type FindingSeverityWire =
  | 'critical' | 'high' | 'med' | 'low' | 'info' | 'ok';

export interface FindingsItem {
  id: string;
  title: string;
  severity: FindingSeverityWire;
  body?: string;
}

export interface FindingsArtifact {
  artifactId: string;
  title?: string;
  items: FindingsItem[];
}

export interface FindingsFrame {
  type: 'findings_emit';
  artifact_id: string;
  title?: string;
  items: Array<{
    id: string;
    title: string;
    severity: FindingSeverityWire;
    body?: string;
  }>;
}

const VALID_SEVERITIES = new Set<FindingSeverityWire>([
  'critical', 'high', 'med', 'low', 'info', 'ok',
]);

/**
 * Pure reducer: fold a `findings_emit` wire frame into the per-message
 * map. Drops malformed payloads silently. Hot-swaps in place when the
 * artifact_id matches an existing entry under the same messageId;
 * appends otherwise.
 */
export function applyFindingsFrame(
  map: Record<string, FindingsArtifact[]>,
  messageId: string,
  frame: FindingsFrame,
): Record<string, FindingsArtifact[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  const items = Array.isArray(frame.items) ? frame.items : [];
  if (items.length === 0) return map;
  const sanitized: FindingsItem[] = items
    .filter((it) => it && typeof it.id === 'string' && typeof it.title === 'string')
    .map((it) => ({
      id: it.id,
      title: it.title,
      severity: VALID_SEVERITIES.has(it.severity) ? it.severity : 'info',
      ...(typeof it.body === 'string' ? { body: it.body } : {}),
    }));
  if (sanitized.length === 0) return map;
  const next: FindingsArtifact = {
    artifactId,
    ...(typeof frame.title === 'string' ? { title: frame.title } : {}),
    items: sanitized,
  };
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((a) => a.artifactId === artifactId);
  if (idx >= 0) {
    const replaced = [...existing];
    replaced[idx] = next;
    return { ...map, [messageId]: replaced };
  }
  return { ...map, [messageId]: [...existing, next] };
}

/**
 * #502 unified inline-widget primitive — one NDJSON frame carries the
 * v2 primitives that don't already have a dedicated wire (KpiGrid,
 * SavingsCard, StagesStrip, WaveTimeline, Runbook, StackGrid,
 * AnnotatedCode). The model emits these via the `compose_widget`
 * meta-tool; the API forwards `inline_widget` frames keyed by
 * `artifact_id`.
 *
 * Each `data` payload mirrors the corresponding v2 primitive's prop
 * shape one-to-one, so renderers can pass `data` straight through.
 */
export type InlineWidgetKind =
  | 'kpi_grid'
  | 'savings_card'
  | 'stages_strip'
  | 'wave_timeline'
  | 'runbook'
  | 'stack_grid'
  | 'annotated_code';

const INLINE_WIDGET_KINDS = new Set<InlineWidgetKind>([
  'kpi_grid',
  'savings_card',
  'stages_strip',
  'wave_timeline',
  'runbook',
  'stack_grid',
  'annotated_code',
]);

export interface InlineWidgetFrame {
  type: 'inline_widget';
  artifact_id: string;
  kind: InlineWidgetKind;
  title?: string;
  data: unknown;
}

export interface InlineWidget {
  artifactId: string;
  kind: InlineWidgetKind;
  title?: string;
  data: unknown;
}

/**
 * Validate a payload against the kind's required-shape contract.
 * Returns false for malformed shapes so the reducer can drop silently.
 */
function isValidInlineWidgetData(kind: InlineWidgetKind, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  switch (kind) {
    case 'kpi_grid':
      return Array.isArray(d.tiles) && d.tiles.length > 0;
    case 'savings_card':
      return Array.isArray(d.cells) && d.cells.length > 0;
    case 'stages_strip':
      return Array.isArray(d.stages) && d.stages.length > 0;
    case 'wave_timeline':
      return Array.isArray(d.rows) && d.rows.length > 0;
    case 'runbook':
      return Array.isArray(d.steps) && d.steps.length > 0;
    case 'stack_grid':
      return Array.isArray(d.layers) && d.layers.length > 0;
    case 'annotated_code':
      return Array.isArray(d.lines) && d.lines.length > 0;
    default:
      return false;
  }
}

/**
 * Pure reducer: fold one `inline_widget` wire frame into the
 * per-message map. Drops malformed payloads silently. Hot-swaps in
 * place when `artifact_id` matches an existing entry under the same
 * messageId; appends otherwise.
 */
export function applyInlineWidgetFrame(
  map: Record<string, InlineWidget[]>,
  messageId: string,
  frame: InlineWidgetFrame,
): Record<string, InlineWidget[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  if (!INLINE_WIDGET_KINDS.has(frame.kind)) return map;
  if (!isValidInlineWidgetData(frame.kind, frame.data)) return map;
  const next: InlineWidget = {
    artifactId,
    kind: frame.kind,
    ...(typeof frame.title === 'string' ? { title: frame.title } : {}),
    data: frame.data,
  };
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((w) => w.artifactId === artifactId);
  if (idx >= 0) {
    const replaced = [...existing];
    replaced[idx] = next;
    return { ...map, [messageId]: replaced };
  }
  return { ...map, [messageId]: [...existing, next] };
}

/**
 * AC-B — synth lifecycle. One unified entry per artifactId accumulates
 * across the lifecycle frames the API streams as the model authors +
 * executes Python in the synth-executor sandbox.
 */
export type SynthRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SynthStage =
  | 'planned'
  | 'awaiting_approval'
  | 'approved'
  | 'denied'
  | 'executing'
  | 'completed'
  | 'failed';

export interface Synth {
  artifactId: string;
  stage: SynthStage;
  intent: string;
  capabilities: string[];
  riskLevel: SynthRiskLevel;
  riskReason?: string;
  code: string;
  codeLang: string;
  stdout: string;
  stderr: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  exitCode?: number;
  error?: string;
  denialReason?: string;
}

export type SynthLifecycleFrame =
  | {
      type: 'synth_planned';
      artifact_id: string;
      intent: string;
      capabilities: string[];
      risk_level: SynthRiskLevel;
      risk_reason?: string;
      code_lang: string;
    }
  | {
      type: 'synth_code_chunk';
      artifact_id: string;
      chunk_index: number;
      code_fragment: string;
    }
  | { type: 'synth_approval_requested'; artifact_id: string }
  | { type: 'synth_approved'; artifact_id: string }
  | { type: 'synth_denied'; artifact_id: string; reason?: string }
  | { type: 'synth_executing'; artifact_id: string; started_at: number }
  | {
      type: 'synth_stdout';
      artifact_id: string;
      chunk: string;
      stream: 'stdout' | 'stderr';
    }
  | {
      type: 'synth_completed';
      artifact_id: string;
      duration_ms: number;
      exit_code: number;
      error?: string;
    };

const SYNTH_RISK_LEVELS = new Set<SynthRiskLevel>(['low', 'medium', 'high', 'critical']);

/**
 * Pure reducer: fold one synth lifecycle frame into the per-message
 * map. `synth_planned` is the only frame that creates new state;
 * subsequent lifecycle frames update an existing entry by
 * `artifact_id` or are dropped silently.
 */
export function applySynthLifecycleFrame(
  map: Record<string, Synth[]>,
  messageId: string,
  frame: SynthLifecycleFrame,
): Record<string, Synth[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((s) => s.artifactId === artifactId);

  if (frame.type === 'synth_planned') {
    const next: Synth = {
      artifactId,
      stage: 'planned',
      intent: typeof frame.intent === 'string' ? frame.intent : '',
      capabilities: Array.isArray(frame.capabilities) ? frame.capabilities : [],
      riskLevel: SYNTH_RISK_LEVELS.has(frame.risk_level) ? frame.risk_level : 'medium',
      ...(typeof frame.risk_reason === 'string' ? { riskReason: frame.risk_reason } : {}),
      code: '',
      codeLang: typeof frame.code_lang === 'string' ? frame.code_lang : 'python',
      stdout: '',
      stderr: '',
    };
    if (idx >= 0) {
      const replaced = [...existing];
      replaced[idx] = next;
      return { ...map, [messageId]: replaced };
    }
    return { ...map, [messageId]: [...existing, next] };
  }

  // Non-planned frames update an existing entry; orphans drop.
  if (idx < 0) return map;
  const cur = existing[idx];
  let updated: Synth | null = null;

  switch (frame.type) {
    case 'synth_code_chunk':
      updated = {
        ...cur,
        code: cur.code + (typeof frame.code_fragment === 'string' ? frame.code_fragment : ''),
      };
      break;
    case 'synth_approval_requested':
      updated = { ...cur, stage: 'awaiting_approval' };
      break;
    case 'synth_approved':
      updated = { ...cur, stage: 'approved' };
      break;
    case 'synth_denied':
      updated = {
        ...cur,
        stage: 'denied',
        ...(typeof frame.reason === 'string' ? { denialReason: frame.reason } : {}),
      };
      break;
    case 'synth_executing':
      updated = {
        ...cur,
        stage: 'executing',
        startedAt: typeof frame.started_at === 'number' ? frame.started_at : cur.startedAt,
      };
      break;
    case 'synth_stdout': {
      const chunk = typeof frame.chunk === 'string' ? frame.chunk : '';
      if (frame.stream === 'stderr') {
        updated = { ...cur, stderr: cur.stderr + chunk };
      } else {
        updated = { ...cur, stdout: cur.stdout + chunk };
      }
      break;
    }
    case 'synth_completed': {
      const exitCode = typeof frame.exit_code === 'number' ? frame.exit_code : 0;
      const failed = exitCode !== 0 || typeof frame.error === 'string';
      updated = {
        ...cur,
        stage: failed ? 'failed' : 'completed',
        durationMs: typeof frame.duration_ms === 'number' ? frame.duration_ms : undefined,
        exitCode,
        ...(typeof frame.error === 'string' ? { error: frame.error } : {}),
      };
      break;
    }
    default:
      return map;
  }

  if (!updated) return map;
  const replaced = [...existing];
  replaced[idx] = updated;
  return { ...map, [messageId]: replaced };
}

/**
 * AC-D1 — artifact_emit. Server emits this when synth-executor (or
 * any tool) finishes writing bytes to UserStorageService. The UI
 * renders one <DownloadTile> per entry, click → presigned MinIO URL.
 */
export interface ArtifactEmit {
  artifactId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
  producedBy?: string;
  synthArtifactId?: string;
}

export interface ArtifactEmitFrame {
  type: 'artifact_emit';
  artifact_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  download_url: string;
  produced_by?: string;
  synth_artifact_id?: string;
}

/**
 * Pure reducer: fold one `artifact_emit` frame into the per-message
 * map. Drops malformed payloads silently. Hot-swaps in place when the
 * artifact_id matches an existing entry under the same messageId;
 * appends otherwise.
 */
export function applyArtifactEmitFrame(
  map: Record<string, ArtifactEmit[]>,
  messageId: string,
  frame: ArtifactEmitFrame,
): Record<string, ArtifactEmit[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  const filename = typeof frame.filename === 'string' ? frame.filename : '';
  if (!filename) return map;
  const downloadUrl = typeof frame.download_url === 'string' ? frame.download_url : '';
  if (!downloadUrl) return map;

  const next: ArtifactEmit = {
    artifactId,
    filename,
    contentType: typeof frame.content_type === 'string' ? frame.content_type : 'application/octet-stream',
    sizeBytes: typeof frame.size_bytes === 'number' ? frame.size_bytes : 0,
    downloadUrl,
    ...(typeof frame.produced_by === 'string' ? { producedBy: frame.produced_by } : {}),
    ...(typeof frame.synth_artifact_id === 'string' ? { synthArtifactId: frame.synth_artifact_id } : {}),
  };
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((a) => a.artifactId === artifactId);
  if (idx >= 0) {
    const replaced = [...existing];
    replaced[idx] = next;
    return { ...map, [messageId]: replaced };
  }
  return { ...map, [messageId]: [...existing, next] };
}

/**
 * P0-2 — stamp wire `model` onto a (partial) ChatMessage as `model` +
 * `modelTag` + `modelId` so MessageHeader can render the assistant pill
 * without re-parsing on every render. Mirrors mock 01:206-212 pill anatomy.
 *
 * Returns the input unchanged when `model` is missing or malformed
 * (splitModelIdentifier returned null) — half-stamped pills confuse users.
 */
export function attachModelIdentifier<M extends object>(
  message: M,
  model: string | null | undefined,
): M & { model?: string; modelTag?: string; modelId?: string } {
  const split = splitModelIdentifier(model);
  if (!split) return message as M & { model?: string; modelTag?: string; modelId?: string };
  return {
    ...message,
    model: typeof model === 'string' ? model.trim() : model ?? undefined,
    modelTag: split.tag,
    modelId: split.id.length > 0 ? split.id : undefined,
  };
}

// Legacy AppRender / ArtifactRender shapes + applyAppRenderFrame /
// applyArtifactRenderFrame reducers were ripped. The `app_render` and
// `artifact_render` wire frames now fold into the canonical
// contentBlocks[] array via streamReducer/applyCanonicalFrame and render
// inline through AgenticActivityStream's typed-block path.

// ════════════════════════════════════════════════════════════════════
// Wave 3 (#525) — intent_classified + tool_shortlist NDJSON consumers.
//
// Server emits these ONCE per assistant turn from prompt.stage (Wave 2):
//   intent_classified: { intent, confidence, ms, classifierCacheHit }
//   tool_shortlist:    { total_available, count, intent, kept[] }
//
// Both frames emit BEFORE the assistant's message_saved arrives
// (#473 ordering — frame fires from prompt.stage, message_saved from
// response.stage). The buffer-then-flush pattern below keys the maps
// by the React placeholder id (NOT the DB CUID — same gotcha #473
// fixed earlier).
// ════════════════════════════════════════════════════════════════════

/** IntentClassified state — one entry per assistant message. */
export interface IntentClassification {
  intent: string;
  confidence: number;
  ms: number;
  classifierCacheHit: boolean;
}

/** ToolShortlist state — one entry per assistant message. */
export interface ToolShortlist {
  totalAvailable: number;
  count: number;
  intent: string;
  kept: string[];
}

/** Wire shape for `intent_classified` (camelCase per Wave 2 spec). */
export type IntentClassifiedFrame = {
  type: 'intent_classified';
  intent: string;
  confidence: number;
  ms: number;
  classifierCacheHit: boolean;
};

/** Wire shape for `tool_shortlist` (snake_case per Wave 2 spec). */
export type ToolShortlistFrame = {
  type: 'tool_shortlist';
  total_available: number;
  count: number;
  intent: string;
  kept: string[];
};

/**
 * Pure reducer: coerce + buffer-or-apply an `intent_classified` frame.
 * When `assistantMessageId` is empty (frame fired before assistant's
 * message_saved), the entry stashes in the pending slot for later flush.
 */
export function bufferOrApplyIntentClassified(
  safeData: any,
  assistantMessageId: string,
  prevMap: Record<string, IntentClassification>,
  prevPending: IntentClassification | null,
): {
  intentClassifications: Record<string, IntentClassification>;
  pending: IntentClassification | null;
} {
  const intent = typeof safeData?.intent === 'string' ? safeData.intent : '';
  const confidence =
    typeof safeData?.confidence === 'number' && Number.isFinite(safeData.confidence)
      ? safeData.confidence
      : 0;
  const ms =
    typeof safeData?.ms === 'number' && Number.isFinite(safeData.ms)
      ? safeData.ms
      : 0;
  const classifierCacheHit = safeData?.classifierCacheHit === true;
  if (!intent) {
    // Defensive — drop malformed frames silently.
    return { intentClassifications: prevMap, pending: prevPending };
  }
  const entry: IntentClassification = { intent, confidence, ms, classifierCacheHit };
  if (!assistantMessageId) {
    return { intentClassifications: prevMap, pending: entry };
  }
  return {
    intentClassifications: { ...prevMap, [assistantMessageId]: entry },
    pending: prevPending,
  };
}

/** Flush buffered intent classification into the keyed map on assistant message_saved. */
export function flushPendingIntentClassified(
  assistantMessageId: string,
  prevMap: Record<string, IntentClassification>,
  prevPending: IntentClassification | null,
): {
  intentClassifications: Record<string, IntentClassification>;
  pending: IntentClassification | null;
} {
  if (!prevPending) return { intentClassifications: prevMap, pending: null };
  if (!assistantMessageId) {
    return { intentClassifications: prevMap, pending: prevPending };
  }
  return {
    intentClassifications: { ...prevMap, [assistantMessageId]: prevPending },
    pending: null,
  };
}

/**
 * Pure reducer: coerce + buffer-or-apply a `tool_shortlist` frame.
 *
 * Buffer-or-apply: when no assistant messageId is known yet (the frame
 * fires from prompt.stage before the assistant's message_saved arrives),
 * stash in a session-level pending slot; the case 'message_saved' arm
 * flushes it on assistant role.
 */
export function bufferOrApplyToolShortlist(
  safeData: any,
  assistantMessageId: string,
  prevMap: Record<string, ToolShortlist>,
  prevPending: ToolShortlist | null,
): {
  toolShortlists: Record<string, ToolShortlist>;
  pending: ToolShortlist | null;
} {
  const totalAvailable =
    typeof safeData?.total_available === 'number' &&
    Number.isFinite(safeData.total_available)
      ? safeData.total_available
      : 0;
  const count =
    typeof safeData?.count === 'number' && Number.isFinite(safeData.count)
      ? safeData.count
      : 0;
  const intent = typeof safeData?.intent === 'string' ? safeData.intent : '';
  const kept = Array.isArray(safeData?.kept)
    ? safeData.kept.filter((s: any) => typeof s === 'string')
    : [];
  if (totalAvailable <= 0) {
    // Defensive — backend skips emit when pool is empty; same here.
    return { toolShortlists: prevMap, pending: prevPending };
  }
  const entry: ToolShortlist = { totalAvailable, count, intent, kept };
  if (!assistantMessageId) {
    return { toolShortlists: prevMap, pending: entry };
  }
  return {
    toolShortlists: { ...prevMap, [assistantMessageId]: entry },
    pending: prevPending,
  };
}

/** Flush buffered tool-shortlist into the keyed map on assistant message_saved. */
export function flushPendingToolShortlist(
  assistantMessageId: string,
  prevMap: Record<string, ToolShortlist>,
  prevPending: ToolShortlist | null,
): {
  toolShortlists: Record<string, ToolShortlist>;
  pending: ToolShortlist | null;
} {
  if (!prevPending) return { toolShortlists: prevMap, pending: null };
  if (!assistantMessageId) {
    return { toolShortlists: prevMap, pending: prevPending };
  }
  return {
    toolShortlists: { ...prevMap, [assistantMessageId]: prevPending },
    pending: null,
  };
}

// ════════════════════════════════════════════════════════════════════
// #502 — sub_agent_started / sub_agent_completed NDJSON consumers.
//
// Server emits these from services/openagentic-api/src/services/TaskTool.ts
// (Phase E2). Each Task tool dispatch produces:
//   sub_agent_started:   { role, description, model, session_id }
//   sub_agent_completed: { role, ok, error, turns, tokens, durationMs, toolsUsed }
//
// The pure reducers below convert to camelCase for in-state storage and
// expose a flat `subAgents` array consumed by ChatMessages -> SubAgentCard.
// Reference UX: mocks/UX/01-cloud-ops.html lines 1083-1133.
// ════════════════════════════════════════════════════════════════════

export interface SubAgentStats {
  turns: number;
  tokens: number;
  wallMs: number;
  toolsUsed?: string[];
}

export interface SubAgentEntry {
  role: string;
  description?: string;
  model: string | null;
  status: 'running' | 'ok' | 'error';
  stats?: SubAgentStats;
  error?: string | null;
  sessionId?: string;
  /**
   * Phase 16 — the sub-agent's actual return content from
   * `SubagentRunResult.output`. Written by sub_agent_completed when ok.
   * Drives the SubAgentCard's cm-sa-return strip text. When absent, the
   * card falls back to the legacy stats-string so older api versions
   * keep working.
   */
  output?: string;
}

/** Wire shape (snake_case) for `sub_agent_started`. */
export type SubAgentStartedFrame = {
  type: 'sub_agent_started';
  role: string;
  description?: string;
  model?: string | null;
  session_id?: string | null;
};

/** Wire shape (snake_case) for `sub_agent_completed`. */
export type SubAgentCompletedFrame = {
  type: 'sub_agent_completed';
  role: string;
  ok: boolean;
  error?: string | null;
  turns: number;
  tokens: number;
  durationMs: number;
  toolsUsed?: string[];
  /**
   * Phase 16 — the sub-agent's full return content (from
   * SubagentRunResult.output on the api side). Optional; older api
   * versions don't emit this and the UI degrades to stats-only render.
   */
  output?: string;
};

/**
 * Variant mapping for SubAgentCard. Drives the left-border colour +
 * avatar gradient. Both hyphen and underscore separators are accepted
 * — the api emits hyphens, but synth/cli paths sometimes underscore.
 */
export function subAgentVariantFor(role: string): 'c' | 'g' | 's' | 'k' {
  const r = (role || '').toLowerCase();
  if (r === 'cost-analysis' || r === 'cost_analysis') return 'c';
  if (r === 'growth-analysis' || r === 'growth_analysis') return 'g';
  if (r === 'security-analysis' || r === 'security_analysis') return 's';
  if (r === 'kubernetes' || r === 'k8s') return 'k';
  return 'c';
}

/**
 * Pure reducer: append a new running sub-agent entry. Drops malformed
 * frames (missing role) silently and returns the input list by reference
 * so setState short-circuits on no-op.
 */
export function applySubAgentStarted(
  prev: SubAgentEntry[],
  frame: SubAgentStartedFrame,
): SubAgentEntry[] {
  const role = typeof frame.role === 'string' ? frame.role : '';
  if (!role) return prev;
  const description =
    typeof frame.description === 'string' ? frame.description : undefined;
  const model = typeof frame.model === 'string' ? frame.model : null;
  const sessionId =
    typeof frame.session_id === 'string' ? frame.session_id : undefined;
  return [
    ...prev,
    {
      role,
      description,
      model,
      status: 'running',
      sessionId,
    },
  ];
}

/**
 * Pure reducer: complete the FIRST running sub-agent entry whose role
 * matches. Merges stats + error/ok status. If no matching running entry
 * exists, returns the input list by reference (defensive — server should
 * never emit completed without started).
 */
export function applySubAgentCompleted(
  prev: SubAgentEntry[],
  frame: SubAgentCompletedFrame,
): SubAgentEntry[] {
  const role = typeof frame.role === 'string' ? frame.role : '';
  if (!role) return prev;
  const idx = prev.findIndex(
    (e) => e.role === role && e.status === 'running',
  );
  if (idx < 0) return prev;
  const out = [...prev];
  out[idx] = {
    ...out[idx],
    status: frame.ok ? 'ok' : 'error',
    stats: {
      turns: typeof frame.turns === 'number' ? frame.turns : 0,
      tokens: typeof frame.tokens === 'number' ? frame.tokens : 0,
      wallMs: typeof frame.durationMs === 'number' ? frame.durationMs : 0,
      toolsUsed: Array.isArray(frame.toolsUsed) ? frame.toolsUsed : undefined,
    },
    error: typeof frame.error === 'string' ? frame.error : null,
    output: typeof frame.output === 'string' ? frame.output : undefined,
  };
  return out;
}

/**
 * P0-1 part 2 — per-message-scoped sub_agent_started reducer.
 *
 * Per-message map keyed by active assistant messageId so older message
 * bubbles re-render with their OWN sub-agent cards instead of the latest
 * session-global snapshot.
 *
 * Drops malformed payloads (empty messageId or empty role) silently.
 */
export function applySubAgentStartedScoped(
  map: Record<string, SubAgentEntry[]>,
  messageId: string,
  frame: SubAgentStartedFrame,
): Record<string, SubAgentEntry[]> {
  if (!messageId) return map;
  const role = typeof frame.role === 'string' ? frame.role : '';
  if (!role) return map;
  const entry: SubAgentEntry = {
    role,
    description: typeof frame.description === 'string' ? frame.description : null,
    model: typeof frame.model === 'string' ? frame.model : null,
    status: 'running',
  };
  const existing = map[messageId] ?? [];
  return {
    ...map,
    [messageId]: [...existing, entry],
  };
}

/**
 * P0-1 part 2 — per-message-scoped sub_agent_completed reducer. Flips the
 * matching running entry to ok|err with stats. Returns input unchanged on
 * empty messageId, no map entry, or no matching running entry by role.
 */
export function applySubAgentCompletedScoped(
  map: Record<string, SubAgentEntry[]>,
  messageId: string,
  frame: SubAgentCompletedFrame,
): Record<string, SubAgentEntry[]> {
  if (!messageId) return map;
  const role = typeof frame.role === 'string' ? frame.role : '';
  if (!role) return map;
  const list = map[messageId];
  if (!list || list.length === 0) return map;
  const idx = list.findIndex((e) => e.role === role && e.status === 'running');
  if (idx < 0) return map;
  const next = [...list];
  next[idx] = {
    ...next[idx],
    status: frame.ok ? 'ok' : 'error',
    stats: {
      turns: typeof frame.turns === 'number' ? frame.turns : 0,
      tokens: typeof frame.tokens === 'number' ? frame.tokens : 0,
      wallMs: typeof frame.durationMs === 'number' ? frame.durationMs : 0,
      toolsUsed: Array.isArray(frame.toolsUsed) ? frame.toolsUsed : undefined,
    },
    error: typeof frame.error === 'string' ? frame.error : null,
    output: typeof frame.output === 'string' ? frame.output : undefined,
  };
  return { ...map, [messageId]: next };
}

/**
 * #502 case-statement glue extracted as a pure dispatcher so the
 * "type-label + safeData coercion" wire-up gets unit-test coverage
 * without renderHook'ing the full SSE / fetch / auth stack.
 */
export function dispatchSubAgentFrame(
  frameType: string,
  safeData: any,
  prev: SubAgentEntry[],
): { subAgents: SubAgentEntry[] } {
  if (frameType === 'sub_agent_started') {
    return {
      subAgents: applySubAgentStarted(prev, {
        type: 'sub_agent_started',
        role: typeof safeData?.role === 'string' ? safeData.role : '',
        description:
          typeof safeData?.description === 'string'
            ? safeData.description
            : undefined,
        model: typeof safeData?.model === 'string' ? safeData.model : null,
        session_id:
          typeof safeData?.session_id === 'string'
            ? safeData.session_id
            : undefined,
      }),
    };
  }
  if (frameType === 'sub_agent_completed') {
    return {
      subAgents: applySubAgentCompleted(prev, {
        type: 'sub_agent_completed',
        role: typeof safeData?.role === 'string' ? safeData.role : '',
        ok: safeData?.ok === true,
        error: typeof safeData?.error === 'string' ? safeData.error : null,
        turns: typeof safeData?.turns === 'number' ? safeData.turns : 0,
        tokens: typeof safeData?.tokens === 'number' ? safeData.tokens : 0,
        durationMs:
          typeof safeData?.durationMs === 'number' ? safeData.durationMs : 0,
        toolsUsed: Array.isArray(safeData?.toolsUsed)
          ? safeData.toolsUsed
          : undefined,
        // Phase 16 wire-unwrap fix — forward the sub-agent's actual return
        // content. Without this, the reducer would receive `output:
        // undefined` and SubAgentCard falls back to "X turns Y tok".
        output: typeof safeData?.output === 'string' ? safeData.output : undefined,
      }),
    };
  }
  // Unknown frame type — return inputs by reference.
  return { subAgents: prev };
}

export interface McpApprovalRequest {
  requestId: string;
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  timeoutMs: number;
}

// Multi-model orchestration event - flexible type for various event shapes
export interface MultiModelEvent {
  type: string;
  orchestrationId?: string;
  executionPlan?: string[];
  fromModel?: string;
  toModel?: string;
  role?: string;
  rolesExecuted?: string[];
  totalCost?: number;
  model?: string;
  content?: string;
  fromRole?: string;
  toRole?: string;
  handoffCount?: number;
  totalDuration?: number;
  error?: string;
  agents?: any[];
  strategy?: string;
  metrics?: any;
  [key: string]: any; // Allow additional properties for extensibility
}

export interface UseSSEChatOptions {
  sessionId: string;
  onMessage?: (message: ChatMessage) => void;
  onToolExecution?: (tool: any) => void;
  onToolApprovalRequest?: (data: { tools: any[]; toolCallRound: number; messageId: string }) => void;
  onMcpApprovalRequest?: (data: McpApprovalRequest) => void;
  onError?: (error: Error) => void;
  onThinking?: (status: string) => void;
  onThinkingContent?: (content: string, tokens?: number) => void;  // For actual thinking content
  onThinkingComplete?: () => void;  // When thinking finishes
  onMultiModel?: (event: MultiModelEvent) => void;  // Multi-model orchestration events
  onStream?: (content: string) => void;
  onPipelineStage?: (stage: PipelineStage, data?: any) => void;
  onToolRound?: (round: number, maxRounds: number) => void;
  onSessionTitleUpdated?: (sessionId: string, title: string) => void;  // AI-generated session title
  autoApproveTools?: boolean;
  // #473 — caller (ChatContainer) supplies the client-side placeholder id
  // for the in-flight assistant message. Wave 3 (#525) intent_classified
  // / tool_shortlist frames flush into per-message maps under this id so
  // ChatMessages can find them via message.id (which is the placeholder,
  // NOT the DB CUID from message_saved). Optional for back-compat — when
  // absent, flush falls back to the wire messageId (legacy behavior).
  getAssistantPlaceholderId?: () => string | null;
}

export const useChatStream = ({
  sessionId,
  onMessage,
  onToolExecution,
  onToolApprovalRequest,
  onMcpApprovalRequest,
  onError,
  onThinking,
  onThinkingContent,
  onThinkingComplete,
  onMultiModel,
  onStream,
  onPipelineStage,
  onToolRound,
  onSessionTitleUpdated,
  autoApproveTools = false, // HITM enforced: tools always require user approval
  getAssistantPlaceholderId,
}: UseSSEChatOptions) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [isThinkingCompleted, setIsThinkingCompleted] = useState(false); // Tracks if thinking phase has finished
  const currentThinkingRef = useRef(''); // Ref to capture thinking at message completion time

  // Interleaved content blocks - renders thinking/text in order
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const contentBlocksRef = useRef<ContentBlock[]>([]); // Ref for closure access

  const canonicalReducerStateRef = useRef<FrameState>(initialFrameState());
  const [canonicalReducerState, setCanonicalReducerState] = useState<FrameState>(
    () => initialFrameState(),
  );
  const blockIndexOffsetRef = useRef<number>(0); // Offset for multi-round tool loops (prevents index collision)
  const currentThinkingBlockIndexRef = useRef<number | null>(null); // Track active thinking block for interleaved display
  const currentTextBlockIndexRef = useRef<number | null>(null); // Track active text block for interleaved display
  // Task #131 (Phase F₂) — parallel tool-call round grouping. Each
  // `tool_executing` arriving during an open round is stamped with the
  // current round number so N concurrent tool calls share one group.
  // A round opens on the FIRST tool_executing of a new batch and closes
  // when the first `tool_result` (or `tool_error`) lands; the next
  // tool_executing after a close starts a new round. This mirrors the
  // backend pattern where executeToolCalls fires all tool_executing
  // events upfront in a tight loop before awaiting Promise.allSettled.
  const toolCallRoundRef = useRef<number>(0);
  const inToolCallRoundRef = useRef<boolean>(false);
  const parallelSlotIndexRef = useRef<number>(0);
  const [thinkingMetrics, setThinkingMetrics] = useState<{
    tokens: number;
    elapsedMs: number;
    tokensPerSecond: number;
  } | null>(null);
  // Thinking budget tracking for real progress indicator
  const [thinkingBudget, setThinkingBudget] = useState<number>(0);
  const [thinkingPhase, setThinkingPhase] = useState<'thinking' | 'tools' | 'generating'>('thinking');
  const previousSessionIdRef = useRef<string | null>(null); // Track session changes
  // TTFT (Time to First Token) tracking for debugging slow responses
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  // LiveTurnStatus — ms timestamp when the user submitted the current turn.
  // Captured when isStreaming flips true. Stays set while streaming so the
  // ticking elapsed counter stays steady; cleared when stream completes (or
  // immediately on next sendMessage).
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  // LiveTurnStatus — running token counters that update on every NDJSON
  // delta. tokensOut grows as text/thinking_delta frames arrive; tokensIn
  // is set once when message_received reports prompt size + bumped if a
  // mid-turn usage frame fires. activity is a SHORT human-readable
  // summary (e.g. "thinking", "calling azure_list_subscriptions",
  // "rendering kpi_grid"). All three are zeroed on each new turn.
  const [liveTokensIn, setLiveTokensIn] = useState<number>(0);
  const [liveTokensOut, setLiveTokensOut] = useState<number>(0);
  const [liveActivity, setLiveActivity] = useState<string>('thinking');
  // Context compaction notification
  const [contextCompaction, setContextCompaction] = useState<{
    freedPercent: number;
    tokensFreed: number;
    compactionLevel: string;
  } | null>(null);
  // v0.6.7 fix 2 — running cost in USD accumulated from server cost_delta
  // events. Resets to null on each new turn; CostPill consumes as a prop.
  const [runningCost, setRunningCost] = useState<number | null>(null);
  const runningCostRef = useRef<number | null>(null);
  // Normalized stream events (UNIFIED_STREAM=true path)
  const [normalizedEvents, setNormalizedEvents] = useState<NormalizedStreamEvent[]>([]);
  const normalizedEventsRef = useRef<NormalizedStreamEvent[]>([]);
  // Slice G.4b — counter for synthetic canonical `content_block_*` events
  // bridged from envelope events (agent_thinking, agent_tool_call,
  // agent_tool_result). Started high to avoid colliding with wire-emitted
  // `index` values from the api side. Used as `index` on the synthesized
  // `content_block_start` / `content_block_stop` so buildTree's blockIndex
  // map can pair them. Each synthesized block consumes one value.
  const syntheticBlockIndexRef = useRef<number>(100000);

  // ═══════════════════════════════════════════════════════════════════
  // Phase G (task #152) — trust/observability event buffers.
  // Each slot accumulates the latest payload (or the running list) from
  // the corresponding NDJSON event. Consumers read these and render the
  // small components under `components/events/*`.
  // ═══════════════════════════════════════════════════════════════════
  const [handoffEvent, setHandoffEvent] = useState<{
    fromModel?: string;
    toModel?: string;
    fromRole?: string;
    toRole?: string;
    reason?: string;
    complexityScore?: number;
    routeEscalatedDestructive?: boolean;
  } | null>(null);
  const [retryEvents, setRetryEvents] = useState<Array<{
    toolCallId?: string;
    name?: string;
    attempt: number;
    maxAttempts: number;
    reason?: string;
    elapsedMs?: number;
  }>>([]);
  const [currentStage, setCurrentStage] = useState<
    'discover' | 'query' | 'analyze' | 'generate' | 'verify' | null
  >(null);
  const stageTimingsRef = useRef<Partial<Record<
    'discover' | 'query' | 'analyze' | 'generate' | 'verify',
    number
  >>>({});
  const [stageTimings, setStageTimings] = useState<Partial<Record<
    'discover' | 'query' | 'analyze' | 'generate' | 'verify',
    number
  >>>({});
  const [ragCitations, setRagCitations] = useState<Array<{
    source: string;
    chunkId?: string;
    excerpt?: string;
    score?: number;
    collection?: string;
    url?: string;
  }>>([]);
  const [correctionEvent, setCorrectionEvent] = useState<{
    wrongText: string;
    correctedText: string;
    reason?: string;
  } | null>(null);
  const [warnings, setWarnings] = useState<Array<{
    id: string;
    level: 'info' | 'warn' | 'error';
    source?: string;
    code?: string;
    message: string;
    actionable?: string;
  }>>([]);
  const [ragStatus, setRagStatus] = useState<{
    status?: string;
    docsRetrieved?: number;
    collections?: string[];
    retrievalTimeMs?: number;
  } | null>(null);
  const [memoryStatus, setMemoryStatus] = useState<{
    status?: string;
    contextInjected?: boolean;
    tokenEstimate?: number;
    processingTime?: number;
    memoriesFound?: number;
  } | null>(null);
  const [dlpScan, setDlpScan] = useState<{
    state: 'scanning' | 'passed' | 'redacted' | 'blocked';
    severity?: string;
    categories?: string[];
    findings?: number;
    scanPoint?: string;
    reason?: string;
  } | null>(null);
  // Per-tool cache hit marks (keyed by tool name). UI reads to stamp
  // the badge on the corresponding tool card.
  const [toolCacheHits, setToolCacheHits] = useState<Record<string, {
    similarity?: number;
  }>>({});
  const [selfCritique, setSelfCritique] = useState<{
    critique?: string;
    contradictions?: number;
    lowestConfidence?: number;
    status?: string;
  } | null>(null);
  const [hallucinationWarning, setHallucinationWarning] = useState<{
    confidence?: number;
    message?: string;
    warningCount?: number;
    revised?: boolean;
    toolCount?: number;
  } | null>(null);

  // ═══════════════════════════════════════════════════════════════════
  // Phase H (task #153) — artifact / image-gen / session / memory state.
  // Distinct from Phase G because these slots feed five separate UI
  // surfaces (ArtifactPanel, inline image thumb, memory pill,
  // session-rename morph, context-compacted notice).
  // ═══════════════════════════════════════════════════════════════════
  type ArtifactPanelSlot = {
    artifactId: string | null;
    kind: 'markdown' | 'code' | 'chart' | 'csv';
    title: string;
    language?: string;
    fileName?: string;
    files: Record<string, { fileName: string; language?: string; content: string; lastSeq: number }>;
    isOpen: boolean;
    isComplete: boolean;
    stats?: { bytes: number; lines: number } | null;
  };
  const [artifactPanel, setArtifactPanel] = useState<ArtifactPanelSlot | null>(null);

  // E2E/Playwright proof hook — expose a window function that drives the
  // same reducer path used by real NDJSON `artifact_open` / `artifact_delta` /
  // `artifact_close` events. Zero-op in normal use; only our evidence
  // verifier invokes it. Defined unconditionally so prod proofs can
  // re-verify after deploy. SAFETY: only mutates local UI state; no
  // network effect, no auth bypass.
  useEffect(() => {
    (window as unknown as { __awArtifactStreamInject?: (events: Array<Record<string, unknown>>) => void }).__awArtifactStreamInject = (events) => {
      for (const evt of events) {
        const data = evt as Record<string, unknown>;
        const type = String(data.type || '');
        if (type === 'artifact_open') {
          const artId = String(data.artifactId || `art-${Date.now()}`);
          const defaultFile = String(data.fileName || '__default__');
          const kindRaw = String(data.kind || 'code');
          const kind: ArtifactPanelSlot['kind'] =
            kindRaw === 'markdown' || kindRaw === 'code' ||
            kindRaw === 'chart' || kindRaw === 'csv' ? kindRaw : 'code';
          setArtifactPanel({
            artifactId: artId,
            kind,
            title: String(data.title || 'Artifact'),
            language: (data.language as string) || undefined,
            fileName: (data.fileName as string) || undefined,
            files: {
              [defaultFile]: {
                fileName: defaultFile,
                language: (data.language as string) || undefined,
                content: '',
                lastSeq: -1,
              },
            },
            isOpen: true,
            isComplete: false,
            stats: null,
          });
        } else if (type === 'artifact_delta') {
          setArtifactPanel(prev => {
            if (!prev || prev.artifactId !== data.artifactId) return prev;
            const fileName = String(data.fileName || '__default__');
            const files = { ...prev.files };
            const existing = files[fileName] ?? {
              fileName,
              language: undefined as string | undefined,
              content: '',
              lastSeq: -1,
            };
            const incomingSeq = typeof data.seq === 'number'
              ? (data.seq as number) : existing.lastSeq + 1;
            if (incomingSeq <= existing.lastSeq && existing.lastSeq >= 0) return prev;
            files[fileName] = {
              ...existing,
              language: existing.language || (data.language as string) || undefined,
              content: existing.content + String(data.contentDelta || ''),
              lastSeq: incomingSeq,
            };
            return { ...prev, files };
          });
        } else if (type === 'artifact_close') {
          setArtifactPanel(prev => {
            if (!prev || prev.artifactId !== data.artifactId) return prev;
            return {
              ...prev,
              isComplete: true,
              stats: (data.stats as { bytes: number; lines: number }) || null,
            };
          });
        } else if (type === 'reset') {
          setArtifactPanel(null);
        }
      }
    };
    return () => {
      delete (window as unknown as { __awArtifactStreamInject?: unknown }).__awArtifactStreamInject;
    };
  }, []);
  const [imageProgress, setImageProgress] = useState<{
    imageGenId: string;
    progress: number;
    partialUrl?: string;
    eta?: number;
    prompt?: string;
  } | null>(null);

  // visual_render / app_render / artifact_render frames now route through
  // the typed-block path (ContentBlock of type 'viz_render' / 'app_render')
  // via applyCanonicalFrame so artifacts render INLINE at the wire-emit
  // chronological position inside AgenticActivityStream. The legacy
  // parent-level state arrays + out-of-band sidecars are ripped.
  const [memoryWrites, setMemoryWrites] = useState<Array<{
    key: string;
    summary: string;
    scope: 'user' | 'session' | 'shared';
    entryId?: string;
    tokenCount?: number;
  }>>([]);
  const [sessionRename, setSessionRename] = useState<{
    sessionId: string;
    from: string;
    to: string;
    reason: 'auto-title' | 'manual' | 'summary';
  } | null>(null);

  // ═══════════════════════════════════════════════════════════════════
  // Wave 3 (#525) — per-message intent_classified + tool_shortlist state.
  // Both frames fire from prompt.stage BEFORE the assistant's
  // message_saved (#473 ordering). Buffer-then-flush on assistant role
  // using the React placeholder id (NOT the DB CUID).
  // ═══════════════════════════════════════════════════════════════════
  const [intentClassifications, setIntentClassifications] = useState<
    Record<string, IntentClassification>
  >({});
  const [toolShortlists, setToolShortlists] = useState<
    Record<string, ToolShortlist>
  >({});
  const pendingIntentClassifiedRef = useRef<IntentClassification | null>(null);
  const pendingToolShortlistRef = useRef<ToolShortlist | null>(null);

  // ═══════════════════════════════════════════════════════════════════
  // #502 — sub-agent state. Driven by sub_agent_started / sub_agent_completed
  // NDJSON envelopes emitted by services/openagentic-api/src/services/TaskTool.ts
  // (Phase E2). One entry per dispatched sub-agent, status flips
  // running -> ok|error on completion. Consumed by ChatMessages ->
  // SubAgentCard. Mock 01 lines 1083-1133 reference layout.
  // ═══════════════════════════════════════════════════════════════════
  const [subAgents, setSubAgents] = useState<SubAgentEntry[]>([]);
  // P0-1 part 2 — per-message scoping. The flat `subAgents` array stays
  // for backwards compat (any consumer still reading the union); the new
  // map is what ChatMessages threads into each MessageBubble so older
  // message bubbles render their OWN sub-agent cards, not the latest
  // session-global snapshot. Keyed by the active assistant messageId
  // (uses `getAssistantPlaceholderId?.()`).
  const [subAgentsByMessageId, setSubAgentsByMessageId] = useState<
    Record<string, SubAgentEntry[]>
  >({});
  // P1-6 — per-message streaming-table state. Keyed by the active
  // assistant messageId (same flush-key strategy as subAgentsByMessageId).
  // Each table is keyed by artifact_id within the message; hot-swap on
  // re-emit, append otherwise. Pure reducer at
  // useChatStream.streamingTable.test.ts.
  const [streamingTablesByMessageId, setStreamingTablesByMessageId] = useState<
    Record<string, StreamingTable[]>
  >({});

  // Phase 27 — per-message findings artifacts (mocks 03, 07, 08, 09).
  // Server emits `findings_emit` from security/audit sub-agent results.
  const [findingsByMessageId, setFindingsByMessageId] = useState<
    Record<string, FindingsArtifact[]>
  >({});

  // #502 — per-message inline widgets (kpi_grid / savings_card / runbook
  // / wave_timeline / stack_grid / stages_strip / annotated_code). One
  // unified `inline_widget` frame; reducer pure-tested at
  // useChatStream.inlineWidget.test.ts.
  const [inlineWidgetsByMessageId, setInlineWidgetsByMessageId] = useState<
    Record<string, InlineWidget[]>
  >({});

  // AC-B — per-message synth lifecycle entries. One Synth per
  // artifactId accumulates through the 8 lifecycle frames the API
  // streams as the model authors + executes Python in synth-executor.
  // Reducer pure-tested at useChatStream.synthLifecycle.test.ts.
  const [synthsByMessageId, setSynthsByMessageId] = useState<
    Record<string, Synth[]>
  >({});

  // AC-D — per-message clickable download tiles. Server emits
  // artifact_emit when synth-executor finishes writing bytes to
  // UserStorageService. Reducer pure-tested at
  // useChatStream.artifactEmit.test.ts.
  const [artifactEmitsByMessageId, setArtifactEmitsByMessageId] = useState<
    Record<string, ArtifactEmit[]>
  >({});

  // follow-up chip row ripped 2026-05-12 (user directive — chips were
  // generic placeholders, never reflected actual conversation data).

  // Audit §10 step 16 — HITL approval card. Server emits `hitl_approval`
  // (or legacy `mcp_approval_required`) when a write-tier tool needs
  // operator approval. UI renders an inline card with Approve/Deny
  // (mocks #9 HIPAA remediation, #15 secret rotation).
  const [hitlApprovalsByMessageId, setHitlApprovalsByMessageId] = useState<
    Record<
      string,
      Array<{
        requestId: string;
        toolName: string;
        serverName?: string;
        reason: string;
        timeoutMs: number;
        arguments?: unknown;
        status: 'pending' | 'approved' | 'denied' | 'expired';
        /** HITL.3 — set for sub-agent HITL frames from openagentic-proxy bridge (HITL.2). */
        parentToolUseId?: string;
      }>
    >
  >({});

  // B8 (2026-05-12) — content_filter compliance banner per-message slot.
  // Server's chatLoop emits a `content_filter` frame (kind, model,
  // message) when canonical stop_reason='content_filter' / 'safety' /
  // 'recitation' fires. UI renders <ContentFilterBanner> inline so the
  // operator sees a distinct compliance signal instead of an empty
  // bubble. FedRAMP-Hi audit requires this surfaces to the user.
  // Spec: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md §1.4
  const [contentFilterBannerByMessageId, setContentFilterBannerByMessageId] = useState<
    Record<string, { kind: string; model: string; message: string }>
  >({});

  // ═══════════════════════════════════════════════════════════════════
  // Phase I (task #154) — durable-stream resume state.
  //   - `resumeTurnIdRef` captures the server-supplied turnId from the
  //     stream_start frame. Used by the retry-after-drop path as the
  //     tail endpoint's query param.
  //   - `lastSeqRef` tracks the highest `_seq` we've seen this turn so
  //     dedupe on resume skips frames we already handled.
  //   - `seenSeqsRef` tracks EVERY _seq seen for the current turn so we
  //     can drop duplicates from the tail endpoint even if they arrive
  //     out of order with respect to lastSeqRef (network reorder).
  //   - `reconnectedPill` shows a brief "↻ Reconnected" chip for 2s on
  //     successful resume so the user has a visible confirmation.
  // ═══════════════════════════════════════════════════════════════════
  const resumeTurnIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef<number>(0);
  const seenSeqsRef = useRef<Set<number>>(new Set());
  const [reconnectedPill, setReconnectedPill] = useState<{ at: number } | null>(null);

  // Chain of Thought steps for COT UI display
  const [cotSteps, setCotSteps] = useState<Array<{
    id: string;
    type: 'thinking' | 'tool_call' | 'rag_lookup' | 'fetch' | 'memory' | 'reasoning';
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    startTime?: number;
    endTime?: number;
    request?: any;
    response?: any;
    error?: string;
  }>>([]);
  // Ref to capture cotSteps at message completion time (for closure access)
  const cotStepsRef = useRef<typeof cotSteps>([]);
  const [pipelineState, setPipelineState] = useState<PipelineState>(createInitialPipelineState);
  const abortControllerRef = useRef<AbortController | null>(null);
  // #940 — Wall-clock ms timestamp of the last NDJSON frame the chat
  // stream received. Updated by the chunk-decode site in the fetch loop
  // (see `resetStreamTimeout()` adjacent — frames bump that timer for
  // the 5-minute idle-timeout, AND now this ref for the 60s stale-frame
  // watchdog that clears the ThinkingSphere if the connection silently
  // dies). `null` means "no active stream" / "watchdog idle".
  const lastFrameAtRef = useRef<number | null>(null);
  const { getAccessToken, user } = useAuth();
  const [animationMode, setAnimationMode] = useState<AnimationMode>(getAnimationMode());

  // Keep refs in sync with state for capturing at completion time
  useEffect(() => {
    currentThinkingRef.current = currentThinking;
  }, [currentThinking]);

  // Keep cotSteps ref in sync for closure access in done handler
  useEffect(() => {
    cotStepsRef.current = cotSteps;
  }, [cotSteps]);

  // Keep contentBlocks ref in sync for closure access
  useEffect(() => {
    contentBlocksRef.current = contentBlocks;
  }, [contentBlocks]);

  // CRITICAL FIX: Abort active stream AND reset state when session changes
  // This prevents messages from bleeding between sessions
  useEffect(() => {
    if (previousSessionIdRef.current !== null && previousSessionIdRef.current !== sessionId) {
      // Session changed — IMMEDIATELY abort any running stream
      if (abortControllerRef.current) {
        console.warn('[SSE] Session changed while stream active — ABORTING old stream:', {
          from: previousSessionIdRef.current,
          to: sessionId
        });
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      // Reset all thinking/streaming state
      setCurrentThinking('');
      setCurrentMessage('');
      setIsThinkingCompleted(false);
      setThinkingMetrics(null);
      setCotSteps([]);
      setContentBlocks([]);
      canonicalReducerStateRef.current = initialFrameState();
      setCanonicalReducerState(initialFrameState());
      setPipelineState(createInitialPipelineState());
      currentThinkingRef.current = '';
      cotStepsRef.current = [];
      contentBlocksRef.current = [];
      currentThinkingBlockIndexRef.current = null;
      currentTextBlockIndexRef.current = null;
      // Clear normalized stream events from previous session — these feed
      // MessageBubble's AgenticActivityStream and would otherwise render the
      // old session's agent cards in the new session ("ghost agents" bug).
      setNormalizedEvents([]);
      normalizedEventsRef.current = [];
      // Clear the global agent tree store — same reason. The store is keyed
      // by executionId and is NOT session-scoped, so without an explicit clear
      // the previous session's trees persist until the next stream finishes.
      useAgentTreeStore.getState().clearAllTrees();
      // Phase G — drop observability state on session change so the pills
      // from session A don't ghost into session B.
      setHandoffEvent(null);
      setRetryEvents([]);
      setCurrentStage(null);
      stageTimingsRef.current = {};
      setStageTimings({});
      setRagCitations([]);
      setCorrectionEvent(null);
      setWarnings([]);
      setRagStatus(null);
      setMemoryStatus(null);
      setDlpScan(null);
      setToolCacheHits({});
      setSelfCritique(null);
      setHallucinationWarning(null);
      // Phase H (task #153) — drop artifact/image/memory/session state
      // so panels from session A don't ghost into session B.
      setArtifactPanel(null);
      setImageProgress(null);
      setMemoryWrites([]);
      setSessionRename(null);
      // Wave 3 (#525) — drop intent classifications + tool shortlists on
      // session switch, including buffered pendings.
      setIntentClassifications({});
      setToolShortlists({});
      pendingIntentClassifiedRef.current = null;
      pendingToolShortlistRef.current = null;
      // P0-1 of chatmode UX parity (2026-04-30) — sub-agent cards from
      // session A used to bleed into session B because the SubAgentEntry[]
      // reducer keys by role, not sessionId. New sessions start empty;
      // any prior session's cards must be dropped here. See
      // docs/superpowers/specs/2026-04-30-chatmode-ux-parity-punchlist.md (P0-1).
      setSubAgents([]);
      // P0-1 part 2 — drop the per-message scoped map too on session switch.
      setSubAgentsByMessageId({});
      // P1-6 — drop streaming-table per-message map on session switch
      // alongside the rest of the session-scoped state.
      setStreamingTablesByMessageId({});
      setFindingsByMessageId({});
      setInlineWidgetsByMessageId({});
      setSynthsByMessageId({});
      setArtifactEmitsByMessageId({});
      // Audit §10 step 16 — drop HITL map on session switch.
      // (follow-up chip row ripped 2026-05-12 — user directive.)
      setHitlApprovalsByMessageId({});
      // B8 — drop content_filter banners on session switch.
      setContentFilterBannerByMessageId({});
      // Phase I (task #154) — drop resume cursors when switching sessions.
      resumeTurnIdRef.current = null;
      lastSeqRef.current = 0;
      seenSeqsRef.current = new Set();
      setReconnectedPill(null);
      // #940 — orphan ThinkingSphere on session change.
      // MessageBubble.tsx renders the animated <ThinkingSphere> keyed on
      // `isStreaming` — when that flag stays true after the user switches
      // chats, the previous session's sphere keeps spinning on top of the
      // (now wrong) active session. Customer-visible: "AI looks like it's
      // still working but the session changed." Fix is to ALSO clear the
      // live-turn slice here, AFTER the abort above so a stray frame can't
      // flip it back on. Keeps `setIsStreaming(false)` PHYSICALLY AFTER the
      // `abortControllerRef.current.abort()` call (test enforces order).
      setIsStreaming(false);
      setTurnStartedAt(null);
      setLiveTokensIn(0);
      setLiveTokensOut(0);
      setLiveActivity('thinking');
      setThinkingPhase('thinking');
      setTtftMs(null);
      lastFrameAtRef.current = null;
    }
    previousSessionIdRef.current = sessionId;
  }, [sessionId]);

  // #940 — unmount cleanup: closing the window or navigating away from
  // the chat page must abort the in-flight stream and flip `isStreaming`
  // off so the next mount does not hydrate with an orphan ThinkingSphere.
  // Without this, a half-streaming hook leaves the AbortController + the
  // streaming flag dangling on the React tree until garbage collection.
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsStreaming(false);
      lastFrameAtRef.current = null;
    };
  }, []);

  // #940 — stale-frame watchdog. If `isStreaming === true` but no frame
  // has arrived in the last STREAM_STALE_MS, the upstream stream is
  // silently dead (network drop, provider hang, abort-race). Clear the
  // streaming flag so the ThinkingSphere stops animating. This is a
  // belt-and-suspenders guard on top of the 5-minute idle-timeout in
  // the fetch loop: the watchdog runs continuously (every 5s) regardless
  // of whether the fetch promise is alive, so it rescues users from
  // truly stuck UIs (e.g. tab thrown to background, browser killed the
  // fetch, controller never aborted).
  const STREAM_STALE_MS = 60_000; // 60s of frame silence = stale
  useEffect(() => {
    if (!isStreaming) {
      lastFrameAtRef.current = null;
      return;
    }
    // Mark start-of-stream so the watchdog has a baseline.
    if (lastFrameAtRef.current === null) {
      lastFrameAtRef.current = Date.now();
    }
    const intervalId = setInterval(() => {
      const last = lastFrameAtRef.current;
      if (last === null) return;
      if (Date.now() - last > STREAM_STALE_MS) {
        console.warn('[SSE] stale-frame watchdog tripped — clearing isStreaming after', Date.now() - last, 'ms of silence');
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        setIsStreaming(false);
        setLiveActivity('thinking');
        lastFrameAtRef.current = null;
      }
    }, 5_000);
    return () => clearInterval(intervalId);
  }, [isStreaming]);

  const sendMessage = useCallback(async (
    message: string,
    options?: {
      model?: string;
      enabledTools?: string[];
      files?: any[];
      promptTechniques?: string[];
      enableExtendedThinking?: boolean;
      flowContext?: any;
      artifactContext?: { content: string; title: string; type: string };
    }
  ) => {
    // Critical debug logging
    // console.log('[SSE] sendMessage called with:', { message, sessionId, options });
    
    // Validate sessionId before attempting to send
    if (!sessionId || sessionId.trim() === '') {
      console.error('[SSE] Cannot send message - no sessionId provided');
      setIsStreaming(false);
      if (onError) {
        onError(new Error('No session ID provided'));
      }
      return;
    }

    // Phase 13 (2026-04-30) — sub-agent cards stick to the bottom of the
    // session unless we drop the flat `subAgents` array between turns.
    // The per-message-scoped map (`subAgentsByMessageId`) is the SoT for
    // showing prior turns' cards in their original location; the flat
    // array is only the in-flight scratchpad. Reset it on every new
    // sendMessage so completed sub-agents from turn N don't bleed into
    // turn N+1's bubble.
    setSubAgents([]);

    // CRITICAL FIX: Save current streaming message BEFORE clearing it
    // If there's a streaming message in progress, finalize it first to prevent message loss
    if (currentMessage && onMessage) {
      // console.log('[SSE] Finalizing previous streaming message before starting new one');
      onMessage({
        id: `streaming_${Date.now()}`,
        role: 'assistant',
        content: currentMessage,
        timestamp: new Date().toISOString(),
        mcpCalls: [],
        metadata: { streamingInterrupted: true }
      });
    }

    // Abort any existing stream and wait briefly to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      // Small delay to ensure cleanup is complete before creating new controller
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Create new abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Additional safety check - if the controller was somehow aborted immediately, recreate it
    if (abortController.signal.aborted) {
      // console.warn('[SSE] AbortController was aborted immediately, creating new one');
      const newController = new AbortController();
      abortControllerRef.current = newController;
    }

    setIsStreaming(true);
    // LiveTurnStatus — capture turn-start ts so the strip can render an
    // elapsed ticking counter under the streaming assistant avatar.
    setTurnStartedAt(Date.now());
    setLiveTokensIn(0);
    setLiveTokensOut(0);
    setLiveActivity('thinking');
    setCurrentMessage('');
    setCurrentThinking('');
    setContentBlocks([]); // Reset interleaved content blocks for new message
    contentBlocksRef.current = [];
    canonicalReducerStateRef.current = initialFrameState();
    setCanonicalReducerState(initialFrameState());
    blockIndexOffsetRef.current = 0; // Reset block index offset for new message
    setIsThinkingCompleted(false); // Reset thinking completion flag
    setThinkingMetrics(null);
    setThinkingBudget(0); // Reset thinking budget
    setThinkingPhase('thinking'); // Reset phase
    setTtftMs(null); // Reset TTFT for new message
    setRunningCost(null); // v0.6.7 fix 2 — reset running cost each turn
    runningCostRef.current = null;
    setCotSteps([]); // Clear COT steps for new message
    setPipelineState(createInitialPipelineState());
    normalizedEventsRef.current = [];
    setNormalizedEvents([]);
    // Phase G (task #152) — reset observability slots for the new turn.
    setHandoffEvent(null);
    setRetryEvents([]);
    setCurrentStage(null);
    stageTimingsRef.current = {};
    setStageTimings({});
    setRagCitations([]);
    setCorrectionEvent(null);
    setWarnings([]);
    setRagStatus(null);
    setMemoryStatus(null);
    setDlpScan(null);
    setToolCacheHits({});
    setSelfCritique(null);
    setHallucinationWarning(null);
    // Phase H (task #153) — reset artifact / image / memory / rename
    // slots for the new turn. memoryWrites is turn-scoped so each turn's
    // "Remembered" pill belongs to that turn only.
    setArtifactPanel(null);
    setImageProgress(null);
    setMemoryWrites([]);
    setSessionRename(null);
    // Phase I (task #154) — reset durable-resume tracking for the new turn.
    resumeTurnIdRef.current = null;
    lastSeqRef.current = 0;
    seenSeqsRef.current = new Set();
    setReconnectedPill(null);

    let hasReportedError = false;
    let hasCompletedStream = false;

    try {
      // Get access token - try multiple auth methods
      let token;
      try {
        token = await getAccessToken(['User.Read']);
      } catch (error) {
        console.error('[SSE] getAccessToken failed:', error);
        // Fallback to manual token retrieval (try all known key names + cookie)
        token = localStorage.getItem('accessToken') || localStorage.getItem('auth_token') || sessionStorage.getItem('accessToken');
        if (!token) {
          // Extract from cookie as last resort
          const match = document.cookie.match(/openagentic_token=([^;]+)/);
          if (match) token = match[1];
        }
      }
      
      if (!token) {
        console.error('[SSE] No authentication token available');
        throw new Error('Authentication required - no token available');
      }

      // Critical debug logging - always log this fetch attempt
      // console.log('[SSE] About to send fetch request to:', apiEndpoint('/chat/stream'), {
      //   sessionId,
      //   model: options?.model,
      //   hasToken: !!token,
      //   tokenLength: token?.length,
      //   userId: user?.id || user?.oid,
      //   fullPayload: {
      //     sessionId,
      //     message,
      //     model: options?.model,
      //     enabledTools: options?.enabledTools || [],
      //     autoApproveTools,
      //     files: options?.files,
      //     promptTechniques: options?.promptTechniques || []
      //   }
      // });

      // console.log('[SSE] FETCH REQUEST STARTING NOW - URL:', apiEndpoint('/chat/stream'));
      // console.log('[SSE] FETCH REQUEST HEADERS:', {
      //   'Content-Type': 'application/json',
      //   'Authorization': token ? `Bearer ${token.substring(0, 20)}...` : 'NO TOKEN',
      //   'x-user-id': user?.id || user?.oid
      // });
      
      const response = await fetch(apiEndpoint('/chat/stream'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-user-id': user?.id || user?.userId || '',
          // Don't let proxies cache the streamed response.
          'Cache-Control': 'no-cache',
          // v0.6.6: chat stream is NDJSON-only (SSE removed in BLOCKER-004).
          'Accept': 'application/x-ndjson',
        },
        body: JSON.stringify({
          sessionId,
          message,
          model: options?.model,
          enabledTools: options?.enabledTools || [],
          autoApproveTools,
          files: options?.files,
          promptTechniques: options?.promptTechniques || [],
          enableExtendedThinking: options?.enableExtendedThinking,
          flowContext: options?.flowContext,
          artifactContext: options?.artifactContext,
          // P1 #940 (2026-05-18) — grounding T1. When ON, the api injects
          // a system-prompt addendum instructing the model to verify
          // factual claims via the existing web_search MCP tool and emit
          // a final markdown verdict line. Pulled from the persisted
          // useGroundingStore (localStorage-backed) — no UI prop drilling.
          groundingEnabled: (() => {
            try {
              // Lazy global read so this hook stays free of cross-store
              // import order ambiguity at module-init time.
              const raw = localStorage.getItem('awp.grounding.v1');
              if (!raw) return false;
              const parsed = JSON.parse(raw);
              return Boolean(parsed?.state?.enabled);
            } catch {
              return false;
            }
          })(),
          // Z.ET (2026-05-19) — per-turn extended thinking toggle. When
          // the UI Brain toggle is OFF (extendedThinkingEnabled=false), the
          // api skips attaching a thinking budget even for capable models.
          // undefined (when store is empty) = ON (backwards-compatible).
          extendedThinkingEnabled: (() => {
            try {
              const raw = localStorage.getItem('openagentic:extended-thinking');
              if (!raw) return undefined; // Store not yet written → use server default (ON)
              const parsed = JSON.parse(raw);
              const enabled = parsed?.state?.enabled;
              // Only send false when explicitly turned off; omit otherwise
              // so the api's existing logic runs unmodified for undefined.
              return enabled === false ? false : undefined;
            } catch {
              return undefined; // Fallback: let server decide
            }
          })()
        }),
        signal: abortControllerRef.current?.signal,
        // CRITICAL: Disable browser caching for SSE
        cache: 'no-store'
      });
      
      // SSE response logging - disabled in production to reduce console noise
      // console.log('[SSE] FETCH REQUEST COMPLETED - Response received:', {
      //   status: response.status,
      //   ok: response.ok,
      //   statusText: response.statusText,
      //   contentType: response.headers.get('content-type'),
      //   hasBody: !!response.body
      // });

      // Log errors
      if (!response.ok) {
        console.error('[SSE] Response error:', {
          status: response.status,
          ok: response.ok
        });
      }
      
      if (!response.ok) {
        console.error('[SSE] HTTP ERROR - Response not ok:', {
          status: response.status,
          statusText: response.statusText
        });
        // Surface a specific message for size/auth errors instead of the
        // opaque "HTTP error! status: NNN" — most 413s on this endpoint are
        // a fallback inline-base64 attachment exceeding the API body cap
        // because pre-upload to MinIO failed earlier in the pipeline.
        if (response.status === 413) {
          throw new Error('Attachment too large to send (server returned 413). Please attach a smaller file (under 25 MB) or remove the attachment and try again.');
        }
        if (response.status === 401) {
          throw new Error('Your session has expired. Please refresh the page and sign in again.');
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No response body');
      }
      
      let assistantMessage = '';
      let messageId = '';
      let mcpCalls: any[] = [];
      let chunkCount = 0;
      let currentPipelineState = createInitialPipelineState();
      let hasCompletedStream = false; // Guard against duplicate done events
      let hasReportedError = false; // Guard against duplicate error messages (fixes 3x error display)
      let responseModel = options?.model || ''; // Track which model was used for this response (fallback to requested model)

      // Phase I (task #154) — durable-stream resume helper.
      // Minimal tail-replay consumer that handles the subset of events
      // needed to catch the user up to where the main stream got cut
      // off: content deltas (`stream` / `content_delta`), terminal
      // markers (`done`, `stream_complete`, `resume_exhausted`), and a
      // safety `error` ticker. Frames the ring buffer replays retain
      // their full original payload — we just dedupe on `_seq` and
      // re-apply the critical subset. Other events (tool_progress,
      // thinking_delta) are observed + acknowledged but not re-rendered
      // on the post-reconnect path; the spec explicitly allows this
      // because the backend is correct whether the UI retries or not.
      const attemptTailResume = async (
        sid: string,
        tid: string,
        afterSeq: number,
        bearer: string,
        uid: string,
      ): Promise<void> => {
        const url = `${apiEndpoint('/chat/stream')}/${encodeURIComponent(sid)}/tail?turnId=${encodeURIComponent(tid)}&after=${encodeURIComponent(String(afterSeq))}`;
        const tailResp = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/x-ndjson',
            'Authorization': `Bearer ${bearer}`,
            'x-user-id': uid,
          },
          cache: 'no-store',
        });
        if (!tailResp.ok || !tailResp.body) {
          throw new Error(`tail HTTP ${tailResp.status}`);
        }
        const tailReader = tailResp.body.getReader();
        const tailDec = new TextDecoder();
        let tailBuf = '';
        let sawAnyFrame = false;

        while (true) {
          const { done: tDone, value: tVal } = await tailReader.read();
          if (tDone) break;
          tailBuf += tailDec.decode(tVal, { stream: true });
          const lines = tailBuf.split('\n');
          tailBuf = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            let frame: any;
            try {
              frame = JSON.parse(line);
            } catch {
              continue;
            }

            // Dedupe on _seq.
            if (typeof frame._seq === 'number') {
              if (seenSeqsRef.current.has(frame._seq)) continue;
              seenSeqsRef.current.add(frame._seq);
              if (frame._seq > lastSeqRef.current) {
                lastSeqRef.current = frame._seq;
              }
            }

            // First real frame → show the pill for 2s.
            if (!sawAnyFrame) {
              sawAnyFrame = true;
              const at = Date.now();
              setReconnectedPill({ at });
              setTimeout(() => {
                setReconnectedPill(p => (p?.at === at ? null : p));
              }, 2000);
            }

            const t = frame.type;
            if (t === 'stream' || t === 'content_delta' || t === 'delta') {
              const delta = frame.content || frame.delta || frame.text || '';
              if (typeof delta === 'string' && delta.length > 0) {
                assistantMessage += delta;
                setCurrentMessage(assistantMessage);
                onStream?.(delta);
              }
            } else if (t === 'done' || t === 'completion_complete' || t === 'stream_complete' || t === 'resume_exhausted') {
              hasCompletedStream = true;
              if (onMessage && assistantMessage.length > 0) {
                onMessage({
                  id: messageId || `tail_${Date.now()}`,
                  role: 'assistant',
                  content: assistantMessage,
                  timestamp: new Date().toISOString(),
                  mcpCalls,
                  metadata: { resumedFromTail: true, lastSeq: lastSeqRef.current },
                });
              }
              return;
            } else if (t === 'error') {
              if (!hasReportedError) {
                hasReportedError = true;
                const err = new Error(frame.message || 'stream resumed with error');
                err.name = frame.code || 'TailError';
                onError?.(err);
              }
              return;
            }
          }
        }
      };

      // Rolling idle timeout - resets on every received chunk/ping
      // This allows long-running agentic loops (tool calls, thinking) to run indefinitely
      // as long as the server keeps sending data (pings every 3s, tool events, content deltas)
      const STREAM_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes of INACTIVITY (not total time)
      let streamTimeoutId: ReturnType<typeof setTimeout>;
      const resetStreamTimeout = () => {
        clearTimeout(streamTimeoutId);
        streamTimeoutId = setTimeout(() => {
          abortControllerRef.current?.abort();
          onError?.(new Error('Stream timeout - no data received for 5 minutes'));
        }, STREAM_IDLE_TIMEOUT);
      };
      resetStreamTimeout();
      
      // Proper SSE parsing that doesn't break on JSON boundaries
      let buffer = '';
      let eventType = '';
      let eventData = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            clearTimeout(streamTimeoutId);
            if (import.meta.env.DEV) {
              // console.log('[SSE] Stream complete, total chunks:', chunkCount);
            }
            break;
          }
        
        chunkCount++;
        resetStreamTimeout(); // Reset idle timeout on every received chunk
        // #940 — also bump the stale-frame watchdog. A healthy stream
        // bumps this on every chunk; the 60s watchdog interval reads
        // this ref to decide if the stream has gone silent.
        lastFrameAtRef.current = Date.now();
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // v0.6.6: NDJSON-only wire format (BLOCKER-004). Each complete
        // line is one typed JSON object `{type: "...", ...payload}`. The
        // incomplete tail (no trailing `\n`) stays in `buffer` until the
        // next chunk arrives.
        const eventStrings = buffer.split('\n');
        buffer = eventStrings.pop() || '';

        for (const eventString of eventStrings) {
          if (!eventString.trim()) continue;

          let eventType: string | null = null;
          let eventData = eventString;
          try {
            const peek = JSON.parse(eventString);
            eventType = peek?.type || null;
          } catch {
            // Non-JSON line — will JSON.parse-fail again below and skip.
          }
          
          if (eventData) {
            try {
              // JSON.parse already returns fresh, extensible objects - no need to clone again
              const safeData = JSON.parse(eventData);

              // SSE event logging - disabled in production to reduce console noise
              // Enable by uncommenting for debugging streaming issues
              // console.log(`[SSE-DEBUG] Event received - Type: "${eventType}"`, safeData);

              // Only log specific events in dev when needed for debugging
              // if (import.meta.env.DEV && ['error', 'tool_call', 'pipeline', 'stream'].includes(eventType || '')) {
              //   console.log(`[SSE] Processing event: ${eventType}`, safeData);
              // }
              
              // Update pipeline state based on event
              const mappedStage = mapBackendStage(eventType || '');
              if (mappedStage && mappedStage !== currentPipelineState.currentStage) {
                // Stage transition
                if (currentPipelineState.currentStage && currentPipelineState.stageStartTime) {
                  const stageTime = Date.now() - currentPipelineState.stageStartTime;
                  currentPipelineState.stageTiming[currentPipelineState.currentStage] = stageTime;
                }

                currentPipelineState.currentStage = mappedStage;
                currentPipelineState.stageStartTime = Date.now();

                // Update tool execution phase detection
                currentPipelineState.isToolExecutionPhase = mappedStage === 'mcp';

                // Update content suppression
                currentPipelineState.shouldSuppressContent = shouldSuppressContentForStage(
                  mappedStage,
                  currentPipelineState.activeToolRound
                );

                setPipelineState({...currentPipelineState});
                onPipelineStage?.(mappedStage, safeData);
              }

              // Phase I (task #154) — durable-stream dedupe + cursor.
              // Every frame with `_seq` metadata is checked against
              // `seenSeqsRef`. If we've already processed it (replay
              // from /tail after a reconnect), skip the switch below.
              // Otherwise mark it seen + advance lastSeqRef.
              if (typeof safeData._seq === 'number') {
                if (seenSeqsRef.current.has(safeData._seq)) {
                  // Duplicate from a replay path — drop silently.
                  continue;
                }
                seenSeqsRef.current.add(safeData._seq);
                if (safeData._seq > lastSeqRef.current) {
                  lastSeqRef.current = safeData._seq;
                }
              }

              // Pure canonical reducer runs alongside the inline switch.
              // Skip the React commit when the reducer returns the same
              // state object — applyCanonicalFrame preserves identity
              // for frames it doesn't consume (ping, done, unknown).
              {
                const nextCanonical = applyCanonicalFrame(
                  canonicalReducerStateRef.current,
                  safeData as WireFrame,
                );
                if (nextCanonical !== canonicalReducerStateRef.current) {
                  canonicalReducerStateRef.current = nextCanonical;
                  setCanonicalReducerState(nextCanonical);
                }
                // Step 3 (2026-05-18) — publish the frame onto the
                // streamFrameBus so the optional StreamEngine wrapper
                // (gated by VITE_FEATURE_STREAM_ENGINE in MessageBubble)
                // can apply it to the engine's owned DOM container.
                // No-op when no subscribers are registered (flag OFF).
                publishStreamFrame(safeData as WireFrame);
              }

              switch (eventType) {
                case 'stream_start':
                  // Phase I — capture the turnId so an abrupt mid-turn
                  // disconnect can hit GET /api/chat/stream/:sessionId/tail
                  // with the right cursor.
                  if (typeof safeData.turnId === 'string' && safeData.turnId.length > 0) {
                    resumeTurnIdRef.current = safeData.turnId;
                  }
                  break;

                case 'resume_exhausted':
                  // Phase I — the tail endpoint just told us there are
                  // no more frames to replay (turn finalized or TTL
                  // expired). Treat identically to `stream_complete`
                  // so downstream callbacks finalize the message.
                  hasCompletedStream = true;
                  break;

                case 'message_received':
                  messageId = safeData.messageId;
                  // LiveTurnStatus — seed input tokens once if the server
                  // includes a prompt-size hint. Output tokens grow as
                  // text/thinking deltas arrive.
                  if (typeof safeData.promptTokens === 'number') {
                    setLiveTokensIn(safeData.promptTokens);
                  } else if (typeof safeData.inputTokens === 'number') {
                    setLiveTokensIn(safeData.inputTokens);
                  }
                  break;

                case 'ttft':
                  // Time to First Token - useful for debugging slow responses
                  // This measures how long from request to first content chunk
                  if (safeData.ttftMs) {
                    setTtftMs(safeData.ttftMs);
                    // TTFT logging - disabled in production
                    // console.log(`[SSE-METRICS] ⏱️ TTFT: ${safeData.ttftMs}ms`);
                  }
                  break;

                // v0.6.7 fix 2 — running cost delta from the streaming pipeline.
                // Server emits this per chunk with the incremental USD cost
                // (or the running total). We accumulate into runningCost which
                // CostPill consumes as a prop + pulses on each update.
                case 'cost_delta': {
                  const delta =
                    typeof safeData.delta === 'number'
                      ? safeData.delta
                      : typeof safeData.costDelta === 'number'
                      ? safeData.costDelta
                      : undefined;
                  const total =
                    typeof safeData.totalCost === 'number'
                      ? safeData.totalCost
                      : typeof safeData.runningCost === 'number'
                      ? safeData.runningCost
                      : undefined;
                  if (total != null) {
                    runningCostRef.current = total;
                    setRunningCost(total);
                  } else if (delta != null) {
                    const next = (runningCostRef.current ?? 0) + Math.max(0, delta);
                    runningCostRef.current = next;
                    setRunningCost(next);
                  }
                  break;
                }

                case 'message_saved':
                  // Database-First: Message confirmed in PostgreSQL before streaming
                  // console.log('[SSE] message_saved event received:', safeData);
                  messageId = safeData.messageId || messageId;

                  // If this is a user message, we can ignore it (already handled by UI)
                  // If this is an assistant message starting to stream, prepare for content
                  if (safeData.role === 'assistant' && safeData.streaming) {
                    // console.log('[SSE] Assistant message starting with DB ID:', messageId);
                  }

                  // Wave 3 (#525) — flush any buffered intent_classified +
                  // tool_shortlist frames now that we know the assistant
                  // message exists.
                  //
                  // #473 — flush key MUST match the React message.id used
                  // by ChatMessages's per-message lookups. ChatContainer
                  // creates the assistant with a client-side placeholder
                  // id like `assistant_<ts>_<rand>` and that id stays in
                  // messages[] forever. The DB CUID arriving via
                  // safeData.messageId is a different namespace and
                  // misses the lookup. Prefer the caller-supplied
                  // placeholder id when available; fall back to the wire
                  // CUID for back-compat in test/dev paths that don't
                  // wire `getAssistantPlaceholderId`.
                  if (safeData.role === 'assistant') {
                    const placeholderId = getAssistantPlaceholderId?.() || null;
                    const flushKey = placeholderId || (safeData.messageId ? String(safeData.messageId) : '');
                    if (flushKey) {
                      setIntentClassifications((prev) => {
                        const out = flushPendingIntentClassified(
                          flushKey,
                          prev,
                          pendingIntentClassifiedRef.current,
                        );
                        pendingIntentClassifiedRef.current = out.pending;
                        return out.intentClassifications;
                      });
                      setToolShortlists((prev) => {
                        const out = flushPendingToolShortlist(
                          flushKey,
                          prev,
                          pendingToolShortlistRef.current,
                        );
                        pendingToolShortlistRef.current = out.pending;
                        return out.toolShortlists;
                      });
                    }
                  }
                  break;

                case 'message_updated':
                  // Database-First: Final message content after streaming completes
                  // console.log('[SSE] message_updated event received:', safeData);
                  if (safeData.final && safeData.role === 'assistant') {
                    // console.log('[SSE] Assistant message finalized in database:', messageId);
                  }
                  break;

                case 'thinking':
                case 'thinking_event':
                  // Capture AI's real thinking process with metrics from backend
                  // This path is used by Ollama/gpt-oss models (non-Anthropic format)

                  // Handle both 'content' and legacy 'message' fields
                  const thinkingContent = safeData.content || safeData.message;
                  const accumulatedThinking = safeData.accumulated || thinkingContent || '';

                  if (thinkingContent) {
                    setCurrentThinking(accumulatedThinking);
                    // Also update ref for persistence
                    currentThinkingRef.current = accumulatedThinking;
                    // LiveTurnStatus — bump output tokens + surface the
                    // last non-empty thinking line as the activity summary
                    // so the strip RIGHT of the sphere shows a real one-
                    // line live thought from the model (not stuck at
                    // "thinking"). Mirrors the Anthropic + OpenAgentic delta hooks.
                    if (typeof thinkingContent === 'string' && thinkingContent.length > 0) {
                      setLiveTokensOut(prev => prev + Math.max(1, Math.round(thinkingContent.length / 4)));
                    }
                    const lastLine = (accumulatedThinking || '').split('\n').filter(Boolean).pop() ?? '';
                    const trimmed = lastLine.trim().slice(0, 110);
                    if (trimmed) setLiveActivity(trimmed);

                    // CRITICAL FIX: Also track as ContentBlock so thinking persists after finalization.
                    // The Anthropic path (thinking_start/thinking_delta) creates ContentBlocks but this
                    // Ollama path did not — causing thinking blocks to vanish after stream completion.
                    // Each thinking round (separated by tool calls) gets its own ContentBlock.
                    if (currentThinkingBlockIndexRef.current === null) {
                      // New thinking round — create a new ContentBlock
                      const thinkingBlockIdx = contentBlocksRef.current.length;
                      const thinkingBlockTs = Date.now();
                      const thinkingCB: ContentBlock = {
                        id: `block-${thinkingBlockIdx}-${thinkingBlockTs}`,
                        index: thinkingBlockIdx,
                        type: 'thinking',
                        content: accumulatedThinking,
                        isComplete: false,
                        timestamp: thinkingBlockTs,
                        // #813 — InlineThinkingBlock derives endedAt = startTime
                        // + duration. Stamp startTime here so the close handler
                        // can compute wall-clock elapsed; otherwise the UI
                        // header reads "Thought · 0.0s · ~N tok".
                        startTime: thinkingBlockTs,
                      };
                      setContentBlocks(prev => [...prev, thinkingCB]);
                      contentBlocksRef.current = [...contentBlocksRef.current, thinkingCB];
                      currentThinkingBlockIndexRef.current = thinkingBlockIdx;
                    } else {
                      // Same thinking round — update existing ContentBlock with accumulated content
                      setContentBlocks(prev => prev.map(block =>
                        block.index === currentThinkingBlockIndexRef.current
                          ? { ...block, content: accumulatedThinking }
                          : block
                      ));
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === currentThinkingBlockIndexRef.current
                          ? { ...block, content: accumulatedThinking }
                          : block
                      );
                    }
                  }

                  // Capture thinking metrics (tokens, timing, speed)
                  const thinkingTokens = safeData.tokens;
                  if (thinkingTokens !== undefined) {
                    const metrics = {
                      tokens: thinkingTokens,
                      elapsedMs: safeData.elapsedMs || 0,
                      tokensPerSecond: safeData.tokensPerSecond || 0
                    };
                    setThinkingMetrics(metrics);
                  }

                  // Call callbacks for unified activity display
                  onThinking?.(safeData.status || 'Thinking');
                  onThinkingContent?.(accumulatedThinking, thinkingTokens);
                  break;

                case 'thinking_complete':
                  // Thinking phase finished - DON'T clear thinking content here!
                  // Let the UI decide when to collapse/hide the thinking display
                  // The content should remain visible for users to review
                  setIsThinkingCompleted(true); // Mark thinking as completed for UI

                  // Mark ContentBlock as complete + stamp duration for interleaved display.
                  // #813 — InlineThinkingBlock reads endedAt = startTime + duration. Without
                  // a duration on close the UI shows "Thought · 0.0s". Use Date.now() since
                  // wire _ts isn't threaded through the legacy inline handler.
                  if (currentThinkingBlockIndexRef.current !== null) {
                    const closeTs = Date.now();
                    const closeBlock = (block: ContentBlock): ContentBlock => {
                      const next: ContentBlock = { ...block, isComplete: true };
                      if (typeof block.startTime === 'number' && block.duration == null) {
                        next.duration = Math.max(0, closeTs - block.startTime);
                      }
                      return next;
                    };
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? closeBlock(block)
                        : block
                    ));
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? closeBlock(block)
                        : block
                    );
                    currentThinkingBlockIndexRef.current = null; // Clear tracking ref
                  }

                  onThinkingComplete?.();
                  // Only clear metrics (the spinner), not the content
                  setThinkingMetrics(null);
                  break;

                case 'token_metrics':
                  // Live token metrics during streaming (separate from thinking events)
                  if (safeData.tokens !== undefined || safeData.elapsedMs !== undefined) {
                    const metrics = {
                      tokens: safeData.tokens || 0,
                      elapsedMs: safeData.elapsedMs || 0,
                      tokensPerSecond: safeData.tokensPerSecond || 0
                    };
                    setThinkingMetrics(metrics);
                  }
                  break;

                case 'stream':
                case 'content_delta':
                case 'delta': // Additional common SSE event name
                  // DISABLED: This was blocking ALL stream events because done event arrives first
                  // if (hasCompletedStream) {
                  //   console.warn('[SSE] Ignoring stream event after completion');
                  //   break;
                  // }

                  // Handle different response formats
                  let contentDelta = '';

                  // Direct content (custom format)
                  if (safeData.content) {
                    contentDelta = safeData.content;
                  }
                  // Delta format (some providers)
                  else if (safeData.delta) {
                    contentDelta = safeData.delta;
                  }
                  // Text format (some providers)
                  else if (safeData.text) {
                    contentDelta = safeData.text;
                  }
                  // OpenAI format (choices[0].delta.content)
                  else if (safeData.choices && safeData.choices[0] && safeData.choices[0].delta && safeData.choices[0].delta.content) {
                    contentDelta = safeData.choices[0].delta.content;
                  }
                  // Raw JSON string response from some providers
                  else if (typeof safeData === 'string') {
                    try {
                      const parsed = JSON.parse(safeData);
                      if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                        contentDelta = parsed.choices[0].delta.content;
                      } else if (parsed.content) {
                        contentDelta = parsed.content;
                      }
                    } catch (e) {
                      // If not JSON, treat as raw content
                      contentDelta = safeData;
                    }
                  }
                  
                  // Pipeline-aware content handling
                  // CRITICAL FIX: Do NOT suppress content during MCP execution - show it in real-time!
                  // The old behavior was buffering content during tool execution, causing the UI to appear frozen
                  // Now we always show content immediately for better UX
                  if (false && currentPipelineState.shouldSuppressContent) {
                    // DISABLED: Buffer content during tool execution phases
                    currentPipelineState.bufferedContent += contentDelta;

                    // Content suppression logging - disabled
                    // if (import.meta.env.DEV) {
                    //   console.log(`[SSE] Content suppressed during ${currentPipelineState.currentStage} stage (tool round ${currentPipelineState.activeToolRound})`);
                    // }
                  } else {
                    // Phase 2 (plan §2.2): the legacy `case 'stream'` envelope no
                    // longer mutates `assistantMessage` — that's the dual-emit
                    // race source for "LetLet me" character duplication.
                    // The canonical `content_block_delta` reducer arm owns the
                    // flat-string concat now. We still create/update the
                    // ContentBlock here as a fallback for any provider that
                    // emits ONLY the legacy envelope (server-side dual-emit at
                    // stream.handler.ts:1101-1130 also emits canonical for
                    // every content_delta — so this is dead code on the
                    // current cluster, kept only for back-compat).

                    // Flush any buffered content (legacy suppression path —
                    // `false &&` above keeps this dead but the prepend stays
                    // for when the buffer ever re-enables).
                    if (currentPipelineState.bufferedContent) {
                      assistantMessage = currentPipelineState.bufferedContent + assistantMessage;
                      currentPipelineState.bufferedContent = '';
                    }

                    // Extract thinking blocks from the current (canonical-owned)
                    // assistantMessage and update the live preview.
                    const { cleaned, thinking } = extractAndCleanThinkingBlocks(assistantMessage);
                    setCurrentMessage(cleaned);

                    // Set extracted thinking content if found
                    if (thinking) {
                      setCurrentThinking(thinking);
                      // console.log('[SSE] Extracted thinking from stream:', thinking.substring(0, 100) + '...');
                    }

                    // Update text ContentBlock for interleaved display.
                    //
                    // Phase 2 (plan §2.2): if the canonical reducer already
                    // created text blocks for this turn (server-side dual-emit
                    // sends `content_block_delta` alongside the legacy
                    // `stream` envelope), the legacy path MUST NOT create a
                    // second text block — that's the dup-block source the
                    // canonical reducer can't undo. We only create a text
                    // block here when:
                    //   (a) no text block exists yet in contentBlocksRef
                    //       (legacy-only provider, no canonical seen), AND
                    //   (b) currentTextBlockIndexRef.current is null
                    //       (no prior legacy create for this turn).
                    const hasAnyTextBlock = contentBlocksRef.current.some(
                      (b) => b.type === 'text',
                    );
                    if (
                      currentTextBlockIndexRef.current === null &&
                      contentDelta &&
                      !hasAnyTextBlock
                    ) {
                      const newTextBlockIndex = contentBlocksRef.current.length;
                      const textBlockTimestamp = Date.now();
                      const newTextBlock: ContentBlock = {
                        id: `block-${newTextBlockIndex}-${textBlockTimestamp}`,  // Unique ID for React key
                        index: newTextBlockIndex,
                        type: 'text',
                        // Sev-0 2026-05-19: `assistantMessage` accumulator was
                        // ripped in Phase 2 of the canonical-streaming-rip plan,
                        // so `cleaned` is always ''. Scope-warning/lockout
                        // responses send their text via `contentDelta` (from
                        // `safeData.content`). Use contentDelta as fallback so
                        // warning bubbles render their text instead of being empty.
                        content: contentDelta || cleaned,
                        isComplete: false,
                        timestamp: textBlockTimestamp,
                      };
                      setContentBlocks(prev => [...prev, newTextBlock]);
                      contentBlocksRef.current = [...contentBlocksRef.current, newTextBlock];
                      currentTextBlockIndexRef.current = newTextBlockIndex;
                    } else if (currentTextBlockIndexRef.current !== null) {
                      // Update existing text block with cleaned content.
                      // Sev-0 2026-05-19: same fallback — prefer contentDelta
                      // when cleaned is empty (accumulator ripped).
                      setContentBlocks(prev => prev.map(block =>
                        block.index === currentTextBlockIndexRef.current
                          ? { ...block, content: contentDelta || cleaned }
                          : block
                      ));
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === currentTextBlockIndexRef.current
                          ? { ...block, content: contentDelta || cleaned }
                          : block
                      );
                    }

                    onStream?.(contentDelta);
                  }
                  break;

                case 'tool_approval_request':
                  // Human-in-the-loop: AI is requesting approval to execute tools
                  // console.log('[SSE] Tool approval requested:', {
                  //   round: safeData.toolCallRound,
                  //   toolCount: safeData.tools?.length,
                  //   tools: safeData.tools
                  // });

                  // Call the approval callback to display the dialog
                  if (onToolApprovalRequest && safeData.tools && safeData.tools.length > 0) {
                    onToolApprovalRequest({
                      tools: safeData.tools,
                      toolCallRound: safeData.toolCallRound,
                      messageId: safeData.messageId
                    });
                  }
                  break;

                // Legacy `mcp_approval_required` popup-modal handler RIPPED
                // 2026-05-12 per user: "the legacy hitl with the popup modal
                // sucks- leave the inline new one- its aewesome". The newer
                // inline HITL handler below (case 'hitl_approval': case
                // 'mcp_approval_required') writes the same event into
                // `hitlApprovalsByMessageId` which ChatMessages renders as
                // an inline approval card — the kept path.

                case 'force_reauth':
                  // Server says token is expired and can't be refreshed — force logout
                  console.warn('[SSE] Force re-authentication required:', safeData.reason);
                  // Clear local auth state and redirect to login
                  try {
                    localStorage.removeItem('accessToken');
                    sessionStorage.removeItem('accessToken');
                    // Redirect to login page after a short delay to allow the user to see the message
                    setTimeout(() => {
                      window.location.href = '/';
                    }, 2000);
                  } catch (e) {
                    console.error('[SSE] Failed to clear auth state:', e);
                  }
                  // Also fire the error callback so the user sees a message
                  onError?.(new Error(safeData.message || 'Session expired. Please sign in again.'));
                  break;

                case 'tool_execution_start':
                  // Update pipeline state for tool execution
                  currentPipelineState.isToolExecutionPhase = true;
                  currentPipelineState.activeToolRound = Math.max(1, currentPipelineState.activeToolRound);
                  // CRITICAL FIX: DO NOT suppress content during tool execution
                  // We want real-time streaming even during MCP tool calls
                  currentPipelineState.shouldSuppressContent = false;

                  // Update thinking phase to tools for progress indicator
                  setThinkingPhase('tools');

                  setPipelineState({...currentPipelineState});
                  onToolRound?.(currentPipelineState.activeToolRound, currentPipelineState.maxToolRounds);
                  onToolExecution?.({
                    type: 'start',
                    tools: safeData.tools,
                    round: currentPipelineState.activeToolRound
                  });
                  break;

                case 'tool_execution_complete':
                  // Tool execution finished - prepare for next completion stream
                  currentPipelineState.isToolExecutionPhase = false;
                  onToolExecution?.({
                    type: 'complete',
                    executionTimeMs: safeData.executionTimeMs,
                    successCount: safeData.successCount,
                    errorCount: safeData.errorCount
                  });
                  break;

                case 'completion_restart':
                  // Completion is restarting after tool execution
                  // Un-suppress content so the next completion stream shows
                  currentPipelineState.shouldSuppressContent = false;
                  setPipelineState({...currentPipelineState});

                  // CRITICAL FIX: Set block index offset to current length
                  // Server restarts block indices at 0 for each LLM call, but we need
                  // unique indices to prevent all thinking blocks from merging together
                  blockIndexOffsetRef.current = contentBlocksRef.current.length;
                  console.debug('[SSE] completion_restart - block index offset set to:', blockIndexOffsetRef.current);
                  break;

                case 'completion_start':
                  // Capture the model at completion start for the response badge
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;

                case 'react_progress':
                case 'completeness_check':
                  // ReAct cognitive loop events — pass to activity stream for display
                  console.debug(`[SSE] ${eventType}`, safeData);
                  break;

                // ── Wire-in D (#82) — tool_round envelopes ─────────────
                // tool_round_start / tool_round_end wrap parallel fan-out
                // batches. Handled through the pure applyRoundFrame
                // reducer so the correlation rule (roundId → nested
                // children) stays unit-tested in one place.
                case 'tool_round_start': {
                  if (typeof safeData.roundId !== 'string') break;
                  contentBlocksRef.current = applyRoundFrame(
                    contentBlocksRef.current,
                    {
                      type: 'tool_round_start',
                      roundId: safeData.roundId,
                      toolCount: safeData.toolCount,
                      toolIds: safeData.toolIds,
                      toolNames: safeData.toolNames,
                    },
                  );
                  setContentBlocks([...contentBlocksRef.current]);
                  break;
                }

                case 'tool_round_end': {
                  if (typeof safeData.roundId !== 'string') break;
                  contentBlocksRef.current = applyRoundFrame(
                    contentBlocksRef.current,
                    {
                      type: 'tool_round_end',
                      roundId: safeData.roundId,
                      succeeded: safeData.succeeded,
                      failed: safeData.failed,
                      durationMs: safeData.durationMs,
                    },
                  );
                  setContentBlocks([...contentBlocksRef.current]);
                  // Wire-in D — a tool_round envelope explicitly closes
                  // the Task #131 round counter so subsequent work opens
                  // a fresh legacy round if the backend falls back to
                  // the un-wrapped path.
                  inToolCallRoundRef.current = false;
                  break;
                }

                case 'tool_executing': {
                  // E1.5 (2026-05-12) — wire-shape normalization. The V2
                  // pipeline emits canonical `{name, tool_use_id, input}`
                  // (api/.../pipeline/chat/builders.ts buildToolExecuting).
                  // Legacy OpenAI-shape callers used `arguments` /
                  // `toolCallId`. Read canonical first, legacy fallback.
                  // Without this every INPUT panel renders `{}` because
                  // safeData.arguments is undefined on V2 turns. Pinned by
                  // useChatStream.e15WireShapeNormalizer.test.ts.
                  const teArgs = extractToolExecutingArgs(safeData);
                  const teToolCallId = extractToolExecutingToolUseId(safeData);
                  // Fire callback for external consumers
                  onToolExecution?.({
                    type: 'executing',
                    name: safeData.name,
                    arguments: teArgs,
                  });
                  // LiveTurnStatus — surface tool-name as the live activity
                  // ("calling azure_list_subscriptions") so the user can see
                  // what the model is doing right now.
                  if (typeof safeData.name === 'string' && safeData.name) {
                    setLiveActivity(`calling ${safeData.name}`);
                  }

                  // Wire-in D (#82) — if this tool_executing carries a
                  // roundId AND an open tool_round block exists for it,
                  // route the frame into that round's children[] via the
                  // pure reducer and skip the sibling-creation path
                  // below. An unknown roundId falls through to the
                  // existing Task #131 sibling behaviour.
                  if (typeof safeData.roundId === 'string') {
                    const hasMatchingRound = contentBlocksRef.current.some(
                      (b) => b.type === 'tool_round' && b.roundId === safeData.roundId,
                    );
                    if (hasMatchingRound) {
                      contentBlocksRef.current = applyRoundFrame(
                        contentBlocksRef.current,
                        {
                          type: 'tool_executing',
                          roundId: safeData.roundId,
                          toolCallId: teToolCallId,
                          name: safeData.name,
                          arguments: teArgs,
                        },
                      );
                      setContentBlocks([...contentBlocksRef.current]);
                      break;
                    }
                  }

                  // Task #131 (Phase F₂) — parallel tool-call round stamping.
                  // Backend `executeToolCalls` fires tool_executing for every
                  // parallel MCP tool upfront before awaiting Promise.allSettled,
                  // so a burst of consecutive tool_executing events with no
                  // intervening tool_result represents ONE parallel round.
                  // Bump the round counter once on the boundary; all members
                  // of the round get the same toolCallRound value.
                  if (!inToolCallRoundRef.current) {
                    toolCallRoundRef.current += 1;
                    inToolCallRoundRef.current = true;
                    parallelSlotIndexRef.current = 0;
                  }
                  const currentRound = toolCallRoundRef.current;
                  const currentSlot = parallelSlotIndexRef.current;
                  parallelSlotIndexRef.current += 1;

                  // CREATE a ContentBlock so the tool appears in the activity stream.
                  // This ensures ALL models (including Ollama) show tool execution inline,
                  // not just models that emit tool_use content blocks (like Claude).
                  const execBlockId = `tool-exec-${teToolCallId || safeData.name}-${Date.now()}`;
                  const existingExecBlock = contentBlocksRef.current.find(
                    b => b.type === 'tool_use' && b.toolName === safeData.name && !b.isComplete
                  );
                  if (!existingExecBlock) {
                    const execBlockIndex = contentBlocksRef.current.length;
                    contentBlocksRef.current = [
                      ...contentBlocksRef.current,
                      {
                        id: execBlockId,
                        index: execBlockIndex,
                        type: 'tool_use' as const,
                        toolName: safeData.name,
                        toolId: teToolCallId || execBlockId,
                        // E1.5 — content carries the model's input args
                        // (rendered in ToolCard's JSON view). Stringify
                        // here so the legacy `block.content` consumers see
                        // a stable JSON form; the parallel `block.input`
                        // slot keeps the raw object so ToolCard can render
                        // structured JsonView without a parse round-trip.
                        content: JSON.stringify(teArgs ?? {}),
                        input: teArgs,
                        isComplete: false,
                        startTime: Date.now(),
                        toolCallRound: currentRound,
                        parallelSlotIndex: currentSlot,
                      }
                    ];
                    setContentBlocks([...contentBlocksRef.current]);
                  } else if (existingExecBlock.toolCallRound == null) {
                    // Anthropic content_block_start may have already created
                    // the block; stamp the round on it so parallel grouping
                    // still works regardless of which emit-path opens the block.
                    existingExecBlock.toolCallRound = currentRound;
                    existingExecBlock.parallelSlotIndex = currentSlot;
                    setContentBlocks([...contentBlocksRef.current]);
                  }
                  break;
                }

                case 'tool_result': {
                  // E1.5 (2026-05-12) — wire-shape normalization. V2
                  // emits canonical `{name, tool_use_id, content, is_error,
                  // _meta}` (api/.../pipeline/chat/builders.ts buildToolResult).
                  // Legacy callers used `result` + `success`/`toolCallId`.
                  // Read canonical first, legacy fallback.
                  const trContent = extractToolResultContent(safeData);
                  const trToolCallId = extractToolExecutingToolUseId(safeData);
                  // Sev-1 (2026-04-19) + E1.5: failure detection. V2 stamps
                  // `is_error: true`; legacy callers stamped
                  // `success: false`. Either signals the failure path —
                  // red card, explicit error text.
                  const isFailure =
                    safeData.is_error === true || safeData.success === false;
                  const failureMsg =
                    safeData.error ||
                    (isFailure
                      ? `${safeData.errorCode || 'UNKNOWN_ERROR'}: tool returned no data`
                      : undefined);

                  onToolExecution?.({
                    type: isFailure ? 'error' : 'result',
                    name: safeData.name,
                    result: isFailure ? undefined : trContent,
                    error: isFailure ? failureMsg : undefined,
                  } as any);

                  // Task #131 — close the open parallel round. The NEXT
                  // tool_executing will open round N+1. Subsequent tool_result
                  // events in the same wave still complete their matching
                  // blocks (they keep their toolCallRound stamp), but any
                  // tool_executing after this point is a NEW round.
                  inToolCallRoundRef.current = false;

                  // Wire-in D (#82) — if this result belongs to an open
                  // tool_round container, update the child in place.
                  if (typeof safeData.roundId === 'string') {
                    const hasMatchingRound = contentBlocksRef.current.some(
                      (b) => b.type === 'tool_round' && b.roundId === safeData.roundId,
                    );
                    if (hasMatchingRound) {
                      contentBlocksRef.current = applyRoundFrame(
                        contentBlocksRef.current,
                        isFailure
                          ? {
                              type: 'tool_error',
                              roundId: safeData.roundId,
                              toolCallId: trToolCallId,
                              name: safeData.name,
                              error: failureMsg,
                            }
                          : {
                              type: 'tool_result',
                              roundId: safeData.roundId,
                              toolCallId: trToolCallId,
                              name: safeData.name,
                              result: trContent,
                            },
                      );
                      setContentBlocks([...contentBlocksRef.current]);
                      break;
                    }
                  }

                  const resultBlockIdx = contentBlocksRef.current.findIndex(
                    b => b.type === 'tool_use' && b.toolName === safeData.name && !b.isComplete
                  );
                  if (resultBlockIdx >= 0) {
                    const prev = contentBlocksRef.current[resultBlockIdx];
                    // Phase 4 — when the V3 chatLoop emits the two-channel
                    // envelope (Spec §6.2), `_meta.outputTemplate` on the
                    // tool_result frame names the FrameRendererRegistry
                    // slug (e.g. 'k8s_pod_list', 'cost_savings'). Stamp it
                    // onto the ContentBlock so the render layer can resolve
                    // the React component without re-parsing the wire frame.
                    const outputTemplate: string | undefined =
                      !isFailure && safeData?._meta?.outputTemplate
                        ? safeData._meta.outputTemplate
                        : undefined;
                    contentBlocksRef.current[resultBlockIdx] = {
                      ...prev,
                      isComplete: true,
                      ...(isFailure
                        ? { error: failureMsg, result: undefined }
                        : {
                            // E1.5 — keep the structured object on
                            // `resultRaw` so ToolCard renders the actual
                            // object via JsonView (no escape-soup). The
                            // legacy `result: string` slot still gets a
                            // JSON form for code paths that expect a string.
                            result:
                              typeof trContent === 'string'
                                ? trContent
                                : JSON.stringify(trContent),
                            resultRaw: trContent,
                          }),
                      ...(outputTemplate ? { outputTemplate } : {}),
                      duration: Date.now() - (prev.startTime || Date.now()),
                    };
                    setContentBlocks([...contentBlocksRef.current]);
                  }
                  break;
                }
                  
                case 'tool_error': {
                  onToolExecution?.({
                    type: 'error',
                    name: safeData.name,
                    error: safeData.error
                  });

                  // Task #131 — close the open parallel round on error too.
                  inToolCallRoundRef.current = false;

                  // Mark matching ContentBlock as error
                  const errBlockIdx = contentBlocksRef.current.findIndex(
                    b => b.type === 'tool_use' && b.toolName === safeData.name && !b.isComplete
                  );
                  if (errBlockIdx >= 0) {
                    contentBlocksRef.current[errBlockIdx] = {
                      ...contentBlocksRef.current[errBlockIdx],
                      isComplete: true,
                      error: safeData.error,
                      duration: Date.now() - (contentBlocksRef.current[errBlockIdx].startTime || Date.now()),
                    };
                    setContentBlocks([...contentBlocksRef.current]);
                  }
                  break;
                }

                case 'tool_progress':
                  // Heartbeat progress event from backend during long-running tool execution.
                  // F.2: also stamp the progress message onto the matching tool_use ContentBlock
                  // so AgenticActivityStream can show "Executing... (15s)" under the tool row.
                  {
                    const progressToolId = safeData.toolCallId;
                    const progressMessage = safeData.message;
                    const progressElapsed = safeData.elapsed;
                    if (progressToolId) {
                      contentBlocksRef.current = contentBlocksRef.current.map(b =>
                        b.type === 'tool_use' && b.toolId === progressToolId
                          ? { ...b, progressMessage, progressElapsed }
                          : b
                      );
                      startTransition(() => {
                        setContentBlocks(prev => prev.map(b =>
                          b.type === 'tool_use' && b.toolId === progressToolId
                            ? { ...b, progressMessage, progressElapsed }
                            : b
                        ));
                      });
                    }
                  }
                  onToolExecution?.({
                    type: 'progress',
                    toolCallId: safeData.toolCallId,
                    name: safeData.name,
                    elapsed: safeData.elapsed,
                    message: safeData.message,
                  });
                  break;

                case 'tool_call_delta':
                  // Tool call detected - increment round if needed
                  if (currentPipelineState.activeToolRound === 0) {
                    currentPipelineState.activeToolRound = 1;
                  }

                  // Notify UI about tool calls being made so they display as steps during streaming
                  // These are real LLM function calls (not synthetic) - we just don't have results yet
                  if (safeData.toolCalls && safeData.toolCalls.length > 0) {
                    // FIX: Create tool_use content blocks for non-Anthropic providers (Ollama, OpenAI)
                    // This ensures hasInterleavedContent=true and tools render inline
                    safeData.toolCalls.forEach((tc: any) => {
                      const toolId = tc.id || `tool_${Date.now()}`;
                      const toolName = tc.function?.name || tc.name || 'unknown';
                      const existingBlock = contentBlocksRef.current.find(
                        b => b.type === 'tool_use' && b.toolId === toolId
                      );

                      if (!existingBlock) {
                        const newBlockIndex = contentBlocksRef.current.length;
                        const newBlock: ContentBlock = {
                          id: `tool-${toolId}`,
                          index: newBlockIndex,
                          type: 'tool_use',
                          content: tc.function?.arguments || tc.arguments || '',
                          isComplete: false,
                          timestamp: Date.now(),
                          toolName,
                          toolId,
                        };
                        console.log('[SSE] Creating tool_use content block for non-Anthropic provider:', toolName);
                        setContentBlocks(prev => [...prev, newBlock]);
                        contentBlocksRef.current = [...contentBlocksRef.current, newBlock];
                      }
                    });

                    onToolExecution?.({
                      type: 'tool_call_streaming',
                      calls: safeData.toolCalls.map((tc: any) => ({
                        id: tc.id,
                        name: tc.function?.name || tc.name,
                        tool: tc.function?.name || tc.name,
                        args: tc.function?.arguments || tc.arguments,
                        status: 'running'
                      })),
                      round: currentPipelineState.activeToolRound
                    });
                  }

                  setPipelineState({...currentPipelineState});
                  break;
                  
                case 'tool_call_complete':
                  // CRITICAL FIX: Don't track synthetic tool completions
                  // Real MCP results come through 'mcp_execution' events

                  // Just update pipeline state for tool rounds
                  currentPipelineState.isToolExecutionPhase = false;
                  if (currentPipelineState.activeToolRound < currentPipelineState.maxToolRounds) {
                    currentPipelineState.shouldSuppressContent = false;
                  }

                  setPipelineState({...currentPipelineState});
                  break;
                  
                case 'tool_calls_required':
                  // CRITICAL FIX: Don't initialize synthetic mcpCalls
                  // Real MCP results will come through proper 'mcp_execution' events
                  break;
                  
                case 'mcp_status':
                  // Store MCP status in metadata, don't append to content
                  // This information can be shown in a status bar or separate UI element
                  break;
                  
                case 'session_title':
                  // Update session title in the store
                  if (safeData.title && sessionId) {
                    const { updateSessionTitle } = useChatStore.getState();
                    updateSessionTitle(sessionId, safeData.title);
                  }
                  break;

                case 'multi_model_start':
                case 'orchestration_start':
                  // Multi-model orchestration started
                  console.log('[SSE] Multi-model orchestration started:', safeData);
                  onMultiModel?.({
                    type: 'start',
                    orchestrationId: safeData.orchestrationId,
                    executionPlan: safeData.executionPlan
                  });
                  break;

                case 'role_start':
                  // A specific role (reasoning, tool_execution, synthesis) started
                  console.log('[SSE] Role started:', safeData.role, 'model:', safeData.model);
                  onMultiModel?.({
                    type: 'role_start',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    model: safeData.model
                  });
                  break;

                case 'role_thinking':
                  // Thinking content from a role
                  console.log('[SSE] Role thinking:', safeData.role, 'accumulated:', safeData.accumulated?.length || 0);
                  onMultiModel?.({
                    type: 'role_thinking',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    content: safeData.content
                  });
                  // Also update thinking state for display
                  // CRITICAL FIX: Use accumulated from backend if available, otherwise build locally
                  // The agentState.thinkingContent gets REPLACED, not appended
                  if (safeData.content || safeData.accumulated) {
                    // Prefer backend-accumulated value for accuracy
                    const accumulatedContent = safeData.accumulated || '';
                    if (accumulatedContent) {
                      setCurrentThinking(accumulatedContent);
                      onThinkingContent?.(accumulatedContent);
                    } else if (safeData.content) {
                      // Fallback: accumulate locally
                      setCurrentThinking(prev => {
                        const accumulated = prev + safeData.content;
                        onThinkingContent?.(accumulated);
                        return accumulated;
                      });
                    }
                  }
                  break;

                case 'role_stream':
                  // Streaming content from a role (multi-model mode)
                  // This is the actual LLM content being streamed during orchestration
                  if (safeData.content) {
                    // Update current message with the delta
                    assistantMessage += safeData.content;
                    setCurrentMessage(assistantMessage);

                    // Also notify the stream callback
                    onStream?.(safeData.content);
                  }
                  break;

                case 'role_complete':
                  // A specific role completed
                  console.log('[SSE] Role completed:', safeData.role, 'metrics:', safeData.metrics);
                  onMultiModel?.({
                    type: 'role_complete',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    model: safeData.model,
                    metrics: safeData.metrics
                  });
                  break;

                case 'multi_model_handoff':
                case 'handoff':
                  // Model handoff during orchestration
                  console.log('[SSE] Handoff:', safeData.fromRole, '->', safeData.toRole);
                  onMultiModel?.({
                    type: 'handoff',
                    orchestrationId: safeData.orchestrationId,
                    fromRole: safeData.fromRole,
                    toRole: safeData.toRole,
                    fromModel: safeData.fromModel,
                    toModel: safeData.toModel,
                    handoffCount: safeData.handoffCount
                  });
                  // Phase G (task #152) — stash for HandoffPill render.
                  setHandoffEvent({
                    fromModel: safeData.fromModel,
                    toModel: safeData.toModel,
                    fromRole: safeData.fromRole,
                    toRole: safeData.toRole,
                    reason: safeData.reason,
                    complexityScore: typeof safeData.complexityScore === 'number'
                      ? safeData.complexityScore
                      : undefined,
                    routeEscalatedDestructive: !!safeData.route_escalated_destructive,
                  });
                  break;

                case 'multi_model_complete':
                case 'orchestration_complete':
                  // Multi-model orchestration completed
                  console.log('[SSE] Orchestration complete:', safeData);
                  onMultiModel?.({
                    type: 'complete',
                    orchestrationId: safeData.orchestrationId,
                    rolesExecuted: safeData.rolesExecuted,
                    totalCost: safeData.totalCost,
                    totalDuration: safeData.totalDuration
                  });
                  break;

                case 'multi_model_error':
                case 'orchestration_error':
                  // Multi-model orchestration error
                  console.log('[SSE] Orchestration error:', safeData);
                  onMultiModel?.({
                    type: 'error',
                    orchestrationId: safeData.orchestrationId,
                    error: safeData.error
                  });
                  break;

                // ═══════════════════════════════════════════════════════
                // Phase G (task #152) — trust / observability events.
                // Each branch is 5-15 lines: parse payload, update the
                // matching state slot. Rendering is delegated to the
                // small components in `components/events/*`.
                // ═══════════════════════════════════════════════════════
                case 'stage_change': {
                  const stage = safeData.stage as
                    | 'discover' | 'query' | 'analyze' | 'generate' | 'verify' | undefined;
                  if (stage === 'discover' || stage === 'query' || stage === 'analyze' ||
                      stage === 'generate' || stage === 'verify') {
                    setCurrentStage(stage);
                    // LiveTurnStatus — surface the stage as the activity
                    // summary so non-streaming providers (AIF gpt-5.4 in
                    // Responses-API mode) still show a meaningful live
                    // line right of the spinner instead of stuck at
                    // "thinking".
                    const stageLabels: Record<string, string> = {
                      discover: 'discovering tools',
                      query: 'querying model',
                      analyze: 'analyzing context',
                      generate: 'generating response',
                      verify: 'verifying output',
                    };
                    setLiveActivity(stageLabels[stage] ?? stage);
                    if (typeof safeData.elapsedMs === 'number') {
                      stageTimingsRef.current = {
                        ...stageTimingsRef.current,
                        [stage]: safeData.elapsedMs,
                      };
                      setStageTimings({ ...stageTimingsRef.current });
                    }
                  }
                  break;
                }

                case 'retry': {
                  setRetryEvents(prev => [
                    ...prev,
                    {
                      toolCallId: safeData.toolCallId,
                      name: safeData.name,
                      attempt: Number(safeData.attempt) || 1,
                      maxAttempts: Number(safeData.maxAttempts) || 1,
                      reason: safeData.reason,
                      elapsedMs: safeData.elapsedMs,
                    },
                  ]);
                  break;
                }

                case 'rag_citation': {
                  setRagCitations(prev => [
                    ...prev,
                    {
                      source: String(safeData.source || 'platform-rag'),
                      chunkId: safeData.chunkId,
                      excerpt: safeData.excerpt,
                      score: typeof safeData.score === 'number' ? safeData.score : undefined,
                      collection: safeData.collection,
                      url: safeData.url,
                    },
                  ]);
                  break;
                }

                case 'correction': {
                  if (safeData.wrongText && safeData.correctedText) {
                    setCorrectionEvent({
                      wrongText: String(safeData.wrongText),
                      correctedText: String(safeData.correctedText),
                      reason: safeData.reason || undefined,
                    });
                  }
                  break;
                }

                case 'warning': {
                  const warnLevel: 'info' | 'warn' | 'error' =
                    safeData.level === 'info' || safeData.level === 'error'
                      ? safeData.level
                      : 'warn';
                  setWarnings(prev => [
                    ...prev,
                    {
                      id: `warn-${Date.now()}-${prev.length}`,
                      level: warnLevel,
                      source: safeData.source,
                      code: safeData.code,
                      message: String(safeData.message || safeData.code || 'Warning'),
                      actionable: safeData.actionable,
                    },
                  ]);
                  break;
                }

                case 'rag_status': {
                  setRagStatus({
                    status: safeData.status,
                    docsRetrieved: typeof safeData.docsRetrieved === 'number'
                      ? safeData.docsRetrieved
                      : undefined,
                    collections: Array.isArray(safeData.collections)
                      ? safeData.collections
                      : undefined,
                    retrievalTimeMs: typeof safeData.retrievalTime === 'number'
                      ? safeData.retrievalTime
                      : undefined,
                  });
                  break;
                }

                case 'memory_status': {
                  setMemoryStatus({
                    status: safeData.status,
                    contextInjected: typeof safeData.contextInjected === 'boolean'
                      ? safeData.contextInjected
                      : undefined,
                    tokenEstimate: typeof safeData.tokenEstimate === 'number'
                      ? safeData.tokenEstimate
                      : undefined,
                    processingTime: typeof safeData.processingTime === 'number'
                      ? safeData.processingTime
                      : undefined,
                    memoriesFound: typeof safeData.memoriesFound === 'number'
                      ? safeData.memoriesFound
                      : undefined,
                  });
                  break;
                }

                case 'dlp_blocked': {
                  setDlpScan({
                    state: 'blocked',
                    severity: safeData.severity,
                    categories: Array.isArray(safeData.categories) ? safeData.categories : undefined,
                    reason: safeData.reason,
                    scanPoint: safeData.scanPoint,
                  });
                  break;
                }

                case 'dlp_scan_performed': {
                  const state: 'passed' | 'redacted' =
                    safeData.action === 'redact' ? 'redacted' : 'passed';
                  setDlpScan({
                    state,
                    severity: safeData.severity,
                    categories: Array.isArray(safeData.categories) ? safeData.categories : undefined,
                    findings: typeof safeData.findings === 'number' ? safeData.findings : undefined,
                    scanPoint: safeData.scanPoint,
                  });
                  break;
                }

                case 'tool_cache_hit':
                case 'tool_semantic_cache_hit': {
                  const name = String(safeData.name || 'unknown');
                  setToolCacheHits(prev => ({
                    ...prev,
                    [name]: {
                      similarity: typeof safeData.similarity === 'number'
                        ? safeData.similarity
                        : undefined,
                    },
                  }));
                  break;
                }

                case 'self_critique': {
                  setSelfCritique(prev => ({
                    ...(prev || {}),
                    critique: safeData.critique ?? prev?.critique,
                    contradictions: typeof safeData.contradictions === 'number'
                      ? safeData.contradictions
                      : prev?.contradictions,
                    lowestConfidence: typeof safeData.lowestConfidence === 'number'
                      ? safeData.lowestConfidence
                      : prev?.lowestConfidence,
                    status: safeData.status ?? prev?.status,
                  }));
                  break;
                }

                case 'hallucination_warning': {
                  setHallucinationWarning({
                    confidence: typeof safeData.confidence === 'number'
                      ? safeData.confidence
                      : undefined,
                    message: safeData.message,
                    warningCount: Array.isArray(safeData.warnings)
                      ? safeData.warnings.length
                      : typeof safeData.warningCount === 'number'
                        ? safeData.warningCount
                        : undefined,
                    revised: !!safeData.revised,
                    toolCount: typeof safeData.toolCount === 'number'
                      ? safeData.toolCount
                      : undefined,
                  });
                  break;
                }

                case 'tool_end':
                case 'tool_execution': {
                  // Phase G — alternate completion paths share the
                  // tool_complete render. Mark the matching tool_use
                  // block as done if not already closed.
                  const endToolName = safeData.toolName || safeData.name;
                  if (endToolName) {
                    const endBlockIdx = contentBlocksRef.current.findIndex(
                      b => b.type === 'tool_use' && b.toolName === endToolName && !b.isComplete
                    );
                    if (endBlockIdx >= 0) {
                      const prev = contentBlocksRef.current[endBlockIdx];
                      contentBlocksRef.current[endBlockIdx] = {
                        ...prev,
                        isComplete: true,
                        duration: Date.now() - (prev.startTime || Date.now()),
                      };
                      setContentBlocks([...contentBlocksRef.current]);
                    }
                  }
                  break;
                }

                // ═══════════════════════════════════════════════════════
                // Phase H (task #153) — artifact / image / session /
                // memory envelopes. Slotted AFTER the Phase G branches
                // per task spec. The existing `artifact_start/delta/end`
                // cases lower down are preserved untouched; Phase H
                // shape is DISCRIMINATED by an `artifactId` field so
                // both coexist.
                // ═══════════════════════════════════════════════════════
                case 'artifact_open': {
                  const kindRaw = String(safeData.kind || 'code');
                  const kind: 'markdown' | 'code' | 'chart' | 'csv' =
                    kindRaw === 'markdown' || kindRaw === 'code' ||
                    kindRaw === 'chart' || kindRaw === 'csv' ? kindRaw : 'code';
                  const artId = String(safeData.artifactId || `artifact-${Date.now()}`);
                  const defaultFile = String(safeData.fileName || '__default__');
                  setArtifactPanel({
                    artifactId: artId,
                    kind,
                    title: String(safeData.title || 'Artifact'),
                    language: safeData.language || undefined,
                    fileName: safeData.fileName || undefined,
                    files: {
                      [defaultFile]: {
                        fileName: defaultFile,
                        language: safeData.language || undefined,
                        content: '',
                        lastSeq: -1,
                      },
                    },
                    isOpen: true,
                    isComplete: false,
                    stats: null,
                  });
                  break;
                }

                case 'artifact_close': {
                  setArtifactPanel(prev => {
                    if (!prev || prev.artifactId !== safeData.artifactId) return prev;
                    const files = { ...prev.files };
                    if (safeData.finalContent && Object.keys(files).length === 1) {
                      const fn = Object.keys(files)[0];
                      if (files[fn].content.length < String(safeData.finalContent).length) {
                        files[fn] = {
                          ...files[fn],
                          content: String(safeData.finalContent),
                        };
                      }
                    }
                    // P1-5 chatmode UX parity — drop the panel entirely when
                    // the accumulated content is empty / trivial markdown.
                    // The server fires artifact_open eagerly for any
                    // structured response, but plain prose with no fences
                    // / SVG / Mermaid / chart should never have triggered
                    // a slide-out. Deciding at close time means we have
                    // the full content to evaluate. See punch list P1-5.
                    const totalContent = Object.values(files)
                      .map(f => f.content)
                      .join('\n');
                    if (!isArtifactWorthShowing(totalContent, prev.kind)) {
                      return null;
                    }
                    return {
                      ...prev,
                      files,
                      isComplete: true,
                      stats: safeData.stats && typeof safeData.stats === 'object'
                        ? {
                            bytes: Number(safeData.stats.bytes) || 0,
                            lines: Number(safeData.stats.lines) || 0,
                          }
                        : null,
                    };
                  });
                  break;
                }

                case 'image_progress': {
                  const progress = Number(safeData.progress);
                  if (!Number.isFinite(progress)) break;
                  setImageProgress({
                    imageGenId: String(safeData.imageGenId || 'img'),
                    progress: Math.max(0, Math.min(1, progress)),
                    partialUrl: safeData.partialUrl,
                    eta: typeof safeData.eta === 'number' ? safeData.eta : undefined,
                    prompt: safeData.prompt,
                  });
                  break;
                }

                // visual_render / app_render / artifact_render frames are
                // consumed by applyCanonicalFrame (runs above this switch) and
                // become ContentBlocks of type 'viz_render' / 'app_render'.
                // No parent-level state subscriber here — they render INLINE
                // at the wire-emit chronological position inside
                // AgenticActivityStream via the typed-block path.

                // P1-6 — server emits `streaming_table` for rectangular
                // tool results (right-sizing candidates, IAM drift rows,
                // cost summaries). Reducer is pure-tested at
                // useChatStream.streamingTable.test.ts.
                case 'streaming_table': {
                  const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                  if (flushKey) {
                    setStreamingTablesByMessageId((prev) =>
                      applyStreamingTableFrame(prev, flushKey, safeData as StreamingTableFrame),
                    );
                  }
                  break;
                }

                // Phase 27 — server emits `findings_emit` from security/
                // audit sub-agent results (mocks 03, 07, 08, 09). Reducer
                // is pure-tested at useChatStream.findings.test.ts.
                case 'findings_emit': {
                  const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                  if (flushKey) {
                    setFindingsByMessageId((prev) =>
                      applyFindingsFrame(prev, flushKey, safeData as FindingsFrame),
                    );
                  }
                  break;
                }

                // #502 — server emits `inline_widget` for KpiGrid /
                // SavingsCard / Runbook / WaveTimeline / StackGrid /
                // StagesStrip / AnnotatedCode. Reducer pure-tested at
                // useChatStream.inlineWidget.test.ts.
                case 'inline_widget': {
                  const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                  if (flushKey) {
                    setInlineWidgetsByMessageId((prev) =>
                      applyInlineWidgetFrame(prev, flushKey, safeData as InlineWidgetFrame),
                    );
                  }
                  break;
                }

                // B8 (2026-05-12) — Azure Responsible AI / Vertex SAFETY /
                // Vertex RECITATION trip. Server emits a `content_filter`
                // frame with {kind, model, message}. UI stores the latest
                // banner per assistant message id so <ContentFilterBanner>
                // renders inline with the (possibly partial) assistant
                // bubble. FedRAMP-Hi audit requires this surfaces to user
                // instead of silently truncating as end_turn.
                case 'content_filter': {
                  const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                  const d = safeData as Record<string, unknown>;
                  const kind = typeof d.kind === 'string' ? d.kind : 'content_filter';
                  const model = typeof d.model === 'string' ? d.model : '';
                  const message =
                    typeof d.message === 'string' && d.message.length > 0
                      ? d.message
                      : 'This response was filtered by Azure Responsible AI. The platform owner has been notified per FedRAMP-Hi audit policy. Try rephrasing your request.';
                  if (flushKey) {
                    setContentFilterBannerByMessageId((prev) => ({
                      ...prev,
                      [flushKey]: { kind, model, message },
                    }));
                  }
                  break;
                }

                // F1-6 (2026-05-17) — follow_up chip-row re-introduced.
                // Server emits a `follow_up` frame at end_turn with N
                // contextual chips per the mock contract. Push the block
                // into the legacy contentBlocks slot so MessageBubble's
                // existing render path picks it up (canonicalReducerState
                // is shadow-only for MessageBubble). The block is also
                // folded into canonicalReducerState by applyCanonicalFrame
                // for ChatMessages' canonical-preferred render path.
                case 'follow_up': {
                  const d = safeData as Record<string, unknown>;
                  const rawItems = Array.isArray(d.items) ? d.items : [];
                  const items: string[] = rawItems
                    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                    .map((s) => s.trim())
                    .slice(0, 5);
                  if (items.length === 0) break;
                  const followUpBlock: ContentBlock = {
                    id: `followup-${messageId || Date.now()}`,
                    type: 'follow_up',
                    timestamp: Date.now(),
                    isComplete: true,
                    items,
                  };
                  setContentBlocks((prev) => {
                    const filtered = prev.filter((b) => b.type !== 'follow_up');
                    return [...filtered, followUpBlock];
                  });
                  break;
                }

                // Audit §10 step 16 — HITL approval card. Server emits
                // `hitl_approval` for write-tier tools (and legacy
                // `mcp_approval_required` during the dual-emit window).
                case 'hitl_approval':
                case 'mcp_approval_required': {
                  const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                  const d = safeData as Record<string, unknown>;
                  const reqId = typeof d.requestId === 'string' ? d.requestId : '';
                  if (!flushKey || !reqId) break;
                  const entry = {
                    requestId: reqId,
                    toolName: typeof d.toolName === 'string' ? d.toolName : 'unknown',
                    serverName: typeof d.serverName === 'string' ? d.serverName : undefined,
                    reason: typeof d.reason === 'string' ? d.reason : '',
                    timeoutMs: typeof d.timeoutMs === 'number' ? d.timeoutMs : 60_000,
                    arguments: d.arguments,
                    status: 'pending' as const,
                    // HITL.3 — carry parentToolUseId from sub-agent bridge frames
                    // so AAS can position the chip at the correct sub-agent tool card.
                    // Absent on main-agent HITL frames; present when the frame arrived
                    // via the HITL.2 stream.handler bridge from openagentic-proxy.
                    parentToolUseId: typeof d.parentToolUseId === 'string' ? d.parentToolUseId : undefined,
                  };
                  setHitlApprovalsByMessageId((prev) => {
                    const arr = prev[flushKey] ?? [];
                    if (arr.some((a) => a.requestId === reqId)) return prev;
                    return { ...prev, [flushKey]: [...arr, entry] };
                  });
                  break;
                }

                // AC-B — synth lifecycle frames. The 8 frame types
                // (synth_planned / _code_chunk / _approval_requested /
                // _approved / _denied / _executing / _stdout /
                // _completed) all fold into a single per-message Synth
                // entry by artifact_id. Reducer pure-tested at
                // useChatStream.synthLifecycle.test.ts.
                case 'synth_planned':
                case 'synth_code_chunk':
                case 'synth_approval_requested':
                case 'synth_approved':
                case 'synth_denied':
                case 'synth_executing':
                case 'synth_stdout':
                case 'synth_completed': {
                  const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                  if (flushKey) {
                    setSynthsByMessageId((prev) =>
                      applySynthLifecycleFrame(
                        prev,
                        flushKey,
                        safeData as SynthLifecycleFrame,
                      ),
                    );
                  }
                  break;
                }

                // AC-D — clickable download tile. Emitted when
                // synth-executor (or any tool) finishes writing bytes
                // to UserStorageService and returns a presigned URL.
                // Reducer pure-tested at useChatStream.artifactEmit.test.ts.
                case 'artifact_emit': {
                  const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                  if (flushKey) {
                    setArtifactEmitsByMessageId((prev) =>
                      applyArtifactEmitFrame(prev, flushKey, safeData as ArtifactEmitFrame),
                    );
                  }
                  break;
                }

                // Wave 3 (#525) — per-message intent classification.
                // Emitted from prompt.stage BEFORE the assistant's
                // message_saved. Buffer until we know the React placeholder
                // id, then flush in case 'message_saved' arm (role ===
                // 'assistant').
                case 'intent_classified': {
                  setIntentClassifications((prev) => {
                    const out = bufferOrApplyIntentClassified(
                      safeData,
                      '',
                      prev,
                      pendingIntentClassifiedRef.current,
                    );
                    pendingIntentClassifiedRef.current = out.pending;
                    return out.intentClassifications;
                  });
                  break;
                }

                // Wave 3 (#525) — per-message tool shortlist (count + intent
                // + first ≤5 ranked tool names). Drives ToolShortlistChip.
                case 'tool_shortlist': {
                  setToolShortlists((prev) => {
                    const out = bufferOrApplyToolShortlist(
                      safeData,
                      '',
                      prev,
                      pendingToolShortlistRef.current,
                    );
                    pendingToolShortlistRef.current = out.pending;
                    return out.toolShortlists;
                  });
                  break;
                }

                // #502 — sub-agent lifecycle. Emitted by TaskTool.ts in api
                // for every Task tool dispatch (Phase E2). Consumed by
                // ChatMessages -> SubAgentCard. Wire-up unit-tested via
                // dispatchSubAgentFrame in useChatStream.subAgentEnvelope.test.ts.
                case 'sub_agent_started': {
                  setSubAgents((prev) => {
                    const out = dispatchSubAgentFrame('sub_agent_started', safeData, prev);
                    return out.subAgents;
                  });
                  // P0-1 part 2 — also store under the active assistant
                  // messageId so older bubbles render their own cards on
                  // re-render.
                  {
                    const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                    if (flushKey) {
                      setSubAgentsByMessageId((prev) =>
                        applySubAgentStartedScoped(prev, flushKey, {
                          type: 'sub_agent_started',
                          role: typeof safeData?.role === 'string' ? safeData.role : '',
                          description:
                            typeof safeData?.description === 'string'
                              ? safeData.description
                              : undefined,
                          model:
                            typeof safeData?.model === 'string' ? safeData.model : null,
                          session_id:
                            typeof safeData?.session_id === 'string'
                              ? safeData.session_id
                              : undefined,
                        }),
                      );
                    }
                  }
                  break;
                }

                case 'sub_agent_completed': {
                  setSubAgents((prev) => {
                    const out = dispatchSubAgentFrame('sub_agent_completed', safeData, prev);
                    return out.subAgents;
                  });
                  {
                    const flushKey = getAssistantPlaceholderId?.() || messageId || '';
                    if (flushKey) {
                      setSubAgentsByMessageId((prev) =>
                        applySubAgentCompletedScoped(prev, flushKey, {
                          type: 'sub_agent_completed',
                          role: typeof safeData?.role === 'string' ? safeData.role : '',
                          ok: safeData?.ok === true,
                          error: typeof safeData?.error === 'string' ? safeData.error : null,
                          turns: typeof safeData?.turns === 'number' ? safeData.turns : 0,
                          tokens: typeof safeData?.tokens === 'number' ? safeData.tokens : 0,
                          durationMs:
                            typeof safeData?.durationMs === 'number' ? safeData.durationMs : 0,
                          toolsUsed: Array.isArray(safeData?.toolsUsed)
                            ? safeData.toolsUsed
                            : undefined,
                          output: typeof safeData?.output === 'string' ? safeData.output : undefined,
                        }),
                      );
                    }
                  }
                  break;
                }

                case 'session_rename': {
                  if (safeData.sessionId && safeData.from && safeData.to) {
                    setSessionRename({
                      sessionId: String(safeData.sessionId),
                      from: String(safeData.from),
                      to: String(safeData.to),
                      reason:
                        safeData.reason === 'manual' || safeData.reason === 'summary'
                          ? safeData.reason
                          : 'auto-title',
                    });
                  }
                  break;
                }

                case 'memory_write': {
                  if (!safeData.key || !safeData.summary) break;
                  const scope: 'user' | 'session' | 'shared' =
                    safeData.scope === 'session' || safeData.scope === 'shared'
                      ? safeData.scope
                      : 'user';
                  setMemoryWrites(prev => [
                    ...prev,
                    {
                      key: String(safeData.key),
                      summary: String(safeData.summary),
                      scope,
                      entryId: safeData.entryId,
                      tokenCount: typeof safeData.tokenCount === 'number'
                        ? safeData.tokenCount
                        : undefined,
                    },
                  ]);
                  break;
                }

                // ── Agent Spawn Events (parallel sub-agents) ──
                // These create nested content blocks under the parent spawn_parallel_agents tool
                case 'agent_spawn_plan':
                  console.log('[SSE] Agent spawn plan:', safeData.agents?.length, 'agents');
                  if (safeData.executionId) {
                    useAgentTreeStore.getState().handleSpawnPlan(safeData.executionId, {
                      strategy: safeData.strategy || safeData.orchestration || 'parallel',
                      agents: safeData.agents,
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  onMultiModel?.({
                    type: 'agent_spawn_plan',
                    agents: safeData.agents,
                    strategy: safeData.strategy
                  });
                  break;

                case 'agent_start': {
                  console.log('[SSE] Agent started:', safeData.agentId, safeData.role, safeData.model);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleAgentStart(safeData.executionId, {
                      agentId: safeData.agentId,
                      role: safeData.role || 'agent',
                      model: safeData.model,
                      task: safeData.task?.substring(0, 120),
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Find the parent spawn_parallel_agents tool_use block
                  const parentSpawnBlock = contentBlocksRef.current.find(
                    b => b.type === 'tool_use' && b.toolName === 'spawn_parallel_agents' && !b.isComplete
                  );
                  // Create a child content block for this sub-agent
                  const agentBlockId = `agent-${safeData.agentId}`;
                  const existingAgentBlock = contentBlocksRef.current.find(b => b.id === agentBlockId);
                  if (!existingAgentBlock) {
                    const agentBlock: ContentBlock = {
                      id: agentBlockId,
                      index: contentBlocksRef.current.length,
                      type: 'tool_use',
                      content: '',
                      isComplete: false,
                      toolName: safeData.role || safeData.agentId,
                      toolId: safeData.agentId,
                      timestamp: Date.now(),
                      agentId: safeData.agentId,
                      parentToolId: parentSpawnBlock?.toolId,
                      agentRole: safeData.role,
                    };
                    setContentBlocks(prev => [...prev, agentBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, agentBlock];
                  }
                  onMultiModel?.({
                    type: 'role_start',
                    role: safeData.role,
                    model: safeData.model,
                    orchestrationId: safeData.agentId
                  });
                  // v0.6.7 Mockup 03 — bridge raw agent_start events into
                  // the NormalizedStreamEvent stream so UnifiedActivityTree
                  // renders a sub-agent card. Without this push the agent
                  // tree store gets the event but the `normalizedEvents`
                  // array does not, so the `.subagent` card never
                  // decomposes inside the assistant message body.
                  if (safeData.agentId) {
                    const norm: NormalizedStreamEvent = {
                      type: 'agent_start',
                      id: String(safeData.agentId),
                      name: String(safeData.role || safeData.agentId),
                      role: String(safeData.role || 'agent'),
                      parentId: safeData.parentAgentId
                        ? String(safeData.parentAgentId)
                        : undefined,
                    } as NormalizedStreamEvent;
                    normalizedEventsRef.current = [
                      ...normalizedEventsRef.current,
                      norm,
                    ];
                    setNormalizedEvents([...normalizedEventsRef.current]);
                  }
                  break;
                }

                case 'agent_stream': {
                  // Streaming content from a sub-agent — append to agent's own content block
                  // NEVER fall through to onStream — agent output goes through artifact detection
                  // on the backend after agent_complete, not streamed raw into chat
                  if (safeData.content && safeData.agentId) {
                    const agentStreamBlockId = `agent-${safeData.agentId}`;
                    const agentStreamBlock = contentBlocksRef.current.find(b => b.id === agentStreamBlockId);
                    if (agentStreamBlock) {
                      const updated = contentBlocksRef.current.map(b =>
                        b.id === agentStreamBlockId
                          ? { ...b, content: b.content + safeData.content }
                          : b
                      );
                      setContentBlocks(updated);
                      contentBlocksRef.current = updated;
                    }
                    // If no agent block found, suppress — don't leak raw HTML/CSS into chat
                  }
                  // Content without agentId is also suppressed — agents should not stream to main chat
                  break;
                }

                case 'agent_tool_call': {
                  console.log('[SSE] Agent tool call:', safeData.agentId, safeData.toolName);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleToolCall(safeData.executionId, {
                      agentId: safeData.agentId,
                      toolCallId: safeData.toolCallId || `${safeData.agentId}-${safeData.toolName}-${Date.now()}`,
                      toolName: safeData.toolName,
                      args: typeof safeData.arguments === 'string' ? safeData.arguments : JSON.stringify(safeData.arguments || ''),
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Create a nested tool call block under the agent's block
                  const agentToolId = `${safeData.agentId}-${safeData.toolName}-${Date.now()}`;
                  const agentParent = contentBlocksRef.current.find(
                    b => b.agentId === safeData.agentId && !b.parentToolId?.includes('-')
                  );
                  const agentToolBlock: ContentBlock = {
                    id: `tool-${agentToolId}`,
                    index: contentBlocksRef.current.length,
                    type: 'tool_use',
                    content: safeData.arguments || '',
                    isComplete: false,
                    toolName: safeData.toolName,
                    toolId: agentToolId,
                    timestamp: Date.now(),
                    agentId: safeData.agentId,
                    parentToolId: agentParent?.toolId || safeData.agentId,
                  };
                  setContentBlocks(prev => [...prev, agentToolBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, agentToolBlock];
                  onMultiModel?.({
                    type: 'role_thinking',
                    role: safeData.agentId,
                    content: `Calling tool: ${safeData.toolName}`
                  });
                  // Slice G.4b — push canonical `content_block_start` with
                  // `type: 'tool_use'`. buildTree nests it under the active
                  // agentStack top (the parent agent, pushed by the prior
                  // `agent_start` Normalized event). Open block — the
                  // matching `content_block_stop` is pushed by
                  // `agent_tool_result` below, paired by `index`.
                  if (safeData.agentId && safeData.toolName) {
                    const blockIdx = syntheticBlockIndexRef.current++;
                    const cbStart: NormalizedStreamEvent = {
                      type: 'content_block_start',
                      index: blockIdx,
                      content_block: {
                        type: 'tool_use',
                        id: agentToolId,
                        name: String(safeData.toolName),
                        input: {},
                      },
                    } as unknown as NormalizedStreamEvent;
                    normalizedEventsRef.current = [
                      ...normalizedEventsRef.current,
                      cbStart,
                    ];
                    setNormalizedEvents([...normalizedEventsRef.current]);
                  }
                  break;
                }

                case 'agent_tool_result': {
                  console.log('[SSE] Agent tool result:', safeData.agentId, safeData.toolName, safeData.success);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleToolResult(safeData.executionId, {
                      agentId: safeData.agentId,
                      toolCallId: safeData.toolCallId || '',
                      status: safeData.success === false ? 'error' : 'completed',
                      durationMs: safeData.durationMs,
                      resultPreview: safeData.resultPreview || safeData.result?.substring?.(0, 120),
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Mark the agent's tool call as complete — store result preview + args for inline summary
                  const matchingToolBlock = contentBlocksRef.current.find(
                    b => b.agentId === safeData.agentId && b.toolName === safeData.toolName && !b.isComplete
                  );
                  if (matchingToolBlock) {
                    const updated = contentBlocksRef.current.map(b =>
                      b.id === matchingToolBlock.id
                        ? {
                            ...b,
                            isComplete: true,
                            content: safeData.success ? 'success' : 'error',
                            // Store result + args so the activity stream can compute inline summaries
                            output: safeData.resultPreview || safeData.result?.substring?.(0, 500) || (safeData.success ? 'success' : 'error'),
                            toolArgs: safeData.toolArgs,
                            durationMs: safeData.durationMs,
                          }
                        : b
                    );
                    setContentBlocks(updated);
                    contentBlocksRef.current = updated;
                  }
                  // Slice G.4b — bridge tool result into a canonical
                  // `content_block_stop` paired by `index` with the
                  // `content_block_start` pushed at `agent_tool_call` time.
                  // We locate the index by scanning recent canonical
                  // tool_use blocks for the matching agentId+toolName.
                  if (safeData.agentId && safeData.toolName) {
                    // Find the most recent open synthetic tool_use whose
                    // content_block_start carried this toolName. We can't
                    // rely on agentId on the canonical event itself (it
                    // doesn't carry one), so we scan back for the most
                    // recent unclosed `content_block_start` of type tool_use
                    // by toolName.
                    const events = normalizedEventsRef.current;
                    let matchIndex: number | undefined;
                    for (let i = events.length - 1; i >= 0; i--) {
                      const ev: any = events[i];
                      if (
                        ev?.type === 'content_block_start' &&
                        ev?.content_block?.type === 'tool_use' &&
                        ev?.content_block?.name === String(safeData.toolName)
                      ) {
                        // Skip if a content_block_stop for this index already
                        // exists later in the buffer.
                        const idx = ev.index as number;
                        const closed = events.slice(i + 1).some(
                          (e: any) => e?.type === 'content_block_stop' && e?.index === idx,
                        );
                        if (!closed) {
                          matchIndex = idx;
                          break;
                        }
                      }
                    }
                    if (matchIndex !== undefined) {
                      const cbStop: NormalizedStreamEvent = {
                        type: 'content_block_stop',
                        index: matchIndex,
                      } as unknown as NormalizedStreamEvent;
                      normalizedEventsRef.current = [
                        ...normalizedEventsRef.current,
                        cbStop,
                      ];
                      setNormalizedEvents([...normalizedEventsRef.current]);
                    }
                  }
                  break;
                }

                case 'agent_complete': {
                  console.log('[SSE] Agent complete:', safeData.agentId, safeData.status);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleAgentComplete(safeData.executionId, {
                      agentId: safeData.agentId,
                      status: safeData.status === 'error' ? 'error' : 'completed',
                      durationMs: safeData.durationMs ?? safeData.metrics?.durationMs,
                      inputTokens: safeData.inputTokens ?? safeData.metrics?.inputTokens,
                      outputTokens: safeData.outputTokens ?? safeData.metrics?.outputTokens,
                      error: safeData.error,
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Mark the agent's content block as complete
                  const agentCompleteBlock = contentBlocksRef.current.find(
                    b => b.agentId === safeData.agentId && b.toolName !== undefined && !b.parentToolId?.includes('-')
                  );
                  if (agentCompleteBlock) {
                    const updated = contentBlocksRef.current.map(b =>
                      b.id === agentCompleteBlock.id
                        ? { ...b, isComplete: true, content: safeData.status === 'success' ? 'success' : 'error' }
                        : b
                    );
                    setContentBlocks(updated);
                    contentBlocksRef.current = updated;
                  }
                  onMultiModel?.({
                    type: 'role_complete',
                    role: safeData.role,
                    orchestrationId: safeData.agentId,
                    metrics: safeData.metrics
                  });
                  // v0.6.7 Mockup 03 — mirror agent_complete → normalized
                  // `agent_stop` so UnifiedActivityTree can close its
                  // sub-agent card, show final stats (turns/tokens/time),
                  // and render the return_value pill.
                  if (safeData.agentId) {
                    const normStop: NormalizedStreamEvent = {
                      type: 'agent_stop',
                      id: String(safeData.agentId),
                      durationMs:
                        Number(
                          safeData.durationMs ??
                            safeData.metrics?.durationMs ??
                            0,
                        ) || 0,
                      tokensIn:
                        Number(
                          safeData.inputTokens ??
                            safeData.metrics?.inputTokens ??
                            0,
                        ) || 0,
                      tokensOut:
                        Number(
                          safeData.outputTokens ??
                            safeData.metrics?.outputTokens ??
                            0,
                        ) || 0,
                      cost:
                        Number(
                          safeData.cost ?? safeData.metrics?.costUsd ?? 0,
                        ) || 0,
                    } as NormalizedStreamEvent;
                    normalizedEventsRef.current = [
                      ...normalizedEventsRef.current,
                      normStop,
                    ];
                    setNormalizedEvents([...normalizedEventsRef.current]);
                  }
                  break;
                }

                case 'agent_synthesis': {
                  // Agent synthesis content — the master LLM's final answer after agent execution.
                  // This arrives AFTER agent_complete and should be rendered below the execution timeline.
                  const synthContent = safeData.content || safeData.text || safeData.delta || '';
                  if (synthContent) {
                    assistantMessage += synthContent;
                    const { cleaned, thinking } = extractAndCleanThinkingBlocks(assistantMessage);
                    setCurrentMessage(cleaned);
                    if (thinking) setCurrentThinking(thinking);
                    onStream?.(synthContent);
                  }
                  break;
                }

                case 'agent_thinking': {
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleAgentThinking(safeData.executionId, {
                      agentId: safeData.agentId,
                      tokens: safeData.tokens || 0,
                      durationMs: safeData.durationMs || 0,
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Slice G.4b — push canonical `content_block_start` +
                  // `content_block_stop` with `type: 'thinking'`. buildTree
                  // nests it under the active agentStack top so the
                  // sub-agent card body shows the "thinking · N.Ns" row
                  // matching mockup 03's `.sa-subthink` aesthetic. The
                  // canonical thinking content_block does not have an
                  // explicit `agentId` field — agent nesting comes from
                  // the prior `agent_start` push having opened agentStack.
                  if (safeData.agentId) {
                    const blockIdx = syntheticBlockIndexRef.current++;
                    const cbStart: NormalizedStreamEvent = {
                      type: 'content_block_start',
                      index: blockIdx,
                      content_block: { type: 'thinking', thinking: '' },
                    } as unknown as NormalizedStreamEvent;
                    const cbStop: NormalizedStreamEvent = {
                      type: 'content_block_stop',
                      index: blockIdx,
                    } as unknown as NormalizedStreamEvent;
                    normalizedEventsRef.current = [
                      ...normalizedEventsRef.current,
                      cbStart,
                      cbStop,
                    ];
                    setNormalizedEvents([...normalizedEventsRef.current]);
                  }
                  break;
                }

                // Artifact events emitted by agent orchestration when agents produce HTML artifacts
                case 'artifact_start': {
                  // Store accumulator for artifact content
                  (window as any).__pendingArtifact = {
                    type: safeData.type || safeData.artifactType || 'html',
                    title: safeData.title || 'Artifact',
                    content: '',
                  };
                  break;
                }
                case 'artifact_delta': {
                  // Phase H (task #153) — the Phase H artifact_delta
                  // shape carries an `artifactId` + `contentDelta` +
                  // optional `fileName`/`seq`. Route it to the
                  // ArtifactPanel state when present; fall through to
                  // the legacy `{content}` path otherwise.
                  if (safeData.artifactId && typeof safeData.contentDelta === 'string') {
                    setArtifactPanel(prev => {
                      if (!prev || prev.artifactId !== safeData.artifactId) return prev;
                      const fileName = String(safeData.fileName || '__default__');
                      const files = { ...prev.files };
                      const existing = files[fileName] ?? {
                        fileName,
                        language: undefined as string | undefined,
                        content: '',
                        lastSeq: -1,
                      };
                      const incomingSeq =
                        typeof safeData.seq === 'number' ? safeData.seq : existing.lastSeq + 1;
                      if (incomingSeq <= existing.lastSeq && existing.lastSeq >= 0) {
                        // Stale/out-of-order — ignore.
                        return prev;
                      }
                      files[fileName] = {
                        ...existing,
                        content: existing.content + String(safeData.contentDelta),
                        lastSeq: incomingSeq,
                      };
                      return { ...prev, files };
                    });
                    break;
                  }
                  // Legacy chat-artifact path (agent HTML artifacts).
                  const pending = (window as any).__pendingArtifact;
                  if (pending) {
                    pending.content += safeData.content || '';
                  }
                  break;
                }
                case 'artifact_end': {
                  const artifact = (window as any).__pendingArtifact;
                  if (artifact && artifact.content) {
                    const lang = artifact.type === 'html' ? 'html' : artifact.type === 'react' ? 'tsx' : artifact.type;
                    window.dispatchEvent(new CustomEvent('openagentic:open-canvas', {
                      detail: {
                        content: artifact.content,
                        type: lang,
                        title: artifact.title,
                        language: lang,
                      }
                    }));
                  }
                  (window as any).__pendingArtifact = null;
                  break;
                }

                case 'execution_complete': {
                  console.log('[SSE] Execution complete:', safeData.executionId, safeData.status);
                  if (safeData.executionId) {
                    useAgentTreeStore.getState().handleExecutionComplete(safeData.executionId, {
                      totalDurationMs: safeData.totalDurationMs,
                      totalInputTokens: safeData.totalInputTokens,
                      totalOutputTokens: safeData.totalOutputTokens,
                      totalToolCalls: safeData.totalToolCalls,
                      status: safeData.status === 'error' ? 'error' : 'completed',
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  break;
                }

                case 'approval_required': {
                  console.log('[SSE] Agent approval required:', safeData.agentId, safeData.toolName);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleApprovalRequired(safeData.executionId, {
                      agentId: safeData.agentId,
                      toolCallId: safeData.toolCallId || `approval-${Date.now()}`,
                      toolName: safeData.toolName || 'unknown',
                      args: typeof safeData.args === 'string' ? safeData.args : JSON.stringify(safeData.args || ''),
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  break;
                }

                case 'job_completed':
                  // Autonomous job monitoring - background job completed
                  // console.log('[SSE] Background job completed:', {
                  //   jobId: safeData.jobId,
                  //   status: safeData.status,
                  //   completedAt: safeData.completedAt
                  // });

                  // Dispatch a custom event so BackgroundJobsPanel can refresh its list
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('background-job-completed', {
                      detail: {
                        jobId: safeData.jobId,
                        status: safeData.status,
                        result: safeData.result,
                        error: safeData.error,
                        completedAt: safeData.completedAt
                      }
                    }));
                  }

                  // Optionally, inject a system message into the chat
                  const jobStatusMessage = safeData.error
                    ? `Background job ${safeData.jobId} failed: ${safeData.error}`
                    : `Background job ${safeData.jobId} completed successfully`;

                  onMessage?.({
                    id: `job_${safeData.jobId}_${Date.now()}`,
                    role: 'system',
                    content: jobStatusMessage,
                    timestamp: new Date(safeData.completedAt).toISOString(),
                    metadata: {
                      type: 'job_completion',
                      jobId: safeData.jobId,
                      status: safeData.status
                    }
                  });
                  break;

                case 'context_compacted':
                  // Context compaction occurred - show subtle notification to user
                  if (safeData.freedPercent > 0) {
                    setContextCompaction({
                      freedPercent: safeData.freedPercent,
                      tokensFreed: safeData.tokensFreed || 0,
                      compactionLevel: safeData.compactionLevel || 'light',
                    });
                    // Auto-dismiss after 5 seconds
                    setTimeout(() => setContextCompaction(null), 5000);
                  }
                  break;

                case 'mcp_calls_data':
                  // Store MCP calls for the current message AND notify for display
                  console.log('[SSE] MCP calls data received:', {
                    callsCount: safeData.calls?.length,
                    calls: safeData.calls?.map((c: any) => ({ name: c.name, status: c.status }))
                  });

                  if (safeData.calls && safeData.calls.length > 0) {
                    // safeData is already a fresh parsed object - safe to use directly
                    mcpCalls = safeData.calls;

                    // FIX: Mark corresponding tool_use content blocks as complete
                    // This updates the visual status from "running" spinner to checkmark/error
                    safeData.calls.forEach((call: any) => {
                      const toolId = call.id || call.tool || call.name;
                      const isComplete = call.status === 'completed' || call.result !== undefined;

                      setContentBlocks(prev => prev.map(block => {
                        if (block.type === 'tool_use' && (block.toolId === toolId || block.toolName === call.name)) {
                          return { ...block, isComplete };
                        }
                        return block;
                      }));
                      contentBlocksRef.current = contentBlocksRef.current.map(block => {
                        if (block.type === 'tool_use' && (block.toolId === toolId || block.toolName === call.name)) {
                          return { ...block, isComplete };
                        }
                        return block;
                      });
                    });

                    // Notify onToolExecution callback to update activeMcpCalls for real-time display
                    onToolExecution?.({
                      type: 'mcp_calls_data',
                      calls: mcpCalls,
                      round: safeData.round
                    });
                  }
                  break;
                  
                case 'cot_step':
                  // Chain of Thought step event - update COT display
                  if (safeData.step) {
                    setCotSteps(prev => {
                      const existingIndex = prev.findIndex(s => s.id === safeData.step.id);
                      if (existingIndex >= 0) {
                        // Update existing step
                        const updated = [...prev];
                        updated[existingIndex] = { ...updated[existingIndex], ...safeData.step };
                        return updated;
                      } else {
                        // Add new step
                        return [...prev, safeData.step];
                      }
                    });
                  }
                  break;

                case 'cot_data':
                case 'cot_processed':
                  // Legacy CoT events - still processed for backwards compatibility
                  break;

                // ============================================================
                // ANTHROPIC-NATIVE EVENTS
                // These handle raw Anthropic API events if passed through
                // See: https://docs.anthropic.com/en/docs/build-with-claude/streaming
                // ============================================================

                case 'message_start':
                  // Anthropic: Initial message object
                  if (safeData.message?.id) {
                    messageId = safeData.message.id;
                  }
                  break;

                case 'content_block_start':
                  // Anthropic: Start of a content block (thinking, text, or tool_use)
                  // INTERLEAVED THINKING: Add block to contentBlocks array
                  // Handle both Anthropic native format (content_block.type) and OpenAgentic format (blockType)
                  const serverBlockIndex = safeData.index ?? 0;
                  // CRITICAL FIX: Apply offset to get unique index across tool rounds
                  const blockIndex = serverBlockIndex + blockIndexOffsetRef.current;
                  const blockType = (safeData.content_block?.type || safeData.blockType) as 'thinking' | 'text' | 'tool_use';

                  if (blockType) {
                    const blockTimestamp = Date.now();
                    const newBlock: ContentBlock = {
                      id: `block-${blockIndex}-${blockTimestamp}`,  // Unique ID for React key
                      index: blockIndex,
                      type: blockType,
                      content: '',
                      isComplete: false,
                      timestamp: blockTimestamp,
                      // #813 — InlineThinkingBlock derives endedAt = startTime + duration.
                      startTime: blockTimestamp,
                      // Handle both Anthropic format (content_block.name) and OpenAgentic format (toolName)
                      toolName: blockType === 'tool_use' ? (safeData.content_block?.name || safeData.toolName) : undefined,
                      toolId: blockType === 'tool_use' ? (safeData.content_block?.id || safeData.toolId) : undefined,
                    };
                    setContentBlocks(prev => [...prev, newBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, newBlock];

                    console.debug('[SSE] content_block_start - new block:', {
                      serverIndex: serverBlockIndex,
                      offsetIndex: blockIndex,
                      offset: blockIndexOffsetRef.current,
                      type: blockType,
                      toolName: newBlock.toolName
                    });
                  }

                  // Handle thinking block start (both formats)
                  if (blockType === 'thinking') {
                    // Extended thinking block started
                    onThinking?.('Thinking');
                  } else if (blockType === 'tool_use') {
                    // Tool use block started (handle both Anthropic and OpenAgentic formats)
                    const toolId = safeData.content_block?.id || safeData.toolId || `tool_${blockIndex}`;
                    const toolName = safeData.content_block?.name || safeData.toolName || 'unknown';
                    onToolExecution?.({
                      type: 'tool_call_streaming',
                      calls: [{
                        id: toolId,
                        name: toolName,
                        tool: toolName,
                        args: '',
                        status: 'running'
                      }],
                      round: currentPipelineState.activeToolRound || 1
                    });
                  }
                  break;

                case 'content_block_delta':
                  // Anthropic: Delta update for a content block
                  // INTERLEAVED THINKING: Update the correct block in contentBlocks
                  // Handle both Anthropic native format (delta.type) and OpenAgentic format (blockType + content)
                  const serverDeltaIndex = safeData.index;
                  // CRITICAL FIX: Apply offset to match the unique block index
                  const deltaIndex = serverDeltaIndex !== undefined
                    ? serverDeltaIndex + blockIndexOffsetRef.current
                    : undefined;

                  // OpenAgentic format: blockType + content directly on safeData
                  if (safeData.blockType && safeData.content !== undefined) {
                    const awpBlockType = safeData.blockType;
                    const awpContent = safeData.content || '';

                    // Update contentBlocks for interleaved display
                    if (deltaIndex !== undefined) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + awpContent }
                          : block
                      ));
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + awpContent }
                          : block
                      );
                    }

                    // Also update legacy state for backwards compatibility
                    if (awpBlockType === 'thinking') {
                      const newAccumulatedThinking = currentThinkingRef.current + awpContent;
                      currentThinkingRef.current = newAccumulatedThinking;
                      setCurrentThinking(newAccumulatedThinking);
                      onThinkingContent?.(newAccumulatedThinking);
                      // LiveTurnStatus — bump ↓ output tokens on thinking
                      // deltas from the OpenAgentic/OpenAI-normalized path (chars/4
                      // estimate). Activity = last non-empty thinking line
                      // truncated to one inline-tight summary.
                      if (awpContent.length > 0) {
                        setLiveTokensOut(prev => prev + Math.max(1, Math.round(awpContent.length / 4)));
                        const lastLine = newAccumulatedThinking.split('\n').filter(Boolean).pop() ?? '';
                        const trimmed = lastLine.trim().slice(0, 110);
                        if (trimmed) setLiveActivity(trimmed);
                      }
                    } else if (awpBlockType === 'text') {
                      assistantMessage += awpContent;
                      const { cleaned } = extractAndCleanThinkingBlocks(assistantMessage);
                      setCurrentMessage(cleaned);
                      onStream?.(awpContent);
                      // LiveTurnStatus — bump ↓ output tokens on text deltas
                      // from the OpenAgentic/OpenAI-normalized path.
                      if (awpContent.length > 0) {
                        setLiveTokensOut(prev => prev + Math.max(1, Math.round(awpContent.length / 4)));
                        setLiveActivity('writing response');
                      }
                    }
                    break;
                  }

                  // Anthropic native format: delta.type with specific content fields
                  if (safeData.delta?.type === 'thinking_delta') {
                    // Streaming thinking content. See text_delta comment below
                    // for why renders run in startTransition. Refs are still
                    // updated synchronously so the done handler reads current
                    // thinking without waiting for the deferred render.
                    const thinkingDelta = safeData.delta.thinking || '';

                    if (deltaIndex !== undefined) {
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + thinkingDelta }
                          : block
                      );
                    }

                    const newAccumulatedThinking = currentThinkingRef.current + thinkingDelta;
                    currentThinkingRef.current = newAccumulatedThinking;

                    // LiveTurnStatus — bump live ↓ output tokens (~chars/4)
                    // and surface the latest line of the thinking trace as
                    // the "what the model is doing" summary, truncated to a
                    // single short line so the strip stays inline-tight.
                    if (thinkingDelta.length > 0) {
                      setLiveTokensOut(prev => prev + Math.max(1, Math.round(thinkingDelta.length / 4)));
                      const lastLine = newAccumulatedThinking.split('\n').filter(Boolean).pop() ?? '';
                      const trimmed = lastLine.trim().slice(0, 110);
                      if (trimmed) setLiveActivity(trimmed);
                    }

                    startTransition(() => {
                      if (deltaIndex !== undefined) {
                        setContentBlocks(prev => prev.map(block =>
                          block.index === deltaIndex
                            ? { ...block, content: block.content + thinkingDelta }
                            : block
                        ));
                      }
                      setCurrentThinking(newAccumulatedThinking);
                    });
                    onThinkingContent?.(newAccumulatedThinking);
                  } else if (safeData.delta?.type === 'text_delta') {
                    // Streaming text content.
                    //
                    // These updates fire on every chunk (often 10-50/sec) and
                    // re-render SharedMarkdownRenderer each time. React 18's
                    // automatic batching only covers setState calls within one
                    // microtask; the `for await` loop breaks batching across
                    // chunks. Wrapping the render-driving state in
                    // startTransition tells React the delta is interruptible,
                    // so it can coalesce bursts into frame-sized renders.
                    // Fixes the "streaming inline is glitchy and janky" report
                    // (2026-04-18). The ref `contentBlocksRef` is still
                    // updated synchronously elsewhere for correctness.
                    const textDelta = safeData.delta.text || '';
                    assistantMessage += textDelta;
                    const { cleaned } = extractAndCleanThinkingBlocks(assistantMessage);

                    // LiveTurnStatus — bump ↓ output tokens for visible
                    // assistant text. Activity rolls to "writing response"
                    // once we leave the thinking phase.
                    if (textDelta.length > 0) {
                      setLiveTokensOut(prev => prev + Math.max(1, Math.round(textDelta.length / 4)));
                      setLiveActivity('writing response');
                    }

                    startTransition(() => {
                      if (deltaIndex !== undefined) {
                        setContentBlocks(prev => prev.map(block =>
                          block.index === deltaIndex
                            ? { ...block, content: block.content + textDelta }
                            : block
                        ));
                      }
                      setCurrentMessage(cleaned);
                    });
                    onStream?.(textDelta);
                  } else if (safeData.delta?.type === 'input_json_delta') {
                    // Streaming tool input JSON
                    // Update contentBlocks for tool args display
                    const jsonDelta = safeData.delta.partial_json || '';
                    if (deltaIndex !== undefined && jsonDelta) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + jsonDelta }
                          : block
                      ));
                    }
                  } else if (safeData.delta?.type === 'signature_delta') {
                    // Extended thinking signature (for verification)
                    // Store but don't display
                  }
                  break;

                case 'content_block_stop':
                  // Anthropic: End of a content block
                  // INTERLEAVED THINKING: Mark the block as complete
                  // Handle both Anthropic native format and OpenAgentic format
                  const serverStopIndex = safeData.index;
                  // CRITICAL FIX: Apply offset to match the unique block index
                  const stopIndex = serverStopIndex !== undefined
                    ? serverStopIndex + blockIndexOffsetRef.current
                    : undefined;
                  if (stopIndex !== undefined) {
                    // #813 — stamp duration so InlineThinkingBlock renders real
                    // wall-clock elapsed (endedAt = startTime + duration).
                    const stopTs = Date.now();
                    const closeStopBlock = (block: ContentBlock): ContentBlock => {
                      const next: ContentBlock = { ...block, isComplete: true };
                      if (typeof block.startTime === 'number' && block.duration == null) {
                        next.duration = Math.max(0, stopTs - block.startTime);
                      }
                      return next;
                    };
                    setContentBlocks(prev => prev.map(block =>
                      block.index === stopIndex
                        ? closeStopBlock(block)
                        : block
                    ));
                    // Also update ref for closure access
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === stopIndex
                        ? closeStopBlock(block)
                        : block
                    );

                    // If OpenAgentic format includes finalContent, we can use it for verification
                    // but the content should already be accumulated from deltas
                    if (safeData.finalContent && safeData.blockType) {
                      console.debug('[SSE] content_block_stop with finalContent:', {
                        serverIndex: serverStopIndex,
                        offsetIndex: stopIndex,
                        blockType: safeData.blockType,
                        contentLength: safeData.finalContent?.length
                      });
                    }
                  }
                  break;

                case 'message_delta':
                  // Anthropic: Top-level message changes (stop_reason, usage)
                  if (safeData.usage) {
                    // Token usage stats
                    const usage = safeData.usage;
                    setThinkingMetrics({
                      tokens: usage.input_tokens + usage.output_tokens,
                      elapsedMs: 0,
                      tokensPerSecond: 0
                    });
                  }
                  break;

                case 'message_stop':
                  // Anthropic: End of message stream
                  // This is equivalent to our 'done' event
                  // Don't handle here - let 'done' case handle finalization
                  break;

                // ============================================================
                // END ANTHROPIC-NATIVE EVENTS
                // ============================================================

                // ============================================================
                // OpenAgentic UNIFIED ACTIVITY STREAMING EVENTS
                // Version: openagentic-activity-streaming-2025-01
                // These normalize thinking/tools/activity from ALL providers
                // ============================================================

                case 'activity_start':
                  // New activity session started
                  // Store session info if needed for metrics display
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;

                case 'thinking_start':
                  // Thinking/reasoning phase started (Claude, o1, Gemini, DeepSeek)
                  // Create ContentBlock for interleaved display
                  const thinkingBlockIndex = contentBlocksRef.current.length;
                  const thinkingBlockTimestamp = Date.now();
                  const thinkingBlock: ContentBlock = {
                    id: `block-${thinkingBlockIndex}-${thinkingBlockTimestamp}`,  // Unique ID for React key
                    index: thinkingBlockIndex,
                    type: 'thinking',
                    content: '',
                    isComplete: false,
                    timestamp: thinkingBlockTimestamp,
                    // #813 — InlineThinkingBlock derives endedAt = startTime + duration.
                    startTime: thinkingBlockTimestamp,
                  };
                  setContentBlocks(prev => [...prev, thinkingBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, thinkingBlock];
                  currentThinkingBlockIndexRef.current = thinkingBlockIndex;

                  // Capture thinking budget for progress indicator
                  // Budget can come from: budgetTokens, thinkingBudget, maxTokens, or use default
                  const budget = safeData.budgetTokens || safeData.thinkingBudget || safeData.maxTokens || 10000;
                  setThinkingBudget(budget);
                  setThinkingPhase('thinking');

                  onThinking?.(safeData.thinkingMode === 'hidden' ? 'Reasoning' : 'Thinking');
                  break;

                case 'thinking_delta':
                  // Streaming thinking content - use accumulated for accuracy
                  const thinkingDelta = safeData.delta || '';
                  const thinkingAccumulated = safeData.accumulated || '';

                  // Update ContentBlock for interleaved display
                  if (currentThinkingBlockIndexRef.current !== null) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, content: thinkingAccumulated || (block.content + thinkingDelta) }
                        : block
                    ));
                    // Keep ref in sync
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, content: thinkingAccumulated || (block.content + thinkingDelta) }
                        : block
                    );
                  }

                  // Also update legacy currentThinking for backwards compatibility
                  if (thinkingAccumulated) {
                    setCurrentThinking(thinkingAccumulated);
                    onThinkingContent?.(thinkingAccumulated, safeData.tokenCount);
                  } else if (thinkingDelta) {
                    setCurrentThinking(prev => {
                      const accumulated = prev + thinkingDelta;
                      onThinkingContent?.(accumulated, safeData.tokenCount);
                      return accumulated;
                    });
                  }
                  // Update metrics if provided
                  if (safeData.tokenCount !== undefined) {
                    setThinkingMetrics(prev => ({
                      tokens: safeData.tokenCount || prev?.tokens || 0,
                      elapsedMs: safeData.elapsedMs || prev?.elapsedMs || 0,
                      tokensPerSecond: prev?.tokensPerSecond || 0
                    }));
                  }
                  break;

                // NOTE: thinking_complete is handled above at line ~567
                // Removed duplicate case here

                case 'content_start':
                  // Response content phase started - create text ContentBlock for interleaved display
                  const textBlockIndex = contentBlocksRef.current.length;
                  const contentStartTimestamp = Date.now();
                  const textBlock: ContentBlock = {
                    id: `block-${textBlockIndex}-${contentStartTimestamp}`,  // Unique ID for React key
                    index: textBlockIndex,
                    type: 'text',
                    content: '',
                    isComplete: false,
                    timestamp: contentStartTimestamp,
                  };
                  setContentBlocks(prev => [...prev, textBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, textBlock];
                  currentTextBlockIndexRef.current = textBlockIndex;

                  // Update phase to generating for progress indicator
                  setThinkingPhase('generating');
                  break;

                // NOTE: 'content_delta' is handled above in the 'stream'/'content_delta'/'delta' case group
                // to avoid duplicate case clauses

                case 'content_complete':
                  // Response content finished - mark text ContentBlock as complete
                  if (currentTextBlockIndexRef.current !== null) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentTextBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    ));
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentTextBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    );
                    currentTextBlockIndexRef.current = null; // Clear tracking ref
                  }
                  break;

                case 'tool_start':
                  // Tool call initiated (normalized from all providers)
                  onToolExecution?.({
                    type: 'tool_call_streaming',
                    calls: [{
                      id: safeData.toolCallId,
                      name: safeData.toolName,
                      tool: safeData.toolName,
                      args: '',
                      status: 'running'
                    }],
                    round: currentPipelineState.activeToolRound || 1
                  });
                  break;

                case 'tool_delta':
                  // Tool argument streaming (shows args building up)
                  onToolExecution?.({
                    type: 'stream_delta',
                    toolCallId: safeData.toolCallId,
                    delta: safeData.delta,
                    accumulated: safeData.accumulated,
                    sequenceNumber: safeData.sequenceNumber,
                    isValidJson: safeData.isValidJson
                  });
                  break;

                case 'tool_complete':
                  // Tool call ready for execution
                  onToolExecution?.({
                    type: 'stream_complete',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    arguments: safeData.arguments,
                    durationMs: safeData.durationMs,
                    status: 'pending_execution'
                  });
                  break;

                // NOTE: 'tool_result' is handled above at line ~763
                // to avoid duplicate case clauses

                case 'model_info':
                  // Model identification event
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  // Could emit multi-model event for role info
                  if (safeData.role) {
                    onMultiModel?.({
                      type: 'role_start',
                      role: safeData.role,
                      model: safeData.model
                    });
                  }
                  break;

                case 'metrics_update':
                  // Live metrics during streaming
                  if (safeData.tokens) {
                    setThinkingMetrics({
                      tokens: safeData.tokens.total || 0,
                      elapsedMs: safeData.timing?.elapsed || 0,
                      tokensPerSecond: safeData.timing?.tokensPerSecond || 0
                    });
                  }
                  if (safeData.timing?.ttft && !ttftMs) {
                    setTtftMs(safeData.timing.ttft);
                  }
                  break;

                case 'activity_complete':
                  // Activity session finished - similar to done but with more metrics
                  // Let the existing done handler finalize the message
                  break;

                // ============================================================
                // OpenAgentic TOOL STREAMING EVENTS
                // Version: openagentic-tool-streaming-2025-01
                // Fine-grained tool argument streaming
                // ============================================================

                case 'tool_stream_start':
                  // Tool argument streaming started
                  onToolExecution?.({
                    type: 'stream_start',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    toolIndex: safeData.toolIndex,
                    provider: safeData.provider,
                    status: 'streaming'
                  });
                  break;

                case 'tool_stream_delta':
                  // Tool argument chunk received
                  onToolExecution?.({
                    type: 'stream_delta',
                    toolCallId: safeData.toolCallId,
                    delta: safeData.delta,
                    accumulated: safeData.accumulated,
                    sequenceNumber: safeData.sequenceNumber,
                    isValidJson: safeData.isValidJson
                  });
                  break;

                case 'tool_stream_complete':
                  // Tool arguments fully received
                  onToolExecution?.({
                    type: 'stream_complete',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    arguments: safeData.arguments,
                    durationMs: safeData.durationMs,
                    status: 'pending_execution'
                  });
                  break;

                case 'tool_stream_error':
                  // Tool streaming failed
                  onToolExecution?.({
                    type: 'stream_error',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    error: safeData.error,
                    errorCode: safeData.errorCode
                  });
                  break;

                // ============================================================
                // ============================================================
                // RAG CONTEXT EVENT - Knowledge base retrieval completed
                // ============================================================
                case 'rag_context': {
                  const ragDocsCount = safeData.docsRetrieved || 0;
                  const ragCollections = safeData.collections || [];
                  const ragTime = safeData.retrievalTime || 0;

                  if (ragDocsCount > 0) {
                    // Add RAG as a tool_use content block so it shows in the UI
                    const ragBlockIndex = contentBlocksRef.current.length;
                    const ragBlock: ContentBlock = {
                      id: `rag-context-${messageId || Date.now()}`,
                      index: ragBlockIndex,
                      type: 'tool_use',
                      content: JSON.stringify({
                        docsRetrieved: ragDocsCount,
                        collections: ragCollections,
                        retrievalTime: ragTime,
                        sources: safeData.sources || []
                      }),
                      isComplete: true,
                      timestamp: Date.now(),
                      toolName: `RAG Knowledge (${ragDocsCount} docs)`,
                      toolId: `rag_${Date.now()}`,
                    };
                    setContentBlocks(prev => [...prev, ragBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, ragBlock];
                  }
                  break;
                }

                // TOOL CALL EVENT ALIASES
                // Some providers emit these alternative event names
                // ============================================================

                case 'tool_call_start': {
                  // Alias for tool_start - some providers use this name
                  const tcToolId = safeData.toolCallId || safeData.id || `tool_${Date.now()}`;
                  const tcToolName = safeData.toolName || safeData.name || 'unknown';

                  // Create tool_use content block for interleaved display
                  const existingToolBlock = contentBlocksRef.current.find(
                    b => b.type === 'tool_use' && b.toolId === tcToolId
                  );
                  if (!existingToolBlock) {
                    const newBlockIndex = contentBlocksRef.current.length;
                    const newBlock: ContentBlock = {
                      id: `tool-${tcToolId}`,
                      index: newBlockIndex,
                      type: 'tool_use',
                      content: safeData.arguments || safeData.args || '',
                      isComplete: false,
                      timestamp: Date.now(),
                      toolName: tcToolName,
                      toolId: tcToolId,
                    };
                    setContentBlocks(prev => [...prev, newBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, newBlock];
                  }

                  onToolExecution?.({
                    type: 'tool_call_streaming',
                    calls: [{
                      id: tcToolId,
                      name: tcToolName,
                      tool: tcToolName,
                      args: safeData.arguments || safeData.args || '',
                      status: 'running'
                    }],
                    round: currentPipelineState.activeToolRound || 1
                  });
                  break;
                }

                case 'tool_call_result': {
                  // Alias for tool_result - some providers emit this
                  const trToolId = safeData.toolCallId || safeData.id;
                  const trToolName = safeData.toolName || safeData.name;

                  // Mark the corresponding tool_use content block as complete
                  if (trToolId) {
                    setContentBlocks(prev => prev.map(block => {
                      if (block.type === 'tool_use' && (block.toolId === trToolId || block.toolName === trToolName)) {
                        return { ...block, isComplete: true };
                      }
                      return block;
                    }));
                    contentBlocksRef.current = contentBlocksRef.current.map(block => {
                      if (block.type === 'tool_use' && (block.toolId === trToolId || block.toolName === trToolName)) {
                        return { ...block, isComplete: true };
                      }
                      return block;
                    });
                  }

                  onToolExecution?.({
                    type: 'result',
                    name: trToolName,
                    result: safeData.result
                  });
                  break;
                }

                case 'tool_call_error': {
                  // Alias for tool_error - some providers emit this
                  const teToolId = safeData.toolCallId || safeData.id;
                  const teToolName = safeData.toolName || safeData.name;

                  // Mark the corresponding tool_use content block as complete (with error)
                  if (teToolId) {
                    setContentBlocks(prev => prev.map(block => {
                      if (block.type === 'tool_use' && (block.toolId === teToolId || block.toolName === teToolName)) {
                        return { ...block, isComplete: true };
                      }
                      return block;
                    }));
                    contentBlocksRef.current = contentBlocksRef.current.map(block => {
                      if (block.type === 'tool_use' && (block.toolId === teToolId || block.toolName === teToolName)) {
                        return { ...block, isComplete: true };
                      }
                      return block;
                    });
                  }

                  onToolExecution?.({
                    type: 'error',
                    name: teToolName,
                    error: safeData.error
                  });
                  break;
                }

                // ============================================================
                // END OpenAgentic ACTIVITY/TOOL STREAMING EVENTS
                // ============================================================

                case 'image':
                  // CRITICAL FIX: Do NOT add image to assistantMessage here
                  // The backend already emits a 'stream' event with the full markdown content
                  // including the image. Adding it here causes duplication.
                  // Image event logging - disabled in production
                  // if (import.meta.env.DEV) {
                  //   console.log('[SSE] Image event received (will be included in stream event):', {
                  //     imageUrl: safeData.imageUrl,
                  //     revisedPrompt: safeData.revisedPrompt
                  //   });
                  // }
                  // Don't modify assistantMessage - the stream event already contains the image
                  break;
                  
                case 'completion_complete':
                  // CRITICAL: Do NOT add any content here - it was already streamed
                  // This event only carries metadata like toolCalls, usage, finishReason
                  // Capture the model for the final message badge
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;
                  
                case 'done':
                case 'stream_complete':
                  // CRITICAL FIX: Prevent duplicate messages from multiple done events
                  if (hasCompletedStream) {
                    // console.warn('[SSE] Ignoring duplicate done/stream_complete event');
                    break;
                  }
                  hasCompletedStream = true;

                  // CRITICAL FIX: Capture model from done event (server renames completion_complete to done)
                  // This is needed because the completion_complete case may not be hit
                  if (safeData.model && !responseModel) {
                    responseModel = safeData.model;
                  }

                  // Mark pipeline as complete
                  currentPipelineState.currentStage = 'response';
                  currentPipelineState.shouldSuppressContent = false;
                  currentPipelineState.isToolExecutionPhase = false;

                  // Sev-0 2026-05-08: empty-completion fallback. When the
                  // model exits with `end_turn` after a tool-use chain but
                  // emits zero `assistant_message_delta` frames, both
                  // assistantMessage and mcpCalls.length can be 0 even
                  // though tool_use content blocks exist. Without a
                  // fallback the UI hangs on "waiting for first token"
                  // because no message ever gets appended. resolveEmptyCompletionFallback
                  // chooses original content / empty / italic placeholder.
                  const __completionResolution = resolveEmptyCompletionFallback({
                    assistantMessage: assistantMessage || '',
                    mcpCallsLength: mcpCalls.length,
                    hasToolUseBlocks: contentBlocksRef.current.some(
                      b => b.type === 'tool_use' && (b.toolName || b.content),
                    ),
                  });
                  if (__completionResolution.shouldRender) {
                    const __renderableAssistantMessage = __completionResolution.content;
                    // Sev-0 #924/#925/#926 — extract thinking ONCE for use inside
                    // buildDoneMessagePayload (avoids duplicate regex passes).
                    const { thinking: extractedThinking } = extractAndCleanThinkingBlocks(__renderableAssistantMessage || '');

                    // Sev-0 #924/#925/#926 fix — delegate to the pure helper so
                    // the full content_blocks chronology survives finalize.
                    // The pre-fix inline code dropped every block that wasn't
                    // thinking | tool_use (text, viz_render, app_render,
                    // streaming_table, follow_up, sub_agent, hitl_approval,
                    // tool_round, tool_result), causing the post-`done` DOM
                    // to lose all interleaved prose, charts, and apps the
                    // live stream had shown.
                    // 3-Sev-0 #3 (2026-05-18) — persistence completeness.
                    //
                    // The api emits canonical `content_block_delta` with
                    // `thinking_delta` / `text_delta` payloads WITHOUT a
                    // top-level wire `index`. The legacy switch arm
                    // (case 'content_block_delta' at ~line 5019) only
                    // updates `contentBlocksRef` when `safeData.index` is
                    // defined — so the legacy ref MISSES every thinking
                    // delta on the current wire shape. Result: the persisted
                    // `chat_messages.content_blocks` row never contains the
                    // thinking block. On session reload the completed
                    // assistant message renders incompletely ("completed
                    // responses are not rendered").
                    //
                    // The canonical reducer (`applyCanonicalFrame`) DOES
                    // accumulate every block type into
                    // `canonicalReducerStateRef.current.contentBlocks`
                    // regardless of wire index. Prefer it when it has
                    // equal-or-more blocks than the legacy ref. The legacy
                    // ref still wins when it has strictly more blocks (a
                    // corner case: tool_round + tool_result envelopes
                    // mutate the legacy ref via `applyRoundFrame` only).
                    //
                    // Live evidence on chat-dev.openagentic.io image
                    // 0.7.1-f65b94e4 (2026-05-18):
                    //   - Wire: 200+ thinking_delta + 1 text_delta + 1 follow_up
                    //   - Pre-fix DB content_blocks: [text, follow_up]  (thinking MISSING)
                    //   - Canonical reducer state: [thinking, text, follow_up]
                    const canonicalBlocks =
                      canonicalReducerStateRef.current.contentBlocks;
                    const legacyBlocks = contentBlocksRef.current;
                    const sourceBlocks =
                      canonicalBlocks.length >= legacyBlocks.length
                        ? canonicalBlocks
                        : legacyBlocks;

                    const donePayload = buildDoneMessagePayload({
                      contentBlocks: sourceBlocks,
                      assistantMessage: __renderableAssistantMessage || '',
                      mcpCalls,
                      cotSteps: cotStepsRef.current,
                      extractedThinking,
                      currentThinking: currentThinkingRef.current,
                      messageId: messageId || new Date().toISOString(),
                      safeData,
                      responseModel: responseModel || undefined,
                      pipelineState: {
                        stageTiming: currentPipelineState.stageTiming,
                        activeToolRound: currentPipelineState.activeToolRound,
                      },
                    });

                    if (donePayload) {
                      console.log('[SSEChat] Finalizing content blocks:', {
                        canonicalBlocks: canonicalBlocks.length,
                        legacyBlocks: legacyBlocks.length,
                        sourceUsed: sourceBlocks === canonicalBlocks ? 'canonical' : 'legacy',
                        contentBlocksOut: donePayload.content_blocks?.length ?? 0,
                        blockTypes: donePayload.content_blocks?.map((b) => b.type) ?? [],
                      });

                      // P0-2: stamp modelTag/modelId via attachModelIdentifier so MessageHeader
                      //       can render the assistant pill (mocks/UX/01:206-212).
                      onMessage?.(attachModelIdentifier(donePayload, responseModel || undefined));
                    }
                  }

                  // MODERN FIX: Clear active tool execution indicators AFTER final message is queued
                  // The useTransition below ensures onMessage completes before this executes
                  // This prevents stale "✓ Completed" badges from lingering with streaming cursor
                  onToolExecution?.({ type: 'clear_all' });

                  // CRITICAL FIX: Set streaming state IMMEDIATELY when done event is received
                  // The previous use of startTransition caused the "Generating" indicator to persist
                  // because deferred updates have lower priority. For UI indicators, immediate updates are essential.
                  setIsStreaming(false);
                  setCurrentMessage('');
                  // CRITICAL FIX: Clear contentBlocks to prevent duplicate rendering
                  // The final message is now in the messages list, so InterleavedContent should not render
                  setContentBlocks([]);
                  contentBlocksRef.current = [];
                  currentTextBlockIndexRef.current = null;
                  currentThinkingBlockIndexRef.current = null;
                  // DON'T clear thinking content on completion - let it persist for user review!
                  // The thinking will be cleared when a NEW message starts (line ~291)
                  // setCurrentThinking('');  // REMOVED - was hiding thinking from users
                  setThinkingMetrics(null); // Only clear metrics (spinner)

                  setPipelineState({...currentPipelineState});
                  onPipelineStage?.('response', { complete: true });
                  break;
                  
                case 'ping':
                case 'heartbeat':
                case 'keep_alive':
                  // Server keepalive events - no action needed, timeout already reset above
                  break;

                // ==========================================================
                // Task #158 — in-browser Python/JS sandbox (Claude.ai parity)
                //
                // The chat pipeline emits `browser_exec_request` when the
                // model wants a short snippet evaluated (math, data parse,
                // quick plot). We dispatch through sandboxManager, then
                // POST the result envelope back to /api/chat/sandbox-result
                // so the backend can feed it into the model's next turn as
                // a tool_result.
                // ==========================================================
                case 'browser_exec_request': {
                  const req = safeData as unknown as BrowserExecRequest;
                  if (!req?.requestId || !req?.code || !req?.language) {
                    console.warn('[sandbox] malformed browser_exec_request', safeData);
                    break;
                  }
                  // Record the request as a tool_use-shaped content block so
                  // MessageBubble renders a slot for SandboxExecCard.
                  const sandboxBlockIndex = contentBlocksRef.current.length;
                  const sandboxBlock: ContentBlock = {
                    id: `sandbox-${req.requestId}`,
                    index: sandboxBlockIndex,
                    type: 'tool_use',
                    content: JSON.stringify(req),
                    isComplete: false,
                    timestamp: Date.now(),
                    toolName: req.language === 'python' ? 'Python Sandbox' : 'JS Sandbox',
                    toolId: req.requestId,
                  };
                  setContentBlocks(prev => [...prev, sandboxBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, sandboxBlock];

                  // Lazy-import the sandbox manager and run. The POST back
                  // to /api/chat/sandbox-result re-joins the pending turn
                  // on the server side, so the model sees the result as a
                  // tool_result on its next iteration.
                  (async () => {
                    try {
                      const mod = await import('../../../sandbox');
                      const manager = mod.getSandboxManager();
                      const result: BrowserExecResult = await manager.execute(req);
                      // Fire-and-forget POST — backend only needs ok/fail.
                      try {
                        const token = localStorage.getItem('auth_token') || '';
                        await fetch(apiEndpoint('/chat/sandbox-result'), {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { Authorization: `Bearer ${token}` } : {}),
                          },
                          body: JSON.stringify(result),
                        });
                      } catch (postErr) {
                        // Non-fatal — the turn will time out server-side if
                        // the envelope never arrives.
                        console.warn('[sandbox] POST /sandbox-result failed', postErr);
                      }
                      setContentBlocks(prev => prev.map(b =>
                        b.id === sandboxBlock.id
                          ? { ...b, isComplete: true, result: result as unknown }
                          : b
                      ));
                      contentBlocksRef.current = contentBlocksRef.current.map(b =>
                        b.id === sandboxBlock.id
                          ? { ...b, isComplete: true, result: result as unknown }
                          : b
                      );
                    } catch (err) {
                      console.error('[sandbox] execute failed', err);
                      const errResult: BrowserExecResult = {
                        requestId: req.requestId,
                        ok: false,
                        stdout: '',
                        stderr: err instanceof Error ? err.message : String(err),
                        durationMs: 0,
                        errorCode: 'UNKNOWN',
                      };
                      setContentBlocks(prev => prev.map(b =>
                        b.id === sandboxBlock.id
                          ? { ...b, isComplete: true, result: errResult as unknown, error: errResult.stderr }
                          : b
                      ));
                    }
                  })();
                  break;
                }

                case 'browser_exec_result': {
                  // Server-side echo after /api/chat/sandbox-result. Used
                  // purely to surface the final envelope on re-hydrated
                  // history views (the live run path already filled the
                  // block via the async handler above).
                  const result = safeData as unknown as BrowserExecResult;
                  if (!result?.requestId) break;
                  const existingId = `sandbox-${result.requestId}`;
                  setContentBlocks(prev => prev.map(b =>
                    b.id === existingId
                      ? {
                          ...b,
                          isComplete: true,
                          result: result as unknown,
                          error: result.ok ? undefined : result.stderr,
                        }
                      : b
                  ));
                  contentBlocksRef.current = contentBlocksRef.current.map(b =>
                    b.id === existingId
                      ? {
                          ...b,
                          isComplete: true,
                          result: result as unknown,
                          error: result.ok ? undefined : result.stderr,
                        }
                      : b
                  );
                  break;
                }

                default:
                  // FALLBACK HANDLER: Log unknown event types and attempt to render as content
                  // This prevents silently dropping content from unknown/new event types
                  if (eventType) {
                    console.warn(`[SSE] Unknown event type: "${eventType}"`, safeData);

                    // If the unknown event contains content-like data, render it as a text block
                    const fallbackContent = safeData.content || safeData.text || safeData.delta || safeData.message;
                    if (fallbackContent && typeof fallbackContent === 'string' && fallbackContent.trim()) {
                      assistantMessage += fallbackContent;
                      const { cleaned } = extractAndCleanThinkingBlocks(assistantMessage);
                      setCurrentMessage(cleaned);

                      // Update or create text ContentBlock for interleaved display
                      if (currentTextBlockIndexRef.current === null) {
                        const newTextBlockIndex = contentBlocksRef.current.length;
                        const textBlockTimestamp = Date.now();
                        const newTextBlock: ContentBlock = {
                          id: `block-${newTextBlockIndex}-${textBlockTimestamp}`,
                          index: newTextBlockIndex,
                          type: 'text',
                          content: cleaned,
                          isComplete: false,
                          timestamp: textBlockTimestamp,
                        };
                        setContentBlocks(prev => [...prev, newTextBlock]);
                        contentBlocksRef.current = [...contentBlocksRef.current, newTextBlock];
                        currentTextBlockIndexRef.current = newTextBlockIndex;
                      } else {
                        setContentBlocks(prev => prev.map(block =>
                          block.index === currentTextBlockIndexRef.current
                            ? { ...block, content: cleaned }
                            : block
                        ));
                        contentBlocksRef.current = contentBlocksRef.current.map(block =>
                          block.index === currentTextBlockIndexRef.current
                            ? { ...block, content: cleaned }
                            : block
                        );
                      }

                      onStream?.(fallbackContent);
                    }
                  }
                  break;

                case 'normalized': {
                  // UNIFIED_STREAM=true path — backend emits pre-normalised events
                  const normEvent = safeData as NormalizedStreamEvent;
                  normalizedEventsRef.current = [...normalizedEventsRef.current, normEvent];
                  setNormalizedEvents([...normalizedEventsRef.current]);
                  // Continue — do NOT break here so legacy event handling can also fire
                  // (no-op: fall through to default/break via the next case)
                  break;
                }

                case 'error':
                  // Guard against duplicate error messages (fixes 3x error display)
                  if (hasReportedError) {
                    console.log('[SSE] Skipping duplicate error event');
                    break;
                  }
                  hasReportedError = true;

                  console.error('[SSE] Error event received:', safeData);

                  // Enhanced error handling with specific details about what failed
                  let detailedErrorMessage = safeData.message || 'Unknown error occurred';
                  let errorContext = '';

                  // If it's a model provider error, add specific details
                  if (safeData.code === 'PIPELINE_ERROR' || safeData.code === 'COMPLETION_FAILED') {
                    errorContext += `\n\nError Code: ${safeData.code}`;
                    if (safeData.stage) {
                      errorContext += `\nFailed Stage: ${safeData.stage}`;
                    }
                    if (safeData.retryable !== undefined) {
                      errorContext += `\nRetryable: ${safeData.retryable ? 'Yes' : 'No'}`;
                    }

                    // Check for specific model provider issues
                    const lowerMsg = detailedErrorMessage.toLowerCase();
                    if (lowerMsg.includes('could not identify azure model') ||
                        lowerMsg.includes('base_model')) {
                      detailedErrorMessage = `MODEL CONFIGURATION ERROR\n\nCannot identify the Azure model deployment.\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('no provider') ||
                               lowerMsg.includes('provider not found') ||
                               lowerMsg.includes('no llm provider')) {
                      detailedErrorMessage = `NO LLM PROVIDER CONFIGURED\n\nNo AI model provider is available for chat.\n\nAdmin Action Required:\n• Go to Admin Portal → LLM Providers\n• Add at least one enabled provider (Vertex AI, Bedrock, Ollama, etc.)\n• Ensure the provider has a chat model configured\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('model not found') ||
                               lowerMsg.includes('model does not exist') ||
                               lowerMsg.includes('no model') ||
                               lowerMsg.includes('invalid model')) {
                      detailedErrorMessage = `MODEL NOT FOUND\n\nThe selected AI model is not available.\n\nPossible Causes:\n• Model was deleted or renamed\n• Model ID is incorrect\n• Provider doesn't have this model\n\nTry selecting a different model from the dropdown.\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('credential') ||
                               lowerMsg.includes('api key') ||
                               lowerMsg.includes('invalid key') ||
                               lowerMsg.includes('access denied')) {
                      detailedErrorMessage = `CREDENTIAL ERROR\n\nModel provider credentials are invalid or missing.\n\nAdmin Action Required:\n• Go to Admin Portal → LLM Providers\n• Check/update API keys or credentials\n• Verify the credentials have correct permissions\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('failed to connect') ||
                               lowerMsg.includes('connection failed') ||
                               lowerMsg.includes('econnrefused') ||
                               lowerMsg.includes('network')) {
                      detailedErrorMessage = `CONNECTION ERROR\n\nCannot connect to the AI model provider.\n\nCheck if:\n• API service is running\n• Network connectivity is available\n• API endpoints are correct\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('401') ||
                               lowerMsg.includes('unauthorized')) {
                      detailedErrorMessage = `AUTHENTICATION ERROR\n\nModel provider authentication failed.\n\nCheck if:\n• API keys are valid\n• OAuth tokens haven't expired\n• Model deployment permissions are correct\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('quota') ||
                               lowerMsg.includes('rate limit') ||
                               lowerMsg.includes('429')) {
                      detailedErrorMessage = `RATE LIMIT / QUOTA EXCEEDED\n\nThe AI model provider rate limit or quota has been exceeded.\n\nTry:\n• Wait a few minutes and try again\n• Use a different model/provider\n• Contact admin to increase quotas\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('timeout') ||
                               lowerMsg.includes('timed out')) {
                      detailedErrorMessage = `TIMEOUT ERROR\n\nThe AI model took too long to respond.\n\nThis could be due to:\n• High model load\n• Network latency\n• Complex request processing\n\nTechnical Details:\n${detailedErrorMessage}`;
                    }
                  }

                  const enhancedError = new Error(detailedErrorMessage + errorContext);
                  enhancedError.name = safeData.code || 'ChatError';
                  onError?.(enhancedError);
                  break;
              }
            } catch (error) {
              console.error('[SSE] Error parsing SSE data:', error, 'Raw data:', eventData);
            }
          }
        }
      }
    } catch (streamError: any) {
        // CRITICAL FIX: Don't report AbortError - it's expected when sending a new message
        // AbortError occurs when abortControllerRef.current.abort() is called for a new message
        if (streamError.name === 'AbortError') {
          // Stream abort is normal when stopping/sending new message - silent
          return;
        }

        // Firefox "Error in input stream" TypeError - network-level stream timeout
        // Also catch any other TypeError from ReadableStream (Chrome/Safari variants)
        const isStreamTimeout = streamError instanceof TypeError && (
          streamError.message?.includes('input stream') ||
          streamError.message?.includes('terminated') ||
          streamError.message?.includes('network') ||
          streamError.message?.includes('Failed to fetch')
        );

        if (isStreamTimeout) {
          // Phase I (task #154) — durable-stream resume. If the server
          // handed us a turnId in stream_start and we weren't already
          // finalized, try the /tail endpoint to catch up missed frames.
          // This is a best-effort retry: the backend is correct even
          // if we skip it.
          if (resumeTurnIdRef.current && !hasCompletedStream) {
            console.warn(
              '[SSE] Stream connection lost — attempting durable resume via /tail',
              { turnId: resumeTurnIdRef.current, lastSeq: lastSeqRef.current }
            );
            // 500ms back-off per spec so the socket has a chance to
            // settle before we hit the tail endpoint.
            await new Promise(r => setTimeout(r, 500));
            try {
              await attemptTailResume(
                sessionId,
                resumeTurnIdRef.current,
                lastSeqRef.current,
                token!,
                user?.id || user?.userId || ''
              );
            } catch (resumeErr) {
              // Degrade to the pre-#154 behavior — user keeps the
              // partial content they already have.
              console.warn('[SSE] /tail resume failed, falling back to existing content', resumeErr);
            }
            return;
          }
          // Stream connection lost - gracefully finalize with whatever content we have
          console.warn('[SSE] Stream connection lost (browser timeout). Finalizing with existing content.');
          // Don't propagate to onError - the user already has partial content displayed
          // The streaming state will be cleaned up in the finally block
          return;
        }

        // Guard against duplicate error messages (fixes 3x error display)
        if (!hasReportedError) {
          hasReportedError = true;
          console.error('[SSE] Stream processing error:', streamError);
          onError?.(streamError);
        }
      } finally {
        // Clear timeout regardless of how the stream ends
        clearTimeout(streamTimeoutId);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Normal abort - silent
        return;
      }

      // Catch stream timeouts at the outer level too (Firefox/Safari variants)
      const isStreamTimeout = error instanceof TypeError && (
        error.message?.includes('input stream') ||
        error.message?.includes('terminated') ||
        error.message?.includes('network') ||
        error.message?.includes('Failed to fetch')
      );

      if (isStreamTimeout) {
        console.warn('[SSE] Connection lost (outer catch). Finalizing gracefully.');
        return;
      }

      // Guard against duplicate error messages (fixes 3x error display)
      if (!hasReportedError) {
        hasReportedError = true;
        console.error('[SSE] Chat error:', error.message);
        onError?.(error);
      }
    } finally {
      // CRITICAL: If stream ended without explicit done/stream_complete,
      // notify tool execution callbacks so tool cards show abandoned state
      // instead of spinning forever
      if (!hasCompletedStream) {
        onToolExecution?.({ type: 'stream_ended' });
      }
      setIsStreaming(false);
      // DON'T clear currentMessage here - it causes double display
      // It's already handled in the done/stream_complete event handler
      // setCurrentMessage(''); // REMOVED - causes double display bug
      abortControllerRef.current = null;

      // Reset pipeline state
      setPipelineState(createInitialPipelineState());
    }
  }, [sessionId, autoApproveTools, onMessage, onToolExecution, onToolApprovalRequest, onError, onThinking, onThinkingContent, onThinkingComplete, onMultiModel, onStream, onPipelineStage, onToolRound, getAccessToken, animationMode]);
  
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setCurrentMessage(''); // Clear streaming content when stopped
      setCurrentThinking('');
      setContentBlocks([]); // Clear interleaved content blocks when stopped
      contentBlocksRef.current = [];
      setThinkingMetrics(null);
      setCotSteps([]); // Clear COT steps when stopped
    }

    // Reset pipeline state
    setPipelineState(createInitialPipelineState());
  }, []);
  
  // Update animation mode preference
  const updateAnimationMode = useCallback((mode: AnimationMode) => {
    setAnimationMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat-animation-mode', mode);
    }
  }, []);
  
  // Listen for animation mode changes from other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'chat-animation-mode' && e.newValue) {
        const newMode = e.newValue as AnimationMode;
        if (newMode === 'smooth' || newMode === 'none') {
          setAnimationMode(newMode);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  
  // Compute thinkingProgress for the progress indicator
  const thinkingProgress = thinkingBudget > 0 && thinkingMetrics ? {
    tokensUsed: thinkingMetrics.tokens,
    tokenBudget: thinkingBudget,
    percentage: Math.min(100, (thinkingMetrics.tokens / thinkingBudget) * 100),
    phase: thinkingPhase,
  } : undefined;

  return {
    sendMessage,
    stopStreaming,
    isStreaming,
    currentMessage,
    currentThinking,
    isThinkingCompleted, // Whether thinking phase has finished (for UI collapse)
    thinkingMetrics,
    thinkingProgress, // Thinking progress for real progress indicator
    ttftMs, // Time to First Token - for debugging slow responses
    turnStartedAt, // ms ts of the current turn-start (LiveTurnStatus)
    liveTokensIn, // running ↑ input tokens (LiveTurnStatus)
    liveTokensOut, // running ↓ output tokens (LiveTurnStatus)
    liveActivity, // short summary of what the model is doing right now
    pipelineState,
    animationMode,
    updateAnimationMode,
    cotSteps, // Chain of Thought steps for COT UI display
    contentBlocks, // Interleaved content blocks for thinking/text display
    canonicalContentBlocks: canonicalReducerState.contentBlocks,
    contextCompaction, // Context compaction notification data (auto-dismisses after 5s)
    normalizedEvents, // Normalized stream events (UNIFIED_STREAM=true path)
    runningCost, // v0.6.7 fix 2 — streaming running cost (USD) from cost_delta events
    // Phase G (task #152) — trust / observability state slots
    handoffEvent, // smart-router / multi-model handoff envelope
    retryEvents, // tool-execution retry envelopes (list)
    currentStage, // active pipeline stage (discover/query/analyze/generate/verify)
    stageTimings, // elapsed-ms per stage (hover tooltips)
    ragCitations, // per-chunk platform RAG hits
    correctionEvent, // self-correction before/after envelope
    warnings, // soft warnings (level/source/code/message)
    ragStatus, // rag retrieval status line payload
    memoryStatus, // memory check status line payload
    dlpScan, // DLP scan status (scanning/passed/redacted/blocked)
    toolCacheHits, // map of tool name → cache-hit info
    selfCritique, // self-critique summary
    hallucinationWarning, // hallucination warning envelope
    // Phase H (task #153) — artifact / image / session / memory state slots.
    artifactPanel, // streaming artifact state (open/delta/close lifecycle)
    imageProgress, // live image-gen progress envelope
    // visualRenders / appRenders / artifactRenders are ripped — those wire
    // frames now route through applyCanonicalFrame into the typed-block
    // contentBlocks[] array and render inline inside AgenticActivityStream.
    // Wave 3 (#525) — per-message intent classification + tool shortlist
    // keyed by assistant messageId. Consumed by ToolShortlistChip
    // in ChatMessages.
    intentClassifications,
    toolShortlists,
    // #502 — sub-agent lifecycle entries from sub_agent_* envelopes.
    // Consumed by ChatMessages to render SubAgentCard per active dispatch.
    subAgents,
    // P0-1 part 2 — same data scoped per messageId so older message bubbles
    // render only the sub-agents dispatched DURING their own turn. Consumers
    // can prefer this map when available; the flat `subAgents` stays for
    // legacy callers and chrome that doesn't need per-message scoping.
    subAgentsByMessageId,
    // P1-6 — per-message streaming-table state. ChatMessages threads
    // `streamingTablesByMessageId[message.id]` into each MessageBubble so
    // tables render inline alongside prose, scoped to the message that
    // produced them.
    streamingTablesByMessageId,
    // Phase 27 — per-message findings artifacts (mocks 03, 07, 08, 09).
    findingsByMessageId,
    // #502 — per-message inline widgets (kpi_grid / savings_card /
    // stages_strip / wave_timeline / runbook / stack_grid / annotated_code).
    inlineWidgetsByMessageId,
    // AC-B — per-message synth lifecycle entries. ChatMessages renders
    // a <SynthCard> per entry showing the model's authored Python
    // streaming in, the approval CTA, the executing/stdout state, and
    // the completion/failed state.
    synthsByMessageId,
    // AC-D — per-message clickable download tiles. ChatMessages
    // renders one <DownloadTile> per entry with filename + size +
    // click → presigned MinIO URL.
    artifactEmitsByMessageId,
    memoryWrites, // list of memory_write pills fired this turn
    sessionRename, // latest session-rename animation payload
    // Phase I (task #154) — durable-stream resume visible signal.
    // Brief "↻ Reconnected" pill that renders for 2s after a successful
    // tail-replay recovers from a mid-turn disconnect. `null` otherwise.
    reconnectedPill,
    // Audit §10 step 16 — HITL approval cards (mocks 09, 15).
    // (follow_up chip row ripped 2026-05-12 — user directive.)
    hitlApprovalsByMessageId,
    // Q1-fix-8 (2026-05-12) — expose the setter so the Approve/Deny
    // click handler in ChatContainer can transition card status from
    // `pending` to `approved`/`denied` after the POST resolves. Without
    // this the buttons stay clickable forever even after a successful
    // approval since the live state never updates.
    setHitlApprovalsByMessageId,
    // B8 — per-message content_filter compliance banner. ChatMessages
    // renders <ContentFilterBanner> when set. Replaces silent-truncate
    // end_turn UX for Azure RAI / Vertex SAFETY / Vertex RECITATION.
    contentFilterBannerByMessageId,
  };
};

// Back-compat alias for importers mid-migration.
// Remove after all call sites migrate to `useChatStream`.
export const useSSEChat = useChatStream;

// build-bust: 1fd3915c-rebuild-1
