/**
 * structured_output streaming — Tier C contract.
 *
 * The structured_output executor MUST stream chat-completions through
 * streamLLMCompletion so per-token canonical events reach the engine's
 * frame stream. The aggregated text is then JSON-parsed and validated
 * against the declared schema — same shape the legacy executor returned
 * (`{ output, model, attempts, raw }`).
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

const SHIM_URL = 'http://openagentic-api:8000/api/v1/chat/completions';

interface CanonicalFrame {
  type: 'node_canonical';
  nodeId?: string;
  canonical?: {
    type: string;
    delta?: { type: string; text?: string };
    [k: string]: unknown;
  };
}

describe('structured_output node streams per-token canonical events (Tier C)', () => {
  it('streams JSON tokens, parses final aggregate, surfaces text_delta canonical events', async () => {
    // Split the JSON object across multiple streaming chunks so the
    // executor must reassemble before parsing.
    const streamBody = [
      `data: ${JSON.stringify({ id: 'cmpl-so', model: 'gpt-oss:20b', choices: [{ index: 0, delta: { role: 'assistant', content: '{"name":"Alice",' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-so', model: 'gpt-oss:20b', choices: [{ index: 0, delta: { content: '"age":30,' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-so', model: 'gpt-oss:20b', choices: [{ index: 0, delta: { content: '"active":true}' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-so', model: 'gpt-oss:20b', choices: [], usage: { prompt_tokens: 25, completion_tokens: 12, total_tokens: 37 } })}\n\n`,
      `data: [DONE]\n\n`,
    ].join('');

    harnessServer.use(
      http.post(SHIM_URL, () =>
        new HttpResponse(streamBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

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

    const canonicalFrames = result.frames.filter(
      (f): f is CanonicalFrame =>
        (f as { type?: string }).type === 'node_canonical',
    );
    const textDeltas = canonicalFrames.filter(
      (f) =>
        f.canonical?.type === 'content_block_delta' &&
        f.canonical?.delta?.type === 'text_delta',
    );
    expect(textDeltas.length).toBeGreaterThanOrEqual(3);

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
