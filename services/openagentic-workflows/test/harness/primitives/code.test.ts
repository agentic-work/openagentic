/**
 * code node — Phase E1 primitive contract.
 *
 * Public contract: runs JS in the engine's isolated-vm sandbox via
 * `ctx.runIsolatedCode`. Returns the sandbox return value verbatim.
 *
 * Inputs:
 *   - code: string (required)            — the snippet to run
 *   - language: 'javascript' (default)   — only JS is supported in-process
 *   - timeoutMs: number (default 5000)
 *
 * The snippet reads `input` directly inside the sandbox; templating is
 * intentionally NOT applied to `code`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('code node — sandboxed javascript', () => {
  it('runs the snippet against input and returns the value', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'js',
            type: 'code',
            data: {
              language: 'javascript',
              code: 'return { sum: input.a + input.b };',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'js' }],
      },
      input: { a: 3, b: 4 },
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.js).toMatchObject({ sum: 7 });
  });
});
