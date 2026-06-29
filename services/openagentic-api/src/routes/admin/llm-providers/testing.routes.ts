/**
 * Admin LLM-provider testing / health / playground routes.
 *
 *   GET    /llm-providers/health
 *   GET    /llm-providers/metrics
 *   POST   /llm-providers/:name/test
 *   POST   /llm-providers/test-config
 *   POST   /llm-providers/playground
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import { Prisma } from '@prisma/client';
import { ProviderManager, invalidateAllModelCaches } from '../../../services/llm-providers/ProviderManager.js';
import { ProviderConfigService } from '../../../services/llm-providers/ProviderConfigService.js';
import { encryptAuthConfig, decryptAuthConfig } from '../../../services/llm-providers/CredentialEncryptionService.js';
import { AuditTrail, AuditEventType, AuditSeverity } from '../../../utils/auditTrail.js';
import { credentialAuditService } from '../../../services/CredentialAuditService.js';
import { OllamaProvider } from '../../../services/llm-providers/OllamaProvider.js';
import { AWSBedrockProvider } from '../../../services/llm-providers/AWSBedrockProvider.js';
import { AzureOpenAIProvider } from '../../../services/llm-providers/AzureOpenAIProvider.js';
import { GoogleVertexProvider } from '../../../services/llm-providers/GoogleVertexProvider.js';
import { AnthropicProvider } from '../../../services/llm-providers/AnthropicProvider.js';
import { OpenAIProvider } from '../../../services/llm-providers/OpenAIProvider.js';
import { AzureAIFoundryProvider } from '../../../services/llm-providers/AzureAIFoundryProvider.js';
import type { ProviderDefaultConfig } from '../../../services/llm-providers/ILLMProvider.js';
import type { ModelDiscoveryRecord } from '../../../services/llm-providers/discovery/ModelDiscoveryRecord.js';
import {
  upsertDiscoveredModels,
  type RegistryUpsertPrismaLike,
} from '../../../services/model-routing/RegistryUpsertService.js';
import { shouldAutoSyncRegistry } from '../../../services/model-routing/registryAutoSyncPolicy.js';
import { PricingService } from '../../../services/pricing/PricingService.js';
import {
  validateDiscriminator,
  isGenericName,
  buildAutoDisplayName,
} from '../../../services/llm-providers/ProviderDiscriminatorSchema.js';
import { asJson, asRecord } from './shared.js';
import type {
  ProviderRoutesOptions,
  ProviderConfigBag,
  AuthConfigBag,
  ModelConfigBag,
  ModelLike,
  ProviderRuntime,
  CompletionResultLike,
} from './types.js';

/**
 * Recognise embedding-only models so Test Connection doesn't try to run
 * a chat completion against them.
 *
 * Live regression (2026-05-01): user adds the in-cluster ollama-embedding
 * provider — it serves only `nomic-embed-text:latest`. Test Connection
 * picks `models[0]` and calls /api/chat → Ollama returns 400 "model does
 * not support generate." UX surfaces a misleading "400 Bad Request"
 * instead of "this is an embedding-only host."
 *
 * Detection signals (any one is sufficient):
 *   - name / id contains "embed" (case-insensitive)
 *   - family is one of the well-known embedding families (nomic-bert,
 *     mxbai, bge, e5, gte, jina-embed)
 *
 * Capability flags alone are insufficient: Ollama's tag listing returns
 * `capabilities: { chat: true, embeddings: true }` for nomic-embed-text
 * (the chat:true is wrong; the model genuinely doesn't support /api/chat).
 * The name/family heuristic is the load-bearing signal.
 */
export function isEmbeddingOnlyModel(model): boolean {
  if (!model || typeof model !== 'object') return false;
  const id = String(model.id ?? model.name ?? '').toLowerCase();
  if (!id) return false;
  if (id.includes('embed')) return true;
  const family = String(model.family ?? model.metadata?.family ?? '').toLowerCase();
  const EMBEDDING_FAMILIES = ['nomic-bert', 'mxbai', 'bge', 'e5', 'gte', 'jina-embed'];
  if (EMBEDDING_FAMILIES.some(f => family === f || family.startsWith(f))) return true;
  return false;
}


