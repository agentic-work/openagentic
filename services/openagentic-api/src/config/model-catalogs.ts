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
 * Model Catalogs — Reference Data
 *
 * Context windows, pricing tiers, and capability metadata for known models.
 * These are intrinsic model properties (reference data), NOT runtime model selection.
 * They stay as data tables — no env vars needed.
 *
 * Used by: ContextManagementService, CodeModeSessionService, etc.
 */

// =============================================================================
// CONTEXT WINDOW LIMITS
// =============================================================================

/**
 * Known context window sizes by model family prefix.
 * Uses prefix matching — "claude-opus-4" matches "claude-opus-4-6", etc.
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic models
  'claude-opus-4': 200000,
  'claude-sonnet-4': 200000,
  'claude-3-opus': 200000,
  'claude-3-5-sonnet': 200000,
  'claude-3-5-haiku': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-2': 100000,
  // Anthropic Bedrock inference profiles
  'us.anthropic.claude': 200000,
  'anthropic.claude': 200000,
  // OpenAI models
  'gpt-4-turbo': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16384,
  'o1': 128000,
  'o1-mini': 128000,
  'o3': 200000,
  'o3-mini': 200000,
  // Google models
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-2': 1000000,
  'gemini-3': 1000000,
  'gemini-pro': 32000,
  // Amazon models
  'us.amazon.nova': 300000,
  'amazon.nova': 300000,
  // Ollama / local
  'gpt-oss': 128000,
};

/** Safe default context window for unknown models */
const DEFAULT_CONTEXT_WINDOW = 100000;

/**
 * Get the context window size for a model ID.
 * Uses longest-prefix matching, falls back to safe default.
 */
export function getContextWindow(modelId: string): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;

  // Direct match
  if (MODEL_CONTEXT_WINDOWS[modelId] !== undefined) {
    return MODEL_CONTEXT_WINDOWS[modelId];
  }

  // Prefix match (longest prefix wins)
  let bestMatch = '';
  let bestValue = DEFAULT_CONTEXT_WINDOW;
  for (const [prefix, windowSize] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (modelId.startsWith(prefix) && prefix.length > bestMatch.length) {
      bestMatch = prefix;
      bestValue = windowSize;
    }
  }

  return bestValue;
}
