/**
 * Google Vertex AI Provider
 *
 * Implements ILLMProvider for Google Vertex AI models (Gemini 2.5+, Gemini 3, etc.)
 *
 * SDK: @google/genai (recommended for Gemini 2.0+ features as of 2025)
 *      This is the official Google GenAI SDK that supports:
 *      - Streaming with thinking content (includeThoughts)
 *      - Vertex AI authentication
 *      - All Gemini 2.5+ features
 *
 * Auth: Supports Vertex AI mode with project/location, or API key
 *       Uses ADC (Application Default Credentials) when no explicit credentials
 */

import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { buildVertexAuthOptions } from './GoogleVertexAuth.js';
import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  type ProviderConfig,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth,
  type DiscoveredModel,
} from './ILLMProvider.js';
import type { CanonicalStreamFormat } from '@agentic-work/llm-sdk/lib/normalizers/index.js';
import {
  GoogleVertexCacheManager,
  getVertexCacheManager,
  type CacheLookupResult
} from './GoogleVertexCacheManager.js';

export interface VertexConfig {
  projectId: string;
  location: string;
  serviceAccountJson?: string; // Base64-encoded service account JSON
  apiKey?: string; // Alternative: API key authentication
  credentials?: {
    client_email: string;
    private_key: string;
  };
  endpoint?: string;
  // Context caching configuration (saves 90% on Gemini 2.5 models!)
  // See: https://ai.google.dev/gemini-api/docs/caching
  enableContextCaching?: boolean;
  // Default cache TTL in seconds (default: 3600 = 1 hour)
  cacheTtlSeconds?: number;
  // Minimum system prompt length (chars) to consider for caching (default: 8192 = ~2K tokens)
  minCacheableChars?: number;
}

export class GoogleVertexProvider extends BaseLLMProvider {
  readonly name = 'Google Vertex AI';
  readonly type = 'google-vertex' as const;
  // D-1.4 — Vertex is multi-mode: Gemini (default; Google's native format
  // with thinking support) and Anthropic Claude on Model Garden
  // (`publishers/anthropic/models/...` per :1237-1239 — uses Anthropic
  // Messages API shape). Static default reflects the dominant Gemini
  // path; `getStreamFormat(request)` selects per-request.
  readonly streamFormat = 'gemini' as const;

  /**
   * Per-request stream-format dispatch (D-1.4).
   *
   * Mirrors the Model Garden routing at GoogleVertexProvider.ts:1230-1254:
   *   - model id starts with `'claude-'` → `'vertex-anthropic'`
   *     (Vertex AI Anthropic Claude endpoints — handled by
   *     createVertexAnthropicToOpenagenticNormalizer)
   *   - otherwise → `'gemini'`
   *     (default Gemini SSE; non-Claude non-Gemini models on Model Garden
   *     — GPT / Mistral / Llama — use OpenAI-shape but the wire-in for
   *     those publishers is deferred; the static `'gemini'` default keeps
   *     the type contract honest until a `'vertex-openai'` discriminator
   *     lands as a follow-up to D-2.7).
   */
  getStreamFormat(request: CompletionRequest): CanonicalStreamFormat {
    const modelId = (request.model || '').toLowerCase();
    if (modelId.startsWith('claude-')) {
      return 'vertex-anthropic';
    }
    return 'gemini';
  }

  private genAI?: GoogleGenAI;
  private config?: VertexConfig;
  private cacheManager?: GoogleVertexCacheManager;

