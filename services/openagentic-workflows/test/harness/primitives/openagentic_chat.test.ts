/**
 * openagentic_chat node — Phase E1 primitive contract.
 *
 * Public contract:
 *   - Posts an OpenAI-shaped chat-completion to `${apiUrl}/api/v1/chat/completions`
 *     with `model: 'auto'` (Smart Router) unless `modelOverride` is set.
 *   - Returns `{ content, model, usage, provider: 'openagentic' }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';

describe('openagentic_chat node — Smart Router chat', () => {
  it('round-trips a chat completion through the platform shim and tags provider:openagentic', async () => {
    const { handler, captured } = mockChatCompletions({
      content: 'Hello back.',
      model: 'router-routed-model',
      id: 'cmpl-aw-1',
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'chat',
            type: 'openagentic_chat',
            data: {
              prompt: 'Say hello to {{input.name}}.',
              temperature: 0.5,
              maxTokens: 64,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'chat' }],
      },
      input: { name: 'world' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.chat as {
      content: string;
      model: string;
      usage: unknown;
      provider: string;
    };
    expect(out.content).toBe('Hello back.');
    expect(out.provider).toBe('openagentic');
    expect(out.model).toBe('router-routed-model');
    // Smart Router default
    expect(captured.body?.model).toBe('auto');
    // Prompt was interpolated
    const msgs = captured.body?.messages as Array<{ content: string }> | undefined;
    expect(msgs?.[msgs.length - 1]?.content).toContain('world');
  });
});
