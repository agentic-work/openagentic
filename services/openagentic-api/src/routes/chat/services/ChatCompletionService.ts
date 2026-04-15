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
 * Chat Completion Service - Intelligent Model Routing with Azure OpenAI Integration
 *
 * Features:
 * - Intelligent semantic task analysis and model routing
 * - Support for multiple specialized models (reasoning, vision, image generation)
 * - Direct Azure OpenAI connection using MSAL authentication
 * - Automatic token usage tracking and cost monitoring
 * - Comprehensive usage analytics and reporting
 * - Semantic caching for response reuse
 */

import { OpenAI } from 'openai';
import { ClientSecretCredential } from '@azure/identity';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { prisma } from '../../../utils/prisma.js';
import { TokenUsageService, TokenUsageRecord } from '../../../services/TokenUsageService.js';
import { SemanticCacheService } from '../../../services/SemanticCache.js';
import { getRedisClient } from '../../../utils/redis-client.js';
import { TaskAnalysisService, TaskRequirements } from '../../../services/TaskAnalysisService.js';
import { IntelligentModelRouter, RouteDecision } from '../../../services/IntelligentModelRouter.js';
import { ExtendedCapabilitiesService } from '../../../services/ModelCapabilitiesService.js';
import { DynamicModelSelector } from '../../../services/DynamicModelSelector.js';
import type { Logger } from 'pino';

export class ChatCompletionService {
  private azureClients: Map<string, OpenAI> = new Map();
  private azureCredential?: ClientSecretCredential;
  private tokenUsageService: TokenUsageService;
  private taskAnalysisService: TaskAnalysisService;
  private intelligentRouter?: IntelligentModelRouter;
  private hasAzureConfig: boolean;
  private azureEndpoint?: string;
  private azureApiVersion?: string;
  private cacheService?: any;
  private modelEndpoints: Map<string, string> = new Map();

  constructor(private logger: any, cacheService?: any) {
    this.logger = logger.child({ service: 'ChatCompletionService' }) as Logger;
    this.cacheService = cacheService;

    // Initialize services for intelligent routing
    this.tokenUsageService = new TokenUsageService(this.logger);
    this.taskAnalysisService = new TaskAnalysisService(this.logger);

    // Initialize intelligent routing services if possible
    this.initializeIntelligentRouting().catch(error => {
      this.logger.warn({ error }, 'Failed to initialize intelligent routing - will use fallback');
    });

    this.logger.info({
      hasCacheService: !!this.cacheService
    }, 'ChatCompletionService initialized');

    // Load Azure configuration
    this.azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const azureTenantId = process.env.AZURE_TENANT_ID;
    const azureClientId = process.env.AZURE_CLIENT_ID;
    const azureClientSecret = process.env.AZURE_CLIENT_SECRET;
    this.azureApiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';

    this.hasAzureConfig = !!(this.azureEndpoint && azureTenantId && azureClientId && azureClientSecret);

    // Initialize model endpoints mapping
    this.setupModelEndpoints();

    if (!this.hasAzureConfig) {
      this.logger.warn(
        'Azure OpenAI configuration incomplete. Service will not be available. ' +
        'Required: AZURE_OPENAI_ENDPOINT, AZURE_TENANT_ID, AZURE_CLIENT_ID, ' +
        'AZURE_CLIENT_SECRET'
      );
      return;
    }

    // Initialize Azure OpenAI credential with Entra ID authentication
    this.azureCredential = new ClientSecretCredential(
      azureTenantId!,
      azureClientId!,
      azureClientSecret!
    );

    this.logger.info({
      endpoint: this.azureEndpoint,
      apiVersion: this.azureApiVersion,
      hasIntelligentRouting: false // Will be updated after initialization
    }, 'ChatCompletionService initialized with intelligent routing support');
  }

  /**
   * Setup model endpoint mappings dynamically
   * NOTE: This is a legacy service - use ProviderManager instead
   */
  private setupModelEndpoints(): void {
    // No-op: Endpoints are determined dynamically from environment and provider config
    // This legacy service should not be used - ProviderManager handles all routing
    this.logger.debug('Model endpoints: using dynamic provider routing');
  }

