/**

 * Self-Consistency Service
 * Implements multiple sampling and consensus finding for critical decisions
 */

import { PrismaClient } from '@prisma/client';
import { AzureOpenAI } from 'openai';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';

interface ChatCompletionMessageParam {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content: string | null;
  name?: string;
  function_call?: any;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ConsistencyResponse {
  response: string;
  confidence: number;
  reasoning: string;
  approach?: string;
}

export interface ConsensusResult {
  recommendation: string;
  confidence: number;
  alternatives: Array<{
    option: string;
    confidence: number;
    reasoning?: string;
  }>;
  reasoning: string[];
  isWeak?: boolean;
  samplingDetails?: {
    totalSamples: number;
    temperature: number;
    convergenceScore: number;
  };
}

export interface SelfConsistencyConfig {
  samples?: number;
  temperature?: number;
  maxTokens?: number;
  enableAlternatives?: boolean;
  confidenceThreshold?: number;
  criticalDecisionMode?: boolean;
}

export class SelfConsistencyService {
  private logger: any;
  private azureOpenAI: AzureOpenAI | null = null;
  private model: string;
  private isConfigured: boolean;

  constructor(logger: any) {
    this.logger = logger;

    // Use Azure OpenAI for all AI calls
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    this.model = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL;

    if (endpoint && apiKey) {
      try {
        this.azureOpenAI = new AzureOpenAI({
          endpoint,
          apiKey,
          apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
        });
        this.isConfigured = true;
        this.logger.info({
          endpoint,
          model: this.model
        }, 'SelfConsistencyService configured with Azure OpenAI');
      } catch (error) {
        this.isConfigured = false;
        this.logger.warn('SelfConsistencyService failed to initialize Azure OpenAI client - feature disabled');
      }
    } else {
      this.isConfigured = false;
      this.logger.info('SelfConsistencyService not configured - feature disabled');
    }
  }

  /**
   * Sample multiple responses for a given prompt
   */
  async sampleResponses(
    prompt: string,
    samples: number = 3,
    config: Partial<SelfConsistencyConfig> = {}
  ): Promise<ConsistencyResponse[]> {
    const { temperature = 0.7, maxTokens = 1000 } = config;

    if (!this.isConfigured) {
      // Mock responses for testing
      return this.generateMockResponses(prompt, samples);
    }

    const responses: ConsistencyResponse[] = [];
    
    // Add instruction to include confidence and reasoning
    const enhancedPrompt = `${prompt}

Please provide your response in the following format:
1. Your recommendation or answer
2. Your confidence level (0-100%)
3. Your reasoning for this recommendation

Format your response as:
RECOMMENDATION: [your answer]
CONFIDENCE: [percentage]
REASONING: [your explanation]`;

    try {
      if (!this.azureOpenAI || !this.isConfigured) {
        throw new Error('Azure OpenAI client not initialized');
      }

      const samplingPromises = Array(samples).fill(null).map(async (_, index) => {
        const response = await this.azureOpenAI!.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: enhancedPrompt }],
          temperature: temperature + (index * 0.1), // Vary temperature slightly
          max_tokens: maxTokens
        });

