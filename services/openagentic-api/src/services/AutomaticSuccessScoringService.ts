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
 * AutomaticSuccessScoringService
 *
 * Automatically derives quality/success scores for tool executions.
 * Part of the Data Layer Evolution Plan - Phase: Automatic Tool Success Scoring
 *
 * Problem: Manual scoring doesn't scale. Users rarely provide explicit feedback.
 *
 * Solution: Derive scores from multiple signal categories:
 * - Execution signals (30%): HTTP success, response time, result size, error flags
 * - Structural signals (25%): Valid format, expected fields, correct types
 * - Semantic signals (25%): LLM-judged relevance and specificity
 * - Behavioral signals (20%): User actions (continues, retries, feedback)
 */

import { Logger } from 'pino';
import logger from '../utils/logger.js';

// Scoring weights from the data layer evolution plan
const SCORING_WEIGHTS = {
  execution: 0.30,
  structural: 0.25,
  semantic: 0.25,
  behavioral: 0.20
};

// Ideal response time threshold (ms)
const IDEAL_RESPONSE_TIME_MS = 1000;
const MAX_ACCEPTABLE_RESPONSE_TIME_MS = 10000;

export interface ExecutionScore {
  httpSuccess: boolean;        // 200-299 status
  responseTimeMs: number;      // < 1000ms ideal
  resultSize: number;          // > 0 bytes
  noErrorFlag: boolean;        // No error in response
  score: number;               // 0-1
}

export interface StructuralScore {
  validFormat: boolean;        // Parseable JSON/XML
  expectedFieldsPresent: number; // % of expected fields present (0-1)
  correctTypes: number;        // % of fields with correct type (0-1)
  noErrorFields: boolean;      // error/warning fields empty
  score: number;               // 0-1
}

export interface SemanticScore {
  answersQuery: number;        // 0-1: does result address user's question?
  specificity: number;         // 0-1: concrete vs vague
  consistency: number;         // 0-1: matches prior knowledge
  score: number;               // 0-1
}

export interface BehavioralScore {
  userContinued: boolean;      // Conversation continued
  followUpAsked: boolean;      // Asked about result
  retried: boolean;            // Same request repeated (negative)
  explicitFeedback?: 'positive' | 'negative';
  score: number;               // 0-1
}

export interface ToolExecutionScoring {
  toolCallId: string;
  toolName: string;
  serverName: string;
  timestamp: Date;

  // Individual scores
  executionScore: ExecutionScore;
  structuralScore: StructuralScore;
  semanticScore?: SemanticScore;  // May be async
  behavioralScore: BehavioralScore;

  // Combined score
  finalScore: number;          // Weighted combination (0-1)
  confidence: number;          // How confident are we in this score? (0-1)

  // Metadata
  scoringDurationMs: number;
}

export interface ToolReliabilityAggregate {
  toolName: string;
  serverId: string;

  // Aggregate stats
  totalExecutions: number;
  averageScore: number;
  scoreStdDev: number;

  // Trends
  recentScores: number[];      // Last 10 executions
  scoreTrend: 'improving' | 'stable' | 'degrading';

  // Reliability tier
  tier: 'gold' | 'silver' | 'bronze' | 'untrusted';
  // gold: >0.9 avg, >100 executions
  // silver: >0.7 avg, >50 executions
  // bronze: >0.5 avg, >10 executions
  // untrusted: <0.5 or <10 executions

  lastUpdated: Date;
}

export interface ScoringConfig {
  enableSemanticScoring: boolean;  // Requires additional LLM call
  enableBehavioralTracking: boolean;
  weights: typeof SCORING_WEIGHTS;
}

const DEFAULT_CONFIG: ScoringConfig = {
  enableSemanticScoring: false,
  enableBehavioralTracking: true,
  weights: SCORING_WEIGHTS
};

export class AutomaticSuccessScoringService {
  private log: Logger;
  private config: ScoringConfig;
  private aggregates: Map<string, ToolReliabilityAggregate> = new Map();

