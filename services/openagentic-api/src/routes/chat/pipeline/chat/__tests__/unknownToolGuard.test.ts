/**
 * unknownToolGuard — unit tests (#850, 2026-05-14).
 *
 * Live failure mode: gpt-oss:20b emitted `toolName: "list"` for a
 * `tool_search`-shaped tool_call. The bare name `list` is not in the
 * offered catalog, but PermissionService default-fall-through to `ask`
 * popped HITL on a hallucinated tool.
 *
 * Rule: catch unknown-name BEFORE the permission gate; return synthetic
 * tool_result error so the model can self-correct.
 */

import { describe, it, expect } from 'vitest';
import {
  findUnknownToolCallError,
  buildOfferedToolNames,
} from '../unknownToolGuard.js';

describe('findUnknownToolCallError', () => {
  describe('returns null (real tool call, dispatch proceeds) when', () => {
    it('name is in the offered catalog (exact match)', () => {
      const offered = new Set(['tool_search', 'agent_search', 'Task']);
      expect(findUnknownToolCallError('tool_search', offered)).toBeNull();
      expect(findUnknownToolCallError('agent_search', offered)).toBeNull();
      expect(findUnknownToolCallError('Task', offered)).toBeNull();
    });

    it('catalog is undefined (legacy / test path — fail-open)', () => {
      expect(findUnknownToolCallError('tool_search', undefined)).toBeNull();
      expect(findUnknownToolCallError('whatever', undefined)).toBeNull();
    });

    it('catalog is empty (no tools were offered — fail-open)', () => {
      expect(findUnknownToolCallError('list', new Set())).toBeNull();
      expect(findUnknownToolCallError('list', [])).toBeNull();
    });

    it('catalog is an array containing the name', () => {
      expect(findUnknownToolCallError('Bash', ['Bash', 'Read', 'Edit'])).toBeNull();
    });

    it('toolName is empty', () => {
      expect(findUnknownToolCallError('', new Set(['Bash']))).toBeNull();
    });
  });

  describe('returns an error (model hallucinated a name) when', () => {
    it('name is NOT in the offered catalog — the live #850 case', () => {
      // gpt-oss:20b literally emitted `list` for a tool_search-shape call.
      const offered = new Set([
        'tool_search',
        'agent_search',
        'compose_visual',
        'Task',
      ]);
      const err = findUnknownToolCallError('list', offered);
      expect(err).not.toBeNull();
      expect(err).toContain("no such tool 'list'");
      expect(err).toContain('tool_search');
      expect(err).toContain('Task');
    });

    it('name is case-mismatched (catalog is exact-match only — case matters on the wire)', () => {
      // The model emitting `bash` against `Bash` is also unknown; we
      // surface that to the model so it can self-correct rather than
      // silently auto-correcting (which would hide model regressions).
      const offered = new Set(['Bash']);
      expect(findUnknownToolCallError('bash', offered)).not.toBeNull();
    });

    it('caps the previewed names at 8 with an overflow hint', () => {
      const offered = new Set(
        Array.from({ length: 25 }, (_, i) => `tool_${i}`),
      );
      const err = findUnknownToolCallError('hallucinated', offered);
      expect(err).not.toBeNull();
      // Must NOT list all 25 names — that defeats the purpose
      const matches = err!.match(/tool_\d+/g) ?? [];
      expect(matches.length).toBe(8);
      expect(err).toMatch(/\+17 more/);
    });

    it('emits a recovery-shaped error string the model can act on', () => {
      const offered = new Set(['azure_list_subscriptions']);
      const err = findUnknownToolCallError('azure_list_subs', offered);
      // The shape must read as "no such tool 'X'. available: [...]"
      // so the model on the next turn can pick a real name.
      expect(err).toMatch(/^no such tool/);
      expect(err).toMatch(/available tools:/);
    });
  });
});

describe('buildOfferedToolNames', () => {
  it('extracts names from OpenAI-shape tool definitions', () => {
    const tools = [
      { type: 'function', function: { name: 'tool_search', description: '' } },
      { type: 'function', function: { name: 'Task', description: '' } },
      { type: 'function', function: { name: 'compose_visual', description: '' } },
    ];
    const set = buildOfferedToolNames(tools);
    expect(set.has('tool_search')).toBe(true);
    expect(set.has('Task')).toBe(true);
    expect(set.has('compose_visual')).toBe(true);
    expect(set.size).toBe(3);
  });

  it('skips entries with missing or non-string names', () => {
    const tools = [
      { type: 'function', function: { name: 'real_tool' } },
      { type: 'function', function: {} }, // no name
      { type: 'function', function: { name: 42 } }, // non-string
      null, // null entry
      { function: { name: 'no_type_field_is_fine' } }, // missing type but has name
    ];
    const set = buildOfferedToolNames(tools);
    expect(set.has('real_tool')).toBe(true);
    expect(set.has('no_type_field_is_fine')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('handles empty array', () => {
    expect(buildOfferedToolNames([]).size).toBe(0);
  });
});
