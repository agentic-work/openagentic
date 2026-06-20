/**
 * Model Capability Registry
 *
 * Centralized registry for model capabilities including:
 * - Context window sizes
 * - Function calling accuracy
 * - Vision support
 * - Thinking/reasoning support
 * - Provider type detection
 *
 * This replaces all hardcoded model capability checks throughout the codebase.
 * Capabilities can be:
 * 1. Loaded from database (highest priority)
 * 2. Loaded from environment variables
 * 3. Inferred from model name patterns (fallback)
 */

import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

export type ThinkingType = 'native' | 'prompt-based' | 'none';
export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ThinkingCapabilities {
  enabled: boolean;
  type: ThinkingType;
  maxBudgetTokens: number;       // Max tokens for thinking
  defaultBudgetTokens: number;   // Default tokens for thinking
  supportsReasoningEffort: boolean;  // Gemini-style low/medium/high
  defaultReasoningEffort?: ReasoningEffort;
  /**
   * #cap-sync (2026-06-16) — the Anthropic thinking WIRE shape this model
   * accepts. `'enabled'` = legacy fixed-budget `{type:'enabled', budget_tokens}`
   * (≤ Opus 4.6 / Sonnet 4.6, still functional). `'adaptive'` = Opus 4.7/4.8 +
   * Fable 5, which REJECT `budget_tokens` with a 400 and require
   * `{type:'adaptive'}`; depth is set via `effort`, not a budget. Undefined is
   * treated as `'enabled'` so existing rows keep their current behavior.
   * Verified against the claude-api skill (authoritative): Opus 4.8 is
   * adaptive-only, 1M context, 128K output, $5/$25 per 1M.
   */
  thinkingMode?: 'enabled' | 'adaptive';
}

export interface ModelCapabilities {
  modelId: string;
  displayName?: string;

  // Provider info
  provider: string;
  providerType: ProviderType;

  // Context limits
  maxContextTokens: number;
  maxOutputTokens: number;

  // Capabilities
  chat: boolean;
  vision: boolean;
  functionCalling: boolean;
  functionCallingAccuracy: number; // 0-1 score
  streaming: boolean;
  jsonMode: boolean;
  thinking: boolean;  // Simple flag for backward compatibility
  thinkingCapabilities?: ThinkingCapabilities;  // Detailed thinking config
  imageGeneration: boolean;
  embeddings: boolean;

  // Performance
  avgLatencyMs?: number;
  tokensPerSecond?: number;

  // Cost (per 1k tokens)
  inputCostPer1k?: number;
  outputCostPer1k?: number;

  // Metadata
  family: ModelFamily;
  version?: string;
  releaseDate?: Date;
  isAvailable: boolean;
  lastUpdated: Date;
}

export type ProviderType =
  | 'vertex-ai'
  | 'vertex-claude'
  | 'azure-openai'
  | 'azure-ai-foundry'
  | 'aws-bedrock'
  | 'ollama'
  | 'openai'
  | 'anthropic'
  | 'unknown';

export type ModelFamily =
  | 'gpt'
  | 'claude'
  | 'gemini'
  | 'llama'
  | 'mistral'
  | 'qwen'
  | 'deepseek'
  | 'phi'
  | 'gpt-oss'
  | 'gemma'
  | 'titan'
  | 'palm'
  | 'unknown';

// ============================================================================
// DEFAULT CAPABILITY PATTERNS
// These are used as fallbacks when database/env config is not available
// ============================================================================

interface ModelPattern {
  pattern: RegExp;
  capabilities: Partial<ModelCapabilities>;
}

