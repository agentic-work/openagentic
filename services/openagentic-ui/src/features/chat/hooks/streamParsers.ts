/**
 * streamParsers — pure parsers / normalizers / pipeline helpers for the chat
 * streaming engine.
 *
 * Leaf module: pipeline-stage helpers, thinking-block extraction, the model
 * identifier split, the empty-completion contract, and the E1.5 wire-shape
 * normalizers. No React state / refs / hooks. Extracted verbatim from
 * `useChatStream.ts` (behaviour-preserving), which imports these back +
 * re-exports them.
 */
import type {
  PipelineState,
  PipelineStage,
  AnimationMode,
  ModelIdentifier,
  EmptyCompletionInputs,
  EmptyCompletionResolution,
} from './streamTypes';

// Create initial pipeline state
export const createInitialPipelineState = (): PipelineState => ({
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
export const shouldSuppressContentForStage = (stage: PipelineStage | null, toolRound: number): boolean => {
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
export const mapBackendStage = (eventType: string): PipelineStage | null => {
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
export const getAnimationMode = (): AnimationMode => {
  if (typeof window === 'undefined') return 'none';
  
  const saved = localStorage.getItem('chat-animation-mode');
  if (saved === 'smooth' || saved === 'none') return saved;
  
  // Default to smooth for better UX now that we have proper pipeline awareness
  return 'smooth';
};
// Extract thinking blocks and return both cleaned content and thinking
export function extractAndCleanThinkingBlocks(content: string): { cleaned: string; thinking: string } {
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
export function cleanThinkingBlocks(content: string): string {
  return extractAndCleanThinkingBlocks(content).cleaned;
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
export function extractToolExecutingArgs(safeData: unknown): unknown {
  if (safeData == null || typeof safeData !== 'object') return undefined;
  const d = safeData as Record<string, unknown>;
  if ('input' in d && d.input !== undefined) return d.input;
  if ('arguments' in d && d.arguments !== undefined) return d.arguments;
  return undefined;
}

export function extractToolExecutingToolUseId(safeData: unknown): string | undefined {
  if (safeData == null || typeof safeData !== 'object') return undefined;
  const d = safeData as Record<string, unknown>;
  if (typeof d.tool_use_id === 'string') return d.tool_use_id;
  if (typeof d.toolCallId === 'string') return d.toolCallId;
  return undefined;
}

export function extractToolResultContent(safeData: unknown): unknown {
  if (safeData == null || typeof safeData !== 'object') return undefined;
  const d = safeData as Record<string, unknown>;
  if ('content' in d && d.content !== undefined) return d.content;
  if ('result' in d && d.result !== undefined) return d.result;
  return undefined;
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