        const content = response.choices[0]?.message?.content || '';
        return this.parseStructuredResponse(content);
      });

      const results = await Promise.all(samplingPromises);
      return results;
    } catch (error) {
      this.logger.error('Error sampling responses:', error);
      return this.generateMockResponses(prompt, samples);
    }
  }

  /**
   * Find consensus among multiple responses
   */
  async findConsensus(
    responses: ConsistencyResponse[],
    config: Partial<SelfConsistencyConfig> = {}
  ): Promise<ConsensusResult> {
    const { confidenceThreshold = 0.6, enableAlternatives = true } = config;

    // Group similar responses
    const groupedResponses = this.groupSimilarResponses(responses);
    
    // Calculate consensus
    const consensusGroups = Array.from(groupedResponses.entries())
      .map(([key, group]) => ({
        option: key,
        responses: group,
        avgConfidence: group.reduce((sum, r) => sum + r.confidence, 0) / group.length,
        count: group.length
      }))
      .sort((a, b) => (b.count * b.avgConfidence) - (a.count * a.avgConfidence));

    const topChoice = consensusGroups[0];
    const alternatives = enableAlternatives ? consensusGroups.slice(1) : [];

    // Calculate overall consensus strength
    const convergenceScore = this.calculateConvergence(responses);
    const isWeak = convergenceScore < 0.5 || topChoice.avgConfidence < confidenceThreshold;

    // Aggregate reasoning
    const allReasonings = responses.map(r => r.reasoning);
    const uniqueReasonings = [...new Set(allReasonings)];

    return {
      recommendation: topChoice.option,
      confidence: topChoice.avgConfidence,
      alternatives: alternatives.map(alt => ({
        option: alt.option,
        confidence: alt.avgConfidence,
        reasoning: alt.responses[0].reasoning
      })),
      reasoning: uniqueReasonings.slice(0, 3), // Top 3 unique reasonings
      isWeak,
      samplingDetails: {
        totalSamples: responses.length,
        temperature: config.temperature || 0.7,
        convergenceScore
      }
    };
  }

  /**
   * Format consensus result for display
   */
  formatConsensus(consensus: ConsensusResult): string {
    let formatted = `**Recommendation**: ${consensus.recommendation}\n`;
    formatted += `**Confidence**: ${Math.round(consensus.confidence * 100)}%\n\n`;

    if (consensus.reasoning.length > 0) {
      formatted += `**Key Reasoning**:\n`;
      consensus.reasoning.forEach((reason, i) => {
        formatted += `${i + 1}. ${reason}\n`;
      });
      formatted += '\n';
    }

    if (consensus.alternatives.length > 0) {
      formatted += `**Alternative Approaches**:\n`;
      consensus.alternatives.forEach((alt, i) => {
        formatted += `${i + 1}. ${alt.option} (${Math.round(alt.confidence * 100)}% confidence)\n`;
        if (alt.reasoning) {
          formatted += `   - ${alt.reasoning}\n`;
        }
      });
    }

    if (consensus.isWeak) {
      formatted += `\n⚠️ **Note**: The consensus is relatively weak. Consider gathering more information or consulting additional sources.`;
    }

    return formatted;
  }

  /**
   * Check if self-consistency should be used for a given query
   */
  shouldUseSelfConsistency(
    message: string,
    context?: any
  ): boolean {
    // Keywords that indicate critical decisions
    const criticalKeywords = [
      'should i', 'recommend', 'best approach', 'migrate', 'delete',
      'production', 'critical', 'important', 'decide', 'choose',
      'trade-off', 'vs', 'versus', 'compare', 'risky'
    ];

    const messageLower = message.toLowerCase();
    const containsCriticalKeyword = criticalKeywords.some(kw => messageLower.includes(kw));

    // Check context for critical flags
    const isCriticalContext = context?.isCritical || context?.environment === 'production';

    return containsCriticalKeyword || isCriticalContext;
  }

  /**
   * Store consensus results for audit
   */
  async storeConsensusResult(
    sessionId: string,
    messageId: string,
    consensus: ConsensusResult,
    originalPrompt: string
  ): Promise<void> {
    try {
      // Store consensus result in database using Prisma
      // Since there's no specific table for consensus results in our schema,
      // we'll store it as JSON metadata in chat messages
      
      const message = await prisma.chatMessage.findUnique({
        where: { id: messageId }
      });
      
      if (message) {
        await prisma.chatMessage.update({
          where: { id: messageId },
          data: {
            mcp_calls: {
              ...(message.mcp_calls as object || {}),
              consensus_result: {
                recommendation: consensus.recommendation,
                confidence: consensus.confidence,
                alternatives: consensus.alternatives,
                reasoning: consensus.reasoning,
                convergence: consensus.samplingDetails?.convergenceScore || 0,
                timestamp: new Date().toISOString(),
                original_prompt: originalPrompt
              }
            }
          }
        });
        
        this.logger.info({ sessionId, messageId, confidence: consensus.confidence }, 'Stored consensus result');
      } else {
        this.logger.warn({ sessionId, messageId }, 'Message not found for consensus result storage');
      }
    } catch (error) {
      this.logger.error('Failed to store consensus result:', error);
    }
  }

  /**
   * Parse structured response from LLM
   */
  private parseStructuredResponse(content: string): ConsistencyResponse {
    // Try to parse structured format
    const recommendationMatch = content.match(/RECOMMENDATION:\s*(.+?)(?=\nCONFIDENCE:|$)/s);
    const confidenceMatch = content.match(/CONFIDENCE:\s*(\d+)%?/);
    const reasoningMatch = content.match(/REASONING:\s*(.+?)$/s);

    if (recommendationMatch && confidenceMatch && reasoningMatch) {
      return {
        response: recommendationMatch[1].trim(),
        confidence: parseInt(confidenceMatch[1]) / 100,
        reasoning: reasoningMatch[1].trim()
      };
    }

    // Fallback parsing
    return {
      response: content.split('\n')[0] || content,
      confidence: 0.5, // Default medium confidence
      reasoning: content
    };
  }

  /**
   * Group similar responses together
   */
  private groupSimilarResponses(
    responses: ConsistencyResponse[]
  ): Map<string, ConsistencyResponse[]> {
    const groups = new Map<string, ConsistencyResponse[]>();

    responses.forEach(response => {
      // Find similar existing group
      let foundGroup = false;
      for (const [key, group] of groups.entries()) {
        if (this.areSimilar(response.response, key)) {
          group.push(response);
          foundGroup = true;
          break;
        }
      }

      // Create new group if no similar one found
      if (!foundGroup) {
        groups.set(response.response, [response]);
      }
    });

    return groups;
  }

  /**
   * Check if two responses are similar
   */
  private areSimilar(response1: string, response2: string): boolean {
    // Normalize responses
    const norm1 = response1.toLowerCase().trim();
    const norm2 = response2.toLowerCase().trim();

    // Exact match
    if (norm1 === norm2) return true;

    // Check for common patterns
    const patterns = [
      { positive: ['yes', 'recommend', 'should', 'good idea'], negative: ['no', 'not recommend', 'shouldn\'t', 'bad idea'] },
      { migrate: ['migrate', 'move to', 'switch to'], stay: ['keep', 'stay', 'maintain current'] }
    ];

    for (const pattern of patterns) {
      const keys = Object.keys(pattern);
      const response1Category = keys.find(key => {
        const values = pattern[key as keyof typeof pattern] as string[];
        return values?.some(word => norm1.includes(word));
      });
      const response2Category = keys.find(key => {
        const values = pattern[key as keyof typeof pattern] as string[];
        return values?.some(word => norm2.includes(word));
      });
      
      if (response1Category && response1Category === response2Category) {
        return true;
      }
    }

    // Calculate similarity score (simple approach)
    const words1 = new Set(norm1.split(/\s+/));
    const words2 = new Set(norm2.split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    const similarity = intersection.size / union.size;
    return similarity > 0.6;
  }

  /**
   * Calculate convergence score (how much responses agree)
   */
  private calculateConvergence(responses: ConsistencyResponse[]): number {
    if (responses.length <= 1) return 1;

    // Group similar responses
    const groups = new Map<string, ConsistencyResponse[]>();
    
    for (const response of responses) {
      const key = response.response.toLowerCase().trim(); // Use 'response' instead of 'recommendation'
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(response);
    }
    
    const largestGroupSize = Math.max(...Array.from(groups.values()).map(g => g.length));
    
    return largestGroupSize / responses.length;
  }

  /**
   * Generate mock responses for testing
   */
  private generateMockResponses(
    prompt: string,
    samples: number
  ): ConsistencyResponse[] {
    const options = [
      { response: 'Yes, migrate to Kubernetes', confidence: 0.8, reasoning: 'Better scalability and container orchestration' },
      { response: 'Yes, migrate to Kubernetes', confidence: 0.7, reasoning: 'Cost-effective in the long run' },
      { response: 'No, stay with VMs', confidence: 0.6, reasoning: 'Current setup is stable and team lacks K8s expertise' }
    ];

    return Array(samples).fill(null).map((_, i) => options[i % options.length]);
  }
}