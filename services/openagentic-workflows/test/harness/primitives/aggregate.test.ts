/**
 * aggregate node — LLM-driven reduce + map.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse, passthrough } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

const SHIM_URL = 'http://openagentic-api:8000/api/v1/chat/completions';

interface AggregateOutput {
  mode: 'reduce' | 'map';
  output: string | string[];
  items_in: number;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

describe('aggregate node — mocked /v1/chat/completions', () => {
  it('reduce mode: single LLM call with the array serialized into {{items}}', async () => {
    let capturedPrompt = '';
    let callCount = 0;
    harnessServer.use(
      http.post(SHIM_URL, async ({ request }) => {
        callCount += 1;
        const body = (await request.json()) as { messages: Array<{ role: string; content: string }> };
        capturedPrompt = body.messages.map((m) => m.content).join('\n');
        return HttpResponse.json({
          id: `cmpl-agg-${callCount}`,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'P0 — 3 findings: api crash, cluster degraded, scrape gap.' },
              finish_reason: 'stop',
            },
          ],
          model: 'gpt-oss:20b',
          usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'agg',
            type: 'aggregate',
            data: {
              items: [
                'api in CrashLoopBackOff',
                'cluster healthy:false',
                '9 Prometheus targets down',
              ],
              mode: 'reduce',
              prompt: 'Summarize these incident findings into one P0/P1/P2 paragraph: {{items}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agg' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.agg as AggregateOutput;
    expect(out.mode).toBe('reduce');
    expect(out.items_in).toBe(3);
    expect(callCount).toBe(1);
    expect(typeof out.output).toBe('string');
    expect(out.output).toContain('P0');
    expect(out.usage.total_tokens).toBe(100);

    // Verify {{items}} got JSON-serialized into the prompt.
    expect(capturedPrompt).toContain('CrashLoopBackOff');
    expect(capturedPrompt).toContain('cluster healthy:false');
    expect(capturedPrompt).toContain('Prometheus targets down');
  });

  it('map mode: N LLM calls, one per item, returns string[]', async () => {
    let callCount = 0;
    const calls: string[] = [];
    harnessServer.use(
      http.post(SHIM_URL, async ({ request }) => {
        callCount += 1;
        const body = (await request.json()) as { messages: Array<{ role: string; content: string }> };
        const userContent = body.messages[body.messages.length - 1].content;
        calls.push(userContent);
        // Echo the item back as the LLM's "classification"
        const itemSnippet = userContent.split(':').pop()!.trim();
        return HttpResponse.json({
          id: `cmpl-map-${callCount}`,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: `classified-${itemSnippet}` },
              finish_reason: 'stop',
            },
          ],
          model: 'gpt-oss:20b',
          usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'agg',
            type: 'aggregate',
            data: {
              items: ['alpha', 'beta', 'gamma'],
              mode: 'map',
              prompt: 'Classify this item: {{item}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agg' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.agg as AggregateOutput;
    expect(out.mode).toBe('map');
    expect(out.items_in).toBe(3);
    expect(callCount).toBe(3);
    expect(Array.isArray(out.output)).toBe(true);
    expect((out.output as string[])).toEqual([
      'classified-alpha',
      'classified-beta',
      'classified-gamma',
    ]);
    // Token usage accumulates across the N calls
    expect(out.usage.total_tokens).toBe(38 * 3);
  });

  it('empty array short-circuits with no LLM call', async () => {
    let callCount = 0;
    harnessServer.use(
      http.post(SHIM_URL, () => {
        callCount += 1;
        return HttpResponse.json({ choices: [{ index: 0, message: { content: '' } }] });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'agg',
            type: 'aggregate',
            data: { items: [], mode: 'reduce', prompt: 'Should not be called' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agg' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.agg as AggregateOutput;
    expect(out.items_in).toBe(0);
    expect(out.output).toBe('');
    expect(callCount).toBe(0);
  });

  it('coerces a JSON-string items field into an array', async () => {
    harnessServer.use(
      http.post(SHIM_URL, () =>
        HttpResponse.json({
          choices: [{ index: 0, message: { content: 'summarized' }, finish_reason: 'stop' }],
          model: 'gpt-oss:20b',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'agg',
            type: 'aggregate',
            data: {
              // String passed through — executor JSON.parses it
              items: '["one","two"]',
              mode: 'reduce',
              prompt: 'Summarize {{items}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agg' }],
      },
      input: {},
    });
    expect(result.status).toBe('completed');
    expect((result.outputs.agg as AggregateOutput).items_in).toBe(2);
  });

  it('fails-CLOSED on non-array items', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'agg',
            type: 'aggregate',
            data: {
              items: { not: 'an array' },
              mode: 'reduce',
              prompt: 'Summarize {{items}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agg' }],
      },
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message ?? '').toMatch(/array of items/i);
  });
});

describe('aggregate — live hal:11434/gpt-oss:20b', () => {
  it('reduce mode produces a real summary from the live model', async () => {
    harnessServer.use(http.get('http://hal:11434/api/tags', () => passthrough()));
    let halReachable = false;
    try {
      const r = await fetch('http://hal:11434/api/tags', { signal: AbortSignal.timeout(2_000) });
      halReachable = r.ok;
    } catch {
      halReachable = false;
    }
    if (!halReachable) {
      // eslint-disable-next-line no-console
      console.warn(
        '[aggregate.live] hal:11434 unreachable — skipping live reduce assertion. ' +
          'Re-run from a host with cluster DNS to exercise the registered model.',
      );
      return;
    }

    harnessServer.use(
      http.post(SHIM_URL, async ({ request }) => {
        const body = (await request.json()) as {
          messages: Array<{ role: string; content: string }>;
        };
        const ollamaRes = await fetch('http://hal:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-oss:20b',
            messages: body.messages,
            stream: false,
            options: { num_predict: 256, temperature: 0.2 },
          }),
        });
        if (!ollamaRes.ok) {
          return new HttpResponse(`hal upstream ${ollamaRes.status}`, { status: 502 });
        }
        const ollamaJson = (await ollamaRes.json()) as {
          message?: { content?: string };
          model?: string;
        };
        return HttpResponse.json({
          id: 'cmpl-live-agg',
          object: 'chat.completion',
          model: ollamaJson.model || 'gpt-oss:20b',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: ollamaJson.message?.content ?? '' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'agg',
            type: 'aggregate',
            data: {
              items: [
                'openagentic-api in CrashLoopBackOff',
                '9 prometheus scrape targets down',
                'no errors in loki',
              ],
              mode: 'reduce',
              prompt:
                'Summarize these OpenAgentic platform observations into one short ' +
                '#devops digest paragraph (no bullet list, no prose preamble):\n{{items}}',
              temperature: 0.1,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agg' }],
      },
      input: {},
      timeout: 60_000,
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.agg as AggregateOutput;
    expect(out.items_in).toBe(3);
    expect(typeof out.output).toBe('string');
    // The real model should produce non-trivial text.
    expect((out.output as string).length).toBeGreaterThan(40);
    expect(out.model).toMatch(/gpt-oss/i);
  }, 90_000);
});
