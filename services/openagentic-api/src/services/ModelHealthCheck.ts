/**

 * For all inquiries, please contact:
 * 
 * Openagentic LLC
 * hello@openagentic.io
 */

import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'crypto';
import type { ProviderManager } from './llm-providers/ProviderManager.js';
import { ModelConfigurationService } from './ModelConfigurationService.js';

interface ModelHealthResult {
  healthy: boolean;
  model: string;
  responseTime: number;
  error?: string;
  response?: string;
  testUuid?: string;
  questionAsked?: string;
}

export class ModelHealthCheckService {
  private logger: FastifyBaseLogger;
  private providerManager: ProviderManager;
  private lastHealthCheck?: ModelHealthResult;
  private lastCheckTime?: Date;
  // Default to 5 minutes (300000ms) to reduce API calls and avoid rate limiting
  // Previous default of 30s was too aggressive and caused rate limiting with Azure AI Foundry
  private checkIntervalMs = parseInt(process.env.MODEL_HEALTH_CHECK_INTERVAL_MS || '300000');
  private healthCheckDisabled = process.env.DISABLE_MODEL_HEALTH_CHECK === 'true';

  constructor(logger: FastifyBaseLogger, providerManager: ProviderManager) {
    this.logger = logger;
    this.providerManager = providerManager;

    if (this.healthCheckDisabled) {
      this.logger.info('Model health checks DISABLED (DISABLE_MODEL_HEALTH_CHECK=true)');
    } else {
      this.logger.info({ intervalMs: this.checkIntervalMs }, 'Model health check interval configured');
    }
  }

  /**
   * Check model health with optional cache bypass
   * @param forceRefresh - If true, bypasses the cache and performs a fresh health check.
   *                       Use this for actual health endpoint calls to ensure fresh UUID validation.
   *                       The cached version is for internal rate-limited checks.
   */
  async checkModelHealth(forceRefresh: boolean = false): Promise<ModelHealthResult> {
    // If health checks are disabled, return a synthetic healthy result
    if (this.healthCheckDisabled) {
      return {
        healthy: true,
        model: 'health-check-disabled',
        responseTime: 0,
        response: 'Health checks disabled via DISABLE_MODEL_HEALTH_CHECK=true'
      };
    }

    const now = new Date();

    // Return cached result if check was recent AND not forcing refresh
    // Default interval is 5 minutes to avoid rate limiting
    if (!forceRefresh && this.lastHealthCheck && this.lastCheckTime &&
        (now.getTime() - this.lastCheckTime.getTime()) < this.checkIntervalMs) {
      this.logger.debug({
        cacheAge: now.getTime() - this.lastCheckTime.getTime(),
        cacheIntervalMs: this.checkIntervalMs
      }, 'Returning cached health check result');
      return this.lastHealthCheck;
    }

    const startTime = Date.now();

    // Use DB-configured default chat model for health checks (DB is SoT).
    const model = await ModelConfigurationService.getDefaultChatModel().catch(() => '');

    this.logger.debug({ model }, 'Using model for health check');

    // Generate unique UUID for each test to prevent caching
    const testUuid = randomUUID();
    const question = `HEALTH CHECK TEST - You must follow these instructions exactly:

1. First, output this exact line: "UUID: ${testUuid}"
2. Then write a short 4-line rhyming poem about technology

Your response MUST start with the UUID line above. This is a system health check.`;

    try {
      // Use ProviderManager for completion
      const response = await this.providerManager.createCompletion({
        model,
        messages: [
          {
            role: 'user',
            content: question
          }
        ],
        max_tokens: 200,
        temperature: 0.8, // Higher temperature for creativity
        stream: false // Don't stream for health checks
      });
      const responseTime = Date.now() - startTime;

      // ProviderManager returns CompletionResponse (not streaming)
      const completionResponse = response as any;
      const aiResponse = completionResponse.choices?.[0]?.message?.content?.trim() || '';

      // Log the response for debugging
      this.logger.debug({
        choices: completionResponse.choices?.length || 0,
        hasContent: !!completionResponse.choices?.[0]?.message?.content,
        responsePreview: aiResponse.substring(0, 100)
      }, 'Model health check response:');

      // Validate that we got a meaningful response
      if (!aiResponse) {
        this.logger.error({ response }, 'Model returned empty response:');
        throw new Error('Model returned empty response');
      }

      // Check if response contains the UUID (proving it's not cached)
      if (!aiResponse.includes(testUuid)) {
        throw new Error(`Model response doesn't contain the test UUID. This suggests cached or invalid response: "${aiResponse.substring(0, 100)}..."`);
      }

      // Check if it looks like a poem (has line breaks or poetic structure)
      const looksLikePoem = aiResponse.includes('\n') || 
                           /\b(verse|stanza|rhyme|poem)\b/i.test(aiResponse) ||
                           aiResponse.split(' ').length < 50; // Short-ish response

      if (!looksLikePoem) {
        throw new Error(`Model response doesn't appear to be a poem as requested: "${aiResponse.substring(0, 100)}..."`);
      }

      const result: ModelHealthResult = {
        healthy: true,
        model,
        responseTime,
        response: aiResponse,
        testUuid,
        questionAsked: question
      };

      this.lastHealthCheck = result;
      this.lastCheckTime = now;
      
      this.logger.debug({ 
        model, 
        responseTime, 
        response: aiResponse 
      }, 'Model health check passed');
      
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const result: ModelHealthResult = {
        healthy: false,
        model,
        responseTime,
        error: errorMessage
      };

      this.lastHealthCheck = result;
      this.lastCheckTime = now;
      
      this.logger.error({ 
        model, 
        responseTime, 
        error: errorMessage 
      }, 'Model health check failed');
      
      return result;
    }
  }

  getLastHealthCheck(): ModelHealthResult | undefined {
    return this.lastHealthCheck;
  }
}