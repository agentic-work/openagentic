/**
 * deriveCurrentActivity — pure helper turning the latest assistant
 * message's blocks into a one-line "what is the agent doing right now"
 * string for the running-state header heartbeat.
 *
 * Goal: parity with claude code's TUI live status where the user
 * NEVER sees a static "Thinking…" with no further detail. Examples:
 *
 *   "Reasoning… 12.3s"           // open thinking block, no text yet
 *   "Reasoning: Let me first…"   // open thinking block with content
 *   "Bash: running…"             // open tool_use, no name resolved
 *   "Bash: ls -la"               // open tool_use, args parsed
 *   "Writing /a/b/c.ts"          // Write tool_use streaming
 *   "Reading /a/b/c.ts"          // Read tool_use streaming
 *   "TodoWrite: 3 todos"         // structured tool_use
 *   "Streaming response…"        // open text block (deltas arriving)
 *
 * Returns null when the latest assistant message is not streaming —
 * caller hides the heartbeat in that case.
 */

import type {
  AssistantBlock,
  AssistantChatMessage,
  ChatMessage,
  UiTextBlock,
  UiThinkingBlock,
  UiToolUseBlock,
} from '../types/uiState';
import { summarizeTodoProgress, type RawTodo } from './deriveCurrentTodos';
import { tryParseInput } from '../chat/sdkAdapter';

const PREVIEW_CAP = 70;

function clip(s: string, n = PREVIEW_CAP): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trimEnd() + '…';
}

/** Tools that read a path — `input.file_path` is the human signal. */
const READ_TOOLS = new Set([
  'Read', 'FileRead', 'Glob', 'Grep', 'NotebookRead',
]);
/** Tools that write a path — present-tense "Writing" reads better than "Write". */
const WRITE_TOOLS = new Set([
  'Write', 'FileWrite', 'Edit', 'FileEdit', 'NotebookEdit',
]);

/** Best-effort label for a Bash tool, derived from its `command` arg. */
function bashLabel(input: Record<string, unknown> | undefined): string {
  const cmd = typeof input?.command === 'string' ? (input.command as string) : '';
  if (!cmd) return 'Bash: running…';
  return `Bash: ${clip(cmd)}`;
}

function pathFromInput(input: Record<string, unknown> | undefined): string | null {
  for (const k of ['file_path', 'path', 'notebook_path']) {
    const v = input?.[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

function todoLabel(name: string, input: Record<string, unknown> | undefined): string | null {
  const todos = input?.todos;
  if (!Array.isArray(todos)) return null;
  return `${name}: ${todos.length} todo${todos.length === 1 ? '' : 's'}`;
}

export function describeToolUse(block: UiToolUseBlock): string {
  const name = block.name || 'Tool';
  const input = block.input;

  if (name === 'Bash') return bashLabel(input);

  if (name === 'TodoWrite' || name === 'Todo') {
    // Prefer parsed input.todos; fall back to partialInputJson while
    // the block is still streaming so the heartbeat shows progress
    // ("2/5 · doing X") within the SAME turn rather than "5 todos".
    let todos: RawTodo[] | null =
      Array.isArray((input as Record<string, unknown> | undefined)?.todos)
        ? ((input as { todos: RawTodo[] }).todos)
        : null;
    if (!todos && block.partialInputJson) {
      const parsed = tryParseInput(block.partialInputJson);
      if (parsed && Array.isArray((parsed as Record<string, unknown>).todos)) {
        todos = (parsed as { todos: RawTodo[] }).todos;
      }
    }
    if (todos && todos.length > 0) {
      const summary = summarizeTodoProgress(todos);
      if (summary) return `${name}: ${summary}`;
    }
    const lbl = todoLabel(name, input);
    if (lbl) return lbl;
    return `${name}: updating…`;
  }

  if (READ_TOOLS.has(name)) {
    const p = pathFromInput(input);
    if (p) return `Reading ${clip(p, 80)}`;
    // Glob has `pattern`, Grep has `pattern` — surface that, not "reading…"
    const pattern = typeof input?.pattern === 'string' ? (input.pattern as string) : '';
    const query = typeof input?.query === 'string' ? (input.query as string) : '';
    const v = pattern || query;
    if (v) return `${name}: ${clip(v)}`;
    return `${name}: reading…`;
  }

  if (WRITE_TOOLS.has(name)) {
    const p = pathFromInput(input);
    return p ? `Writing ${clip(p, 80)}` : `${name}: writing…`;
  }

  // Generic fallback: show the tool name and a hint of its first arg.
  if (input && typeof input === 'object') {
    const firstKey = Object.keys(input).find((k) => typeof input[k] === 'string');
    if (firstKey) {
      const v = String(input[firstKey]);
      if (v) return `${name}: ${clip(v)}`;
    }
  }
  return `${name}: running…`;
}

function describeThinking(block: UiThinkingBlock): string {
  const t = block.thinking?.trim();
  if (!t) return 'Reasoning…';
  return `Reasoning: ${clip(t)}`;
}

function describeText(block: UiTextBlock): string {
  const t = block.text?.trim();
  if (!t) return 'Streaming response…';
  return `Replying: ${clip(t)}`;
}

/**
 * Pick the most relevant currently-streaming block from the latest
 * assistant message. Tool-use beats thinking beats text — when a tool
 * is in flight, that's what the user wants to see. Within a kind, the
 * LAST streaming block wins (parallel tools etc.).
 */
export function deriveCurrentActivity(
  messages: ChatMessage[] | undefined,
): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  // Walk from end to find the latest assistant message that's streaming.
  let latest: AssistantChatMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as ChatMessage;
    if (m.role === 'assistant') {
      latest = m as AssistantChatMessage;
      break;
    }
  }
  if (!latest || !latest.streaming) return null;
  const blocks: AssistantBlock[] = Array.isArray(latest.blocks) ? latest.blocks : [];

  // Tool-use takes precedence — if any tool is streaming OR the most
  // recent block is a tool-use whose result hasn't arrived yet, show it.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === 'tool_use') {
      const tu = b as UiToolUseBlock;
      if (tu.streaming || !tu.result) return describeToolUse(tu);
    }
  }
  // Otherwise prefer the latest streaming thinking block.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === 'thinking') {
      const tk = b as UiThinkingBlock;
      if (tk.streaming) return describeThinking(tk);
    }
  }
  // Otherwise the latest streaming text block.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === 'text') {
      const tx = b as UiTextBlock;
      if (tx.streaming) return describeText(tx);
    }
  }
  // Streaming message with no live block — generic.
  return 'Working…';
}
