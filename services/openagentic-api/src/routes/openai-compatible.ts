/**
 * OpenAI-Compatible API Routes
 *
 * Provides OpenAI-compatible endpoints for external integrations.
 * Routes requests through the ProviderManager which supports multiple LLM providers
 * (Azure OpenAI, AWS Bedrock, Google Vertex AI, Ollama, Azure AI Foundry).
 *
 * Endpoints:
 * - POST /v1/chat/completions - OpenAI-compatible chat completions
 * - GET /v1/models - List available models
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { ProviderManager, getProviderManager as getProviderManagerSingleton } from '../services/llm-providers/ProviderManager.js';
import { CompletionRequest, CompletionResponse } from '../services/llm-providers/ILLMProvider.js';
import { TaskAnalysisService } from '../services/TaskAnalysisService.js';
import { gateModelSelection, estimateToolChainDepth } from '../services/ModelCapabilityGate.js';

export interface OpenAICompatibleOptions {
  providerManager: ProviderManager;
  logger?: Logger;
}

// OpenAI-compatible request types
interface ChatCompletionRequest {
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
  n?: number;
  stream?: boolean;
  stop?: string | string[];
  max_tokens?: number;
  max_completion_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, any>;
    };
  }>;
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
  seed?: number;
  // Custom extension: specify provider
  provider?: string;
}

interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
}

export default async function openaiCompatibleRoutes(
  fastify: FastifyInstance,
  options: OpenAICompatibleOptions
) {
  // Use lazy getter — ProviderManager initializes asynchronously after routes register
  const getProviderManager = () => options.providerManager || getProviderManagerSingleton();
  const logger = options.logger || fastify.log;

  /**
   * POST /v1/chat/completions
   * OpenAI-compatible chat completions endpoint
   */
  fastify.post<{ Body: ChatCompletionRequest }>(
    '/v1/chat/completions',
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
                  tool_call_id: { type: 'string' }
                }
              }
            },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            top_p: { type: 'number', minimum: 0, maximum: 1 },
            n: { type: 'integer', minimum: 1 },
            stream: { type: 'boolean' },
            stop: {},
            max_tokens: { type: 'integer', minimum: 1 },
            max_completion_tokens: { type: 'integer', minimum: 1 },
            presence_penalty: { type: 'number', minimum: -2, maximum: 2 },
            frequency_penalty: { type: 'number', minimum: -2, maximum: 2 },
            user: { type: 'string' },
            tools: { type: 'array' },
            tool_choice: {},
            response_format: { type: 'object' },
            seed: { type: 'integer' },
            provider: { type: 'string' }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: ChatCompletionRequest }>, reply: FastifyReply) => {
      const body = request.body;
      const requestId = `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      logger.info({
        requestId,
        model: body.model,
        messageCount: body.messages.length,
        stream: body.stream,
        provider: body.provider
      }, 'OpenAI-compatible chat completion request');

      try {
        // ═══════════════════════════════════════════════════════════════════
        // REGISTRY GUARD (task #6): body.model must be a sentinel or present
        // + enabled in admin.model_role_assignments. Non-Registry concrete
        // ids → HTTP 400 ModelNotInRegistry. Sentinels pass through to the
        // Smart Router branch below.
        // ═══════════════════════════════════════════════════════════════════
        try {
          const { prisma } = await import('../utils/prisma.js');
          const { resolveRequestedModel } = await import('../services/model-routing/RegistryModelGuard.js');
          const resolution = await resolveRequestedModel(body.model as any, prisma as any);
          if (resolution.kind === 'not-in-registry') {
            logger.warn({
              requestId,
              requestedModel: resolution.requested,
              availableCount: resolution.availableCount,
            }, '[/v1/messages] Rejected body.model — not in Registry');
            return reply.code(400).send({
              error: {
                type: 'ModelNotInRegistry',
                message: `Model "${resolution.requested}" is not enabled in the Model Registry. Either enable it on the Admin Models page or omit body.model to use Smart Router.`,
                model: resolution.requested,
                availableCount: resolution.availableCount,
              },
            });
          }
          // resolution.kind === 'smart-router' or 'registry' → continue normally.
          // The pipeline/providerManager already honor concrete body.model values
          // at dispatch time; we just needed to reject bad ones up-front.
        } catch (guardErr) {
          logger.warn({ requestId, err: guardErr }, '[/v1/messages] Registry guard failed (non-blocking)');
        }
        // Handle model-router / auto: use TaskAnalysisService (smart router) for intelligent selection
        let selectedModel = body.model;
        if (!selectedModel || selectedModel === 'model-router' || selectedModel === 'auto') {
          const taskAnalysisService = new TaskAnalysisService(logger as any);
          const taskAnalysis = await taskAnalysisService.analyzeTask({
            messages: body.messages.map(msg => ({ role: msg.role, content: msg.content || '' })),
            hasImages: body.messages.some(msg =>
              Array.isArray(msg.content) && msg.content.some((c: any) => c.type === 'image_url')
            ),
            // Forward client metadata so AI Builder requests get premium-tier
            // routing regardless of message length heuristics.
            metadata: (body as any).metadata,
          });

          if (taskAnalysis.suggestedModel) {
            selectedModel = taskAnalysis.suggestedModel;
            logger.info({
              originalModel: body.model,
              selectedModel,
              complexity: taskAnalysis.complexity,
              reasoning: taskAnalysis.reasoning,
            }, 'Smart router: TaskAnalysis selected model');

            // CAPABILITY GATE: Validate model can handle request requirements
            const systemMsg = body.messages.find(m => m.role === 'system');
            const lastUserMsg = [...body.messages].reverse().find(m => m.role === 'user');
            const lastUserText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
            const gateResult = await gateModelSelection({
              selectedModel,
              toolCount: body.tools?.length || 0,
              systemPromptLength: systemMsg?.content?.length || 0,
              hasImages: body.messages.some(msg =>
                Array.isArray(msg.content) && msg.content.some((c: any) => c.type === 'image_url')
              ),
              hasAgentDelegation: false, // OpenAI-compatible endpoint doesn't inject delegate_to_agents
              estimatedToolChainDepth: estimateToolChainDepth(lastUserText),
            }, logger as any);

            if (gateResult.upgraded) {
              logger.info({
                originalModel: selectedModel,
                upgradedModel: gateResult.model,
                reason: gateResult.reason,
              }, '🛡️ [CapabilityGate] Model upgraded for request requirements');
              selectedModel = gateResult.model;
            }
          } else {
            // Fallback: pick first available model only if TaskAnalysis returned nothing
            const models = await getProviderManager()!.listModels();
            if (models.length > 0) {
              selectedModel = models[0].id;
              logger.warn({
                originalModel: body.model,
                selectedModel,
                provider: models[0].provider
              }, 'Smart router: TaskAnalysis returned no model, falling back to first available');
            } else {
              throw new Error('No models available from any provider');
            }
          }
        }

        // Map OpenAI request to CompletionRequest
        const completionRequest: CompletionRequest = {
          messages: body.messages.map(msg => ({
            role: msg.role,
            content: msg.content || '',
            name: msg.name,
            tool_calls: msg.tool_calls,
            tool_call_id: msg.tool_call_id
          })),
          model: selectedModel,
          temperature: body.temperature,
          max_tokens: body.max_tokens || body.max_completion_tokens,
          top_p: body.top_p,
          frequency_penalty: body.frequency_penalty,
          presence_penalty: body.presence_penalty,
          stream: body.stream || false,
          tools: body.tools,
          tool_choice: body.tool_choice,
          response_format: body.response_format,
          user: body.user
        };

        // Auto-enable thinking for Gemini 3 models (COT/reasoning) if configured
        // Gemini 3 uses thinking_level (low, high, minimal, medium)
        // Set VERTEX_AI_THINKING_LEVEL=none to disable thinking mode
        const isGemini3 = selectedModel?.includes('gemini-3');
        const thinkingLevel = process.env.VERTEX_AI_THINKING_LEVEL;
        if (isGemini3 && thinkingLevel && thinkingLevel !== 'none' && thinkingLevel !== '') {
          (completionRequest as any).thinking = {
            type: 'enabled',
            level: thinkingLevel
          };
          logger.info({
            model: selectedModel,
            thinkingLevel
          }, 'OpenAI-compatible: 🧠 Enabled thinking mode for Gemini 3 model');
        } else if (isGemini3) {
          logger.info({
            model: selectedModel,
            thinkingLevel: thinkingLevel || 'not configured'
          }, 'OpenAI-compatible: Gemini 3 model without thinking mode');
        }

        // Call ProviderManager — lazy init means it may not be ready yet
        let pm = getProviderManager();
        if (!pm || !(pm as any).initialized) {
          // Brief wait for init (common during startup when workflows fire immediately)
          await new Promise(r => setTimeout(r, 2000));
          pm = getProviderManager();
          if (!pm || !(pm as any).initialized) {
            return reply.code(503).send({
              error: { message: 'LLM providers are still initializing. Retry in a few seconds.', type: 'service_unavailable' }
            });
          }
        }
        const response = await pm.createCompletion(
          completionRequest,
          body.provider // Optional: specify provider
        );

        // Handle streaming response
        if (body.stream && isAsyncGenerator(response)) {
          reply.hijack();
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          });

          try {
            for await (const chunk of response) {

              // Build delta - handle multiple provider chunk formats
              const delta: Record<string, any> = {};

              // Check if chunk is already in OpenAI format (with choices array)
              // GoogleVertexProvider yields full OpenAI-compatible chunks
              const choiceDelta = chunk.choices?.[0]?.delta;

              if (choiceDelta) {
                // Provider sent full OpenAI format - extract delta from choices
                if (choiceDelta.content !== undefined) {
                  delta.content = choiceDelta.content;
                }
                if (choiceDelta.tool_calls) {
                  delta.tool_calls = choiceDelta.tool_calls;
                }
                if (choiceDelta.role) {
                  delta.role = choiceDelta.role;
                }
              } else if (chunk.type === 'content_block_delta' && chunk.delta) {
                // Bedrock/Anthropic native format: content_block_delta events
                if (chunk.delta.type === 'text_delta' && chunk.delta.text) {
                  delta.content = chunk.delta.text;
                } else if (chunk.delta.type === 'thinking_delta' && chunk.delta.thinking) {
                  // Thinking content: For OpenAI-compat, emit as regular content
                  // since OpenAI API has no separate thinking stream.
                  // Only emit if there's actual reasoning text (not empty).
                  delta.content = chunk.delta.thinking;
                } else if (chunk.delta.type === 'input_json_delta' && chunk.delta.partial_json) {
                  // Tool use argument streaming - accumulate as tool_calls
                  delta.content = ''; // Keep stream alive, tool args not surfaced as content
                }
                // Skip signature_delta — internal only
              } else if (chunk.type === 'content_block_start' || chunk.type === 'content_block_stop') {
                // Block lifecycle events — skip, no content to emit
              } else if (chunk.type === 'message_start' || chunk.type === 'message_stop' || chunk.type === 'message_delta') {
                // Message lifecycle — extract finish reason from multiple locations
                if (chunk.stop_reason) {
                  // message_stop has stop_reason at root
                  const sr = chunk.stop_reason;
                  delta._finishReason = sr === 'end_turn' ? 'stop' : sr === 'tool_use' ? 'tool_calls' : sr;
                } else if (chunk.delta?.stop_reason) {
                  // message_delta has stop_reason in delta
                  const sr = chunk.delta.stop_reason;
                  delta._finishReason = sr === 'end_turn' ? 'stop' : sr === 'tool_use' ? 'tool_calls' : sr;
                }
              } else if (chunk.delta) {
                // Provider sent simplified delta format
                if (chunk.delta.content !== undefined) {
                  delta.content = chunk.delta.content;
                }
                if (chunk.delta.text !== undefined && delta.content === undefined) {
                  delta.content = chunk.delta.text; // Fallback: text → content
                }
                if (chunk.delta.tool_calls) {
                  delta.tool_calls = chunk.delta.tool_calls;
                }
                if (chunk.delta.role) {
                  delta.role = chunk.delta.role;
                }
              } else if (chunk.content !== undefined) {
                // Provider sent direct content
                delta.content = chunk.content;
              }

              // Determine finish_reason - check multiple formats
              let finishReason = chunk.choices?.[0]?.finish_reason || chunk.finish_reason || (delta as any)._finishReason || null;
              delete (delta as any)._finishReason; // Clean up internal marker
              // Bedrock/Anthropic: stop_reason in message_delta or root
              if (!finishReason && chunk.stop_reason) {
                const sr = chunk.stop_reason;
                finishReason = sr === 'end_turn' ? 'stop' : sr === 'tool_use' ? 'tool_calls' : sr;
              }
              if (!finishReason && chunk.delta?.stop_reason) {
                const sr = chunk.delta.stop_reason;
                finishReason = sr === 'end_turn' ? 'stop' : sr === 'tool_use' ? 'tool_calls' : sr;
              }
              if (delta.tool_calls && delta.tool_calls.length > 0 && !finishReason) {
                finishReason = 'tool_calls';
              }

              // Skip chunks with no content and no finish_reason (lifecycle events)
              if (Object.keys(delta).length === 0 && !finishReason) {
                continue;
              }

              // Format as SSE
              const sseChunk: ChatCompletionChunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: body.model || 'default',
                choices: [{
                  index: 0,
                  delta: Object.keys(delta).length > 0 ? delta : {},
                  finish_reason: finishReason
                }]
              };

              logger.debug({
                requestId,
                hasContent: !!delta.content,
                hasToolCalls: !!delta.tool_calls,
                toolCallCount: delta.tool_calls?.length,
                finishReason
              }, 'OpenAI streaming chunk');

              reply.raw.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
            }
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
          } catch (streamError) {
            logger.error({ requestId, error: streamError }, 'Stream error');
            reply.raw.write(`data: {"error": "${streamError instanceof Error ? streamError.message : 'Stream error'}"}\n\n`);
            reply.raw.end();
          }
          // Streaming is handled directly via reply.raw, no need to return anything
          return reply;
        }

        // Handle non-streaming response
        const completionResponse = response as CompletionResponse;
        const openaiResponse: ChatCompletionResponse = {
          id: completionResponse.id || requestId,
          object: 'chat.completion',
          created: completionResponse.created || Math.floor(Date.now() / 1000),
          model: completionResponse.model || body.model || 'default',
          choices: completionResponse.choices.map((choice, index) => ({
            index,
            message: {
              role: 'assistant' as const,
              content: choice.message.content,
              tool_calls: choice.message.tool_calls
            },
            finish_reason: choice.finish_reason as any || 'stop'
          })),
          usage: completionResponse.usage
        };

        logger.info({
          requestId,
          model: openaiResponse.model,
          totalTokens: openaiResponse.usage?.total_tokens
        }, 'OpenAI-compatible completion successful');

        return reply.send(openaiResponse);

      } catch (error) {
        logger.error({
          requestId,
          error: error instanceof Error ? error.message : error
        }, 'OpenAI-compatible completion failed');

        // Return OpenAI-compatible error format
        return reply.code(500).send({
          error: {
            message: error instanceof Error ? error.message : 'Internal server error',
            type: 'api_error',
            param: null,
            code: 'internal_error'
          }
        });
      }
    }
  );

  // NOTE: /v1/models route moved to routes/v1/models.ts to avoid duplication
  // The v1Router registers all /api/v1/* routes including models

  /**
   * GET /v1/health
   * Health check endpoint
   */
  fastify.get('/v1/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await getProviderManager()!.getHealthStatus();
      return reply.send({
        status: 'ok',
        providers: health
      });
    } catch (error) {
      return reply.code(500).send({
        status: 'error',
        message: error instanceof Error ? error.message : 'Health check failed'
      });
    }
  });
}

// Type guard for AsyncGenerator
function isAsyncGenerator(obj: any): obj is AsyncGenerator<any> {
  return obj && typeof obj[Symbol.asyncIterator] === 'function';
}
