/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Openagentic Routes
 * Provides endpoints for openagentic-cli instances to connect to the platform.
 *
 * Key endpoints:
 * - GET /config - Provider credentials for direct LLM calls
 * - POST /chat - Streaming chat completions (messages array format)
 * - GET /status - Service status
 * - GET /sessions - User's code sessions
 *
 * Format matches @agentic-work/sdk OpenagenticConfig interface.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import { prisma } from '../utils/prisma.js';
import { getCodeModeSessionService, CodeModeSessionService } from '../services/CodeModeSessionService.js';
import { awcodeStorageService } from '../services/AWCodeStorageService.js';
import { llmMetricsService, LLMRequestMetrics } from '../services/LLMMetricsService.js';
import { ModelConfigurationService } from '../services/ModelConfigurationService.js';
import { contextManagementService } from '../services/ContextManagementService.js';
import { gateModelSelection, estimateToolChainDepth } from '../services/ModelCapabilityGate.js';

// SECURITY: Internal API key for code-manager authentication
const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || '';

// SDK-compatible types - must match what the CLI SDK supports
type ProviderType = 'anthropic' | 'openai' | 'google' | 'ollama' | 'azure-openai' | 'vertex-ai' | 'aws-bedrock' | 'genai' | 'openagentic-api';

interface ProviderCredentials {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  projectId?: string;
  location?: string;
  resourceName?: string;
  deploymentName?: string;
  apiVersion?: string;
}

interface OpenagenticProvider {
  type: ProviderType;
  id: string;
  name: string;
  enabled: boolean;
  credentials: ProviderCredentials;
}

interface OpenagenticModelConfig {
  id: string;
  providerId: string;
  name: string;
  available: boolean;
}

interface OpenagenticConfig {
  providers: OpenagenticProvider[];
  models: OpenagenticModelConfig[];
  defaultModel?: string;
  mcpServers?: string[];
  // System prompt for code mode
  systemPrompt?: string;
  // Legacy fields for backwards compatibility
  mcpProxyUrl?: string;
}

// Chat request types (OpenAI-compatible messages format)
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenagenticChatRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // Session persistence options
  sessionId?: string;  // Optional session ID for message persistence
  persistMessages?: boolean;  // Whether to persist messages to database
}

interface OpenagenticRoutesOptions {
  providerManager?: ProviderManager;
}

