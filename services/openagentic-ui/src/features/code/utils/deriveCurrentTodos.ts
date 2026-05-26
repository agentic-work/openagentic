/**
 * deriveCurrentTodos — pure helper that pulls the latest todo list from
 * the assistant transcript. Walks every assistant message + every block,
 * picking the most-recent TodoWrite/Todo tool_use whose input has a
 * `todos` array. CRITICAL: also handles in-flight streaming blocks by
 * falling back to `tryParseInput(partialInputJson)` so the panel updates
 * LIVE as the agent streams its next Todo call instead of waiting for
 * the block to fully close.
 *
 * Returns an empty array when no Todo has been called yet OR when the
 * latest Todo's payload can't be parsed.
 */

import { tryParseInput } from '../chat/sdkAdapter';
import type {
  AssistantBlock,
  AssistantChatMessage,
  ChatMessage,
  UiToolUseBlock,
} from '../types/uiState';

export interface RawTodo {
  id?: string | number;
  content?: string;
  activeForm?: string;
  status?: string;
}

/**
 * Pull the array of todos from a tool_use block. Tries `block.input.todos`
 * first (parsed) — when the block is still streaming, falls through to
 * tryParseInput(partialInputJson) which handles AIF's `{}{real}` quirk.
 */
function extractTodos(block: UiToolUseBlock): RawTodo[] | null {
  const direct = (block.input as Record<string, unknown> | undefined)?.todos;
  if (Array.isArray(direct)) return direct as RawTodo[];
  if (block.partialInputJson) {
    const parsed = tryParseInput(block.partialInputJson);
    if (parsed && Array.isArray((parsed as Record<string, unknown>).todos)) {
      return (parsed as { todos: RawTodo[] }).todos;
    }
  }
  return null;
}

function isTodoBlock(block: AssistantBlock): block is UiToolUseBlock {
  if (block.kind !== 'tool_use') return false;
  const name = (block as UiToolUseBlock).name;
  return name === 'TodoWrite' || name === 'Todo';
}

/**
 * Walk every assistant message's blocks (and Task sub-blocks) end-to-end
 * and return the LAST Todo payload encountered. Picks up live streaming
 * updates because extractTodos falls back to partialInputJson.
 */
export function deriveCurrentTodos(
  messages: ChatMessage[] | undefined,
): RawTodo[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  let latest: RawTodo[] | null = null;
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const asst = m as AssistantChatMessage;
    const stack: AssistantBlock[] = Array.isArray(asst.blocks) ? [...asst.blocks] : [];
    while (stack.length > 0) {
      const b = stack.shift()!;
      if (isTodoBlock(b)) {
        const todos = extractTodos(b);
        if (todos !== null) latest = todos;
      }
      if (b.kind === 'tool_use') {
        const sub = (b as UiToolUseBlock).subBlocks;
        if (Array.isArray(sub) && sub.length > 0) stack.push(...sub);
      }
    }
  }
  return latest ?? [];
}

/**
 * Compact summary like "2/5 done" for the activity heartbeat. Returns
 * null when there are no todos.
 */
export function summarizeTodoProgress(todos: RawTodo[] | undefined): string | null {
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const total = todos.length;
  const done = todos.filter((t) => t?.status === 'completed').length;
  const inProgress = todos.find((t) => t?.status === 'in_progress');
  const verb =
    inProgress?.activeForm || inProgress?.content || (done === total ? 'all done' : 'pending');
  return `${done}/${total} · ${verb}`;
}
