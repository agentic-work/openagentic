/**
 * deriveCurrentActivity — TDD coverage for the live "what is the agent
 * doing right now" string used by the running-state heartbeat.
 *
 * Behavior contract: claude code TUI parity — never a static
 * "Thinking…" with no detail. Every streaming state must surface a
 * recognizable, glanceable phrase.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveCurrentActivity,
  describeToolUse,
} from '../deriveCurrentActivity';
import type {
  AssistantChatMessage,
  ChatMessage,
  UiTextBlock,
  UiThinkingBlock,
  UiToolUseBlock,
} from '../../types/uiState';

const asst = (
  blocks: AssistantChatMessage['blocks'],
  streaming = true,
): AssistantChatMessage => ({
  id: 'asst-x',
  role: 'assistant',
  blocks,
  streaming,
  createdAt: 1,
});

const thinking = (text = '', streaming = true): UiThinkingBlock => ({
  kind: 'thinking',
  thinking: text,
  streaming,
});

const text = (t = '', streaming = true): UiTextBlock => ({
  kind: 'text',
  text: t,
  streaming,
});

const toolUse = (
  name: string,
  input: Record<string, unknown> = {},
  opts: Partial<UiToolUseBlock> = {},
): UiToolUseBlock => ({
  kind: 'tool_use',
  toolUseId: 't1',
  name,
  partialInputJson: JSON.stringify(input),
  input,
  streaming: false,
  ...opts,
});

const userMsg = (s: string): ChatMessage => ({
  id: 'u1',
  role: 'user',
  text: s,
  createdAt: 1,
});

describe('deriveCurrentActivity', () => {
  it('returns null when there is no assistant message', () => {
    expect(deriveCurrentActivity([userMsg('hi')])).toBeNull();
  });

  it('returns null when the last assistant message is not streaming', () => {
    const m = asst([thinking('all done', false)], false);
    expect(deriveCurrentActivity([m])).toBeNull();
  });

  it('shows "Reasoning…" for an empty open thinking block', () => {
    const m = asst([thinking('')]);
    expect(deriveCurrentActivity([m])).toBe('Reasoning…');
  });

  it('previews the first sentence of a streaming thinking block', () => {
    const m = asst([thinking('Let me start by listing the files.')]);
    expect(deriveCurrentActivity([m])).toBe(
      'Reasoning: Let me start by listing the files.',
    );
  });

  it('shows "Bash: <command>" for a tool_use with a command field', () => {
    const m = asst([toolUse('Bash', { command: 'ls -la' }, { streaming: true })]);
    expect(deriveCurrentActivity([m])).toBe('Bash: ls -la');
  });

  it('shows generic Bash hint when command is missing', () => {
    const m = asst([toolUse('Bash', {}, { streaming: true })]);
    expect(deriveCurrentActivity([m])).toBe('Bash: running…');
  });

  it('shows "Writing <path>" for Write tool with file_path', () => {
    const m = asst([
      toolUse('Write', { file_path: '/workspaces/x/main.ts', content: '...' }, { streaming: true }),
    ]);
    expect(deriveCurrentActivity([m])).toBe('Writing /workspaces/x/main.ts');
  });

  it('shows "Reading <path>" for Read tool', () => {
    const m = asst([
      toolUse('Read', { file_path: '/a.ts' }, { streaming: true }),
    ]);
    expect(deriveCurrentActivity([m])).toBe('Reading /a.ts');
  });

  it('shows "Editing" via the Edit tool', () => {
    const m = asst([
      toolUse('Edit', { file_path: '/b.tsx', new_string: 'x' }, { streaming: true }),
    ]);
    expect(deriveCurrentActivity([m])).toBe('Writing /b.tsx');
  });

  it('shows "TodoWrite: N/M · status" when input.todos is an array', () => {
    // Items without status default to pending → 0/3 done with "pending" verb.
    const m = asst([
      toolUse('TodoWrite', { todos: [1, 2, 3] }, { streaming: true }),
    ]);
    expect(deriveCurrentActivity([m])).toBe('TodoWrite: 0/3 · pending');
  });

  it('handles the singular "Todo" alias the daemon uses', () => {
    const m = asst([
      toolUse('Todo', { todos: [{ content: 'a', status: 'pending' }] }, { streaming: true }),
    ]);
    expect(deriveCurrentActivity([m])).toBe('Todo: 0/1 · pending');
  });

  it('shows live "1/3 · doing X" progress with an in-progress item', () => {
    const m = asst([
      toolUse('TodoWrite', {
        todos: [
          { content: 'first', status: 'completed' },
          { content: 'second', status: 'in_progress', activeForm: 'doing second' },
          { content: 'third', status: 'pending' },
        ],
      }, { streaming: true }),
    ]);
    expect(deriveCurrentActivity([m])).toBe('TodoWrite: 1/3 · doing second');
  });

  it('prefers a still-pending tool_use over a completed thinking block', () => {
    const m = asst([
      thinking('done', false),
      toolUse('Bash', { command: 'echo hi' }, { streaming: true }),
    ]);
    expect(deriveCurrentActivity([m])).toBe('Bash: echo hi');
  });

  it('prefers tool_use whose result is missing even if streaming flipped to false', () => {
    // tool_use closed but no tool_result yet — agent is "waiting on tool"
    const m = asst([
      toolUse('Bash', { command: 'sleep 5' }, { streaming: false }),
    ]);
    expect(deriveCurrentActivity([m])).toBe('Bash: sleep 5');
  });

  it('falls through to thinking when the tool_use has a result already', () => {
    const m = asst([
      toolUse(
        'Bash',
        { command: 'ls' },
        {
          streaming: false,
          result: { text: 'foo bar', isError: false, hasImage: false },
        },
      ),
      thinking('Now analyzing the output'),
    ]);
    expect(deriveCurrentActivity([m])).toBe(
      'Reasoning: Now analyzing the output',
    );
  });

  it('shows "Replying: …" when the agent is streaming text', () => {
    const m = asst([text('The answer is 42.')]);
    expect(deriveCurrentActivity([m])).toBe('Replying: The answer is 42.');
  });

  it('shows generic "Streaming response…" when text block is empty', () => {
    const m = asst([text('')]);
    expect(deriveCurrentActivity([m])).toBe('Streaming response…');
  });

  it('clips long previews at the cap with ellipsis', () => {
    const long = 'a'.repeat(200);
    const m = asst([thinking(long)]);
    const result = deriveCurrentActivity([m])!;
    expect(result.startsWith('Reasoning: ')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual('Reasoning: '.length + 70);
  });

  it('walks back to find the latest assistant message past a user echo', () => {
    const earlierAsst = asst([thinking('old', false)], false);
    const u = userMsg('hi again');
    const newer = asst([toolUse('Bash', { command: 'pwd' }, { streaming: true })]);
    expect(deriveCurrentActivity([earlierAsst, u, newer])).toBe('Bash: pwd');
  });
});

describe('describeToolUse — direct unit coverage', () => {
  it('Glob falls into READ_TOOLS family', () => {
    expect(describeToolUse(toolUse('Glob', { pattern: '**/*.ts' }))).toBe(
      'Glob: **/*.ts',
    );
  });
  it('unknown tool falls back to first string arg', () => {
    expect(describeToolUse(toolUse('Mystery', { query: 'who' }))).toBe(
      'Mystery: who',
    );
  });
  it('unknown tool with no string args returns running…', () => {
    expect(describeToolUse(toolUse('Mystery', { count: 7 }))).toBe(
      'Mystery: running…',
    );
  });
});
