/**
 * structured_output node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - Calls `${apiUrl}/api/v1/chat/completions` with
 *     `response_format: { type: 'json_object' }` plus a system prompt
 *     containing the schema.
 *   - Parses the model's content as JSON and returns
 *     `{ output, model, attempts, raw }` on success.
 *
 * Mocked via MSW. Real Ollama probe lives on the llm_completion test
 * (and is informational — the executor talks to the platform shim, not
 * to Ollama directly).
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';

describe('structured_output node — JSON contract enforcement', () => {
  it('parses JSON content from the model and returns it as `output`', async () => {
    const { handler } = mockChatCompletions({
      content: '{"name":"Alice","age":30,"active":true}',
      id: 'cmpl-structured',
      model: 'gpt-oss:20b',
      usage: { prompt_tokens: 25, completion_tokens: 12, total_tokens: 37 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'so',
            type: 'structured_output',
            data: {
              prompt: 'Return a user profile.',
              schema: JSON.stringify({
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'integer' },
                  active: { type: 'boolean' },
                },
                required: ['name', 'age', 'active'],
              }),
              maxRetries: 1,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'so' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.so as {
      output: { name: string; age: number; active: boolean };
      attempts: number;
      model: string;
      raw: string;
    };
    expect(out.output).toMatchObject({ name: 'Alice', age: 30, active: true });
    expect(out.attempts).toBe(1);
  });
});
