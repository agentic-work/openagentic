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
 * FlowContextStrategy
 *
 * Simplest compaction strategy for flow mode sessions.
 *
 * Flows are short-lived (bounded execution, not open-ended conversations), so:
 *   - No tool-pair preservation needed
 *   - No rolling compaction
 *   - Just newest-first truncation
 *   - Simple heuristic summary of dropped messages
 */

import { logger } from '../../../utils/logger.js';
import { TokenCounter } from '../TokenCounter.js';
import { CompactionEngine } from '../CompactionEngine.js';
import type { ContextBudget, CompactResult, StructuredSummary } from '../types.js';

const log = logger.child({ component: 'FlowContextStrategy' });

const SUMMARY_RESERVE_TOKENS = 256;

export class FlowContextStrategy {
  private tokenCounter: TokenCounter;
  private compactionEngine: CompactionEngine;

  constructor() {
    this.tokenCounter = new TokenCounter();
    this.compactionEngine = new CompactionEngine();
  }

  /**
   * Compact messages for flow mode using simple newest-first truncation.
   *
   * @param messages       Full conversation history
   * @param budget         Token budget from ContextManagerService
   * @param toolTokenCount Tokens consumed by tool definitions
   * @param existingSummary Previously generated summary
   */
  compact(
    messages: any[],
    budget: ContextBudget,
    toolTokenCount: number,
    existingSummary: StructuredSummary | null
  ): CompactResult {
    // Filter system messages
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const toolSlack = Math.max(0, budget.tools - toolTokenCount);
    const summaryReserve = existingSummary ? SUMMARY_RESERVE_TOKENS : 0;
    const effectiveBudget = budget.history + toolSlack - summaryReserve;

    const totalTokens = this.tokenCounter.countMessages(nonSystemMessages);

    // If within budget, return all messages
    if (totalTokens <= effectiveBudget) {
      const messages = existingSummary
        ? [{ role: 'system', content: `[Context Summary]\n${existingSummary.text}` }, ...nonSystemMessages]
        : nonSystemMessages;

      return {
        messages,
        summary: existingSummary,
        droppedCount: 0,
        tokensFreed: 0,
        budgetUsed: totalTokens + (existingSummary?.tokenCount || 0),
        budgetTotal: budget.history,
      };
    }

    // Simple newest-first truncation (no tool pair preservation)
    const { kept, dropped } = this.selectNewest(nonSystemMessages, effectiveBudget);

    const droppedSummary = dropped.length > 0
      ? this.compactionEngine.generateHeuristicSummary(dropped)
      : null;

    const finalSummary = this.mergeSummaries(droppedSummary, existingSummary);
    const keptTokens = this.tokenCounter.countMessages(kept);
    const tokensFreed = totalTokens - keptTokens;

    log.debug(
      { keptCount: kept.length, droppedCount: dropped.length, tokensFreed },
      'Flow compaction completed'
    );

    const outputMessages = finalSummary
      ? [{ role: 'system', content: `[Context Summary]\n${finalSummary.text}` }, ...kept]
      : kept;

    return {
      messages: outputMessages,
      summary: finalSummary,
      droppedCount: dropped.length,
      tokensFreed,
      budgetUsed: keptTokens + (finalSummary?.tokenCount || 0),
      budgetTotal: budget.history,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private selectNewest(messages: any[], budget: number): { kept: any[]; dropped: any[] } {
    const keptIndices = new Set<number>();
    let tokensSoFar = 0;

    // Work from newest to oldest
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = this.tokenCounter.countMessage(messages[i]);
      if (tokensSoFar + msgTokens <= budget) {
        keptIndices.add(i);
        tokensSoFar += msgTokens;
      } else {
        break; // Stop at first message that doesn't fit
      }
    }

    const kept: any[] = [];
    const dropped: any[] = [];
    messages.forEach((msg, idx) => {
      if (keptIndices.has(idx)) {
        kept.push(msg);
      } else {
        dropped.push(msg);
      }
    });
    return { kept, dropped };
  }

  private mergeSummaries(
    newSummary: StructuredSummary | null,
    existingSummary: StructuredSummary | null
  ): StructuredSummary | null {
    if (!newSummary && !existingSummary) return null;
    if (!newSummary) return existingSummary;
    if (!existingSummary) return newSummary;

    const merged: StructuredSummary = {
      text: [existingSummary.text, newSummary.text].filter(Boolean).join(' '),
      topics: [...new Set([...existingSummary.topics, ...newSummary.topics])],
      toolsUsed: [...new Set([...existingSummary.toolsUsed, ...newSummary.toolsUsed])],
      keyDecisions: [...new Set([...existingSummary.keyDecisions, ...newSummary.keyDecisions])],
      cloudProviders: [...new Set([...existingSummary.cloudProviders, ...newSummary.cloudProviders])],
      artifacts: [...new Set([...existingSummary.artifacts, ...newSummary.artifacts])],
      errorsSeen: [...new Set([...existingSummary.errorsSeen, ...newSummary.errorsSeen])],
      tokenCount: 0,
    };
    merged.tokenCount = this.tokenCounter.estimateTokens(merged.text);
    return merged;
  }
}
