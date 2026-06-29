import { describe, it, expect } from 'vitest';
import { normalizeToolName } from '../normalizeToolName.js';

describe('normalizeToolName', () => {
  describe('passthrough — clean names stay unchanged', () => {
    it('returns Bash unchanged', () => {
      expect(normalizeToolName('Bash')).toBe('Bash');
    });
    it('returns multi-word camelCase tool names unchanged', () => {
      expect(normalizeToolName('WebFetch')).toBe('WebFetch');
      expect(normalizeToolName('WebSearch')).toBe('WebSearch');
      expect(normalizeToolName('NotebookEdit')).toBe('NotebookEdit');
    });
    it('handles empty / undefined input', () => {
      expect(normalizeToolName(undefined)).toBe('');
      expect(normalizeToolName('')).toBe('');
    });
  });

  describe('Harmony-token stripping (existing behavior)', () => {
    it('strips <|channel|>', () => {
      expect(normalizeToolName('Bash<|channel|>')).toBe('Bash');
    });
    it('strips trailing <|end|> and <|call|>', () => {
      expect(normalizeToolName('Bash<|end|>')).toBe('Bash');
      expect(normalizeToolName('WebFetch<|call|>')).toBe('WebFetch');
    });
    it('strips multiple harmony tokens', () => {
      expect(normalizeToolName('Bash<|channel|><|end|>')).toBe('Bash');
    });
  });

  describe('non-ASCII tokenizer corruption (#423)', () => {
    it('strips trailing Malayalam Unicode garbage from WebSearch', () => {
      // Real case from gpt-oss:20b live: `WebSearchുവര`
      expect(normalizeToolName('WebSearchുവര')).toBe('WebSearch');
    });
    it('strips trailing CJK unified ideographs', () => {
      expect(normalizeToolName('Bash世界')).toBe('Bash');
    });
    it('strips trailing emoji/symbols', () => {
      expect(normalizeToolName('Read🔥')).toBe('Read');
    });
    it('keeps the ASCII core when surrounded by garbage', () => {
      expect(normalizeToolName('  WebFetchുവര  ')).toBe('WebFetch');
    });
  });

  describe('#845 — trailing non-identifier characters stripped (2026-05-14)', () => {
    it('strips trailing ? from azure_list_vms (live capture: gpt-oss:20b)', () => {
      expect(normalizeToolName('azure_list_vms?')).toBe('azure_list_vms');
    });
    it('strips trailing ! from compose_visual', () => {
      expect(normalizeToolName('compose_visual!')).toBe('compose_visual');
    });
    it('strips trailing period from tool name', () => {
      expect(normalizeToolName('tool_search.')).toBe('tool_search');
    });
    it('strips trailing colon from tool name', () => {
      expect(normalizeToolName('Bash:')).toBe('Bash');
    });
    it('strips multiple trailing punctuation chars', () => {
      expect(normalizeToolName('Bash?!')).toBe('Bash');
    });
    it('preserves internal underscores (not trailing punctuation)', () => {
      expect(normalizeToolName('azure_list_resource_groups')).toBe('azure_list_resource_groups');
    });
    it('preserves trailing digits (digits are identifier-valid)', () => {
      expect(normalizeToolName('claude_v2')).toBe('claude_v2');
    });
    it('fuzzy-matches azure_list_vms? against known azure_list_vms', () => {
      const known = ['azure_list_subscriptions', 'azure_list_vms', 'azure_list_resource_groups'];
      expect(normalizeToolName('azure_list_vms?', known)).toBe('azure_list_vms');
    });
  });

  describe('fuzzy match against known tools', () => {
    const known = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'];

    it('exact match returns the name', () => {
      expect(normalizeToolName('Bash', known)).toBe('Bash');
    });
    it('case-insensitive match snaps to canonical case', () => {
      expect(normalizeToolName('bash', known)).toBe('Bash');
      expect(normalizeToolName('webfetch', known)).toBe('WebFetch');
    });
    it('prefix match snaps to the longer canonical name', () => {
      // gpt-oss sometimes truncates: `WebFetc` → `WebFetch`
      expect(normalizeToolName('WebFetc', known)).toBe('WebFetch');
    });
    it('non-ASCII corruption then fuzzy match resolves to canonical', () => {
      expect(normalizeToolName('WebSearchുവര', known)).toBe('WebSearch');
    });
    it('does NOT fuzzy-match completely unrelated names', () => {
      // gpt-oss hallucinates `Browse` (not in tool list). We must NOT silently
      // map it to `WebFetch` — the agent loop's "no such tool" error is the
      // correct user-visible signal that the model went off-script.
      expect(normalizeToolName('Browse', known)).toBe('Browse');
    });
    it('no-known-tools list falls back to the cleaned ASCII core', () => {
      expect(normalizeToolName('WebSearchുവര')).toBe('WebSearch');
      expect(normalizeToolName('Browse')).toBe('Browse');
    });
  });
});
