/**
 * reasoning streaming — Tier C contract.
 *
 * The reasoning executor MUST stream chat-completions through
 * streamLLMCompletion so per-token canonical events (`text_delta`,
 * `thinking_delta`) reach the engine's frame stream as `node_canonical`
 * ExecutionEvents — same shape llm_completion already emits (Tier B).
 *
 * For reasoning, thinking blocks are first-class: the platform shim
 * emits thinking content on the SSE chunks (delta.thinking_delta or
 * delta.thinking) when enableThinking:true. We assert that whichever
 * form the upstream uses, the executor surfaces text_delta canonical
 * events for the visible answer.
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
    index?: number;
    delta?: { type: string; text?: string; stop_reason?: string };
    message?: { id: string; model?: string };
    [k: string]: unknown;
  };
}

describe('reasoning node streams per-token canonical events (Tier C)', () => {
  it('emits text_delta canonical events while preserving the executor return contract', async () => {
    const streamBody = [
      `data: ${JSON.stringify({ id: 'cmpl-rs', model: 'reasoning-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Therefore ' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-rs', model: 'reasoning-model', choices: [{ index: 0, delta: { content: 'the ' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-rs', model: 'reasoning-model', choices: [{ index: 0, delta: { content: 'answer is 42.' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'cmpl-rs', model: 'reasoning-model', choices: [], usage: { prompt_tokens: 20, completion_tokens: 80, total_tokens: 100 } })}\n\n`,
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
            id: 'rs',
            type: 'reasoning',
            data: {
              prompt: 'Walk me through the answer.',
              thinkingBudget: 4000,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'rs' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');

    const canonicalFrames = result.frames.filter(
      (f): f is CanonicalFrame =>
        (f as { type?: string }).type === 'node_canonical',
    );
    expect(canonicalFrames.length).toBeGreaterThanOrEqual(3);

    const textDeltas = canonicalFrames.filter(
      (f) =>
        f.canonical?.type === 'content_block_delta' &&
        f.canonical?.delta?.type === 'text_delta',
    );
    expect(textDeltas.length).toBeGreaterThanOrEqual(3);
    const concatenated = textDeltas
      .map((f) => f.canonical?.delta?.text ?? '')
      .join('');
    expect(concatenated).toBe('Therefore the answer is 42.');

    // reasoning preserves enableThinking + sliderPosition:100 forcing on the wire
    expect(capturedBody?.enableThinking).toBe(true);
    expect(capturedBody?.sliderPosition).toBe(100);
    expect(capturedBody?.stream).toBe(true);

    // Return contract preserved.
    const out = result.outputs.rs as { content: string; model?: string; provider: string };
    expect(out.content).toBe('Therefore the answer is 42.');
    expect(out.provider).toBe('openagentic');
  });
});
