/**
 * messages.route.ts — POST /messages (mounted at /v1 → /v1/messages)
 *
 * Implements the Anthropic Messages API so the Claude Code CLI (and any
 * Anthropic SDK client) can route its calls through the platform.
 *
 * Key design decisions:
 * - Body translation via anthropicToCompletionRequest (pure, tested separately).
 * - Stream path reuses the SAME canonical normalizer loop as
 *   canonical-completions.ts — no hand-rolled SSE serialisation.
 * - Unknown / unregistered models SMART-ROUTE instead of 400, because the
 *   Claude CLI always sends its own model name (e.g. "claude-opus-4-5") which
 *   may not be in our Registry yet. We log a warning and let the Smart Router
 *   / first-available model handle it.
 * - Deps (providerManager, resolveRequestedModel) are injected via plugin
 *   options so the unit tests never need a live DB or provider.
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import {
  selectCanonicalNormalizer,
  type CanonicalEvent,
  type CanonicalStreamFormat,
} from '@agentic-work/llm-sdk/lib/normalizers/index.js';
import {
  ProviderManager,
  getProviderManager as getProviderManagerSingleton,
} from '../../services/llm-providers/ProviderManager.js';
import type { CompletionRequest } from '../../services/llm-providers/ILLMProvider.js';
import { anthropicToCompletionRequest, completionResponseToAnthropic } from './translate.js';
import type { AnthropicRequestBody } from './translate.js';

// ---------------------------------------------------------------------------
// Plugin options — deps injected for unit-testability
// ---------------------------------------------------------------------------

export interface AnthropicMessagesOptions {
  providerManager?: ProviderManager;
  /** Override for resolveRequestedModel — injected in tests to avoid DB. */
  resolveModel?: typeof import('../../services/model-routing/RegistryModelGuard.js').resolveRequestedModel;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const anthropicMessagesRoute: FastifyPluginAsync<AnthropicMessagesOptions> = async (
  fastify: FastifyInstance,
  options: AnthropicMessagesOptions,
) => {
  const getProviderManager = () => options.providerManager ?? getProviderManagerSingleton();
  const logger = options.logger ?? fastify.log;

  // Lazy-loaded real resolveRequestedModel (real DB path in prod).
  // Can be overridden via options.resolveModel for tests.
  const getResolveModel = async () => {
    if (options.resolveModel) return options.resolveModel;
    const { resolveRequestedModel } = await import(
      '../../services/model-routing/RegistryModelGuard.js'
    );
    return resolveRequestedModel;
  };

  fastify.post<{ Body: AnthropicRequestBody }>(
    '/messages',
    {
      // Permissive schema — the body is validated by the translation layer;
      // we don't want Fastify to reject unknown Anthropic fields.
      schema: {
        body: {
          type: 'object',
          required: ['model', 'messages'],
          additionalProperties: true,
          properties: {
            model: { type: 'string' },
            messages: { type: 'array' },
            system: {},
            max_tokens: { type: 'integer', minimum: 1 },
            temperature: { type: 'number' },
            top_p: { type: 'number' },
            stream: { type: 'boolean' },
            tools: { type: 'array' },
            tool_choice: {},
            stop_sequences: { type: 'array' },
          },
        },
      },
    },
    async (request, reply: FastifyReply) => {
      const body = request.body;
      const requestId = `anthropic-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      logger.info(
        { requestId, model: body.model, messageCount: body.messages.length, stream: body.stream },
        '[POST /v1/messages] Anthropic Messages request',
      );

      try {
        // -----------------------------------------------------------------
        // 1. Registry guard + smart-route fallback
        // -----------------------------------------------------------------
        let selectedModel: string | undefined = body.model;
        try {
          const { prisma } = await import('../../utils/prisma.js');
          const resolveRequestedModel = await getResolveModel();
          const resolution = await resolveRequestedModel(body.model, prisma as any);

          if (resolution.kind === 'registry') {
            selectedModel = resolution.model;
            logger.info({ requestId, selectedModel }, '[/v1/messages] Registry hit — routing to registered model');
          } else if (resolution.kind === 'smart-router') {
            selectedModel = undefined; // Let ProviderManager smart-route
            logger.info({ requestId }, '[/v1/messages] Smart Router sentinel — routing via smart router');
          } else {
            // not-in-registry: SMART-ROUTE instead of 400 (differs from openai-compatible)
            logger.warn(
              { requestId, requestedModel: resolution.requested, availableCount: resolution.availableCount },
              '[/v1/messages] Model not in Registry — falling back to Smart Router for CLI gateway',
            );
            selectedModel = undefined; // Let ProviderManager smart-route
          }
        } catch (guardErr) {
          logger.warn({ requestId, err: guardErr }, '[/v1/messages] Registry guard failed (non-blocking) — using requested model');
          // Keep selectedModel = body.model
        }

        // -----------------------------------------------------------------
        // 2. Build CompletionRequest
        // -----------------------------------------------------------------
        const completionRequest: CompletionRequest = {
          ...anthropicToCompletionRequest(body),
          model: selectedModel,
          stream: !!body.stream,
        };

        // -----------------------------------------------------------------
        // 3. Wait for ProviderManager to be ready
        // -----------------------------------------------------------------
        let pm = getProviderManager();
        if (!pm || !(pm as any).initialized) {
          await new Promise((r) => setTimeout(r, 2000));
          pm = getProviderManager();
          if (!pm || !(pm as any).initialized) {
            return reply.code(503).send({
              type: 'error',
              error: { type: 'overloaded_error', message: 'LLM providers are still initializing. Retry in a few seconds.' },
            });
          }
        }

        // -----------------------------------------------------------------
        // 4. Streaming path
        // -----------------------------------------------------------------
        if (body.stream) {
          const format = resolveStreamFormat(pm, selectedModel ?? 'auto');
          const normalizer = selectCanonicalNormalizer(format, {
            messageId: `msg_anthropic_${requestId}`,
            model: selectedModel ?? 'auto',
          });

          const response = await pm.createCompletion(completionRequest);

          reply.hijack();
          reply.raw.writeHead(200, sseHeaders());

          // Handle client disconnect
          let clientGone = false;
          reply.raw.on('close', () => {
            clientGone = true;
          });

          try {
            if (!isAsyncGenerator(response)) {
              // Provider returned non-stream despite stream:true.
              // Synthesize a minimal canonical stream.
              const cr = response as { choices?: Array<{ message?: { content?: string | null } }> };
              const text = cr.choices?.[0]?.message?.content ?? '';
              writeAnthropicFrame(reply, {
                type: 'message_start',
                message: {
                  id: `msg_anthropic_${requestId}`,
                  type: 'message',
                  role: 'assistant',
                  model: selectedModel ?? 'auto',
                  content: [],
                  stop_reason: null,
                  stop_sequence: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              });
              writeAnthropicFrame(reply, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
              if (text) {
                writeAnthropicFrame(reply, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
              }
              writeAnthropicFrame(reply, { type: 'content_block_stop', index: 0 });
              writeAnthropicFrame(reply, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } });
              writeAnthropicFrame(reply, { type: 'message_stop' });
              reply.raw.end();
              return reply;
            }

            for await (const chunk of response) {
              if (clientGone) break;
              if (isCanonicalEnvelope(chunk)) {
                writeAnthropicFrame(reply, chunk as CanonicalEvent);
                continue;
              }
              const events = normalizer.consume(chunk);
              for (const ev of events) writeAnthropicFrame(reply, ev);
            }
            if (!clientGone) {
              for (const ev of normalizer.finalize()) writeAnthropicFrame(reply, ev);
            }
            reply.raw.end();
          } catch (streamError) {
            logger.error({ requestId, error: streamError }, '[/v1/messages] stream error');
            if (!clientGone) {
              writeAnthropicFrame(reply, {
                type: 'error',
                error: {
                  type: 'api_error',
                  message: streamError instanceof Error ? streamError.message : 'Stream error',
                },
              } as unknown as CanonicalEvent);
            }
            reply.raw.end();
          }
          return reply;
        }

        // -----------------------------------------------------------------
        // 5. Non-streaming path
        // -----------------------------------------------------------------
        const response = await pm.createCompletion({ ...completionRequest, stream: false });

        if (isAsyncGenerator(response)) {
          // Shouldn't happen with stream:false, but handle defensively
          return reply.code(500).send({
            type: 'error',
            error: { type: 'api_error', message: 'Provider returned a stream for a non-stream request' },
          });
        }

        const anthropicMsg = completionResponseToAnthropic(response as import('../../services/llm-providers/ILLMProvider.js').CompletionResponse, selectedModel ?? body.model);
        return reply.send(anthropicMsg);
      } catch (error) {
        logger.error(
          { requestId, error: error instanceof Error ? error.message : error },
          '[/v1/messages] dispatch error',
        );
        return reply.code(500).send({
          type: 'error',
          error: {
            type: 'api_error',
            message: error instanceof Error ? error.message : 'Internal server error',
          },
        });
      }
    },
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

/**
 * Write a single Anthropic SSE frame.
 * Anthropic SSE format: `event: <type>\ndata: <json>\n\n`
 */
function writeAnthropicFrame(reply: FastifyReply, ev: CanonicalEvent | Record<string, unknown>): void {
  if ((reply.raw as any).writableEnded) return;
  const type = (ev as any).type;
  if (type) {
    reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(ev)}\n\n`);
  } else {
    reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
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

function resolveStreamFormat(pm: ProviderManager, model: string): CanonicalStreamFormat {
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