const MODEL_PATTERNS: ModelPattern[] = [
  // GPT-4o Mini (economical)
  {
    pattern: /gpt-4o-mini/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 128000,
      maxOutputTokens: 16384,
      functionCalling: true,
      functionCallingAccuracy: 0.92,
      vision: true,
      thinking: false,
      jsonMode: true,
      // Pricing per 1k tokens (approximate, database values override)
      inputCostPer1k: 0.00015,  // $0.15/1M
      outputCostPer1k: 0.0006,  // $0.60/1M
    }
  },
  // GPT-4 Turbo / GPT-4o
  {
    pattern: /gpt-4-turbo|gpt-4-1106|gpt-4o/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 128000,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.95,
      vision: true,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0.0025,   // $2.50/1M
      outputCostPer1k: 0.01,    // $10/1M
    }
  },
  // GPT-4 32K
  {
    pattern: /gpt-4-32k/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 32768,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.93,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0.06,    // $60/1M
      outputCostPer1k: 0.12,   // $120/1M
    }
  },
  // GPT-4 base
  {
    pattern: /gpt-4(?!-turbo|-32k|-1106|o)/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 8192,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.93,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0.03,    // $30/1M
      outputCostPer1k: 0.06,   // $60/1M
    }
  },
  // GPT-3.5 Turbo 16K
  {
    pattern: /gpt-3\.5-turbo-16k|gpt-35-turbo-16k/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 16384,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.85,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0.003,   // $3/1M
      outputCostPer1k: 0.004,  // $4/1M
    }
  },
  // GPT-3.5 Turbo
  {
    pattern: /gpt-3\.5|gpt-35/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 4096,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.85,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0.0005,  // $0.50/1M
      outputCostPer1k: 0.0015, // $1.50/1M
    }
  },
  // O1 reasoning models (native reasoning)
  {
    pattern: /\bo1-preview\b/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 128000,
      maxOutputTokens: 32768,
      functionCalling: true,
      functionCallingAccuracy: 0.96,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.015,   // $15/1M
      outputCostPer1k: 0.06,   // $60/1M
    }
  },
  // O1-mini
  {
    pattern: /\bo1-mini\b/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 128000,
      maxOutputTokens: 65536,
      functionCalling: true,
      functionCallingAccuracy: 0.94,
      vision: false,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 16000,
        defaultBudgetTokens: 4000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.003,   // $3/1M
      outputCostPer1k: 0.012,  // $12/1M
    }
  },
  // O1/O3 reasoning models (general pattern)
  {
    pattern: /\bo1\b|\bo3\b/i,
    capabilities: {
      family: 'gpt',
      providerType: 'azure-openai',
      maxContextTokens: 128000,
      maxOutputTokens: 32768,
      functionCalling: true,
      functionCallingAccuracy: 0.96,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.015,   // $15/1M
      outputCostPer1k: 0.06,   // $60/1M
    }
  },
  // Claude Haiku 4.5 (AWS Bedrock model ID: anthropic.claude-haiku-4-5-*)
  {
    pattern: /anthropic\.claude-haiku-4-5|claude-haiku-4\.5|haiku-4\.5/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.90,
      vision: true,
      thinking: false,  // Haiku doesn't support extended thinking
      jsonMode: true,
      thinkingCapabilities: {
        enabled: false,
        type: 'none',
        maxBudgetTokens: 0,
        defaultBudgetTokens: 0,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.0011,   // $1.10/1M - AWS Bedrock pricing
      outputCostPer1k: 0.0055,  // $5.50/1M - AWS Bedrock pricing
    }
  },
  // Claude Sonnet 4.5 (AWS Bedrock model ID: anthropic.claude-sonnet-4-5-*)
  {
    pattern: /anthropic\.claude-sonnet-4-5|claude-sonnet-4\.5|sonnet-4\.5/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 16384,
      functionCalling: true,
      functionCallingAccuracy: 0.96,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.0033,   // $3.30/1M - AWS Bedrock pricing
      outputCostPer1k: 0.0165,  // $16.50/1M - AWS Bedrock pricing
    }
  },
  // Claude Sonnet 4.5 Long Context (AWS Bedrock)
  {
    pattern: /anthropic\.claude-sonnet-4-5.*long|claude-sonnet-4\.5.*long|sonnet-4\.5.*long/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 16384,
      functionCalling: true,
      functionCallingAccuracy: 0.96,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.0066,    // $6.60/1M - Long context pricing
      outputCostPer1k: 0.02475,  // $24.75/1M - Long context pricing
    }
  },
  // Claude Opus 4.8 (current flagship) — #cap-sync 2026-06-16.
  // MUST precede the Opus-4.0 catch-all `/claude-opus-4(?!\.)/` below: that
  // pattern matches `claude-opus-4-8` (hyphen, not dot → negative-lookahead
  // passes), so without this entry a pinned 4.8 mis-resolved to Opus-4.0's
  // maxOutput:4096 + Opus-3 cost AND emitted the wrong (enabled) thinking
  // shape → Bedrock 400 → "thinking not supported". Adaptive-only, 1M ctx,
  // 128K out, $5/$25 — verified against the claude-api skill.
  {
    pattern: /anthropic\.claude-opus-4-8|claude-opus-4-8|claude-opus-4\.8|opus-4-8|opus-4\.8/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 1000000,
      maxOutputTokens: 128000,
      functionCalling: true,
      functionCallingAccuracy: 0.98,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        // adaptive-only: budget_tokens is REJECTED with a 400 on 4.8. The
        // budget fields are advisory; the wire must send {type:'adaptive'} and
        // control depth via effort. thinkingMode drives the SDK wire branch.
        maxBudgetTokens: 0,
        defaultBudgetTokens: 0,
        supportsReasoningEffort: true,
        thinkingMode: 'adaptive',
      },
      inputCostPer1k: 0.005,   // $5/1M
      outputCostPer1k: 0.025,  // $25/1M
    }
  },
  // Claude Opus 4.7 (previous flagship — same adaptive-only surface as 4.8).
  {
    pattern: /anthropic\.claude-opus-4-7|claude-opus-4-7|claude-opus-4\.7|opus-4-7|opus-4\.7/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 1000000,
      maxOutputTokens: 128000,
      functionCalling: true,
      functionCallingAccuracy: 0.98,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 0,
        defaultBudgetTokens: 0,
        supportsReasoningEffort: true,
        thinkingMode: 'adaptive',
      },
      inputCostPer1k: 0.005,   // $5/1M
      outputCostPer1k: 0.025,  // $25/1M
    }
  },
  // Claude Opus 4.5 (newest)
  // Claude Opus 4.6
  {
    pattern: /claude-opus-4-6|claude-opus-4\.6|opus-4\.6/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 128000,
      functionCalling: true,
      functionCallingAccuracy: 0.97,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 64000,
        defaultBudgetTokens: 16000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.005,   // $5/1M
      outputCostPer1k: 0.025,  // $25/1M
    }
  },
  // Claude Sonnet 4.6
  {
    pattern: /claude-sonnet-4-6|claude-sonnet-4\.6|sonnet-4\.6/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 64000,
      functionCalling: true,
      functionCallingAccuracy: 0.96,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.003,   // $3/1M
      outputCostPer1k: 0.015,  // $15/1M
    }
  },
  // Claude Opus 4.5
  {
    pattern: /anthropic\.claude-opus-4-5|claude-opus-4-5|claude-opus-4\.5|opus-4\.5/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 32768,
      functionCalling: true,
      functionCallingAccuracy: 0.97,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 64000,
        defaultBudgetTokens: 16000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.0055,   // $5.50/1M - AWS Bedrock pricing
      outputCostPer1k: 0.0275,  // $27.50/1M - AWS Bedrock pricing
    }
  },
  // Claude Opus 4.1
  {
    pattern: /claude-opus-4-1|claude-opus-4\.1|opus-4\.1/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 32768,
      functionCalling: true,
      functionCallingAccuracy: 0.97,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 16000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.015,   // $15/1M - AWS Bedrock pricing
      outputCostPer1k: 0.075,  // $75/1M - AWS Bedrock pricing
    }
  },
  // Claude Opus 4 / Claude 3 Opus
  {
    pattern: /claude-3-opus|claude-opus-4(?!\.)|opus-4(?!\.)/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.96,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 16000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.015,   // $15/1M - AWS Bedrock pricing
      outputCostPer1k: 0.075,  // $75/1M - AWS Bedrock pricing
    }
  },
  // Claude Sonnet 4 Long Context
  {
    pattern: /claude-sonnet-4.*long|sonnet-4.*long/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 16384,
      functionCalling: true,
      functionCallingAccuracy: 0.95,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.006,    // $6/1M - Long context pricing
      outputCostPer1k: 0.0225,  // $22.50/1M - Long context pricing
    }
  },
  // Claude Sonnet 4
  {
    pattern: /claude-sonnet-4(?!\.)|sonnet-4(?!\.)/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 16384,
      functionCalling: true,
      functionCallingAccuracy: 0.95,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.003,   // $3/1M - AWS Bedrock pricing
      outputCostPer1k: 0.015,  // $15/1M - AWS Bedrock pricing
    }
  },
  // Claude 3.7 Sonnet
  {
    pattern: /claude-3\.7-sonnet/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.94,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.003,   // $3/1M - AWS Bedrock pricing
      outputCostPer1k: 0.015,  // $15/1M - AWS Bedrock pricing
    }
  },
  // Claude 3.5 Sonnet v2
  {
    pattern: /claude-3\.5-sonnet-v2|claude-3-5-sonnet-v2/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.94,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.003,   // $3/1M - AWS Bedrock pricing
      outputCostPer1k: 0.015,  // $15/1M - AWS Bedrock pricing
    }
  },
  // Claude 3.5 Sonnet
  {
    pattern: /claude-3\.5-sonnet|claude-3-5-sonnet|claude-sonnet/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.94,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.003,   // $3/1M - AWS Bedrock pricing
      outputCostPer1k: 0.015,  // $15/1M - AWS Bedrock pricing
    }
  },
  // Claude 3.5 Haiku
  {
    pattern: /claude-3\.5-haiku|claude-3-5-haiku/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.88,
      vision: true,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0.0008,  // $0.80/1M - AWS Bedrock pricing
      outputCostPer1k: 0.004,  // $4/1M - AWS Bedrock pricing
    }
  },
  // Claude 3 Haiku (no extended thinking)
  {
    pattern: /claude-3-haiku|claude-haiku/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 200000,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.85,
      vision: true,
      thinking: false,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: false,
        type: 'none',
        maxBudgetTokens: 0,
        defaultBudgetTokens: 0,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.00025, // $0.25/1M - AWS Bedrock pricing
      outputCostPer1k: 0.00125,// $1.25/1M - AWS Bedrock pricing
    }
  },
  // Claude 2.x
  {
    pattern: /claude-2/i,
    capabilities: {
      family: 'claude',
      providerType: 'aws-bedrock',
      maxContextTokens: 100000,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.80,
      vision: false,
      thinking: false,
      jsonMode: false,
      inputCostPer1k: 0.008,   // $8/1M
      outputCostPer1k: 0.024,  // $24/1M
    }
  },
  // Gemini 3 (advanced reasoning with effort levels)
  {
    pattern: /gemini-3/i,
    capabilities: {
      family: 'gemini',
      providerType: 'vertex-ai',
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      functionCallingAccuracy: 0.95,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 32000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: true,
        defaultReasoningEffort: 'medium',
      },
      inputCostPer1k: 0.00125, // $1.25/1M
      outputCostPer1k: 0.005,  // $5/1M
    }
  },
  // Gemini 2.5 Pro (reasoning effort support)
  {
    pattern: /gemini-2\.5-pro/i,
    capabilities: {
      family: 'gemini',
      providerType: 'vertex-ai',
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      functionCallingAccuracy: 0.94,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 24000,
        defaultBudgetTokens: 8000,
        supportsReasoningEffort: true,
        defaultReasoningEffort: 'medium',
      },
      inputCostPer1k: 0.00125, // $1.25/1M
      outputCostPer1k: 0.005,  // $5/1M
    }
  },
  // Gemini 2.5 Flash
  {
    pattern: /gemini-2\.5-flash/i,
    capabilities: {
      family: 'gemini',
      providerType: 'vertex-ai',
      maxContextTokens: 1000000,
      maxOutputTokens: 65536,
      functionCalling: true,
      functionCallingAccuracy: 0.93,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 16000,
        defaultBudgetTokens: 4000,
        supportsReasoningEffort: true,
        defaultReasoningEffort: 'medium',
      },
      inputCostPer1k: 0.000075, // $0.075/1M
      outputCostPer1k: 0.0003,  // $0.30/1M
    }
  },
  // Gemini 2.0 Flash (reasoning effort support)
  {
    pattern: /gemini-2\.0-flash|gemini-2-flash/i,
    capabilities: {
      family: 'gemini',
      providerType: 'vertex-ai',
      maxContextTokens: 1000000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.93,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 16000,
        defaultBudgetTokens: 4000,
        supportsReasoningEffort: true,
        defaultReasoningEffort: 'medium',
      },
      inputCostPer1k: 0.000075, // $0.075/1M (free tier available)
      outputCostPer1k: 0.0003,  // $0.30/1M
    }
  },
  // Gemini 2.0 (other variants)
  {
    pattern: /gemini-2\.0|gemini-2(?!\.)/i,
    capabilities: {
      family: 'gemini',
      providerType: 'vertex-ai',
      maxContextTokens: 1000000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.93,
      vision: true,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 16000,
        defaultBudgetTokens: 4000,
        supportsReasoningEffort: true,
        defaultReasoningEffort: 'medium',
      },
      inputCostPer1k: 0.00015,  // $0.15/1M
      outputCostPer1k: 0.0006,  // $0.60/1M
    }
  },
  // Gemini 1.5 Pro (no extended thinking)
  {
    pattern: /gemini-1\.5-pro/i,
    capabilities: {
      family: 'gemini',
      providerType: 'vertex-ai',
      maxContextTokens: 1000000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.93,
      vision: true,
      thinking: false,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: false,
        type: 'none',
        maxBudgetTokens: 0,
        defaultBudgetTokens: 0,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.00125,  // $1.25/1M
      outputCostPer1k: 0.005,   // $5/1M
    }
  },
  // Gemini 1.5 Flash (no extended thinking)
  {
    pattern: /gemini-1\.5-flash/i,
    capabilities: {
      family: 'gemini',
      providerType: 'vertex-ai',
      maxContextTokens: 1000000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.92,
      vision: true,
      thinking: false,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: false,
        type: 'none',
        maxBudgetTokens: 0,
        defaultBudgetTokens: 0,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.000075, // $0.075/1M
      outputCostPer1k: 0.0003,  // $0.30/1M
    }
  },
  // Gemini Pro (1.0)
  {
    pattern: /gemini-pro(?!-vision)/i,
    capabilities: {
      family: 'gemini',
      providerType: 'vertex-ai',
      maxContextTokens: 32768,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.90,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0.0005,   // $0.50/1M
      outputCostPer1k: 0.0015,  // $1.50/1M
    }
  },
  // Llama 3.3
  {
    pattern: /llama-3\.3|llama3\.3/i,
    capabilities: {
      family: 'llama',
      providerType: 'ollama',
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.82,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0,        // Free (local)
      outputCostPer1k: 0,
    }
  },
  // Llama 3.1
  {
    pattern: /llama-3\.1|llama3\.1/i,
    capabilities: {
      family: 'llama',
      providerType: 'ollama',
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.80,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // Llama 3
  {
    pattern: /llama-3|llama3/i,
    capabilities: {
      family: 'llama',
      providerType: 'ollama',
      maxContextTokens: 8192,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.78,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // Llama 2
  {
    pattern: /llama-2|llama2/i,
    capabilities: {
      family: 'llama',
      providerType: 'ollama',
      maxContextTokens: 4096,
      maxOutputTokens: 4096,
      functionCalling: false,
      functionCallingAccuracy: 0,
      vision: false,
      thinking: false,
      jsonMode: false,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // Mistral Large
  {
    pattern: /mistral-large/i,
    capabilities: {
      family: 'mistral',
      providerType: 'ollama',
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.85,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // Mistral (other)
  {
    pattern: /mistral/i,
    capabilities: {
      family: 'mistral',
      providerType: 'ollama',
      maxContextTokens: 32768,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.80,
      vision: false,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // Qwen
  {
    pattern: /qwen/i,
    capabilities: {
      family: 'qwen',
      providerType: 'ollama',
      maxContextTokens: 32768,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.82,
      vision: true,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // DeepSeek-R1 (native reasoning)
  {
    pattern: /deepseek-r1/i,
    capabilities: {
      family: 'deepseek',
      providerType: 'ollama',
      maxContextTokens: 64000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.80,
      vision: false,
      thinking: true,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: true,
        type: 'native',
        maxBudgetTokens: 16000,
        defaultBudgetTokens: 4000,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.00014,  // $0.14/1M (API pricing)
      outputCostPer1k: 0.00028, // $0.28/1M
    }
  },
  // DeepSeek (other models)
  {
    pattern: /deepseek/i,
    capabilities: {
      family: 'deepseek',
      providerType: 'ollama',
      maxContextTokens: 64000,
      maxOutputTokens: 8192,
      functionCalling: true,
      functionCallingAccuracy: 0.80,
      vision: false,
      thinking: false,
      jsonMode: true,
      thinkingCapabilities: {
        enabled: false,
        type: 'none',
        maxBudgetTokens: 0,
        defaultBudgetTokens: 0,
        supportsReasoningEffort: false,
      },
      inputCostPer1k: 0.00014,
      outputCostPer1k: 0.00028,
    }
  },
  // Phi
  {
    pattern: /phi/i,
    capabilities: {
      family: 'phi',
      providerType: 'ollama',
      maxContextTokens: 16384,
      maxOutputTokens: 4096,
      functionCalling: false,
      functionCallingAccuracy: 0,
      vision: false,
      thinking: false,
      jsonMode: false,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // gpt-oss (Ollama) — has custom channel-based tool call parsing in OllamaProvider.
  // FCA 0.87 matches the router's live in-memory profile (validated on gpt-oss:20b
  // in the production dev environment routing). MCR previously carried 0.75 which was a
  // pre-channel-parser estimate from the original seed; bumped 2026-04-23 to
  // unblock chat-pool routing (gpt-oss:20b was being filtered out by the 0.82
  // floor, causing simple prompts like "write a haiku" to fall through to
  // Sonnet even though gpt-oss was clearly the correct routing target).
  {
    pattern: /gpt-oss/i,
    capabilities: {
      family: 'gpt-oss',
      providerType: 'ollama',
      maxContextTokens: 8192,
      maxOutputTokens: 4096,
      functionCalling: true,
      functionCallingAccuracy: 0.87,
      vision: false,
      thinking: true,
      jsonMode: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // Gemma3 (Ollama) — Ollama reports "does not support tools" for gemma3
  {
    pattern: /gemma/i,
    capabilities: {
      family: 'gemma',
      providerType: 'ollama',
      maxContextTokens: 128000,
      maxOutputTokens: 8192,
      functionCalling: false,
      functionCallingAccuracy: 0,
      vision: true,
      thinking: false,
      jsonMode: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
    }
  },
  // Amazon Titan Multimodal Embeddings G1 (AWS Bedrock)
  {
    pattern: /amazon\.titan-embed-image|titan-embed-image|titan-multimodal-embed/i,
    capabilities: {
      family: 'titan',
      providerType: 'aws-bedrock',
      maxContextTokens: 8192,
      maxOutputTokens: 0,  // Embedding model, no output tokens
      functionCalling: false,
      functionCallingAccuracy: 0,
      vision: true,  // Multimodal - supports images
      thinking: false,
      jsonMode: false,
      embeddings: true,
      inputCostPer1k: 0.0008,  // $0.80/1M tokens for Titan embeddings
      outputCostPer1k: 0,
    }
  },
  // Amazon Titan Text Embeddings (AWS Bedrock)
  {
    pattern: /amazon\.titan-embed-text|titan-embed-text/i,
    capabilities: {
      family: 'titan',
      providerType: 'aws-bedrock',
      maxContextTokens: 8192,
      maxOutputTokens: 0,
      functionCalling: false,
      functionCallingAccuracy: 0,
      vision: false,
      thinking: false,
      jsonMode: false,
      embeddings: true,
      inputCostPer1k: 0.0001,  // $0.10/1M tokens for Titan text embeddings
      outputCostPer1k: 0,
    }
  },
  // Stability AI Stable Image Core (AWS Bedrock)
  {
    pattern: /stability\.stable-image-core|stable-image-core/i,
    capabilities: {
      family: 'unknown',
      providerType: 'aws-bedrock',
      maxContextTokens: 0,
      maxOutputTokens: 0,
      functionCalling: false,
      functionCallingAccuracy: 0,
      vision: false,
      thinking: false,
      jsonMode: false,
      imageGeneration: true,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
      // Note: Image generation is priced per image, not per token
      // Stable Image Core: ~$0.04 per image (standard) to $0.08 (HD)
    }
  },
];

// Provider detection patterns
const PROVIDER_PATTERNS: Array<{ pattern: RegExp; providerType: ProviderType }> = [
  { pattern: /claude.*anthropic|anthropic.*claude|@anthropic/i, providerType: 'vertex-claude' },
  { pattern: /anthropic\./i, providerType: 'aws-bedrock' },
  { pattern: /amazon\.titan/i, providerType: 'aws-bedrock' },
  { pattern: /meta\.llama/i, providerType: 'aws-bedrock' },
  { pattern: /ai21\./i, providerType: 'aws-bedrock' },
  { pattern: /cohere\./i, providerType: 'aws-bedrock' },
  { pattern: /gpt-oss/i, providerType: 'ollama' },  // gpt-oss must match before generic gpt patterns
  { pattern: /gpt-4|gpt-3|gpt-35|gpt-5|text-davinci/i, providerType: 'azure-openai' },
  { pattern: /gemini|palm|bison/i, providerType: 'vertex-ai' },
  { pattern: /llama|mistral|qwen|deepseek|phi|codellama|vicuna|orca/i, providerType: 'ollama' },
];

// Lightweight SoT-row enrichers — used only to fill ModelCapabilities
// fields the DB row does not currently track (family label, provider-type
// label). They DO NOT decide capabilities; capabilities come from the row's
// JSONB. If/when admin.model_role_assignments grows a `family` and
// `provider_type` column these helpers go away.
function inferFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  if (/gpt-oss/.test(m)) return 'gpt-oss';
  if (/^gpt|davinci/.test(m)) return 'gpt';
  if (/claude/.test(m)) return 'claude';
  if (/gemini|bison|palm/.test(m)) return 'gemini';
  if (/llama|codellama|vicuna|orca/.test(m)) return 'llama';
  if (/mistral|mixtral/.test(m)) return 'mistral';
  if (/qwen/.test(m)) return 'qwen';
  if (/deepseek/.test(m)) return 'deepseek';
  if (/^phi/.test(m)) return 'phi';
  if (/gemma/.test(m)) return 'gemma';
  if (/titan/.test(m)) return 'titan';
  return 'unknown';
}

function inferProviderType(provider: string): ProviderType {
  const p = provider.toLowerCase();
  if (p === 'aif' || p === 'azure-ai-foundry') return 'azure-ai-foundry';
  if (p === 'azure' || p === 'azure-openai') return 'azure-openai';
  if (p === 'vertex' || p === 'vertex-ai' || p === 'gcp') return 'vertex-ai';
  if (p === 'bedrock' || p === 'aws-bedrock') return 'aws-bedrock';
  if (p === 'ollama') return 'ollama';
  if (p === 'openai') return 'openai';
  if (p === 'anthropic') return 'anthropic';
  return 'unknown';
}

/**
 * #cap-sync (2026-06-16) — guard for the cache partial-match in
 * getCapabilities(). Two model ids may safely share a cached capability row
 * only if they don't carry DIFFERENT version tokens. A version token is the
 * `N-M` / `N.M` suffix in `...-4-8`, `...-4.6`, etc. If both ids carry a
 * version and the versions differ, the partial match is a hijack (e.g.
 * `claude-opus-4` cache row vs `claude-opus-4-8` lookup) → reject, fall
 * through to the ordered pattern table. If at most one side carries a version,
 * the `includes` overlap is just provider-prefix / suffix noise → accept.
 */
function sameModelVersion(a: string, b: string): boolean {
  const ver = (s: string): string | null => {
    // Capture the family+version core, e.g. "opus-4-8" / "sonnet-4.6".
    const m = s.match(/(opus|sonnet|haiku|fable|mythos|gpt|gemini|claude)[-.]?(\d+(?:[-.]\d+)*)/i);
    return m ? m[2].replace(/-/g, '.') : null;
  };
  const va = ver(a);
  const vb = ver(b);
  if (va === null || vb === null) return true; // at most one versioned → noise overlap, safe
  return va === vb;                            // both versioned → must match exactly
}

// ============================================================================
// MODEL CAPABILITY REGISTRY
// ============================================================================

export class ModelCapabilityRegistry {
  private logger: Logger;
  private prisma?: PrismaClient;
  private cache: Map<string, ModelCapabilities> = new Map();
  private initialized = false;

  constructor(logger: Logger, prisma?: PrismaClient) {
    this.logger = logger.child({ service: 'ModelCapabilityRegistry' });
    this.prisma = prisma;
  }

  /**
   * Initialize the registry by loading capabilities from database
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load from database if available
      if (this.prisma) {
        await this.loadFromDatabase();
      }

      // Load from environment overrides
      this.loadFromEnvironment();

      this.initialized = true;
      this.logger.info({
        cachedModels: this.cache.size,
      }, 'ModelCapabilityRegistry initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize ModelCapabilityRegistry');
      this.initialized = true; // Still mark as initialized to use pattern fallbacks
    }
  }

  /**
   * Load model capabilities from the registry SoT
   * (admin.model_role_assignments). Reads each active+enabled row's
   * capabilities JSONB and populates the cache.
   *
   * The previous implementation read from a non-existent `modelCapability`
   * table, which meant the substring/regex pattern fallback was the de
   * facto SoT — exactly what docs/rules/no-hardcoded-models.md forbids.
   * This method now sources from the registry table that the seeder +
   * admin UI write to.
   */
  private async loadFromDatabase(): Promise<void> {
    if (!this.prisma) return;

    try {
      const rows: any[] = await (this.prisma as any).modelRoleAssignment?.findMany({
        where: { enabled: true },
      }) ?? [];

      for (const row of rows) {
        const caps = (row.capabilities ?? {}) as Record<string, any>;
        const family = inferFamily(row.model);
        const providerType = inferProviderType(row.provider);

        // Merge any extra keys (e.g. maxContextTokens written by discovery)
        // into the canonical shape, preferring DB values over pattern guesses.
        const fallback = this.getDefaultCapabilities(row.model);

        this.cache.set(String(row.model).toLowerCase(), {
          modelId: row.model,
          displayName: row.description ?? row.model,
          provider: row.provider,
          providerType,
          maxContextTokens: typeof caps.maxContextTokens === 'number' ? caps.maxContextTokens : fallback.maxContextTokens,
          maxOutputTokens: typeof caps.maxOutputTokens === 'number' ? caps.maxOutputTokens : fallback.maxOutputTokens,
          chat: caps.chat ?? fallback.chat,
          vision: caps.vision ?? fallback.vision,
          functionCalling: caps.tools ?? caps.functionCalling ?? fallback.functionCalling,
          functionCallingAccuracy: typeof caps.functionCallingAccuracy === 'number' ? caps.functionCallingAccuracy : fallback.functionCallingAccuracy,
          streaming: caps.streaming ?? fallback.streaming,
          jsonMode: caps.jsonMode ?? fallback.jsonMode,
          thinking: caps.thinking ?? fallback.thinking,
          thinkingCapabilities: caps.thinkingCapabilities ?? fallback.thinkingCapabilities,
          imageGeneration: caps.imageGeneration ?? fallback.imageGeneration,
          embeddings: caps.embeddings ?? fallback.embeddings,
          inputCostPer1k: typeof row.cost_per_input_token_usd === 'number'
            ? Number(row.cost_per_input_token_usd) * 1000
            : undefined,
          outputCostPer1k: typeof row.cost_per_output_token_usd === 'number'
            ? Number(row.cost_per_output_token_usd) * 1000
            : undefined,
          family,
          isAvailable: true,
          lastUpdated: row.updated_at instanceof Date ? row.updated_at : new Date(),
        });
      }

      this.logger.info({ rows: rows.length }, '[MCR] Loaded capabilities from admin.model_role_assignments (SoT)');
      return;
    } catch (error: any) {
      this.logger.warn({ err: error?.message }, '[MCR] modelRoleAssignment SoT read failed; pattern fallback will be used');
    }

    // Legacy modelCapability table (kept as a transitional reader for
    // installs that pre-date Registry SoT v1). Will be deleted once all
    // envs are confirmed to populate model_role_assignments.
    try {
      const capabilities = await (this.prisma as any).modelCapability?.findMany({ where: { enabled: true } });
      if (capabilities) {
        for (const cap of capabilities) {
          this.cache.set(cap.modelId.toLowerCase(), {
            modelId: cap.modelId,
            displayName: cap.displayName,
            provider: cap.provider,
            providerType: cap.providerType as ProviderType,
            maxContextTokens: cap.maxContextTokens,
            maxOutputTokens: cap.maxOutputTokens,
            chat: cap.chat,
            vision: cap.vision,
            functionCalling: cap.functionCalling,
            functionCallingAccuracy: cap.functionCallingAccuracy,
            streaming: cap.streaming,
            jsonMode: cap.jsonMode,
            thinking: cap.thinking,
            imageGeneration: cap.imageGeneration,
            embeddings: cap.embeddings,
            avgLatencyMs: cap.avgLatencyMs,
            tokensPerSecond: cap.tokensPerSecond,
            inputCostPer1k: cap.inputCostPer1k,
            outputCostPer1k: cap.outputCostPer1k,
            family: cap.family as ModelFamily,
            version: cap.version,
            isAvailable: cap.isAvailable,
            lastUpdated: cap.updatedAt,
          });
        }
        this.logger.info({ count: capabilities.length }, 'Loaded model capabilities from database');
      }
    } catch (error) {
      this.logger.debug({ error }, 'ModelCapability table not available, using pattern fallbacks');
    }
  }

  /**
   * Load model capability overrides from environment variables
   * Format: MODEL_CAP_<MODEL_ID>_<PROPERTY>=value
   * Example: MODEL_CAP_GPT4_MAX_CONTEXT=128000
   */
  private loadFromEnvironment(): void {
    const envOverrides = Object.entries(process.env)
      .filter(([key]) => key.startsWith('MODEL_CAP_'));

    for (const [key, value] of envOverrides) {
      const parts = key.replace('MODEL_CAP_', '').split('_');
      if (parts.length >= 2) {
        const modelId = parts.slice(0, -1).join('-').toLowerCase();
        const property = parts[parts.length - 1].toLowerCase();

        const existing = this.cache.get(modelId) || this.getDefaultCapabilities(modelId);

        switch (property) {
          case 'maxcontext':
            existing.maxContextTokens = parseInt(value || '0');
            break;
          case 'maxoutput':
            existing.maxOutputTokens = parseInt(value || '0');
            break;
          case 'fcaccuracy':
            existing.functionCallingAccuracy = parseFloat(value || '0');
            break;
          case 'vision':
            existing.vision = value === 'true';
            break;
          case 'thinking':
            existing.thinking = value === 'true';
            break;
        }

        this.cache.set(modelId, existing);
      }
    }

    if (envOverrides.length > 0) {
      this.logger.info({ count: envOverrides.length }, 'Applied environment capability overrides');
    }
  }

  /**
   * Get capabilities for a model
   */
  getCapabilities(modelId: string): ModelCapabilities {
    const normalized = modelId.toLowerCase();

    // Check cache first (exact hit only).
    if (this.cache.has(normalized)) {
      return this.cache.get(normalized)!;
    }

    // #cap-sync (2026-06-16) — the previous bidirectional `includes` partial
    // match was a version hijack: a cached `claude-opus-4` / `opus-4` row
    // substring-matches `claude-opus-4-8` and short-circuited BEFORE the regex
    // pattern table, so a pinned 4.8 inherited the wrong (4.0) capabilities
    // even after the explicit 4.8 pattern was added. Only accept a partial
    // match when neither side carries a DIFFERENT version token — i.e. the
    // strings differ only by provider prefix / suffix noise, not by version.
    // Otherwise fall through to the authoritative first-match-wins pattern
    // table (getDefaultCapabilities), which has explicit, ordered entries.
    for (const [cachedId, caps] of this.cache) {
      if (
        (normalized.includes(cachedId) || cachedId.includes(normalized)) &&
        sameModelVersion(normalized, cachedId)
      ) {
        return caps;
      }
    }

    // Fall back to pattern matching
    const capabilities = this.getDefaultCapabilities(modelId);

    // Cache the result
    this.cache.set(normalized, capabilities);

    return capabilities;
  }

  /**
   * Get default capabilities by matching against known patterns
   */
  private getDefaultCapabilities(modelId: string): ModelCapabilities {
    const normalized = modelId.toLowerCase();

    // Find matching pattern
    for (const { pattern, capabilities } of MODEL_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          modelId,
          provider: capabilities.providerType || 'unknown',
          providerType: capabilities.providerType || 'unknown',
          maxContextTokens: capabilities.maxContextTokens || 8192,
          maxOutputTokens: capabilities.maxOutputTokens || 4096,
          chat: true,
          vision: capabilities.vision || false,
          functionCalling: capabilities.functionCalling || false,
          functionCallingAccuracy: capabilities.functionCallingAccuracy || 0,
          streaming: true,
          jsonMode: capabilities.jsonMode || false,
          thinking: capabilities.thinking || false,
          thinkingCapabilities: capabilities.thinkingCapabilities || {
            enabled: false,
            type: 'none',
            maxBudgetTokens: 0,
            defaultBudgetTokens: 0,
            supportsReasoningEffort: false,
          },
          imageGeneration: false,
          embeddings: false,
          family: capabilities.family || 'unknown',
          isAvailable: true,
          lastUpdated: new Date(),
          // Include pricing from pattern (fallback values, database overrides)
          inputCostPer1k: capabilities.inputCostPer1k,
          outputCostPer1k: capabilities.outputCostPer1k,
        };
      }
    }

    // Return conservative defaults for unknown models
    return {
      modelId,
      provider: 'unknown',
      providerType: this.detectProviderType(modelId),
      maxContextTokens: 8192,
      maxOutputTokens: 4096,
      chat: true,
      vision: false,
      functionCalling: false,
      functionCallingAccuracy: 0,
      streaming: true,
      jsonMode: false,
      thinking: false,
      thinkingCapabilities: {
        enabled: false,
        type: 'none',
        maxBudgetTokens: 0,
        defaultBudgetTokens: 0,
        supportsReasoningEffort: false,
      },
      imageGeneration: false,
      embeddings: false,
      family: this.detectModelFamily(modelId),
      isAvailable: true,
      lastUpdated: new Date(),
    };
  }

  /**
   * Detect provider type from model ID
   */
  detectProviderType(modelId: string): ProviderType {
    const normalized = modelId.toLowerCase();

    for (const { pattern, providerType } of PROVIDER_PATTERNS) {
      if (pattern.test(normalized)) {
        return providerType;
      }
    }

    // Additional heuristics
    if (normalized.includes('claude') && normalized.includes('@')) {
      return 'vertex-claude';
    }

    return 'unknown';
  }

  /**
   * Detect model family from model ID
   */
  detectModelFamily(modelId: string): ModelFamily {
    const normalized = modelId.toLowerCase();

    if (normalized.includes('gpt') || normalized.includes('o1') || normalized.includes('o3')) return 'gpt';
    if (normalized.includes('claude')) return 'claude';
    if (normalized.includes('gemini')) return 'gemini';
    if (normalized.includes('llama')) return 'llama';
    if (normalized.includes('mistral')) return 'mistral';
    if (normalized.includes('qwen')) return 'qwen';
    if (normalized.includes('deepseek')) return 'deepseek';
    if (normalized.includes('phi')) return 'phi';
    if (normalized.includes('titan')) return 'titan';
    if (normalized.includes('palm') || normalized.includes('bison')) return 'palm';

    return 'unknown';
  }

  /**
   * Get context window size for a model
   */
  getContextWindow(modelId: string): number {
    return this.getCapabilities(modelId).maxContextTokens;
  }

  /**
   * Get function calling accuracy for a model
   */
  getFunctionCallingAccuracy(modelId: string): number {
    return this.getCapabilities(modelId).functionCallingAccuracy;
  }

  /**
   * Check if model supports function calling
   */
  supportsFunctionCalling(modelId: string): boolean {
    return this.getCapabilities(modelId).functionCalling;
  }

  /**
   * Check if model supports vision
   */
  supportsVision(modelId: string): boolean {
    return this.getCapabilities(modelId).vision;
  }

  /**
   * Check if model supports thinking/reasoning
   */
  supportsThinking(modelId: string): boolean {
    return this.getCapabilities(modelId).thinking;
  }

  /**
   * Get detailed thinking capabilities for a model
   */
  getThinkingCapabilities(modelId: string): ThinkingCapabilities {
    const caps = this.getCapabilities(modelId);
    return caps.thinkingCapabilities || {
      enabled: caps.thinking,
      type: caps.thinking ? 'native' : 'none',
      maxBudgetTokens: caps.thinking ? 16000 : 0,
      defaultBudgetTokens: caps.thinking ? 4000 : 0,
      supportsReasoningEffort: false,
    };
  }

  /**
   * Check if model supports reasoning effort levels (Gemini-style)
   */
  supportsReasoningEffort(modelId: string): boolean {
    const caps = this.getThinkingCapabilities(modelId);
    return caps.supportsReasoningEffort;
  }

  /**
   * Check if model is a Claude model
   */
  isClaudeModel(modelId: string): boolean {
    return this.getCapabilities(modelId).family === 'claude';
  }

  /**
   * Check if model is a Gemini model
   */
  isGeminiModel(modelId: string): boolean {
    return this.getCapabilities(modelId).family === 'gemini';
  }

  /**
   * Check if model is a GPT model
   */
  isGPTModel(modelId: string): boolean {
    return this.getCapabilities(modelId).family === 'gpt';
  }

  /**
   * Check if model is an Ollama model
   */
  isOllamaModel(modelId: string): boolean {
    const caps = this.getCapabilities(modelId);
    return caps.providerType === 'ollama' ||
           ['llama', 'mistral', 'qwen', 'deepseek', 'phi'].includes(caps.family);
  }

  /**
   * Register or update a model's capabilities
   */
  async registerModel(capabilities: ModelCapabilities): Promise<void> {
    this.cache.set(capabilities.modelId.toLowerCase(), capabilities);

    // Persist to database if available
    if (this.prisma) {
      try {
        await (this.prisma as any).modelCapability?.upsert({
          where: { modelId: capabilities.modelId },
          create: {
            ...capabilities,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          update: {
            ...capabilities,
            updatedAt: new Date(),
          },
        });
      } catch (error) {
        this.logger.warn({ error, modelId: capabilities.modelId }, 'Failed to persist model capability to database');
      }
    }
  }

  /**
   * Get all registered models
   */
  getAllModels(): ModelCapabilities[] {
    return Array.from(this.cache.values());
  }

  /**
   * True if the registry actually has the model in its DB-backed cache
   * (i.e. an admin.model_role_assignments row exists). Distinct from
   * getCapabilities() which always returns a value via pattern fallback.
   */
  hasModel(modelId: string): boolean {
    return this.cache.has(String(modelId).toLowerCase());
  }

  /**
   * Get all model capabilities with additional metadata for API consumption
   * This is used by the /api/admin/llm-providers/model-capabilities endpoint
   */
  getAllModelCapabilities(): ModelCapabilities[] {
    // Return all cached models - these are populated during initialization
    // from both pattern-based inference and database overrides
    return Array.from(this.cache.values());
  }

  /**
   * Get model recommendations for each tier.
   * Returns models categorized by tier (economical, balanced, premium).
   */
  getTierRecommendations(): {
    economical: { name: string; range: string; models: string[]; description: string };
    balanced: { name: string; range: string; models: string[]; description: string };
    premium: { name: string; range: string; models: string[]; description: string };
  } {
    return {
      economical: {
        name: 'Economical',
        range: '0-40%',
        models: [
          'GPT-4o-mini',
          'Claude 3 Haiku',
          'Gemini 2.0 Flash',
          'Llama 3.3 8B'
        ],
        description: 'Fast, cost-effective models for simple tasks'
      },
      balanced: {
        name: 'Balanced',
        range: '41-60%',
        models: [
          'Claude Sonnet 4.6',
          'Claude 3.5 Sonnet',
          'GPT-4o',
          'Gemini 2.5 Pro'
        ],
        description: 'Good balance of quality and cost for most tasks'
      },
      premium: {
        name: 'Premium',
        range: '61-100%',
        models: [
          'Claude Opus 4.6',
          'Claude Opus 4.5',
          'GPT-4 Turbo',
          'o1-preview',
          'Gemini 2.5 Pro (extended thinking)'
        ],
        description: 'Maximum capability for complex reasoning tasks'
      }
    };
  }

  /**
   * Get display name for a model ID.
   * Used by UI components to show friendly names.
   *
   * H1 (2026-05-05): the registry's `displayName` (sourced from
   * admin.model_role_assignments.description) is the SoT. If the operator
   * hasn't set a description, the UI shows the bare modelId — that's the
   * intended "if it's not in the registry, you see what you stored" signal,
   * not a hidden substring → friendly-label remap.
   */
  getDisplayName(modelId: string): string {
    const capabilities = this.getCapabilities(modelId);
    return capabilities.displayName || modelId;
  }

  /**
   * Get provider icon/color information for UI
   */
  getProviderBranding(modelId: string): { color: string; icon: string } {
    const providerType = this.detectProviderType(modelId);

    switch (providerType) {
      case 'vertex-claude':
      case 'aws-bedrock':
        return { color: '#D97706', icon: 'anthropic' }; // Orange for Claude
      case 'azure-openai':
        return { color: '#10A37F', icon: 'openai' }; // Green for OpenAI
      case 'vertex-ai':
        return { color: '#4285F4', icon: 'google' }; // Blue for Google
      case 'ollama':
        return { color: '#6B7280', icon: 'ollama' }; // Gray for local
      default:
        return { color: '#6B7280', icon: 'default' };
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.initialized = false;
  }
}

// Singleton instance
let registryInstance: ModelCapabilityRegistry | null = null;

export function getModelCapabilityRegistry(): ModelCapabilityRegistry | null {
  return registryInstance;
}

export function setModelCapabilityRegistry(registry: ModelCapabilityRegistry): void {
  registryInstance = registry;
}

export default ModelCapabilityRegistry;
