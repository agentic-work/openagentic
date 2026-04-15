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
 * AWS Bedrock Provider
 *
 * Implements ILLMProvider for AWS Bedrock models (Claude, Titan, Jurassic, etc.)
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ContentBlock,
  type Message as BedrockMessage,
  type Tool as BedrockTool,
  type ToolConfiguration
} from '@aws-sdk/client-bedrock-runtime';
import { BedrockClient, ListFoundationModelsCommand, GetFoundationModelCommand } from '@aws-sdk/client-bedrock';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  type ProviderConfig,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth,
  type DiscoveredModel,
  type NormalizerState,
} from './ILLMProvider.js';
import { NormalizedStreamEvent } from '../NormalizedStreamTypes.js';
import { MODELS } from '../../config/models.js';

export interface BedrockConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  endpoint?: string;
  // Standardized model config (from database or environment)
  chatModel?: string;
  embeddingModel?: string;
  visionModel?: string;
  imageModel?: string;
  compactionModel?: string;
  modelId?: string; // Legacy fallback
  // Secondary model for fallback when primary is throttled
  secondaryModel?: string;
  // Retry configuration
  maxRetries?: number;
  initialRetryDelayMs?: number;
  // Inference profile prefix (us, eu, apac) - defaults to 'us' for cross-region
  inferenceProfilePrefix?: string;
  // Private VPC Endpoint configuration
  // When connecting via NLB -> VPC Endpoint, ALPN/HTTP2 negotiation often fails
  // Set forceHttp1=true to disable HTTP/2 and only use HTTP/1.1
  forceHttp1?: boolean;
  // Prompt caching configuration (saves 75%+ on repeated content)
  // See: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
  enablePromptCaching?: boolean;
}

/**
 * AWS Bedrock now requires inference profiles for on-demand model invocation.
 * This map converts direct model IDs to cross-region inference profile IDs.
 *
 * Format: Direct Model ID → Inference Profile ID
 *
 * Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
 */
const MODEL_TO_INFERENCE_PROFILE: Record<string, string> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 4.6 SERIES (Latest - All support thinking, tools, vision)
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Opus 4.6 - Latest premium model, best quality
  'anthropic.claude-opus-4-6-v1': 'us.anthropic.claude-opus-4-6-v1',
  // Claude Sonnet 4.6 - Latest balanced model, best speed/intelligence
  'anthropic.claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 4.5 SERIES (All support thinking, tools, vision)
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Opus 4.5 (legacy, kept for backward compatibility)
  'anthropic.claude-opus-4-5-20251101-v1:0': 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  // Claude Sonnet 4.5 (legacy, kept for backward compatibility)
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  // Claude Haiku 4.5 - Fast/cheap, supports thinking/tools/vision
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 4.x SERIES
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Opus 4.1
  'anthropic.claude-opus-4-1-20250805-v1:0': 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  // Claude Opus 4
  'anthropic.claude-opus-4-20250514-v1:0': 'us.anthropic.claude-opus-4-20250514-v1:0',
  // Claude Sonnet 4
  'anthropic.claude-sonnet-4-20250514-v1:0': 'us.anthropic.claude-sonnet-4-20250514-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 3.x SERIES
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude 3.7 Sonnet
  'anthropic.claude-3-7-sonnet-20250219-v1:0': 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  // Claude 3.5 Sonnet v2
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  // Claude 3.5 Sonnet v1
  'anthropic.claude-3-5-sonnet-20240620-v1:0': 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
  // Claude 3.5 Haiku (does NOT support thinking)
  'anthropic.claude-3-5-haiku-20241022-v1:0': 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  // Claude 3 Opus
  'anthropic.claude-3-opus-20240229-v1:0': 'us.anthropic.claude-3-opus-20240229-v1:0',
  // Claude 3 Sonnet
  'anthropic.claude-3-sonnet-20240229-v1:0': 'us.anthropic.claude-3-sonnet-20240229-v1:0',
  // Claude 3 Haiku
  'anthropic.claude-3-haiku-20240307-v1:0': 'us.anthropic.claude-3-haiku-20240307-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // AMAZON NOVA MODELS
  // ═══════════════════════════════════════════════════════════════════════════
  'amazon.nova-micro-v1:0': 'us.amazon.nova-micro-v1:0',
  'amazon.nova-lite-v1:0': 'us.amazon.nova-lite-v1:0',
  'amazon.nova-pro-v1:0': 'us.amazon.nova-pro-v1:0',
};

export class AWSBedrockProvider extends BaseLLMProvider {
  readonly name = 'AWS Bedrock';
  readonly type = 'aws-bedrock' as const;
  readonly streamFormat = 'anthropic' as const; // Claude models use native Anthropic format

  private runtimeClient?: BedrockRuntimeClient;
  private bedrockClient?: BedrockClient;
  private config?: BedrockConfig;

  // Cache for live foundation model listing (5 minute TTL)
  private foundationModelCache?: { models: any[]; timestamp: number };
  private static readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Retry configuration with defaults
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly secondaryModel?: string;

  constructor(logger: Logger) {
    super(logger, 'aws-bedrock');
    // Default retry configuration
    this.maxRetries = 5; // More retries for throttling
    this.initialRetryDelayMs = 1000; // Start with 1 second
    // Secondary model from provider config (DB) or env var fallback
    this.secondaryModel = process.env.SECONDARY_MODEL || MODELS.default;
  }

  /**
   * Check if an error is a throttling/rate limit error from Bedrock
   */
  private isThrottlingError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    const errorName = error.name || '';
    const statusCode = error.$metadata?.httpStatusCode || 0;

