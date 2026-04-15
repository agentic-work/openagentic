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
