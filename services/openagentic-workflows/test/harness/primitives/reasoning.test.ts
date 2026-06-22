/**
 * reasoning node — Phase E1 primitive contract.
 *
 * Public contract: posts to platform chat-completions with
 * `enableThinking:true` + `sliderPosition:100`. Returns
 * `{ content, thinking, model, usage, provider:'openagentic' }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockChatCompletions } from '../mocks/handlers/chatCompletions.js';

describe('reasoning node — chain-of-thought via Smart Router', () => {
  it('forces enableThinking + max slider, returns content + thinking blocks', async () => {
    const { handler, captured } = mockChatCompletions({
      content: 'Final answer: 42.',
      model: 'reasoning-routed-model',
      id: 'cmpl-rs-1',
      messageExtra: { thinking: 'Step 1 ... Step 2 ... therefore 42.' },
      usage: { prompt_tokens: 20, completion_tokens: 80, total_tokens: 100 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'rs',
            type: 'reasoning',
            data: {
              prompt: 'Walk me through {{input.question}} step by step.',
              thinkingBudget: 4000,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'rs' }],
      },
      input: { question: 'What is the meaning of life?' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.rs as { content: string; thinking: string; provider: string };
    expect(out.content).toBe('Final answer: 42.');
    expect(out.thinking).toContain('Step 1');
    expect(out.provider).toBe('openagentic');
    expect(captured.body?.enableThinking).toBe(true);
    expect(captured.body?.sliderPosition).toBe(100);
    expect(captured.body?.thinkingBudget).toBe(4000);
  });
});