    return (
      errorName === 'ThrottlingException' ||
      statusCode === 429 ||
      message.includes('throttlingexception') ||
      message.includes('too many tokens') ||
      message.includes('too many requests') ||
      message.includes('rate exceeded') ||
      message.includes('rate limit')
    );
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped)
    const exponentialDelay = this.initialRetryDelayMs * Math.pow(2, attempt);
    const maxDelay = 30000; // Cap at 30 seconds
    const baseDelay = Math.min(exponentialDelay, maxDelay);
    // Add jitter (±25%)
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(baseDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Convert a direct model ID to an inference profile ID for cross-region invocation.
   * AWS Bedrock now REQUIRES inference profiles for on-demand model invocation.
   *
   * If the model ID is already an inference profile (starts with us./eu./apac.),
   * it is returned as-is.
   *
   * If no mapping exists, returns the original model ID (may fail if Bedrock requires profile).
   */
  private toInferenceProfile(modelId: string): string {
    // Already an inference profile? Validate the :0 suffix is correct.
    // If us.xxx:0 is passed but the MAP has us.xxx (no :0), strip it.
    // If us.xxx is passed but the MAP has us.xxx:0, add it.
    // This handles version suffix mismatches from stale DB entries or env var drift.
    if (modelId.startsWith('us.') || modelId.startsWith('eu.') || modelId.startsWith('apac.')) {
      // Check if this exact profile is a known mapped value
      const knownProfiles = new Set(Object.values(MODEL_TO_INFERENCE_PROFILE));
      if (knownProfiles.has(modelId)) {
        return modelId; // Exact match - good
      }
      // Try toggling the :0 suffix to find the correct form
      if (modelId.endsWith(':0')) {
        const withoutSuffix = modelId.slice(0, -2);
        if (knownProfiles.has(withoutSuffix)) {
          this.logger.warn({ originalModelId: modelId, fixedModelId: withoutSuffix },
            '⚠️ [BEDROCK] Stripped invalid :0 suffix from inference profile (not in mapping with :0)');
          return withoutSuffix;
        }
      } else {
        const withSuffix = modelId + ':0';
        if (knownProfiles.has(withSuffix)) {
          this.logger.warn({ originalModelId: modelId, fixedModelId: withSuffix },
            '⚠️ [BEDROCK] Added missing :0 suffix to inference profile (mapping requires :0)');
          return withSuffix;
        }
      }
      // Not in our known mappings but already has region prefix - pass through
      return modelId;
    }

    // Check explicit mapping
    const mappedProfile = MODEL_TO_INFERENCE_PROFILE[modelId];
    if (mappedProfile) {
      this.logger.info({
        originalModelId: modelId,
        inferenceProfile: mappedProfile
      }, '🔄 [BEDROCK] Converted model ID to inference profile');
      return mappedProfile;
    }

    // Try to auto-generate inference profile for known patterns
    // Format: us.<provider>.<model> for cross-region inference
    const prefix = this.config?.inferenceProfilePrefix || process.env.AWS_BEDROCK_INFERENCE_PREFIX || 'us';

    // Check if this looks like an Anthropic model that needs conversion
    if (modelId.startsWith('anthropic.')) {
      // Try the direct prefix approach
      const autoProfile = `${prefix}.${modelId}`;
      this.logger.warn({
        originalModelId: modelId,
        autoGeneratedProfile: autoProfile,
        warning: 'Model not in explicit mapping - auto-generating profile ID'
      }, '⚠️ [BEDROCK] Auto-generating inference profile for unmapped Anthropic model');
      return autoProfile;
    }

    // For Amazon models (Nova, Titan), try direct prefix
    if (modelId.startsWith('amazon.')) {
      const autoProfile = `${prefix}.${modelId}`;
      this.logger.info({
        originalModelId: modelId,
        inferenceProfile: autoProfile
      }, '🔄 [BEDROCK] Using cross-region profile for Amazon model');
      return autoProfile;
    }

    // Return original for other models (may fail if Bedrock requires profile)
    this.logger.warn({
      modelId,
      warning: 'Model not in inference profile mapping - using direct ID'
    }, '⚠️ [BEDROCK] No inference profile mapping for model');
    return modelId;
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    try {
      this.config = config as BedrockConfig;

      const clientConfig: any = {
        region: this.config.region || process.env.AWS_REGION || 'us-east-1'
      };

      // Add credentials if provided (otherwise uses default AWS credential chain)
      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
          sessionToken: this.config.sessionToken
        };
      }

      if (this.config.endpoint) {
        clientConfig.endpoint = this.config.endpoint;
      }

      // =========================================================================
      // PRIVATE VPC ENDPOINT SUPPORT (NLB -> VPCE -> Bedrock Runtime)
      // =========================================================================
      // When connecting to Bedrock via a private VPC endpoint behind an NLB,
      // ALPN negotiation for HTTP/2 often fails because:
      //   1. NLB terminates TLS (ACM cert) and re-encrypts to VPCE
      //   2. ALPN protocol list isn't properly forwarded through the NLB
      //   3. VPCE expects ALPN but receives stripped/modified TLS handshake
      //
      // Solution: Force HTTP/1.1 only - don't advertise h2 in ALPN
      // Enable via: AWS_BEDROCK_FORCE_HTTP1=true or config.forceHttp1=true
      // =========================================================================
      const forceHttp1 = this.config.forceHttp1 || process.env.AWS_BEDROCK_FORCE_HTTP1 === 'true';

      if (forceHttp1) {
        this.logger.info({
          endpoint: this.config.endpoint,
          reason: 'Private VPC Endpoint / NLB compatibility'
        }, '🔒 [BEDROCK] Forcing HTTP/1.1 - disabling ALPN h2 advertisement for VPCE compatibility');

        // Create custom HTTPS agent that only advertises HTTP/1.1 in ALPN
        const httpsAgent = new https.Agent({
          keepAlive: true,
          keepAliveMsecs: 30000,
          maxSockets: 50,
          maxFreeSockets: 10,
          timeout: 300000, // 5 minute timeout for long thinking requests
          // CRITICAL: Only advertise HTTP/1.1 in ALPN - do NOT include h2
          // This prevents the "ALPN won't do http2" error with NLB -> VPCE
          ALPNProtocols: ['http/1.1'],
        });

        clientConfig.requestHandler = new NodeHttpHandler({
          httpsAgent,
          requestTimeout: 300000, // 5 minutes
          connectionTimeout: 10000, // 10 seconds to establish connection
        });
      }

      this.runtimeClient = new BedrockRuntimeClient(clientConfig);
      this.bedrockClient = new BedrockClient(clientConfig);

      // IMPORTANT: Validate credentials by making a test API call
      // This prevents the provider from being added if credentials are invalid
      try {
        this.logger.info({ provider: this.name, region: clientConfig.region }, 'Validating AWS Bedrock credentials...');
        
        const testCommand = new ListFoundationModelsCommand({});
        const response = await this.bedrockClient.send(testCommand);
        
        const modelCount = response.modelSummaries?.length || 0;
        this.logger.info({
          provider: this.name,
          modelsAvailable: modelCount,
          region: clientConfig.region,
          endpoint: this.config.endpoint || 'default',
          forceHttp1: forceHttp1,
          protocol: forceHttp1 ? 'HTTP/1.1 (ALPN: http/1.1 only)' : 'HTTP/1.1 or HTTP/2 (default ALPN)'
        }, 'AWS Bedrock credentials validated successfully');

      } catch (credentialError: any) {
        // Clear the clients since they won't work
        this.runtimeClient = undefined;
        this.bedrockClient = undefined;
        this.initialized = false;
        
        const errorMessage = credentialError.message || String(credentialError);
        const isCredentialError = 
          errorMessage.includes('Could not load credentials') ||
          errorMessage.includes('Missing credentials') ||
          errorMessage.includes('ExpiredToken') ||
          errorMessage.includes('InvalidIdentityToken') ||
          errorMessage.includes('AccessDenied') ||
          errorMessage.includes('UnrecognizedClientException') ||
          credentialError.name === 'CredentialsProviderError';

        if (isCredentialError) {
          this.logger.error({
            provider: this.name,
            error: errorMessage,
            region: clientConfig.region,
            hasAccessKeyId: !!this.config.accessKeyId,
            hasSecretAccessKey: !!this.config.secretAccessKey
          }, '❌ AWS Bedrock credentials are invalid or missing. Provider will NOT be available. ' +
             'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables, ' +
             'or configure IAM role/instance profile, or set AWS_BEDROCK_ENABLED=false to disable.');
          
          throw new Error(
            `AWS Bedrock credential validation failed: ${errorMessage}. ` +
            `Please configure valid AWS credentials or disable AWS Bedrock (AWS_BEDROCK_ENABLED=false).`
          );
        } else {
          // Non-credential error (network, service issue, etc.) - log but allow retry
          this.logger.warn({
            provider: this.name,
            error: errorMessage,
            errorType: credentialError.name
          }, 'AWS Bedrock validation call failed (non-credential error). Provider may work on retry.');
          throw credentialError;
        }
      }

      this.initialized = true;

      // Log model configuration
      this.logger.info({
        provider: this.name,
        region: clientConfig.region,
        endpoint: this.config.endpoint || 'default (public)',
        forceHttp1,
        chatModel: this.config.chatModel || this.config.modelId,
        embeddingModel: this.config.embeddingModel,
        visionModel: this.config.visionModel
      }, 'AWS Bedrock provider initialized with model config');
    } catch (error) {
      this.logger.error({ error, provider: this.name }, 'Failed to initialize AWS Bedrock provider');
      throw error;
    }
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.runtimeClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    const startTime = Date.now();

    // Determine model from request or use default
    const requestedModelId = request.model || process.env.AWS_BEDROCK_DEFAULT_MODEL || process.env.ECONOMICAL_MODEL;
    const requestedSecondaryModelId = this.config?.secondaryModel || this.secondaryModel;

    // CRITICAL: Convert model IDs to inference profiles for AWS Bedrock
    // AWS Bedrock now REQUIRES inference profiles for on-demand model invocation
    const primaryModelId = this.toInferenceProfile(requestedModelId!);
    const secondaryModelId = requestedSecondaryModelId ? this.toInferenceProfile(requestedSecondaryModelId) : undefined;

    this.logger.info({
      requestedModel: requestedModelId,
      resolvedModel: primaryModelId,
      requestedSecondary: requestedSecondaryModelId,
      resolvedSecondary: secondaryModelId,
      wasConverted: requestedModelId !== primaryModelId
    }, '🎯 [BEDROCK] Model ID resolution for completion request');

    let lastError: Error | null = null;
    let currentModelId = primaryModelId;
    let totalRetries = 0;

    // Try with retry and model fallback
    for (let modelAttempt = 0; modelAttempt < 2; modelAttempt++) {
      // On second attempt, try secondary model if available
      if (modelAttempt === 1) {
        if (!secondaryModelId || secondaryModelId === currentModelId) {
          // No secondary model or same as primary, throw the last error
          break;
        }
        currentModelId = secondaryModelId;
        this.logger.info({
          primaryModel: primaryModelId,
          fallbackModel: currentModelId,
          reason: 'throttling'
        }, '🔄 [BEDROCK] Falling back to secondary model after throttling');
      }

      // Convert OpenAI-style messages to Bedrock format
      const body = this.convertToBedrock(request, currentModelId);

      // Retry loop with exponential backoff
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          if (request.stream) {
            return await this.streamCompletionWithRetry(currentModelId, body, startTime, attempt);
          } else {
            return await this.nonStreamCompletion(currentModelId, body, startTime);
          }
        } catch (error: any) {
          lastError = error;
          totalRetries++;

          // If not a throttling error, don't retry - throw immediately
          if (!this.isThrottlingError(error)) {
            this.trackFailure();
            this.logger.error({
              error: error.message,
              model: currentModelId,
              attempt,
              errorType: error.name,
              provider: this.name
            }, 'Bedrock completion failed (non-throttling error)');
            throw error;
          }

          // If we've exhausted retries for this model, break to try fallback
          if (attempt >= this.maxRetries) {
            this.logger.warn({
              model: currentModelId,
              attempts: attempt + 1,
              totalRetries,
              errorType: error.name,
              errorMessage: error.message
            }, '⚠️ [BEDROCK] Exhausted retries for throttling, trying fallback model');
            break;
          }

          // Calculate backoff delay
          const delayMs = this.calculateBackoffDelay(attempt);

          this.logger.warn({
            model: currentModelId,
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delayMs,
            errorType: error.name,
            errorMessage: error.message
          }, `⏳ [BEDROCK] Throttling detected, retrying in ${delayMs}ms`);

          await this.sleep(delayMs);
        }
      }
    }

    // All attempts failed
    this.trackFailure();
    this.logger.error({
      primaryModel: primaryModelId,
      secondaryModel: secondaryModelId,
      totalRetries,
      error: lastError?.message,
      provider: this.name
    }, '❌ [BEDROCK] All retry attempts and model fallbacks failed');

    throw lastError || new Error('Bedrock completion failed after all retries');
  }

  /**
   * Stream completion with retry support
   * Returns the generator directly if successful
   */
  private async streamCompletionWithRetry(
    modelId: string,
    body: any,
    startTime: number,
    attempt: number
  ): Promise<AsyncGenerator<any>> {
    // For streaming, we need to handle throttling at the initial request level
    // The generator itself shouldn't need retry logic since throttling happens upfront
    return this.streamCompletion(modelId, body, startTime);
  }

  private async nonStreamCompletion(modelId: string, body: any, startTime: number): Promise<CompletionResponse> {
    const command = new InvokeModelCommand({
      modelId,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json'
    });

    const response = await this.runtimeClient!.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const latency = Date.now() - startTime;

    // Parse response based on model type
    const parsedResponse = this.parseBedrockResponse(modelId, responseBody);

    // Track metrics
    const tokens = parsedResponse.usage?.total_tokens || 0;
    const cost = this.estimateCost(modelId, tokens);
    this.trackSuccess(latency, tokens, cost);

    return parsedResponse;
  }

  private async *streamCompletion(modelId: string, body: any, startTime: number): AsyncGenerator<any> {
    // Route to appropriate streaming API based on model:
    // - Claude models: InvokeModelWithResponseStream (native Anthropic format)
    // - Nova/Other models: ConverseStream (unified format, better streaming support)
    const isClaudeModel = modelId.includes('anthropic.claude');

    if (!isClaudeModel) {
      // Use ConverseStream for non-Claude models (Nova, Titan, etc.)
      this.logger.info({ modelId }, '[AWSBedrockProvider] Using ConverseStream for non-Claude model');
      yield* this.streamWithConverseAPI(modelId, body, startTime);
      return;
    }

    // For Claude models, use InvokeModelWithResponseStream (native Anthropic format)
    this.logger.info({ modelId }, '[AWSBedrockProvider] Using InvokeModelWithResponseStream for Claude model');
    const command = new InvokeModelWithResponseStreamCommand({
      modelId,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json'
    });

    const response = await this.runtimeClient!.send(command);

    if (!response.body) {
      throw new Error('No response body from Bedrock streaming');
    }

    let totalTokens = 0;

    let chunkNum = 0;
    let hasContent = false;
    for await (const event of response.body) {
      if (event.chunk) {
        chunkNum++;
        const rawBytes = new TextDecoder().decode(event.chunk.bytes);
        const chunk = JSON.parse(rawBytes);

        // DEBUG: Log ALL raw chunks from Bedrock to understand the actual response format
        this.logger.info({
          chunkNum,
          rawChunkType: chunk.type,
          rawChunkKeys: Object.keys(chunk),
          hasContent: !!chunk.content,
          hasContentBlock: !!chunk.content_block,
          hasDelta: !!chunk.delta,
          rawChunk: rawBytes.substring(0, 2000)
        }, '[BEDROCK-RAW] 📡 Raw chunk from InvokeModelWithResponseStream');

        // Track if any chunk has actual content
        if (chunk.type === 'content_block_start' || chunk.type === 'content_block_delta' ||
            chunk.delta?.type === 'text_delta' || chunk.delta?.type === 'thinking_delta') {
          hasContent = true;
        }

        const converted = this.convertStreamChunk(modelId, chunk);
        if (converted) {
          yield converted;
          if (chunk.usage?.total_tokens) {
            totalTokens = chunk.usage.total_tokens;
          }
        }
      }
    }

    // Log summary of what we received
    this.logger.info({
      totalChunks: chunkNum,
      hasContent,
      totalTokens,
      modelId
    }, '[BEDROCK-RAW] 📊 Stream summary');

    const latency = Date.now() - startTime;
    const cost = this.estimateCost(modelId, totalTokens);
    this.trackSuccess(latency, totalTokens, cost);
  }

  /**
   * Stream completion using the Converse API for Claude models.
   * This API properly returns content_block events for interleaved thinking/text/tool_use.
   */
  private async *streamWithConverseAPI(modelId: string, body: any, startTime: number): AsyncGenerator<any> {
    // Convert our internal format to Converse API format
    // Note: For Nova models, body may already have inferenceConfig from convertToBedrock
    const converseInput: ConverseStreamCommandInput = {
      modelId,
      messages: this.convertToConverseMessages(body.messages),
      inferenceConfig: body.inferenceConfig || {
        maxTokens: body.max_tokens || 32768,
        temperature: body.temperature ?? 1,
      },
    };

    // Add system prompt if present with caching support
    // Handle both string format (from Claude) and array format (from Nova)
    const enableCaching = this.config?.enablePromptCaching ??
                         process.env.AWS_BEDROCK_ENABLE_CACHING === 'true';

    if (body.system) {
      if (Array.isArray(body.system)) {
        // Nova format: [{text: ...}] - add cachePoint if enabled
        if (enableCaching && body.system.length > 0) {
          converseInput.system = [
            ...body.system,
            { cachePoint: { type: 'default' } } as any
          ];
        } else {
          converseInput.system = body.system;
        }
      } else {
        // Claude format: string - wrap in array with optional cachePoint
        if (enableCaching && body.system.length >= 1024) {
          converseInput.system = [
            { text: body.system },
            { cachePoint: { type: 'default' } } as any
          ];
          this.logger.info({
            systemLength: body.system.length,
            caching: true
          }, '💾 [CONVERSE] System prompt caching enabled');
        } else {
          converseInput.system = [{ text: body.system }];
        }
      }
    }

    // Add tools if present
    if (body.tools && body.tools.length > 0) {
      converseInput.toolConfig = {
        tools: body.tools.map((tool: any) => ({
          toolSpec: {
            name: tool.name,
            description: tool.description || '',
            inputSchema: { json: (() => {
              const raw = tool.input_schema || {};
              return raw.type ? raw : { type: 'object', properties: {}, ...raw };
            })() }
          }
        }))
      };
    }

    // Add thinking configuration if enabled
    if (body.thinking?.type === 'enabled') {
      (converseInput as any).performanceConfig = {
        latency: 'standard'
      };
      // Bedrock Converse API uses additionalModelRequestFields for thinking
      (converseInput as any).additionalModelRequestFields = {
        thinking: {
          type: 'enabled',
          budget_tokens: body.thinking.budget_tokens || 10000
        }
      };
    }

    this.logger.info({
      modelId,
      messageCount: converseInput.messages?.length,
      hasTools: !!converseInput.toolConfig,
      hasThinking: !!(converseInput as any).additionalModelRequestFields?.thinking,
      thinkingBudget: (converseInput as any).additionalModelRequestFields?.thinking?.budget_tokens
    }, '🔵 [CONVERSE-API] Starting ConverseStream request');

    const command = new ConverseStreamCommand(converseInput);
    const response = await this.runtimeClient!.send(command);

    if (!response.stream) {
      throw new Error('No stream in Converse API response');
    }

    let totalTokens = 0;
    let blockIndex = 0;

    // Emit message_start
    yield {
      id: `bedrock-converse-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null
      }]
    };

    for await (const event of response.stream) {
      this.logger.debug({
        eventKeys: Object.keys(event),
        hasContentBlockStart: !!event.contentBlockStart,
        hasContentBlockDelta: !!event.contentBlockDelta,
        hasContentBlockStop: !!event.contentBlockStop,
        hasMessageStop: !!event.messageStop,
        hasMetadata: !!event.metadata
      }, '🔍 [CONVERSE-RAW] Stream event');

      // Handle content block start
      if (event.contentBlockStart) {
        const start = event.contentBlockStart;
        blockIndex = start.contentBlockIndex ?? blockIndex;

        // Determine block type from start event
        if (start.start?.toolUse) {
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: start.start.toolUse.toolUseId,
              name: start.start.toolUse.name
            }
          };
          this.logger.debug({ index: blockIndex, toolName: start.start.toolUse.name }, '[CONVERSE] tool_use block start');
        } else if ((start.start as any)?.reasoningContent) {
          // Extended thinking/reasoning block
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'thinking' }
          };
          this.logger.debug({ index: blockIndex }, '[CONVERSE] thinking block start');
        } else {
          // Default to text block
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'text' }
          };
          this.logger.debug({ index: blockIndex }, '[CONVERSE] text block start');
        }
      }

      // Handle content block delta
      if (event.contentBlockDelta) {
        const delta = event.contentBlockDelta;
        const idx = delta.contentBlockIndex ?? blockIndex;

        if (delta.delta?.text) {
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'text_delta',
              text: delta.delta.text
            }
          };
        } else if (delta.delta?.toolUse) {
          // Tool use delta - the input comes as partial JSON string
          const partialJson = (delta.delta.toolUse as any).input || '';
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'input_json_delta',
              partial_json: partialJson
            }
          };
        } else if ((delta.delta as any)?.reasoningContent) {
          // Extended thinking/reasoning delta (Converse API uses reasoningContent)
          const reasoning = (delta.delta as any).reasoningContent;
          const thinkingText = reasoning?.text || reasoning || '';
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'thinking_delta',
              thinking: thinkingText
            }
          };
          this.logger.debug({ index: idx, length: thinkingText.length }, '[CONVERSE] thinking delta');
        }
      }

      // Handle content block stop
      if (event.contentBlockStop) {
        yield {
          type: 'content_block_stop',
          index: event.contentBlockStop.contentBlockIndex ?? blockIndex
        };
        blockIndex++;
      }

      // Handle message stop with usage
      if (event.messageStop) {
        const stopReason = event.messageStop.stopReason;
        yield {
          id: `bedrock-converse-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: stopReason === 'tool_use' ? 'tool_calls' : 'stop'
          }]
        };
      }

      // Handle metadata (usage info including cache metrics)
      if (event.metadata) {
        const usage = event.metadata.usage;
        if (usage) {
          totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);

          // Log cache metrics if available (Bedrock prompt caching)
          const cacheReadTokens = (usage as any).cacheReadInputTokenCount || 0;
          const cacheWriteTokens = (usage as any).cacheWriteInputTokenCount || 0;

          if (cacheReadTokens > 0 || cacheWriteTokens > 0) {
            const cacheSavings = cacheReadTokens > 0
              ? Math.round((cacheReadTokens / (usage.inputTokens || 1)) * 100)
              : 0;
            this.logger.info({
              cacheReadTokens,
              cacheWriteTokens,
              totalInputTokens: usage.inputTokens,
              cacheSavingsPercent: cacheSavings
            }, `💾 [CONVERSE] Cache metrics: ${cacheSavings}% of input tokens from cache`);
          }

          yield {
            id: `bedrock-converse-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{ index: 0, delta: {}, finish_reason: null }],
            usage: {
              prompt_tokens: usage.inputTokens || 0,
              completion_tokens: usage.outputTokens || 0,
              total_tokens: totalTokens,
              // Include cache metrics in response for downstream tracking
              cache_read_tokens: cacheReadTokens,
              cache_write_tokens: cacheWriteTokens
            }
          };
        }
      }
    }

    const latency = Date.now() - startTime;
    const cost = this.estimateCost(modelId, totalTokens);
    this.trackSuccess(latency, totalTokens, cost);
  }

  /**
   * Convert internal message format to Converse API message format
   */
  private convertToConverseMessages(messages: any[]): BedrockMessage[] {
    const result: BedrockMessage[] = [];

    // Defensive: ensure messages is iterable (failover paths may pass non-array)
    if (!Array.isArray(messages)) {
      if (messages && typeof messages === 'object') {
        // Single message object — wrap in array
        messages = [messages];
      } else {
        return result;
      }
    }

    for (const msg of messages) {
      if (msg.role === 'system') continue; // System handled separately

      const content: ContentBlock[] = [];

      // Handle array content (already has content blocks)
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          // Handle blocks with explicit type='text'
          if (block.type === 'text') {
            content.push({ text: block.text });
          }
          // CRITICAL FIX: Handle Nova-style blocks that have {text: ...} without type property
          // This happens when messages pass through convertToBedrock for Nova before reaching here
          else if (block.text !== undefined && !block.type) {
            content.push({ text: block.text });
          } else if (block.type === 'tool_use') {
            content.push({
              toolUse: {
                toolUseId: block.id,
                name: block.name,
                input: block.input || {}
              }
            });
          } else if (block.type === 'tool_result') {
            content.push({
              toolResult: {
                toolUseId: block.tool_use_id,
                content: [{ text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) }]
              }
            });
          }
          // Skip thinking/redacted_thinking blocks for now
        }
      } else if (typeof msg.content === 'string' && msg.content) {
        content.push({ text: msg.content });
      }

      // Handle tool_calls from OpenAI format
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input = {};
          try {
            input = JSON.parse(tc.function?.arguments || '{}');
          } catch { /* ignore */ }
          content.push({
            toolUse: {
              toolUseId: tc.id,
              name: tc.function?.name || '',
              input
            }
          });
        }
      }

      if (content.length > 0) {
        result.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content
        });
      }
    }

    return result;
  }

  private convertToBedrock(request: CompletionRequest, modelId: string): any {
    // Anthropic Claude models
    if (modelId.includes('anthropic.claude')) {
      const systemMessages = request.messages.filter(m => m.role === 'system');
      const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

      // Check if thinking mode is enabled for this request
      const thinkingEnabled = (request as any).thinking?.type === 'enabled';

      // Convert messages to Anthropic format with proper tool handling
      const convertedMessages: any[] = [];

      for (let i = 0; i < nonSystemMessages.length; i++) {
        const m = nonSystemMessages[i];

        // Check if content is already array-formatted (from previous turns with thinking/tool_use)
        const isArrayContent = Array.isArray(m.content);

        // Skip messages with empty content (except for assistant messages with tool_calls or last assistant message)
        const hasContent = isArrayContent ? m.content.length > 0 : (m.content && m.content.trim());
        const hasToolCalls = m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0;
        const isLastAssistant = i === nonSystemMessages.length - 1 && m.role === 'assistant';

        if (!hasContent && !hasToolCalls && !isLastAssistant) {
          continue;
        }

        // Handle assistant messages with array-format content (already has thinking/tool_use blocks)
        if (m.role === 'assistant' && isArrayContent) {
          let contentBlocks: any[] = [...m.content];

          // When thinking is enabled, Claude requires assistant messages to start with thinking block
          // Check if first block is already a thinking block
          const hasThinkingBlock = contentBlocks.some((b: any) =>
            b.type === 'thinking' || b.type === 'redacted_thinking'
          );
          const hasToolUseBlock = contentBlocks.some((b: any) => b.type === 'tool_use');

          // NOTE: We previously tried to inject fake redacted_thinking blocks here, but that fails
          // because redacted_thinking blocks require valid encrypted 'data' from actual API responses.
          // Instead, we should NOT inject any thinking blocks - the model will handle it.
          // If this causes issues, the solution is to disable thinking for requests with
          // message history that doesn't have thinking blocks (can't toggle mid-conversation).
          if (thinkingEnabled && hasToolUseBlock && !hasThinkingBlock) {
            this.logger.debug({ messageIndex: i }, 'Assistant message has tool_use but no thinking block - not injecting fake blocks');
          }

          // Sanitize content blocks before sending to Bedrock
          for (const block of contentBlocks) {
            // IMPORTANT: Keep 'data' field on existing redacted_thinking blocks!
            // When resending messages from previous turns, the 'data' field contains
            // encrypted thinking content that Claude needs for conversation continuity.
            // We do NOT delete block.data - it breaks multi-turn conversations.

            // CRITICAL: Ensure tool_use.input is ALWAYS a valid dictionary
            // Bedrock rejects requests where tool_use.input is not a plain object
            if (block.type === 'tool_use') {
              let input = block.input;

              if (typeof input === 'string') {
                // Try to parse JSON string
                try {
                  const parsed = JSON.parse(input);
                  input = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                    ? parsed
                    : { value: parsed };
                } catch {
                  input = { raw: input };
                }
              } else if (input === null || input === undefined) {
                input = {};
              } else if (Array.isArray(input)) {
                input = { items: input };
              } else if (typeof input !== 'object') {
                input = { value: input };
              } else {
                // Clone to ensure plain object (no prototype issues)
                try {
                  input = JSON.parse(JSON.stringify(input));
                } catch {
                  input = {};
                }
              }

              block.input = input;
            }
          }

          convertedMessages.push({
            role: 'assistant',
            content: contentBlocks
          });
          continue;
        }

        // Handle assistant messages with tool calls (from OpenAI format)
        if (m.role === 'assistant' && hasToolCalls) {
          const contentBlocks: any[] = [];

          // NOTE: We previously tried to inject fake redacted_thinking blocks here for
          // thinking-enabled requests, but that fails because redacted_thinking blocks
          // require valid encrypted 'data' from actual API responses.
          // OpenAI-format messages won't have thinking blocks - that's expected.
          // The model will handle this gracefully.
          if (thinkingEnabled) {
            this.logger.debug({ messageIndex: i }, 'OpenAI-format assistant message with tool_calls - not injecting fake thinking blocks');
          }

          // Add text content if present
          if (hasContent) {
            contentBlocks.push({
              type: 'text',
              text: m.content
            });
          }

          // Add tool use blocks
          for (const toolCall of m.tool_calls) {
            // Parse the arguments and SANITIZE to ensure valid dictionary
            let input: any;
            try {
              input = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              input = {};
            }

            // CRITICAL: Ensure input is a valid plain object (dictionary)
            // Bedrock rejects requests where tool_use.input is not a plain object
            if (input === null || input === undefined) {
              input = {};
            } else if (Array.isArray(input)) {
              input = { items: input };
            } else if (typeof input !== 'object') {
              input = { value: input };
            } else {
              // Clone to ensure plain object (no prototype issues)
              try {
                input = JSON.parse(JSON.stringify(input));
              } catch {
                input = {};
              }
            }

            contentBlocks.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function.name,
              input
            });
          }

          convertedMessages.push({
            role: 'assistant',
            content: contentBlocks
          });
          continue;
        }

        // Handle tool result messages
        if (m.role === 'tool') {
          // Tool results must follow assistant messages with tool_calls
          // We need to accumulate consecutive tool messages and send them together
          const toolResults: any[] = [];
          let j = i;

          while (j < nonSystemMessages.length && nonSystemMessages[j].role === 'tool') {
            const toolMsg = nonSystemMessages[j];
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolMsg.tool_call_id,
              content: toolMsg.content || ''
            });
            j++;
          }

          // Add all tool results as a single user message
          convertedMessages.push({
            role: 'user',
            content: toolResults
          });

          // Skip the processed tool messages
          i = j - 1;
          continue;
        }

        // Handle regular user and assistant messages
        convertedMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content || ''
        });
      }

      // Bedrock Claude doesn't allow both temperature and top_p - only use temperature
      // But top_k is always supported for Claude
      // CRITICAL: top_k must NOT be set when thinking is enabled
      // See: https://docs.claude.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking
      // Note: thinkingEnabled already declared above at line ~951

      const bedrockRequest: any = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: request.max_tokens || 32768,
        temperature: request.temperature !== undefined ? request.temperature : 1.0,
        // top_p: not supported when temperature is set for Bedrock Claude
        // top_k: optional, but MUST be unset when thinking is enabled
        ...(request.top_k !== undefined && !thinkingEnabled && { top_k: request.top_k }),
        messages: convertedMessages
      };

      // =========================================================================
      // PROMPT CACHING - Cache system prompts for 75%+ cost savings
      // See: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
      // =========================================================================
      const enableCaching = this.config?.enablePromptCaching ??
                           process.env.AWS_BEDROCK_ENABLE_CACHING === 'true';

      if (systemMessages.length > 0) {
        const systemContent = systemMessages[0].content;
        if (enableCaching && typeof systemContent === 'string' && systemContent.length >= 1024) {
          // Add cache_control to system prompt for Claude models
          // Requires minimum 1024 tokens for Sonnet, 4096 for Opus/Haiku
          bedrockRequest.system = [
            {
              type: 'text',
              text: systemContent,
              cache_control: { type: 'ephemeral' }
            }
          ];
          this.logger.info({
            systemLength: systemContent.length,
            caching: true
          }, '💾 [BEDROCK] System prompt caching enabled');
        } else {
          bedrockRequest.system = systemContent;
        }
      }

      // Add extended thinking support for Claude (if requested via thinking parameter)
      // See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
      if ((request as any).thinking?.type === 'enabled') {
        // Priority: request.thinking.budget_tokens > provider config > default
        const thinkingBudget = (request as any).thinking?.budget_tokens ||
                              (this.config as any)?.thinkingBudget ||
                              10000;
        bedrockRequest.thinking = {
          type: 'enabled',
          budget_tokens: thinkingBudget
        };
        // CRITICAL: Claude requires temperature=1 when thinking is enabled
        // https://docs.claude.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking
        bedrockRequest.temperature = 1;

        // CRITICAL: max_tokens MUST be greater than thinking.budget_tokens
        // https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size
        if (bedrockRequest.max_tokens <= thinkingBudget) {
          bedrockRequest.max_tokens = thinkingBudget + 4096; // Add 4096 for response tokens
        }

        // Add interleaved thinking beta header for Claude 4+ models
        // This enables thinking between tool calls and more sophisticated reasoning
        // See: https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html
        const isClaude4Plus = modelId.includes('claude-4') ||
                              modelId.includes('claude-sonnet-4') ||
                              modelId.includes('claude-opus-4') ||
                              modelId.includes('claude-haiku-4');
        if (isClaude4Plus) {
          bedrockRequest.anthropic_beta = ['interleaved-thinking-2025-05-14'];
        }

        this.logger.info({
          modelId,
          thinking_budget: bedrockRequest.thinking.budget_tokens,
          max_tokens: bedrockRequest.max_tokens,
          temperatureOverride: 'Set to 1 (required for extended thinking)',
          interleavedThinking: isClaude4Plus
        }, '[AWSBedrockProvider] 🧠 Extended thinking enabled for Claude via Bedrock');
      }

      // DEBUG: Log tool status at entry point
      if (!request.tools || request.tools.length === 0) {
        this.logger.warn({
          modelId,
          requestKeys: Object.keys(request),
          hasMessagesArray: Array.isArray(request.messages),
          messageCount: request.messages?.length || 0,
        }, '[AWSBedrockProvider] ⚠️ NO TOOLS in request - model may generate XML tool calls instead of using native tool_use');
      }

      // Add tools if provided (Claude supports tools via Bedrock)
      if (request.tools && request.tools.length > 0) {
        bedrockRequest.tools = request.tools.map((tool: any, index: number) => {
          const toolDef: any = {
            name: tool.function?.name || tool.name,
            description: tool.function?.description || tool.description || '',
            input_schema: (() => {
              const raw = tool.function?.parameters || tool.input_schema || {};
              // Bedrock API requires input_schema to have "type" field
              // Some MCP tools (e.g. from FastMCP) emit empty schemas {} without "type": "object"
              return raw.type ? raw : { type: 'object', properties: {}, ...raw };
            })()
          };

          // Add cache_control to last tool definition for tool schema caching
          // This caches all preceding tools as a prefix
          if (enableCaching && index === request.tools!.length - 1) {
            toolDef.cache_control = { type: 'ephemeral' };
          }

          return toolDef;
        });

        if (enableCaching && request.tools.length > 0) {
          this.logger.info({
            toolCount: request.tools.length,
            caching: true
          }, '💾 [BEDROCK] Tool definitions caching enabled');
        }

        // DEBUG: Log tool configuration for troubleshooting
        this.logger.info({
          toolCount: bedrockRequest.tools.length,
          toolNames: bedrockRequest.tools.map((t: any) => t.name),
          firstToolSchema: bedrockRequest.tools[0] ? {
            name: bedrockRequest.tools[0].name,
            hasInputSchema: !!bedrockRequest.tools[0].input_schema,
            inputSchemaType: bedrockRequest.tools[0].input_schema?.type,
          } : null,
        }, '[AWSBedrockProvider] 🔧 Tools configured for request');

        // Map tool_choice to Bedrock format
        if (request.tool_choice) {
          if (request.tool_choice === 'auto') {
            bedrockRequest.tool_choice = { type: 'auto' };
          } else if (request.tool_choice === 'none') {
            bedrockRequest.tool_choice = { type: 'none' };
          } else if (typeof request.tool_choice === 'object' && request.tool_choice.function) {
            bedrockRequest.tool_choice = {
              type: 'tool',
              name: request.tool_choice.function.name
            };
          }
        } else {
          bedrockRequest.tool_choice = { type: 'auto' };
        }
      }

      return bedrockRequest;
    }

    // Amazon Titan models
    if (modelId.includes('amazon.titan')) {
      const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');

      return {
        inputText: prompt,
        textGenerationConfig: {
          temperature: request.temperature || 0.7,
          topP: request.top_p || 1,
          maxTokenCount: request.max_tokens || 4096
        }
      };
    }

    // AI21 Jurassic models
    if (modelId.includes('ai21.j2')) {
      const prompt = request.messages.map(m => m.content).join('\n');

      return {
        prompt,
        temperature: request.temperature || 0.7,
        topP: request.top_p || 1,
        maxTokens: request.max_tokens || 4096
      };
    }

    // Meta Llama models
    if (modelId.includes('meta.llama')) {
      const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');

      return {
        prompt,
        temperature: request.temperature || 0.7,
        top_p: request.top_p || 1,
        max_gen_len: request.max_tokens || 4096
      };
    }

    // Amazon Nova models (nova-micro, nova-lite, nova-pro)
    // Nova uses a messages format similar to Claude/OpenAI
    if (modelId.includes('amazon.nova') || modelId.includes('nova-micro') || modelId.includes('nova-lite') || modelId.includes('nova-pro')) {
      const systemMessages = request.messages.filter(m => m.role === 'system');
      const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

      // Convert messages to Nova format
      const convertedMessages = nonSystemMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: m.content || '' }]
      }));

      const novaRequest: any = {
        messages: convertedMessages,
        inferenceConfig: {
          temperature: request.temperature ?? 0.7,
          topP: request.top_p ?? 0.9,
          maxTokens: request.max_tokens || 1024
        }
      };

      // Add system prompt if present
      if (systemMessages.length > 0) {
        novaRequest.system = [{
          text: systemMessages.map(s => s.content).join('\n')
        }];
      }

      this.logger.debug({
        modelId,
        messageCount: convertedMessages.length,
        hasSystem: systemMessages.length > 0
      }, '[AWSBedrockProvider] 🚀 Nova model request');

      return novaRequest;
    }

    // Default format (works for most models)
    return {
      prompt: request.messages.map(m => m.content).join('\n'),
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 4096
    };
  }

  private parseBedrockResponse(modelId: string, responseBody: any): CompletionResponse {
    // Anthropic Claude
    if (modelId.includes('anthropic.claude')) {
      const message: any = {
        role: 'assistant',
        content: ''
      };

      // Extract text content and tool calls from response
      if (responseBody.content && Array.isArray(responseBody.content)) {
        const textContent = responseBody.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('');

        message.content = textContent || responseBody.completion || '';

        // Extract tool calls
        const toolUseBlocks = responseBody.content.filter((block: any) => block.type === 'tool_use');
        if (toolUseBlocks.length > 0) {
          message.tool_calls = toolUseBlocks.map((block: any, index: number) => ({
            id: block.id || `call_${Date.now()}_${index}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          }));
        }
      } else {
        message.content = responseBody.completion || '';
      }

      return {
        id: responseBody.id || `bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          message,
          finish_reason: responseBody.stop_reason || 'stop'
        }],
        usage: {
          prompt_tokens: responseBody.usage?.input_tokens || 0,
          completion_tokens: responseBody.usage?.output_tokens || 0,
          total_tokens: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0)
        }
      };
    }

    // Amazon Titan
    if (modelId.includes('amazon.titan')) {
      return {
        id: `bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: responseBody.results?.[0]?.outputText || ''
          },
          finish_reason: responseBody.results?.[0]?.completionReason || 'stop'
        }],
        usage: {
          prompt_tokens: responseBody.inputTextTokenCount || 0,
          completion_tokens: responseBody.results?.[0]?.tokenCount || 0,
          total_tokens: (responseBody.inputTextTokenCount || 0) + (responseBody.results?.[0]?.tokenCount || 0)
        }
      };
    }

    // Amazon Nova models
    if (modelId.includes('amazon.nova') || modelId.includes('nova-micro') || modelId.includes('nova-lite') || modelId.includes('nova-pro')) {
      // Nova response format: { output: { message: { role: "assistant", content: [{text: "..."}] } }, usage: {...} }
      const outputMessage = responseBody.output?.message;
      const content = outputMessage?.content?.[0]?.text || '';

      return {
        id: `bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content
          },
          finish_reason: responseBody.stopReason || 'end_turn'
        }],
        usage: {
          prompt_tokens: responseBody.usage?.inputTokens || 0,
          completion_tokens: responseBody.usage?.outputTokens || 0,
          total_tokens: (responseBody.usage?.inputTokens || 0) + (responseBody.usage?.outputTokens || 0)
        }
      };
    }

    // Default format
    return {
      id: `bedrock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: responseBody.completion || responseBody.generated_text || ''
        },
        finish_reason: 'stop'
      }]
    };
  }

  private convertStreamChunk(modelId: string, chunk: any): any {
    if (modelId.includes('anthropic.claude')) {
      // INTERLEAVED THINKING: Pass through content_block_start events
      // These are critical for the UI to create separate thinking/text blocks
      if (chunk.type === 'content_block_start') {
        const blockType = chunk.content_block?.type;
        const blockIndex = chunk.index ?? 0;

        // Log at INFO level so we can see what's happening in production
        this.logger.info({
          index: blockIndex,
          blockType,
          contentBlockKeys: chunk.content_block ? Object.keys(chunk.content_block) : []
        }, '[AWSBedrockProvider] 📦 content_block_start received');

        if (blockType === 'thinking') {
          // Emit content_block_start for thinking - UI will create a thinking block
          return {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'thinking' }
          };
        }

        if (blockType === 'text') {
          // Emit content_block_start for text - UI will create a text block
          return {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'text' }
          };
        }

        if (blockType === 'tool_use') {
          // Emit content_block_start for tool_use
          return {
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: chunk.content_block.id,
              name: chunk.content_block.name
            }
          };
        }

        // Handle 'signature' blocks (used for thinking verification - ignore these)
        if (blockType === 'signature') {
          this.logger.debug({ index: blockIndex }, '[AWSBedrockProvider] 🔐 Ignoring signature content_block_start');
          return null;
        }

        // FALLBACK: If we get content_block_start with unknown type, default to text
        // This prevents losing content blocks due to unrecognized types
        this.logger.warn({
          index: blockIndex,
          blockType,
          contentBlock: chunk.content_block
        }, '[AWSBedrockProvider] ⚠️ Unknown content_block type, defaulting to text');
        return {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'text' }
        };
      }

      // INTERLEAVED THINKING: Pass through content_block_delta events with index
      if (chunk.type === 'content_block_delta') {
        const blockIndex = chunk.index ?? 0;
        const deltaType = chunk.delta?.type || (chunk.delta?.text ? 'text_delta' : 'unknown');

        // Handle thinking content (extended thinking from Claude via Bedrock)
        if (chunk.delta?.type === 'thinking_delta') {
          this.logger.info({
            index: blockIndex,
            deltaType: 'thinking_delta',
            contentLength: chunk.delta.thinking?.length || 0
          }, '[AWSBedrockProvider] 🧠 content_block_delta (thinking)');

          // Emit as content_block_delta with index for interleaved display
          return {
            type: 'content_block_delta',
            index: blockIndex,
            delta: {
              type: 'thinking_delta',
              thinking: chunk.delta.thinking
            }
          };
        }

        // Handle signature delta (thinking block signature for verification)
        if (chunk.delta?.type === 'signature_delta') {
          this.logger.debug({
            signatureLength: chunk.delta.signature?.length || 0
          }, '[AWSBedrockProvider] 🔐 Received thinking signature');
          return null; // Don't emit signature to frontend
        }

        // Handle text content (regular response)
        if (chunk.delta?.type === 'text_delta' || (chunk.delta?.text && !chunk.delta?.type)) {
          this.logger.info({
            index: blockIndex,
            deltaType: 'text_delta',
            contentLength: chunk.delta.text?.length || 0
          }, '[AWSBedrockProvider] 📝 content_block_delta (text)');

          // Emit as content_block_delta with index for interleaved display
          return {
            type: 'content_block_delta',
            index: blockIndex,
            delta: {
              type: 'text_delta',
              text: chunk.delta.text
            }
          };
        }

        // Handle tool use (partial function call arguments)
        if (chunk.delta?.type === 'input_json_delta' || chunk.delta?.partial_json) {
          return {
            type: 'content_block_delta',
            index: blockIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: chunk.delta.partial_json || chunk.delta.input_json || ''
            }
          };
        }

        return null;
      }

      // INTERLEAVED THINKING: Pass through content_block_stop events
      // These tell the UI when a thinking/text block is complete
      if (chunk.type === 'content_block_stop') {
        const blockIndex = chunk.index ?? 0;
        this.logger.info({
          index: blockIndex
        }, '[AWSBedrockProvider] 🏁 content_block_stop');

        return {
          type: 'content_block_stop',
          index: blockIndex
        };
      }

      // Handle message_start (start of streaming)
      if (chunk.type === 'message_start') {
        return {
          id: chunk.message?.id || `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant'
            },
            finish_reason: null
          }]
        };
      }

      // Handle message_stop (end of streaming)
      if (chunk.type === 'message_stop') {
        return {
          id: `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: chunk.stop_reason || 'stop'
          }]
        };
      }

      // Handle message_delta (usage/metadata updates)
      if (chunk.type === 'message_delta') {
        const result: any = {
          id: `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: chunk.delta?.stop_reason || null
          }]
        };

        // Include usage if available
        if (chunk.usage) {
          result.usage = {
            prompt_tokens: chunk.usage.input_tokens || 0,
            completion_tokens: chunk.usage.output_tokens || 0,
            total_tokens: (chunk.usage.input_tokens || 0) + (chunk.usage.output_tokens || 0)
          };
        }

        return result;
      }

      // FALLBACK: Handle Amazon Nova and other models that return content differently
      // Nova models may return content in a 'generation' field or other format
      if (chunk.generation || chunk.outputText || chunk.output?.text || chunk.content) {
        const textContent = chunk.generation || chunk.outputText || chunk.output?.text ||
                           (typeof chunk.content === 'string' ? chunk.content : null);
        if (textContent) {
          this.logger.debug({
            contentLength: textContent.length,
            source: chunk.generation ? 'generation' : chunk.outputText ? 'outputText' : 'content'
          }, '[AWSBedrockProvider] 📝 Extracted text from non-Anthropic format');

          return {
            id: `bedrock-stream-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
              index: 0,
              delta: {
                content: textContent
              },
              finish_reason: null
            }]
          };
        }
      }

      // Log unhandled chunk types for debugging
      this.logger.warn({
        chunkType: chunk.type,
        chunkKeys: Object.keys(chunk),
        modelId
      }, '[AWSBedrockProvider] ⚠️ Unhandled chunk type');

    }

    // For non-Claude models, try to extract content from various fields
    if (chunk.generation || chunk.outputText || chunk.output?.text) {
      const textContent = chunk.generation || chunk.outputText || chunk.output?.text;
      return {
        id: `bedrock-stream-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          delta: {
            content: textContent
          },
          finish_reason: null
        }]
      };
    }

    return null;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    if (!this.initialized || !this.bedrockClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    // DB-only: return models from provider_config.models + config model fields
    const models: Array<{ id: string; name: string; provider: string }> = [];
    const addedModels = new Set<string>();

    // Helper to add model if not already added
    const addModel = (modelId: string | undefined) => {
      if (!modelId || addedModels.has(modelId)) return;
      addedModels.add(modelId);
      models.push({ id: modelId, name: modelId, provider: 'aws-bedrock' });
    };

    // Add models from DB config fields (set during initialize from ProviderConfigService)
    addModel(this.config?.chatModel || this.config?.modelId);
    addModel(this.config?.embeddingModel);
    addModel(this.config?.visionModel);
    addModel(this.config?.imageModel);
    addModel(this.config?.compactionModel);

    // Add database-configured models array (from admin API / provider_config.models)
    const dbConfiguredModels = (this.config as any)?.models as any[];
    if (Array.isArray(dbConfiguredModels)) {
      for (const dbModel of dbConfiguredModels) {
        if (dbModel.id && !addedModels.has(dbModel.id)) {
          addedModels.add(dbModel.id);
          models.push({
            id: dbModel.id,
            name: dbModel.name || dbModel.id,
            provider: 'aws-bedrock',
          } as any);
        }
      }
    }

    this.logger.info({
      modelCount: models.length,
      models: models.map(m => m.id),
    }, '[AWSBedrockProvider] Listed models from DB config');

    return models;
  }

  /**
   * Get detailed model information from AWS Bedrock API using GetFoundationModelCommand.
   * Returns provider defaults for the model. Results NOT cached — call sparingly.
   */
  async getModelDefaults(modelId: string): Promise<Partial<import('./ILLMProvider.js').ProviderDefaultConfig> | null> {
    if (!this.initialized || !this.bedrockClient) {
      return null;
    }

    try {
      // Strip cross-region prefix for API call (e.g., us.anthropic.claude-... → anthropic.claude-...)
      const baseModelId = modelId.replace(/^(us|eu|apac)\./, '');
      const command = new GetFoundationModelCommand({ modelIdentifier: baseModelId });
      const response = await this.bedrockClient.send(command);
      const details = response.modelDetails;

      if (!details) {
        this.logger.warn({ modelId }, '[AWSBedrockProvider] GetFoundationModel returned no details');
        return null;
      }

      this.logger.debug({
        modelId: details.modelId,
        modelName: details.modelName,
        providerName: details.providerName,
        inputModalities: details.inputModalities,
        outputModalities: details.outputModalities,
        streaming: details.responseStreamingSupported,
        inferenceTypes: details.inferenceTypesSupported
      }, '[AWSBedrockProvider] Retrieved model details');

      const result: Partial<import('./ILLMProvider.js').ProviderDefaultConfig> = {};
      const providerName = details.providerName?.toLowerCase() || '';

      if (providerName === 'anthropic') {
        result.supportsTopK = true;
        result.supportsFreqPenalty = false;
        result.supportsThinking = true;
        result.thinkingMode = 'budget';
        result.temperature = 1.0;
        result.topP = 0.999;
        result.topK = 40;
        result.maxTokens = 8192;
        result.extendedThinkingEnabled = true;
        result.thinkingBudget = 10000;
        result.temperatureRange = [0, 1];
        result.maxTokensRange = [256, 128000];
        result.topKRange = [1, 500];
      } else if (providerName === 'meta') {
        result.supportsTopK = true;
        result.supportsThinking = false;
        result.temperature = 0.7;
        result.topP = 0.9;
        result.maxTokens = 4096;
        result.temperatureRange = [0, 1];
        result.maxTokensRange = [256, 131072];
      } else if (providerName === 'amazon') {
        result.supportsThinking = false;
        result.temperature = 0.7;
        result.topP = 0.9;
        result.maxTokens = 4096;
        result.temperatureRange = [0, 1];
        result.maxTokensRange = [256, 8192];
      } else if (providerName.includes('mistral')) {
        result.supportsThinking = false;
        result.temperature = 0.7;
        result.topP = 1.0;
        result.maxTokens = 8192;
        result.temperatureRange = [0, 1];
        result.maxTokensRange = [256, 8192];
      }

      // Store extra info for UI display
      (result as any).modelName = details.modelName;
      (result as any).providerName = details.providerName;
      (result as any).inputModalities = details.inputModalities;
      (result as any).outputModalities = details.outputModalities;
      (result as any).inferenceTypesSupported = details.inferenceTypesSupported;
      (result as any).responseStreamingSupported = details.responseStreamingSupported;

      return result;
    } catch (err: any) {
      this.logger.warn({ modelId, error: err.message }, '[AWSBedrockProvider] Failed to get model defaults');
      return null;
    }
  }

  /**
   * Generate text embeddings using Amazon Titan Embedding models
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    if (!this.initialized || !this.runtimeClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    const embeddingModel = process.env.AWS_BEDROCK_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL;
    if (!embeddingModel) {
      throw new Error('AWS Bedrock embedding model not configured (AWS_BEDROCK_EMBEDDING_MODEL)');
    }
    const texts = Array.isArray(text) ? text : [text];
    const embeddings: number[][] = [];

    for (const inputText of texts) {
      // Prepare request body for Titan embedding model
      const body = {
        inputText: inputText,
        dimensions: parseInt(process.env.AWS_BEDROCK_EMBEDDING_DIMENSION || process.env.EMBEDDING_DIMENSION || '1024'),
        normalize: true
      };

      const command = new InvokeModelCommand({
        modelId: embeddingModel,
        body: JSON.stringify(body),
        contentType: 'application/json',
        accept: 'application/json'
      });

      try {
        const response = await this.runtimeClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        // Titan returns: { embedding: number[], inputTextTokenCount: number }
        if (responseBody.embedding && Array.isArray(responseBody.embedding)) {
          embeddings.push(responseBody.embedding);
        } else {
          throw new Error('Invalid embedding response from Titan model');
        }
      } catch (error) {
        this.logger.error({
          error: error instanceof Error ? error.message : error,
          model: embeddingModel,
          textLength: inputText.length
        }, 'Failed to generate embedding');
        throw error;
      }
    }

    // Return single array if input was string, array of arrays if input was array
    return Array.isArray(text) ? embeddings : embeddings[0];
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.initialized || !this.bedrockClient) {
      return {
        status: 'not_initialized',
        provider: this.name,
        lastChecked: new Date()
      };
    }

    try {
      // Simple health check - list models
      await this.bedrockClient.send(new ListFoundationModelsCommand({}));

      return {
        status: 'healthy',
        provider: this.name,
        endpoint: this.config?.endpoint,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.config?.endpoint,
        error: error instanceof Error ? error.message : String(error),
        lastChecked: new Date()
      };
    }
  }

  private estimateCost(modelId: string, tokens: number): number {
    // Cost tracking is handled centrally by LLMMetricsService
    // Return 0 here - actual costs are calculated and stored when logging metrics
    return 0;
  }

  /**
   * Discover models available from AWS Bedrock.
   * Tries live API discovery first (ListFoundationModels), falls back to hardcoded catalog.
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    // Build set of already-configured model IDs for marking
    const configuredIds = new Set<string>();
    try {
      const existing = await this.listModels();
      for (const m of existing) configuredIds.add(m.id);
    } catch { /* ignore */ }

    let models: DiscoveredModel[];

    // Try live discovery from AWS API
    try {
      if (!this.initialized || !this.bedrockClient) {
        throw new Error('Bedrock client not initialized');
      }

      // Check cache first
      const now = Date.now();
      if (this.foundationModelCache && (now - this.foundationModelCache.timestamp) < AWSBedrockProvider.MODEL_CACHE_TTL_MS) {
        this.logger.debug('Using cached foundation model list');
      } else {
        const command = new ListFoundationModelsCommand({});
        const response = await this.bedrockClient.send(command);
        this.foundationModelCache = {
          models: response.modelSummaries || [],
          timestamp: now,
        };
        this.logger.info({ count: this.foundationModelCache.models.length }, '[AWSBedrockProvider] Fetched live foundation models from AWS');
      }

      models = this.foundationModelCache.models
        .filter((m: any) => {
          // Only ON_DEMAND inference, exclude LEGACY
          const inferenceTypes = m.inferenceTypesSupported || [];
          if (!inferenceTypes.includes('ON_DEMAND')) return false;
          if (m.modelLifecycle?.status === 'LEGACY') return false;
          // Only include text-generating, embedding, and image models
          const outputModalities = m.outputModalities || [];
          if (!outputModalities.includes('TEXT') && !outputModalities.includes('EMBEDDING') && !outputModalities.includes('IMAGE')) return false;
          return true;
        })
        .map((m: any): DiscoveredModel => {
          const modelId = m.modelId || '';
          const inputModalities = m.inputModalities || [];
          const outputModalities = m.outputModalities || [];
          const providerName = (m.providerName || '').toLowerCase();

          // Infer capabilities
          const hasVision = inputModalities.includes('IMAGE');
          const hasChat = outputModalities.includes('TEXT');
          const hasEmbeddings = outputModalities.includes('EMBEDDING');
          const hasImageGen = outputModalities.includes('IMAGE') && !inputModalities.includes('TEXT');
          const hasStreaming = m.responseStreamingSupported !== false;

          // Infer thinking from model ID (claude-4+ and claude-3.7+ support thinking)
          const hasThinking = modelId.includes('claude-opus-4') || modelId.includes('claude-sonnet-4') ||
                              modelId.includes('claude-haiku-4') || modelId.includes('claude-3-7');

          // Infer tools support (Claude, Nova, Llama support tools)
          const hasTools = providerName === 'anthropic' || modelId.includes('nova-pro') ||
                          modelId.includes('nova-lite') || modelId.includes('nova-micro') ||
                          modelId.includes('llama');

          // Infer cost tier from provider
          let costTier: DiscoveredModel['costTier'] = 'mid';
          if (modelId.includes('opus')) costTier = 'premium';
          else if (modelId.includes('haiku') || modelId.includes('micro') || modelId.includes('lite')) costTier = 'low';
          else if (modelId.includes('sonnet') || modelId.includes('pro')) costTier = 'high';
          else if (modelId.includes('nova-canvas') || modelId.includes('titan-embed')) costTier = 'low';

          // Infer family
          let family = providerName;
          if (modelId.includes('claude-opus-4-6') || modelId.includes('claude-sonnet-4-6')) family = 'claude-4.6';
          else if (modelId.includes('claude') && modelId.includes('4-5')) family = 'claude-4.5';
          else if (modelId.includes('claude') && (modelId.includes('4-1') || modelId.includes('4-20'))) family = 'claude-4';
          else if (modelId.includes('claude-3')) family = 'claude-3';
          else if (modelId.includes('nova')) family = 'nova';
          else if (modelId.includes('titan')) family = 'titan';
          else if (modelId.includes('llama')) family = 'llama';
          else if (modelId.includes('mistral')) family = 'mistral';

          return {
            id: modelId,
            name: m.modelName || modelId,
            provider: 'aws-bedrock',
            description: `${m.providerName || 'Unknown'} — ${m.modelName || modelId}`,
            family,
            costTier,
            capabilities: {
              chat: hasChat && !hasEmbeddings,
              vision: hasVision,
              tools: hasTools,
              thinking: hasThinking,
              embeddings: hasEmbeddings,
              imageGeneration: hasImageGen,
              streaming: hasStreaming,
            },
            contextWindow: this.inferContextWindow(modelId),
            maxOutputTokens: this.inferMaxOutputTokens(modelId),
          };
        });

      this.logger.info({ discoveredCount: models.length }, '[AWSBedrockProvider] Live model discovery complete');
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[AWSBedrockProvider] Live discovery failed — returning empty list');
      models = [];
    }

    // Mark configured models
    for (const model of models) {
      model.configured = configuredIds.has(model.id);
    }

    return models;
  }

  /**
   * Infer context window from model ID pattern
   */
  private inferContextWindow(modelId: string): number {
    if (modelId.includes('claude-opus-4-6') || modelId.includes('claude-sonnet-4-6')) return 200000;
    if (modelId.includes('claude') && modelId.includes('4-5')) return 200000;
    if (modelId.includes('claude-3-7')) return 200000;
    if (modelId.includes('claude-3-5')) return 200000;
    if (modelId.includes('claude-3')) return 200000;
    if (modelId.includes('nova-pro') || modelId.includes('nova-lite')) return 300000;
    if (modelId.includes('nova-micro')) return 128000;
    if (modelId.includes('llama-3')) return 128000;
    if (modelId.includes('mistral')) return 32000;
    return 128000;
  }

  /**
   * Infer max output tokens from model ID pattern
   */
  private inferMaxOutputTokens(modelId: string): number {
    if (modelId.includes('claude-opus-4-6') || modelId.includes('claude-sonnet-4-6')) return 128000;
    if (modelId.includes('claude') && modelId.includes('4-5')) return 128000;
    if (modelId.includes('claude') && (modelId.includes('4-1') || modelId.includes('4-20'))) return 128000;
    if (modelId.includes('claude-3-7')) return 128000;
    if (modelId.includes('claude-3-5')) return 8192;
    if (modelId.includes('claude-3')) return 4096;
    if (modelId.includes('nova')) return 5120;
    if (modelId.includes('llama-3')) return 4096;
    return 8192;
  }

  /**
   * Provider-level defaults — reflects Bedrock Claude defaults.
   */
  static getDefaultConfig(): import('./ILLMProvider.js').ProviderDefaultConfig {
    return {
      maxTokens: 8192, temperature: 1.0, topP: 0.999, topK: 40,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: true, thinkingBudget: 10000, thinkingLevel: '',
      supportsTopK: true, supportsFreqPenalty: false, supportsThinking: true,
      thinkingMode: 'budget',
      temperatureRange: [0, 1], maxTokensRange: [256, 128000], topKRange: [1, 500],
      defaultChatModel: 'us.anthropic.claude-sonnet-4-6', defaultEmbeddingModel: '',
    };
  }

  /** Normalize a raw Bedrock chunk into NormalizedStreamEvents. */
  normalizeChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
    return normalizeBedrockChunk(rawChunk, state);
  }

  /**
   * Generate an image using AWS Bedrock (Nova Canvas, Titan Image, Stability AI).
   * Request format auto-detected from model ID.
   */
  async generateImage(request: import('./ILLMProvider.js').ImageGenerationRequest): Promise<import('./ILLMProvider.js').ImageGenerationResponse> {
    if (!this.initialized || !this.runtimeClient) {
      throw new Error('[AWSBedrockProvider] Not initialized — cannot generate image');
    }

    const startTime = Date.now();
    const model = request.model || process.env.AWS_IMAGE_MODEL || 'amazon.nova-canvas-v1:0';
    const [width, height] = (request.size || '1024x1024').split('x').map(Number);

    // Detect request format from model ID
    const modelLower = model.toLowerCase();
    let body: Record<string, unknown>;
    if (modelLower.includes('stability') || modelLower.includes('stable-diffusion')) {
      body = {
        text_prompts: [{ text: request.prompt, weight: 1.0 }],
        cfg_scale: 7,
        steps: 50,
        width: width || 1024,
        height: height || 1024,
        samples: request.n || 1,
      };
    } else {
      // Amazon format (Nova Canvas, Titan Image)
      body = {
        taskType: 'TEXT_IMAGE',
        textToImageParams: { text: request.prompt },
        imageGenerationConfig: {
          numberOfImages: request.n || 1,
          quality: 'standard',
          width: width || 1024,
          height: height || 1024,
        },
      };
    }

    const command = new InvokeModelCommand({
      modelId: model,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await this.runtimeClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const generationTimeMs = Date.now() - startTime;

    // Extract base64 from response (format depends on model)
    const imageBase64 = responseBody.images?.[0]
      || responseBody.artifacts?.[0]?.base64
      || responseBody.image;

    if (!imageBase64) {
      throw new Error(`[AWSBedrockProvider] No image data in Bedrock response for model ${model}`);
    }

    this.logger.info({ model, generationTimeMs }, '[AWSBedrockProvider] Image generated successfully');

    return {
      imageBase64,
      revisedPrompt: request.prompt,
      model,
      provider: this.name,
      format: 'png',
      generationTimeMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Exported normalizer — testable without instantiating the provider
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw AWS Bedrock streaming chunk into NormalizedStreamEvent[].
 *
 * Handles two formats:
 *   Format A — Anthropic-style content_block events (Claude models via InvokeModelWithResponseStream)
 *   Format B — OpenAI-style choices[] events (non-Claude models via Converse API)
 */
export function normalizeBedrockChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
  const events: NormalizedStreamEvent[] = [];

  // Format A: Anthropic-style events have a `type` string field
  if (typeof rawChunk.type === 'string') {
    return normalizeBedrockAnthropicStyleChunk(rawChunk, state, events);
  }

  // Format B: OpenAI-style chunks have a `choices` array or `usage` object
  return normalizeBedrockOpenAIStyleChunk(rawChunk, state, events);
}

/**
 * Handle Anthropic-style content_block events (Format A).
 * These come from the Claude path (InvokeModelWithResponseStream).
 * Mirrors the AnthropicProvider normalizer but with provider = 'aws-bedrock'.
 */
function normalizeBedrockAnthropicStyleChunk(
  rawChunk: any,
  state: NormalizerState,
  events: NormalizedStreamEvent[],
): NormalizedStreamEvent[] {
  const blockTypes = state.blockTypes;

  switch (rawChunk.type) {
    case 'message_start': {
      const msg = rawChunk.message;
      state.inputTokens = msg?.usage?.input_tokens || 0;
      state.model = msg?.model || '';
      state.streamStartEmitted = true;
      events.push({
        type: 'stream_start',
        messageId: msg?.id || '',
        model: state.model,
        provider: 'aws-bedrock',
      });
      break;
    }

    case 'content_block_start': {
      const block = rawChunk.content_block;
      const index: number = rawChunk.index;
      if (block?.type === 'thinking') {
        const id = `tk-${index}`;
        state.thinkingId = id;
        state.thinkingStartTime = Date.now();
        state.thinkingAccumulated = '';
        blockTypes.set(index, { type: 'thinking', id });
        events.push({ type: 'thinking_start', id });
      } else if (block?.type === 'text') {
        const id = `txt-${index}`;
        state.textBlockId = id;
        blockTypes.set(index, { type: 'text', id });
        events.push({ type: 'text_start', id });
      } else if (block?.type === 'tool_use') {
        const id = block.id || `tool-${index}`;
        blockTypes.set(index, { type: 'tool_use', id });
        events.push({ type: 'tool_start', id, toolName: block.name || '', serverName: '' });
      }
      break;
    }

    case 'content_block_delta': {
      const delta = rawChunk.delta;
      const index: number = rawChunk.index;
      const blockInfo = blockTypes.get(index);

      if (delta?.type === 'thinking_delta') {
        state.thinkingAccumulated += delta.thinking || '';
        events.push({
          type: 'thinking_delta',
          id: blockInfo?.id || state.thinkingId || `tk-${index}`,
          content: delta.thinking || '',
          accumulated: state.thinkingAccumulated,
        });
      } else if (delta?.type === 'text_delta') {
        events.push({
          type: 'text_delta',
          id: blockInfo?.id || state.textBlockId || `txt-${index}`,
          content: delta.text || '',
        });
      } else if (delta?.type === 'input_json_delta') {
        const toolId = blockInfo?.id || `tool-${index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: delta.partial_json || '' });
      } else if (delta?.type === 'signature_delta') {
        events.push({
          type: 'redacted_thinking',
          id: state.thinkingId || `tk-${index}`,
          signature: delta.signature,
        });
      }
      break;
    }

    case 'content_block_stop': {
      const index: number = rawChunk.index;
      const blockInfo = blockTypes.get(index);
      if (blockInfo?.type === 'thinking') {
        const elapsed = state.thinkingStartTime ? Date.now() - state.thinkingStartTime : 0;
        events.push({ type: 'thinking_stop', id: blockInfo.id, elapsedMs: elapsed });
        state.thinkingId = null;
        state.thinkingStartTime = null;
        state.thinkingAccumulated = '';
      } else if (blockInfo?.type === 'text') {
        events.push({ type: 'text_stop', id: blockInfo.id });
        state.textBlockId = null;
      } else if (blockInfo?.type === 'tool_use') {
        events.push({ type: 'tool_stop', id: blockInfo.id, result: null, durationMs: 0 });
      }
      blockTypes.delete(index);
      break;
    }

    case 'message_delta': {
      if (rawChunk.usage) {
        const tokensOut = rawChunk.usage.output_tokens || 0;
        events.push({
          type: 'usage',
          tokensIn: state.inputTokens,
          tokensOut,
          cost: 0,
          contextUsed: 0,
          contextMax: 0,
        });
      }
      break;
    }

    case 'message_stop': {
      events.push({ type: 'stream_end', finishReason: 'stop', totalDurationMs: 0 });
      break;
    }

    default:
      // Unknown event — return empty
      break;
  }

  return events;
}