export const testingRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;
  const auditTrail = new AuditTrail();


  /**
   * GET /api/admin/llm-providers/health
   * Get health status for all providers
   */
  fastify.get('/llm-providers/health', async (request, reply) => {
    try {
      // Get health from ProviderManager (in-memory initialized providers)
      const healthStatus = providerManager ? await providerManager.getHealthStatus() : new Map();

      const results = Array.from(healthStatus.entries()).map(([name, health]) => ({
        provider: name,
        status: health.status,
        healthy: health.status === 'healthy',
        endpoint: health.endpoint,
        error: health.error,
        lastChecked: health.lastChecked
      }));

      // Also include DB providers not in the ProviderManager
      // This ensures providers with credentials configured show proper status
      try {
        const { prisma } = await import('../../../utils/prisma.js');
        const dbProviders = await prisma.lLMProvider.findMany({
          where: { deleted_at: null, enabled: true },
          select: { name: true, provider_type: true, auth_config: true, status: true, provider_config: true }
        });
  
        const knownNames = new Set(results.map(r => r.provider));
        for (const dbp of dbProviders) {
          if (!knownNames.has(dbp.name)) {
            // Provider is in DB but not initialized in ProviderManager
            // Use DB status field as primary indicator (set by test endpoint)
            const dbStatus = dbp.status as string;
            const provConfig = dbp.provider_config as ProviderConfigBag || {};
            const authConfig = dbp.auth_config as AuthConfigBag || {};
            const hasCredentials = !!(authConfig.apiKey || authConfig.key || authConfig.accessKeyId ||
              authConfig.clientId || authConfig.credentials || authConfig.serviceAccountKey ||
              authConfig.endpoint || dbp.provider_type === 'ollama' ||
              authConfig.type === 'service-account' || authConfig.serviceAccountPath);

            // DB status 'active' = healthy (set by successful test)
            const isHealthy = dbStatus === 'active' || (hasCredentials && dbStatus !== 'error');
            const statusLabel = dbStatus === 'active' ? 'healthy' :
                               dbStatus === 'error' ? 'unhealthy' :
                               hasCredentials ? 'healthy' : 'not_initialized';

            results.push({
              provider: dbp.name,
              status: statusLabel,
              healthy: isHealthy,
              endpoint: undefined,
              error: !hasCredentials ? 'Provider credentials not configured' :
                     dbStatus === 'error' ? 'Last test failed' : undefined,
              lastChecked: provConfig.lastTestAt || new Date().toISOString()
            });
          }
        }
      } catch (dbErr) {
        logger.warn({ error: dbErr }, 'Failed to augment health with DB providers');
      }

      const allHealthy = results.every(r => r.healthy);

      // The handler successfully assembled the report — that's a 200 even
      // when downstream providers are unhealthy. The `overall` field carries
      // degraded/healthy semantics in the body. 503 is reserved for the
      // catch-block (handler genuinely failed). Returning 503 on degraded
      // made the UI's `if (response.ok)` discard the body and lie "0 healthy"
      // even when 3/4 cards were green. (#367)
      return reply.code(200).send({
        overall: allHealthy ? 'healthy' : 'degraded',
        providers: results,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to check provider health');
      return reply.code(500).send({
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/metrics
   * Get performance metrics for all providers
   */
  fastify.get('/llm-providers/metrics', async (request, reply) => {
    try {
      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider metrics are not available'
        });
      }

      const metrics = providerManager.getMetrics();

      const results = Array.from(metrics.entries()).map(([name, metric]) => ({
        provider: name,
        requests: {
          total: metric.totalRequests,
          successful: metric.successfulRequests,
          failed: metric.failedRequests,
          successRate: metric.totalRequests > 0
            ? ((metric.successfulRequests / metric.totalRequests) * 100).toFixed(2)
            : '0.00'
        },
        performance: {
          averageLatency: Math.round(metric.averageLatency),
          uptime: metric.uptime.toFixed(2)
        },
        usage: {
          totalTokens: metric.totalTokens,
          estimatedCost: metric.totalCost.toFixed(4)
        },
        lastHealthCheck: metric.lastHealthCheck
      }));

      // Calculate aggregate metrics
      const aggregate = {
        totalRequests: results.reduce((sum, r) => sum + r.requests.total, 0),
        totalSuccessful: results.reduce((sum, r) => sum + r.requests.successful, 0),
        totalFailed: results.reduce((sum, r) => sum + r.requests.failed, 0),
        averageLatency: results.length > 0
          ? Math.round(results.reduce((sum, r) => sum + r.performance.averageLatency, 0) / results.length)
          : 0,
        totalTokens: results.reduce((sum, r) => sum + r.usage.totalTokens, 0),
        totalCost: results.reduce((sum, r) => sum + Number.parseFloat(r.usage.estimatedCost), 0).toFixed(4)
      };

      return reply.send({
        providers: results,
        aggregate,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get provider metrics');
      return reply.code(500).send({
        error: 'Failed to get metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/:name/test
   * Comprehensive test of provider capabilities
   */
  fastify.post<{
    Params: { name: string };
    Body: {
      testType?: 'basic' | 'streaming' | 'tools' | 'vision' | 'all';
      prompt?: string;
      imageUrl?: string;
      maxTokens?: number;
      model?: string;
    };
  }>('/llm-providers/:name/test', async (request, reply) => {
    try {
      const { name } = request.params;
      const {
        testType = 'basic',
        prompt = 'Say "Hello, World!" and nothing else.',
        imageUrl,
        maxTokens: userMaxTokens,
        model: userModel,
      } = request.body || {};

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider testing is not available'
        });
      }

      // Check if provider is loaded in memory; if not, try reload
      let providerInMemory = providerManager.hasProvider(name);
      if (!providerInMemory) {
        logger.info({ provider: name }, 'Provider not found in memory, reloading from database');
        await invalidateAllModelCaches(logger);
        providerInMemory = providerManager.hasProvider(name);
      }

      // If still not in memory, check DB directly — provider may have failed initialization
      // but admin should still be able to test connectivity
      let tempProvider: ProviderRuntime | null = null;
      let initError: string | null = null;
      if (!providerInMemory) {
        try {
          const { prisma } = await import('../../../utils/prisma.js');
          const dbRecord = await prisma.lLMProvider.findFirst({
            where: { name, deleted_at: null }
          });
    
          if (!dbRecord) {
            return reply.code(404).send({
              error: 'Provider not found',
              message: `Provider '${name}' does not exist in the database.`
            });
          }

          // Provider exists in DB but failed to initialize — try creating a temp instance
          logger.info({ provider: name, type: dbRecord.provider_type }, 'Provider exists in DB but not in memory. Creating temp instance for test...');
          const configService = new ProviderConfigService(logger);
          const providerConfig = configService.convertDatabaseProvider(dbRecord);

          // Create provider instance without full ProviderManager
          const providerType = providerConfig.type;
          if (providerType === 'ollama') {
            const { OllamaProvider } = await import('../../../services/llm-providers/OllamaProvider.js');
            tempProvider = new OllamaProvider(logger);
          } else if (providerType === 'aws-bedrock') {
            const { AWSBedrockProvider } = await import('../../../services/llm-providers/AWSBedrockProvider.js');
            tempProvider = new AWSBedrockProvider(logger);
          } else if (providerType === 'vertex-ai' || providerType === 'google-vertex') {
            const { GoogleVertexProvider } = await import('../../../services/llm-providers/GoogleVertexProvider.js');
            tempProvider = new GoogleVertexProvider(logger);
          } else if (providerType === 'azure-openai') {
            const { AzureOpenAIProvider } = await import('../../../services/llm-providers/AzureOpenAIProvider.js');
            tempProvider = new AzureOpenAIProvider(logger);
          } else if (providerType === 'anthropic') {
            const { AnthropicProvider } = await import('../../../services/llm-providers/AnthropicProvider.js');
            tempProvider = new AnthropicProvider(logger);
          } else if (providerType === 'openai') {
            const { OpenAIProvider } = await import('../../../services/llm-providers/OpenAIProvider.js');
            tempProvider = new OpenAIProvider(logger);
          } else if (providerType === 'azure-ai-foundry') {
            const { AzureAIFoundryProvider } = await import('../../../services/llm-providers/AzureAIFoundryProvider.js');
            tempProvider = new AzureAIFoundryProvider(logger, {
              endpointUrl: providerConfig.config?.endpointUrl || providerConfig.config?.endpoint,
              apiKey: providerConfig.config?.apiKey,
              apiVersion: providerConfig.config?.apiVersion,
              model: providerConfig.config?.chatModel || providerConfig.config?.model || providerConfig.config?.deploymentName,
              tenantId: providerConfig.config?.tenantId,
              clientId: providerConfig.config?.clientId,
              clientSecret: providerConfig.config?.clientSecret,
            });
          }

          if (tempProvider) {
            try {
              await tempProvider.initialize(providerConfig.config);
            } catch (err) {
              initError = err instanceof Error ? err.message : String(err);
              logger.warn({ provider: name, error: initError }, 'Temp provider initialization failed during test');
            }
          }
        } catch (dbError) {
          logger.error({ provider: name, error: dbError }, 'Failed to load provider from database for test');
          return reply.code(500).send({
            error: 'Database error',
            message: `Failed to load provider '${name}' from database: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`
          });
        }
      }

      const provider = providerInMemory ? providerManager.getProvider(name) : tempProvider;
      let models: ModelLike[] = [];
      try {
        models = ((await provider?.listModels()) || []) as ModelLike[];
      } catch {
        // listModels may fail if provider init failed
      }
      // Test model resolution: admin picks explicitly (?model= or body.model).
      // No heuristics — auto-picking "first in catalog" caused Bedrock tests
      // to fire at Nemotron with Anthropic body shape and return a cryptic
      // "Failed to deserialize" from AWS. If no model is picked AND the
      // provider has a DB-registered default, use it; otherwise surface a
      // clear "please pick a model" error instead of a confusing SDK error.
      const testModel = userModel
        || (models?.[0] as ModelLike)?.id
        || (models?.[0] as ModelLike)?.name
        || process.env.VERTEX_AI_MODEL
        || process.env.AZURE_OPENAI_MODEL
        || process.env.DEFAULT_MODEL;
      const capabilities = (models.find((m) => (m.id || m.name) === testModel) || models?.[0] as ModelLike)?.capabilities || {};
      const testMaxTokens = userMaxTokens || 100;

      const testResults: {
        provider: string;
        timestamp: string;
        initializationError: string | null;
        inMemory: boolean;
        tests: Record<string, { success?: boolean; [key: string]: unknown }>;
        summary?: Record<string, unknown>;
        [key: string]: unknown;
      } = {
        provider: name,
        timestamp: new Date().toISOString(),
        initializationError: initError,
        inMemory: providerInMemory,
        tests: {}
      };

      // If provider couldn't initialize at all, report it but don't 404
      if (initError && !providerInMemory) {
        testResults.tests.initialization = {
          success: false,
          error: initError,
          hint: 'Provider exists in database but failed to initialize. Check credentials and connectivity.'
        };
      }

      // Basic completion test
      if ((testType === 'basic' || testType === 'all') && provider) {
        try {
          const startTime = Date.now();
          let response;
          if (providerInMemory) {
            response = await providerManager.createCompletion({
              model: testModel,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: testMaxTokens,
              stream: false
            }, name);
          } else {
            // Use temp provider directly
            response = await tempProvider.createCompletion({
              model: testModel,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: testMaxTokens,
              stream: false
            });
          }

          const latency = Date.now() - startTime;
          const content = (response as unknown as CompletionResultLike).choices?.[0]?.message?.content || '';

          testResults.tests.basic = {
            success: true,
            latency,
            response: content,
            tokenCount: content.split(/\s+/).length
          };
        } catch (error) {
          testResults.tests.basic = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Streaming test
      if ((testType === 'streaming' || testType === 'all') && capabilities.chat && provider) {
        try {
          const startTime = Date.now();
          const completionArgs = {
            model: testModel,
            messages: [{ role: 'user' as const, content: 'Count from 1 to 5.' }],
            max_tokens: 50,
            stream: true
          };
          const stream = providerInMemory
            ? await providerManager.createCompletion(completionArgs, name)
            : await tempProvider.createCompletion(completionArgs);

          let chunks = 0;
          let firstChunkLatency = 0;
          let content = '';

          if (Symbol.asyncIterator in Object(stream)) {
            for await (const chunk of stream as AsyncGenerator) {
              if (chunks === 0) {
                firstChunkLatency = Date.now() - startTime;
              }
              chunks++;
              const delta = (chunk as unknown as CompletionResultLike).choices?.[0]?.delta?.content || '';
              content += delta;
            }
          }

          const totalLatency = Date.now() - startTime;

          testResults.tests.streaming = {
            success: true,
            chunks,
            firstChunkLatency,
            totalLatency,
            response: content
          };
        } catch (error) {
          testResults.tests.streaming = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Tool calling test
      if ((testType === 'tools' || testType === 'all') && capabilities.tools && provider) {
        try {
          const startTime = Date.now();
          const toolArgs = {
            model: testModel,
            messages: [{ role: 'user' as const, content: 'What is the weather in San Francisco?' }],
            tools: [{
              type: 'function',
              function: {
                name: 'get_weather',
                description: 'Get the current weather in a location',
                parameters: {
                  type: 'object',
                  properties: {
                    location: { type: 'string', description: 'City name' },
                    unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                  },
                  required: ['location']
                }
              }
            }],
            max_tokens: 100,
            stream: false
          };
          const response = providerInMemory
            ? await providerManager.createCompletion(toolArgs, name)
            : await tempProvider.createCompletion(toolArgs);

          const latency = Date.now() - startTime;
          const toolCalls = ((response as unknown as CompletionResultLike).choices?.[0]?.message?.tool_calls || []) as Array<{ function?: { name?: string; arguments?: string } }>;

          testResults.tests.tools = {
            success: toolCalls.length > 0,
            latency,
            toolCalls: toolCalls.map((tc) => ({
              name: tc.function?.name,
              arguments: tc.function?.arguments
            }))
          };
        } catch (error) {
          testResults.tests.tools = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Vision test
      if ((testType === 'vision' || testType === 'all') && capabilities.vision && imageUrl && provider) {
        try {
          const startTime = Date.now();
          const visionArgs = {
            model: testModel,
            messages: [{
              role: 'user' as const,
              content: [
                { type: 'text', text: 'What do you see in this image?' },
                { type: 'image_url', image_url: { url: imageUrl } }
              ] as unknown as string
            }],
            max_tokens: 200,
            stream: false
          };
          const response = providerInMemory
            ? await providerManager.createCompletion(visionArgs, name)
            : await tempProvider.createCompletion(visionArgs);

          const latency = Date.now() - startTime;
          const content = (response as unknown as CompletionResultLike).choices?.[0]?.message?.content || '';

          testResults.tests.vision = {
            success: true,
            latency,
            response: content
          };
        } catch (error) {
          testResults.tests.vision = {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }

      // Calculate overall success
      const tests = Object.values(testResults.tests);
      const successfulTests = tests.filter((t) => t.success).length;
      testResults.summary = {
        totalTests: tests.length,
        successfulTests,
        successRate: tests.length > 0 ? (successfulTests / tests.length * 100).toFixed(1) + '%' : '0%',
        capabilities: capabilities
      };

      // Persist test results and update provider status in DB
      try {
        const { prisma } = await import('../../../utils/prisma.js');
        const newStatus = successfulTests > 0 ? 'active' : 'error';
        const dbProvider = await prisma.lLMProvider.findFirst({ where: { name } });
        if (dbProvider) {
          await prisma.lLMProvider.update({
            where: { id: dbProvider.id },
            data: {
              status: newStatus,
              provider_config: asJson({
                ...(dbProvider.provider_config as ProviderConfigBag || {}),
                lastTestAt: new Date().toISOString(),
                lastTestSuccess: successfulTests > 0,
                lastTestResults: testResults.summary,
              }),
            },
          });
          logger.info({ provider: name, status: newStatus, successfulTests }, 'Provider test results persisted to database');
        }
        } catch (dbError) {
        logger.warn({ error: dbError, provider: name }, 'Failed to persist test results (non-fatal)');
      }

      return reply.send(testResults);

    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Provider test failed');
      return reply.code(500).send({
        provider: request.params.name,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/test-config — pre-save form-data test (#287)
   *
   * The Add-Provider wizard's "Test Connection" button needs to validate
   * credentials BEFORE the user clicks Save. The /:name/test endpoint above
   * looks up the provider by name in the DB and 404s if not found, which
   * is correct for saved rows but wrong for the wizard.
   *
   * This endpoint accepts the full provider config in the body, instantiates
   * a temp provider, runs a basic completion, and returns the same response
   * shape (so the UI can reuse its result-rendering code). It NEVER touches
   * the LLMProvider table.
   */
  const SUPPORTED_PROVIDER_TYPES = new Set([
    'azure-openai',
    'azure-ai-foundry',
    'vertex-ai',
    'aws-bedrock',
    'ollama',
    'openai',
    'anthropic',
  ]);

  function instantiateProviderForType(providerType: string, log: Logger, providerConfig) {
    if (providerType === 'ollama') return new OllamaProvider(log);
    if (providerType === 'aws-bedrock' || providerType === 'bedrock') return new AWSBedrockProvider(log);
    if (providerType === 'vertex-ai' || providerType === 'google-vertex') return new GoogleVertexProvider(log);
    if (providerType === 'azure-openai') return new AzureOpenAIProvider(log);
    if (providerType === 'anthropic') return new AnthropicProvider(log);
    if (providerType === 'openai') return new OpenAIProvider(log);
    if (providerType === 'azure-ai-foundry') {
      return new AzureAIFoundryProvider(log, {
        endpointUrl: providerConfig?.endpointUrl || providerConfig?.endpoint,
        apiKey: providerConfig?.apiKey,
        apiVersion: providerConfig?.apiVersion,
        model: providerConfig?.chatModel || providerConfig?.model || providerConfig?.deploymentName,
        tenantId: providerConfig?.tenantId,
        clientId: providerConfig?.clientId,
        clientSecret: providerConfig?.clientSecret,
      });
    }
    return null;
  }

  fastify.post<{
    Body: {
      providerType?: string;
      name?: string;
      authConfig?: Record<string, unknown>;
      providerConfig?: Record<string, unknown>;
      modelConfig?: Record<string, unknown>;
      testType?: 'basic';
      prompt?: string;
      model?: string;
      maxTokens?: number;
    };
  }>('/llm-providers/test-config', async (request, reply) => {
    const {
      providerType,
      name = 'unsaved',
      authConfig = {},
      providerConfig = {},
      modelConfig = {},
      prompt = 'Say "Hello, World!" and nothing else.',
      model: userModel,
      maxTokens: userMaxTokens,
    } = request.body || {};

    if (!providerType) {
      return reply.code(400).send({
        error: 'Missing providerType',
        message: 'providerType is required (e.g. aws-bedrock, vertex-ai, azure-ai-foundry).',
      });
    }
    if (!SUPPORTED_PROVIDER_TYPES.has(providerType) && providerType !== 'bedrock' && providerType !== 'google-vertex') {
      return reply.code(400).send({
        error: 'Unsupported providerType',
        message: `Unknown provider type '${providerType}'. Supported: ${Array.from(SUPPORTED_PROVIDER_TYPES).join(', ')}.`,
      });
    }

    // Build a synthetic dbProvider-shaped object so we can run it through
    // the same auth-config normalization pipeline as a saved row. We do NOT
    // encrypt — the body fields are already plaintext from the form.
    const syntheticDbProvider = {
      name,
      provider_type: providerType,
      enabled: true,
      priority: 1,
      auth_config: authConfig,           // already plaintext; decryptAuthConfig is a no-op for plaintext
      provider_config: providerConfig,
      model_config: modelConfig,
    };

    let normalized: { type?: string; config?: Record<string, unknown> } | undefined;
    try {
      const configService = new ProviderConfigService(logger);
      normalized = configService.convertDatabaseProvider(syntheticDbProvider);
    } catch (err) {
      logger.warn({ err, providerType }, 'test-config: convertDatabaseProvider failed');
      return reply.code(400).send({
        error: 'Invalid config',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const tempProvider = instantiateProviderForType(normalized.type, logger, normalized.config);
    if (!tempProvider) {
      return reply.code(400).send({
        error: 'Unsupported providerType',
        message: `Could not instantiate provider for type '${normalized.type}'.`,
      });
    }

    let initError: string | null = null;
    try {
      await (tempProvider as ProviderRuntime).initialize(normalized.config);
    } catch (err) {
      initError = err instanceof Error ? err.message : String(err);
      logger.info({ providerType: normalized.type, error: initError }, 'test-config: initialize failed (expected for bad creds)');
    }

    const testResults: {
      provider: string;
      providerType?: string;
      timestamp: string;
      initializationError: string | null;
      inMemory: boolean;
      tests: Record<string, { success?: boolean; [key: string]: unknown }>;
      summary?: Record<string, unknown>;
      [key: string]: unknown;
    } = {
      provider: name,
      providerType: normalized.type,
      timestamp: new Date().toISOString(),
      initializationError: initError,
      inMemory: false,
      tests: {} as Record<string, { success?: boolean; [key: string]: unknown }>,
    };

    let models: ModelLike[] = [];
    if (!initError) {
      try {
        models = ((await (tempProvider as ProviderRuntime).listModels?.()) || []) as ModelLike[];
      } catch {
        // listModels failure is not fatal for a basic completion test
      }
    }

    // #577 follow-up #2: filter embedding-only models out of the candidate
    // pool BEFORE picking models[0]. The gpu-node ollama-embedding pod only
    // serves nomic-embed-text:latest — picking it then calling /api/chat
    // returns 400 ("model does not support generate"). Surface that as a
    // skipped-inference soft success (auth+region OK, no chat-capable
    // model on this host) instead of a misleading 400.
    const chatCandidateModels = (models || []).filter(m => !isEmbeddingOnlyModel(m));
    const testModel = userModel
      || (chatCandidateModels?.[0] as ModelLike)?.id
      || (chatCandidateModels?.[0] as ModelLike)?.name
      || normalized.config?.model
      || normalized.config?.chatModel
      || normalized.config?.deploymentName;
    const testMaxTokens = userMaxTokens || 100;

    if (initError) {
      testResults.tests.basic = {
        success: false,
        error: initError,
        hint: 'Provider failed to initialize. Check credentials and connectivity.',
      };
    } else if (!testModel) {
      // #577 follow-up: when no test model can be derived (no userModel,
      // listModels returned nothing, no model in form), DO NOT call
      // createCompletion — the #577 guard would throw "No Bedrock model
      // configured" which is misleading: auth + region already validated
      // via initialize(). Surface a soft-success result so the wizard can
      // show "Test passed; pick a model in the next step to validate
      // inference."
      testResults.tests.basic = {
        success: true,
        inferenceSkipped: true,
        skippedInference: true,
        message:
          'Credentials and region validated. No model selected — pick a model in the Add-Model step to validate inference end-to-end.',
        latency: 0,
      };
    } else {
      try {
        const startTime = Date.now();
        const response = await (tempProvider as ProviderRuntime).createCompletion({
          model: testModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: testMaxTokens,
          stream: false,
        });
        const latency = Date.now() - startTime;
        const content = (response as unknown as CompletionResultLike).choices?.[0]?.message?.content || '';
        testResults.tests.basic = {
          success: true,
          latency,
          response: content,
          tokenCount: content.split(/\s+/).length,
        };
      } catch (err) {
        testResults.tests.basic = {
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    const tests = Object.values(testResults.tests);
    const successfulTests = tests.filter((t) => t.success).length;
    testResults.summary = {
      totalTests: tests.length,
      successfulTests,
      successRate: tests.length > 0 ? (successfulTests / tests.length * 100).toFixed(1) + '%' : '0%',
    };

    return reply.send(testResults);
  });


  /**
   * POST /api/admin/llm-providers/playground
   * Universal model playground - test any model with full configuration
   * Supports ALL SDK options for each provider type
   */
  fastify.post<{
    Body: {
      provider: string;
      model: string;
      testType: 'chat' | 'vision' | 'tools' | 'embedding' | 'image-generation' | 'thinking';
      config?: {
        // Universal options
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        topK?: number;
        stopSequences?: string[];
        stream?: boolean;

        // OpenAI/Azure OpenAI specific
        frequencyPenalty?: number;       // -2.0 to 2.0
        presencePenalty?: number;        // -2.0 to 2.0
        seed?: number;                   // For reproducibility
        responseFormat?: {
          type: 'text' | 'json_object' | 'json_schema';
          jsonSchema?: object;
        };
        logprobs?: boolean;
        topLogprobs?: number;            // 0-20
        logitBias?: Record<string, number>;

        // Anthropic/Claude specific (via Bedrock/Foundry)
        thinkingBudget?: number;         // Extended thinking token budget
        enableThinking?: boolean;        // Enable extended thinking mode

        // Google Vertex AI specific
        safetySettings?: Array<{
          category: 'HARM_CATEGORY_HARASSMENT' | 'HARM_CATEGORY_HATE_SPEECH' | 'HARM_CATEGORY_SEXUALLY_EXPLICIT' | 'HARM_CATEGORY_DANGEROUS_CONTENT';
          threshold: 'BLOCK_NONE' | 'BLOCK_LOW_AND_ABOVE' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_ONLY_HIGH';
        }>;
        groundingConfig?: {
          googleSearchRetrieval?: {
            dynamicRetrievalConfig?: {
              mode: 'MODE_DYNAMIC';
              dynamicThreshold?: number;
            };
          };
        };

        // Ollama specific
        numCtx?: number;                 // Context length
        repeatPenalty?: number;          // 1.0 = no penalty
        numPredict?: number;             // Max tokens to predict
        mirostat?: number;               // 0, 1, or 2
        mirostatEta?: number;
        mirostatTau?: number;
      };
      input: {
        prompt?: string;
        systemPrompt?: string;
        messages?: Array<{ role: string; content: string }>;
        imageUrl?: string;
        imagePrompt?: string;
        textToEmbed?: string;
        tools?: Array<unknown>;
      };
    };
  }>('/llm-providers/playground', async (request, reply) => {
    try {
      const { provider, model, testType, config, input } = request.body;

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'Model playground is not available'
        });
      }

      const startTime = Date.now();
      let result: Record<string, unknown> = { success: false };

      switch (testType) {
        case 'chat': {
          const messages = input.messages || [
            ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
            { role: 'user' as const, content: input.prompt || 'Hello!' }
          ];

          // Build comprehensive completion request with all SDK options
          const completionRequest: Record<string, unknown> = {
            model,
            messages: messages as unknown,
            temperature: config?.temperature,
            max_tokens: config?.maxTokens || 1024,
            top_p: config?.topP,
            stream: config?.stream ?? false,
          };

          // Universal options
          if (config?.topK !== undefined) completionRequest.top_k = config.topK;
          if (config?.stopSequences) completionRequest.stop_sequences = config.stopSequences;

          // OpenAI/Azure specific options
          if (config?.frequencyPenalty !== undefined) completionRequest.frequency_penalty = config.frequencyPenalty;
          if (config?.presencePenalty !== undefined) completionRequest.presence_penalty = config.presencePenalty;
          if (config?.seed !== undefined) completionRequest.seed = config.seed;
          if (config?.responseFormat) completionRequest.response_format = config.responseFormat;
          if (config?.logprobs !== undefined) completionRequest.logprobs = config.logprobs;
          if (config?.topLogprobs !== undefined) completionRequest.top_logprobs = config.topLogprobs;
          if (config?.logitBias) completionRequest.logit_bias = config.logitBias;

          // Anthropic/Claude thinking options
          if (config?.enableThinking) {
            completionRequest.thinking = {
              type: 'enabled',
              budget_tokens: config.thinkingBudget || 8000
            };
          }

          // Google Vertex AI options
          if (config?.safetySettings) completionRequest.safety_settings = config.safetySettings;
          if (config?.groundingConfig) completionRequest.grounding_config = config.groundingConfig;

          // Ollama specific options
          if (config?.numCtx !== undefined) completionRequest.num_ctx = config.numCtx;
          if (config?.repeatPenalty !== undefined) completionRequest.repeat_penalty = config.repeatPenalty;
          if (config?.numPredict !== undefined) completionRequest.num_predict = config.numPredict;
          if (config?.mirostat !== undefined) completionRequest.mirostat = config.mirostat;
          if (config?.mirostatEta !== undefined) completionRequest.mirostat_eta = config.mirostatEta;
          if (config?.mirostatTau !== undefined) completionRequest.mirostat_tau = config.mirostatTau;

          const response = await providerManager.createCompletion(completionRequest as unknown as Parameters<ProviderManager['createCompletion']>[0], provider);

          const content = (response as unknown as CompletionResultLike).choices?.[0]?.message?.content || '';
          const thinkingContent = (response as unknown as CompletionResultLike).thinking || (response as unknown as CompletionResultLike).choices?.[0]?.message?.thinking || null;

          result = {
            success: true,
            type: 'chat',
            response: content,
            thinking: thinkingContent,
            usage: (response as unknown as CompletionResultLike).usage,
            latency: Date.now() - startTime,
            configApplied: {
              temperature: config?.temperature,
              maxTokens: config?.maxTokens,
              topP: config?.topP,
              topK: config?.topK,
              frequencyPenalty: config?.frequencyPenalty,
              presencePenalty: config?.presencePenalty,
              thinkingEnabled: config?.enableThinking,
              thinkingBudget: config?.thinkingBudget,
            }
          };
          break;
        }

        case 'thinking': {
          // Specialized extended thinking test for Claude/Gemini models
          const messages = input.messages || [
            { role: 'user' as const, content: input.prompt || 'Explain the implications of quantum computing on modern cryptography. Think through this step by step.' }
          ];

          const thinkingBudget = config?.thinkingBudget || 16000;

          const completionRequest: Record<string, unknown> = {
            model,
            messages: messages as unknown,
            temperature: config?.temperature || 1,
            max_tokens: config?.maxTokens || 4096,
            stream: false,
            thinking: {
              type: 'enabled',
              budget_tokens: thinkingBudget
            }
          };

          const response = await providerManager.createCompletion(completionRequest as unknown as Parameters<ProviderManager['createCompletion']>[0], provider);

          const content = (response as unknown as CompletionResultLike).choices?.[0]?.message?.content || '';
          const thinkingContent = (response as unknown as CompletionResultLike).thinking ||
                                  (response as unknown as CompletionResultLike).choices?.[0]?.message?.thinking ||
                                  (response as unknown as CompletionResultLike).thinkingContent || null;

          result = {
            success: true,
            type: 'thinking',
            response: content,
            thinking: thinkingContent,
            thinkingBudget,
            usage: (response as unknown as CompletionResultLike).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'vision': {
          if (!input.imageUrl) {
            return reply.code(400).send({ error: 'imageUrl required for vision test' });
          }

          const response = await providerManager.createCompletion({
            model,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: input.prompt || 'What do you see in this image?' },
                { type: 'image_url', image_url: { url: input.imageUrl } }
              ] as unknown as string
            }],
            max_tokens: config?.maxTokens || 1024,
            stream: false
          }, provider);

          const content = (response as unknown as CompletionResultLike).choices?.[0]?.message?.content || '';
          result = {
            success: true,
            type: 'vision',
            response: content,
            usage: (response as unknown as CompletionResultLike).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'tools': {
          const tools = input.tools || [{
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather in a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                  unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                },
                required: ['location']
              }
            }
          }];

          const response = await providerManager.createCompletion({
            model,
            messages: [{ role: 'user', content: input.prompt || 'What is the weather in San Francisco?' }],
            tools,
            max_tokens: config?.maxTokens || 1024,
            stream: false
          }, provider);

          const toolCalls = ((response as unknown as CompletionResultLike).choices?.[0]?.message?.tool_calls || []) as Array<{ function?: { name?: string; arguments?: string } }>;
          result = {
            success: toolCalls.length > 0,
            type: 'tools',
            toolCalls: toolCalls.map((tc) => ({
              name: tc.function?.name,
              arguments: tc.function?.arguments
            })),
            response: (response as unknown as CompletionResultLike).choices?.[0]?.message?.content,
            usage: (response as unknown as CompletionResultLike).usage,
            latency: Date.now() - startTime
          };
          break;
        }

        case 'image-generation': {
          // Image generation via Vertex AI Imagen
          const projectId = process.env.GOOGLE_CLOUD_PROJECT;
          const location = process.env.GCP_REGION || 'us-central1';

          if (!projectId) {
            return reply.code(400).send({ error: 'GOOGLE_CLOUD_PROJECT not configured' });
          }

          try {
            // Use the Vertex AI REST API for image generation
            const { GoogleAuth } = await import('google-auth-library');
            const auth = new GoogleAuth({
              scopes: ['https://www.googleapis.com/auth/cloud-platform']
            });
            const client = await auth.getClient();
            const accessToken = await client.getAccessToken();

            const imageGenEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

            const imageResponse = await fetch(imageGenEndpoint, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken.token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                instances: [{
                  prompt: input.imagePrompt || input.prompt || 'A beautiful sunset over mountains'
                }],
                parameters: {
                  sampleCount: 1,
                  aspectRatio: '1:1',
                  safetyFilterLevel: 'block_few'
                }
              })
            });

            if (!imageResponse.ok) {
              const errorText = await imageResponse.text();
              throw new Error(`Image generation failed: ${imageResponse.status} - ${errorText}`);
            }

            const imageData = await imageResponse.json();
            const predictions = imageData.predictions || [];

            result = {
              success: predictions.length > 0,
              type: 'image-generation',
              images: predictions.map((p) => ({
                base64: p.bytesBase64Encoded,
                mimeType: p.mimeType || 'image/png'
              })),
              latency: Date.now() - startTime
            };
          } catch (imageError) {
            logger.error({ error: imageError, model }, 'Image generation failed');
            result = {
              success: false,
              type: 'image-generation',
              error: imageError instanceof Error ? imageError.message : 'Image generation failed',
              latency: Date.now() - startTime
            };
          }
          break;
        }

        case 'embedding': {
          // Embedding test
          const textToEmbed = input.textToEmbed || input.prompt || 'Hello, world!';

          try {
            const providerInstance = providerManager.getProvider(provider);
            if (providerInstance && 'generateEmbedding' in providerInstance) {
              const embedding = await (providerInstance as ProviderRuntime).generateEmbedding(textToEmbed);
              result = {
                success: true,
                type: 'embedding',
                dimensions: embedding.length,
                preview: embedding.slice(0, 10),
                latency: Date.now() - startTime
              };
            } else {
              result = {
                success: false,
                type: 'embedding',
                error: 'Provider does not support embeddings'
              };
            }
          } catch (embError) {
            result = {
              success: false,
              type: 'embedding',
              error: embError instanceof Error ? embError.message : 'Embedding failed',
              latency: Date.now() - startTime
            };
          }
          break;
        }

        default:
          return reply.code(400).send({ error: `Unknown test type: ${testType}` });
      }

      return reply.send({
        ...result,
        provider,
        model,
        config,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Playground test failed');
      return reply.code(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

};


export default testingRoutes;
