/**
 * prompt_template — Flows harness test.
 *
 * Verifies the reusable prompt builder primitive through the full
 * WorkflowExecutionEngine path: trigger → prompt_template → assert output
 * shape. Covers both outputAs modes plus the unmapped-variable failure path
 * the gap-analysis P0 #1 design called out.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('prompt_template node — reusable prompt builder', () => {
  it('renders variables and emits {prompt, variables, outputAs} in prompt mode', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'p1',
            type: 'prompt_template',
            data: {
              template: 'Summarize {{text}} in {{style}}.',
              variables: {
                text: '{{trigger.body.content}}',
                style: '{{trigger.body.style}}',
              },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'p1' }],
      },
      input: { body: { content: 'The quick brown fox.', style: 'one sentence' } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.p1 as {
      prompt: string;
      variables: Record<string, string>;
      outputAs: string;
    };
    expect(out.outputAs).toBe('prompt');
    expect(out.prompt).toBe('Summarize The quick brown fox. in one sentence.');
    expect(out.variables.text).toBe('The quick brown fox.');
    expect(out.variables.style).toBe('one sentence');
  });

  it('splits role markers into a messages array in messages mode', async () => {
    const tpl = [
      '{{system}}',
      'You are a senior on-call engineer. Style: {{style}}.',
      '{{user}}',
      '{{question}}',
    ].join('\n');
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'p1',
            type: 'prompt_template',
            data: {
              template: tpl,
              outputAs: 'messages',
              variables: {
                style: 'concise, factual',
                question: '{{trigger.body.q}}',
              },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'p1' }],
      },
      input: { body: { q: 'Are the API pods healthy?' } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.p1 as {
      messages: Array<{ role: string; content: string }>;
      outputAs: string;
    };
    expect(out.outputAs).toBe('messages');
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe('system');
    expect(out.messages[0].content).toContain('concise, factual');
    expect(out.messages[1].role).toBe('user');
    expect(out.messages[1].content).toBe('Are the API pods healthy?');
  });

  it('fails with a clear error when template references an unmapped variable', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'p1',
            type: 'prompt_template',
            data: {
              template: 'Hi {{name}}, your code is {{code}}.',
              variables: { name: 'Alex' },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'p1' }],
      },
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/unmapped|prompt_template/i);
  });

  it('rejects empty template via schema-required compile gate or runtime guard', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'p1', type: 'prompt_template', data: { template: '', variables: {} } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'p1' }],
      },
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toMatch(/template|required/i);
  });

  it('resolves nested {{trigger.X}} inside a variable value', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'p1',
            type: 'prompt_template',
            data: {
              template: 'For tenant {{tenant}}: {{action}}',
              variables: {
                tenant: '{{trigger.body.tenantId}}',
                action: '{{trigger.body.task}}',
              },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'p1' }],
      },
      input: { body: { tenantId: 't-42', task: 'audit the cluster' } },
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.p1 as { prompt: string };
    expect(out.prompt).toBe('For tenant t-42: audit the cluster');
  });
});
