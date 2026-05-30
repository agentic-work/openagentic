/**
 * vertex streaming — Tier C contract.
 *
 * The vertex executor routes through the platform's OpenAI-shape
 * chat-completions shim with `provider:'vertex'`. After Tier C it
 * MUST stream those chunks through streamLLMCompletion so per-token
 * canonical events reach the engine.
 *
 * Return contract preserved: `{ content, model, usage, provider:'vertex' }`.
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

describe('vertex node streams per-token canonical events (Tier C)', () => {
  it('emits text_delta canonical events with provider:vertex on the wire', async () => {
    const streamBody = [
      `data: ${JSON.stringify({ id: 'cmpl-vx', model: 'vertex-routed-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Vertex ' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-vx', model: 'vertex-routed-model', choices: [{ index: 0, delta: { content: 'reply.' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-vx', model: 'vertex-routed-model', choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } })}\n\n`,
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
    expect(concatenated).toBe('Vertex reply.');

    expect(capturedBody?.provider).toBe('vertex');
    expect(capturedBody?.stream).toBe(true);

    const out = result.outputs.vx as { content: string; provider: string };
    expect(out.content).toBe('Vertex reply.');
    expect(out.provider).toBe('vertex');
  });
});
