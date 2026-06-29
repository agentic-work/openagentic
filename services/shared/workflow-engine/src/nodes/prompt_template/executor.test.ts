/**
 * prompt_template — executor unit tests (RED first per TDD).
 *
 * Covers:
 *  - {{var}} substitution into the template body
 *  - outputAs: 'prompt' (default) vs 'messages' (system/user/assistant blocks)
 *  - Unmapped variable surfaces a clear error (so authors aren't silent-failing)
 *  - Empty template is rejected
 *  - Nested {{input.X}} in a variable value resolves through the engine
 *    interpolateTemplate path before substitution into the template body.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-prompt-1',
    apiUrl: 'http://api',
    // Resolve {{input.X}} against the supplied input record so tests can
    // exercise the nested-variable path the same way the engine does.
    interpolateTemplate: (t: string, input: unknown) => {
      const root = input as Record<string, unknown> | null;
      return String(t).replace(/\{\{\s*input\.([\w.]+)\s*\}\}/g, (_, path) => {
        const segments = String(path).split('.');
        let cursor: unknown = root;
        for (const seg of segments) {
          if (cursor && typeof cursor === 'object' && seg in (cursor as Record<string, unknown>)) {
            cursor = (cursor as Record<string, unknown>)[seg];
          } else {
            return '';
          }
        }
        return typeof cursor === 'string' ? cursor : JSON.stringify(cursor ?? '');
      });
    },
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_prompt',
  type: 'prompt_template',
  data,
});

describe('prompt_template/executor', () => {
  it('renders {{var}} placeholders into a single prompt by default', async () => {
    const out = await execute(
      mk({
        template: 'Summarize the following text in {{style}}:\n\n{{text}}',
        variables: { style: 'two bullet points', text: 'The quick brown fox.' },
      }),
      {},
      makeCtx(),
    );
    const o = out as { prompt: string; variables: Record<string, string>; outputAs: string };
    expect(o.outputAs).toBe('prompt');
    expect(o.prompt).toBe(
      'Summarize the following text in two bullet points:\n\nThe quick brown fox.',
    );
    expect(o.variables.style).toBe('two bullet points');
  });

  it('outputAs: messages parses {{system}} / {{user}} / {{assistant}} blocks', async () => {
    const tpl = [
      '{{system}}',
      'You are a helpful assistant. Style: {{style}}.',
      '{{user}}',
      '{{text}}',
    ].join('\n');
    const out = await execute(
      mk({
        template: tpl,
        outputAs: 'messages',
        variables: { style: 'concise', text: 'Hello there.' },
      }),
      {},
      makeCtx(),
    );
    const o = out as {
      messages: Array<{ role: string; content: string }>;
      outputAs: string;
    };
    expect(o.outputAs).toBe('messages');
    expect(o.messages).toHaveLength(2);
    expect(o.messages[0].role).toBe('system');
    expect(o.messages[0].content).toContain('Style: concise');
    expect(o.messages[1].role).toBe('user');
    expect(o.messages[1].content).toBe('Hello there.');
  });

  it('throws a clear error for unmapped template variables', async () => {
    await expect(
      execute(
        mk({ template: 'Hello {{name}}, your code is {{code}}.', variables: { name: 'X' } }),
        {},
        makeCtx(),
      ),
    ).rejects.toThrow(/unmapped|missing|code/i);
  });

  it('rejects empty template', async () => {
    await expect(
      execute(mk({ template: '', variables: {} }), {}, makeCtx()),
    ).rejects.toThrow(/template/i);
  });

  it('resolves {{input.X}} inside variable values via interpolateTemplate', async () => {
    const out = await execute(
      mk({
        template: 'Hi {{name}} — your role is {{role}}.',
        variables: { name: '{{input.user}}', role: '{{input.role}}' },
      }),
      { user: 'Alex', role: 'admin' },
      makeCtx(),
    );
    const o = out as { prompt: string };
    expect(o.prompt).toBe('Hi Alex — your role is admin.');
  });

  it('messages mode preserves variable order; assistant blocks supported', async () => {
    const tpl = '{{system}}\nYou are helpful.\n{{user}}\nHi\n{{assistant}}\nHello!\n{{user}}\nMore?';
    const out = await execute(
      mk({ template: tpl, outputAs: 'messages', variables: {} }),
      {},
      makeCtx(),
    );
    const o = out as { messages: Array<{ role: string; content: string }> };
    expect(o.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(o.messages[2].content).toBe('Hello!');
  });
});
