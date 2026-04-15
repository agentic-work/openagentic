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
 * ContextManagerService
 *
 * Singleton service that calculates token budgets per mode (chat/code/flow).
 * Gets context window from ModelConfigurationService, falls back to model-catalogs,
 * then defaults to 32K. Applies allocation caps and redistributes slack to history.
 */

import { getContextWindow } from '../../config/model-catalogs.js';
import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { logger } from '../../utils/logger.js';
import { TokenCounter } from './TokenCounter.js';
import { CompactionEngine } from './CompactionEngine.js';
import { ChatContextStrategy } from './strategies/ChatContextStrategy.js';
import { CodeContextStrategy } from './strategies/CodeContextStrategy.js';
import { FlowContextStrategy } from './strategies/FlowContextStrategy.js';
import type {
  ContextMode,
  ContextBudget,
  BudgetConfig,
  ContextManagerConfig,
  StructuredSummary,
  CompactResult,
  CompactionLogEntry,
} from './types.js';

// Default context window when all lookups fail
const FALLBACK_CONTEXT_WINDOW = 32768;

// Budget configurations per mode
const DEFAULT_BUDGET_CONFIGS: Record<ContextMode, BudgetConfig> = {
  chat: {
    systemPromptPct: 0.15,
    systemPromptCap: 8192,
    toolsPct: 0.15,
    toolsCap: 10240,
    historyPct: 0.50,
    responsePct: 0.20,
    responseCap: 16384,
    compactionThresholdPct: 0.85,
  },
  code: {
    systemPromptPct: 0.10,
    systemPromptCap: 4096,
    toolsPct: 0.05,
    toolsCap: 5120,
    historyPct: 0.65,
    responsePct: 0.20,
    responseCap: 16384,
    compactionThresholdPct: 0.80,
    rollingCompactionInterval: 50,
  },
  flow: {
    systemPromptPct: 0.10,
    systemPromptCap: 4096,
    toolsPct: 0.10,
    toolsCap: 8192,
    historyPct: 0.55,
    responsePct: 0.25,
    responseCap: 32768,
    compactionThresholdPct: 0.85,
  },
};

const DEFAULT_CONFIG: ContextManagerConfig = {
  enabled: true,
  compactionModel: null,
  inlineLLMCompaction: false,
  backgroundCompactionDelayMinutes: 5,
  compactionLogRetentionDays: 30,
  budgets: DEFAULT_BUDGET_CONFIGS,
};

const log = logger.child({ component: 'ContextManagerService' });

class ContextManagerServiceClass {
  private static instance: ContextManagerServiceClass;
  private tokenCounter: TokenCounter;
  private config: ContextManagerConfig;
  private overrides: Partial<Record<ContextMode, Partial<BudgetConfig>>> = {};
  private compactionEngine: CompactionEngine;
  private chatStrategy: ChatContextStrategy;
  private codeStrategy: CodeContextStrategy | null = null;
  private flowStrategy: FlowContextStrategy;

  private constructor() {
    this.tokenCounter = new TokenCounter();
    this.config = { ...DEFAULT_CONFIG, budgets: { ...DEFAULT_BUDGET_CONFIGS } };
    this.compactionEngine = new CompactionEngine();
    this.chatStrategy = new ChatContextStrategy();
    this.flowStrategy = new FlowContextStrategy();
  }

  static getInstance(): ContextManagerServiceClass {
    if (!ContextManagerServiceClass.instance) {
      ContextManagerServiceClass.instance = new ContextManagerServiceClass();
    }
    return ContextManagerServiceClass.instance;
  }

  /**
   * Override budget config for a specific mode (useful for testing or admin config)
   */
  setBudgetOverrides(mode: ContextMode, overrides: Partial<BudgetConfig>): void {
    this.overrides[mode] = { ...this.overrides[mode], ...overrides };
    log.debug({ mode, overrides }, 'Budget overrides set');
  }

  /**
   * Get the TokenCounter instance
   */
  getTokenCounter(): TokenCounter {
    return this.tokenCounter;
  }

  /**
   * Get the full ContextManagerConfig
   */
  getConfig(): ContextManagerConfig {
    return this.config;
  }

