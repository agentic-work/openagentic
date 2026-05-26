/**
 * enrichTodos — TDD coverage for the deep-viz attribution helper.
 * User asks: "subtasks need time running and token usage."
 */
import { describe, it, expect } from 'vitest';
import {
  enrichTodos,
  formatDurationMs,
  formatTokens,
} from '../enrichTodos';
import type {
  AssistantChatMessage,
  ChatMessage,
  UiToolUseBlock,
} from '../../types/uiState';

const userMsg = (id: string, t = 0): ChatMessage => ({
  id,
  role: 'user',
  text: 'hi',
  createdAt: t,
});

interface AsstOpts {
  id?: string;
  createdAt?: number;
  usage?: { inputTokens: number; outputTokens: number };
}
const asst = (
  blocks: AssistantChatMessage['blocks'],
  opts: AsstOpts = {},
): AssistantChatMessage => ({
  id: opts.id ?? 'asst-x',
  role: 'assistant',
  blocks,
  streaming: false,
  createdAt: opts.createdAt ?? 0,
  usage: opts.usage,
});

const todoBlock = (
  todos: Array<{ id: string; content: string; status: string; activeForm?: string }>,
): UiToolUseBlock => ({
  kind: 'tool_use',
  toolUseId: 'tw-' + Math.random().toString(36).slice(2, 7),
  name: 'TodoWrite',
  partialInputJson: JSON.stringify({ todos }),
  input: { todos },
  streaming: false,
});

const toolBlock = (
  name: string,
  input: Record<string, unknown> = {},
  opts: { result?: string; isError?: boolean; elapsedSec?: number; streaming?: boolean } = {},
): UiToolUseBlock => ({
  kind: 'tool_use',
  toolUseId: `${name}-${Math.random().toString(36).slice(2, 7)}`,
  name,
  partialInputJson: JSON.stringify(input),
  input,
  streaming: opts.streaming ?? false,
  result: opts.result
    ? { text: opts.result, isError: opts.isError ?? false, hasImage: false }
    : undefined,
  elapsedSec: opts.elapsedSec,
});

