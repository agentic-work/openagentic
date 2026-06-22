/**
 * FeedbackIntegrationService
 *
 * Orchestrates all feedback loop services for the chat pipeline:
 * - ToolResultValidationService: Prevents LLM hallucination
 * - AutomaticSuccessScoringService: Automatic quality scoring
 * - LargeResponseHandler: Smart response compression
 * - SemanticLearningService: Cross-user learning from verified results
 *
 * This service is the integration point between tool execution and LLM response.
 */

import { Logger } from 'pino';
import logger from '../utils/logger.js';
import { getToolResultValidationService, type ToolResultValidation } from './ToolResultValidationService.js';
import { getAutomaticSuccessScoringService, type ToolExecutionScoring } from './AutomaticSuccessScoringService.js';
import { getLargeResponseHandler, type ProcessedResponse } from './LargeResponseHandler.js';
import { PrismaClient } from '@prisma/client';

export interface ToolExecutionFeedback {
  toolCallId: string;
  toolName: string;
  serverName: string;

  // Execution data
  httpStatus: number;
  responseTimeMs: number;
  rawResult: string;

  // User context
  userQuery: string;
  userId: string;
  sessionId?: string;
}

export interface FeedbackResult {
  // Processed response (potentially compressed)
  processedResponse: ProcessedResponse;

  // Quality scoring
  scoring: ToolExecutionScoring;

  // Validation (after LLM generates response)
  validation?: ToolResultValidation;

  // Metadata
  feedbackDurationMs: number;
}

export interface IntegrationConfig {
  enableValidation: boolean;
  enableScoring: boolean;
  enableLargeResponseHandling: boolean;
  enableSemanticLearning: boolean;
  contextBudget: number;  // Token budget for LLM context
}

const DEFAULT_CONFIG: IntegrationConfig = {
  enableValidation: true,
  enableScoring: true,
  enableLargeResponseHandling: true,
  enableSemanticLearning: true,
  contextBudget: 16000
};

export class FeedbackIntegrationService {
  private log: Logger;
  private config: IntegrationConfig;
  private prisma: PrismaClient | null = null;

  constructor(config: Partial<IntegrationConfig> = {}, prisma?: PrismaClient) {
    this.log = logger.child({ service: 'FeedbackIntegrationService' });
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.prisma = prisma || null;
  }

  /**
   * Process tool execution result through the feedback pipeline
   *
   * Call this AFTER tool execution but BEFORE sending result to LLM
   */
  async processToolResult(feedback: ToolExecutionFeedback): Promise<FeedbackResult> {
    const startTime = Date.now();

    this.log.info({
      toolCallId: feedback.toolCallId,
      toolName: feedback.toolName,
      responseTimeMs: feedback.responseTimeMs,
      resultSize: feedback.rawResult?.length || 0
    }, '[FEEDBACK] Processing tool result through feedback pipeline');

    // 1. Score the execution
    let scoring: ToolExecutionScoring;
    if (this.config.enableScoring) {
      const scoringService = getAutomaticSuccessScoringService();
      scoring = scoringService.scoreExecution(
        feedback.toolCallId,
        feedback.toolName,
        feedback.serverName,
        feedback.httpStatus,
        feedback.responseTimeMs,
        feedback.rawResult
      );

      this.log.debug({
        toolCallId: feedback.toolCallId,
        finalScore: scoring.finalScore,
        executionScore: scoring.executionScore.score,
        structuralScore: scoring.structuralScore.score
      }, '[FEEDBACK] Tool execution scored');
    } else {
      // Default scoring if disabled
      scoring = {
        toolCallId: feedback.toolCallId,
        toolName: feedback.toolName,
        serverName: feedback.serverName,
        timestamp: new Date(),
        executionScore: { httpSuccess: true, responseTimeMs: 0, resultSize: 0, noErrorFlag: true, score: 1 },
        structuralScore: { validFormat: true, expectedFieldsPresent: 1, correctTypes: 1, noErrorFields: true, score: 1 },
        behavioralScore: { userContinued: true, followUpAsked: false, retried: false, score: 0.6 },
        finalScore: 1,
        confidence: 0.5,
        scoringDurationMs: 0
      };
    }

    // 2. Handle large responses
    let processedResponse: ProcessedResponse;
    if (this.config.enableLargeResponseHandling) {
      const largeResponseHandler = getLargeResponseHandler();
      try {
        const parsed = JSON.parse(feedback.rawResult);
        processedResponse = await largeResponseHandler.processLargeResponse(
          parsed,
          feedback.userQuery,
          this.config.contextBudget
        );
      } catch {
        // Not JSON - process as string
        processedResponse = await largeResponseHandler.processLargeResponse(
          feedback.rawResult,
          feedback.userQuery,
          this.config.contextBudget
        );
      }

      this.log.debug({
        toolCallId: feedback.toolCallId,
        originalSize: processedResponse.originalSize,
        compressedSize: processedResponse.compressedSize,
        strategy: processedResponse.compressionStrategy,
        informationLoss: processedResponse.informationLoss
      }, '[FEEDBACK] Large response processed');
    } else {
      // Passthrough if disabled
      processedResponse = {
        compressedResult: feedback.rawResult,
        originalSize: feedback.rawResult?.length || 0,
        compressedSize: feedback.rawResult?.length || 0,
        compressionStrategy: 'passthrough',
        informationLoss: 'none',
        anomaliesPreserved: true,
        processingDurationMs: 0
      };
    }

    const result: FeedbackResult = {
      processedResponse,
      scoring,
      feedbackDurationMs: Date.now() - startTime
    };

    this.log.info({
      toolCallId: feedback.toolCallId,
      toolName: feedback.toolName,
      finalScore: scoring.finalScore,
      compressionStrategy: processedResponse.compressionStrategy,
      feedbackDurationMs: result.feedbackDurationMs
    }, '[FEEDBACK] Tool result processed');

    return result;
  }

