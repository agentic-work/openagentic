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

  // OpenAgentic / Code Mode
  openagentic: parseFlag(import.meta.env.VITE_FEATURE_OPENAGENTIC, true),

  // Multi-Model orchestration
  multiModel: parseFlag(import.meta.env.VITE_FEATURE_MULTIMODEL, true),

  // Intelligence Slider
  slider: parseFlag(import.meta.env.VITE_FEATURE_SLIDER, true),

  // MCP (Model Context Protocol)
  mcp: parseFlag(import.meta.env.VITE_FEATURE_MCP, true),

  // Synth (Tool Synthesis) - dynamic tool synthesis
  oat: parseFlag(import.meta.env.VITE_FEATURE_OAT, true),
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
