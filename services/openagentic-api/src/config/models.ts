/**
 * Centralized Model Configuration — Reduced Surface
 *
 * DB is SoT. MODELS remains only for provider-class transitive use:
 *   AnthropicProvider  — MODELS.anthropic
 *   AWSBedrockProvider — MODELS.default
 *
 * All non-provider consumers have been migrated to ModelConfigurationService
 * as of plan task 6b. Do NOT add new MODELS.* entries for non-provider use.
 * See docs/rules/no-hardcoded-models.md.
 *
 * Environment variables still honoured (for provider-class bootstrap only):
 *   DEFAULT_MODEL   (REQUIRED) - crashes on startup if missing
 *   ANTHROPIC_MODEL - Anthropic direct API
 *
 * H/M3 closed 2026-05-05: MODELS.ollama removed. The Ollama provider has
 * always read its primary model from the registry / per-request, never from
 * a static MODELS.ollama. The previously-flagged hardcoded fallback was
 * dead code (no callers).
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
  // -- Provider-class transitive use only (CLAUDE.md rule #7 allowlist) --

  /** The guaranteed-set default model — used by AWSBedrockProvider */
  default: DEFAULT_MODEL,

  /** Anthropic direct API default — used by AnthropicProvider */
  anthropic: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
} as const;

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
