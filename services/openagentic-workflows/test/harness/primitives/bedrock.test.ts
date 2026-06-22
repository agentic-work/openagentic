/**
 * bedrock node — Phase E1 primitive contract.
 *
 * Public contract: posts an OpenAI-shaped chat completion to the platform
 * shim with `provider: 'bedrock'`. Returns `{ content, model, usage,
 * provider: 'bedrock' }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';

describe('bedrock node — AWS Bedrock passthrough', () => {
  it('routes through the shim with provider:bedrock and unwraps the response', async () => {
    const { handler, captured } = mockChatCompletions({
      content: 'Bedrock reply.',
      model: 'bedrock-routed-model',
      id: 'cmpl-br-1',
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'br',
            type: 'bedrock',
            data: {
              prompt: 'Summarize: {{input.text}}',
              maxTokens: 64,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'br' }],
      },
      input: { text: 'a quick brown fox' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.br as { content: string; provider: string };
    expect(out.content).toBe('Bedrock reply.');
    expect(out.provider).toBe('bedrock');
    expect(captured.body?.provider).toBe('bedrock');
    // streamLLMCompletion prepends an anti-CoT system directive at
    // index 0 (workflow-engine/src/llm/streamLLMCompletion.ts:
    // applyAntiCotDirective). The user's prompt lives on the 'user'
    // message, not msgs[0]. Find by role for forward-compat.
    const msgs = captured.body?.messages as Array<{ role: string; content: string }> | undefined;
    const userMsg = msgs?.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('quick brown fox');
  });
});
