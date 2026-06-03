/**
 * Build-Time Feature Flags
 *
 * These flags are baked into the UI at build time via VITE_FEATURE_* env vars.
 * To change them, update .env and rebuild the UI.
 *
 * Usage:
 *   import { featureFlags } from '@/config/featureFlags';
 *   if (featureFlags.ollama) { ... }
 */

// Helper to parse boolean env vars (Vite injects them as strings)
const parseFlag = (value: string | undefined, defaultValue = true): boolean => {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() !== 'false';
};

/**
 * Feature flags baked in at build time
 * Default: all features enabled (for full build)
 */
export const featureFlags = {
  // Ollama LLM provider - set to false to remove Ollama management
  ollama: parseFlag(import.meta.env.VITE_FEATURE_OLLAMA, false),

  // Multi-Model orchestration
  multiModel: parseFlag(import.meta.env.VITE_FEATURE_MULTIMODEL, true),

  // 2026-04-19 — Intelligence Slider flag removed (task #144, slider rip).

  // MCP (Model Context Protocol)
  mcp: parseFlag(import.meta.env.VITE_FEATURE_MCP, true),
} as const;

// Type for feature flag keys
export type FeatureFlag = keyof typeof featureFlags;

// Check if a feature is enabled
export const isFeatureEnabled = (flag: FeatureFlag): boolean => featureFlags[flag];

// Log feature flags in development
if (import.meta.env.DEV) {
  console.log('[FeatureFlags] Build-time configuration:', featureFlags);
}

export default featureFlags;