describe('enrichTodos', () => {
  it('returns [] for empty input', () => {
    expect(enrichTodos([], 0)).toEqual([]);
    expect(enrichTodos(undefined, 0)).toEqual([]);
  });

  it('marks startedAt when status flips to in_progress', () => {
    const t0 = 1_000_000;
    const m1 = asst(
      [
        todoBlock([
          { id: 'a', content: 'do A', status: 'pending' },
          { id: 'b', content: 'do B', status: 'pending' },
        ]),
      ],
      { createdAt: t0 },
    );
    const m2 = asst(
      [
        todoBlock([
          { id: 'a', content: 'do A', status: 'in_progress' },
          { id: 'b', content: 'do B', status: 'pending' },
        ]),
      ],
      { createdAt: t0 + 5_000 },
    );
    const out = enrichTodos([m1, m2], t0 + 12_000);
    const a = out.find((t) => t.id === 'a')!;
    expect(a.status).toBe('in_progress');
    expect(a.startedAtMs).toBe(t0 + 5_000);
    expect(a.durationMs).toBe(7_000);
  });

  it('captures completedAt and finalizes durationMs when finished', () => {
    const t0 = 1000;
    const m1 = asst([todoBlock([{ id: 'a', content: 'A', status: 'in_progress' }])], { createdAt: t0 });
    const m2 = asst([todoBlock([{ id: 'a', content: 'A', status: 'completed' }])], {
      createdAt: t0 + 4_000,
    });
    const out = enrichTodos([m1, m2], t0 + 100_000);
    const a = out[0];
    expect(a.status).toBe('completed');
    expect(a.startedAtMs).toBe(t0);
    expect(a.completedAtMs).toBe(t0 + 4_000);
    expect(a.durationMs).toBe(4_000);
  });

  it('attributes non-Todo tool_use to the active todo as a subtask', () => {
    const t0 = 1000;
    const m1 = asst(
      [
        todoBlock([{ id: 'a', content: 'A', status: 'in_progress' }]),
        toolBlock('Bash', { command: 'ls -la' }, { result: 'a\nb\nc', elapsedSec: 0.3 }),
        toolBlock('Write', { file_path: '/x/y.ts' }, { result: 'created', elapsedSec: 0.4 }),
      ],
      { createdAt: t0 },
    );
    const out = enrichTodos([m1], t0);
    expect(out[0].subtasks.length).toBe(2);
    expect(out[0].subtasks[0]).toMatchObject({
      toolName: 'Bash',
      summary: 'ls -la',
      status: 'done',
      elapsedSec: 0.3,
      resultPreview: 'a',
    });
    expect(out[0].subtasks[1]).toMatchObject({
      toolName: 'Write',
      summary: '/x/y.ts',
      status: 'done',
    });
  });

  it('marks a subtask as failed when its result has isError:true', () => {
    const m = asst([
      todoBlock([{ id: 'a', content: 'A', status: 'in_progress' }]),
      toolBlock('Bash', { command: 'false' }, { result: 'exited 1', isError: true }),
    ]);
    expect(enrichTodos([m], 0)[0].subtasks[0].status).toBe('failed');
  });

  it('marks a subtask as running while no result has arrived yet', () => {
    const m = asst([
      todoBlock([{ id: 'a', content: 'A', status: 'in_progress' }]),
      toolBlock('Bash', { command: 'sleep 5' }, { streaming: true }),
    ]);
    expect(enrichTodos([m], 0)[0].subtasks[0].status).toBe('running');
  });

  it('does NOT attach subtasks to a todo that was never in_progress', () => {
    const m = asst([
      todoBlock([{ id: 'a', content: 'A', status: 'pending' }]),
      toolBlock('Bash', { command: 'ls' }, { result: 'x' }),
    ]);
    expect(enrichTodos([m], 0)[0].subtasks).toEqual([]);
  });

  it('switches subtask attribution when a new todo becomes in_progress', () => {
    const m1 = asst([
      todoBlock([
        { id: 'a', content: 'A', status: 'in_progress' },
        { id: 'b', content: 'B', status: 'pending' },
      ]),
      toolBlock('Bash', { command: 'before-switch' }, { result: 'ok' }),
      todoBlock([
        { id: 'a', content: 'A', status: 'completed' },
        { id: 'b', content: 'B', status: 'in_progress' },
      ]),
      toolBlock('Bash', { command: 'after-switch' }, { result: 'ok' }),
    ]);
    const out = enrichTodos([m1], 0);
    const a = out.find((t) => t.id === 'a')!;
    const b = out.find((t) => t.id === 'b')!;
    expect(a.subtasks.map((s) => s.summary)).toEqual(['before-switch']);
    expect(b.subtasks.map((s) => s.summary)).toEqual(['after-switch']);
  });

  it('aggregates token usage across messages while a todo is active', () => {
    const m1 = asst([todoBlock([{ id: 'a', content: 'A', status: 'in_progress' }])], {
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    const m2 = asst(
      [toolBlock('Bash', { command: 'ls' }, { result: 'x' })],
      { usage: { inputTokens: 200, outputTokens: 30 } },
    );
    const m3 = asst([todoBlock([{ id: 'a', content: 'A', status: 'completed' }])], {
      usage: { inputTokens: 50, outputTokens: 5 },
    });
    const out = enrichTodos([m1, m2, m3], 0);
    // m1 (100/20) and m2 (200/30) bill while activeId='a'.
    // m3 marks 'a' completed first, so by end-of-message activeId=null
    // and m3's tokens are not attributed (avoids bleed past completion).
    expect(out[0].tokensIn).toBe(300);
    expect(out[0].tokensOut).toBe(50);
  });

  it('does NOT bill tokens to a todo that was never in_progress', () => {
    const m = asst(
      [todoBlock([{ id: 'a', content: 'A', status: 'pending' }])],
      { usage: { inputTokens: 100, outputTokens: 10 } },
    );
    expect(enrichTodos([m], 0)[0].tokensIn).toBe(0);
  });

  it('walks user messages without choking', () => {
    const t0 = 1000;
    const m1 = asst([todoBlock([{ id: 'a', content: 'A', status: 'in_progress' }])], { createdAt: t0 });
    const u = userMsg('u1', t0 + 100);
    const m2 = asst([toolBlock('Bash', { command: 'echo' }, { result: 'hi' })], {
      createdAt: t0 + 200,
    });
    const out = enrichTodos([m1, u, m2], t0 + 1_000);
    expect(out[0].subtasks.length).toBe(1);
  });

  it('produces durationMs that ticks live for in_progress', () => {
    const t0 = 1_000_000;
    const m = asst([todoBlock([{ id: 'a', content: 'A', status: 'in_progress' }])], { createdAt: t0 });
    expect(enrichTodos([m], t0 + 1_500)[0].durationMs).toBe(1_500);
    expect(enrichTodos([m], t0 + 30_000)[0].durationMs).toBe(30_000);
  });
});

describe('formatDurationMs', () => {
  it('formats sub-10s with one decimal', () => {
    expect(formatDurationMs(450)).toBe('0.5s');
    expect(formatDurationMs(9_000)).toBe('9.0s');
  });
  it('formats 10s..60s as integer seconds', () => {
    expect(formatDurationMs(12_400)).toBe('12s');
    expect(formatDurationMs(59_900)).toBe('60s');
  });
  it('formats minute scale', () => {
    expect(formatDurationMs(125_000)).toBe('2m 05s');
    expect(formatDurationMs(3_600_000)).toBe('60m 00s');
  });
  it('returns empty for nullish or zero', () => {
    expect(formatDurationMs(undefined)).toBe('');
    expect(formatDurationMs(0)).toBe('');
  });
});

describe('formatTokens', () => {
  it('formats small counts as-is', () => {
    expect(formatTokens(0)).toBe('');
    expect(formatTokens(42)).toBe('42');
  });
  it('formats 1k–10k with locale separator', () => {
    expect(formatTokens(1_234)).toBe('1,234');
    expect(formatTokens(9_999)).toBe('9,999');
  });
  it('formats 10k+ as Xk', () => {
    expect(formatTokens(12_345)).toBe('12.3k');
  });
  it('formats million scale', () => {
    expect(formatTokens(1_400_000)).toBe('1.4M');
  });
});
