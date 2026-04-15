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
 * ToolResultValidationService
 *
 * Validates LLM interpretations of tool results to prevent hallucination.
 * Part of the Data Layer Evolution Plan - Phase: Hallucination Prevention
 *
 * Problem: LLM may successfully execute a tool but then misinterpret or fabricate
 * details about the result.
 *
 * Solution: Extract claims from LLM response and validate against actual tool result.
 */

import { Logger } from 'pino';
import logger from '../utils/logger.js';

// Claim types that can be extracted from LLM responses
export type ClaimType = 'count' | 'name' | 'status' | 'existence' | 'comparison' | 'value';
export type ClaimImportance = 'critical' | 'normal' | 'minor';
export type ClaimStatus = 'verified' | 'unverifiable' | 'contradicted';

export interface Claim {
  text: string;
  type: ClaimType;
  importance: ClaimImportance;
  extractedValue?: string | number | boolean;
}

export interface ValidatedClaim {
  claim: Claim;
  status: ClaimStatus;
  evidence?: string;
  confidence: number; // 0-1
}

export interface ToolResultValidation {
  toolCallId: string;
  toolName: string;
  rawResult: string;
  structuredResult: unknown;
  resultHash: string;

  // LLM interpretation
  llmSummary: string;
  extractedClaims: Claim[];

  // Validation results
  validatedClaims: ValidatedClaim[];
  overallConfidence: number; // 0-1
  warnings: string[];
  shouldRegenerate: boolean;

  // Timing
  validationDurationMs: number;
}

export interface ValidationConfig {
  enableClaimExtraction: boolean;
  enableStructuralValidation: boolean;
  enableSemanticValidation: boolean;
  confidenceThreshold: number; // Below this, regenerate
  maxClaimsToValidate: number;
}

const DEFAULT_CONFIG: ValidationConfig = {
  enableClaimExtraction: true,
  enableStructuralValidation: true,
  enableSemanticValidation: false, // Requires additional LLM call
  confidenceThreshold: 0.7,
  maxClaimsToValidate: 10
};

export class ToolResultValidationService {
  private log: Logger;
  private config: ValidationConfig;

