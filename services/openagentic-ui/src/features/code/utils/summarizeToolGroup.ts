/**
 * Roll up a sequence of `UiToolUseBlock` records into a single human
 * phrase mirroring how claude.ai/code labels collapsed tool sequences:
 *
 *   `Created 4 files, ran a command, updated todos`
 *
 * Phrasing rules (from observed claude-code behavior):
 *   - Each tool name maps to a (verb, noun) pair plus formatting flags.
 *   - Same-key phrases merge across the group preserving the FIRST
 *     occurrence's position. e.g. [Bash, Write, Bash] → "Ran 2 commands,
 *     created a file" (Bash phrase keeps its position and absorbs the
 *     trailing Bash count).
 *   - Only the first phrase is capitalized; the rest are lowercase.
 *   - Count = 1 with `useArticle` produces "a file" / "an agent"; the
 *     article picks "an" before a vowel.
 *   - Some nouns never carry a number (`updated todos`, `searched code`,
 *     `searched the web`) — phrased as `<verb> <noun>` regardless of count.
 *
 * Used by `Part.tsx`'s `ParallelGroupPart` to build the rolled-up button
 * label in the chat transcript.
 */

import type { UiToolUseBlock } from '../types/uiState';

interface VerbInfo {
  verb: string; // Past-tense verb, capitalized (we lowercase later for non-first phrases).
  noun: string; // Singular form by default; pluralize() handles count > 1.
  /**
   * Render `<verb> a/an <noun>` when count === 1.
   * Without this flag, count === 1 still renders as `<verb> 1 <noun>`.
   */
  useArticle?: boolean;
  /**
   * Skip the count entirely. Used for collective nouns like "todos"
   * where claude-code says "updated todos" regardless of how many
   * TodoWrite calls were made consecutively.
   */
  noNumber?: boolean;
}

function verbForTool(name: string): VerbInfo {
  switch (name) {
    case 'Write':
    case 'FileWrite':
      return { verb: 'Created', noun: 'file', useArticle: true };
    case 'Edit':
    case 'FileEdit':
    case 'MultiEdit':
      return { verb: 'Edited', noun: 'file', useArticle: true };
    case 'Read':
    case 'FileRead':
      return { verb: 'Read', noun: 'file', useArticle: true };
    case 'Bash':
      return { verb: 'Ran', noun: 'command', useArticle: true };
    case 'Grep':
      return { verb: 'Searched', noun: 'code', noNumber: true };
    case 'Glob':
      return { verb: 'Listed', noun: 'file', useArticle: true };
    case 'Task':
    case 'Agent':
      return { verb: 'Ran', noun: 'agent', useArticle: true };
    case 'TodoWrite':
    case 'Todo':
      return { verb: 'Updated', noun: 'todos', noNumber: true };
    case 'WebSearch':
      return { verb: 'Searched', noun: 'the web', noNumber: true };
    case 'WebFetch':
      return { verb: 'Fetched', noun: 'URL', useArticle: true };
    case 'NotebookEdit':
      return { verb: 'Edited', noun: 'notebook', useArticle: true };
    default:
      return { verb: 'Used', noun: 'tool', useArticle: true };
  }
}

function pluralize(noun: string, count: number): string {
  if (count === 1) return noun;
  if (noun.endsWith('s')) return noun;
  return `${noun}s`;
}

function articleFor(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a';
}

interface PhraseGroup {
  info: VerbInfo;
  count: number;
  key: string;
}

export function summarizeToolGroup(tools: UiToolUseBlock[]): string {
  if (tools.length === 0) return '';

  // Group by (verb, noun) preserving first-occurrence order.
  const groups: PhraseGroup[] = [];
  for (const t of tools) {
    const info = verbForTool(t.name);
    const key = `${info.verb}|${info.noun}`;
    const existing = groups.find((g) => g.key === key);
    if (existing) {
      existing.count++;
    } else {
      groups.push({ info, count: 1, key });
    }
  }

  // Render each group as a phrase; first capitalized, rest lowercased.
  const phrases = groups.map((g, i) => {
    const verb = i === 0 ? g.info.verb : g.info.verb.toLowerCase();
    if (g.info.noNumber) {
      return `${verb} ${g.info.noun}`;
    }
    if (g.count === 1 && g.info.useArticle) {
      return `${verb} ${articleFor(g.info.noun)} ${g.info.noun}`;
    }
    return `${verb} ${g.count} ${pluralize(g.info.noun, g.count)}`;
  });

  return phrases.join(', ');
}
