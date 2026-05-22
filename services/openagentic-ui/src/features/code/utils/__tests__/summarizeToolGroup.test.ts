/**
 * Contract guard for the rolled-up tool-group summary helper.
 *
 * Mirrors how claude.ai/code labels a sequence of tool calls inside a
 * single assistant turn — `Created 4 files, ran a command, updated todos`.
 * Phrases are joined with commas in first-occurrence order; only the
 * first phrase is capitalized.
 */

import { describe, expect, it } from 'vitest';

import { summarizeToolGroup } from '../summarizeToolGroup';
import type { UiToolUseBlock } from '../../types/uiState';

function tool(name: string): UiToolUseBlock {
  return {
    kind: 'tool_use',
    toolUseId: `tu-${Math.random().toString(36).slice(2, 8)}`,
    name,
    input: {},
    streamingState: 'ready',
    rawInputText: '',
  } as unknown as UiToolUseBlock;
}

describe('summarizeToolGroup', () => {
  it('returns empty string for an empty group', () => {
    expect(summarizeToolGroup([])).toBe('');
  });

  it('singularizes single Write as "Created a file"', () => {
    expect(summarizeToolGroup([tool('Write')])).toBe('Created a file');
  });

  it('groups 4× Write + 1× Bash + 1× TodoWrite as the canonical claude-code phrase', () => {
    const tools = [
      tool('Write'),
      tool('Write'),
      tool('Write'),
      tool('Write'),
      tool('Bash'),
      tool('TodoWrite'),
    ];
    expect(summarizeToolGroup(tools)).toBe('Created 4 files, ran a command, updated todos');
  });

  it('groups 3× Bash + 1× Edit as "Ran 3 commands, edited a file"', () => {
    const tools = [tool('Bash'), tool('Bash'), tool('Bash'), tool('Edit')];
    expect(summarizeToolGroup(tools)).toBe('Ran 3 commands, edited a file');
  });

  it('handles Grep as "searched code" without a number', () => {
    expect(summarizeToolGroup([tool('Grep')])).toBe('Searched code');
  });

  it('handles TodoWrite as "updated todos" regardless of count', () => {
    expect(summarizeToolGroup([tool('TodoWrite'), tool('TodoWrite')])).toBe('Updated todos');
  });

  it('handles Task tool as "Ran an agent" (article picks "an" before vowel)', () => {
    expect(summarizeToolGroup([tool('Task')])).toBe('Ran an agent');
  });

  it('preserves first-occurrence order across grouping', () => {
    // Bash first, then Write, then Bash again — Bash count merges across
    // the gap and the phrase order keeps Bash before Write.
    const tools = [tool('Bash'), tool('Write'), tool('Bash')];
    expect(summarizeToolGroup(tools)).toBe('Ran 2 commands, created a file');
  });

  it('falls back to "used a tool" for unknown tool names', () => {
    expect(summarizeToolGroup([tool('DefinitelyNotARealTool')])).toBe('Used a tool');
  });

  it('renders multi-edit family as "Edited"', () => {
    expect(summarizeToolGroup([tool('Edit'), tool('FileEdit'), tool('MultiEdit')])).toBe(
      'Edited 3 files',
    );
  });

  it('only capitalizes the first phrase', () => {
    const out = summarizeToolGroup([tool('Bash'), tool('Write'), tool('TodoWrite')]);
    expect(out).toBe('Ran a command, created a file, updated todos');
  });
});
