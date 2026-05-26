/**
 * enrichTodos — adds deep-viz fields onto each TodoWrite item by walking
 * the assistant transcript chronologically:
 *
 *   - startedAtMs:  when the todo first transitioned to in_progress
 *   - durationMs:   how long it has been (or was) active
 *   - subtasks:     every non-Todo tool_use that ran while the todo was
 *                   in_progress, summarized as a per-tool card
 *   - tokensIn / tokensOut: sum of usage.inputTokens / outputTokens of
 *                   every assistant message that landed during the
 *                   in_progress window (LLM cost attributed to the todo)
 *
 * The attribution logic walks messages left-to-right. At each point in
 * time exactly one (or zero) todos is "active". When a TodoWrite snapshot
 * marks a new id as in_progress, that id becomes active. Tool_use blocks
 * encountered between snapshots get attached to whatever id is currently
 * active. Same for token usage on the containing message.
 *
 * Pure; no React, no clocks (durationMs uses `now` arg so callers can
 * inject Date.now() at render time for live ticking, or pass a fixed
 * value for tests).
 */

import type {
  AssistantBlock,
  AssistantChatMessage,
  ChatMessage,
  UiToolResult,
  UiToolUseBlock,
} from '../types/uiState';
import { tryParseInput } from '../chat/sdkAdapter';

export interface SubtaskCard {
  toolUseId: string;
  toolName: string;
  /** Short human label — Bash command, Write path, etc. */
  summary: string;
  status: 'running' | 'done' | 'failed';
  /** Best-effort: createdAt of the assistant message the tool_use lived in. */
  startedAtMs?: number;
  /** Wall time the tool spent — from block.elapsedSec or 0 if unknown. */
  elapsedSec?: number;
  /** Compact result preview (first line of stdout/text) when finished. */
  resultPreview?: string;
}

export interface EnrichedTodo {
  id: string;
  content: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  /** Wall-clock when the agent first marked this todo in_progress. */
  startedAtMs?: number;
  /** Wall-clock when the agent marked this todo completed (if any). */
  completedAtMs?: number;
  /** Live-tickable duration in ms. */
  durationMs?: number;
  /** Tools that ran while this todo was in_progress, in chronological order. */
  subtasks: SubtaskCard[];
  /** Sum of inputTokens of LLM turns that landed during this todo's window. */
  tokensIn: number;
  /** Sum of outputTokens of LLM turns that landed during this todo's window. */
  tokensOut: number;
}

/** Best-effort one-liner per tool_use, mirroring deriveCurrentActivity logic. */
function summarizeTool(block: UiToolUseBlock): string {
  const name = block.name;
  const input = block.input as Record<string, unknown> | undefined;
  if (name === 'Bash') {
    const cmd = typeof input?.command === 'string' ? (input.command as string) : '';
    return cmd ? cmd.slice(0, 80) : 'running…';
  }
  for (const k of ['file_path', 'path', 'notebook_path']) {
    const v = input?.[k];
    if (typeof v === 'string' && v) return v;
  }
  if (input && typeof input === 'object') {
    for (const k of Object.keys(input)) {
      const v = input[k];
      if (typeof v === 'string' && v) return v.slice(0, 80);
    }
  }
  return name;
}

function isTodoTool(name: string): boolean {
  return name === 'TodoWrite' || name === 'Todo';
}

function inferStatus(block: UiToolUseBlock): SubtaskCard['status'] {
  const r: UiToolResult | undefined = block.result;
  if (r) return r.isError ? 'failed' : 'done';
  return block.streaming || !block.result ? 'running' : 'done';
}

function resultPreview(block: UiToolUseBlock): string | undefined {
  const t = block.result?.text;
  if (typeof t !== 'string' || !t) return undefined;
  const firstLine = t.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return undefined;
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '…' : firstLine;
}

interface RawTodo {
  id?: string | number;
  content?: string;
  activeForm?: string;
  status?: string;
}

/**
 * Pull the latest TodoWrite snapshot from a single block (or the
 * partial-stream payload), if it is one.
 */
function todoSnapshot(block: AssistantBlock): RawTodo[] | null {
  if (block.kind !== 'tool_use') return null;
  const tu = block as UiToolUseBlock;
  if (!isTodoTool(tu.name)) return null;
  const direct = (tu.input as Record<string, unknown> | undefined)?.todos;
  if (Array.isArray(direct)) return direct as RawTodo[];
  // Fallback to partialInputJson via tryParseInput so streaming snapshots count.
  if (tu.partialInputJson) {
    const parsed = tryParseInput(tu.partialInputJson);
    if (parsed && Array.isArray((parsed as Record<string, unknown>).todos)) {
      return (parsed as { todos: RawTodo[] }).todos;
    }
  }
  return null;
}

function todoKey(t: RawTodo, fallbackIdx: number): string {
  return String(t.id ?? `idx-${fallbackIdx}`);
}

