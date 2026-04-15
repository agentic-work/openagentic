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

export type ModuleCategory = 'core' | 'domain' | 'mode' | 'capability';
export type AdapterFamily = 'claude' | 'gemini' | 'openai' | 'local';
export type ContextMode = 'chat' | 'code' | 'flow';

export interface ModuleInjectionRules {
  alwaysInject?: boolean;
  requiresTools?: string[];        // Glob patterns: "azure_*"
  requiresCapabilities?: string[];
  requiresMode?: ContextMode[];
  semanticMatch?: boolean;
}

export interface PromptModule {
  id: string;
  name: string;
  category: ModuleCategory;
  content: string;
  description: string;
  priority: number;
  tokenCost: number;
  enabled: boolean;
  injection: ModuleInjectionRules;
  variants?: Partial<Record<AdapterFamily, string>>;
  version: number;
}

export interface ModelCapabilities {
  thinking: boolean;
  tools: boolean;
  vision: boolean;
  longContext: boolean;
  audio: boolean;
  video: boolean;
  documents: boolean;
  streaming: boolean;
  imageGen: boolean;
  audioGen: boolean;
  videoGen: boolean;
  embedding: boolean;
  codeExecution: boolean;
  grounding: boolean;
}

export interface ComposeContext {
  message: string;
  mode: ContextMode;
  model: string;
  availableTools: any[];
  structuredSummary?: any;  // StructuredSummary from ContextManagerService
  userId: string;
  sessionId: string;
  sliderPosition?: number;
  isAdmin?: boolean;  // Caller can pass this to avoid DB lookup; defaults to DB check
  // Agent-specific: when set, PromptComposer uses these modules instead of auto-selecting domain modules
  agentRole?: string;        // e.g. "reasoning", "data_query"
  agentModules?: string[];   // Explicit module names from agent DB config
  modelFamily?: string;      // Override model family (openai, claude, gemini, local)
}

export interface ComposedPrompt {
  systemPrompt: string;
  modulesUsed: string[];
  tokenCount: number;
  budgetUsed: number;
  budgetRemaining: number;
  modelFamily: AdapterFamily;
  capabilitiesDetected: string[];
}

export interface ModuleScore {
  module: PromptModule;
  score: number;
  breakdown: {
    semantic: number;
    toolRule: number;
    historyBoost: number;
    effectiveness: number;
  };
}