  /**
   * Validate LLM's interpretation of a tool result
   *
   * Call this AFTER the LLM generates a response about tool results
   */
  async validateLLMResponse(
    toolCallId: string,
    toolName: string,
    rawResult: string,
    llmSummary: string
  ): Promise<ToolResultValidation> {
    if (!this.config.enableValidation) {
      // Return a placeholder validation if disabled
      return {
        toolCallId,
        toolName,
        rawResult,
        structuredResult: null,
        resultHash: '',
        llmSummary,
        extractedClaims: [],
        validatedClaims: [],
        overallConfidence: 1.0,
        warnings: [],
        shouldRegenerate: false,
        validationDurationMs: 0
      };
    }

    const validationService = getToolResultValidationService();
    const validation = await validationService.validateInterpretation(
      toolCallId,
      toolName,
      rawResult,
      llmSummary
    );

    if (validation.shouldRegenerate) {
      this.log.warn({
        toolCallId,
        toolName,
        overallConfidence: validation.overallConfidence,
        warnings: validation.warnings
      }, '[FEEDBACK] ⚠️ LLM response may contain hallucinations - regeneration suggested');
    }

    return validation;
  }

  /**
   * Update behavioral score based on user action
   *
   * Call this when user takes an action after receiving a response
   */
  updateBehavioralFeedback(
    toolCallId: string,
    action: 'continued' | 'followUp' | 'retry' | 'positive' | 'negative'
  ): void {
    if (!this.config.enableScoring) return;

    const scoringService = getAutomaticSuccessScoringService();
    const behavioralScore = scoringService.updateBehavioralScore(toolCallId, action);

    this.log.debug({
      toolCallId,
      action,
      newScore: behavioralScore.score
    }, '[FEEDBACK] Behavioral feedback recorded');
  }

  /**
   * Get tool reliability information
   */
  getToolReliability(toolName: string, serverId: string) {
    const scoringService = getAutomaticSuccessScoringService();
    return scoringService.getToolReliability(toolName, serverId);
  }

  /**
   * Get all tool reliability aggregates
   */
  getAllToolReliability() {
    const scoringService = getAutomaticSuccessScoringService();
    return scoringService.getAllAggregates();
  }

  /**
   * Get full result by ID (for pagination follow-up)
   */
  getFullResultById(resultId: string): unknown | null {
    const largeResponseHandler = getLargeResponseHandler();
    return largeResponseHandler.getFullResult(resultId);
  }

  /**
   * Create a grounding prompt for tool result interpretation
   *
   * This prompt helps the LLM avoid hallucination when interpreting tool results
   */
  createGroundingPrompt(
    toolName: string,
    rawResult: string,
    userQuery: string
  ): string {
    const lines: string[] = [];

    lines.push('## Tool Result Interpretation Guidelines');
    lines.push('');
    lines.push('You are about to interpret the result of a tool call. Follow these rules:');
    lines.push('');
    lines.push('1. **Only state facts that appear in the result** - Do not infer or fabricate details');
    lines.push('2. **Quote exact values** - When mentioning counts, names, or statuses, use exact values from the result');
    lines.push('3. **Acknowledge uncertainty** - If information is missing, say "The result does not include..."');
    lines.push('4. **Check for anomalies** - Prioritize errors, warnings, or unhealthy statuses');
    lines.push('');

    // Add context about the query
    if (userQuery) {
      lines.push(`**User Query**: ${userQuery}`);
      lines.push('');
    }

    // Add result preview
    const resultPreview = rawResult.length > 1000
      ? rawResult.substring(0, 1000) + '...[truncated]'
      : rawResult;

    lines.push(`**Tool**: ${toolName}`);
    lines.push('');
    lines.push('**Result (for grounding)**:');
    lines.push('```json');
    lines.push(resultPreview);
    lines.push('```');
    lines.push('');
    lines.push('Base your response ONLY on the data shown above. Do not hallucinate additional details.');

    return lines.join('\n');
  }
}

// Singleton instance
let instance: FeedbackIntegrationService | null = null;

export function getFeedbackIntegrationService(
  config?: Partial<IntegrationConfig>,
  prisma?: PrismaClient
): FeedbackIntegrationService {
  if (!instance) {
    instance = new FeedbackIntegrationService(config, prisma);
  }
  return instance;
}

export default FeedbackIntegrationService;
