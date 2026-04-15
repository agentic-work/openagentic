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

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_ENABLE_CHAIN_OF_THOUGHT?: string

  // Build-time feature flags
  readonly VITE_FEATURE_OLLAMA?: string
  readonly VITE_FEATURE_OPENAGENTIC?: string
  readonly VITE_FEATURE_MULTIMODEL?: string
  readonly VITE_FEATURE_SLIDER?: string
  readonly VITE_FEATURE_MCP?: string

  // Onboarding control
  readonly VITE_DISABLE_ONBOARDING?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