  /**
   * Initialize intelligent routing services
   */
  private async initializeIntelligentRouting(): Promise<void> {
    try {
      const capabilitiesService = new ExtendedCapabilitiesService({
        autoDiscovery: true,
        cacheCapabilities: true
      });

      const dynamicSelector = new DynamicModelSelector(
        null, // Azure client will be created per-model
        {},
        this.logger
      );

      this.intelligentRouter = new IntelligentModelRouter(
        capabilitiesService,
        dynamicSelector,
        this.logger
      );

      this.logger.info('Intelligent model routing initialized successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize intelligent routing');
      throw error;
    }
  }

  /**
   * Get or create Azure OpenAI client for specific model
   */
  private async getClientForModel(modelId: string): Promise<OpenAI> {
    // Check if we already have a client for this model
    if (this.azureClients.has(modelId)) {
      const client = this.azureClients.get(modelId)!;
      // Refresh token to ensure it's valid
      if (this.azureCredential) {
        try {
          const token = await this.azureCredential.getToken('https://cognitiveservices.azure.com/.default');
          client.apiKey = token.token;
          (client as any).defaultHeaders['Authorization'] = `Bearer ${token.token}`;
        } catch (error) {
          this.logger.warn({ error, modelId }, 'Failed to refresh Azure token, using existing client');
        }
      }
      return client;
    }

    // Create new client for this model
    if (!this.azureCredential) {
      throw new Error('Azure credential not initialized');
    }

    const token = await this.azureCredential.getToken('https://cognitiveservices.azure.com/.default');
    // Use model ID as deployment name - Azure convention
    const deployment = modelId;
    const endpoint = this.azureEndpoint;

    // Standard chat completions endpoint
    const baseURL = `${endpoint}openai/deployments/${deployment}`;

    const client = new OpenAI({
      apiKey: token.token,
      baseURL,
      defaultQuery: {
        'api-version': this.azureApiVersion
      },
      defaultHeaders: {
        'Authorization': `Bearer ${token.token}`
      }
    });

    // Cache the client
    this.azureClients.set(modelId, client);

    this.logger.info({
      modelId,
      deployment,
      endpoint,
      baseURL
    }, 'Created Azure OpenAI client for model');

    return client;
  }

  /**
   * Get available models from Azure OpenAI deployments
   */
  async getAvailableModels(): Promise<any[]> {
    try {
      // Return all configured model deployments
      const availableModels = [
        {
          id: 'gpt-5-pro-dev',
          object: 'model',
          created: Date.now(),
          owned_by: 'azure-openai',
          capabilities: ['reasoning', 'vision', 'tool_use']
        },
        {
          id: 'gpt-image-1-dev',
          object: 'model',
          created: Date.now(),
          owned_by: 'azure-openai',
          capabilities: ['image_generation']
        },
        {
          id: 'auto',
          object: 'model',
          created: Date.now(),
          owned_by: 'azure-openai',
          capabilities: ['text', 'chat']
        }
      ];

      this.logger.debug({
        modelCount: availableModels.length,
        models: availableModels.map(m => m.id)
      }, 'Retrieved available models');

      return availableModels;
    } catch (error) {
      this.logger.error({ error }, 'Failed to get available models');
      return [];
    }
  }

  /**
   * Get MCP tools for OpenAI function calling format
   * (This stays the same - MCP tools are application-level)
   */
  async getMCPTools(instanceId: string): Promise<any[]> {
    try {
      this.logger.debug({ instanceId }, 'Getting MCP tools for completion');
      // TODO: Implement actual tool formatting from MCP instances
      return [];
    } catch (error) {
      this.logger.error({
        instanceId,
        error: error.message
      }, 'Failed to get MCP tools for completion');
      return [];
    }
  }

