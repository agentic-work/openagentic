/**
 * mockFetchSSE — shared test util for streaming-executor unit tests.
 *
 * Tier C: the 6 Group-1 AI executors (llm_completion, openagentic_chat,
 * azure_ai, bedrock, vertex, reasoning, structured_output) all stream
 * via streamLLMCompletion → fetch(). Their unit tests need to mock
 * `globalThis.fetch` with an OpenAI-shape SSE response.
 *
 * This helper centralizes that mock so executor.test.ts files stay
 * compact. The capture object lets the test assert on the wire body /
 * headers / signal after each call.
 */

import { vi } from 'vitest';

export interface FetchCapture {
  url?: string;
  init?: RequestInit;
}

export interface MockFetchSSEOptions {
  content: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  finishReason?: string;
  /**
   * Optional chain-of-thought text — emitted as one `delta.reasoning_content`
   * chunk BEFORE the visible `content` chunk so the canonical normalizer
   * yields `thinking_delta` events. The reasoning executor aggregates
   * these into `result.thinking`.
   */
  thinking?: string;
}

/**
 * Install a one-shot fetch mock that returns an OpenAI-shape SSE stream
 * matching the request through streamLLMCompletion. Captures the call
 * url + init so the test can assert on the request body / headers /
 * AbortSignal.
 */
export function mockFetchSSE(
  capture: FetchCapture,
  opts: MockFetchSSEOptions,
): void {
  const model = opts.model ?? 'router-pick';
  const finishReason = opts.finishReason ?? 'stop';
  const chunks: string[] = [];
  // Emit thinking chunk FIRST so the OpenAI normalizer opens a thinking
  // content block before the text block — same wire ordering reasoning
  // models (o1/o3/gpt-oss) emit.
  if (opts.thinking && opts.thinking.length > 0) {
    chunks.push(
      `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: opts.thinking } }] })}\n\n`,
    );
  }
  if (opts.content.length > 0) {
    chunks.push(
      `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: { role: 'assistant', content: opts.content } }] })}\n\n`,
    );
  }
  chunks.push(
    `data: ${JSON.stringify({ model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
  );
  if (opts.usage) {
    chunks.push(
      `data: ${JSON.stringify({ model, choices: [], usage: opts.usage })}\n\n`,
    );
  }
  chunks.push(`data: [DONE]\n\n`);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
    async (input: unknown, init?: RequestInit) => {
      capture.url =
        typeof input === 'string' ? input : (input as Request).url;
      capture.init = init;
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  );
}

/** Install a one-shot fetch mock that rejects — simulates a network error. */
export function mockFetchError(message: string): void {
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
    throw new Error(message);
  });
}

/** Install a one-shot fetch mock that returns an HTTP error response. */
export function mockFetchHttpError(status: number, bodyText = ''): void {
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
    return new Response(bodyText, { status });
  });
}