  constructor(config: Partial<ScoringConfig> = {}) {
    this.log = logger.child({ service: 'AutomaticSuccessScoringService' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Score a tool execution immediately after completion
   */
  scoreExecution(
    toolCallId: string,
    toolName: string,
    serverName: string,
    httpStatus: number,
    responseTimeMs: number,
    rawResult: string,
    expectedFields?: string[]
  ): ToolExecutionScoring {
    const startTime = Date.now();

    // Calculate execution score
    const executionScore = this.calculateExecutionScore(
      httpStatus,
      responseTimeMs,
      rawResult
    );

    // Calculate structural score
    const structuralScore = this.calculateStructuralScore(
      rawResult,
      expectedFields
    );

    // Initial behavioral score (neutral - will be updated over time)
    const behavioralScore: BehavioralScore = {
      userContinued: true,  // Assume positive until proven otherwise
      followUpAsked: false,
      retried: false,
      score: 0.6  // Neutral-positive baseline
    };

    // Calculate final score (without semantic for now)
    const finalScore = this.calculateFinalScore(
      executionScore.score,
      structuralScore.score,
      undefined,  // Semantic not calculated yet
      behavioralScore.score
    );

    const scoring: ToolExecutionScoring = {
      toolCallId,
      toolName,
      serverName,
      timestamp: new Date(),
      executionScore,
      structuralScore,
      behavioralScore,
      finalScore,
      confidence: this.calculateConfidence(executionScore, structuralScore),
      scoringDurationMs: Date.now() - startTime
    };

    // Update aggregate statistics
    this.updateAggregate(toolName, serverName, finalScore);

    this.log.info({
      toolCallId,
      toolName,
      finalScore: finalScore.toFixed(3),
      confidence: scoring.confidence.toFixed(3),
      durationMs: scoring.scoringDurationMs
    }, 'Tool execution scored');

    return scoring;
  }

  /**
   * Calculate execution score from immediate signals
   */
  private calculateExecutionScore(
    httpStatus: number,
    responseTimeMs: number,
    rawResult: string
  ): ExecutionScore {
    const httpSuccess = httpStatus >= 200 && httpStatus < 300;
    const resultSize = rawResult?.length || 0;

    // Check for error indicators in result
    const noErrorFlag = !this.hasErrorIndicators(rawResult);

    // Response time score (1.0 for ideal, degrading to 0 at max)
    let responseTimeScore = 1.0;
    if (responseTimeMs > IDEAL_RESPONSE_TIME_MS) {
      responseTimeScore = Math.max(0, 1 - (responseTimeMs - IDEAL_RESPONSE_TIME_MS) / (MAX_ACCEPTABLE_RESPONSE_TIME_MS - IDEAL_RESPONSE_TIME_MS));
    }

    // Result size score (0 for empty, 1 for non-empty)
    const resultSizeScore = resultSize > 0 ? 1.0 : 0.0;

    // Combine scores
    const score = (
      (httpSuccess ? 0.4 : 0) +
      (responseTimeScore * 0.2) +
      (resultSizeScore * 0.2) +
      (noErrorFlag ? 0.2 : 0)
    );

    return {
      httpSuccess,
      responseTimeMs,
      resultSize,
      noErrorFlag,
      score
    };
  }

  /**
   * Check for error indicators in result
   */
  private hasErrorIndicators(rawResult: string): boolean {
    if (!rawResult) return true;  // Empty is considered an error

    const lowerResult = rawResult.toLowerCase();
    const errorPatterns = [
      '"error":', 'error:', '"error_message":', 'errorcode',
      '"fault":', 'exception:', 'traceback:', 'stack trace',
      '"status":"failed"', '"success":false', '"ok":false'
    ];

    return errorPatterns.some(pattern => lowerResult.includes(pattern));
  }

  /**
   * Calculate structural score from parsed result
   */
  private calculateStructuralScore(
    rawResult: string,
    expectedFields?: string[]
  ): StructuralScore {
    let validFormat = false;
    let parsedResult: Record<string, unknown> | null = null;
    let expectedFieldsPresent = 1.0;
    let correctTypes = 1.0;
    let noErrorFields = true;

    // Try to parse as JSON
    try {
      parsedResult = JSON.parse(rawResult);
      validFormat = true;
    } catch {
      // Not valid JSON - try to detect if it's meant to be
      if (rawResult.trim().startsWith('{') || rawResult.trim().startsWith('[')) {
        validFormat = false;  // Malformed JSON
      } else {
        validFormat = true;  // Plain text is valid
        parsedResult = null;
      }
    }

    // Check expected fields if provided
    if (parsedResult && expectedFields && expectedFields.length > 0) {
      const presentCount = expectedFields.filter(field =>
        this.hasNestedField(parsedResult!, field)
      ).length;
      expectedFieldsPresent = presentCount / expectedFields.length;
    }

    // Check for error/warning fields
    if (parsedResult && typeof parsedResult === 'object') {
      const errorFields = ['error', 'errors', 'warning', 'warnings', 'fault', 'faults'];
      noErrorFields = !errorFields.some(field => {
        const value = (parsedResult as Record<string, unknown>)[field];
        return value && (
          (typeof value === 'string' && value.length > 0) ||
          (Array.isArray(value) && value.length > 0) ||
          (typeof value === 'object' && Object.keys(value).length > 0)
        );
      });
    }

    const score = (
      (validFormat ? 0.35 : 0) +
      (expectedFieldsPresent * 0.25) +
      (correctTypes * 0.20) +
      (noErrorFields ? 0.20 : 0)
    );

    return {
      validFormat,
      expectedFieldsPresent,
      correctTypes,
      noErrorFields,
      score
    };
  }

  /**
   * Check if object has a nested field (supports dot notation)
   */
  private hasNestedField(obj: Record<string, unknown>, field: string): boolean {
    const parts = field.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return false;
      if (typeof current !== 'object') return false;
      current = (current as Record<string, unknown>)[part];
    }

    return current !== undefined;
  }

  /**
   * Update behavioral score based on user action
   */
  updateBehavioralScore(
    toolCallId: string,
    action: 'continued' | 'followUp' | 'retry' | 'positive' | 'negative'
  ): BehavioralScore {
    // This would typically look up the scoring by toolCallId and update it
    // For now, return the impact of the action
    const impacts: Record<string, BehavioralScore> = {
      continued: { userContinued: true, followUpAsked: false, retried: false, score: 0.65 },
      followUp: { userContinued: true, followUpAsked: true, retried: false, score: 0.8 },
      retry: { userContinued: true, followUpAsked: false, retried: true, score: 0.3 },
      positive: { userContinued: true, followUpAsked: false, retried: false, explicitFeedback: 'positive', score: 0.95 },
      negative: { userContinued: true, followUpAsked: false, retried: false, explicitFeedback: 'negative', score: 0.15 }
    };

    return impacts[action] || { userContinued: true, followUpAsked: false, retried: false, score: 0.5 };
  }

  /**
   * Calculate final weighted score
   */
  private calculateFinalScore(
    executionScore: number,
    structuralScore: number,
    semanticScore: number | undefined,
    behavioralScore: number
  ): number {
    const w = this.config.weights;

    if (semanticScore !== undefined) {
      return (
        executionScore * w.execution +
        structuralScore * w.structural +
        semanticScore * w.semantic +
        behavioralScore * w.behavioral
      );
    }

    // Without semantic score, redistribute weight
    const adjustedWeights = {
      execution: w.execution + (w.semantic * w.execution / (1 - w.semantic)),
      structural: w.structural + (w.semantic * w.structural / (1 - w.semantic)),
      behavioral: w.behavioral + (w.semantic * w.behavioral / (1 - w.semantic))
    };

    return (
      executionScore * adjustedWeights.execution +
      structuralScore * adjustedWeights.structural +
      behavioralScore * adjustedWeights.behavioral
    );
  }

  /**
   * Calculate confidence in the score
   */
  private calculateConfidence(
    executionScore: ExecutionScore,
    structuralScore: StructuralScore
  ): number {
    // Higher confidence when we have clear signals
    let confidence = 0.5;  // Base

    // Strong execution signals increase confidence
    if (executionScore.httpSuccess) confidence += 0.15;
    if (executionScore.noErrorFlag) confidence += 0.1;
    if (executionScore.resultSize > 100) confidence += 0.1;

    // Valid structure increases confidence
    if (structuralScore.validFormat) confidence += 0.15;

    return Math.min(1.0, confidence);
  }

  /**
   * Update aggregate reliability statistics for a tool
   */
  private updateAggregate(
    toolName: string,
    serverId: string,
    score: number
  ): void {
    const key = `${serverId}:${toolName}`;
    let aggregate = this.aggregates.get(key);

    if (!aggregate) {
      aggregate = {
        toolName,
        serverId,
        totalExecutions: 0,
        averageScore: 0,
        scoreStdDev: 0,
        recentScores: [],
        scoreTrend: 'stable',
        tier: 'untrusted',
        lastUpdated: new Date()
      };
    }

    // Update recent scores (keep last 10)
    aggregate.recentScores.push(score);
    if (aggregate.recentScores.length > 10) {
      aggregate.recentScores.shift();
    }

    // Update running average
    aggregate.totalExecutions++;
    aggregate.averageScore = (
      (aggregate.averageScore * (aggregate.totalExecutions - 1) + score) /
      aggregate.totalExecutions
    );

    // Calculate trend from recent scores
    aggregate.scoreTrend = this.calculateTrend(aggregate.recentScores);

    // Update tier
    aggregate.tier = this.calculateTier(
      aggregate.averageScore,
      aggregate.totalExecutions
    );

    aggregate.lastUpdated = new Date();
    this.aggregates.set(key, aggregate);
  }

  /**
   * Calculate score trend from recent scores
   */
  private calculateTrend(recentScores: number[]): 'improving' | 'stable' | 'degrading' {
    if (recentScores.length < 3) return 'stable';

    // Compare first half to second half
    const mid = Math.floor(recentScores.length / 2);
    const firstHalf = recentScores.slice(0, mid);
    const secondHalf = recentScores.slice(mid);

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;
    if (diff > 0.1) return 'improving';
    if (diff < -0.1) return 'degrading';
    return 'stable';
  }

  /**
   * Calculate reliability tier
   */
  private calculateTier(
    averageScore: number,
    totalExecutions: number
  ): 'gold' | 'silver' | 'bronze' | 'untrusted' {
    if (averageScore > 0.9 && totalExecutions >= 100) return 'gold';
    if (averageScore > 0.7 && totalExecutions >= 50) return 'silver';
    if (averageScore > 0.5 && totalExecutions >= 10) return 'bronze';
    return 'untrusted';
  }

  /**
   * Get aggregate reliability for a tool
   */
  getToolReliability(toolName: string, serverId: string): ToolReliabilityAggregate | null {
    return this.aggregates.get(`${serverId}:${toolName}`) || null;
  }

  /**
   * Get all tool reliability aggregates
   */
  getAllAggregates(): ToolReliabilityAggregate[] {
    return Array.from(this.aggregates.values());
  }

  /**
   * Get tools by tier
   */
  getToolsByTier(tier: 'gold' | 'silver' | 'bronze' | 'untrusted'): ToolReliabilityAggregate[] {
    return this.getAllAggregates().filter(a => a.tier === tier);
  }
}

// Singleton instance
let instance: AutomaticSuccessScoringService | null = null;

export function getAutomaticSuccessScoringService(): AutomaticSuccessScoringService {
  if (!instance) {
    instance = new AutomaticSuccessScoringService();
  }
  return instance;
}

export default AutomaticSuccessScoringService;
