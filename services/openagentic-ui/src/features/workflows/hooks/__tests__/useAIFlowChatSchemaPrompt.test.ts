/**
 * useAIFlowChat schema-prompt injection — TDD tests (A6)
 * Tests that the AI Flow Builder system prompt uses aiPromptFragment
 * from the registry, concatenated with legacy node list for unmigrated types.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependent modules before any imports
vi.mock('../useNodeSchemas', () => ({
  useNodeSchemas: vi.fn(),
}));

vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
  }),
}));

vi.mock('@/app/providers/MCPContext', () => ({
  useMCP: () => ({ mcps: [] }),
}));

describe('buildSystemPrompt with schema fragment injection', () => {
  test('schema fragment is used in the system prompt when aiPromptFragment is non-empty', async () => {
    // Extract the buildSystemPrompt function indirectly by inspecting the
    // prompt sent to the fetch call

    const schemaFragment = '### Action\n- **http_request** — Make HTTP calls.';
    const { buildSystemPromptWithFragment } = await import('../schemaPromptBuilder');

    const prompt = buildSystemPromptWithFragment(schemaFragment, [], []);
    expect(prompt).toContain('http_request');
    expect(prompt).toContain(schemaFragment);
  });

  test('legacy fragment is appended for node types not in schema', async () => {
    const schemaFragment = '### Action\n- **http_request** — Make HTTP calls.';
    const legacyFragment = '- **trigger** — Start workflow.';

    const { buildSystemPromptWithFragment } = await import('../schemaPromptBuilder');

    const prompt = buildSystemPromptWithFragment(schemaFragment, [], [], legacyFragment);
    expect(prompt).toContain('http_request');
    expect(prompt).toContain('trigger');
  });

  test('empty schema fragment falls through to legacy prompt only', async () => {
    const { buildSystemPromptWithFragment } = await import('../schemaPromptBuilder');

    const prompt = buildSystemPromptWithFragment('', [], []);
    // Should still produce a valid prompt (base prompt present)
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('OpenAgentic');
  });
});
