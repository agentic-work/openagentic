/**
 * MSW handler factory for the platform chat-completions shim at
 * /api/v1/chat/completions.
 *
 * 7+ harness tests stub this endpoint with the same OpenAI envelope.
 * The factory collapses the boilerplate while still letting tests
 * assert on the inbound wire payload via the returned `captured` object.
 *
 * Tier B (2026-05-13): the llm_completion executor now streams via the
 * SDK canonical normalizer, so this factory emits OpenAI-shape SSE chunks
 * (`text/event-stream`) instead of a single JSON envelope. Tests still
 * see the same `content` / `model` / `usage` shape on the executor's
 * return value because `streamLLMCompletion` aggregates per-chunk
 * text_delta events back into the legacy `{ content, model, usage }`
 * contract.
 *
 * Usage:
 *   const { handler, captured } = mockChatCompletions({
 *     content: 'Hello back.',
 *     model: 'router-routed-model',
 *     usage: { prompt_tokens: 5, completion_tokens: 2 },
 *   });
 *   harnessServer.use(handler);
 *   // ... run flow ...
 *   expect(captured.body?.model).toBe('auto');
 */

import { http, HttpResponse } from 'msw';

export interface ChatCompletionsMockOptions {
  /** Content of the assistant message in choices[0]. */
  content: string;
  /** Top-level `model` field. Defaults to 'gpt-oss:20b'. */
  model?: string;
  /** Top-level `id`. Defaults to 'cmpl-test'. */
  id?: string;
  /** `usage` object. Defaults to small token counts. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    [k: string]: unknown;
  };
  /** Extra fields to merge into the assistant message (e.g. `thinking`). */
  messageExtra?: Record<string, unknown>;
  /** `finish_reason` on choices[0]. Defaults to 'stop'. */
  finishReason?: string;
}

export interface ChatCompletionsCaptured {
  /** Full inbound request body, last call. */
  body?: Record<string, unknown>;
}

/**
 * Build an MSW handler for the platform chat-completions shim.
 *
 * Returns the handler + a `captured` object the test can read after
 * runFlow() resolves to assert on what the engine sent on the wire.
 */
export function mockChatCompletions(opts: ChatCompletionsMockOptions): {
  handler: ReturnType<typeof http.post>;
  captured: ChatCompletionsCaptured;
} {
  const captured: ChatCompletionsCaptured = {};
  const promptTokens = opts.usage?.prompt_tokens ?? 5;
  const completionTokens = opts.usage?.completion_tokens ?? 2;
  const totalTokens =
    opts.usage?.total_tokens ?? promptTokens + completionTokens;

  const handler = http.post(
    'http://openagentic-api:8000/api/v1/chat/completions',
    async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      captured.body = body;

      const id = opts.id ?? 'cmpl-test';
      const model = opts.model ?? 'gpt-oss:20b';
      const finishReason = opts.finishReason ?? 'stop';
      const usage = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        ...(opts.usage ?? {}),
      };

      // Tier B: when the caller requests streaming (the new
      // llm_completion executor does), respond with OpenAI-shape SSE
      // chunks. The executor's streamLLMCompletion drains these
      // through the SDK canonical normalizer and re-aggregates into
      // `{ content, model, usage }`. Non-streaming callers (legacy
      // azure_ai / bedrock / vertex / openagentic_chat / reasoning /
      // structured_output executors) still get the JSON envelope, so
      // every pre-existing harness test continues to pass.
      if (body.stream === true) {
        const chunks: string[] = [];
        chunks.push(
          `data: ${JSON.stringify({ id, model, choices: [{ index: 0, delta: { role: 'assistant', content: opts.content } }] })}\n\n`,
        );
        if (opts.messageExtra && Object.keys(opts.messageExtra).length > 0) {
          // Map `messageExtra.thinking` → `delta.reasoning_content` on the
          // wire — the OpenAI canonical normalizer reads chain-of-thought
          // tokens from `reasoning_content` (the o1/o3/reasoning-model
          // convention). The non-streaming envelope keeps the legacy
          // `message.thinking` field for executors that drop streaming.
          const extras = { ...(opts.messageExtra as Record<string, unknown>) };
          if (typeof extras.thinking === 'string') {
            extras.reasoning_content = extras.thinking;
            delete extras.thinking;
          }
          chunks.push(
            `data: ${JSON.stringify({ id, model, choices: [{ index: 0, delta: extras }] })}\n\n`,
          );
        }
        chunks.push(
          `data: ${JSON.stringify({ id, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
        );
        chunks.push(
          `data: ${JSON.stringify({ id, model, choices: [], usage })}\n\n`,
        );
        chunks.push(`data: [DONE]\n\n`);

        const sseBody = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder();
            for (const c of chunks) controller.enqueue(enc.encode(c));
            controller.close();
          },
        });
        return new HttpResponse(sseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      return HttpResponse.json({
        id,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: opts.content,
              ...(opts.messageExtra ?? {}),
            },
            finish_reason: finishReason,
          },
        ],
        usage,
      });
    },
  );

  return { handler, captured };
}
