/**
 * deriveCurrentTodos — TDD coverage. Goal: the ActiveTaskBar panel
 * updates LIVE as the agent streams its next TodoWrite call, not just
 * once each block fully closes. Falls back to partialInputJson via
 * tryParseInput when block.input is not yet populated.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveCurrentTodos,
  summarizeTodoProgress,
  type RawTodo,
} from '../deriveCurrentTodos';
import type {
  AssistantChatMessage,
  ChatMessage,
  UiToolUseBlock,
} from '../../types/uiState';

const asst = (
  blocks: AssistantChatMessage['blocks'],
  streaming = false,
): AssistantChatMessage => ({
  id: 'asst-x',
  role: 'assistant',
  blocks,
  streaming,
  createdAt: 1,
});

const todoBlock = (
  todos: RawTodo[] | null,
  opts: { partialInputJson?: string; streaming?: boolean; name?: string } = {},
): UiToolUseBlock => ({
  kind: 'tool_use',
  toolUseId: 'tw1',
  name: opts.name ?? 'TodoWrite',
  partialInputJson: opts.partialInputJson ?? (todos ? JSON.stringify({ todos }) : ''),
  input: todos ? { todos } : undefined,
  streaming: opts.streaming ?? false,
});

const userMsg = (s: string): ChatMessage => ({
  id: 'u1',
  role: 'user',
  text: s,
  createdAt: 1,
});

describe('deriveCurrentTodos', () => {
  it('returns [] for empty input', () => {
    expect(deriveCurrentTodos([])).toEqual([]);
    expect(deriveCurrentTodos(undefined)).toEqual([]);
  });

  it('returns [] when no Todo block exists', () => {
    expect(deriveCurrentTodos([userMsg('hi')])).toEqual([]);
  });

  it('returns the todos from the only TodoWrite block', () => {
    const m = asst([todoBlock([{ content: 'a', status: 'pending' }])]);
    expect(deriveCurrentTodos([m])).toEqual([{ content: 'a', status: 'pending' }]);
  });

  it('picks the LAST Todo block when multiple are present', () => {
    const m = asst([
      todoBlock([{ content: 'plan' }]),
      todoBlock([{ content: 'execute', status: 'in_progress' }]),
    ]);
    expect(deriveCurrentTodos([m])).toEqual([
      { content: 'execute', status: 'in_progress' },
    ]);
  });

  it('falls back to partialInputJson on a streaming block (live update)', () => {
    const streaming = todoBlock(null, {
      streaming: true,
      partialInputJson: '{"todos":[{"content":"step1","status":"in_progress"}]}',
    });
    expect(deriveCurrentTodos([asst([streaming], true)])).toEqual([
      { content: 'step1', status: 'in_progress' },
    ]);
  });

  it('handles the AIF `{}{real}` prefix in partialInputJson', () => {
    const streaming = todoBlock(null, {
      streaming: true,
      partialInputJson: '{}{"todos":[{"content":"writing"}]}',
    });
    expect(deriveCurrentTodos([asst([streaming], true)])).toEqual([
      { content: 'writing' },
    ]);
  });

  it('treats `Todo` (singular) the same as `TodoWrite`', () => {
    const m = asst([
      todoBlock([{ content: 'x' }], { name: 'Todo' }),
    ]);
    expect(deriveCurrentTodos([m])).toEqual([{ content: 'x' }]);
  });

  it('keeps the previous Todo when a new streaming block has no parseable payload yet', () => {
    const m = asst([
      todoBlock([{ content: 'first' }]),
      todoBlock(null, { streaming: true, partialInputJson: '{"todos":[{"con' }),
    ]);
    expect(deriveCurrentTodos([m])).toEqual([{ content: 'first' }]);
  });

  it('picks up Todos from Task sub-blocks too', () => {
    const m = asst([
      {
        kind: 'tool_use',
        toolUseId: 'task-x',
        name: 'Task',
        partialInputJson: '{}',
        streaming: false,
        subBlocks: [todoBlock([{ content: 'inside-task' }])],
      } as UiToolUseBlock,
    ]);
    expect(deriveCurrentTodos([m])).toEqual([{ content: 'inside-task' }]);
  });

  it('walks across multiple assistant messages and returns the latest', () => {
    const m1 = asst([todoBlock([{ content: 'old' }])], false);
    const m2 = asst([todoBlock([{ content: 'new', status: 'in_progress' }])], true);
    expect(deriveCurrentTodos([m1, userMsg('keep going'), m2])).toEqual([
      { content: 'new', status: 'in_progress' },
    ]);
  });
});

describe('summarizeTodoProgress', () => {
  it('returns null when there are no todos', () => {
    expect(summarizeTodoProgress([])).toBeNull();
    expect(summarizeTodoProgress(undefined)).toBeNull();
  });

  it('summarizes done count + active verb when in_progress is present', () => {
    expect(
      summarizeTodoProgress([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress', activeForm: 'doing b' },
        { content: 'c', status: 'pending' },
      ]),
    ).toBe('1/3 · doing b');
  });

  it('falls back to content when activeForm is absent', () => {
    expect(
      summarizeTodoProgress([
        { content: 'first', status: 'in_progress' },
        { content: 'second', status: 'pending' },
      ]),
    ).toBe('0/2 · first');
  });

  it('shows "all done" when every todo is completed', () => {
    expect(
      summarizeTodoProgress([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'completed' },
      ]),
    ).toBe('2/2 · all done');
  });

  it('shows "pending" when nothing is in progress yet', () => {
    expect(
      summarizeTodoProgress([
        { content: 'a', status: 'pending' },
        { content: 'b', status: 'pending' },
      ]),
    ).toBe('0/2 · pending');
  });
});
