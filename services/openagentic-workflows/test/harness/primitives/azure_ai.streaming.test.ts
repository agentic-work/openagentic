/**
 * azure_ai streaming — Tier C contract.
 *
 * The azure_ai executor routes through the platform's OpenAI-shape
 * chat-completions shim with `provider:'azure_openai'`. After Tier C
 * it MUST stream those chunks through streamLLMCompletion so per-token
 * canonical events reach the engine.
 *
 * Return contract preserved: `{ content, model, usage, provider:'azure_openai' }`.
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

describe('azure_ai node streams per-token canonical events (Tier C)', () => {
  it('emits text_delta canonical events with provider:azure_openai on the wire', async () => {
    const streamBody = [
      `data: ${JSON.stringify({ id: 'cmpl-az', model: 'aif-deployment-x', choices: [{ index: 0, delta: { role: 'assistant', content: 'Azure ' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-az', model: 'aif-deployment-x', choices: [{ index: 0, delta: { content: 'reply.' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-az', model: 'aif-deployment-x', choices: [], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } })}\n\n`,
      `data: [DONE]\n\n`,
    ].join('');

    let capturedBody: Record<string, unknown> | undefined;
    harnessServer.use(
      http.post(SHIM_URL, async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(streamBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

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

    const canonicalFrames = result.frames.filter(
      (f): f is CanonicalFrame =>
        (f as { type?: string }).type === 'node_canonical',
    );
    const textDeltas = canonicalFrames.filter(
      (f) =>
        f.canonical?.type === 'content_block_delta' &&
        f.canonical?.delta?.type === 'text_delta',
    );
    expect(textDeltas.length).toBeGreaterThanOrEqual(2);
    const concatenated = textDeltas
      .map((f) => f.canonical?.delta?.text ?? '')
      .join('');
    expect(concatenated).toBe('Azure reply.');

    expect(capturedBody?.provider).toBe('azure_openai');
    expect(capturedBody?.stream).toBe(true);

    const out = result.outputs.az as { content: string; provider: string };
    expect(out.content).toBe('Azure reply.');
    expect(out.provider).toBe('azure_openai');
  });
});
