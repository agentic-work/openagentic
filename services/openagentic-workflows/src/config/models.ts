/**
 * Model configuration for workflow service.
 * The workflow engine calls the main API for LLM completions,
 * so this is primarily for reference/fallback resolution.
 */

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'auto';

export const MODELS = {
  default: DEFAULT_MODEL,
  secondary: process.env.SECONDARY_MODEL || DEFAULT_MODEL,
  economical: process.env.ECONOMICAL_MODEL || DEFAULT_MODEL,
  balanced: process.env.BALANCED_MODEL || DEFAULT_MODEL,
  premium: process.env.PREMIUM_MODEL || DEFAULT_MODEL,
  ultraPremium: process.env.ULTRA_PREMIUM_MODEL || DEFAULT_MODEL,
  code: process.env.DEFAULT_CODE_MODEL || DEFAULT_MODEL,
  compaction: process.env.COMPACTION_MODEL || DEFAULT_MODEL,
  anthropic: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  ollama: process.env.OLLAMA_MODEL || DEFAULT_MODEL,
  vertexChat: process.env.VERTEX_AI_CHAT_MODEL || DEFAULT_MODEL,
  azureOpenai: process.env.AIF_MODEL || DEFAULT_MODEL,
};
