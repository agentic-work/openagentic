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

export type ContextMode = 'chat' | 'code' | 'flow';

export interface ContextBudget {
  totalTokens: number;
  systemPrompt: number;
  tools: number;
  history: number;
  response: number;
  mode: ContextMode;
}

export interface StructuredSummary {
  text: string;
  topics: string[];
  toolsUsed: string[];
  keyDecisions: string[];
  cloudProviders: string[];
  artifacts: string[];
  errorsSeen: string[];
  tokenCount: number;
}

export interface CompactResult {
  messages: any[];
  summary: StructuredSummary | null;
  droppedCount: number;
  tokensFreed: number;
  budgetUsed: number;
  budgetTotal: number;
}

export interface BudgetConfig {
  systemPromptPct: number;
  systemPromptCap: number;
  toolsPct: number;
  toolsCap: number;
  historyPct: number;
  responsePct: number;
  responseCap: number;
  compactionThresholdPct: number;
  rollingCompactionInterval?: number;
}

export interface ContextManagerConfig {
  enabled: boolean;
  compactionModel: string | null;
  inlineLLMCompaction: boolean;
  backgroundCompactionDelayMinutes: number;
  compactionLogRetentionDays: number;
  budgets: Record<ContextMode, BudgetConfig>;
}

export interface CompactionLogEntry {
  sessionId: string;
  model: string;
  mode: ContextMode;
  level: 'light' | 'medium' | 'aggressive';
  messagesDropped: number;
  tokensFreed: number;
  summaryType: 'heuristic' | 'llm';
  summaryTokens: number;
  budgetTotal: number;
  budgetUsed: number;
  modelSwitched: boolean;
  previousModel?: string;
}
