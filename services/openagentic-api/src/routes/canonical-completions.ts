/**
 * Canonical Completions Route — Path D (GH #143 ship list).
 *
 * Emits canonical events (Anthropic Messages SSE wire shape) DIRECTLY to
 * the wire — no openai-shape repackage step. Consumers (currently
 * workflows-svc `streamLLMCompletion` with `format:'canonical'`) drain
 * the SSE stream and forward each frame verbatim to their canonical
 * event sink, removing the double-normalization
 * (`provider → canonical → openai-shape → canonical`) that was the
 * subject of the SDK leverage study.
 *
 * The route is intentionally narrow:
 *   - Streaming-only. Non-stream callers keep using
 *     `/api/v1/chat/completions` (the OpenAI shim).
 *   - No request shape changes — same messages / model / temperature /
 *     max_tokens / tools / tool_choice fields the OpenAI shim accepts.
 *   - Same auth / Smart Router / RBAC / cost-tracking path as the OpenAI
 *     shim. The ONLY difference is the wire shape of streamed chunks.
 *
 * Architecture note: many providers stream canonical envelopes natively
 * (Bedrock-Anthropic, AIF-Responses on some deployments) which the
 * OpenAI shim then re-shapes into chunk format. This route skips that
 * re-shape entirely. For providers that yield non-canonical chunks
 * (OpenAI/Azure-OpenAI, Ollama, Gemini, etc.), the route runs each
 * chunk through the SDK `selectCanonicalNormalizer(format)` factory —
 * the SAME normalizer the chatmode V3 pipeline uses — so the wire is
 * always canonical regardless of upstream provider.
 *
 * Pinned by:
 *  - src/routes/__tests__/canonicalCompletions.test.ts (Path D unit suite)
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import {
  selectCanonicalNormalizer,
  type CanonicalEvent,
  type CanonicalStreamFormat,
} from '@agentic-work/llm-sdk/lib/normalizers/index.js';
import {
  ProviderManager,
  getProviderManager as getProviderManagerSingleton,
} from '../services/llm-providers/ProviderManager.js';
import type { CompletionRequest } from '../services/llm-providers/ILLMProvider.js';
import { TaskAnalysisService } from '../services/TaskAnalysisService.js';

export interface CanonicalCompletionsOptions {
  providerManager?: ProviderManager;
  logger?: Logger;
}

interface CanonicalRequestBody {
  model?: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, any> };
  }>;
  tool_choice?: unknown;
  response_format?: { type: 'text' | 'json_object' };
  user?: string;
  provider?: string;
}

const canonicalCompletionsRoutes: FastifyPluginAsync<CanonicalCompletionsOptions> = async (
  fastify: FastifyInstance,
  options: CanonicalCompletionsOptions,
) => {
  const getProviderManager = () => options.providerManager || getProviderManagerSingleton();
  const logger = options.logger || fastify.log;

  fastify.post<{ Body: CanonicalRequestBody }>(
    '/api/v1/canonical/completions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['messages'],
          properties: {
            model: { type: 'string' },
            messages: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role'],
                properties: {
                  role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                  content: { type: ['string', 'null'] },
                  name: { type: 'string' },
                  tool_calls: { type: 'array' },
                  tool_call_id: { type: 'string' },
                },
              },
            },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            top_p: { type: 'number', minimum: 0, maximum: 1 },
            stream: { type: 'boolean' },
            max_tokens: { type: 'integer', minimum: 1 },
            max_completion_tokens: { type: 'integer', minimum: 1 },
            tools: { type: 'array' },
            tool_choice: {},
            response_format: { type: 'object' },
            user: { type: 'string' },
            provider: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CanonicalRequestBody }>, reply: FastifyReply) => {
      const body = request.body;
      const requestId = `canon-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // Streaming-only by contract — non-stream callers belong on the
      // OpenAI shim. This keeps the canonical route surface minimal.
      if (body.stream !== true) {
        return reply.code(400).send({
          error: {
            type: 'StreamRequired',
            message:
              "POST /api/v1/canonical/completions is streaming-only. Send stream:true or use /api/v1/chat/completions for non-stream responses.",
          },
        });
      }

      logger.info(
        {
          requestId,
          model: body.model,
          messageCount: body.messages.length,
          provider: body.provider,
        },
        '[/api/v1/canonical/completions] request',
      );

      try {
        // Smart Router resolution mirrors the OpenAI shim. body.model
        // = 'auto' / 'model-router' / undefined → TaskAnalysisService
        // picks. Concrete ids pass through.
        let selectedModel = body.model;
        if (!selectedModel || selectedModel === 'model-router' || selectedModel === 'auto') {
          const taskAnalysisService = new TaskAnalysisService(logger as any);
          const taskAnalysis = await taskAnalysisService.analyzeTask({
            messages: body.messages.map((m) => ({ role: m.role, content: m.content || '' })),
            hasImages: false,
          });
          if (taskAnalysis.suggestedModel) {
            selectedModel = taskAnalysis.suggestedModel;
            logger.info(
              {
                requestId,
                originalModel: body.model,
                selectedModel,
                complexity: taskAnalysis.complexity,
              },
              '[Smart Router] canonical-completions selected model',
            );
          } else {
            // #1274: never let a chat request fall back to an embedding-only
            // model. Filter to authoritative chat capability, else the Registry
            // chat-role default.
            const pmTmp = getProviderManager()!;
            const models = await pmTmp.listModels();
            if (models.length > 0) {
              const { selectChatCapableFallback } = await import('../services/model-routing/selectChatCapableFallback.js');
              const { resolveChatModelId } = await import('../services/model-routing/resolveModel.js');
              selectedModel = await selectChatCapableFallback(models, {
                getCapabilities: (id: string) => pmTmp.getDiscoveredCapabilities(id)?.capabilities ?? null,
                resolveChatDefault: () => resolveChatModelId(),
                logger: logger as any,
              });
            } else {
              throw new Error('No models available from any provider');
            }
          }
        }

        const completionRequest: CompletionRequest = {
          messages: body.messages.map((msg) => ({
            role: msg.role,
            content: msg.content || '',
            name: msg.name,
            tool_calls: msg.tool_calls,
            tool_call_id: msg.tool_call_id,
          })),
          model: selectedModel,
          temperature: body.temperature,
          max_tokens: body.max_tokens || body.max_completion_tokens,
          top_p: body.top_p,
          stream: true,
          tools: body.tools,
          tool_choice: body.tool_choice as any,
          response_format: body.response_format,
          user: body.user,
        };

        let pm = getProviderManager();
        if (!pm || !(pm as any).initialized) {
          await new Promise((r) => setTimeout(r, 2000));
          pm = getProviderManager();
          if (!pm || !(pm as any).initialized) {
            return reply.code(503).send({
              error: {
                type: 'service_unavailable',
                message: 'LLM providers are still initializing. Retry in a few seconds.',
              },
            });
          }
        }

        // Resolve the canonical stream format for this model BEFORE
        // dispatching, so we can mount the matching SDK normalizer when
        // the provider yields non-canonical chunks.
        const format = resolveStreamFormat(pm, selectedModel ?? 'auto');
        const normalizer = selectCanonicalNormalizer(format, {
          messageId: `msg_canonical_${requestId}`,
          model: selectedModel ?? 'auto',
        });

        const response = await pm.createCompletion(completionRequest, body.provider);

        if (!isAsyncGenerator(response)) {
          // Provider returned non-stream — shouldn't happen with
          // stream:true, but guard anyway. Synthesize a single
          // canonical pair so consumers get a clean stream.
          reply.hijack();
          reply.raw.writeHead(200, sseHeaders());
          const cr = response as { choices?: Array<{ message?: { content?: string | null } }> };
          const text = cr.choices?.[0]?.message?.content ?? '';
          writeFrame(reply, {
            type: 'message_start',
            message: {
              id: `msg_canonical_${requestId}`,
              type: 'message',
              role: 'assistant',
              model: selectedModel ?? 'auto',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          });
          writeFrame(reply, {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          });
          if (text) {
            writeFrame(reply, {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text },
            });
          }
          writeFrame(reply, { type: 'content_block_stop', index: 0 });
          writeFrame(reply, {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 0 },
          });
          writeFrame(reply, { type: 'message_stop' });
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          return reply;
        }

        // Stream path — pipe canonical events out as SSE frames. Two
        // shapes arrive on `response`:
        //   (a) Already-canonical SDK envelopes (Bedrock-Anthropic,
        //       Vertex-Anthropic, AIF-Responses on some deployments).
        //       Pass through verbatim.
        //   (b) Provider-native chunks (OpenAI Chat Completions, Ollama
        //       native, Gemini, etc.). Run through the SDK normalizer
        //       (same one chatmode V3 uses) to produce canonical
        //       envelopes, then emit.
        reply.hijack();
        reply.raw.writeHead(200, sseHeaders());

        try {
          for await (const chunk of response) {
            if (isCanonicalEnvelope(chunk)) {
              writeFrame(reply, chunk as CanonicalEvent);
              continue;
            }
            const events = normalizer.consume(chunk);
            for (const ev of events) writeFrame(reply, ev);
          }
          for (const ev of normalizer.finalize()) writeFrame(reply, ev);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
        } catch (streamError) {
          logger.error(
            { requestId, error: streamError },
            '[/api/v1/canonical/completions] stream error',
          );
          // Emit an error envelope before closing — keeps the canonical
          // contract intact even on failure.
          writeFrame(reply, {
            type: 'error',
            error: {
              type: 'stream_error',
              message:
                streamError instanceof Error ? streamError.message : 'Stream error',
            },
          } as unknown as CanonicalEvent);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
        }
        return reply;
      } catch (error) {
        logger.error(
          { requestId, error: error instanceof Error ? error.message : error },
          '[/api/v1/canonical/completions] dispatch error',
        );
        return reply.code(500).send({
          error: {
            type: 'api_error',
            message: error instanceof Error ? error.message : 'Internal server error',
          },
        });
      }
    },
  );
};

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function writeFrame(reply: FastifyReply, ev: CanonicalEvent | Record<string, unknown>): void {
  // Defensive — if the raw socket has already been closed (client
  // disconnect), skip the write rather than throwing.
  if ((reply.raw as any).writableEnded) return;
  reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
}

const CANONICAL_ENVELOPE_TYPES = new Set([
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'error',
]);

function isCanonicalEnvelope(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== 'object') return false;
  const t = (chunk as { type?: unknown }).type;
  return typeof t === 'string' && CANONICAL_ENVELOPE_TYPES.has(t);
}

function isAsyncGenerator(obj: unknown): obj is AsyncGenerator<unknown> {
  return !!obj && typeof (obj as any)[Symbol.asyncIterator] === 'function';
}

function resolveStreamFormat(
  pm: ProviderManager,
  model: string,
): CanonicalStreamFormat {
  try {
    const fn = (pm as any).getStreamFormatForModel;
    const fmt = typeof fn === 'function' ? fn.call(pm, model) : 'openai';
    if (
      fmt === 'anthropic' ||
      fmt === 'bedrock-anthropic' ||
      fmt === 'vertex-anthropic' ||
      fmt === 'foundry-anthropic' ||
      fmt === 'ollama' ||
      fmt === 'openai' ||
      fmt === 'gemini' ||
      fmt === 'aif-responses'
    ) {
      return fmt;
    }
  } catch {
    // fall through
  }
  return 'openai';
}

export default canonicalCompletionsRoutes;
