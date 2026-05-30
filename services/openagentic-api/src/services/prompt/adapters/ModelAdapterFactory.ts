import type { AdapterFamily, ModelCapabilities } from '../types.js';
import type { ModelAdapter } from './types.js';
import { ClaudeAdapter } from './ClaudeAdapter.js';
import { GeminiAdapter } from './GeminiAdapter.js';
import { OpenAIAdapter } from './OpenAIAdapter.js';
import { LocalAdapter } from './LocalAdapter.js';

// Pattern → family mappings (checked in order)
const FAMILY_PATTERNS: Array<{ pattern: RegExp; family: AdapterFamily }> = [
  { pattern: /claude/i, family: 'claude' },
  { pattern: /gemini/i, family: 'gemini' },
  { pattern: /gpt-4|gpt-3\.5|o1|o3|chatgpt/i, family: 'openai' },
  { pattern: /gpt-oss|llama|mistral|mixtral|phi|qwen|deepseek|command/i, family: 'local' },
];

// Pre-built adapter singletons
const ADAPTERS: Record<AdapterFamily, ModelAdapter> = {
  claude: new ClaudeAdapter(),
  gemini: new GeminiAdapter(),
  openai: new OpenAIAdapter(),
  local: new LocalAdapter(),
};

export class ModelAdapterFactory {
  /**
   * Resolve adapter using:
   * 1. Explicit DB family (if provided and valid)
   * 2. Pattern match on modelId
   * 3. Default → 'openai'
   */
  static getAdapter(modelId: string, dbFamily?: AdapterFamily | null): ModelAdapter {
    if (dbFamily && ADAPTERS[dbFamily]) {
      return ADAPTERS[dbFamily];
    }
    const detected = ModelAdapterFactory.detectFamily(modelId);
    return ADAPTERS[detected];
  }

  /**
   * Detect adapter family from model ID string via pattern matching.
   * Falls back to 'openai' for unknown models.
   */
  static detectFamily(modelId: string): AdapterFamily {
    for (const { pattern, family } of FAMILY_PATTERNS) {
      if (pattern.test(modelId)) {
        return family;
      }
    }
    return 'openai';
  }
}

/**
 * Bridge ModelCapabilityRegistry field names to the prompt system's ModelCapabilities interface.
 * Used when live model capabilities are available from the registry.
 */
export function mapRegistryCapabilities(registryCaps: any): ModelCapabilities {
  return {
    thinking: registryCaps?.supportsThinking ?? registryCaps?.thinking ?? false,
    tools: registryCaps?.functionCalling ?? registryCaps?.supportsTools ?? false,
    vision: registryCaps?.vision ?? registryCaps?.supportsVision ?? false,
    longContext: (registryCaps?.contextWindow ?? registryCaps?.maxContextTokens ?? 0) > 100000,
    audio: registryCaps?.audio ?? false,
    video: registryCaps?.video ?? false,
    documents: registryCaps?.documents ?? registryCaps?.vision ?? registryCaps?.supportsVision ?? false,
    streaming: registryCaps?.streaming ?? true,
    imageGen: registryCaps?.imageGeneration ?? registryCaps?.imageGen ?? false,
    audioGen: registryCaps?.audioGen ?? false,
    videoGen: registryCaps?.videoGen ?? false,
    embedding: registryCaps?.embeddings ?? registryCaps?.embedding ?? registryCaps?.isEmbeddingModel ?? false,
    codeExecution: registryCaps?.codeExecution ?? false,
    grounding: registryCaps?.supportsGrounding ?? registryCaps?.grounding ?? false,
  };
}
