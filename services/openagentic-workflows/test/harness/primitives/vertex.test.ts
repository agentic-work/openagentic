/**
 * vertex node — Phase E1 primitive contract.
 *
 * Public contract: posts an OpenAI-shaped chat completion to the platform
 * shim with `provider: 'vertex'`. Returns `{ content, model, usage,
 * provider: 'vertex' }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';

describe('vertex node — Google Vertex passthrough', () => {
  it('routes through the shim with provider:vertex and returns the unwrapped envelope', async () => {
    const { handler, captured } = mockChatCompletions({
      content: 'Vertex reply.',
      model: 'vertex-routed-model',
      id: 'cmpl-vx-1',
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'vx',
            type: 'vertex',
            data: {
              prompt: 'Ping vertex.',
              maxTokens: 32,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'vx' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.vx as { content: string; provider: string };
    expect(out.content).toBe('Vertex reply.');
    expect(out.provider).toBe('vertex');
    expect(captured.body?.provider).toBe('vertex');
  });
});