export const openagenticRoutes: FastifyPluginAsync<OpenagenticRoutesOptions> = async (fastify, opts) => {
  // CRITICAL: providerManager may be null at route registration time because
  // routes are registered before ProviderManager is initialized in server.ts.
  // Use 'let' so the onRequest hook can update it from the global reference.
  let providerManager: ProviderManager | null = opts.providerManager || null;

  // Initialize CodeModeSessionService for message persistence
  let codeModeSessionService: CodeModeSessionService | null = null;
  if (providerManager) {
    codeModeSessionService = getCodeModeSessionService(loggers.routes, providerManager);
  }

  // Lazy initialization hook - pick up providerManager from global if not set at registration time
  fastify.addHook('onRequest', async () => {
    if (!providerManager && (global as any).providerManager) {
      providerManager = (global as any).providerManager;
      loggers.routes.info('[Openagentic] Lazy-initialized providerManager from global reference');
      if (!codeModeSessionService) {
        codeModeSessionService = getCodeModeSessionService(loggers.routes, providerManager!);
      }
    }
  });
  /**
   * GET /api/openagentic/config
   * Returns provider configuration for the authenticated user's openagentic-cli
   * Currently uses environment variables; can be extended later for per-user keys
   */
  fastify.get('/config', {
    preHandler: authMiddleware,
    handler: async (request, reply) => {
      try {
        const userId = (request.user as any)?.id;

        if (!userId) {
          return reply.status(401).send({ error: 'Unauthorized - no user ID' });
        }

        loggers.routes.info({ userId }, 'Fetching openagentic config for user');

        const providers: OpenagenticProvider[] = [];
        const models: OpenagenticModelConfig[] = [];

        // Get available models from ProviderManager (dynamic discovery)
        // IMPORTANT: ALL providers are routed through OpenAgentic API to ensure:
        // 1. K8s pods don't need direct internet access (NetworkPolicy)
        // 2. Centralized credential management
        // 3. Consistent rate limiting and metrics
        if (providerManager) {
          try {
            const availableModels = await providerManager.listModels();

            // API base URL for CLI to call back
            const apiBaseUrl = process.env.OPENAGENTIC_API_URL || 'http://openagentic-api:8000';

            // Single unified provider - all calls route through API
            const unifiedProvider: OpenagenticProvider = {
              type: 'openagentic-api',
              id: 'openagentic-api',
              name: 'OpenAgentic API',
              enabled: true,
              credentials: {
                type: 'openagentic-api',
                baseUrl: apiBaseUrl,
              },
            };
            providers.push(unifiedProvider);

            // Add all discovered models under the unified API provider
            for (const model of availableModels) {
              models.push({
                id: model.id || model.name,
                providerId: 'openagentic-api',  // All models use API provider
                name: model.name || model.id,
                available: (model as any).available !== false,
              });
            }

            loggers.routes.info({
              providerCount: providers.length,
              modelCount: models.length,
              apiBaseUrl,
            }, 'Configured unified API provider for all models');
          } catch (err) {
            loggers.routes.warn({ err }, 'Failed to get models from ProviderManager');
          }
        }

        // Fallback: If no models discovered, still add the API provider
        // The CLI will use the default model from the platform
        if (providers.length === 0) {
          const apiBaseUrl = process.env.OPENAGENTIC_API_URL || 'http://openagentic-api:8000';
          providers.push({
            type: 'openagentic-api',
            id: 'openagentic-api',
            name: 'OpenAgentic API',
            enabled: true,
            credentials: {
              type: 'openagentic-api',
              baseUrl: apiBaseUrl,
            },
          });
          loggers.routes.info({ apiBaseUrl }, 'Added fallback API provider');
        }

        // Get MCP servers (if available)
        let mcpServers: any[] = [];
        try {
          const mcpResp = await fetch('http://openagentic-mcp-proxy:8080/tools', {
            headers: { 'X-Internal-API-Key': process.env.INTERNAL_API_KEY || '' },
            signal: AbortSignal.timeout(3000),
          });
          if (mcpResp.ok) {
            const mcpData = await mcpResp.json();
            mcpServers = mcpData.tools || mcpData || [];
          }
        } catch { /* MCP proxy not available — empty tools is fine */ }

        // Get default model for Code Mode
        // Priority: Admin override (awcode.defaultModel) → Platform default (same as Chat Mode)
        let defaultModel: string | undefined;

        // 1. Check admin override
        try {
          const adminSetting = await prisma.systemConfiguration.findUnique({
            where: { key: 'awcode.defaultModel' },
          });
          if (adminSetting?.value) {
            const val = adminSetting.value;
            defaultModel = typeof val === 'string' ? val.replace(/^"|"$/g, '') : String(val);
            loggers.routes.info({ defaultModel }, 'Using admin-configured Code Mode model');
          }
        } catch (err) {
          loggers.routes.warn({ err }, 'Failed to fetch awcode.defaultModel setting');
        }

        // 2. Fall back to platform default (same as Chat Mode)
        if (!defaultModel) {
          try {
            defaultModel = await ModelConfigurationService.getDefaultChatModel();
            loggers.routes.info({ defaultModel }, 'Using platform default model (same as Chat Mode)');
          } catch (err) {
            loggers.routes.warn({ err }, 'Failed to get platform default model');
          }
        }

        // 3. Get custom system prompt if configured
        let systemPrompt: string | undefined;
        try {
          const promptConfig = await prisma.systemConfiguration.findUnique({
            where: { key: 'codemode.system_prompt' },
          });
          if (promptConfig?.value && typeof promptConfig.value === 'string') {
            systemPrompt = promptConfig.value;
            loggers.routes.debug('Using custom system prompt from database');
          }
        } catch (err) {
          loggers.routes.warn({ err }, 'Failed to fetch system prompt setting');
        }

        // Build config response (SDK-compatible format)
        const config: OpenagenticConfig = {
          providers,
          models,
          defaultModel,
          mcpServers,
          systemPrompt,
          // Legacy fields
          mcpProxyUrl: process.env.MCP_PROXY_URL || 'http://localhost:3100',
        };

        loggers.routes.info({
          userId,
          providerCount: providers.length,
          modelCount: models.length,
          providers: providers.map(p => p.type),
        }, 'Returning openagentic config');

        return reply.send(config);
      } catch (error) {
        loggers.routes.error({ error }, 'Failed to get openagentic config');
        return reply.status(500).send({ error: 'Failed to get configuration' });
      }
    },
  });

  /**
   * GET /api/openagentic/health
   * Health check for openagentic service
   */
  fastify.get('/health', async (request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'openagentic',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/openagentic/chat
   * Streaming chat completions for openagentic-cli instances.
   * Accepts OpenAI-compatible messages array format.
   * Routes through platform's configured LLM providers.
   */
  fastify.post<{ Body: OpenagenticChatRequest }>('/chat', {
    preHandler: authMiddleware,
    handler: async (request: FastifyRequest<{ Body: OpenagenticChatRequest }>, reply: FastifyReply): Promise<void> => {
      const userId = (request.user as any)?.id;
      const isAdmin = (request.user as any)?.isAdmin || false;

      if (!userId) {
        reply.code(401).send({ error: 'Unauthorized - no user ID' });
        return;
      }

      const { model, messages, tools, temperature, max_tokens, sessionId, persistMessages } = request.body;

      if (!messages || messages.length === 0) {
        reply.code(400).send({ error: 'Messages array is required' });
        return;
      }

      loggers.routes.info({
        userId,
        model,
        messageCount: messages.length,
        hasTools: !!tools?.length,
        sessionId,
        persistMessages,
      }, '[Openagentic] Chat request received');

      // Track response content for persistence
      let accumulatedContent = '';
      let accumulatedThinking = '';
      let accumulatedToolCalls: any[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      const requestStartTime = new Date();

      if (!providerManager) {
        reply.code(503).send({ error: 'LLM providers not available' });
        return;
      }

      // Determine model to use for Code Mode
      // Priority: User session override → CLI request → Admin override → Platform default
      // The UI can set a model override via the code session (stored in Redis)
      let effectiveModel = model;

      // Check for user's model override (set when user switches model in code mode UI)
      // Key is by userId since the CLI doesn't pass sessionId in chat requests
      try {
        const { createClient } = await import('redis');
        const redisUrl = process.env.REDIS_URL || 'redis://openagentic-redis:6379';
        const redisClient = createClient({ url: redisUrl });
        await redisClient.connect();
        const overrideModel = await redisClient.get(`code_model_override:${userId}`);
        await redisClient.disconnect();
        if (overrideModel) {
          effectiveModel = overrideModel;
          loggers.routes.info({ effectiveModel, userId }, '[Openagentic] Using user model override from Redis');
        }
      } catch { /* non-fatal — Redis unavailable, use CLI model */ }

      // Helper to check if a model has a working provider
      const hasWorkingProvider = (modelId: string | undefined): boolean => {
        if (!modelId) return false;
        const providerName = providerManager.getProviderForModel(modelId);
        if (!providerName) return false;
        const providerInstance = providerManager.getProvider(providerName);
        return !!providerInstance;
      };

      // (#74) Smart router sentinel detection — if the model is one of the
      // smart-router sentinels, route via SmartModelRouter to pick a real
      // model per-request based on the prompt's complexity. This is the
      // same logic chat mode uses (validation.stage.ts:447).
      const SMART_ROUTER_SENTINELS = new Set(['smart-router', 'auto', 'default', 'model-router', '']);
      if (effectiveModel !== undefined && SMART_ROUTER_SENTINELS.has(effectiveModel.toLowerCase())) {
        try {
          const { getSmartModelRouter } = await import('../services/SmartModelRouter.js');
          const router = getSmartModelRouter();
          if (router) {
            // Build a CompletionRequest shape that the router expects
            const routerRequest: any = {
              messages: messages || [],
              model: '',
              tools: [],
              maxTokens: 4096,
              temperature: 0.7,
            };
            const decision = await router.routeRequest(routerRequest, undefined, userId);
            const picked = decision?.selectedModel?.modelId;
            if (picked && hasWorkingProvider(picked)) {
              loggers.routes.info(
                { sentinel: effectiveModel, picked, reason: decision?.reason },
                '[Openagentic] Smart router resolved sentinel to real model'
              );
              effectiveModel = picked;
            } else {
              loggers.routes.warn(
                { decision },
                '[Openagentic] Smart router returned no usable model — falling through'
              );
              effectiveModel = undefined;
            }
          }
        } catch (err) {
          loggers.routes.warn({ err }, '[Openagentic] Smart router invocation failed — falling through');
          effectiveModel = undefined;
        }
      }

      // Check if model has a working provider (including Ollama models)
      const isModelSupported = hasWorkingProvider(effectiveModel);

      if (!effectiveModel || !isModelSupported) {
        // 1. Check admin override for Code Mode
        try {
          const adminSetting = await prisma.systemConfiguration.findUnique({
            where: { key: 'awcode.defaultModel' },
          });
          if (adminSetting?.value) {
            const val = adminSetting.value;
            const adminModel = typeof val === 'string' ? val.replace(/^"|"$/g, '') : String(val);
            if (hasWorkingProvider(adminModel)) {
              effectiveModel = adminModel;
              loggers.routes.info({ effectiveModel }, '[Openagentic] Using admin-configured Code Mode model');
            } else {
              loggers.routes.warn({ adminModel }, '[Openagentic] Admin model has no working provider');
            }
          }
        } catch (err) {
          loggers.routes.warn({ err }, '[Openagentic] Failed to fetch awcode.defaultModel');
        }

        // 2. Fall back to platform default (same as Chat Mode)
        if (!hasWorkingProvider(effectiveModel)) {
          try {
            const platformDefault = await ModelConfigurationService.getDefaultChatModel();
            // Only use platform default if a provider exists for it
            if (hasWorkingProvider(platformDefault)) {
              effectiveModel = platformDefault;
              loggers.routes.info({ effectiveModel }, '[Openagentic] Using platform default model (same as Chat Mode)');
            } else {
              loggers.routes.warn({ platformDefault }, '[Openagentic] Platform default model has no working provider');
            }
          } catch (err) {
            loggers.routes.warn({ err }, '[Openagentic] Failed to get platform default model');
          }
        }

        // 3. Final fallback: Use first available model from ProviderManager
        if (!hasWorkingProvider(effectiveModel)) {
          try {
            const availableModels = await providerManager.listModels();
            // Find a chat-capable model (use first model if capabilities not available)
            const chatModel = availableModels.find(m => (m as any).capabilities?.chat !== false) || availableModels[0];
            if (chatModel) {
              effectiveModel = chatModel.id;
              loggers.routes.info({ effectiveModel, provider: chatModel.provider }, '[Openagentic] Using first available model as fallback');
            }
          } catch (err) {
            loggers.routes.error({ err }, '[Openagentic] Failed to get available models');
          }
        }
      }

      // Capability gate SKIPPED for openagentic — admin/user selects model explicitly.
      // Gate was upgrading Ollama models to embedding models (nomic-embed-text) → 400 errors.

      // Set up SSE streaming
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // CONTEXT MANAGEMENT: Check and silently compact if approaching limits
      // This runs in background without blocking the streaming request (same as ChatMode)
      if (sessionId) {
        contextManagementService.checkAndCompact(sessionId, effectiveModel)
          .catch(err => {
            loggers.routes.warn({ err, sessionId }, '[Openagentic] Context compaction check failed');
          });
      }

      try {
        // Get the appropriate provider name for the model
        const providerName = providerManager.getProviderForModel(effectiveModel);

        if (!providerName) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: `No provider available for model: ${effectiveModel}` })}\n\n`);
          reply.raw.end();
          return;
        }

        // Get the actual provider instance
        const provider = providerManager.getProvider(providerName);
        if (!provider) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: `Provider not found: ${providerName}` })}\n\n`);
          reply.raw.end();
          return;
        }

        loggers.routes.info({
          userId,
          model: effectiveModel,
          provider: providerName,
          messageCount: messages.length,
        }, '[Openagentic] Routing to provider');

        // Debug: Log message structure to understand tool_use format
        messages.forEach((m: any, i: number) => {
          if (Array.isArray(m.content)) {
            m.content.forEach((block: any, j: number) => {
              if (block.type === 'tool_use') {
                loggers.routes.debug({
                  messageIndex: i,
                  contentIndex: j,
                  inputType: typeof block.input,
                  inputValue: block.input,
                }, '[Openagentic] tool_use block found');
              }
            });
          }
        });

        // Convert messages to provider format
        // IMPORTANT: CLI may send tool_use.input in various formats - Bedrock requires it as object
        // Also handle tool_result messages which need proper formatting
        const providerMessages = messages.map((m, msgIdx) => {
          let content: any = m.content;

          // If content is an array, process each block to ensure proper formatting
          if (Array.isArray(content)) {
            content = content.map((block: any, blockIdx: number) => {
              // Handle tool_use blocks - ensure input is a plain object
              if (block.type === 'tool_use') {
                let input = block.input;

                // Ensure input is a valid plain object for Bedrock
                if (typeof input === 'string') {
                  // Try to parse JSON string
                  try {
                    const parsed = JSON.parse(input);
                    // Ensure parsed result is a plain object (not array)
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      input = parsed;
                    } else {
                      loggers.routes.warn({ msgIdx, blockIdx, parsedType: typeof parsed }, '[Openagentic] Parsed tool_use input is not a plain object');
                      input = Array.isArray(parsed) ? { items: parsed } : { value: parsed };
                    }
                  } catch (e) {
                    // If parse fails, wrap the string value
                    loggers.routes.warn({ msgIdx, blockIdx, inputLength: input.length }, '[Openagentic] Failed to parse tool_use input string');
                    input = { raw: input };
                  }
                } else if (input === null || input === undefined) {
                  // Null/undefined -> empty object
                  input = {};
                } else if (Array.isArray(input)) {
                  // Array -> wrap in object
                  loggers.routes.debug({ msgIdx, blockIdx }, '[Openagentic] Wrapping tool_use input array in object');
                  input = { items: input };
                } else if (typeof input !== 'object') {
                  // Primitive types -> wrap in object
                  loggers.routes.warn({ msgIdx, blockIdx, type: typeof input }, '[Openagentic] Wrapping primitive tool_use input');
                  input = { value: input };
                } else {
                  // Already an object - ensure it's a plain object (clone to remove prototype issues)
                  input = JSON.parse(JSON.stringify(input));
                }

                return { ...block, input };
              }

              // Handle tool_result blocks - ensure content is properly formatted
              if (block.type === 'tool_result') {
                let resultContent = block.content;

                // Ensure content is a string or proper array
                if (typeof resultContent !== 'string' && !Array.isArray(resultContent)) {
                  try {
                    resultContent = JSON.stringify(resultContent);
                  } catch {
                    resultContent = String(resultContent);
                  }
                }

                return { ...block, content: resultContent };
              }

              return block;
            });
          }

          return {
            role: m.role,
            content,
            tool_calls: m.tool_calls,
            tool_call_id: m.tool_call_id,
          };
        });

        // Convert tools to provider format
        const providerTools = tools?.map(t => ({
          type: 'function' as const,
          function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          },
        }));

        // DEBUG: Log transformed messages to understand tool_use.input issue
        providerMessages.forEach((m: any, i: number) => {
          if (Array.isArray(m.content)) {
            m.content.forEach((block: any, j: number) => {
              if (block.type === 'tool_use') {
                loggers.routes.info({
                  messageIndex: i,
                  contentIndex: j,
                  inputType: typeof block.input,
                  inputIsArray: Array.isArray(block.input),
                  inputConstructor: block.input?.constructor?.name,
                  inputValue: JSON.stringify(block.input).substring(0, 200),
                }, '[Openagentic] TRANSFORMED tool_use block');
              }
            });
          }
        });

        // CRITICAL FIX: Validate tool_result blocks have matching tool_use blocks
        // Error: "unexpected `tool_use_id` found in `tool_result` blocks: <id>. Each `tool_result` block must have a corresponding `tool_use` block in the previous message."
        // This happens when message history gets corrupted and tool_result exists without its tool_use
        //
        // IMPORTANT: Handle BOTH message formats:
        // - Anthropic format: tool_use blocks in content[], tool_result blocks in content[]
        // - OpenAI format: tool_calls[] array on assistant messages, role='tool' with tool_call_id

        // Step 1: Collect all tool_use IDs from the message history (both formats)
        const toolUseIds = new Set<string>();
        providerMessages.forEach((m: any) => {
          // Anthropic format: tool_use blocks in content array
          if (Array.isArray(m.content)) {
            m.content.forEach((block: any) => {
              if (block.type === 'tool_use' && block.id) {
                toolUseIds.add(block.id);
              }
            });
          }
          // OpenAI format: tool_calls array on assistant messages
          if (Array.isArray(m.tool_calls)) {
            m.tool_calls.forEach((tc: any) => {
              if (tc.id) {
                toolUseIds.add(tc.id);
              }
            });
          }
        });

        loggers.routes.debug({
          toolUseIdCount: toolUseIds.size,
          toolUseIds: Array.from(toolUseIds).slice(0, 10),
        }, '[Openagentic] Collected tool_use IDs for validation');

        // Step 2: Find and remove orphan tool_result blocks (both formats)
        const cleanedMessages = providerMessages.map((m: any, msgIdx: number) => {
          // OpenAI format: Check role='tool' messages with tool_call_id
          if (m.role === 'tool' && m.tool_call_id) {
            const hasMatchingToolUse = toolUseIds.has(m.tool_call_id);
            if (!hasMatchingToolUse) {
              loggers.routes.warn({
                msgIndex: msgIdx,
                orphanToolCallId: m.tool_call_id,
                availableToolUseIds: Array.from(toolUseIds),
              }, '[Openagentic] Removing orphan OpenAI-format tool message - no matching tool_use found');
              // Return null to filter out, or convert to text message
              return null;
            }
            return m;
          }

          // Anthropic format: Check content array for tool_result blocks
          if (!Array.isArray(m.content)) return m;

          const cleanedContent = m.content.filter((block: any) => {
            // Keep non-tool_result blocks
            if (block.type !== 'tool_result') return true;

            // Check if tool_result has a matching tool_use
            const hasMatchingToolUse = toolUseIds.has(block.tool_use_id);
            if (!hasMatchingToolUse) {
              loggers.routes.warn({
                msgIndex: msgIdx,
                orphanToolUseId: block.tool_use_id,
                availableToolUseIds: Array.from(toolUseIds),
              }, '[Openagentic] Removing orphan Anthropic-format tool_result block - no matching tool_use found');
            }
            return hasMatchingToolUse;
          });

          // If message content is now empty, we might need to handle this
          if (cleanedContent.length === 0 && m.content.length > 0) {
            loggers.routes.warn({
              msgIndex: msgIdx,
              originalContentLength: m.content.length,
              role: m.role,
            }, '[Openagentic] Message content became empty after removing orphan tool_results');
            // Return a text placeholder to avoid empty content errors
            return { ...m, content: [{ type: 'text', text: '[Tool results removed - missing tool calls]' }] };
          }

          return { ...m, content: cleanedContent };
        }).filter((m: any) => m !== null); // Remove nulled-out OpenAI tool messages

        // Step 3: Remove any messages that are now invalid (empty user messages with tool results)
        let validMessages = cleanedMessages.filter((m: any, idx: number) => {
          // Don't filter out messages with valid content
          if (!Array.isArray(m.content)) return true;
          if (m.content.length > 0) return true;

          // Empty content in user message is problematic
          if (m.role === 'user') {
            loggers.routes.warn({ msgIndex: idx }, '[Openagentic] Removing empty user message');
            return false;
          }

          return true;
        });

        if (validMessages.length !== providerMessages.length) {
          loggers.routes.info({
            originalCount: providerMessages.length,
            cleanedCount: validMessages.length,
            removedCount: providerMessages.length - validMessages.length,
          }, '[Openagentic] Cleaned message history - removed orphan tool results');
        }

        // DEBUG: Log tool configuration before sending to provider
        loggers.routes.info({
          model: effectiveModel,
          provider: providerName,
          hasTools: !!providerTools?.length,
          toolCount: providerTools?.length || 0,
          toolNames: providerTools?.slice(0, 5).map(t => t.function.name) || [],
        }, '[Openagentic] 🔧 Sending request to provider with tools');

        // Check if model supports extended thinking
        const modelSupportsThinking = ModelConfigurationService.supportsThinking(effectiveModel);

        // Configure extended thinking for code mode - use generous budget for complex reasoning
        // Code tasks often require deep reasoning about architecture, bugs, and implementation
        const OPENAGENTIC_THINKING_BUDGET = parseInt(process.env.OPENAGENTIC_THINKING_BUDGET || '16000');
        let enableThinking = modelSupportsThinking && OPENAGENTIC_THINKING_BUDGET > 0;

        // Thinking blocks are preserved in CLI message history, so we keep thinking
        // enabled across multi-turn sessions. The CLI sends back assistant messages
        // with thinking content blocks intact, maintaining context for the model.
        if (enableThinking) {
          loggers.routes.info({
            model: effectiveModel,
            messageCount: validMessages.length,
            assistantMsgCount: validMessages.filter((m: any) => m.role === 'assistant').length,
          }, '[Openagentic] ✅ Thinking stays enabled - CLI preserves thinking blocks in history');
        }

        if (enableThinking) {
          loggers.routes.info({
            model: effectiveModel,
            thinkingBudget: OPENAGENTIC_THINKING_BUDGET,
          }, '[Openagentic] 🧠 Extended thinking enabled for code mode');
        }

        // Build completion request with optional thinking
        const completionRequest: any = {
          model: effectiveModel,
          messages: validMessages,
          tools: providerTools,
          temperature: temperature ?? 0.7,
          max_tokens: max_tokens ?? 8192,
          stream: true,
        };

        // Add thinking configuration for Claude models that support it
        if (enableThinking) {
          completionRequest.thinking = {
            type: 'enabled',
            budget_tokens: OPENAGENTIC_THINKING_BUDGET,
          };
        }

        // Stream completion from provider using createCompletion
        const stream = await providerManager.createCompletion(completionRequest, providerName) as AsyncGenerator<any>;

        // Accumulate tool call deltas by id/index before emitting
        // Tool calls are streamed in chunks: first has id+name, subsequent have arguments
        const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

        // Helper to emit a complete tool call
        const emitToolCall = (toolCall: { id: string; name: string; arguments: string }) => {
          let parsedArgs: any = {};
          try {
            if (toolCall.arguments) {
              parsedArgs = JSON.parse(toolCall.arguments);
            }
          } catch {
            // Keep as string if parse fails
            parsedArgs = toolCall.arguments;
          }

          // CRITICAL FIX: Unwrap "value" wrapper if model made format error
          // Some models wrap all tool parameters in a "value" key: {"value": {"path": "...", "content": "..."}}
          // But tools expect direct parameters: {"path": "...", "content": "..."}
          if (parsedArgs && typeof parsedArgs === 'object' && parsedArgs.value && typeof parsedArgs.value === 'object') {
            // Check if this looks like a wrapped set of parameters (has typical file operation keys)
            const valueKeys = Object.keys(parsedArgs.value);
            const paramKeys = Object.keys(parsedArgs);
            // If only "value" key exists and value contains actual parameters, unwrap it
            if (paramKeys.length === 1 && valueKeys.length > 0) {
              loggers.routes.warn({
                toolName: toolCall.name,
                originalKeys: paramKeys,
                unwrappedKeys: valueKeys,
              }, '[Openagentic] Unwrapping "value" wrapper from tool arguments - model used incorrect format');
              parsedArgs = parsedArgs.value;
            }
          }
          // Accumulate for persistence
          accumulatedToolCalls.push({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments,
            },
          });
          reply.raw.write(`data: ${JSON.stringify({
            type: 'tool_call',
            tool_call: {
              id: toolCall.id,
              name: toolCall.name,
              arguments: parsedArgs,
            },
          })}\n\n`);
        };

        // Forward stream events to client
        // Handle both simple format { type, content } and OpenAI-style { choices: [{ delta }] }
        for await (const chunk of stream) {
          // Capture token usage from any chunk format
          if (chunk.usage?.input_tokens) inputTokens = chunk.usage.input_tokens;
          if (chunk.usage?.output_tokens) outputTokens = chunk.usage.output_tokens;
          if (chunk.message?.usage?.input_tokens) inputTokens = chunk.message.usage.input_tokens;
          // OpenAI-style: usage in last chunk
          if (chunk.usage?.prompt_tokens) inputTokens = chunk.usage.prompt_tokens;
          if (chunk.usage?.completion_tokens) outputTokens = chunk.usage.completion_tokens;
          // Bedrock Converse API includes usage in metadata
          if ((chunk as any).amazon?.inputTokenCount) inputTokens = (chunk as any).amazon.inputTokenCount;
          if ((chunk as any).amazon?.outputTokenCount) outputTokens = (chunk as any).amazon.outputTokenCount;
          // Log first chunk with usage for debugging (remove after confirmed working)
          if (chunk.usage && (inputTokens > 0 || outputTokens > 0)) {
            loggers.routes.info({ inputTokens, outputTokens, chunkType: chunk.type || 'openai' }, '[Openagentic] Token usage captured from stream');
          }

          // OpenAI-style format from providers (Bedrock, etc.)
          if (chunk.choices && chunk.choices[0]) {
            const choice = chunk.choices[0];
            const delta = choice.delta || {};

            // Handle thinking/reasoning content
            if (delta.thinking || delta.reasoning) {
              const thinkingContent = delta.thinking || delta.reasoning;
              accumulatedThinking += thinkingContent;
              reply.raw.write(`data: ${JSON.stringify({ type: 'thinking', content: thinkingContent })}\n\n`);
            }

            // Handle text content
            if (delta.content) {
              accumulatedContent += delta.content;
              reply.raw.write(`data: ${JSON.stringify({ type: 'content', content: delta.content })}\n\n`);
            }

            // Handle tool calls - accumulate deltas before emitting
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                const existing = pendingToolCalls.get(index);

                if (tc.id) {
                  // New tool call with id
                  pendingToolCalls.set(index, {
                    id: tc.id,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  });
                } else if (existing) {
                  // Delta update to existing tool call
                  if (tc.function?.name) {
                    existing.name += tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments;
                  }
                }
              }
            }

            // Handle finish reason - emit all pending tool calls first
            if (choice.finish_reason) {
              // Emit all accumulated tool calls
              for (const [, toolCall] of pendingToolCalls) {
                if (toolCall.id && toolCall.name) {
                  emitToolCall(toolCall);
                }
              }
              pendingToolCalls.clear();

              reply.raw.write(`data: ${JSON.stringify({ type: 'done', finish_reason: choice.finish_reason })}\n\n`);
            }
          }
          // Anthropic native format - content_block_delta events
          // This handles direct Anthropic SDK streaming format from AnthropicProvider
          else if (chunk.type === 'content_block_delta') {
            const delta = chunk.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              accumulatedContent += delta.text;
              reply.raw.write(`data: ${JSON.stringify({ type: 'content', content: delta.text })}\n\n`);
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              accumulatedThinking += delta.thinking;
              reply.raw.write(`data: ${JSON.stringify({ type: 'thinking', content: delta.thinking })}\n\n`);
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              // Tool input being streamed - accumulate for later emission
              const index = chunk.index ?? 0;
              const existing = pendingToolCalls.get(index);
              if (existing) {
                existing.arguments += delta.partial_json;
              }
            }
          }
          // Anthropic content_block_start - initialize tool call tracking
          else if (chunk.type === 'content_block_start') {
            const block = chunk.content_block;
            if (block?.type === 'tool_use') {
              const index = chunk.index ?? 0;
              pendingToolCalls.set(index, {
                id: block.id,
                name: block.name,
                arguments: '',
              });
            }
          }
          // Anthropic content_block_stop - emit completed tool calls
          else if (chunk.type === 'content_block_stop') {
            const index = chunk.index ?? 0;
            const toolCall = pendingToolCalls.get(index);
            if (toolCall?.id && toolCall?.name) {
              emitToolCall(toolCall);
              pendingToolCalls.delete(index);
            }
          }
          // Anthropic message_delta - message completion (includes final token usage)
          else if (chunk.type === 'message_delta') {
            // Extract token usage from message_delta (Anthropic streaming API)
            if (chunk.usage?.output_tokens) {
              outputTokens = chunk.usage.output_tokens;
            }
            const stopReason = chunk.delta?.stop_reason;
            if (stopReason) {
              // Emit any remaining tool calls
              for (const [, tc] of pendingToolCalls) {
                if (tc.id && tc.name) {
                  emitToolCall(tc);
                }
              }
              pendingToolCalls.clear();
              reply.raw.write(`data: ${JSON.stringify({ type: 'done', finish_reason: stopReason })}\n\n`);
            }
          }
          // Simple format { type, content } for backwards compatibility
          else if (chunk.type === 'content') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'content', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'thinking') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'thinking', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'tool_call') {
            reply.raw.write(`data: ${JSON.stringify({
              type: 'tool_call',
              tool_call: {
                id: chunk.toolCall?.id,
                name: chunk.toolCall?.name,
                arguments: chunk.toolCall?.arguments,
              },
            })}\n\n`);
          } else if (chunk.type === 'error') {
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: chunk.error })}\n\n`);
          } else if (chunk.type === 'done') {
            // Emit any remaining pending tool calls
            for (const [, toolCall] of pendingToolCalls) {
              if (toolCall.id && toolCall.name) {
                emitToolCall(toolCall);
              }
            }
            pendingToolCalls.clear();
            reply.raw.write(`data: ${JSON.stringify({ type: 'done', finish_reason: chunk.finishReason || 'stop' })}\n\n`);
          }
        }

        // Emit any remaining tool calls at stream end
        for (const [, toolCall] of pendingToolCalls) {
          if (toolCall.id && toolCall.name) {
            emitToolCall(toolCall);
          }
        }

        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();

        loggers.routes.info({ userId, model: effectiveModel, inputTokens, outputTokens }, '[Openagentic] Chat completed');

        // Fallback token estimation if streaming didn't provide usage
        // Rough: ~4 chars per token for English text
        if (inputTokens === 0 && messages?.length) {
          const inputText = JSON.stringify(messages);
          inputTokens = Math.ceil(inputText.length / 4);
        }
        if (outputTokens === 0 && accumulatedContent) {
          outputTokens = Math.ceil(accumulatedContent.length / 4);
        }

        // Accumulate token usage per session in Redis (for context sidebar)
        if (sessionId) {
          try {
            const { createClient } = await import('redis');
            const redisUrl = process.env.REDIS_URL || 'redis://openagentic-redis:6379';
            const redisClient = createClient({ url: redisUrl });
            await redisClient.connect();
            const redisKey = `code_session_stats:${sessionId}`;
            await redisClient.hIncrBy(redisKey, 'input_tokens', inputTokens || 0);
            await redisClient.hIncrBy(redisKey, 'output_tokens', outputTokens || 0);
            await redisClient.hIncrBy(redisKey, 'request_count', 1);
            await redisClient.hSet(redisKey, 'model', effectiveModel || '');
            await redisClient.hSet(redisKey, 'last_request', Date.now().toString());
            await redisClient.expire(redisKey, 86400);
            await redisClient.disconnect();
          } catch { /* non-fatal — stats are best-effort */ }
        }

        // Persist assistant message if session persistence is enabled
        if (sessionId && persistMessages && codeModeSessionService) {
          try {
            // Find the last user message to persist
            const lastUserMessage = messages.filter(m => m.role === 'user').pop();
            if (lastUserMessage) {
              // Persist user message
              await codeModeSessionService.addMessage(sessionId, {
                role: 'user',
                content: lastUserMessage.content,
              });
            }

            // Persist assistant response
            if (accumulatedContent || accumulatedToolCalls.length > 0) {
              await codeModeSessionService.addMessage(sessionId, {
                role: 'assistant',
                content: accumulatedContent,
                toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
                thinking: accumulatedThinking || undefined,
                tokensInput: inputTokens || undefined,
                tokensOutput: outputTokens || undefined,
                metadata: {
                  model: effectiveModel,
                },
              });
              loggers.routes.info({
                sessionId,
                contentLength: accumulatedContent.length,
                toolCallsCount: accumulatedToolCalls.length,
              }, '[Openagentic] Persisted messages to session');
            }
          } catch (persistError) {
            loggers.routes.error({ error: persistError, sessionId }, '[Openagentic] Failed to persist messages');
            // Don't throw - persistence failure shouldn't fail the chat
          }
        }

        // 📊 LOG METRICS: Track Code Mode usage separately from Chat
        try {
          const requestEndTime = new Date();
          const totalDurationMs = requestEndTime.getTime() - requestStartTime.getTime();

          // Get API key ID from request (set by auth middleware)
          const apiKeyId = (request as any).apiKeyId;

          const metrics: LLMRequestMetrics = {
            userId,
            sessionId: sessionId || undefined,
            apiKeyId: apiKeyId || undefined,

            providerType: providerName || 'unknown',
            model: effectiveModel,

            requestType: 'chat',
            source: 'code',  // Differentiate from regular chat - this is Code Mode
            streaming: true,
            temperature: temperature || undefined,
            maxTokens: max_tokens || undefined,

            promptTokens: inputTokens || 0,
            completionTokens: outputTokens || 0,
            totalTokens: (inputTokens || 0) + (outputTokens || 0),

            latencyMs: totalDurationMs,
            totalDurationMs: totalDurationMs,

            toolCallsCount: accumulatedToolCalls.length,
            toolNames: accumulatedToolCalls.map(tc => tc.name).filter(Boolean),

            status: 'success',
            requestStartedAt: requestStartTime,
            requestCompletedAt: requestEndTime,
          };

          llmMetricsService.logRequest(metrics).then(logId => {
            if (logId) {
              loggers.routes.debug({ logId, source: 'code', model: effectiveModel }, '[Openagentic] Metrics logged');
            }
          }).catch(err => {
            loggers.routes.warn({ error: err.message }, '[Openagentic] Failed to log metrics');
          });
        } catch (metricsErr: any) {
          loggers.routes.warn({ error: metricsErr.message }, '[Openagentic] Failed to create metrics');
        }
      } catch (error: any) {
        loggers.routes.error({ error, userId }, '[Openagentic] Chat error');
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: error.message || 'Chat failed' })}\n\n`);
        reply.raw.end();
      }
    },
  });

  // NOTE: /v1/messages Anthropic-compatible endpoint is registered below (after sessions/code-server routes)
  // It provides Claude Code CLI compatibility with full streaming support
  // (see POST /api/openagentic/v1/messages ~line 2460+)

  // /v1/messages Anthropic-compatible endpoint is registered at end of file

  /* ORPHAN_BLOCK_START - removed duplicate /v1/messages handler
      if (!providerManager) {
        reply.code(503).send({
          type: 'error',
          error: { type: 'api_error', message: 'LLM providers not available' },
        });
        return;
      }

      // --- Model resolution (same logic as /chat) ---
      let effectiveModel = requestedModel;

      const hasWorkingProvider = (modelId: string | undefined): boolean => {
        if (!modelId) return false;
        const providerName = providerManager!.getProviderForModel(modelId);
        if (!providerName) return false;
        return !!providerManager!.getProvider(providerName);
      };

      if (!effectiveModel || !hasWorkingProvider(effectiveModel)) {
        // 1. Admin override
        try {
          const adminSetting = await prisma.systemConfiguration.findUnique({ where: { key: 'awcode.defaultModel' } });
          if (adminSetting?.value) {
            const val = adminSetting.value;
            const adminModel = typeof val === 'string' ? val.replace(/^"|"$/g, '') : String(val);
            if (hasWorkingProvider(adminModel)) effectiveModel = adminModel;
          }
        } catch {}

        // 2. Platform default
        if (!hasWorkingProvider(effectiveModel)) {
          try {
            const platformDefault = await ModelConfigurationService.getDefaultChatModel();
            if (hasWorkingProvider(platformDefault)) effectiveModel = platformDefault;
          } catch {}
        }

        // 3. First available
        if (!hasWorkingProvider(effectiveModel)) {
          try {
            const available = await providerManager.listModels();
            if (available.length > 0) effectiveModel = available[0].id;
          } catch {}
        }
      }

      const providerName = providerManager.getProviderForModel(effectiveModel);
      if (!providerName) {
        reply.code(400).send({
          type: 'error',
          error: { type: 'invalid_request_error', message: `No provider for model: ${effectiveModel}` },
        });
        return;
      }

      loggers.routes.info({
        userId,
        requestedModel,
        effectiveModel,
        provider: providerName,
      }, '[Openagentic] /v1/messages model resolved');

      // --- Convert Anthropic tools to OpenAI format for ProviderManager ---
      let providerTools: any[] | undefined;
      if (anthropicTools && anthropicTools.length > 0) {
        providerTools = anthropicTools.map((t: any) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description || '',
            parameters: t.input_schema || {},
          },
        }));
      }

      // --- Prepend system prompt to messages if provided ---
      let providerMessages = [...messages];
      if (systemPrompt) {
        // Anthropic system can be string or array of content blocks
        const systemText = typeof systemPrompt === 'string'
          ? systemPrompt
          : Array.isArray(systemPrompt)
            ? systemPrompt.map((b: any) => b.text || '').join('\n')
            : String(systemPrompt);

        // Check if first message is already system
        if (providerMessages.length > 0 && providerMessages[0].role === 'system') {
          // Prepend to existing system
          providerMessages[0] = {
            ...providerMessages[0],
            content: systemText + '\n' + (providerMessages[0].content || ''),
          };
        } else {
          providerMessages.unshift({ role: 'system', content: systemText });
        }
      }

      // --- Validate message formatting (same as /chat) ---
      providerMessages = providerMessages.map((m: any) => {
        let content = m.content;
        if (Array.isArray(content)) {
          content = content.map((block: any) => {
            if (block.type === 'tool_use') {
              let input = block.input;
              if (typeof input === 'string') {
                try { input = JSON.parse(input); } catch { input = { raw: input }; }
              }
              if (input === null || input === undefined) input = {};
              if (Array.isArray(input)) input = { items: input };
              if (typeof input !== 'object') input = { value: input };
              return { ...block, input };
            }
            if (block.type === 'tool_result') {
              let resultContent = block.content;
              if (typeof resultContent !== 'string' && !Array.isArray(resultContent)) {
                resultContent = JSON.stringify(resultContent);
              }
              return { ...block, content: resultContent };
            }
            return block;
          });
        }
        return { ...m, content };
      });

      // --- Orphan tool_result cleanup (same as /chat) ---
      const toolUseIds = new Set<string>();
      providerMessages.forEach((m: any) => {
        if (Array.isArray(m.content)) {
          m.content.forEach((block: any) => {
            if (block.type === 'tool_use' && block.id) toolUseIds.add(block.id);
          });
        }
        if (Array.isArray(m.tool_calls)) {
          m.tool_calls.forEach((tc: any) => { if (tc.id) toolUseIds.add(tc.id); });
        }
      });

      providerMessages = providerMessages.map((m: any) => {
        if (m.role === 'tool' && m.tool_call_id && !toolUseIds.has(m.tool_call_id)) return null;
        if (!Array.isArray(m.content)) return m;
        const cleaned = m.content.filter((block: any) => {
          if (block.type !== 'tool_result') return true;
          return toolUseIds.has(block.tool_use_id);
        });
        if (cleaned.length === 0 && m.content.length > 0) {
          return { ...m, content: [{ type: 'text', text: '[Tool results removed]' }] };
        }
        return { ...m, content: cleaned };
      }).filter((m: any) => m !== null);

      // --- Thinking configuration ---
      const modelSupportsThinking = ModelConfigurationService.supportsThinking(effectiveModel);
      const OPENAGENTIC_THINKING_BUDGET = parseInt(process.env.OPENAGENTIC_THINKING_BUDGET || '16000');
      let enableThinking = false;

      // Honor client's thinking request if model supports it
      if (thinking && thinking.type === 'enabled' && modelSupportsThinking) {
        enableThinking = true;
      } else if (modelSupportsThinking && OPENAGENTIC_THINKING_BUDGET > 0 && !thinking) {
        // Default enable for thinking-capable models
        enableThinking = true;
      }

      // Check for incompatible assistant messages
      if (enableThinking) {
        const hasIncompatible = providerMessages.some((msg: any) => {
          if (msg.role !== 'assistant') return false;
          if (msg.tool_calls && msg.tool_calls.length > 0) return true;
          if (typeof msg.content === 'string') return true;
          const content = Array.isArray(msg.content) ? msg.content : [];
          if (content.length > 0) {
            const firstType = content[0]?.type;
            if (firstType !== 'thinking' && firstType !== 'redacted_thinking') return true;
          }
          return false;
        });
        if (hasIncompatible) enableThinking = false;
      }

      // --- Build completion request ---
      const completionRequest: any = {
        model: effectiveModel,
        messages: providerMessages,
        tools: providerTools,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 8192,
        stream: true,
      };

      if (enableThinking) {
        const budget = thinking?.budget_tokens || OPENAGENTIC_THINKING_BUDGET;
        completionRequest.thinking = { type: 'enabled', budget_tokens: budget };
      }

      // --- SSE streaming in Anthropic format ---
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Generate a message ID
      const msgId = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

      // Send message_start event
      reply.raw.write(`event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: msgId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: effectiveModel,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      })}\n\n`);

      // Track content block indices for proper Anthropic SSE formatting
      let blockIndex = 0;
      let currentBlockType: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      // Accumulate tool call deltas
      const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

      // Helper: start a new content block
      // Anthropic SDK requires text blocks to have text: '' field
      const startBlock = (type: string, extra: any = {}) => {
        const content_block: any = { type, ...extra };
        if (type === 'text' && !('text' in content_block)) content_block.text = '';
        if (type === 'thinking' && !('thinking' in content_block)) content_block.thinking = '';
        reply.raw.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: blockIndex,
          content_block,
        })}\n\n`);
        currentBlockType = type;
      };

      // Helper: end current content block
      const stopBlock = () => {
        if (currentBlockType !== null) {
          reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: blockIndex,
          })}\n\n`);
          blockIndex++;
          currentBlockType = null;
        }
      };

      // Helper: emit a tool_use content block (complete)
      const emitAnthropicToolUse = (toolCall: { id: string; name: string; arguments: string }) => {
        let parsedInput: any = {};
        try {
          if (toolCall.arguments) parsedInput = JSON.parse(toolCall.arguments);
        } catch {
          parsedInput = {};
        }

        // Unwrap "value" wrapper (same as /chat)
        if (parsedInput && typeof parsedInput === 'object' && parsedInput.value && typeof parsedInput.value === 'object') {
          if (Object.keys(parsedInput).length === 1) parsedInput = parsedInput.value;
        }

        // End any current text/thinking block first
        stopBlock();

        // Start tool_use block
        reply.raw.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'tool_use', id: toolCall.id, name: toolCall.name, input: {} },
        })}\n\n`);

        // Send the input as a single delta
        const inputJson = JSON.stringify(parsedInput);
        if (inputJson && inputJson !== '{}') {
          reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: blockIndex,
            delta: { type: 'input_json_delta', partial_json: inputJson },
          })}\n\n`);
        }

        // Stop the tool_use block
        reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: blockIndex,
        })}\n\n`);
        blockIndex++;
      };

      try {
        const stream = await providerManager.createCompletion(completionRequest, providerName) as AsyncGenerator<any>;

        for await (const chunk of stream) {
          // --- OpenAI-style format from providers ---
          if (chunk.choices && chunk.choices[0]) {
            const choice = chunk.choices[0];
            const delta = choice.delta || {};

            // Thinking content
            if (delta.thinking || delta.reasoning) {
              const thinkingContent = delta.thinking || delta.reasoning;
              if (currentBlockType !== 'thinking') {
                stopBlock();
                startBlock('thinking', { thinking: '' });
              }
              reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'thinking_delta', thinking: thinkingContent },
              })}\n\n`);
            }

            // Text content
            if (delta.content) {
              if (currentBlockType !== 'text') {
                stopBlock();
                startBlock('text', { text: '' });
              }
              reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'text_delta', text: delta.content },
              })}\n\n`);
            }

            // Tool calls - accumulate deltas
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              for (const tc of delta.tool_calls) {
                const index = tc.index ?? 0;
                const existing = pendingToolCalls.get(index);
                if (tc.id) {
                  pendingToolCalls.set(index, {
                    id: tc.id,
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  });
                } else if (existing) {
                  if (tc.function?.name) existing.name += tc.function.name;
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                }
              }
            }

            // Finish reason
            if (choice.finish_reason) {
              stopBlock();
              // Emit all pending tool calls
              for (const [, toolCall] of pendingToolCalls) {
                if (toolCall.id && toolCall.name) emitAnthropicToolUse(toolCall);
              }
              pendingToolCalls.clear();

              // Map finish reason to Anthropic stop_reason
              const stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use'
                : choice.finish_reason === 'length' ? 'max_tokens'
                : 'end_turn';

              reply.raw.write(`event: message_delta\ndata: ${JSON.stringify({
                type: 'message_delta',
                delta: { stop_reason: stopReason, stop_sequence: null },
                usage: { output_tokens: outputTokens },
              })}\n\n`);

              reply.raw.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
            }
          }
          // --- Anthropic native format (content_block_* events) ---
          // Pass through directly since they're already in the right format
          else if (chunk.type === 'content_block_delta') {
            const delta = chunk.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              if (currentBlockType !== 'text') {
                stopBlock();
                startBlock('text', { text: '' });
              }
              reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'text_delta', text: delta.text },
              })}\n\n`);
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              if (currentBlockType !== 'thinking') {
                stopBlock();
                startBlock('thinking', { thinking: '' });
              }
              reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'thinking_delta', thinking: delta.thinking },
              })}\n\n`);
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              // Tool input streaming
              const tcIndex = chunk.index ?? 0;
              const existing = pendingToolCalls.get(tcIndex);
              if (existing) existing.arguments += delta.partial_json;
            }
          }
          else if (chunk.type === 'content_block_start') {
            const block = chunk.content_block;
            if (block?.type === 'tool_use') {
              const tcIndex = chunk.index ?? 0;
              pendingToolCalls.set(tcIndex, { id: block.id, name: block.name, arguments: '' });
            } else if (block?.type === 'text') {
              stopBlock();
              startBlock('text', { text: '' });
            } else if (block?.type === 'thinking') {
              stopBlock();
              startBlock('thinking', { thinking: '' });
            }
          }
          else if (chunk.type === 'content_block_stop') {
            const tcIndex = chunk.index ?? 0;
            const toolCall = pendingToolCalls.get(tcIndex);
            if (toolCall?.id && toolCall?.name) {
              emitAnthropicToolUse(toolCall);
              pendingToolCalls.delete(tcIndex);
            } else {
              stopBlock();
            }
          }
          else if (chunk.type === 'message_delta') {
            stopBlock();
            // Emit remaining tool calls
            for (const [, tc] of pendingToolCalls) {
              if (tc.id && tc.name) emitAnthropicToolUse(tc);
            }
            pendingToolCalls.clear();

            const stopReason = chunk.delta?.stop_reason || 'end_turn';
            reply.raw.write(`event: message_delta\ndata: ${JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: { output_tokens: chunk.usage?.output_tokens || outputTokens },
            })}\n\n`);

            reply.raw.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
          }
          // Simple format fallback
          else if (chunk.type === 'content') {
            if (currentBlockType !== 'text') {
              stopBlock();
              startBlock('text', { text: '' });
            }
            reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'text_delta', text: chunk.content },
            })}\n\n`);
          } else if (chunk.type === 'thinking') {
            if (currentBlockType !== 'thinking') {
              stopBlock();
              startBlock('thinking', { thinking: '' });
            }
            reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'thinking_delta', thinking: chunk.content },
            })}\n\n`);
          } else if (chunk.type === 'tool_call') {
            emitAnthropicToolUse({
              id: chunk.toolCall?.id || `toolu_${Date.now()}`,
              name: chunk.toolCall?.name || '',
              arguments: typeof chunk.toolCall?.arguments === 'string'
                ? chunk.toolCall.arguments
                : JSON.stringify(chunk.toolCall?.arguments || {}),
            });
          } else if (chunk.type === 'done' || chunk.type === 'error') {
            stopBlock();
            for (const [, tc] of pendingToolCalls) {
              if (tc.id && tc.name) emitAnthropicToolUse(tc);
            }
            pendingToolCalls.clear();

            if (chunk.type === 'error') {
              // Send error as text block
              startBlock('text', { text: '' });
              reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'text_delta', text: `Error: ${chunk.error}` },
              })}\n\n`);
              stopBlock();
            }

            const stopReason = chunk.finishReason === 'tool_calls' ? 'tool_use'
              : chunk.finishReason === 'length' ? 'max_tokens'
              : 'end_turn';

            reply.raw.write(`event: message_delta\ndata: ${JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: { output_tokens: outputTokens },
            })}\n\n`);

            reply.raw.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
          }
        }

        // Emit any remaining pending tool calls at stream end
        stopBlock();
        for (const [, toolCall] of pendingToolCalls) {
          if (toolCall.id && toolCall.name) emitAnthropicToolUse(toolCall);
        }

        // Ensure we always send message_delta + message_stop at the end
        // (Some providers may not emit a done/finish_reason event)
        if (!reply.raw.writableEnded) {
          // Check if message_stop was already sent by looking at last write
          // Simple approach: always ensure the stream terminates properly
          reply.raw.end();
        }

        loggers.routes.info({ userId, model: effectiveModel }, '[Openagentic] /v1/messages completed');

      } catch (error: any) {
        loggers.routes.error({ error, userId }, '[Openagentic] /v1/messages error');
        stopBlock();

        // Send error in Anthropic format
        reply.raw.write(`event: error\ndata: ${JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: error.message || 'Internal error' },
        })}\n\n`);

        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    },
  });
  ORPHAN_BLOCK_END */

  /**
   * GET /api/openagentic/status
   * Detailed OpenAgentic service status
   * UAT Requirement: UC-032, UC-033
   */
  fastify.get('/status', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const codeManagerUrl = process.env.EXEC_URL || 'http://openagentic-exec:3060';
      
      // Check code manager health
      let managerStatus = 'unknown';
      let managerVersion = 'unknown';
      let activeSlices = 0;
      
      try {
        // SECURITY: Include internal API key for code-manager authentication
        const fetchOptions: RequestInit = {
          signal: AbortSignal.timeout(5000),
          headers: CODE_MANAGER_INTERNAL_KEY ? { 'X-Internal-API-Key': CODE_MANAGER_INTERNAL_KEY } : {},
        };
        const healthResponse = await fetch(`${codeManagerUrl}/health`, fetchOptions);
        if (healthResponse.ok) {
          const healthData = await healthResponse.json();
          managerStatus = healthData.status || 'healthy';
          managerVersion = healthData.version || 'unknown';
          activeSlices = healthData.activeSlices || 0;
        } else {
          managerStatus = 'unhealthy';
        }
      } catch (error: any) {
        managerStatus = 'unreachable';
        loggers.routes.warn({ error: error.message }, 'Code manager health check failed');
      }

      // Get provider availability
      const providers = {
        ollama: !!process.env.OLLAMA_HOST || !!process.env.OLLAMA_URL,
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        azure: !!process.env.AZURE_API_KEY,
        google: !!process.env.GOOGLE_API_KEY,
      };

      return reply.send({
        status: managerStatus === 'healthy' || managerStatus === 'unknown' ? 'operational' : 'degraded',
        manager: {
          status: managerStatus,
          version: managerVersion,
          url: codeManagerUrl,
          activeSlices,
        },
        providers,
        features: {
          codeExecution: managerStatus === 'healthy',
          terminalAccess: managerStatus === 'healthy',
          fileSystem: managerStatus === 'healthy',
          gitIntegration: managerStatus === 'healthy',
        },
        mcpProxy: {
          url: process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080',
          enabled: true,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get openagentic status');
      return reply.status(500).send({ 
        error: 'Failed to get status',
        message: error.message 
      });
    }
  });

  /**
   * GET /api/openagentic/sessions
   * List user's OpenAgentic sessions
   * UAT Requirement: UC-032
   */
  fastify.get('/sessions', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      // Get user's code sessions from database
      const sessions = await prisma.codeSession.findMany({
        where: {
          user_id: userId,
          status: { not: 'deleted' }
        },
        orderBy: { updated_at: 'desc' },
        take: 50,
        select: {
          id: true,
          slice_id: true,
          container_id: true,
          status: true,
          model: true,
          workspace_path: true,
          created_at: true,
          updated_at: true,
        }
      });

      const formattedSessions = sessions.map(session => ({
        id: session.id,
        sliceId: session.slice_id,
        containerId: session.container_id,
        status: session.status,
        model: session.model,
        workspacePath: session.workspace_path,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      }));

      return reply.send({
        sessions: formattedSessions,
        total: formattedSessions.length,
        userId,
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get openagentic sessions');
      return reply.status(500).send({
        error: 'Failed to get sessions',
        message: error.message
      });
    }
  });

  /**
   * POST /api/openagentic/sessions
   * Create a new OpenAgentic session
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.post<{
    Body: {
      model?: string;
      workspacePath?: string;
    }
  }>('/sessions', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      const { model, workspacePath } = request.body;

      // Generate proper workspace path if not provided
      // Must match the path created by openagentic-manager's workspaceStorageService
      // Format: /workspaces/{userId} (or with sessionId for per-session isolation)
      const effectiveWorkspacePath = workspacePath || `/workspaces/${userId}`;

      // Get default model from configuration if not specified
      let sessionModel = model;
      if (!sessionModel) {
        try {
          const { ModelConfigurationService } = await import('../services/ModelConfigurationService.js');
          sessionModel = await ModelConfigurationService.getDefaultChatModel();
        } catch (configError) {
          // Fall back to environment variable only - no hardcoded models
          sessionModel = process.env.DEFAULT_MODEL;
        }
      }

      loggers.routes.info({ userId, model: sessionModel, workspacePath: effectiveWorkspacePath }, '[Openagentic] Creating new session');

      const session = await prisma.codeSession.create({
        data: {
          user_id: userId,
          model: sessionModel,
          workspace_path: effectiveWorkspacePath,
          status: 'active',
        },
      });

      return reply.status(201).send({
        session: {
          id: session.id,
          sliceId: session.slice_id,
          containerId: session.container_id,
          status: session.status,
          model: session.model,
          workspacePath: session.workspace_path,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        },
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to create openagentic session');
      return reply.status(500).send({
        error: 'Failed to create session',
        message: error.message
      });
    }
  });

  /**
   * PUT /api/openagentic/sessions/:id
   * Update an existing OpenAgentic session
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      model?: string;
      workspacePath?: string;
      status?: string;
    }
  }>('/sessions/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;
      const sessionId = request.params.id;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      // Verify session belongs to user
      const existingSession = await prisma.codeSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
        },
      });

      if (!existingSession) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const { model, workspacePath, status } = request.body;

      loggers.routes.info({ userId, sessionId, model, workspacePath, status }, '[Openagentic] Updating session');

      const session = await prisma.codeSession.update({
        where: { id: sessionId },
        data: {
          ...(model && { model }),
          ...(workspacePath && { workspace_path: workspacePath }),
          ...(status && { status }),
          last_activity: new Date(),
        },
      });

      return reply.send({
        session: {
          id: session.id,
          sliceId: session.slice_id,
          containerId: session.container_id,
          status: session.status,
          model: session.model,
          workspacePath: session.workspace_path,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        },
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to update openagentic session');
      return reply.status(500).send({
        error: 'Failed to update session',
        message: error.message
      });
    }
  });

  /**
   * DELETE /api/openagentic/sessions/:id
   * Delete an OpenAgentic session (soft delete)
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.delete<{
    Params: { id: string }
  }>('/sessions/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;
      const sessionId = request.params.id;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      // Verify session belongs to user
      const existingSession = await prisma.codeSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
        },
      });

      if (!existingSession) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      loggers.routes.info({ userId, sessionId }, '[Openagentic] Deleting session');

      // Soft delete - set status to 'deleted'
      await prisma.codeSession.update({
        where: { id: sessionId },
        data: {
          status: 'deleted',
        },
      });

      return reply.send({ success: true, message: 'Session deleted' });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to delete openagentic session');
      return reply.status(500).send({
        error: 'Failed to delete session',
        message: error.message
      });
    }
  });

  // ==========================================================================
  // Session Messages & Context Window Routes
  // Provides message persistence and context window management for code mode
  // ==========================================================================

  /**
   * GET /api/openagentic/sessions/:id/messages
   * Get messages for a session (supports context windowing)
   * UAT Requirement: UC-032 Session Context
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { limit?: string; forLLM?: string };
  }>('/sessions/:id/messages', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;
      const limit = parseInt(request.query.limit || '100');
      const forLLM = request.query.forLLM === 'true';

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      loggers.routes.info({ userId, sessionId, limit, forLLM }, '[Openagentic] Getting session messages');

      if (codeModeSessionService) {
        const messages = await codeModeSessionService.getSessionMessages(sessionId, {
          limit,
          forLLM,
        });

        return reply.send({
          messages,
          count: messages.length,
          sessionId,
        });
      } else {
        // Fallback: use AWCodeStorageService directly
        const messages = await awcodeStorageService.getSessionMessages(sessionId, limit);
        return reply.send({
          messages: messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolCalls: m.tool_calls,
            thinking: m.thinking,
            tokensInput: m.tokens_input,
            tokensOutput: m.tokens_output,
            createdAt: m.created_at,
          })),
          count: messages.length,
          sessionId,
        });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get session messages');
      return reply.status(500).send({
        error: 'Failed to get messages',
        message: error.message
      });
    }
  });

  /**
   * POST /api/openagentic/sessions/:id/messages
   * Add a message to a session
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.post<{
    Params: { id: string };
    Body: {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string | any[];
      toolCalls?: any[];
      toolCallId?: string;
      thinking?: string;
      tokensInput?: number;
      tokensOutput?: number;
      metadata?: Record<string, any>;
    };
  }>('/sessions/:id/messages', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      const { role, content, toolCalls, toolCallId, thinking, tokensInput, tokensOutput, metadata } = request.body;

      loggers.routes.info({ userId, sessionId, role }, '[Openagentic] Adding message to session');

      if (codeModeSessionService) {
        const message = await codeModeSessionService.addMessage(sessionId, {
          role,
          content,
          toolCalls,
          toolCallId,
          thinking,
          tokensInput,
          tokensOutput,
          metadata,
        });

        return reply.status(201).send({ message });
      } else {
        // Fallback: use AWCodeStorageService directly
        const message = await awcodeStorageService.addMessage({
          sessionId,
          role,
          content: typeof content === 'string' ? content : JSON.stringify(content),
          toolCalls,
          thinking,
          tokensInput,
          tokensOutput,
          metadata,
        });
        return reply.status(201).send({ message });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to add message');
      return reply.status(500).send({
        error: 'Failed to add message',
        message: error.message
      });
    }
  });

  /**
   * GET /api/openagentic/sessions/:id/resume
   * Resume a session with context window
   * Returns session info and context-windowed messages for continuation
   * UAT Requirement: UC-032 Session Resumption
   */
  fastify.get<{
    Params: { id: string };
  }>('/sessions/:id/resume', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      loggers.routes.info({ userId, sessionId }, '[Openagentic] Resuming session');

      if (codeModeSessionService) {
        const result = await codeModeSessionService.resumeSession(sessionId, userId);

        if (!result) {
          return reply.status(404).send({ error: 'Session not found or access denied' });
        }

        return reply.send({
          session: result.session,
          contextWindow: {
            messages: result.contextWindow.messages,
            totalTokens: result.contextWindow.totalTokens,
            isCompacted: result.contextWindow.isCompacted,
            summaryIncluded: result.contextWindow.summaryIncluded,
          },
        });
      } else {
        // Fallback: get session and messages directly
        const session = await awcodeStorageService.getSession(sessionId);
        if (!session || session.user_id !== userId) {
          return reply.status(404).send({ error: 'Session not found or access denied' });
        }

        const messages = await awcodeStorageService.getSessionMessages(sessionId, 100);

        return reply.send({
          session: {
            id: session.id,
            userId: session.user_id,
            model: session.model,
            workspacePath: session.workspace_path,
            title: session.title,
            status: session.status,
            messageCount: session.message_count,
            totalTokens: session.total_tokens,
            createdAt: session.started_at,
            lastActivity: session.last_activity,
          },
          contextWindow: {
            messages: messages.map(m => ({
              id: m.id,
              role: m.role,
              content: m.content,
              toolCalls: m.tool_calls,
              thinking: m.thinking,
              createdAt: m.created_at,
            })),
            totalTokens: session.total_tokens || 0,
            isCompacted: false,
            summaryIncluded: false,
          },
        });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to resume session');
      return reply.status(500).send({
        error: 'Failed to resume session',
        message: error.message
      });
    }
  });

  /**
   * POST /api/openagentic/sessions/:id/compact
   * Manually trigger context compaction for a session
   * UAT Requirement: UC-032 Context Management
   */
  fastify.post<{
    Params: { id: string };
  }>('/sessions/:id/compact', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      loggers.routes.info({ userId, sessionId }, '[Openagentic] Compacting session context');

      if (codeModeSessionService) {
        const session = await codeModeSessionService.getSession(sessionId, userId);
        if (!session) {
          return reply.status(404).send({ error: 'Session not found or access denied' });
        }

        // Force context window computation which may trigger compaction
        const contextWindow = await codeModeSessionService.getContextWindow(sessionId, session.model);

        return reply.send({
          success: true,
          isCompacted: contextWindow.isCompacted,
          totalTokens: contextWindow.totalTokens,
          messageCount: contextWindow.messages.length,
        });
      } else {
        return reply.status(501).send({ error: 'Context compaction requires CodeModeSessionService' });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to compact session');
      return reply.status(500).send({
        error: 'Failed to compact session',
        message: error.message
      });
    }
  });

  /**
   * GET /api/openagentic/sessions/persisted
   * Get all persisted sessions for a user (from AWCodeSession table)
   * These are sessions with full message history
   * UAT Requirement: UC-032 Session History
   */
  fastify.get('/sessions/persisted', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      loggers.routes.info({ userId }, '[Openagentic] Getting persisted sessions');

      if (codeModeSessionService) {
        const sessions = await codeModeSessionService.getUserSessions(userId, 50);
        return reply.send({
          sessions,
          total: sessions.length,
        });
      } else {
        const sessions = await awcodeStorageService.getUserSessions(userId, 50);
        return reply.send({
          sessions: sessions.map(s => ({
            id: s.id,
            userId: s.user_id,
            model: s.model,
            workspacePath: s.workspace_path,
            title: s.title,
            status: s.status,
            messageCount: s.message_count || s._count?.messages || 0,
            totalTokens: s.total_tokens || 0,
            createdAt: s.started_at || s.created_at,
            lastActivity: s.last_activity,
          })),
          total: sessions.length,
        });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get persisted sessions');
      return reply.status(500).send({
        error: 'Failed to get sessions',
        message: error.message
      });
    }
  });

  /**
   * POST /api/openagentic/sessions/persisted
   * Create a new persisted session (with AWCodeSession storage)
   * UAT Requirement: UC-032 Session Persistence
   */
  fastify.post<{
    Body: {
      model?: string;
      workspacePath?: string;
      title?: string;
      metadata?: Record<string, any>;
    };
  }>('/sessions/persisted', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized - no user ID' });
      }

      const { model, workspacePath, title, metadata } = request.body;

      loggers.routes.info({ userId, model, workspacePath, title }, '[Openagentic] Creating persisted session');

      if (codeModeSessionService) {
        const session = await codeModeSessionService.createSession(userId, {
          model,
          workspacePath,
          title,
          metadata,
        });

        return reply.status(201).send({ session });
      } else {
        // Fallback: use AWCodeStorageService directly
        const { v4: uuidv4 } = await import('uuid');
        const sessionId = uuidv4();
        const session = await awcodeStorageService.createSession({
          id: sessionId,
          userId,
          workspacePath,
          model,
          title,
          metadata,
          status: 'running',
        });

        return reply.status(201).send({
          session: {
            id: session.id,
            userId: session.user_id,
            model: session.model,
            workspacePath: session.workspace_path,
            title: session.title,
            status: session.status,
            messageCount: 0,
            totalTokens: 0,
            createdAt: session.started_at || session.created_at,
            lastActivity: session.last_activity,
          },
        });
      }
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to create persisted session');
      return reply.status(500).send({
        error: 'Failed to create session',
        message: error.message
      });
    }
  });

  // ==========================================================================
  // Code-Server Routes (VS Code integration)
  // Proxies to openagentic-manager for per-session VS Code instances
  // ==========================================================================

  const OPENAGENTIC_MANAGER_URL = process.env.OPENAGENTIC_MANAGER_URL || 'http://openagentic-exec:3060';
  // Use CODE_MANAGER_INTERNAL_KEY from docker-compose, fallback to INTERNAL_API_KEY for compatibility
  const INTERNAL_API_KEY = process.env.CODE_MANAGER_INTERNAL_KEY || process.env.INTERNAL_API_KEY || '';

  /**
   * GET /api/openagentic/sessions/:id/code-server
   * Get code-server status for a session
   */
  fastify.get<{
    Params: { id: string }
  }>('/sessions/:id/code-server', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      loggers.routes.info({ userId, sessionId }, '[Openagentic] Getting code-server status');

      const response = await fetch(`${OPENAGENTIC_MANAGER_URL}/sessions/${sessionId}/code-server`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': INTERNAL_API_KEY,
        },
      });

      const data = await response.json();
      return reply.status(response.status).send(data);
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get code-server status');
      return reply.status(500).send({
        error: 'Failed to get code-server status',
        message: error.message
      });
    }
  });

  /**
   * POST /api/openagentic/sessions/:id/code-server
   * Start code-server for a session
   */
  fastify.post<{
    Params: { id: string }
  }>('/sessions/:id/code-server', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      loggers.routes.info({ userId, sessionId }, '[Openagentic] Starting code-server');

      const response = await fetch(`${OPENAGENTIC_MANAGER_URL}/sessions/${sessionId}/code-server`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': INTERNAL_API_KEY,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();
      return reply.status(response.status).send(data);
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to start code-server');
      return reply.status(500).send({
        error: 'Failed to start code-server',
        message: error.message
      });
    }
  });

  /**
   * DELETE /api/openagentic/sessions/:id/code-server
   * Stop code-server for a session
   */
  fastify.delete<{
    Params: { id: string }
  }>('/sessions/:id/code-server', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      const sessionId = request.params.id;
      const userId = (request.user as any)?.id || (request.user as any)?.userId;

      loggers.routes.info({ userId, sessionId }, '[Openagentic] Stopping code-server');

      const response = await fetch(`${OPENAGENTIC_MANAGER_URL}/sessions/${sessionId}/code-server`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': INTERNAL_API_KEY,
        },
      });

      const data = await response.json();
      return reply.status(response.status).send(data);
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to stop code-server');
      return reply.status(500).send({
        error: 'Failed to stop code-server',
        message: error.message
      });
    }
  });

  // ==========================================================================
  // Anthropic-Compatible API (for Claude Code CLI)
  // Provides /v1/messages endpoint matching Anthropic's Messages API format
  // This allows Claude Code to connect using ANTHROPIC_BASE_URL
  // ==========================================================================

  /**
   * POST /api/openagentic/v1/messages
   * Anthropic-compatible Messages API endpoint for Claude Code CLI
   *
   * Usage:
   *   ANTHROPIC_AUTH_TOKEN=<api_key> \
   *   ANTHROPIC_BASE_URL=https://chat-dev.openagentics.io/api/openagentic \
   *   claude --model claude-sonnet-4-20250514
   */
  fastify.post<{
    Body: {
      model: string;
      max_tokens: number;
      messages: Array<{
        role: 'user' | 'assistant';
        content: string | Array<{ type: string; text?: string; [key: string]: any }>;
      }>;
      system?: string | Array<{ type: string; text: string }>;
      tools?: Array<{
        name: string;
        description: string;
        input_schema: Record<string, any>;
      }>;
      tool_choice?: { type: string; name?: string };
      stream?: boolean;
      temperature?: number;
      top_p?: number;
      top_k?: number;
      stop_sequences?: string[];
      metadata?: Record<string, any>;
      thinking?: { type: string; budget_tokens?: number };
    };
  }>('/v1/messages', {
    preHandler: async (request, reply) => {
      // Support both Bearer token and x-api-key header (Anthropic uses x-api-key)
      const authHeader = request.headers['authorization'];
      const xApiKey = request.headers['x-api-key'];

      if (xApiKey && !authHeader) {
        // Convert x-api-key to Authorization header for authMiddleware
        request.headers['authorization'] = `Bearer ${xApiKey}`;
      }

      return authMiddleware(request, reply);
    },
    handler: async (request, reply): Promise<void> => {
      const userId = (request.user as any)?.id;

      if (!userId) {
        reply.code(401).send({
          type: 'error',
          error: { type: 'authentication_error', message: 'Unauthorized - no user ID' }
        });
        return;
      }

      let {
        model,
        max_tokens,
        messages,
        system,
        tools,
        tool_choice,
        stream = false,
        temperature,
        top_p,
        thinking
      } = request.body;

      // Strip thinking blocks with empty/missing signatures from message history.
      // The Anthropic API validates thinking signatures cryptographically.
      // When proxying through Bedrock, signatures are not returned in streaming mode.
      // Without valid signatures, multi-turn conversations with thinking fail.
      // Stripping thinking blocks is safe — the model doesn't need its own
      // previous thinking to continue the conversation.
      if (messages && Array.isArray(messages)) {
        messages = messages.map((m: any) => {
          if (m.role === 'assistant' && Array.isArray(m.content)) {
            const filtered = m.content.filter((block: any) => {
              // Keep thinking blocks only if they have a non-empty, valid-looking signature
              if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                return block.signature && block.signature.length > 10;
              }
              return true;
            });
            // Ensure at least one content block remains (API requires non-empty content)
            if (filtered.length === 0) {
              filtered.push({ type: 'text', text: '' });
            }
            return { ...m, content: filtered };
          }
          return m;
        });
      }

      loggers.routes.info({
        userId,
        model,
        messageCount: messages?.length,
        hasTools: !!tools?.length,
        hasThinking: !!thinking,
        stream,
      }, '[Openagentic/v1/messages] Anthropic-compatible request received');

      if (!providerManager) {
        reply.code(503).send({
          type: 'error',
          error: { type: 'api_error', message: 'LLM providers not available' }
        });
        return;
      }

      // Determine effective model - use platform default if not specified or not supported
      let effectiveModel = model;
      const modelProvider = effectiveModel ? providerManager.getProviderForModel(effectiveModel) : null;

      if (!modelProvider) {
        // Try to get default model
        try {
          effectiveModel = await ModelConfigurationService.getDefaultChatModel();
          loggers.routes.info({ requestedModel: model, effectiveModel }, '[Openagentic/v1/messages] Using platform default model');
        } catch (err) {
          loggers.routes.warn({ err, model }, '[Openagentic/v1/messages] Failed to get default model');
        }
      }

      // Capability gate: Claude Code CLI always sends tools (Read, Write, Bash, etc.)
      // If the selected model can't handle tools, upgrade to one that can.
      // This prevents Ollama models like gemma3 from getting tool requests they can't handle.
      if (effectiveModel) {
        try {
          const userMessage = messages?.find((m: any) => m.role === 'user');
          const userText = typeof userMessage?.content === 'string'
            ? userMessage.content
            : Array.isArray(userMessage?.content)
              ? userMessage.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
              : '';

          // SKIP capability gate for openagentic — the admin/user explicitly chose the model.
          // The gate was upgrading gpt-oss/qwen3.5 to nomic-embed-text (embedding model) → 400 errors.
          // Code mode model selection is handled by: Redis override → admin DB → platform default.
          loggers.routes.debug({ model: effectiveModel, toolCount: tools?.length || 0 }, '[Openagentic/v1/messages] Capability gate SKIPPED — using admin/user-selected model');
        } catch (gateErr) {
          loggers.routes.warn({ err: gateErr, model: effectiveModel }, '[Openagentic/v1/messages] Capability gate error, proceeding with original model');
        }
      }

      const providerName = providerManager.getProviderForModel(effectiveModel);
      if (!providerName) {
        reply.code(400).send({
          type: 'error',
          error: { type: 'invalid_request_error', message: `No provider available for model: ${effectiveModel}` }
        });
        return;
      }

      // Convert Anthropic format to internal format
      // Build messages array with system prompt if provided
      const internalMessages: any[] = [];

      // Add system message if provided
      if (system) {
        const systemText = typeof system === 'string'
          ? system
          : system.map(s => s.text).join('\n');
        internalMessages.push({ role: 'system', content: systemText });
      }

      // Convert messages
      for (const msg of messages) {
        internalMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }

      // Convert tools to internal format
      const internalTools = tools?.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));

      // Build completion request
      const completionRequest: any = {
        model: effectiveModel,
        messages: internalMessages,
        tools: internalTools,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 8192,
        stream: stream,
        top_p,
      };

      // Add thinking configuration if provided
      if (thinking) {
        completionRequest.thinking = thinking;
      }

      // Generate unique message ID
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      if (stream) {
        // Set up SSE streaming with Anthropic format
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        try {
          const streamGen = await providerManager.createCompletion(completionRequest, providerName) as AsyncGenerator<any>;

          // Send message_start event
          const messageStart = {
            type: 'message_start',
            message: {
              id: messageId,
              type: 'message',
              role: 'assistant',
              content: [],
              model: effectiveModel,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          };
          reply.raw.write(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`);

          let contentBlockIndex = 0;
          let currentBlockType: string | null = null;
          let pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
          let inputTokens = 0;
          let outputTokens = 0;
          let v1AccumulatedChars = 0; // Track output size for token estimation

          for await (const chunk of streamGen) {
            // Capture token usage from any chunk format (same as /chat handler)
            if (chunk.usage?.input_tokens) inputTokens = chunk.usage.input_tokens;
            if (chunk.usage?.output_tokens) outputTokens = chunk.usage.output_tokens;
            if (chunk.message?.usage?.input_tokens) inputTokens = chunk.message.usage.input_tokens;
            if (chunk.usage?.prompt_tokens) inputTokens = chunk.usage.prompt_tokens;
            if (chunk.usage?.completion_tokens) outputTokens = chunk.usage.completion_tokens;

            // Handle different chunk formats from providers

            // OpenAI-style format (from Bedrock, etc.)
            if (chunk.choices && chunk.choices[0]) {
              const choice = chunk.choices[0];
              const delta = choice.delta || {};

              // Handle thinking/reasoning content
              if (delta.thinking || delta.reasoning) {
                const thinkingContent = delta.thinking || delta.reasoning;
                if (currentBlockType !== 'thinking') {
                  if (currentBlockType) {
                    reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex - 1 })}\n\n`);
                  }
                  reply.raw.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: contentBlockIndex, content_block: { type: 'thinking', thinking: '' } })}\n\n`);
                  currentBlockType = 'thinking';
                  contentBlockIndex++;
                }
                reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: contentBlockIndex - 1, delta: { type: 'thinking_delta', thinking: thinkingContent } })}\n\n`);
              }

              // Handle text content
              if (delta.content) {
                if (currentBlockType !== 'text') {
                  if (currentBlockType) {
                    reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex - 1 })}\n\n`);
                  }
                  reply.raw.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: contentBlockIndex, content_block: { type: 'text', text: '' } })}\n\n`);
                  currentBlockType = 'text';
                  contentBlockIndex++;
                }
                v1AccumulatedChars += delta.content.length;
                reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: contentBlockIndex - 1, delta: { type: 'text_delta', text: delta.content } })}\n\n`);
              }

              // Handle tool calls
              if (delta.tool_calls && delta.tool_calls.length > 0) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index ?? 0;
                  const existing = pendingToolCalls.get(index);

                  if (tc.id) {
                    // New tool call - emit content_block_start
                    pendingToolCalls.set(index, {
                      id: tc.id,
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    });
                    if (currentBlockType) {
                      reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex - 1 })}\n\n`);
                    }
                    reply.raw.write(`event: content_block_start\ndata: ${JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: { type: 'tool_use', id: tc.id, name: tc.function?.name || '', input: {} }
                    })}\n\n`);
                    currentBlockType = 'tool_use';
                    contentBlockIndex++;

                    // Ollama sends id AND arguments in the same chunk — emit
                    // input_json_delta immediately so the CLI gets tool args
                    if (tc.function?.arguments) {
                      const argsStr = typeof tc.function.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc.function.arguments);
                      reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                        type: 'content_block_delta',
                        index: contentBlockIndex - 1,
                        delta: { type: 'input_json_delta', partial_json: argsStr }
                      })}\n\n`);
                    }
                  } else if (existing) {
                    // Delta update to existing tool call
                    if (tc.function?.name) {
                      existing.name += tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      existing.arguments += tc.function.arguments;
                      reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                        type: 'content_block_delta',
                        index: contentBlockIndex - 1,
                        delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
                      })}\n\n`);
                    }
                  }
                }
              }

              // Handle finish
              if (choice.finish_reason) {
                if (currentBlockType) {
                  reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: contentBlockIndex - 1 })}\n\n`);
                }

                // Map finish_reason to Anthropic format
                let stopReason = 'end_turn';
                if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
                else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
                else if (choice.finish_reason === 'stop') stopReason = 'end_turn';

                reply.raw.write(`event: message_delta\ndata: ${JSON.stringify({
                  type: 'message_delta',
                  delta: { stop_reason: stopReason, stop_sequence: null },
                  usage: { output_tokens: outputTokens }
                })}\n\n`);
              }
            }
            // Anthropic native format - pass through with normalization
            else if (chunk.type) {
              // Ensure content_block_start has required empty fields (Anthropic SDK format)
              if (chunk.type === 'content_block_start' && chunk.content_block) {
                if (chunk.content_block.type === 'text' && !('text' in chunk.content_block)) chunk.content_block.text = '';
                if (chunk.content_block.type === 'thinking' && !('thinking' in chunk.content_block)) chunk.content_block.thinking = '';
              }
              reply.raw.write(`event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`);
            }
          }

          // Emit message_delta with stop_reason if not already sent by OpenAI-format path
          // OllamaProvider emits Anthropic-format blocks directly, so the finish_reason
          // handler above (which checks choice.finish_reason) never fires.
          // The stop_reason is 'tool_use' if any tool_use blocks were streamed, else 'end_turn'.
          const hasToolUseBlocks = pendingToolCalls.size > 0;
          const inferredStopReason = hasToolUseBlocks ? 'tool_use' : 'end_turn';
          reply.raw.write(`event: message_delta\ndata: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: inferredStopReason, stop_sequence: null },
            usage: { output_tokens: outputTokens || Math.ceil(v1AccumulatedChars / 4) }
          })}\n\n`);

          // Send message_stop
          reply.raw.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
          reply.raw.end();

          // Fallback token estimation for v1/messages streaming
          // Bedrock streams don't include usage in chunks — estimate from content length (~4 chars/token)
          if (inputTokens === 0 && (request.body as any).messages?.length) {
            inputTokens = Math.ceil(JSON.stringify((request.body as any).messages).length / 4);
          }
          if (outputTokens === 0 && v1AccumulatedChars > 0) {
            outputTokens = Math.ceil(v1AccumulatedChars / 4);
          }

          // Accumulate token usage per session in Redis (for context sidebar)
          const v1SessionId = (request.body as any).metadata?.session_id || userId;
          loggers.routes.info({ v1SessionId, inputTokens, outputTokens, model: effectiveModel }, '[Openagentic/v1/messages] Token accumulation');
          try {
            const { createClient } = await import('redis');
            const redisUrl = process.env.REDIS_URL || 'redis://openagentic-redis:6379';
            const redisClient = createClient({ url: redisUrl });
            await redisClient.connect();
            const redisKey = `code_session_stats:${v1SessionId}`;
            await redisClient.hIncrBy(redisKey, 'input_tokens', inputTokens || 0);
            await redisClient.hIncrBy(redisKey, 'output_tokens', outputTokens || 0);
            await redisClient.hIncrBy(redisKey, 'request_count', 1);
            await redisClient.hSet(redisKey, 'model', effectiveModel || '');
            await redisClient.hSet(redisKey, 'last_request', Date.now().toString());
            await redisClient.expire(redisKey, 86400);
            await redisClient.disconnect();
          } catch { /* non-fatal — stats are best-effort */ }

          loggers.routes.info({ userId, model: effectiveModel, messageId }, '[Openagentic/v1/messages] Stream completed');
        } catch (error: any) {
          loggers.routes.error({ error, userId }, '[Openagentic/v1/messages] Stream error');
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: error.message } })}\n\n`);
          reply.raw.end();
        }
      } else {
        // Non-streaming response
        try {
          const response = await providerManager.createCompletion(completionRequest, providerName) as any;

          // Convert to Anthropic format
          const content: any[] = [];
          const message = response.choices?.[0]?.message;
          // Include thinking/reasoning content if present
          if (message?.thinking || message?.reasoning) {
            content.push({ type: 'thinking', thinking: message.thinking || message.reasoning });
          }
          if (message?.content) {
            content.push({ type: 'text', text: message.content });
          }
          if (message?.tool_calls) {
            for (const tc of message.tool_calls) {
              content.push({
                type: 'tool_use',
                id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
                name: tc.function.name,
                input: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}),
              });
            }
          }

          let stopReason = 'end_turn';
          const finishReason = response.choices?.[0]?.finish_reason;
          if (finishReason === 'tool_calls') stopReason = 'tool_use';
          else if (finishReason === 'length') stopReason = 'max_tokens';

          const anthropicResponse = {
            id: messageId,
            type: 'message',
            role: 'assistant',
            content,
            model: effectiveModel,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
              input_tokens: response.usage?.prompt_tokens || 0,
              output_tokens: response.usage?.completion_tokens || 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };

          // Accumulate token usage per session in Redis (for context sidebar)
          const v1NonStreamSessionId = (request.body as any).metadata?.session_id || userId;
          try {
            const { createClient } = await import('redis');
            const redisUrl = process.env.REDIS_URL || 'redis://openagentic-redis:6379';
            const redisClient = createClient({ url: redisUrl });
            await redisClient.connect();
            const redisKey = `code_session_stats:${v1NonStreamSessionId}`;
            await redisClient.hIncrBy(redisKey, 'input_tokens', anthropicResponse.usage.input_tokens);
            await redisClient.hIncrBy(redisKey, 'output_tokens', anthropicResponse.usage.output_tokens);
            await redisClient.hIncrBy(redisKey, 'request_count', 1);
            await redisClient.hSet(redisKey, 'model', effectiveModel || '');
            await redisClient.hSet(redisKey, 'last_request', Date.now().toString());
            await redisClient.expire(redisKey, 86400);
            await redisClient.disconnect();
          } catch { /* non-fatal — stats are best-effort */ }

          return reply.send(anthropicResponse);
        } catch (error: any) {
          loggers.routes.error({ error, userId }, '[Openagentic/v1/messages] Non-streaming error');
          return reply.code(500).send({
            type: 'error',
            error: { type: 'api_error', message: error.message },
          });
        }
      }
    },
  });

  /**
   * GET /api/openagentic/session-stats/:sessionId
   * Returns accumulated token usage for a code session (used by context sidebar)
   */
  fastify.get<{ Params: { sessionId: string } }>('/session-stats/:sessionId', {
    // No auth — internal endpoint called by code manager (service-to-service)
  }, async (request, reply) => {
    const { sessionId } = request.params;
    try {
      const { createClient } = await import('redis');
      const redisUrl = process.env.REDIS_URL || 'redis://openagentic-redis:6379';
      const redisClient = createClient({ url: redisUrl });
      await redisClient.connect();
      const stats = await redisClient.hGetAll(`code_session_stats:${sessionId}`);
      await redisClient.disconnect();
      return reply.send({
        inputTokens: parseInt(stats.input_tokens || '0'),
        outputTokens: parseInt(stats.output_tokens || '0'),
        requestCount: parseInt(stats.request_count || '0'),
        model: stats.model || '',
        lastRequest: parseInt(stats.last_request || '0'),
      });
    } catch {
      return reply.send({ inputTokens: 0, outputTokens: 0, requestCount: 0, model: '', lastRequest: 0 });
    }
  });

  /**
   * GET /api/openagentic/v1/models
   * List available models (Anthropic-compatible format)
   */
  fastify.get('/v1/models', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    try {
      if (!providerManager) {
        return reply.code(503).send({ error: 'Provider manager not available' });
      }

      const models = await providerManager.listModels();

      // Return in a format similar to Anthropic's model list
      return reply.send({
        data: models.map(m => ({
          id: m.id,
          name: m.name || m.id,
          provider: m.provider,
          created: Date.now(),
          object: 'model',
        })),
        object: 'list',
      });
    } catch (error: any) {
      loggers.routes.error({ error }, '[Openagentic/v1/models] Failed to list models');
      return reply.code(500).send({ error: error.message });
    }
  });
};

export default openagenticRoutes;
