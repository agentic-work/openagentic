/**
 * azure_ai node — Phase E1 primitive contract.
 *
 * Public contract: posts an OpenAI-shaped chat completion to the platform
 * shim with `provider: 'azure_openai'`. Returns `{ content, model, usage,
 * provider: 'azure_openai' }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';

describe('azure_ai node — Azure OpenAI passthrough', () => {
  it('routes through the shim with provider:azure_openai and returns the unwrapped envelope', async () => {
    const { handler, captured } = mockChatCompletions({
      content: 'Azure reply.',
      model: 'aif-deployment-x',
      id: 'cmpl-az-1',
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'az',
            type: 'azure_ai',
            data: {
              deploymentName: 'aif-deployment-x',
              prompt: 'Ask Azure.',
              temperature: 0.2,
              maxTokens: 32,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'az' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.az as { content: string; provider: string; model: string };
    expect(out.content).toBe('Azure reply.');
    expect(out.provider).toBe('azure_openai');
    expect(captured.body?.provider).toBe('azure_openai');
    expect(captured.body?.model).toBe('aif-deployment-x');
  });
});