  /**
   * Calculate a ContextBudget for the given model and mode.
   *
   * Resolution order for context window:
   *   1. ModelConfigurationService (DB) — contextWindow on ModelAssignment
   *   2. model-catalogs.ts getContextWindow()
   *   3. FALLBACK_CONTEXT_WINDOW (32K)
   */
  async getBudget(modelId: string, mode: ContextMode): Promise<ContextBudget> {
    const contextWindow = await this.resolveContextWindow(modelId);
    const budgetCfg = this.getMergedBudgetConfig(mode);
    return this.calculateBudget(contextWindow, mode, budgetCfg, modelId);
  }

  // ---------------------------------------------------------------------------
  // Compaction public API
  // ---------------------------------------------------------------------------

  private getCodeStrategy(): CodeContextStrategy {
    if (!this.codeStrategy) {
      this.codeStrategy = new CodeContextStrategy();
    }
    return this.codeStrategy;
  }

  private getCodeRollingInterval(): number {
    const config = this.getMergedBudgetConfig('code');
    return config.rollingCompactionInterval || 50;
  }

  async compact(
    messages: any[],
    sessionId: string,
    model: string,
    mode: ContextMode,
    toolTokenCount: number = 0,
    existingSummary?: StructuredSummary,
  ): Promise<CompactResult> {
    const budget = await this.getBudget(model, mode);

    let result: CompactResult;
    switch (mode) {
      case 'code':
        result = await this.getCodeStrategy().compact(messages, budget, toolTokenCount, existingSummary || null, this.getCodeRollingInterval());
        break;
      case 'flow':
        result = await this.flowStrategy.compact(messages, budget, toolTokenCount, existingSummary || null);
        break;
      case 'chat':
      default:
        result = await this.chatStrategy.compact(messages, budget, toolTokenCount, existingSummary || null);
        break;
    }

    // Log compaction event to DB + console
    if (result.droppedCount > 0) {
      const level = result.droppedCount > 20 ? 'aggressive' : result.droppedCount > 5 ? 'medium' : 'light';
      logger.info({
        sessionId, model, mode, level,
        droppedCount: result.droppedCount,
        tokensFreed: result.tokensFreed,
        budgetUsed: result.budgetUsed,
        budgetTotal: result.budgetTotal,
      }, '[CONTEXT-MGR] Compaction executed');

      this.logCompaction({
        sessionId, model, mode, level,
        messagesDropped: result.droppedCount,
        tokensFreed: result.tokensFreed,
        summaryType: 'heuristic',
        summaryTokens: result.summary?.tokenCount || 0,
        budgetTotal: result.budgetTotal,
        budgetUsed: result.budgetUsed,
        modelSwitched: false,
        previousModel: undefined,
      });
    }

    return result;
  }

