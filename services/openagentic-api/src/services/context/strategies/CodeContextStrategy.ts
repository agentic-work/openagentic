/**
 * CodeContextStrategy
 *
 * Compaction strategy for code mode sessions.
 *
 * Same interface as ChatContextStrategy but with rolling compaction:
 *   - If messages > rollingInterval AND over budget: summarize in chunks, keep last chunk.
 *   - Otherwise: same newest-first selection as chat.
 *
 * Rolling compaction is designed for long-running code sessions where there are
 * many tool invocations and the conversation grows unboundedly.
 */

import { logger } from '../../../utils/logger.js';
import { TokenCounter } from '../TokenCounter.js';
import { CompactionEngine } from '../CompactionEngine.js';
import type { ContextBudget, CompactResult, StructuredSummary } from '../types.js';

const log = logger.child({ component: 'CodeContextStrategy' });

const DEFAULT_ROLLING_INTERVAL = 50;
const SUMMARY_RESERVE_TOKENS = 512;

export class CodeContextStrategy {
  private tokenCounter: TokenCounter;
  private compactionEngine: CompactionEngine;

  constructor() {
    this.tokenCounter = new TokenCounter();
    this.compactionEngine = new CompactionEngine();
  }

  /**
   * Compact messages for code mode.
   *
   * @param messages       Full conversation history (system messages are filtered)
   * @param budget         Token budget from ContextManagerService
   * @param toolTokenCount Tokens consumed by tool definitions
   * @param existingSummary Previously generated summary
   * @param rollingInterval Override for rolling interval (default 50)
   */
  compact(
    messages: any[],
    budget: ContextBudget,
    toolTokenCount: number,
    existingSummary: StructuredSummary | null,
    rollingInterval?: number
  ): CompactResult {
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    const interval = rollingInterval ?? (budget as any).rollingInterval ?? DEFAULT_ROLLING_INTERVAL;

    const toolSlack = Math.max(0, budget.tools - toolTokenCount);
    const summaryReserve = existingSummary ? SUMMARY_RESERVE_TOKENS : 0;
    const effectiveBudget = budget.history + toolSlack - summaryReserve;

    const totalTokens = this.tokenCounter.countMessages(nonSystemMessages);

    // If within budget, return all messages
    if (totalTokens <= effectiveBudget) {
      return this.buildResult(nonSystemMessages, [], existingSummary, totalTokens, budget, 0);
    }

    // Rolling compaction: if message count > rollingInterval, do chunk-based summarization
    if (nonSystemMessages.length > interval) {
      return this.rollingCompact(nonSystemMessages, effectiveBudget, interval, existingSummary, budget);
    }

    // Otherwise fall back to newest-first selection (same as chat)
    return this.newestFirstCompact(nonSystemMessages, effectiveBudget, existingSummary, budget);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Rolling compaction: split messages into chunks of rollingInterval size,
   * summarize all but the last chunk, keep last chunk.
   */
  private rollingCompact(
    messages: any[],
    effectiveBudget: number,
    interval: number,
    existingSummary: StructuredSummary | null,
    budget: ContextBudget
  ): CompactResult {
    // Keep the last `interval` messages
    const lastChunkStart = Math.max(0, messages.length - interval);
    const olderMessages = messages.slice(0, lastChunkStart);
    const lastChunk = messages.slice(lastChunkStart);

    // Summarize older messages
    const olderSummary = olderMessages.length > 0
      ? this.compactionEngine.generateHeuristicSummary(olderMessages)
      : null;

    // Merge with existing summary
    const mergedSummary = this.mergeSummaries(olderSummary, existingSummary);

    // Check if last chunk fits within budget
    const chunkTokens = this.tokenCounter.countMessages(lastChunk);
    let finalMessages = lastChunk;
    let dropped = olderMessages;

    if (chunkTokens > effectiveBudget) {
      // Even last chunk doesn't fit — apply newest-first within it
      const { kept, dropped: chunkDropped } = this.selectNewest(lastChunk, effectiveBudget);
      finalMessages = kept;
      dropped = [...olderMessages, ...chunkDropped];
    }

    const keptTokens = this.tokenCounter.countMessages(finalMessages);
    const tokensFreed = this.tokenCounter.countMessages(messages) - keptTokens;

    log.debug(
      {
        olderCount: olderMessages.length,
        keptCount: finalMessages.length,
        droppedCount: dropped.length,
        tokensFreed,
      },
      'Rolling compaction completed'
    );

    return this.buildResult(finalMessages, dropped, mergedSummary, keptTokens, budget, tokensFreed);
  }

  /**
   * Newest-first selection (same algorithm as ChatContextStrategy).
   */
  private newestFirstCompact(
    messages: any[],
    effectiveBudget: number,
    existingSummary: StructuredSummary | null,
    budget: ContextBudget
  ): CompactResult {
    const { kept, dropped } = this.selectNewest(messages, effectiveBudget);

    const droppedSummary = dropped.length > 0
      ? this.compactionEngine.generateHeuristicSummary(dropped)
      : null;

    const finalSummary = this.mergeSummaries(droppedSummary, existingSummary);
    const keptTokens = this.tokenCounter.countMessages(kept);
    const totalTokens = this.tokenCounter.countMessages(messages);
    const tokensFreed = totalTokens - keptTokens;

    return this.buildResult(kept, dropped, finalSummary, keptTokens, budget, tokensFreed);
  }

  private selectNewest(messages: any[], budget: number): { kept: any[]; dropped: any[] } {
    // Build tool result index for pair preservation
    const toolResultIndex = new Map<string, number>();
    messages.forEach((msg, idx) => {
      if (msg.role === 'tool' && msg.tool_call_id) {
        toolResultIndex.set(msg.tool_call_id, idx);
      }
    });

    const keptIndices = new Set<number>();
    let tokensSoFar = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.tokenCounter.countMessage(msg);
      const toolCalls = msg.toolCalls || msg.tool_calls || [];
      const pairedResultIndices: number[] = [];
      for (const call of toolCalls) {
        const callId = call.id || call.tool_call_id;
        if (callId && toolResultIndex.has(callId)) {
          pairedResultIndices.push(toolResultIndex.get(callId)!);
        }
      }

      let pairTokens = msgTokens;
      for (const pairIdx of pairedResultIndices) {
        if (!keptIndices.has(pairIdx)) {
          pairTokens += this.tokenCounter.countMessage(messages[pairIdx]);
        }
      }

      if (tokensSoFar + pairTokens <= budget) {
        keptIndices.add(i);
        tokensSoFar += msgTokens;
        for (const pairIdx of pairedResultIndices) {
          if (!keptIndices.has(pairIdx)) {
            keptIndices.add(pairIdx);
            tokensSoFar += this.tokenCounter.countMessage(messages[pairIdx]);
          }
        }
      } else {
        break;
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

  private buildResult(
    kept: any[],
    dropped: any[],
    summary: StructuredSummary | null,
    keptTokens: number,
    budget: ContextBudget,
    tokensFreed: number
  ): CompactResult {
    const messages = summary
      ? [{ role: 'system', content: `[Context Summary]\n${summary.text}` }, ...kept]
      : kept;

    return {
      messages,
      summary,
      droppedCount: dropped.length,
      tokensFreed,
      budgetUsed: keptTokens + (summary?.tokenCount || 0),
      budgetTotal: budget.history,
    };
  }
}