  /**
   * Generate a hash for caching completion requests
   * Uses crypto to create deterministic hash from request parameters
   */
  private generateCompletionHash(request: any): string {
    // Create a stable string representation of the key parameters
    const cacheKey = JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_completion_tokens: request.max_tokens || request.maxTokens,
      top_p: request.top_p || request.topP,
      // Don't include tools in hash - tool calls shouldn't be cached
    });

    return createHash('sha256').update(cacheKey).digest('hex');
  }

  /**
   * Create chat completion with intelligent model routing
   * Uses task analysis to determine optimal model for the request
   * Supports specialized models for reasoning, vision, and image generation
   *
   * @param request - The chat completion request
   * @param userToken - Optional user token (not used with direct Azure)
   * @param metadata - Optional metadata for token tracking (userId, sessionId, messageId)
   */
  async createChatCompletion(request: any, userToken?: string, metadata?: {
    userId?: string;
    sessionId?: string;
    messageId?: string;
  }): Promise<any> {
    try {
      // Analyze task requirements to determine optimal model
      const taskAnalysis = await this.analyzeTaskRequirements(request);
      const selectedModel = taskAnalysis.suggestedModel;

      // Get client for the selected model
      const client = await this.getClientForModel(selectedModel);

      this.logger.info({
        requestedModel: request.model,
        selectedModel,
        taskType: taskAnalysis.taskType,
        confidence: taskAnalysis.confidence,
        reasoning: taskAnalysis.reasoning,
        messageCount: request.messages?.length,
        hasTools: !!(request.tools?.length),
        stream: request.stream !== false,
        provider: 'azure-intelligent',
        hasCacheService: !!this.cacheService
      }, 'Creating chat completion with intelligent routing');

      // Check hash-based cache first (faster than semantic cache, only for non-streaming, non-tool requests)
      if (this.cacheService && request.stream === false && !request.tools?.length) {
        const requestHash = this.generateCompletionHash(request);
        const cached = await this.cacheService.getCachedCompletion(requestHash);

        if (cached) {
          this.logger.info({
            hash: requestHash.substring(0, 8),
            cachedModel: cached.model,
            tokensSaved: cached.usage?.total_tokens || 0
          }, 'Hash-based completion cache hit');

          return cached;
        }

        this.logger.debug({
          hash: requestHash.substring(0, 8)
        }, 'Hash-based completion cache miss');
      }

      // Check semantic cache second (only for non-streaming, non-tool requests)
      if (request.stream === false && !request.tools?.length) {
        const redisClient = getRedisClient();
        if (redisClient && redisClient.isConnected()) {
          const semanticCache = new SemanticCacheService(redisClient, this.logger);
          
          // Get the last user message as the prompt for caching
          const lastMessage = request.messages?.[request.messages.length - 1];
          if (lastMessage?.role === 'user' && lastMessage?.content) {
            const cached = await semanticCache.findSimilar(lastMessage.content);
            
            if (cached) {
              this.logger.info({
                similarity: cached.similarity,
                hits: cached.hits,
                tokensSaved: cached.tokens || 0
              }, 'Using semantically cached response');
              
              // Return cached response in OpenAI format
              return {
                id: `cached-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: cached.model || request.model,
                choices: [{
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: cached.response
                  },
                  finish_reason: 'stop'
                }],
                usage: {
                  prompt_tokens: 0,
                  completion_tokens: 0,
                  total_tokens: 0,
                  cached: true,
                  cache_hits: cached.hits
                }
              };
            }
          }
        }
      }

      // Handle image generation requests differently
      if (taskAnalysis.taskType === 'image_generation') {
        return await this.handleImageGeneration(request, selectedModel, metadata);
      }

      // Prepare completion parameters for chat/reasoning/vision tasks
      const completionParams: any = {
        messages: request.messages,
        stream: request.stream !== false,
        // Use selected model for tracking
        model: selectedModel,
        // Pass user ID string for tracking
        user: typeof request.user === 'string'
          ? request.user
          : (request.user?.id || request.user?.userId || metadata?.userId || 'anonymous')
      };

      // Add optional parameters only if explicitly provided
      if (request.temperature !== undefined) completionParams.temperature = request.temperature;
      if (request.max_tokens !== undefined) completionParams.max_completion_tokens = request.max_tokens;
      else if (request.maxTokens !== undefined) completionParams.max_completion_tokens = request.maxTokens;
      if (request.top_p !== undefined) completionParams.top_p = request.top_p;
      else if (request.topP !== undefined) completionParams.top_p = request.topP;
      if (request.frequency_penalty !== undefined) completionParams.frequency_penalty = request.frequency_penalty;
      else if (request.frequencyPenalty !== undefined) completionParams.frequency_penalty = request.frequencyPenalty;
      if (request.presence_penalty !== undefined) completionParams.presence_penalty = request.presence_penalty;
      else if (request.presencePenalty !== undefined) completionParams.presence_penalty = request.presencePenalty;

      // Add tools if available
      if (request.tools && request.tools.length > 0) {
        completionParams.tools = request.tools;
        completionParams.tool_choice = request.tool_choice || request.toolChoice || 'auto';

        this.logger.info({
          toolCount: request.tools.length,
          toolChoice: completionParams.tool_choice,
          toolNames: request.tools.map(t => t.function?.name || t.name).slice(0, 5)
        }, 'Tools configured for Azure OpenAI request');
      }

      // Add response format if specified
      if (request.response_format) {
        completionParams.response_format = request.response_format;
      }

      if (request.stream !== false) {
        // Streaming response
        const stream = await client.chat.completions.create(completionParams) as any;

        this.logger.info('Azure OpenAI streaming response started');

        // Wrap the OpenAI stream to make it compatible with existing CompletionStage logic
        // The CompletionStage expects an axios-style response with response.data event emitter
        return this.wrapOpenAIStreamForCompat(stream, metadata);
      } else {
        // Non-streaming response
        const response = await client.chat.completions.create(completionParams);

        this.logger.info({
          model: response.model,
          usage: response.usage,
          finishReason: response.choices[0]?.finish_reason
        }, 'Azure OpenAI non-streaming response received');
        
        // Track token usage for non-streaming response
        if (response.usage && metadata?.userId && metadata?.sessionId && metadata?.messageId) {
          await this.trackTokenUsageFromResponse(response, {
            userId: metadata.userId!,
            sessionId: metadata.sessionId!,
            messageId: metadata.messageId!
          });
        }

        // Store in hash-based cache if enabled (non-tool responses only)
        if (this.cacheService && !request.tools?.length && response.choices?.[0]?.message?.content) {
          const requestHash = this.generateCompletionHash(request);
          await this.cacheService.cacheCompletion(requestHash, response, 300); // 5 min TTL
          this.logger.debug({
            hash: requestHash.substring(0, 8),
            tokens: response.usage?.total_tokens || 0
          }, 'Completion cached with hash');
        }

        // Store in semantic cache if enabled (non-tool responses only)
        if (!request.tools?.length && response.choices?.[0]?.message?.content) {
          const redisClient = getRedisClient();
          if (redisClient && redisClient.isConnected()) {
            const semanticCache = new SemanticCacheService(redisClient, this.logger);
            const lastMessage = request.messages?.[request.messages.length - 1];
            
            if (lastMessage?.role === 'user' && lastMessage?.content) {
              await semanticCache.store(
                lastMessage.content,
                response.choices[0].message.content,
                response.model,
                response.usage?.total_tokens
              );
            }
          }
        }
        
        return response;
      }

    } catch (error) {
      this.logger.error({
        error: error.message,
        stack: error.stack,
        requestedModel: request.model,
        messageCount: request.messages?.length,
        hasTools: !!(request.tools?.length)
      }, 'Azure OpenAI completion with intelligent routing failed');

      throw error;
    }
  }

  /**
   * Track token usage from a completed response
   */
  private async trackTokenUsageFromResponse(response: any, metadata: { 
    userId: string; 
    sessionId: string; 
    messageId: string; 
  }): Promise<void> {
    try {
      if (response.usage) {
        const tokenRecord: TokenUsageRecord = {
          userId: metadata.userId,
          sessionId: metadata.sessionId,
          messageId: metadata.messageId,
          model: response.model,
          usage: {
            promptTokens: response.usage.prompt_tokens || 0,
            completionTokens: response.usage.completion_tokens || 0,
            totalTokens: response.usage.total_tokens || 0
          }
        };

        await this.tokenUsageService.recordUsage(tokenRecord);
        
        this.logger.debug({
          userId: metadata.userId,
          sessionId: metadata.sessionId,
          messageId: metadata.messageId,
          model: response.model,
          tokens: tokenRecord.usage.totalTokens
        }, 'Token usage tracked from response');
      }
    } catch (error) {
      this.logger.error({ error, metadata }, 'Failed to track token usage from response');
      // Don't throw - token tracking failure shouldn't break chat
    }
  }

  /**
   * Wrap streaming response with token usage tracking
   */
  private async wrapStreamWithTokenTracking(originalStream: any, model: string, metadata: { 
    userId: string; 
    sessionId: string; 
    messageId: string; 
  }): Promise<AsyncGenerator<any, void, unknown>> {
    const self = this;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    
    async function* wrappedStream() {
      try {
        for await (const chunk of originalStream) {
          // Accumulate token usage from streaming chunks
          if (chunk.usage) {
            totalPromptTokens = chunk.usage.prompt_tokens || totalPromptTokens;
            totalCompletionTokens = chunk.usage.completion_tokens || totalCompletionTokens;
            totalTokens = chunk.usage.total_tokens || totalTokens;
          }
          
          yield chunk;
        }
        
        // After stream completes, record token usage
        if (totalTokens > 0 || totalPromptTokens > 0 || totalCompletionTokens > 0) {
          const tokenRecord: TokenUsageRecord = {
            userId: metadata.userId,
            sessionId: metadata.sessionId,
            messageId: metadata.messageId,
            model: model,
            usage: {
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalTokens || (totalPromptTokens + totalCompletionTokens)
            }
          };

          await self.tokenUsageService.recordUsage(tokenRecord);
          
          self.logger.debug({
            userId: metadata.userId,
            sessionId: metadata.sessionId,
            messageId: metadata.messageId,
            model: model,
            tokens: tokenRecord.usage.totalTokens
          }, 'Token usage tracked from streaming response');
        }
        
      } catch (error) {
        self.logger.error({ error, metadata }, 'Error in token tracking stream wrapper');
        throw error;
      }
    }
    
    return wrappedStream();
  }

  /**
   * Track token usage for analytics and billing (legacy method - kept for compatibility)
   */
  async trackTokenUsage(data: {
    userId: string;
    sessionId: string;
    messageId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    timestamp: Date;
  }): Promise<void> {
    try {
      // Store token usage in database using Prisma
      const result = await prisma.tokenUsage.create({
        data: {
          user_id: data.userId,
          session_id: data.sessionId,
          model: data.model,
          prompt_tokens: data.promptTokens,
          completion_tokens: data.completionTokens,
          total_tokens: data.totalTokens,
          total_cost: data.cost,
          timestamp: data.timestamp
        }
      });

      this.logger.debug({
        userId: data.userId,
        sessionId: data.sessionId,
        model: data.model,
        totalTokens: data.totalTokens,
        cost: data.cost,
        recordId: result.id
      }, 'Token usage tracked successfully');

    } catch (error) {
      this.logger.error({
        error: error.message,
        userId: data.userId,
        sessionId: data.sessionId,
        model: data.model
      }, 'Failed to track token usage');
      // Don't throw - token tracking failure shouldn't break chat
    }
  }

  /**
   * Get Azure OpenAI health status for intelligent routing
   */
  async getHealthStatus(): Promise<any> {
    try {
      if (!this.hasAzureConfig) {
        return {
          status: 'not_initialized',
          error: 'Azure OpenAI configuration incomplete',
          endpoint: this.azureEndpoint
        };
      }

      // Test connection by listing available models
      const models = await this.getAvailableModels();
      const hasIntelligentRouting = !!this.intelligentRouter;

      // Test task analysis service
      const testAnalysis = await this.taskAnalysisService.analyzeTask({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      return {
        status: 'healthy',
        provider: 'azure-openai-intelligent',
        endpoint: this.azureEndpoint,
        availableModels: models.map(m => m.id),
        intelligentRouting: hasIntelligentRouting,
        taskAnalysis: {
          working: !!testAnalysis,
          defaultModel: testAnalysis.suggestedModel
        },
        modelEndpoints: Object.fromEntries(this.modelEndpoints)
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        endpoint: this.azureEndpoint,
        intelligentRouting: !!this.intelligentRouter
      };
    }
  }

  /**
   * Analyze task requirements to determine optimal model
   */
  private async analyzeTaskRequirements(request: any): Promise<any> {
    try {
      // Create task requirements from the request
      const requirements: TaskRequirements = {
        messages: request.messages || [],
        hasImages: this.hasImageContent(request.messages || []),
        tools: request.tools
      };

      // Use TaskAnalysisService for semantic analysis
      const analysis = await this.taskAnalysisService.analyzeTask(requirements);

      this.logger.debug({
        taskType: analysis.taskType,
        suggestedModel: analysis.suggestedModel,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning
      }, 'Task analysis completed');

      return analysis;
    } catch (error) {
      this.logger.error({ error }, 'Failed to analyze task requirements - using fallback model');

      // Fallback to default model
      return {
        taskType: 'standard',
        confidence: 0.5,
        suggestedModel: process.env.DEFAULT_MODEL,
        reasoning: 'Task analysis failed - using default model',
        requiresVision: false,
        requiresImageGen: false,
        complexity: 'simple'
      };
    }
  }

  /**
   * Check if messages contain image content
   */
  private hasImageContent(messages: any[]): boolean {
    return messages.some(msg => {
      const content = msg.content;
      if (Array.isArray(content)) {
        return content.some(c => c.type === 'image_url' || c.type === 'image');
      }
      return false;
    });
  }

  /**
   * Handle image generation requests
   */
  private async handleImageGeneration(request: any, selectedModel: string, metadata?: any): Promise<any> {
    try {
      // Extract prompt from the last user message
      const lastMessage = request.messages?.[request.messages.length - 1];
      const prompt = typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
          ? lastMessage.content.map(c => c.text || '').join(' ')
          : '';

      if (!prompt) {
        throw new Error('No prompt found for image generation');
      }

      const client = await this.getClientForModel(selectedModel);

      // Create image generation request
      const imageRequest = {
        prompt: prompt,
        n: 1,
        size: request.size || '1024x1024',
        quality: request.quality || 'standard',
        response_format: 'url' as const
      };

      this.logger.info({
        model: selectedModel,
        prompt: prompt.substring(0, 100),
        size: imageRequest.size,
        quality: imageRequest.quality
      }, 'Creating image generation');

      // Generate image using OpenAI images endpoint
      const response = await client.images.generate(imageRequest);

      // Convert to chat completion format
      return {
        id: `img-gen-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: selectedModel,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: `I've generated an image based on your request. Here's the result:\n\n![Generated Image](${response.data[0]?.url})`
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: Math.ceil(prompt.length / 4), // Rough estimate
          completion_tokens: 0,
          total_tokens: Math.ceil(prompt.length / 4)
        }
      };
    } catch (error) {
      this.logger.error({ error, selectedModel }, 'Image generation failed');
      throw error;
    }
  }

  /**
   * Get Azure deployment information for any model
   * NOTE: Legacy method - ProviderManager handles this dynamically
   */
  async getModelInfo(modelName: string): Promise<any> {
    try {
      // Model name IS the deployment name in Azure
      return {
        deployment: modelName,
        endpoint: this.azureEndpoint,
        apiVersion: this.azureApiVersion,
        provider: 'azure-openai'
      };
    } catch (error) {
      this.logger.error({ error, modelName }, 'Failed to get model info');
      return null;
    }
  }

  /**
   * Get token usage statistics for a user
   */
  async getUserTokenUsage(userId: string, startDate?: Date, endDate?: Date): Promise<any> {
    try {
      return await this.tokenUsageService.getUserUsage(userId, startDate, endDate);
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get user token usage');
      throw error;
    }
  }

  /**
   * Get token usage statistics for a session
   */
  async getSessionTokenUsage(sessionId: string, userId: string): Promise<any> {
    try {
      return await this.tokenUsageService.getSessionUsage(sessionId, userId);
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to get session token usage');
      throw error;
    }
  }

  /**
   * Wrap OpenAI stream to make it compatible with axios-style event emitters
   * This allows existing CompletionStage code to work without major refactoring
   * TODO: Refactor CompletionStage to consume provider-agnostic stream format
   */
  private wrapOpenAIStreamForCompat(openaiStream: any, metadata?: any): any {

    // Create a readable stream that mimics axios response.data
    const readable = new Readable({
      read() {} // No-op, we'll push data manually
    });

    // Process the OpenAI async iterable in the background
    (async () => {
      try {
        for await (const chunk of openaiStream) {
          // Convert OpenAI chunk format to SSE format that CompletionStage expects
          const sseData = `data: ${JSON.stringify(chunk)}\n\n`;
          readable.push(sseData);
        }

        // Signal end of stream
        readable.push('data: [DONE]\n\n');
        readable.push(null); // End the stream
      } catch (error) {
        this.logger.error({ error }, 'Error processing OpenAI stream');
        readable.destroy(error);
      }
    })();

    // Return an object that looks like an axios response
    return {
      data: readable,
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'text/event-stream'
      }
    };
  }
}