export function enrichTodos(
  messages: ChatMessage[] | undefined,
  now: number,
): EnrichedTodo[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  // Final canonical ordering of todos comes from the LATEST snapshot we see.
  // We need ordering data in case the agent reorders. Track also the LATEST
  // status + content per id so we render the agent's most recent intent.
  const latestById = new Map<string, RawTodo>();
  const order: string[] = [];

  // Tracking state as we walk turns:
  //   activeId  — id currently in_progress (or null)
  //   startedAtMs[id] — first ms when id became in_progress
  //   completedAtMs[id] — first ms when id became completed
  //   subtasks[id] — accumulated SubtaskCard list
  //   tokensIn[id], tokensOut[id]
  let activeId: string | null = null;
  const startedAtMs = new Map<string, number>();
  const completedAtMs = new Map<string, number>();
  const subtasks = new Map<string, SubtaskCard[]>();
  const tokensIn = new Map<string, number>();
  const tokensOut = new Map<string, number>();

  function ensureBucket<T>(map: Map<string, T[]>, key: string): T[] {
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    return arr;
  }

  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const asst = m as AssistantChatMessage;
    const blocks: AssistantBlock[] = Array.isArray(asst.blocks) ? asst.blocks : [];
    const msgTimeMs = asst.createdAt > 0 ? asst.createdAt : 0;

    // First sweep: surface any TodoWrite snapshot in this message. The
    // snapshot defines the activeId for any non-Todo tool_use blocks
    // that come AFTER it in the same message. So we walk in order.
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];

      if (b.kind === 'tool_use') {
        const tu = b as UiToolUseBlock;
        const snap = todoSnapshot(b);
        if (snap !== null) {
          // Update canonical ordering / latest snapshot
          for (let j = 0; j < snap.length; j++) {
            const t = snap[j];
            const k = todoKey(t, j);
            if (!latestById.has(k)) order.push(k);
            latestById.set(k, t);
            // Detect status transitions
            if (t.status === 'in_progress' && !startedAtMs.has(k)) {
              startedAtMs.set(k, msgTimeMs || now);
            }
            if (t.status === 'completed' && !completedAtMs.has(k)) {
              completedAtMs.set(k, msgTimeMs || now);
            }
          }
          // Update activeId — first in_progress in this snapshot wins
          const nextActive = snap.find((t) => t.status === 'in_progress');
          activeId = nextActive
            ? todoKey(nextActive, snap.indexOf(nextActive))
            : null;
        } else {
          // Non-Todo tool_use → attribute to current activeId
          if (activeId) {
            const list = ensureBucket(subtasks, activeId);
            list.push({
              toolUseId: tu.toolUseId,
              toolName: tu.name,
              summary: summarizeTool(tu),
              status: inferStatus(tu),
              startedAtMs: msgTimeMs || undefined,
              elapsedSec: tu.elapsedSec,
              resultPreview: resultPreview(tu),
            });
          }
        }
      }
    }

    // Token usage — attribute the message's full usage to the
    // currently-active todo (if any). For messages that span TodoWrite
    // transitions we conservatively bill the message to the activeId
    // that won at the END of the message, since that's where the agent
    // settled. A future refinement could split by block.
    if (asst.usage && activeId) {
      const tIn = asst.usage.inputTokens || 0;
      const tOut = asst.usage.outputTokens || 0;
      tokensIn.set(activeId, (tokensIn.get(activeId) || 0) + tIn);
      tokensOut.set(activeId, (tokensOut.get(activeId) || 0) + tOut);
    }
  }

  // Build enriched output in canonical order.
  const out: EnrichedTodo[] = [];
  for (const k of order) {
    const t = latestById.get(k)!;
    const status: EnrichedTodo['status'] =
      t.status === 'in_progress' || t.status === 'completed' ? t.status : 'pending';
    const start = startedAtMs.get(k);
    const completed = completedAtMs.get(k);
    let durationMs: number | undefined;
    if (start) {
      const end = completed ?? (status === 'in_progress' ? now : undefined);
      if (end) durationMs = Math.max(0, end - start);
    }
    out.push({
      id: k,
      content: String(t.content ?? ''),
      activeForm: t.activeForm ? String(t.activeForm) : undefined,
      status,
      startedAtMs: start,
      completedAtMs: completed,
      durationMs,
      subtasks: subtasks.get(k) ?? [],
      tokensIn: tokensIn.get(k) ?? 0,
      tokensOut: tokensOut.get(k) ?? 0,
    });
  }
  return out;
}

/** Format a duration (ms) compact: "0.4s", "12s", "3m 04s". */
export function formatDurationMs(ms: number | undefined): string {
  if (typeof ms !== 'number' || ms <= 0) return '';
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${rem.toString().padStart(2, '0')}s`;
}

/** Format token count compact: "12,341" / "4.2k" / "1.1M". */
export function formatTokens(n: number | undefined): string {
  if (typeof n !== 'number' || n <= 0) return '';
  if (n < 1000) return String(n);
  if (n < 10_000) return n.toLocaleString();
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}
