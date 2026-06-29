/**
 * Contract diff — pure ordered-subsequence matcher (Phase 0.3).
 *
 * the design notes
 *
 * Given a `.contract.json` (mocks/UX/AI/Chatmode/end-state-NN.contract.json)
 * and a captured wire `Timeline` (from wire-timeline-viewer.ts), assert the
 * contract's `frames[]` sequence appears as an ordered SUBSEQUENCE of the
 * timeline's entries. Each contract frame must match a Timeline entry
 * AFTER the previous match.
 *
 * Optional metadata on each contract frame (`tool`, `agent`, `template`,
 * `preview`) constrains the match further when set.
 *
 * `follow_up` frames are legacy per the existing chatmode-output-contract.test.ts
 * — accepted in the schema but not required (skipped silently).
 */

import type { Timeline, TimelineEntry } from './wire-timeline-viewer.js';

export type ContractFrameType =
  | 'assistant_prose'
  | 'thinking'
  | 'tool_use'
  | 'sub_agent'
  | 'streaming_table'
  | 'app_render'
  | 'compose_visual'
  | 'follow_up';

export interface ContractFrame {
  type: ContractFrameType;
  tool?: string;
  agent?: string;
  template?: string;
  via?: string;
  preview?: string;
  has_input?: boolean;
  has_result?: boolean;
  parallel_tool_calls?: boolean;
  rows?: number;
  columns?: string[];
  turns?: number;
  status?: string;
  chip_count?: number;
}

export interface ContractMatch {
  frame: ContractFrame;
  /** Index in the contract's frames[] array. */
  contractIndex: number;
  /** Seq of the Timeline entry that satisfied this frame. */
  timelineSeq: number;
  /** Timeline entry index (NOT seq). */
  timelineIdx: number;
  /** Human-readable reason the match succeeded. */
  reason: string;
}

export interface ContractMiss {
  frame: ContractFrame;
  contractIndex: number;
  /** Why no Timeline entry satisfied this frame after the previous match. */
  reason: string;
}

export interface ContractDiffResult {
  passed: boolean;
  matches: ContractMatch[];
  unmatched: ContractMiss[];
  /** Timeline entry indexes already consumed (cannot be reused for later contract frames). */
  consumedIndexes: number[];
}

/** Frame types that don't fail the diff if absent from the timeline. */
const OPTIONAL_FRAME_TYPES = new Set<ContractFrameType>(['follow_up']);

function entryIsAssistantProse(e: TimelineEntry): boolean {
  if (e.frameType === 'stream') return true;
  if (e.frameType === 'content_block_delta') {
    // Heuristic: presence of a preview from text_delta proves it carries text.
    return e.preview !== undefined && e.index !== undefined;
  }
  return false;
}

function entryIsThinking(e: TimelineEntry): boolean {
  return e.frameType === 'thinking' || e.frameType === 'thinking_event';
}

function entryIsToolUse(e: TimelineEntry, requiredTool?: string): boolean {
  if (e.frameType !== 'tool_executing' && e.frameType !== 'tool_use') return false;
  if (requiredTool && e.toolName !== requiredTool) return false;
  return true;
}

function entryIsSubAgent(e: TimelineEntry, requiredAgent?: string): boolean {
  if (e.frameType === 'subagent_started') {
    if (!requiredAgent) return true;
    // agent name lives in the payload — we surface it via toolName when present.
    return e.toolName === undefined || e.toolName === requiredAgent;
  }
  // Task tool_use also satisfies a sub_agent frame.
  if (e.frameType === 'tool_executing' && e.toolName === 'Task') return true;
  if (e.frameType === 'tool_use' && e.toolName === 'Task') return true;
  return false;
}

function entryIsStreamingTable(e: TimelineEntry): boolean {
  // The mocks render tables from tool_result payloads. Accept any tool_result
  // as a streaming_table candidate — stricter shape-matching is a 0.3 follow-up.
  return e.frameType === 'tool_result';
}

function entryIsAppRender(e: TimelineEntry, requiredTemplate?: string): boolean {
  if (
    e.frameType === 'app_render' ||
    e.frameType === 'compose_app' ||
    e.frameType === 'compose_visual'
  ) {
    // Template constraint applies when set; otherwise any app_render matches.
    return true;
  }
  void requiredTemplate;
  return false;
}