  async getSummary(sessionId: string): Promise<StructuredSummary | null> {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const session = await (prisma as any).chatSession.findUnique({
        where: { id: sessionId },
        select: { structured_summary: true, summary: true },
      });
      if (session?.structured_summary) {
        return session.structured_summary as StructuredSummary;
      }
      if (session?.summary) {
        return { text: session.summary, topics: [], toolsUsed: [], keyDecisions: [], cloudProviders: [], artifacts: [], errorsSeen: [], tokenCount: this.tokenCounter.estimateTokens(session.summary) };
      }
      return null;
    } catch (err: any) {
      logger.warn({ sessionId, error: err.message }, '[CONTEXT-MGR] Failed to load summary');
      return null;
    }
  }

  async getCompactionMetrics(timeRange?: { start: Date; end: Date }): Promise<any> {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      const where: any = {};
      if (timeRange) {
        where.created_at = { gte: timeRange.start, lte: timeRange.end };
      }
      const logs = await (prisma as any).compactionLog.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
      const totalCompactions = logs.length;
      const totalTokensFreed = logs.reduce((sum: number, l: any) => sum + l.tokens_freed, 0);
      const modelSwitches = logs.filter((l: any) => l.model_switched).length;
      const byMode: Record<string, number> = { chat: 0, code: 0, flow: 0 };
      for (const l of logs) { byMode[l.mode] = (byMode[l.mode] || 0) + 1; }
      return { totalCompactions, totalTokensFreed, modelSwitches, byMode, recentLogs: logs.slice(0, 20) };
    } catch (err: any) {
      logger.warn({ error: err.message }, '[CONTEXT-MGR] Failed to get metrics');
      return { totalCompactions: 0, totalTokensFreed: 0, modelSwitches: 0, byMode: {}, recentLogs: [] };
    }
  }

  getCompactionEngine(): CompactionEngine {
    return this.compactionEngine;
  }

  private async logCompaction(entry: CompactionLogEntry): Promise<void> {
    try {
      const { prisma } = await import('../../utils/prisma.js');
      await (prisma as any).compactionLog.create({
        data: {
          session_id: entry.sessionId,
          model: entry.model,
          mode: entry.mode,
          level: entry.level,
          messages_dropped: entry.messagesDropped,
          tokens_freed: entry.tokensFreed,
          summary_type: entry.summaryType,
          summary_tokens: entry.summaryTokens,
          budget_total: entry.budgetTotal,
          budget_used: entry.budgetUsed,
          model_switched: entry.modelSwitched,
          previous_model: entry.previousModel || null,
        },
      });
    } catch (err: any) {
      logger.warn({ error: err.message }, '[CONTEXT-MGR] Failed to log compaction (non-fatal)');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async resolveContextWindow(modelId: string): Promise<number> {
    // 1. Try ModelConfigurationService (DB)
    try {
      const cfg = await ModelConfigurationService.getConfig();
      // Search all available models for a contextWindow match
      const match = cfg.availableModels.find(
        (m) => m.modelId === modelId || modelId.includes(m.modelId) || m.modelId.includes(modelId)
      );
      if (match && match.contextWindow && match.contextWindow > 0) {
        log.debug({ modelId, contextWindow: match.contextWindow, source: 'db' }, 'Context window resolved from DB');
        return match.contextWindow;
      }
    } catch (err) {
      log.debug({ modelId, err }, 'ModelConfigurationService lookup failed, falling back to catalogs');
    }

    // 2. Try model-catalogs.ts
    const catalogWindow = getContextWindow(modelId);
    // getContextWindow returns DEFAULT_CONTEXT_WINDOW (100K) for unknowns,
    // but that is still a valid catalog lookup result — use it only if > 0
    if (catalogWindow && catalogWindow > 0) {
      log.debug({ modelId, contextWindow: catalogWindow, source: 'catalogs' }, 'Context window resolved from catalogs');
      return catalogWindow;
    }

    // 3. Hard fallback
    log.debug({ modelId, contextWindow: FALLBACK_CONTEXT_WINDOW, source: 'fallback' }, 'Context window fallback');
    return FALLBACK_CONTEXT_WINDOW;
  }

  private getMergedBudgetConfig(mode: ContextMode): BudgetConfig {
    const base = DEFAULT_BUDGET_CONFIGS[mode];
    const override = this.overrides[mode] || {};
    return { ...base, ...override };
  }

  private calculateBudget(
    contextWindow: number,
    mode: ContextMode,
    cfg: BudgetConfig,
    modelId: string
  ): ContextBudget {
    // Step 1: Apply caps to fixed-size allocations
    const systemPrompt = Math.min(Math.floor(contextWindow * cfg.systemPromptPct), cfg.systemPromptCap);
    const tools = Math.min(Math.floor(contextWindow * cfg.toolsPct), cfg.toolsCap);

    // Step 2: Calculate base response allocation
    let baseResponse = Math.min(Math.floor(contextWindow * cfg.responsePct), cfg.responseCap);

    // Extended thinking: Claude models get double the response cap, taken from history
    const isClaudeModel = /claude|sonnet|opus/i.test(modelId);
    let response = baseResponse;
    if (isClaudeModel) {
      // Double the cap for extended thinking budget; cap at double the config cap
      const extendedCap = cfg.responseCap * 2;
      response = Math.min(baseResponse * 2, extendedCap);
      // Ensure we don't exceed contextWindow when combined with other fixed allocations
      response = Math.min(response, Math.max(0, contextWindow - systemPrompt - tools));
    }

    // Step 3: History is whatever is left after fixed allocations
    // This naturally redistributes any cap-savings (slack) to history
    const history = Math.max(0, contextWindow - systemPrompt - tools - response);

    log.debug(
      { modelId, mode, contextWindow, systemPrompt, tools, history, response, isClaudeModel },
      'Budget calculated'
    );

    return {
      totalTokens: contextWindow,
      systemPrompt,
      tools,
      history,
      response,
      mode,
    };
  }
}

// Export singleton accessor (matches ModelConfigurationService pattern)
export const ContextManagerService = ContextManagerServiceClass;
export type { ContextBudget, ContextMode };
