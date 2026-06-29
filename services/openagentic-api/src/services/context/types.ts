export type ContextMode = 'chat' | 'flow';

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