  /**
   * Unescape common escape sequences in text content.
   * Google's Gemini API sometimes returns thinking content with literal escape sequences
   * like \\n\\n instead of actual newlines. This function converts them to proper characters.
   */
  private unescapeContent(text: string): string {
    if (!text) return text;
    return text
      .replaceAll(/\\n/g, '\n')   // Literal \n to actual newline
      .replaceAll(/\\t/g, '\t')   // Literal \t to actual tab
      .replaceAll(/\\r/g, '\r')   // Literal \r to carriage return
      .replaceAll(/\\"/g, '"')    // Literal \" to quote
      .replaceAll(/\\\\/g, '\\'); // Literal \\ to single backslash (must be last)
  }

  constructor(logger: Logger) {
    super(logger, 'google-vertex');
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    try {
      this.config = config as VertexConfig;

      const projectId = this.config.projectId || process.env.GOOGLE_CLOUD_PROJECT!;
      const location = this.config.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      // Handle service account JSON if provided (from database config)
      if (this.config.serviceAccountJson) {
        try {
          let serviceAccount: any;

          // Try to parse as JSON directly first (from env vars)
          try {
            serviceAccount = typeof this.config.serviceAccountJson === 'string'
              ? JSON.parse(this.config.serviceAccountJson)
              : this.config.serviceAccountJson;
          } catch {
            // If direct parse fails, try decoding as base64 (from database)
            const serviceAccountBuffer = Buffer.from(this.config.serviceAccountJson, 'base64');
            serviceAccount = JSON.parse(serviceAccountBuffer.toString('utf-8'));
          }

          // Set credentials in environment for Google Cloud SDK
          process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify(serviceAccount);

          this.logger.info(
            { provider: this.name, authType: 'service-account', project: projectId },
            'Using service account authentication'
          );
        } catch (error) {
          this.logger.error({ error }, 'Failed to parse service account JSON');
          throw new Error('Invalid service account JSON format');
        }
      } else if (this.config.apiKey || process.env.VERTEX_AI_API_KEY || process.env.GEMINI_API_KEY) {
        // API key authentication (from config or environment)
        if (!this.config.apiKey) {
          this.config.apiKey = process.env.VERTEX_AI_API_KEY || process.env.GEMINI_API_KEY;
        }
        this.logger.info({ provider: this.name, authType: 'api-key' }, 'Using API key authentication');
      } else {
        // Use Application Default Credentials (ADC)
        // Pre-validate that credentials are available before proceeding
        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

        if (credentialsPath) {
          // Validate the credentials file exists and contains required fields
          try {
            const fs = await import('fs');
            if (!fs.existsSync(credentialsPath)) {
              throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${credentialsPath}`);
            }
            const credContent = fs.readFileSync(credentialsPath, 'utf-8');
            const creds = JSON.parse(credContent);
            if (!creds.client_email || !creds.private_key) {
              throw new Error('Credentials file missing required fields (client_email, private_key). Ensure it is a service account JSON file.');
            }
            this.logger.info(
              { provider: this.name, authType: 'service-account-file', clientEmail: creds.client_email },
              'Using service account from GOOGLE_APPLICATION_CREDENTIALS file'
            );
          } catch (fileError: any) {
            this.logger.error({
              error: fileError.message,
              credentialsPath
            }, 'Invalid or missing GOOGLE_APPLICATION_CREDENTIALS file');
            throw new Error(`Google credentials error: ${fileError.message}. Set GOOGLE_APPLICATION_CREDENTIALS to a valid service account JSON file, or use VERTEX_AI_API_KEY for API key auth.`);
          }
        } else if (credentialsJson) {
          // Validate JSON credentials
          try {
            const creds = JSON.parse(credentialsJson);
            if (!creds.client_email || !creds.private_key) {
              throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON missing required fields (client_email, private_key)');
            }
            this.logger.info(
              { provider: this.name, authType: 'service-account-json', clientEmail: creds.client_email },
              'Using service account from GOOGLE_APPLICATION_CREDENTIALS_JSON'
            );
          } catch (jsonError: any) {
            this.logger.error({ error: jsonError.message }, 'Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON');
            throw new Error(`Google credentials JSON error: ${jsonError.message}`);
          }
        } else {
          // No explicit credentials - warn about ADC requirement
          this.logger.warn(
            { provider: this.name, authType: 'adc' },
            'No explicit credentials provided. Using Application Default Credentials (ADC). Run "gcloud auth application-default login" if not on GCP.'
          );
        }

        this.logger.info(
          { provider: this.name, authType: 'default' },
          'Using Application Default Credentials'
        );
      }

      // Initialize the new @google/genai SDK
      // For Vertex AI mode, we set vertexai: true and provide project/location
      const genAIConfig: any = {};

      if (this.config.apiKey) {
        // Use API key authentication (Gemini Developer API)
        genAIConfig.apiKey = this.config.apiKey;
      } else {
        // Use Vertex AI mode with project/location
        genAIConfig.vertexai = true;
        genAIConfig.project = projectId;
        genAIConfig.location = location;
      }

      this.genAI = new GoogleGenAI(genAIConfig);

      // Initialize context cache manager if caching is enabled
      const enableCaching = this.config.enableContextCaching ??
                           process.env.VERTEX_AI_ENABLE_CACHING === 'true';
      if (enableCaching) {
        this.cacheManager = getVertexCacheManager(this.logger);
        await this.cacheManager.initialize(this.genAI);
        this.logger.info({
          provider: this.name,
          cacheTtl: this.config.cacheTtlSeconds || 3600,
          minCacheableChars: this.config.minCacheableChars || 8192
        }, '💾 [GoogleVertexProvider] Context caching enabled (90% savings on Gemini 2.5!)');
      }

      this.initialized = true;
      this.logger.info(
        {
          provider: this.name,
          project: projectId,
          location: location,
          sdkMode: genAIConfig.apiKey ? 'api-key' : 'vertex-ai',
          cachingEnabled: enableCaching
        },
        'Google Vertex AI provider initialized with @google/genai SDK'
      );
    } catch (error) {
      this.logger.error({ error, provider: this.name }, 'Failed to initialize Google Vertex AI provider');
      throw error;
    }
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.genAI) {
      throw new Error('Google Vertex AI provider not initialized');
    }

    const startTime = Date.now();

    try {
      // Determine model from request or provider-specific VERTEX_DEFAULT_MODEL
      // bootstrap env. Registry SoT: the cross-provider DEFAULT_MODEL env
      // fallback is removed — when neither is present, resolve the chat role
      // from the Registry (admin.model_role_assignments via the canonical
      // ModelConfigurationService accessor) instead of reading a
      // cross-provider env var that may point at a non-Vertex model.
      const rawModel = request.model || process.env.VERTEX_DEFAULT_MODEL ||
        (await (async () => {
          const { ModelConfigurationService } = await import('../ModelConfigurationService.js');
          return ModelConfigurationService.getDefaultChatModel().catch(() => '');
        })());
      // Translate Model Garden third-party models to Vertex AI publisher paths
      const modelName = this.resolveModelGardenPath(rawModel);

      // Convert OpenAI-style messages to Vertex format
      const { contents, systemInstruction } = this.convertToVertex(request);

      // Convert OpenAI-style tools to Vertex AI format
      const tools = request.tools ? this.convertToolsToVertex(request.tools) : undefined;

      // Build the config object for @google/genai
      // Cap maxOutputTokens per model — Gemini 2.0 Flash supports 8192, 2.5 models support 65536
      const mn = modelName.toLowerCase();
      const modelMaxOutput = mn.includes('2.5') || mn.includes('gemini-3') ? 65536 : 8192;
      const requestedTokens = request.max_tokens || 8192;
      const config: any = {
        temperature: request.temperature ?? 0.7,
        topP: request.top_p ?? 1,
        topK: request.top_k ?? 40,  // Gemini default topK
        maxOutputTokens: Math.min(requestedTokens, modelMaxOutput)
      };

      // Add system instruction if present (with optional context caching)
      if (systemInstruction) {
        const minCacheableChars = this.config?.minCacheableChars || 8192;

        // Try to use cached content if caching is enabled and content is large enough
        if (this.cacheManager?.isReady() && systemInstruction.length >= minCacheableChars) {
          const cacheResult = await this.tryGetOrCreateCache(
            systemInstruction,
            modelName,
            (request as any).userId,
            (request as any).sessionId
          );

          if (cacheResult?.cacheName) {
            // Use cached content reference instead of raw system instruction
            config.cachedContent = cacheResult.cacheName;
            this.logger.info({
              model: modelName,
              cacheName: cacheResult.cacheName,
              systemInstructionLength: systemInstruction.length,
              savings: '90%'
            }, '💾 [GoogleVertexProvider] Using cached system instruction');
          } else {
            // Fallback: use raw system instruction
            config.systemInstruction = systemInstruction;
            this.logger.info({
              model: modelName,
              systemInstructionLength: systemInstruction.length,
              preview: systemInstruction.substring(0, 100),
              cacheAttempted: true,
              cacheResult: cacheResult ? 'failed' : 'not_applicable'
            }, '[GoogleVertexProvider] Using systemInstruction (cache miss or failed)');
          }
        } else {
          // Caching not applicable or not enabled
          config.systemInstruction = systemInstruction;
          this.logger.info({
            model: modelName,
            systemInstructionLength: systemInstruction.length,
            preview: systemInstruction.substring(0, 100),
            cachingEnabled: this.cacheManager?.isReady() || false,
            minCacheableChars
          }, '[GoogleVertexProvider] Using systemInstruction');
        }
      }

      // Add tools if present
      // Use 'AUTO' mode — lets model choose whether to call tools or respond with text
      // 'ANY' mode was causing 400 INVALID_REQUEST with certain tool schemas on Gemini 2.0 Flash
      if (tools && tools.length > 0) {
        // Filter out any invalid/empty tool declarations
        const validTools = tools.filter(t => t && t.name && t.parameters);

        if (validTools.length > 0) {
          config.tools = [{ functionDeclarations: validTools }];
          config.toolConfig = {
            functionCallingConfig: {
              mode: 'AUTO'  // Let model decide — prevents 400 errors from schema issues
            }
          };

          this.logger.info({
            toolCount: validTools.length,
            toolNames: validTools.map(t => t.name).slice(0, 5),
            mode: 'AUTO'
          }, '[GoogleVertexProvider] Tools configured with AUTO mode');
        } else {
          this.logger.warn({
            originalCount: tools.length,
            validCount: 0
          }, '[GoogleVertexProvider] All tools filtered out as invalid - skipping tool config');
        }
      }

      // Enable thinking/reasoning for Gemini models
      // IMPORTANT: thinking_level is supported by these models:
      // - gemini-2.0-flash-thinking-exp
      // - gemini-2.5-flash (and variants)
      // - gemini-2.5-pro (added Jan 2025)
      // - gemini-3.x models (flash and pro)
      // See: https://ai.google.dev/gemini-api/docs/thinking
      const modelLower = modelName.toLowerCase();
      const isFlashModel = modelLower.includes('flash');
      const isThinkingModel = modelLower.includes('thinking');
      // Gemini 3+ detection: gemini-3, gemini-3.0, gemini-3.1, 3-pro, 3.1-pro, etc.
      const isGemini3 = modelLower.includes('gemini-3') ||
                        modelLower.includes('gemini-3.') ||
                        modelLower.includes('3-pro') ||
                        modelLower.includes('3.0-pro') ||
                        modelLower.includes('3.1-pro') ||
                        modelLower.includes('3-flash') ||
                        modelLower.includes('3.0-flash') ||
                        modelLower.includes('3.1-flash');
      const isGemini25Pro = modelLower.includes('gemini-2.5-pro') || modelLower.includes('2.5-pro');
      const isGemini25 = modelLower.includes('gemini-2.5') || modelLower.includes('2.5');
      // Flash models, thinking models, Gemini 2.5 Pro, and Gemini 3 all support thinking_level
      const supportsThinking = isFlashModel || isThinkingModel || isGemini25Pro || isGemini3;

      // Only enable thinking when explicitly requested via request, config, or env var.
      // Not all Vertex AI deployments support thinkingConfig (depends on model version availability).
      const requestedThinkingLevel = (request as any).thinking?.level ||
                                     (this.config as any)?.thinkingLevel ||
                                     process.env.VERTEX_AI_THINKING_LEVEL;
      if (supportsThinking && requestedThinkingLevel) {
        const thinkingConfig: any = {
          includeThoughts: true,
          thinkingLevel: requestedThinkingLevel
        };
        config.thinkingConfig = thinkingConfig;
        this.logger.info({ model: modelName, thinkingLevel: thinkingConfig.thinkingLevel },
          '[GoogleVertexProvider] Thinking enabled (explicitly requested)');
      }

      // Set media resolution for multimodal inputs (Gemini 3 feature)
      // Controls vision processing for images/videos/PDFs
      const mediaResolution = (request as any).media_resolution ||
                             process.env.VERTEX_AI_MEDIA_RESOLUTION;
      if (mediaResolution && ['low', 'medium', 'high'].includes(mediaResolution)) {
        config.mediaResolution = mediaResolution;
        this.logger.info({
          model: modelName,
          mediaResolution
        }, '[GoogleVertexProvider] Media resolution set');
      }

      this.logger.info({
        model: modelName,
        toolCount: tools?.length || 0,
        messageCount: contents.length,
        hasSystemInstruction: !!systemInstruction,
        hasThinkingConfig: !!config.thinkingConfig,
        thinkingConfig: config.thinkingConfig ? JSON.stringify(config.thinkingConfig) : null,
        configKeys: Object.keys(config)
      }, '[GoogleVertexProvider] Creating completion with @google/genai SDK');

      // CRITICAL DEBUG: Show exactly what we're sending to Google
      if (config.thinkingConfig) {
        console.log('\n' + '*'.repeat(60));
        console.log('SENDING TO GOOGLE GENAI API');
        console.log('*'.repeat(60));
        console.log('Final thinkingConfig:', JSON.stringify(config.thinkingConfig, null, 2));
        console.log('Model:', modelName);
        console.log('Stream:', request.stream);
        console.log('*'.repeat(60) + '\n');
      }

      if (request.stream) {
        return this.streamCompletion(contents, config, modelName, startTime);
      } else {
        return await this.nonStreamCompletion(contents, config, modelName, startTime);
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error, provider: this.name }, 'Vertex AI completion failed');
      throw error;
    }
  }

  private async nonStreamCompletion(
    contents: any[],
    config: any,
    modelName: string,
    startTime: number
  ): Promise<CompletionResponse> {
    let response;
    try {
      response = await this.genAI!.models.generateContent({
        model: modelName,
        contents,
        config
      });
    } catch (genErr: any) {
      const isToolSchemaError = genErr?.status === 400 || genErr?.code === 400 ||
        genErr?.message?.includes('INVALID') || genErr?.message?.includes('400');
      if (isToolSchemaError && config.tools) {
        this.logger.warn({
          model: modelName,
          error: genErr.message?.substring(0, 200),
        }, '[GoogleVertexProvider] Tool schema rejected — retrying WITHOUT tools');
        const retryConfig = { ...config };
        delete retryConfig.tools;
        delete retryConfig.toolConfig;
        response = await this.genAI!.models.generateContent({
          model: modelName,
          contents,
          config: retryConfig
        });
      } else {
        throw genErr;
      }
    }

    const latency = Date.now() - startTime;

    // Debug: log raw response structure - the @google/genai SDK returns response differently
    const allParts = response.candidates?.[0]?.content?.parts || [];
    const candidate0 = response.candidates?.[0];
    this.logger.info({
      hasText: !!(response as any).text,
      sdkTextValue: (response as any).text,
      hasParts: !!(response as any).parts,
      hasCandidates: !!response.candidates,
      candidateCount: response.candidates?.length,
      partsLength: allParts.length,
      candidate0Keys: candidate0 ? Object.keys(candidate0) : [],
      candidate0Content: candidate0?.content,
      candidate0FinishReason: candidate0?.finishReason,
      rawCandidate0: JSON.stringify(candidate0)?.substring(0, 500),
      allPartsInfo: allParts.map((p: any, i: number) => ({
        index: i,
        hasText: !!p.text,
        textLength: p.text?.length || 0,
        textPreview: p.text?.substring(0, 100),
        thought: p.thought,
        hasThoughtSignature: !!p.thoughtSignature
      }))
    }, '[GoogleVertexProvider] Raw response structure DEBUG');

    // Parse response - use candidates structure to properly separate thinking from content
    // NOTE: We MUST parse parts directly rather than relying on SDK .text property
    // because the SDK .text might return thinking content for Gemini 3 models,
    // causing actual response content to be lost.
    const parts = response.candidates?.[0]?.content?.parts || [];
    const finishReason = response.candidates?.[0]?.finishReason || 'STOP';

    // Extract text content and thinking content by parsing ALL parts
    // This is critical for Gemini 3 thinking mode where response has both:
    // - Thinking parts (thought: true) 
    // - Content parts (no thought flag)
    let text = '';
    let thinkingContent = '';
    const toolCalls: any[] = [];

    // ALWAYS parse parts to properly separate thinking from content
    for (const part of parts) {
      // Check if this is thinking content (thought: true)
      if ((part as any).thought === true && part.text) {
        thinkingContent += part.text;
        this.logger.debug({
          thinkingLength: part.text.length,
          thinkingPreview: part.text.substring(0, 100)
        }, '[GoogleVertexProvider] Found thinking content in part');
      } else if (part.text) {
        // Regular content (no thought flag)
        text += part.text;
        this.logger.debug({
          contentLength: part.text.length,
          contentPreview: part.text.substring(0, 100)
        }, '[GoogleVertexProvider] Found regular content in part');
      }
    }

    // Log final extraction results
    this.logger.info({
      thinkingLength: thinkingContent.length,
      contentLength: text.length,
      hasThinking: thinkingContent.length > 0,
      hasContent: text.length > 0
    }, '[GoogleVertexProvider] Content extraction complete');

    // Still process parts for function calls
    for (const part of parts) {
      if (part.functionCall) {
        // Convert Vertex AI function call to OpenAI format
        // Preserve thoughtSignature for Gemini 3 models (required for multi-turn function calling)
        const toolCall: any = {
          id: `call_${Date.now()}_${toolCalls.length}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args)
          }
        };

        // Preserve thought signature if present (Gemini 3 requirement)
        if ((part as any).thoughtSignature) {
          toolCall.thought_signature = (part as any).thoughtSignature;
          this.logger.debug({
            functionName: part.functionCall.name,
            hasThoughtSignature: true
          }, '[GoogleVertexProvider] Preserving thought signature for function call');
        }

        toolCalls.push(toolCall);
      }
    }

    // Extract token usage if available
    const usage = response.usageMetadata || {};
    const tokens = (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0);
    const cost = this.estimateCost(modelName, tokens);

    this.trackSuccess(latency, tokens, cost);

    const message: any = {
      role: 'assistant',
      content: text
    };

    // Add tool calls if present
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
      this.logger.info({
        toolCallCount: toolCalls.length,
        tools: toolCalls.map(tc => tc.function.name)
      }, '[GoogleVertexProvider] Function calls detected in response');
    }

    const completionResponse: CompletionResponse = {
      id: `vertex-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [
        {
          index: 0,
          message,
          finish_reason: this.convertFinishReason(finishReason)
        }
      ],
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: tokens
      }
    };

    // Add thinking content if present
    if (thinkingContent) {
      (completionResponse as any).thinking_content = thinkingContent;
    }

    return completionResponse;
  }

  private async *streamCompletion(
    contents: any[],
    config: any,
    modelName: string,
    startTime: number
  ): AsyncGenerator<any> {
    // Use generateContentStream for streaming responses
    // If tools cause a 400 INVALID_REQUEST, retry without tools
    let response;
    try {
      response = await this.genAI!.models.generateContentStream({
        model: modelName,
        contents,
        config
      });
    } catch (streamErr: any) {
      const isToolSchemaError = streamErr?.status === 400 || streamErr?.code === 400 ||
        streamErr?.message?.includes('INVALID') || streamErr?.message?.includes('400');
      if (isToolSchemaError && config.tools) {
        this.logger.warn({
          model: modelName,
          toolCount: config.tools?.[0]?.functionDeclarations?.length || 0,
          error: streamErr.message?.substring(0, 200),
        }, '[GoogleVertexProvider] Tool schema rejected by Gemini — retrying WITHOUT tools');
        // Strip tools and tool config, retry
        const retryConfig = { ...config };
        delete retryConfig.tools;
        delete retryConfig.toolConfig;
        response = await this.genAI!.models.generateContentStream({
          model: modelName,
          contents,
          config: retryConfig
        });
      } else {
        throw streamErr;
      }
    }

    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let isTokensEstimated = false; // Track if tokens are estimated vs actual from API
    let toolCallIndex = 0;
    let hasYieldedThinking = false;
    let chunkCount = 0;  // Track chunk count for detailed logging

    // Track content for token estimation (fallback when usageMetadata not returned)
    let totalTextLength = 0;
    let totalThinkingLength = 0;

    // INTERLEAVED THINKING: Track block indices for proper interleaving
    let blockIndex = 0;
    let currentBlockType: 'thinking' | 'text' | null = null;

    // Track thinking content size for better interleaving (create new blocks periodically)
    // This prevents all thinking from being in one giant block for Gemini models
    let currentBlockContentLength = 0;
    const THINKING_BLOCK_THRESHOLD = 800; // Create new thinking block after ~800 chars for better interleaving

    for await (const chunk of response) {
      chunkCount++;
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const finishReason = candidate?.finishReason;

      // CRITICAL DEBUG: Log first chunk in detail to see if thinking is present
      if (chunkCount === 1) {
        console.log('\n' + '#'.repeat(60));
        console.log('FIRST CHUNK FROM GOOGLE');
        console.log('#'.repeat(60));
        console.log('Raw chunk keys:', Object.keys(chunk));
        console.log('Candidate keys:', candidate ? Object.keys(candidate) : 'NO CANDIDATE');
        console.log('Parts count:', parts.length);
        if (parts.length > 0) {
          console.log('First part:', JSON.stringify(parts[0], null, 2).substring(0, 500));
        }
        console.log('#'.repeat(60) + '\n');
      }

      // Check for thinking at candidate/chunk level (not just part level)
      const candidateAny = candidate as any;
      const chunkAny = chunk as any;

      // Log detailed chunk structure for first 3 chunks to debug thinking detection
      // Check for thinking content at candidate/chunk level (alternative locations)
      const candidateLevelThinking = candidateAny?.thoughts ||
                                     candidateAny?.thinking ||
                                     candidateAny?.thoughtSummary ||
                                     candidateAny?.content?.thoughts;
      const chunkLevelThinking = chunkAny?.thoughts ||
                                 chunkAny?.thinking ||
                                 chunkAny?.thoughtSummary;

      // Yield candidate/chunk level thinking if found (before processing parts)
      // INTERLEAVED THINKING: Use content_block format for consistency with part-level thinking
      if (candidateLevelThinking && !hasYieldedThinking) {
        const rawText = typeof candidateLevelThinking === 'string'
          ? candidateLevelThinking
          : JSON.stringify(candidateLevelThinking);
        const thinkingText = this.unescapeContent(rawText);
        hasYieldedThinking = true;
        this.logger.info({
          source: 'candidate-level',
          thinkingLength: thinkingText.length,
          thinkingPreview: thinkingText.substring(0, 100)
        }, '[GoogleVertexProvider] 🧠 Yielding CANDIDATE-level thinking as content_block');

        // Start thinking block if not already started
        if (currentBlockType !== 'thinking') {
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'thinking' }
          };
          currentBlockType = 'thinking';
        }

        // Emit thinking content as content_block_delta
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta: {
            type: 'thinking_delta',
            thinking: thinkingText
          }
        };
      }

      if (chunkLevelThinking && !hasYieldedThinking) {
        const rawText = typeof chunkLevelThinking === 'string'
          ? chunkLevelThinking
          : JSON.stringify(chunkLevelThinking);
        const thinkingText = this.unescapeContent(rawText);
        hasYieldedThinking = true;
        this.logger.info({
          source: 'chunk-level',
          thinkingLength: thinkingText.length,
          thinkingPreview: thinkingText.substring(0, 100)
        }, '[GoogleVertexProvider] 🧠 Yielding CHUNK-level thinking as content_block');

        // Start thinking block if not already started
        if (currentBlockType !== 'thinking') {
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'thinking' }
          };
          currentBlockType = 'thinking';
        }

        // Emit thinking content as content_block_delta
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta: {
            type: 'thinking_delta',
            thinking: thinkingText
          }
        };
      }

      if (chunkCount <= 3) {
        this.logger.info({
          chunkCount,
          hasParts: parts.length > 0,
          partsCount: parts.length,
          finishReason,
          candidateKeys: candidate ? Object.keys(candidate) : [],
          chunkKeys: Object.keys(chunk),
          // Check various places thinking might be
          candidateThoughts: candidateAny?.thoughts,
          candidateThinking: candidateAny?.thinking,
          candidateThoughtSummary: candidateAny?.thoughtSummary,
          chunkThoughts: chunkAny?.thoughts,
          chunkThinking: chunkAny?.thinking,
          contentKeys: candidate?.content ? Object.keys(candidate.content) : [],
          groundingMetadata: candidateAny?.groundingMetadata ? 'present' : 'absent'
        }, '[GoogleVertexProvider] 🔍 DETAILED Chunk structure');
      } else {
        this.logger.debug({
          hasParts: parts.length > 0,
          partsCount: parts.length,
          finishReason,
          candidateCount: chunk.candidates?.length || 0,
          partTypes: parts.map((p: any) => Object.keys(p))
        }, '[GoogleVertexProvider] Processing stream chunk');
      }

      for (const part of parts) {
        // CRITICAL: @google/genai SDK returns thinking as parts with thought: true
        // The actual thinking TEXT is in part.text, marked with the thought boolean
        // BUT Google says this is "best effort" - not always returned
        // Check multiple possible property names for thinking content
        const partAny = part as any;
        const isThoughtPart = partAny.thought === true ||
                              partAny.isThought === true ||
                              partAny.type === 'thought' ||
                              partAny.role === 'thought';

        // Enhanced logging - show full part structure for first few chunks to debug
        if (chunkCount <= 3) {
          this.logger.info({
            hasText: !!part.text,
            textLength: part.text?.length || 0,
            hasFunctionCall: !!part.functionCall,
            isThoughtPart,
            partKeys: Object.keys(part),
            thoughtProp: partAny.thought,
            isThoughtProp: partAny.isThought,
            typeProp: partAny.type,
            roleProp: partAny.role,
            fullPartPreview: JSON.stringify(part).substring(0, 500)
          }, '[GoogleVertexProvider] 🔍 DETAILED Part structure');
        } else {
          this.logger.debug({
            hasText: !!part.text,
            textLength: part.text?.length || 0,
            hasFunctionCall: !!part.functionCall,
            isThoughtPart,
            partKeys: Object.keys(part)
          }, '[GoogleVertexProvider] Processing part');
        }

        // Handle thinking content from Gemini 2.5+
        // When part.thought === true, the part.text contains the thinking/reasoning
        // INTERLEAVED THINKING: Emit proper content_block events for UI interleaving
        if (isThoughtPart && part.text) {
          hasYieldedThinking = true;
          totalThinkingLength += part.text.length;  // Track for token estimation
          this.logger.info({
            thinkingLength: part.text.length,
            thinkingPreview: part.text.substring(0, 100),
            blockIndex,
            currentBlockContentLength
          }, '[GoogleVertexProvider] 🧠 Yielding thinking chunk (thought=true)');

          // GEMINI INTERLEAVING FIX: Create new thinking blocks periodically for better UI display
          // This prevents all thinking from being in one giant block
          const shouldStartNewBlock = currentBlockType !== 'thinking' ||
            (currentBlockType === 'thinking' && currentBlockContentLength >= THINKING_BLOCK_THRESHOLD);

          if (shouldStartNewBlock) {
            // Close previous block if any (use current blockIndex before incrementing)
            if (currentBlockType !== null) {
              yield {
                type: 'content_block_stop',
                index: blockIndex
              };
              blockIndex++;  // Move to next block for the new thinking block
              this.logger.debug({
                previousBlockIndex: blockIndex - 1,
                newBlockIndex: blockIndex,
                reason: currentBlockType === 'thinking' ? 'threshold_exceeded' : 'type_switch'
              }, '[GoogleVertexProvider] Starting new thinking block for better interleaving');
            }

            // Start new thinking block with the (potentially incremented) index
            yield {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'thinking' }
            };
            currentBlockType = 'thinking';
            currentBlockContentLength = 0; // Reset counter for new block
          }

          // Emit thinking delta with block index
          // CRITICAL: Unescape the thinking content to convert literal \n to actual newlines
          const unescapedThinking = this.unescapeContent(part.text);
          yield {
            type: 'content_block_delta',
            index: blockIndex,
            delta: {
              type: 'thinking_delta',
              thinking: unescapedThinking
            }
          };

          // Track content length for threshold-based block splitting
          currentBlockContentLength += unescapedThinking.length;

          // NOTE: Do NOT yield OpenAI-compatible format here - pipeline handles content_block events
          continue;  // Don't also yield as regular text
        }

        // Handle regular text content (non-thinking)
        // INTERLEAVED THINKING: Emit proper content_block events for UI interleaving
        if (part.text && !isThoughtPart) {
          totalTextLength += part.text.length;  // Track for token estimation
          this.logger.debug({
            textContent: part.text.substring(0, 100),
            blockIndex
          }, '[GoogleVertexProvider] Yielding text chunk');

          // INTERLEAVED THINKING: Start a new text block if switching from thinking
          if (currentBlockType !== 'text') {
            // Close previous block if any
            if (currentBlockType !== null) {
              yield {
                type: 'content_block_stop',
                index: blockIndex
              };
              blockIndex++;  // Move to next block
            }

            // Start new text block
            yield {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'text' }
            };
            currentBlockType = 'text';
            currentBlockContentLength = 0; // Reset counter for new block
          }

          // Emit text delta with block index
          yield {
            type: 'content_block_delta',
            index: blockIndex,
            delta: {
              type: 'text_delta',
              text: part.text
            }
          };
          // NOTE: Do NOT yield OpenAI-compatible format here - pipeline handles content_block events
        }

        // Handle function calls
        if (part.functionCall) {
          const hasThoughtSignature = !!(part as any).thoughtSignature;
          this.logger.info({
            functionName: part.functionCall.name,
            hasArgs: !!part.functionCall.args,
            hasThoughtSignature
          }, '[GoogleVertexProvider] Streaming function call');

          // Build tool call with optional thought signature (Gemini 3 requirement)
          const toolCall: any = {
            index: toolCallIndex,
            id: `call_${Date.now()}_${toolCallIndex}`,
            type: 'function',
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args)
            }
          };

          // Preserve thought signature if present
          if (hasThoughtSignature) {
            toolCall.thought_signature = (part as any).thoughtSignature;
          }

          yield {
            id: `vertex-stream-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [toolCall]
                },
                finish_reason: null
              }
            ]
          };
          toolCallIndex++;
        }
      }

      // Track tokens if available in chunk
      if (chunk.usageMetadata) {
        promptTokens = chunk.usageMetadata.promptTokenCount || 0;
        completionTokens = chunk.usageMetadata.candidatesTokenCount || 0;
        cachedTokens = chunk.usageMetadata.cachedContentTokenCount || 0;
        totalTokens = promptTokens + completionTokens;

        // Log thinking token count if available
        if (chunk.usageMetadata.thoughtsTokenCount) {
          this.logger.info({
            thoughtsTokenCount: chunk.usageMetadata.thoughtsTokenCount,
            hasYieldedThinking
          }, '[GoogleVertexProvider] 🧠 Thoughts token count in metadata');
        }
      }
    }

    // Log final thinking status - CRITICAL DEBUG
    console.log('\n' + '~'.repeat(60));
    console.log('GEMINI STREAM COMPLETE SUMMARY');
    console.log('~'.repeat(60));
    console.log('Total chunks processed:', chunkCount);
    console.log('Thinking content yielded:', hasYieldedThinking ? 'YES' : 'NO');
    console.log('Total tokens:', totalTokens);
    console.log('Model:', modelName);
    console.log('~'.repeat(60) + '\n');

    if (hasYieldedThinking) {
      this.logger.info('[GoogleVertexProvider] Successfully streamed thinking content');
    } else {
      this.logger.warn('[GoogleVertexProvider] No thinking content was yielded during streaming');
    }

    // Send final chunk with usage metadata for cost tracking
    // This is critical for LLMMetricsService to log token usage properly
    //
    // WORKAROUND: Google's API sometimes doesn't return usageMetadata in streaming mode
    // (known issue: https://discuss.ai.google.dev/t/usagemetadata-is-nil-in-generatecontentstream-final-response)
    // When this happens, we ESTIMATE tokens based on content length (~4 chars per token)
    //
    // IMPORTANT: We only count TEXT content, not JSON structure or base64 images
    // Previous bug: JSON.stringify(contents) massively over-counted due to JSON overhead
    if (totalTokens === 0 && (totalTextLength > 0 || totalThinkingLength > 0)) {
      // Estimate output tokens: ~4 characters per token for English text (reasonably accurate)
      const estimatedCompletionTokens = Math.ceil((totalTextLength + totalThinkingLength) / 4);

      // FIXED: Extract only text content from messages, not JSON structure
      // This prevents massive over-counting from JSON syntax and base64 images
      let textContentLength = 0;
      for (const msg of contents) {
        if (msg.parts) {
          for (const part of msg.parts) {
            if (typeof part === 'string') {
              textContentLength += part.length;
            } else if (part.text) {
              textContentLength += part.text.length;
            }
            // Skip inlineData (images) - these are counted differently by Google
          }
        }
      }
      const estimatedPromptTokens = Math.ceil(textContentLength / 4);

      promptTokens = estimatedPromptTokens;
      completionTokens = estimatedCompletionTokens;
      totalTokens = promptTokens + completionTokens;
      isTokensEstimated = true;

      this.logger.warn({
        totalTextLength,
        totalThinkingLength,
        textContentLength,
        estimatedPromptTokens,
        estimatedCompletionTokens,
        estimatedTotalTokens: totalTokens,
        oldMethodWouldHaveEstimated: Math.ceil(JSON.stringify(contents).length / 4)
      }, '[GoogleVertexProvider] ⚠️ usageMetadata not returned by Google API - using estimated tokens (text-only method)');
    }

    // INTERLEAVED THINKING: Close the final block
    if (currentBlockType !== null) {
      yield {
        type: 'content_block_stop',
        index: blockIndex
      };
    }

    if (totalTokens > 0) {
      yield {
        id: `vertex-stream-final-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cached_tokens: cachedTokens,
          estimated: isTokensEstimated // Flag to track actual vs estimated tokens
        }
      };

      this.logger.info({
        promptTokens,
        completionTokens,
        totalTokens,
        cachedTokens,
        isEstimated: isTokensEstimated,
        source: isTokensEstimated ? 'text-based-estimation' : 'google-api-usageMetadata'
      }, '[GoogleVertexProvider] Sent final chunk with usage data');
    } else {
      // Still send a final chunk even without usage data so the stream properly terminates
      yield {
        id: `vertex-stream-final-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ]
      };
      this.logger.warn('[GoogleVertexProvider] No token usage data available after stream completed (no content generated?)');
    }

    // Track metrics after streaming completes
    const latency = Date.now() - startTime;
    const cost = this.estimateCost(modelName, totalTokens);
    this.trackSuccess(latency, totalTokens, cost);
  }

  /**
   * Convert OpenAI tools format to Vertex AI function declarations
   */
  private convertToolsToVertex(openaiTools: any[]): any[] {
    this.logger.debug({
      toolCount: openaiTools.length,
      firstTool: openaiTools[0] ? JSON.stringify(openaiTools[0]).substring(0, 500) : 'none'
    }, '[GoogleVertexProvider] Converting tools to Vertex format');

    return openaiTools.map(tool => {
      // OpenAI format: { type: 'function', function: { name, description, parameters } }
      // Vertex format: { name, description, parameters }
      const func = tool.function || tool;

      // Clean parameters to remove unsupported fields for Vertex AI
      const cleanedParams = this.cleanParametersForVertex(func.parameters);

      const converted = {
        name: func.name,
        description: func.description,
        parameters: cleanedParams
      };

      this.logger.debug({
        originalName: func.name,
        converted: JSON.stringify(converted).substring(0, 300)
      }, '[GoogleVertexProvider] Converted tool');

      return converted;
    });
  }

  /**
   * Clean parameters object to remove fields unsupported by Vertex AI
   * Vertex AI doesn't support $schema, additionalProperties, and some other JSON Schema fields
   */
  private cleanParametersForVertex(params: any): any {
    if (!params || typeof params !== 'object') {
      return params;
    }

    // Fields that Vertex AI / Gemini doesn't support in function declarations
    const unsupportedFields = [
      '$schema',
      'additionalProperties',
      '$id',
      '$ref',
      'definitions',
      '$defs',
      'exclusiveMaximum',
      'exclusiveMinimum',
      'examples',          // Gemini rejects "Unknown name examples" in tool schemas
      'default',           // Can conflict with Gemini parameter validation
      'pattern',           // Regex patterns not supported
      'patternProperties',
      'const',
      'if', 'then', 'else',
      'allOf', 'anyOf', 'oneOf', 'not',  // Complex composition not supported
      'title',             // Not part of Gemini function declaration schema
      'readOnly',
      'writeOnly',
      // Additional fields that Gemini 2.0+ rejects
      'minLength', 'maxLength',     // String length constraints
      'minimum', 'maximum',         // Numeric range constraints
      'multipleOf',                 // Number divisor constraint
      'format',                     // String format validators (email, uri, etc.)
      'deprecated',                 // Deprecation marker
      'dependentRequired',          // Complex dependencies
      'dependentSchemas',           // Schema dependencies
      'prefixItems',                // Tuple validation
      'contains', 'minContains', 'maxContains', // Array contains
      'minItems', 'maxItems',       // Array length constraints
      'uniqueItems',                // Array uniqueness constraint
      'minProperties', 'maxProperties', // Object size constraints
      'contentMediaType', 'contentEncoding', // Content type hints
    ];

    const cleaned: any = {};

    for (const [key, value] of Object.entries(params)) {
      // Skip unsupported fields
      if (unsupportedFields.includes(key)) {
        continue;
      }

      // Skip custom extension fields (x-enum-varnames, x-go-type, etc.)
      if (key.startsWith('x-')) {
        continue;
      }

      // Recursively clean nested objects
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          cleaned[key] = value.map(item => this.cleanParametersForVertex(item));
        } else {
          cleaned[key] = this.cleanParametersForVertex(value);
        }
      } else {
        cleaned[key] = value;
      }
    }

    // Fix enum: only allow primitive values (strings, numbers, booleans)
    if (cleaned.enum && Array.isArray(cleaned.enum)) {
      cleaned.enum = cleaned.enum.filter((v: any) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
      if (cleaned.enum.length === 0) {
        delete cleaned.enum;
      }
    }

    // Fix required array: remove entries that reference removed properties
    if (cleaned.required && Array.isArray(cleaned.required) && cleaned.properties) {
      const validProps = Object.keys(cleaned.properties);
      cleaned.required = cleaned.required.filter((r: string) => validProps.includes(r));
      if (cleaned.required.length === 0) {
        delete cleaned.required;
      }
    }

    return cleaned;
  }

  /**
   * Resolve Model Garden third-party models to Vertex AI publisher paths.
   * Gemini models are auto-resolved by the SDK; third-party models need explicit publisher paths.
   */
  private resolveModelGardenPath(model: string): string {
    if (!model) {
      throw new Error(
        'resolveModelGardenPath requires a model argument — set VERTEX_DEFAULT_MODEL or supply a model in the request'
      );
    }
    const m = model.toLowerCase();
    // Claude models on Vertex AI Model Garden → publishers/anthropic
    if (m.startsWith('claude-')) {
      return `publishers/anthropic/models/${model}`;
    }
    // GPT / OpenAI models on Vertex AI Model Garden → publishers/openai
    if (m.startsWith('gpt-') && !m.startsWith('gpt-oss')) {
      return `publishers/openai/models/${model}`;
    }
    // Mistral models on Vertex AI Model Garden → publishers/mistralai
    if (m.startsWith('mistral-') || m.startsWith('codestral-')) {
      return `publishers/mistralai/models/${model}`;
    }
    // Meta Llama models on Vertex AI Model Garden → publishers/meta
    if (m.startsWith('llama-') || m.startsWith('llama3')) {
      return `publishers/meta/models/${model}`;
    }
    // Default: return as-is (Gemini models auto-resolve)
    return model;
  }

  private convertToVertex(request: CompletionRequest): { contents: any[], systemInstruction?: string } {
    const contents: any[] = [];
    let systemInstruction: string | undefined;

    for (let i = 0; i < request.messages.length; i++) {
      const message = request.messages[i];

      if (message.role === 'system') {
        // Gemini handles system messages as a separate systemInstruction parameter
        systemInstruction = message.content;
        continue;
      }

      // Handle tool calls in assistant messages
      if (message.role === 'assistant' && message.tool_calls) {
        // Convert tool calls to Vertex AI format
        const parts = [];

        // Add text content if present
        if (message.content) {
          parts.push({ text: message.content });
        }

        // Add function calls with thought signatures (required for Gemini 3)
        for (const toolCall of message.tool_calls) {
          const functionCallPart: any = {
            functionCall: {
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments)
            }
          };

          // Include thought signature if present (Gemini 3 requirement)
          if ((toolCall as any).thought_signature) {
            functionCallPart.thoughtSignature = (toolCall as any).thought_signature;
          }

          parts.push(functionCallPart);
        }

        contents.push({
          role: 'model',
          parts
        });
        continue;
      }

      // Handle tool results - group consecutive tool messages together
      if (message.role === 'tool') {
        const functionResponseParts = [];

        // Collect this and all consecutive tool messages
        let j = i;
        while (j < request.messages.length && request.messages[j].role === 'tool') {
          const toolMsg = request.messages[j];
          functionResponseParts.push({
            functionResponse: {
              name: toolMsg.tool_call_id || toolMsg.name,
              response: {
                content: toolMsg.content
              }
            }
          });
          j++;
        }

        // Push all tool responses as a single user message
        contents.push({
          role: 'user',
          parts: functionResponseParts
        });

        // Skip the messages we just processed
        i = j - 1;
        continue;
      }

      // Handle multimodal content (images + text)
      if (Array.isArray(message.content)) {
        const parts: any[] = [];

        for (const item of message.content) {
          if (item.type === 'text') {
            parts.push({ text: item.text });
          } else if (item.type === 'image_url' && item.image_url?.url) {
            // Convert OpenAI image_url format to Vertex AI inlineData format
            const imageUrl = item.image_url.url;

            if (imageUrl.startsWith('data:')) {
              // Handle base64 data URLs
              const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                const mimeType = matches[1];
                const base64Data = matches[2];
                parts.push({
                  inlineData: {
                    mimeType,
                    data: base64Data
                  }
                });
                this.logger.debug({
                  mimeType,
                  dataLength: base64Data.length
                }, '[GoogleVertexProvider] Added inline image data');
              }
            } else {
              // Handle URL references (Vertex AI also supports fileData for URLs)
              parts.push({
                fileData: {
                  mimeType: 'image/jpeg', // Default, may need to detect
                  fileUri: imageUrl
                }
              });
              this.logger.debug({
                fileUri: imageUrl
              }, '[GoogleVertexProvider] Added file URI reference');
            }
          }
        }

        contents.push({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts
        });
      } else {
        // Simple text content
        contents.push({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content || '' }]
        });
      }
    }

    // Return both contents and systemInstruction so it can be passed to model config
    return { contents, systemInstruction };
  }

  private convertFinishReason(vertexReason: string): string {
    const reasonMap: Record<string, string> = {
      STOP: 'stop',
      MAX_TOKENS: 'length',
      SAFETY: 'content_filter',
      RECITATION: 'content_filter',
      OTHER: 'stop'
    };

    return reasonMap[vertexReason] || 'stop';
  }

  async listModels(): Promise<Array<{
    id: string;
    name: string;
    provider: string;
    capabilities?: {
      chat: boolean;
      vision: boolean;
      tools: boolean;
      embeddings: boolean;
      imageGeneration: boolean;
      streaming: boolean;
    };
    maxTokens?: number;
    contextWindow?: number;
    description?: string;
  }>> {
    if (!this.initialized) {
      throw new Error('Google Vertex AI provider not initialized');
    }

    // DB-only: return models from provider_config.models + config model fields
    const models: Array<{
      id: string;
      name: string;
      provider: string;
      capabilities?: {
        chat: boolean;
        vision: boolean;
        tools: boolean;
        embeddings: boolean;
        imageGeneration: boolean;
        streaming: boolean;
      };
      maxTokens?: number;
      contextWindow?: number;
      description?: string;
    }> = [];
    const addedModels = new Set<string>();

    // Helper to add model
    const addModel = (modelId: string | undefined) => {
      if (modelId && !addedModels.has(modelId)) {
        addedModels.add(modelId);
        models.push({
          id: modelId,
          name: modelId,
          provider: 'google-vertex',
        });
      }
    };

    // Add models from DB config fields (set during initialize from ProviderConfigService)
    addModel((this.config as any)?.chatModel || (this.config as any)?.modelId);
    addModel((this.config as any)?.embeddingModel);
    addModel((this.config as any)?.visionModel);
    addModel((this.config as any)?.imageModel);
    addModel((this.config as any)?.compactionModel);
    addModel((this.config as any)?.defaultModel);

    // Add database-configured models array (from admin API / provider_config.models)
    const dbConfiguredModels = (this.config as any)?.models as any[];
    if (Array.isArray(dbConfiguredModels)) {
      for (const dbModel of dbConfiguredModels) {
        if (dbModel.id && !addedModels.has(dbModel.id)) {
          addedModels.add(dbModel.id);
          models.push({
            id: dbModel.id,
            name: dbModel.name || dbModel.id,
            provider: 'google-vertex',
            capabilities: dbModel.capabilities,
            maxTokens: dbModel.maxTokens,
            contextWindow: dbModel.contextWindow,
            description: dbModel.description,
          });
        }
      }
    }

    this.logger.info({
      modelsCount: models.length,
      models: models.map(m => m.id),
    }, '[GoogleVertexProvider] Listed models from DB config');

    return models;
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.initialized || !this.genAI) {
      return {
        status: 'not_initialized',
        provider: this.name,
        lastChecked: new Date()
      };
    }

    try {
      // Simple health check - make a minimal test request
      // Use provider-specific env vars or DB config — never fall back to DEFAULT_MODEL which may be Ollama
      const model = process.env.VERTEX_HEALTH_CHECK_MODEL
        || process.env.VERTEX_DEFAULT_MODEL
        || (this.config as any)?.defaultModel
        || (this.config as any)?.chatModel
        || (this.config as any)?.modelId;
      if (!model) {
        return {
          status: 'unhealthy',
          provider: this.name,
          error: 'No Vertex/Gemini model configured for health check. Set VERTEX_DEFAULT_MODEL or configure defaultModel in provider settings.',
          lastChecked: new Date()
        };
      }

      const result = await this.genAI.models.generateContent({
        model: model,
        contents: 'test',
        config: {
          maxOutputTokens: 10
        }
      });

      if (result.text) {
        return {
          status: 'healthy',
          provider: this.name,
          endpoint: this.config?.endpoint,
          lastChecked: new Date()
        };
      }

      throw new Error('No response from Vertex AI');
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

  private estimateCost(modelName: string, tokens: number): number {
    // Cost tracking is handled centrally by LLMMetricsService
    // Return 0 here - actual costs are calculated and stored when logging metrics
    return 0;
  }

  /**
   * Try to get an existing cache or create a new one for the given content
   * Returns null if caching fails or is not applicable
   */
  private async tryGetOrCreateCache(
    content: string,
    model: string,
    userId?: string,
    sessionId?: string
  ): Promise<CacheLookupResult | null> {
    if (!this.cacheManager?.isReady()) {
      return null;
    }

    try {
      // First try to find an existing cache
      const existing = await this.cacheManager.lookupCache(content, model);
      if (existing.found) {
        return existing;
      }

      // Create a new cache if content is cacheable
      const result = await this.cacheManager.createCache(content, model, {
        ttlSeconds: this.config?.cacheTtlSeconds || 3600,
        userId,
        sessionId
      });

      if (result.success && result.cacheName) {
        return {
          found: true,
          cacheName: result.cacheName,
          metadata: {
            cacheName: result.cacheName,
            contentHash: '',
            model,
            createdAt: new Date(),
            expiresAt: result.expiresAt || new Date(Date.now() + 3600000),
            tokenCount: result.tokenCount,
            usageCount: 1,
            lastUsedAt: new Date(),
            userId,
            sessionId
          }
        };
      }

      return null;
    } catch (error: any) {
      this.logger.warn({
        error: error.message,
        model,
        contentLength: content.length
      }, '[GoogleVertexProvider] Cache operation failed, using uncached content');
      return null;
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): any {
    return this.cacheManager?.getStats() || { enabled: false };
  }

  /**
   * Generate text embeddings using Vertex AI
   * Supports text-embedding-004, text-embedding-005, textembedding-gecko models
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    if (!this.initialized || !this.genAI) {
      throw new Error('Google Vertex AI provider not initialized');
    }

    try {
      // Registry SoT: provider-specific VERTEX_AI_EMBEDDING_MODEL (bootstrap
      // env) wins; else resolve the embedding role from the Registry
      // (admin.model_role_assignments via RegistryReader) instead of the
      // cross-provider EMBEDDING_MODEL env var that may point at a non-Vertex
      // embedding model.
      const embeddingModel =
        process.env.VERTEX_AI_EMBEDDING_MODEL ||
        (await (async () => {
          const { RegistryReader } = await import('../model-registry/RegistryReader.js');
          return new RegistryReader().getDefaultModel('embedding')
            .then((row) => row.model)
            .catch(() => '');
        })());

      const texts = Array.isArray(text) ? text : [text];
      const embeddings: number[][] = [];

      // Vertex AI embedding API requires calling the prediction endpoint
      const projectId = this.config?.projectId || process.env.GOOGLE_CLOUD_PROJECT!;
      const location = this.config?.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

      // Use the VertexAI client to get embeddings
      // Note: @google/genai doesn't have a direct embeddings API yet,
      // so we need to use the prediction endpoint directly
      const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${embeddingModel}:predict`;

      // Shared helper — see GoogleVertexAuth.ts for why every GoogleAuth
      // construction in this provider must route through it.
      const authOptions = buildVertexAuthOptions();
      if (!authOptions.credentials && process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        this.logger.warn('Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON, falling back to ADC');
      }

      const auth = new GoogleAuth(authOptions);
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();

      // Make requests for each text
      for (const inputText of texts) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            instances: [{ content: inputText }]
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Vertex AI embedding request failed: ${response.status} ${errorText}`);
        }

        const result = await response.json();
        const embedding = result.predictions?.[0]?.embeddings?.values;

        if (!embedding || !Array.isArray(embedding)) {
          throw new Error('Invalid embedding response from Vertex AI');
        }

        embeddings.push(embedding);
      }

      this.logger.debug(
        {
          model: embeddingModel,
          textCount: texts.length,
          dimension: embeddings[0]?.length
        },
        'Generated embeddings with Vertex AI'
      );

      return Array.isArray(text) ? embeddings : embeddings[0];
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          provider: this.name
        },
        'Failed to generate embeddings with Vertex AI'
      );
      throw error;
    }
  }

  // Cache for discovered models (5-minute TTL)
  private discoveredModelCache?: { models: DiscoveredModel[]; timestamp: number };
  private static readonly DISCOVER_CACHE_TTL_MS = 5 * 60 * 1000;

  /**
   * Discover models available from Google Vertex AI via live REST API.
   * Calls GET https://{region}-aiplatform.googleapis.com/v1/publishers/google/models
   * On failure: returns empty array with error logged (no hardcoded fallback).
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    // Build set of already-configured model IDs for marking
    const configuredIds = new Set<string>();
    try {
      const existing = await this.listModels();
      for (const m of existing) configuredIds.add(m.id);
    } catch { /* ignore */ }

    // Check cache
    const now = Date.now();
    if (this.discoveredModelCache && (now - this.discoveredModelCache.timestamp) < GoogleVertexProvider.DISCOVER_CACHE_TTL_MS) {
      const cached = this.discoveredModelCache.models;
      for (const model of cached) {
        model.configured = configuredIds.has(model.id);
      }
      return cached;
    }

    try {
      if (!this.genAI) {
        throw new Error('Google Vertex AI SDK not initialized');
      }

      // Use the @google/genai SDK to list models — more reliable than REST API
      // The SDK handles auth, project/region, and returns proper model metadata
      let apiModels: any[] = [];
      try {
        const modelsResponse = await this.genAI.models.list();
        // The SDK returns an async iterable or array
        if (modelsResponse && Symbol.asyncIterator in Object(modelsResponse)) {
          for await (const model of modelsResponse as any) {
            apiModels.push(model);
          }
        } else if (Array.isArray(modelsResponse)) {
          apiModels = modelsResponse;
        } else if ((modelsResponse as any)?.models) {
          apiModels = (modelsResponse as any).models;
        } else if ((modelsResponse as any)?.page) {
          // Paginated response
          for await (const model of (modelsResponse as any).page) {
            apiModels.push(model);
          }
        }
      } catch (sdkErr: any) {
        this.logger.warn({ error: sdkErr.message }, '[GoogleVertexProvider] SDK models.list() failed, trying REST API');
        // Fallback to REST API
        const projectId = this.config?.projectId || process.env.GOOGLE_CLOUD_PROJECT;
        const location = this.config?.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
        const auth = new GoogleAuth(buildVertexAuthOptions());
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();
        // Try multiple endpoint formats
        for (const urlPath of [
          `https://${location}-aiplatform.googleapis.com/v1beta1/publishers/google/models`,
          `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models`,
          `https://generativelanguage.googleapis.com/v1beta/models`,
        ]) {
          try {
            const resp = await fetch(urlPath, {
              headers: { Authorization: `Bearer ${accessToken.token}` },
              signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
              const data = await resp.json() as any;
              apiModels = data.models || data.publisherModels || [];
              if (apiModels.length > 0) {
                this.logger.info({ url: urlPath, count: apiModels.length }, '[GoogleVertexProvider] REST API returned models');
                break;
              }
            }
          } catch { /* try next */ }
        }
      }

      const models: DiscoveredModel[] = apiModels
        .filter((m: any) => {
          // Filter to relevant model types
          const name = (m.name || '').toLowerCase();
          const displayName = (m.displayName || '').toLowerCase();
          // Include Gemini, embedding, and image generation models
          return displayName.includes('gemini') || displayName.includes('embed') ||
                 displayName.includes('imagen') || name.includes('gemini') ||
                 name.includes('embed') || name.includes('imagen');
        })
        .map((m: any): DiscoveredModel => {
          // Extract model ID from full resource name (publishers/google/models/gemini-2.5-pro)
          const fullName = m.name || '';
          const modelId = fullName.split('/').pop() || fullName;
          const displayName = m.displayName || modelId;
          const description = m.description || '';
          const dl = displayName.toLowerCase();
          const ml = modelId.toLowerCase();

          // Infer capabilities from model metadata and name
          const supportedActions = m.supportedActions || {};
          const hasGenerate = !!supportedActions.generateContent || dl.includes('gemini');
          const hasEmbed = !!supportedActions.computeTokens || ml.includes('embed');
          const hasImageGen = ml.includes('imagen');
          const hasVision = dl.includes('gemini') && !ml.includes('lite') && !hasEmbed;
          const hasThinking = ml.includes('2.5') || ml.includes('3.') || ml.includes('thinking');
          const hasTools = hasGenerate && !hasEmbed && !hasImageGen;

          // Infer family
          let family = 'google';
          if (ml.includes('gemini-3')) family = 'gemini-3';
          else if (ml.includes('gemini-2.5')) family = 'gemini-2.5';
          else if (ml.includes('gemini-2.0') || ml.includes('gemini-2')) family = 'gemini-2.0';
          else if (ml.includes('gemini-1.5')) family = 'gemini-1.5';
          else if (ml.includes('embed')) family = 'embedding';
          else if (ml.includes('imagen')) family = 'imagen';

          // Infer cost tier
          let costTier: DiscoveredModel['costTier'] = 'mid';
          if (ml.includes('pro')) costTier = 'high';
          else if (ml.includes('lite') || ml.includes('embed')) costTier = 'low';
          else if (ml.includes('flash')) costTier = 'low';
          else if (ml.includes('ultra')) costTier = 'premium';

          // Infer context window
          let contextWindow: number | undefined;
          if (ml.includes('gemini-2.5') || ml.includes('gemini-2.0') || ml.includes('gemini-3')) contextWindow = 1048576;
          else if (ml.includes('gemini-1.5-pro')) contextWindow = 2097152;
          else if (ml.includes('gemini-1.5')) contextWindow = 1048576;

          // Infer max output tokens
          let maxOutputTokens: number | undefined;
          if (ml.includes('2.5') || ml.includes('3.')) maxOutputTokens = 65536;
          else if (ml.includes('gemini')) maxOutputTokens = 8192;

          return {
            id: modelId,
            name: displayName,
            provider: 'google-vertex',
            description: description || `Google ${displayName}`,
            family,
            costTier,
            capabilities: {
              chat: hasGenerate && !hasEmbed && !hasImageGen,
              vision: hasVision,
              tools: hasTools,
              thinking: hasThinking,
              embeddings: hasEmbed,
              imageGeneration: hasImageGen,
              streaming: hasGenerate,
            },
            contextWindow,
            maxOutputTokens,
          };
        });

      // Cache the results
      this.discoveredModelCache = { models, timestamp: now };

      this.logger.info({ discoveredCount: models.length }, '[GoogleVertexProvider] Live model discovery complete');

      // Mark configured models
      for (const model of models) {
        model.configured = configuredIds.has(model.id);
      }

      return models;
    } catch (err: any) {
      this.logger.error({ error: err.message }, '[GoogleVertexProvider] Live model discovery failed — returning empty list');
      return [];
    }
  }

  async getModelDefaults(modelId: string): Promise<Partial<import('./ILLMProvider.js').ProviderDefaultConfig> | null> {
    // Vertex AI doesn't have a model metadata API for parameter limits.
    // Fall back to ModelCapabilityRegistry for model-specific limits.
    return null;
  }

  /**
   * #650 — Live provider-pulled model details. Pulls from the Vertex AI
   * Publishers REST API (`/v1/publishers/google/models/{modelId}`) for
   * `inputTokenLimit`, `outputTokenLimit`, and `supportedGenerationMethods`.
   *
   * Pricing: vendored sheet via VertexPublisherListFetcher (GCP doesn't
   * publish a public REST endpoint for per-model GenAI pricing — see
   * services/openagentic-api/src/services/pricing/data/vertex-publisher-list.json
   * for the rate sheet and refresh runbook).
   *
   * Tests inject `injectedFetch` + `injectedPricingFetcher` so the suite
   * runs offline; live network is used in production.
   */
  async discoverModelDetails(
    modelId: string,
    region?: string,
  ): Promise<import('./discovery/ModelDiscoveryRecord.js').ModelDiscoveryRecord | null> {
    if (!this.initialized) {
      throw new Error('[GoogleVertexProvider] not initialized');
    }
    const inferenceRegion =
      region ??
      (this.config?.location as string | undefined) ??
      process.env.GOOGLE_CLOUD_LOCATION ??
      'us-central1';

    // 1. Publishers REST GET — capabilities + limits. Best-effort: when
    //    auth fails or the response isn't valid JSON (GCP returns HTML for
    //    some 401/403 paths — caught live as "Unexpected token 'i'…
    //    illegal ba…"), fall back to family-slug-driven defaults so we
    //    still write a useful row instead of erroring the whole refresh.
    const url = `https://${inferenceRegion}-aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(modelId)}`;
    let data: {
      name?: string;
      displayName?: string;
      version?: string;
      description?: string;
      inputTokenLimit?: number;
      outputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    } = {};
    try {
      let resp: { ok: boolean; status: number; json: () => Promise<any> };
      if ((this as any).injectedFetch) {
        resp = await (this as any).injectedFetch(url);
      } else {
        const { GoogleAuth } = await import('google-auth-library');
        const auth = new GoogleAuth(buildVertexAuthOptions());
        const client = await auth.getClient();
        const tokenResult = await client.getAccessToken();
        resp = await globalThis.fetch(url, {
          headers: { Authorization: `Bearer ${tokenResult.token}` },
          signal: AbortSignal.timeout(10000),
        });
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      data = (await resp.json()) as typeof data;
    } catch (err) {
      this.logger.warn(
        { modelId, region: inferenceRegion, err: (err as Error).message },
        '[GoogleVertexProvider] publishers REST failed — using family-slug fallback',
      );
    }

    // Family classification by id substring (slug derivation, NOT a
    // hardcoded model id — admins override per-row via Refresh).
    const m = modelId.toLowerCase();
    let family = 'google';
    if (m.includes('gemini-3')) family = 'gemini-3';
    else if (m.includes('gemini-2.5')) family = 'gemini-2.5';
    else if (m.includes('gemini-2')) family = 'gemini-2.0';
    else if (m.includes('gemini-1.5')) family = 'gemini-1.5';
    else if (m.includes('embed')) family = 'embedding';
    else if (m.includes('imagen')) family = 'imagen';
    else if (m.includes('claude')) family = 'anthropic-on-vertex';

    // When Publishers REST gave us methods, use those (authoritative).
    // Otherwise synthesize from family slug so capabilities + limits still
    // populate. Non-Gemini families fall through and capabilities stay
    // false — admin must edit the row by hand.
    const methods = new Set(data.supportedGenerationMethods ?? []);
    if (methods.size === 0) {
      if (family === 'embedding') {
        methods.add('embedContent');
      } else if (family.startsWith('gemini') || family === 'anthropic-on-vertex') {
        methods.add('generateContent');
        methods.add('streamGenerateContent');
        methods.add('countTokens');
      }
    }

    // Limit fallbacks per family.
    const familyLimits: Record<string, { input: number; output: number }> = {
      'gemini-3':            { input: 1_048_576, output: 65_536 },
      'gemini-2.5':          { input: 1_048_576, output: 65_536 },
      'gemini-2.0':          { input: 1_048_576, output: 8_192 },
      'gemini-1.5':          { input: 1_048_576, output: 8_192 },
      'anthropic-on-vertex': { input: 200_000,   output: 64_000 },
      'imagen':              { input: 480,       output: 480 },
      'embedding':           { input: 2_048,     output: 768 },
    };
    const fallbackLimits = familyLimits[family] ?? { input: 0, output: 0 };

    const isEmbedding = methods.has('embedContent') || family === 'embedding';
    const isImageGen = family === 'imagen';
    const supportsThinking =
      family === 'gemini-2.5' ||
      family === 'gemini-3' ||
      family === 'anthropic-on-vertex';
    const supportsVision =
      family === 'gemini-2.5' ||
      family === 'gemini-3' ||
      family === 'gemini-1.5' ||
      family === 'gemini-2.0' ||
      family === 'anthropic-on-vertex';

    // 2. Pricing — VertexPublisherListFetcher (vendored sheet).
    const fetcher =
      (this as any).injectedPricingFetcher ??
      (await import('../pricing/VertexPublisherListFetcher.js').then(
        (mod) => new mod.VertexPublisherListFetcher(),
      ));
    let pricing: any = {
      source: 'vertex-publisher-list',
      fetchedAt: new Date().toISOString(),
    };
    try {
      pricing = await fetcher.fetch({ modelId, region: inferenceRegion });
    } catch (err) {
      this.logger.warn(
        { modelId, err: (err as Error).message },
        '[GoogleVertexProvider] pricing fetch failed — leaving null',
      );
    }

    return {
      modelId,
      providerType: 'google-vertex',
      displayName: data.displayName ?? modelId,
      family,
      capabilities: {
        chat: methods.has('generateContent') && !isEmbedding && !isImageGen,
        vision: supportsVision && !isEmbedding && !isImageGen,
        tools: methods.has('generateContent') && !isEmbedding,
        thinking: supportsThinking,
        embeddings: isEmbedding,
        imageGeneration: isImageGen,
        streaming: methods.has('streamGenerateContent'),
        nativeToolCalling: methods.has('generateContent') && !isEmbedding,
      },
      contextWindow: data.inputTokenLimit ?? (fallbackLimits.input || null),
      maxOutputTokens: data.outputTokenLimit ?? (fallbackLimits.output || null),
      thinkingBudget: supportsThinking ? 8000 : null,
      temperature: 1.0,
      topP: 0.95,
      topK: family.startsWith('gemini') ? 40 : null,
      pricing: {
        inputTokenUsd: pricing.inputTokenUsd ?? null,
        outputTokenUsd: pricing.outputTokenUsd ?? null,
        cacheReadUsd: pricing.cacheReadUsd ?? null,
        cacheWriteUsd: pricing.cacheWriteUsd ?? null,
        thinkingTokenUsd: pricing.thinkingTokenUsd ?? null,
        embeddingTokenUsd: pricing.embeddingTokenUsd ?? null,
        perRequestUsd: pricing.imageGenPerRequestUsd ?? null,
        source: pricing.source ?? 'vertex-publisher-list',
        fetchedAt: pricing.fetchedAt ?? new Date().toISOString(),
        region: inferenceRegion,
      },
    };
  }

  static getDefaultConfig(): import('./ILLMProvider.js').ProviderDefaultConfig {
    return {
      maxTokens: 8192, temperature: 1.0, topP: 0.95, topK: 40,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: true, thinkingBudget: 8000, thinkingLevel: 'high',
      supportsTopK: true, supportsFreqPenalty: false, supportsThinking: true,
      thinkingMode: 'level',
      temperatureRange: [0, 2], maxTokensRange: [256, 65536], topKRange: [1, 40],
      defaultChatModel: 'gemini-2.0-flash', defaultEmbeddingModel: 'text-embedding-005',
    };
  }

  /**
   * Generate an image using Google Vertex AI.
   * Supports both Gemini 3 Pro Image (generateContent) and Imagen 3 (predict).
   */
  async generateImage(request: import('./ILLMProvider.js').ImageGenerationRequest): Promise<import('./ILLMProvider.js').ImageGenerationResponse> {
    if (!this.initialized || !this.genAI) {
      throw new Error('[GoogleVertexProvider] Not initialized — cannot generate image');
    }

    const startTime = Date.now();
    const model = request.model || 'gemini-2.5-flash-preview-image-generation';
    const modelLower = model.toLowerCase();
    const sizeToAspect = (size: string) => {
      if (size === '1792x1024') return '16:9';
      if (size === '1024x1792') return '9:16';
      return '1:1';
    };
    const aspectRatio = sizeToAspect(request.size || '1024x1024');

    // Gemini models use generateContent with responseModalities
    if (modelLower.includes('gemini')) {
      const response = await this.genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'] as any,
          imageConfig: { aspectRatio } as any,
        } as any,
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if ((part as any).inlineData?.mimeType?.startsWith('image/')) {
          const imageBase64 = (part as any).inlineData.data;
          const mimeType = (part as any).inlineData.mimeType;
          const format = mimeType.includes('jpeg') ? 'jpeg' as const : mimeType.includes('webp') ? 'webp' as const : 'png' as const;

          this.logger.info({ model, generationTimeMs: Date.now() - startTime }, '[GoogleVertexProvider] Gemini image generated');
          return {
            imageBase64,
            revisedPrompt: request.prompt,
            model,
            provider: this.name,
            format,
            generationTimeMs: Date.now() - startTime,
          };
        }
      }
      const textParts = parts.filter((p: any) => p.text);
      if (textParts.length > 0) {
        throw new Error(`Gemini returned text instead of image: ${(textParts[0] as any).text?.substring(0, 200)}`);
      }
      throw new Error('No image data in Gemini response');
    }

    // Imagen models use predict endpoint
    const projectId = this.config?.projectId || process.env.GOOGLE_CLOUD_PROJECT;
    const location = this.config?.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    if (!projectId) throw new Error('[GoogleVertexProvider] No projectId for Imagen');

    // Get access token. Routes through buildVertexAuthOptions() so the
    // service-account credentials the DB seeded via initialize() actually
    // reach google-auth-library — before this, generateImage() built a
    // bare GoogleAuth and fell through to Application Default Credentials,
    // which k3s-local doesn't have.
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth(buildVertexAuthOptions());
    const client = await auth.getClient();
    const tokenResult = await client.getAccessToken();
    const accessToken = tokenResult.token;

    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        instances: [{ prompt: request.prompt }],
        parameters: { sampleCount: request.n || 1, aspectRatio, safetyFilterLevel: 'block_some', personGeneration: 'allow_adult' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Imagen error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    const imageBytes = data.predictions?.[0]?.bytesBase64Encoded;
    if (!imageBytes) throw new Error('No image data in Imagen response');

    this.logger.info({ model, generationTimeMs: Date.now() - startTime }, '[GoogleVertexProvider] Imagen image generated');
    return {
      imageBase64: imageBytes,
      revisedPrompt: request.prompt,
      model,
      provider: this.name,
      format: 'png',
      generationTimeMs: Date.now() - startTime,
    };
  }
}