/**
 * Handle OpenAI-style chunks (Format B).
 * These come from the Converse API path (non-Claude models).
 * Emits a synthetic thinking block on the first chunk so every response
 * has a thinking node in the activity tree.
 */
function normalizeBedrockOpenAIStyleChunk(
  rawChunk: any,
  state: NormalizerState,
  events: NormalizedStreamEvent[],
): NormalizedStreamEvent[] {
  const pendingTools = state.pendingTools;

  const choice = rawChunk.choices?.[0];

  // Usage-only chunk (no choices)
  if (!choice && rawChunk.usage) {
    events.push({
      type: 'usage',
      tokensIn: rawChunk.usage.prompt_tokens || 0,
      tokensOut: rawChunk.usage.completion_tokens || 0,
      cost: 0,
      contextUsed: 0,
      contextMax: 0,
    });
    return events;
  }

  if (!choice) return events;

  const delta = choice.delta;
  if (!delta && !choice.finish_reason) return events;

  // -----------------------------------------------------------------------
  // First chunk — role === 'assistant': emit stream_start + synthetic thinking
  // -----------------------------------------------------------------------
  if (delta?.role === 'assistant' && !state.streamStartEmitted) {
    state.streamStartEmitted = true;
    state.model = rawChunk.model || '';
    events.push({
      type: 'stream_start',
      messageId: rawChunk.id || '',
      model: rawChunk.model || '',
      provider: 'aws-bedrock',
    });

    // Emit synthetic thinking block (closed when real content arrives)
    const thinkId = 'tk-synth-0';
    state.thinkingId = thinkId;
    state.thinkingStartTime = Date.now();
    events.push({ type: 'thinking_start', id: thinkId });
    events.push({ type: 'thinking_delta', id: thinkId, content: 'Processing', accumulated: 'Processing' });
    return events;
  }

  // -----------------------------------------------------------------------
  // Helper: close synthetic thinking if still active
  // -----------------------------------------------------------------------
  const closeSyntheticThinking = () => {
    if (state.thinkingId) {
      const elapsed = state.thinkingStartTime ? Date.now() - state.thinkingStartTime : 0;
      events.push({ type: 'thinking_stop', id: state.thinkingId, elapsedMs: elapsed });
      state.thinkingId = null;
      state.thinkingStartTime = null;
    }
  };

  // -----------------------------------------------------------------------
  // Text content delta
  // -----------------------------------------------------------------------
  if (delta?.content) {
    closeSyntheticThinking();
    if (!state.textBlockId) {
      state.textBlockId = 'txt-0';
      events.push({ type: 'text_start', id: state.textBlockId });
    }
    events.push({ type: 'text_delta', id: state.textBlockId, content: delta.content });
  }

  // -----------------------------------------------------------------------
  // Tool call deltas
  // -----------------------------------------------------------------------
  if (delta?.tool_calls) {
    closeSyntheticThinking();
    for (const tc of delta.tool_calls) {
      if (tc.function?.name) {
        const toolId = tc.id || `tool-${tc.index}`;
        pendingTools.set(toolId, tc.function.name);
        state.toolIndexToId.set(tc.index, toolId);
        events.push({ type: 'tool_start', id: toolId, toolName: tc.function.name, serverName: '' });
      }
      if (tc.function?.arguments) {
        const toolId = tc.id || state.toolIndexToId.get(tc.index) || `tool-${tc.index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: tc.function.arguments });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Finish reason
  // -----------------------------------------------------------------------
  if (choice.finish_reason) {
    if (choice.finish_reason === 'tool_calls') {
      for (const [id] of pendingTools) {
        events.push({ type: 'tool_stop', id, result: null, durationMs: 0 });
      }
      pendingTools.clear();
    }

    if (state.textBlockId) {
      events.push({ type: 'text_stop', id: state.textBlockId });
      state.textBlockId = null;
    }

    // Close any still-open synthetic thinking (e.g. response with no content)
    closeSyntheticThinking();

    events.push({
      type: 'stream_end',
      finishReason: choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason,
      totalDurationMs: 0,
    });
  }

  // -----------------------------------------------------------------------
  // Usage embedded in the same chunk
  // -----------------------------------------------------------------------
  if (rawChunk.usage) {
    events.push({
      type: 'usage',
      tokensIn: rawChunk.usage.prompt_tokens || 0,
      tokensOut: rawChunk.usage.completion_tokens || 0,
      cost: 0,
      contextUsed: 0,
      contextMax: 0,
    });
  }

  return events;
}
