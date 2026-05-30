/**
 * bedrock streaming — Tier C contract.
 *
 * The bedrock executor routes through the platform's OpenAI-shape
 * chat-completions shim with `provider:'bedrock'`. After Tier C it
 * MUST stream those chunks through streamLLMCompletion so per-token
 * canonical events reach the engine.
 *
 * Return contract preserved: `{ content, model, usage, provider:'bedrock' }`.
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

describe('bedrock node streams per-token canonical events (Tier C)', () => {
  it('emits text_delta canonical events with provider:bedrock on the wire', async () => {
    const streamBody = [
      `data: ${JSON.stringify({ id: 'cmpl-br', model: 'bedrock-routed-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Bedrock ' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-br', model: 'bedrock-routed-model', choices: [{ index: 0, delta: { content: 'reply.' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-br', model: 'bedrock-routed-model', choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}\n\n`,
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
    expect(concatenated).toBe('Bedrock reply.');

    expect(capturedBody?.provider).toBe('bedrock');
    expect(capturedBody?.stream).toBe(true);

    const out = result.outputs.br as { content: string; provider: string };
    expect(out.content).toBe('Bedrock reply.');
    expect(out.provider).toBe('bedrock');
  });
});
