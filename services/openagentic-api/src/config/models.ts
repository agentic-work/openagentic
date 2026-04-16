/**
 * Centralized Model Configuration
 *
 * Single source of truth for ALL model IDs in the API service.
 * Every model reference imports from here. No hardcoded model strings elsewhere.
 *
 * Startup CRASHES if DEFAULT_MODEL is unset — this is intentional.
 * All tier/purpose models fall back to DEFAULT_MODEL if their env var is unset.
 *
 * Environment variables:
 *   DEFAULT_MODEL          (REQUIRED) - crashes on startup if missing
 *   SECONDARY_MODEL        - cheap/fast fallback model (e.g. nova-micro)
 *   ECONOMICAL_MODEL       - slider 0-40% tier
 *   PREMIUM_MODEL          - slider 61-85% tier
 *   ULTRA_PREMIUM_MODEL    - slider 86-100% tier
 *   DEFAULT_CODE_MODEL     - code mode sessions
 *   COMPACTION_MODEL        - summarization/compaction
 *   ANTHROPIC_MODEL        - Anthropic direct API
 *   OPENAI_MODEL           - OpenAI direct API
 *   OLLAMA_MODEL           - Ollama local
 *   VERTEX_AI_MODEL / VERTEX_AI_CHAT_MODEL - Vertex AI
 *   VERTEX_THINKING_MODEL  - Vertex thinking model
 *   AIF_MODEL              - Azure AI Foundry
 *   GEMINI_IMAGE_MODEL     - Gemini image generation
 *   AZURE_IMAGE_MODEL      - Azure image generation
 *   VERTEX_IMAGE_MODEL     - Vertex image generation
 *   AGENT_<TYPE>_PRIMARY_MODEL / AGENT_<TYPE>_FALLBACK_MODEL - per-agent overrides
 */

// =============================================================================
// STARTUP VALIDATION
// =============================================================================

// DEFAULT_MODEL from env or fallback to 'auto' (SmartModelRouter resolves at runtime)
// When set to 'auto', ProviderManager.getDefaultModel() picks the first available provider's model.
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'auto';
if (DEFAULT_MODEL === 'auto') {
  console.warn(
    '[WARN] DEFAULT_MODEL not set - using "auto" mode. ' +
    'SmartModelRouter will resolve model from database providers at runtime.'
  );
}

// =============================================================================
// MODEL TIERS — resolved from database via ModelConfigurationService
// =============================================================================
// REMOVED: Static MODEL_TIERS and resolveSliderModel().
// All model tier resolution now goes through ModelConfigurationService.getSliderTiers()
// which reads from the admin-configured LLMProvider database table.
// This ensures agents, sliders, and chat all use the same DB-configured models.
//
// Legacy callers should use:
//   const mcs = new (await import('./ModelConfigurationService.js')).ModelConfigurationService();
//   const tiers = await mcs.getSliderTiers(); // { economical, balanced, premium }
// Or simply pass model='auto' and let ProviderManager.selectProvider() handle it.

// =============================================================================
// PURPOSE-SPECIFIC MODELS
// =============================================================================

export const MODELS = {
  /** The guaranteed-set default model */
  default: DEFAULT_MODEL,

  /** Code mode sessions */
  code: process.env.DEFAULT_CODE_MODEL || DEFAULT_MODEL,

  /** Summarization / context compaction (should be fast+cheap) */
  compaction: process.env.COMPACTION_MODEL || process.env.SECONDARY_MODEL || DEFAULT_MODEL,

  // -- Provider-specific defaults (used by LLMProviderSeeder) --

  /** Anthropic direct API default */
  anthropic: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,

  /** OpenAI direct API default */
  openai: process.env.OPENAI_MODEL || DEFAULT_MODEL,

  /** Ollama local model */
  ollama: process.env.OLLAMA_MODEL || 'gpt-oss',

  /** Vertex AI chat model */
  vertexChat: process.env.VERTEX_AI_MODEL || process.env.VERTEX_AI_CHAT_MODEL || DEFAULT_MODEL,

  /** Vertex AI thinking model */
  vertexThinking: process.env.VERTEX_THINKING_MODEL || DEFAULT_MODEL,

  /** Azure AI Foundry / model-router */
  azureAiFoundry: process.env.AIF_MODEL || DEFAULT_MODEL,

  /** Azure OpenAI (uses deployment name from env) */
  azureOpenai: process.env.AZURE_OPENAI_DEPLOYMENT || DEFAULT_MODEL,

  // Image generation models are now managed through the admin portal (LLMProvider system)
  // No hardcoded image model env vars — providers with imageGeneration capability handle this
} as const;

/**
 * Get the default model. Guaranteed non-empty (startup validates).
 */
export function getDefaultModel(): string {
  return DEFAULT_MODEL;
}

// =============================================================================
// AGENT MODELS (per-agent type primary + fallback)
// =============================================================================

export type AgentType =
  | 'data_query'
  | 'data_extraction'
  | 'tool_orchestration'
  | 'reasoning'
  | 'summarization'
  | 'code_execution'
  | 'planning'
  | 'validation'
  | 'synthesis'
  | 'artifact_creation'
  | 'cloud_operations'
  | 'custom';

// REMOVED: AGENT_MODELS static config.
// Agent model selection now uses ModelConfigurationService.getSliderTiers() (DB)
// or falls back to 'auto' (Smart Router picks best available model).
// Per-agent env var overrides (AGENT_*_PRIMARY_MODEL) are no longer supported.
// Configure models via Admin Console > LLM Providers > Models.