  constructor(config: Partial<ValidationConfig> = {}) {
    this.log = logger.child({ service: 'ToolResultValidationService' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate LLM's interpretation of a tool result
   */
  async validateInterpretation(
    toolCallId: string,
    toolName: string,
    rawResult: string,
    llmSummary: string
  ): Promise<ToolResultValidation> {
    const startTime = Date.now();

    // Parse structured result if JSON
    let structuredResult: unknown = null;
    try {
      structuredResult = JSON.parse(rawResult);
    } catch {
      // Not JSON, use raw string
      structuredResult = rawResult;
    }

    // Generate result hash for caching
    const resultHash = this.hashResult(rawResult);

    // Extract claims from LLM summary
    const extractedClaims = this.config.enableClaimExtraction
      ? this.extractClaims(llmSummary)
      : [];

    // Validate each claim
    const validatedClaims: ValidatedClaim[] = [];
    const warnings: string[] = [];

    for (const claim of extractedClaims.slice(0, this.config.maxClaimsToValidate)) {
      const validation = this.validateClaim(claim, rawResult, structuredResult);
      validatedClaims.push(validation);

      if (validation.status === 'contradicted') {
        warnings.push(`Contradicted claim: "${claim.text}" - ${validation.evidence}`);
      }
    }

    // Calculate overall confidence
    const overallConfidence = this.calculateOverallConfidence(validatedClaims);

    // Determine if regeneration is needed
    const shouldRegenerate = overallConfidence < this.config.confidenceThreshold ||
      validatedClaims.some(v => v.status === 'contradicted' && v.claim.importance === 'critical');

    const validation: ToolResultValidation = {
      toolCallId,
      toolName,
      rawResult,
      structuredResult,
      resultHash,
      llmSummary,
      extractedClaims,
      validatedClaims,
      overallConfidence,
      warnings,
      shouldRegenerate,
      validationDurationMs: Date.now() - startTime
    };

    this.log.info({
      toolCallId,
      toolName,
      claimsExtracted: extractedClaims.length,
      claimsValidated: validatedClaims.length,
      overallConfidence,
      shouldRegenerate,
      durationMs: validation.validationDurationMs
    }, 'Tool result validation complete');

    return validation;
  }

  /**
   * Extract factual claims from LLM summary
   */
  private extractClaims(llmSummary: string): Claim[] {
    const claims: Claim[] = [];

    // Pattern: Count claims ("3 backends", "found 5 errors", etc.)
    const countPattern = /(\d+)\s+([\w\s]+?)(?:\s+(?:found|detected|discovered|exist|are|were|have)|\b)/gi;
    let match;
    while ((match = countPattern.exec(llmSummary)) !== null) {
      claims.push({
        text: match[0].trim(),
        type: 'count',
        importance: 'critical',
        extractedValue: parseInt(match[1], 10)
      });
    }

    // Pattern: Status claims ("unhealthy", "failed", "error", "healthy", "success")
    const statusPatterns = [
      { pattern: /\b(unhealthy|failed|error|failing|down|unavailable)\b/gi, status: 'negative' },
      { pattern: /\b(healthy|success|running|available|up|active)\b/gi, status: 'positive' }
    ];
    for (const { pattern, status } of statusPatterns) {
      while ((match = pattern.exec(llmSummary)) !== null) {
        claims.push({
          text: match[0],
          type: 'status',
          importance: 'critical',
          extractedValue: status
        });
      }
    }

    // Pattern: Existence claims ("no X found", "X exists", "there are no")
    const existencePattern = /\b(no|none|zero|doesn't exist|does not exist|not found|there are no)\s+([\w\s]+)/gi;
    while ((match = existencePattern.exec(llmSummary)) !== null) {
      claims.push({
        text: match[0].trim(),
        type: 'existence',
        importance: 'normal',
        extractedValue: false
      });
    }

    // Pattern: Name claims (quoted names or specific identifiers)
    const namePattern = /"([^"]+)"|'([^']+)'|`([^`]+)`/g;
    while ((match = namePattern.exec(llmSummary)) !== null) {
      const name = match[1] || match[2] || match[3];
      claims.push({
        text: name,
        type: 'name',
        importance: 'normal',
        extractedValue: name
      });
    }

    return claims;
  }

  /**
   * Validate a single claim against the tool result
   */
  private validateClaim(
    claim: Claim,
    rawResult: string,
    structuredResult: unknown
  ): ValidatedClaim {
    switch (claim.type) {
      case 'count':
        return this.validateCountClaim(claim, rawResult, structuredResult);
      case 'status':
        return this.validateStatusClaim(claim, rawResult, structuredResult);
      case 'existence':
        return this.validateExistenceClaim(claim, rawResult, structuredResult);
      case 'name':
        return this.validateNameClaim(claim, rawResult, structuredResult);
      default:
        return {
          claim,
          status: 'unverifiable',
          confidence: 0.5
        };
    }
  }

  /**
   * Validate count claims (e.g., "3 backends found")
   */
  private validateCountClaim(
    claim: Claim,
    rawResult: string,
    structuredResult: unknown
  ): ValidatedClaim {
    const claimedCount = claim.extractedValue as number;

    // Try to find actual count in structured result
    if (Array.isArray(structuredResult)) {
      const actualCount = structuredResult.length;
      if (actualCount === claimedCount) {
        return {
          claim,
          status: 'verified',
          evidence: `Array length matches: ${actualCount}`,
          confidence: 1.0
        };
      } else {
        return {
          claim,
          status: 'contradicted',
          evidence: `Array has ${actualCount} items, not ${claimedCount}`,
          confidence: 0.0
        };
      }
    }

    // Try to find count in nested arrays
    if (typeof structuredResult === 'object' && structuredResult !== null) {
      for (const [key, value] of Object.entries(structuredResult as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          if (value.length === claimedCount) {
            return {
              claim,
              status: 'verified',
              evidence: `${key} array length matches: ${value.length}`,
              confidence: 0.9
            };
          }
        }
      }
    }

    // Check for count in raw text
    const countInText = rawResult.match(new RegExp(`\\b${claimedCount}\\b`));
    if (countInText) {
      return {
        claim,
        status: 'verified',
        evidence: `Count ${claimedCount} found in raw result`,
        confidence: 0.7
      };
    }

    return {
      claim,
      status: 'unverifiable',
      confidence: 0.5
    };
  }

  /**
   * Validate status claims (e.g., "unhealthy", "failed")
   */
  private validateStatusClaim(
    claim: Claim,
    rawResult: string,
    structuredResult: unknown
  ): ValidatedClaim {
    const statusText = claim.text.toLowerCase();
    const isNegative = ['unhealthy', 'failed', 'error', 'failing', 'down', 'unavailable'].includes(statusText);

    // Search in raw result (case-insensitive)
    const foundInRaw = rawResult.toLowerCase().includes(statusText);

    if (foundInRaw) {
      return {
        claim,
        status: 'verified',
        evidence: `Status "${statusText}" found in result`,
        confidence: 0.9
      };
    }

    // Check for opposite status (contradiction)
    const opposites: Record<string, string[]> = {
      'unhealthy': ['healthy', 'running', 'available'],
      'healthy': ['unhealthy', 'failed', 'error'],
      'failed': ['success', 'succeeded', 'passed'],
      'success': ['failed', 'error', 'failure'],
      'error': ['success', 'ok', 'passed'],
      'down': ['up', 'running', 'available'],
      'up': ['down', 'unavailable', 'stopped']
    };

    const oppositeTerms = opposites[statusText] || [];
    for (const opposite of oppositeTerms) {
      if (rawResult.toLowerCase().includes(opposite)) {
        // Check if the claim is about absence vs presence
        if (isNegative) {
          // LLM claimed negative, but result shows positive
          return {
            claim,
            status: 'contradicted',
            evidence: `Result shows "${opposite}" not "${statusText}"`,
            confidence: 0.1
          };
        }
      }
    }

    return {
      claim,
      status: 'unverifiable',
      confidence: 0.5
    };
  }

  /**
   * Validate existence claims (e.g., "no errors found")
   */
  private validateExistenceClaim(
    claim: Claim,
    rawResult: string,
    structuredResult: unknown
  ): ValidatedClaim {
    const claimsNonExistence = claim.extractedValue === false;

    // For non-existence claims, check if the subject is actually absent
    if (claimsNonExistence) {
      // Extract the subject from the claim
      const subjectMatch = claim.text.match(/(?:no|none|zero|not found)\s+(.+)/i);
      if (subjectMatch) {
        const subject = subjectMatch[1].trim();
        const foundInResult = rawResult.toLowerCase().includes(subject.toLowerCase());

        if (!foundInResult) {
          return {
            claim,
            status: 'verified',
            evidence: `"${subject}" not found in result`,
            confidence: 0.8
          };
        }
      }
    }

    return {
      claim,
      status: 'unverifiable',
      confidence: 0.5
    };
  }

  /**
   * Validate name claims (e.g., specific resource names)
   */
  private validateNameClaim(
    claim: Claim,
    rawResult: string,
    _structuredResult: unknown
  ): ValidatedClaim {
    const name = claim.extractedValue as string;

    // Exact match in raw result
    if (rawResult.includes(name)) {
      return {
        claim,
        status: 'verified',
        evidence: `Name "${name}" found in result`,
        confidence: 1.0
      };
    }

    // Case-insensitive match
    if (rawResult.toLowerCase().includes(name.toLowerCase())) {
      return {
        claim,
        status: 'verified',
        evidence: `Name "${name}" found (case-insensitive)`,
        confidence: 0.9
      };
    }

    return {
      claim,
      status: 'contradicted',
      evidence: `Name "${name}" not found in result`,
      confidence: 0.2
    };
  }

  /**
   * Calculate overall confidence from validated claims
   */
  private calculateOverallConfidence(validatedClaims: ValidatedClaim[]): number {
    if (validatedClaims.length === 0) return 1.0; // No claims to validate

    // Weight by importance
    const weights: Record<ClaimImportance, number> = {
      critical: 3,
      normal: 2,
      minor: 1
    };

    let totalWeight = 0;
    let weightedConfidence = 0;

    for (const vc of validatedClaims) {
      const weight = weights[vc.claim.importance];
      totalWeight += weight;
      weightedConfidence += vc.confidence * weight;
    }

    return totalWeight > 0 ? weightedConfidence / totalWeight : 1.0;
  }

  /**
   * Hash result for caching
   */
  private hashResult(result: string): string {
    let hash = 0;
    for (let i = 0; i < result.length; i++) {
      const char = result.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

// Singleton instance
let instance: ToolResultValidationService | null = null;

export function getToolResultValidationService(): ToolResultValidationService {
  if (!instance) {
    instance = new ToolResultValidationService();
  }
  return instance;
}

export default ToolResultValidationService;