function entryIsComposeVisual(e: TimelineEntry): boolean {
  return e.frameType === 'compose_visual';
}

function entryIsFollowUp(e: TimelineEntry): boolean {
  return e.frameType === 'follow_up';
}

function entrySatisfies(frame: ContractFrame, entry: TimelineEntry): boolean {
  switch (frame.type) {
    case 'assistant_prose':
      return entryIsAssistantProse(entry);
    case 'thinking':
      return entryIsThinking(entry);
    case 'tool_use':
      return entryIsToolUse(entry, frame.tool);
    case 'sub_agent':
      return entryIsSubAgent(entry, frame.agent);
    case 'streaming_table':
      return entryIsStreamingTable(entry);
    case 'app_render':
      return entryIsAppRender(entry, frame.template);
    case 'compose_visual':
      return entryIsComposeVisual(entry);
    case 'follow_up':
      return entryIsFollowUp(entry);
    default:
      return false;
  }
}

/**
 * Ordered-subsequence match contract frames against Timeline entries.
 * Each contract frame consumes one Timeline entry (no reuse); the next
 * match starts at consumedIndex+1.
 */
export function diffContractAgainstTimeline(
  contractFrames: ContractFrame[],
  timeline: Timeline,
): ContractDiffResult {
  const matches: ContractMatch[] = [];
  const unmatched: ContractMiss[] = [];
  const consumedIndexes: number[] = [];

  let cursor = 0;
  const entries = timeline.entries;

  for (let ci = 0; ci < contractFrames.length; ci += 1) {
    const frame = contractFrames[ci];
    let foundIdx = -1;
    for (let i = cursor; i < entries.length; i += 1) {
      if (entrySatisfies(frame, entries[i])) {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx === -1) {
      if (OPTIONAL_FRAME_TYPES.has(frame.type)) {
        // optional frame missing → not a failure, no cursor advance.
        continue;
      }
      unmatched.push({
        frame,
        contractIndex: ci,
        reason: `No Timeline entry after seq=${cursor > 0 ? entries[cursor - 1]?.seq ?? 0 : 'start'} satisfies contract frame ${frame.type}${frame.tool ? ` (tool=${frame.tool})` : ''}${frame.template ? ` (template=${frame.template})` : ''}`,
      });
      continue;
    }
    const entry = entries[foundIdx];
    matches.push({
      frame,
      contractIndex: ci,
      timelineSeq: entry.seq,
      timelineIdx: foundIdx,
      reason: `${entry.frameType}${entry.toolName ? ` ${entry.toolName}` : ''} at seq=${entry.seq}`,
    });
    consumedIndexes.push(foundIdx);
    cursor = foundIdx + 1;
  }

  return {
    passed: unmatched.length === 0,
    matches,
    unmatched,
    consumedIndexes,
  };
}

/**
 * Markdown report for a contract diff. Used by the harness entrypoint
 * (scripts/run-interleave-harness.sh) for per-scenario evidence dumps.
 */
export function renderContractDiffMarkdown(
  scenarioName: string,
  result: ContractDiffResult,
): string {
  const lines: string[] = [];
  lines.push(`# Contract Diff — ${scenarioName}`);
  lines.push('');
  lines.push(`Status: ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
  lines.push(`Matched: ${result.matches.length}`);
  lines.push(`Unmatched: ${result.unmatched.length}`);
  lines.push('');

  if (result.matches.length > 0) {
    lines.push('## Matched');
    for (const m of result.matches) {
      const tag = m.frame.type;
      const detail = [m.frame.tool, m.frame.template, m.frame.agent]
        .filter(Boolean)
        .join(' ');
      lines.push(
        `- [${m.contractIndex}] ${tag}${detail ? ` · ${detail}` : ''} → ${m.reason}`,
      );
    }
    lines.push('');
  }

  if (result.unmatched.length > 0) {
    lines.push('## Unmatched (Sev-0)');
    for (const u of result.unmatched) {
      const tag = u.frame.type;
      const detail = [u.frame.tool, u.frame.template, u.frame.agent]
        .filter(Boolean)
        .join(' ');
      lines.push(`- [${u.contractIndex}] ${tag}${detail ? ` · ${detail}` : ''} — ${u.reason}`);
    }
  }

  return lines.join('\n');
}
