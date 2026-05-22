/**
 * openagentic_chat streaming — Tier C contract.
 *
 * Same pattern as llm_completion (Tier B): stream the chat-completions
 * response through streamLLMCompletion so per-token canonical events
 * surface on the engine's frame stream as `node_canonical` ExecutionEvents.
 *
 * Return contract preserved: `{ content, model, usage, provider: 'openagentic' }`.
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

describe('openagentic_chat node streams per-token canonical events (Tier C)', () => {
  it('emits text_delta canonical events while preserving the return contract', async () => {
    const streamBody = [
      `data: ${JSON.stringify({ id: 'cmpl-aw', model: 'router-routed-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hi ' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-aw', model: 'router-routed-model', choices: [{ index: 0, delta: { content: 'world' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-aw', model: 'router-routed-model', choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\n`,
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
    expect(concatenated).toBe('Hi world');

    expect(capturedBody?.stream).toBe(true);

    const out = result.outputs.chat as {
      content: string;
      provider: string;
      model?: string;
    };
    expect(out.content).toBe('Hi world');
    expect(out.provider).toBe('openagentic');
  });
});
