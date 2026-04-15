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
 * Title Generation Client
 *
 * Uses ProviderManager to support any configured LLM provider (Azure, AWS Bedrock, Vertex AI)
 * Previously used Azure OpenAI directly - now uses multi-provider system
 */

import fetch from 'node-fetch';
import { Logger } from 'pino';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

interface TitleClientConfig {
  defaultModel?: string;
  timeout?: number;
  providerManager?: any; // ProviderManager instance
}

interface CompletionRequest {
  model?: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  user?: string;
  metadata?: Record<string, any>;
}

interface CompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Title Generation Client using ProviderManager
 * Supports any configured LLM provider (AWS Bedrock, Azure OpenAI, Vertex AI)
 */
export class TitleGenerationClient {
  private logger: Logger;
  private config: TitleClientConfig;
  private providerManager: any;

  constructor(logger: Logger, config: Partial<TitleClientConfig> = {}) {
    this.logger = logger.child({ service: 'TitleGenerationClient' });
    this.config = {
      // Use cheapest model available - title generation is a simple task
      defaultModel: process.env.TITLE_GENERATION_MODEL ||
                   process.env.ECONOMICAL_MODEL ||  // Cheapest model (Haiku/Nova Micro)
                   process.env.SECONDARY_MODEL ||   // Second cheapest
                   process.env.DEFAULT_MODEL,
      timeout: 5000, // 5 second timeout for title generation
      ...config
    };

    this.providerManager = config.providerManager;

    if (!this.providerManager) {
      this.logger.warn('No ProviderManager provided - title generation will be disabled');
    }
  }

  /**
   * Generate a completion for title generation using ProviderManager
   */
  async generateCompletion(params: CompletionRequest): Promise<{ content: string }> {
    if (!this.providerManager) {
      throw new Error('ProviderManager not initialized - cannot generate titles');
    }

    const startTime = Date.now();

    try {
      const response: any = await this.providerManager.createCompletion({
        model: params.model || this.config.defaultModel,
        messages: params.messages,
        temperature: params.temperature ?? 0.3,
        max_tokens: params.max_tokens ?? 20,
        stream: false
      });

      const content = response.choices?.[0]?.message?.content || '';
      const latency = Date.now() - startTime;

      this.logger.debug({
        model: response.model,
        latency,
        tokens: response.usage,
        content: content.substring(0, 100)
      }, 'Title generation completed');

      // Track metrics
      this.trackMetrics({
        model: response.model,
        latency,
        tokens: response.usage?.total_tokens || 0,
        success: true
      });

      return { content };

    } catch (error: any) {
      const latency = Date.now() - startTime;

      this.logger.error({
        error: error.message,
        latency,
        model: params.model || this.config.defaultModel
      }, 'Title generation failed');

      // Track failure metrics
      this.trackMetrics({
        model: params.model || this.config.defaultModel!,
        latency,
        tokens: 0,
        success: false
      });

      throw error;
    }
  }

  /**
   * Generate multiple title suggestions
   */
  async generateMultipleTitles(
    userMessage: string,
    count: number = 3,
    style?: 'concise' | 'descriptive' | 'creative'
  ): Promise<string[]> {
    const stylePrompts = {
      concise: 'Generate very short, concise titles (2-4 words)',
      descriptive: 'Generate descriptive but clear titles (4-7 words)',
      creative: 'Generate creative, engaging titles that capture attention'
    };

    const systemPrompt = `Generate ${count} different title suggestions for a chat conversation.
${stylePrompts[style || 'concise']}.
Each title should be on a new line.
Focus on different aspects of the user's message.
No numbers, bullets, or prefixes - just the titles.`;

    try {
      const response = await this.generateCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate titles for: "${userMessage.substring(0, 500)}"` }
        ],
        temperature: 0.7, // Higher temperature for variety
        max_tokens: 60 // More tokens for multiple titles
      });

      const titles = response.content
        .split('\n')
        .map(title => title.trim())
        .filter(title => title.length > 2 && title.length < 100)
        .slice(0, count);

      return titles.length > 0 ? titles : [`Chat ${new Date().toLocaleTimeString()}`];

    } catch (error) {
      this.logger.error({ error }, 'Failed to generate multiple titles');
      return [`Chat ${new Date().toLocaleTimeString()}`];
    }
  }

  /**
   * Track metrics for monitoring
   */
  private trackMetrics(metrics: {
    model: string;
    latency: number;
    tokens: number;
    success: boolean;
  }): void {
    // In production, this would send to a metrics service
    if (process.env.ENABLE_METRICS === 'true') {
      // Example: Send to Prometheus, DataDog, etc.
      this.logger.info({ metrics }, 'Title generation metrics');
    }
  }

  /**
   * Health check for LLM provider connection
   */
  async healthCheck(): Promise<boolean> {
    if (!this.providerManager) {
      return false;
    }

    try {
      const healthStatus = await this.providerManager.getHealthStatus();
      return Array.from(healthStatus.values()).some((health: any) => health.status === 'healthy');
    } catch (error) {
      this.logger.error({ error }, 'LLM provider health check failed');
      return false;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TitleClientConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.providerManager) {
      this.providerManager = config.providerManager;
    }
  }
}