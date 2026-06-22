/**
 * ChatContextStrategy
 *
 * Core compaction strategy for chat mode (medium sessions).
 *
 * Algorithm:
 *   1. Filter out system messages (they're counted separately).
 *   2. Calculate effective budget (history + tool slack - summary reserve).
 *   3. If all messages fit → return as-is (prepend existing summary if present).
 *   4. If over budget → select newest messages working backwards.
 *   5. Preserve tool_call / tool_result pairs.
 *   6. Generate heuristic summary of dropped messages.
 *   7. Merge with existing summary if present.
 */

import { logger } from '../../../utils/logger.js';
import { TokenCounter } from '../TokenCounter.js';
import { CompactionEngine } from '../CompactionEngine.js';
import type { ContextBudget, CompactResult, StructuredSummary } from '../types.js';

const log = logger.child({ component: 'ChatContextStrategy' });

// Reserve some of the history budget for the injected summary message
const SUMMARY_RESERVE_TOKENS = 512;

export class ChatContextStrategy {
  private tokenCounter: TokenCounter;
  private compactionEngine: CompactionEngine;

  constructor() {
    this.tokenCounter = new TokenCounter();
    this.compactionEngine = new CompactionEngine();
  }

  /**
   * Compact messages to fit within the history budget.
   *
   * @param messages       Full conversation history (may include system messages — they are filtered out)
   * @param budget         Token budget from ContextManagerService
   * @param toolTokenCount Tokens already consumed by tool definitions (reduces available history)
   * @param existingSummary Previously generated summary (if session was compacted before)
   */
  compact(
    messages: any[],
    budget: ContextBudget,
    toolTokenCount: number,
    existingSummary: StructuredSummary | null
  ): CompactResult {
    // 1. Filter system messages
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // 2. Calculate effective budget
    const toolSlack = Math.max(0, budget.tools - toolTokenCount);
    const summaryReserve = existingSummary ? SUMMARY_RESERVE_TOKENS : 0;
    const effectiveBudget = budget.history + toolSlack - summaryReserve;

    // Count tokens for all non-system messages
    const totalTokens = this.tokenCounter.countMessages(nonSystemMessages);

    // 3. If within budget, return all messages
    if (totalTokens <= effectiveBudget) {
      const result = this.buildResult(
        nonSystemMessages,
        [],
        existingSummary,
        totalTokens,
        budget,
        0
      );
      log.debug(
        { messagesKept: nonSystemMessages.length, totalTokens, effectiveBudget },
        'All messages fit within budget'
      );
      return result;
    }

    // 4. Select messages from newest backwards, preserving tool pairs
    const { kept, dropped } = this.selectNewestMessages(nonSystemMessages, effectiveBudget);

    // 5. Generate summary of dropped messages
    const droppedSummary =
      dropped.length > 0
        ? this.compactionEngine.generateHeuristicSummary(dropped)
        : null;

    // 6. Merge with existing summary
    const finalSummary = this.mergeSummaries(droppedSummary, existingSummary);

    const keptTokens = this.tokenCounter.countMessages(kept);
    const tokensFreed = totalTokens - keptTokens;

    log.debug(
      {
        messagesKept: kept.length,
        messagesDropped: dropped.length,
        tokensFreed,
        keptTokens,
        effectiveBudget,
      },
      'Compaction completed'
    );

    return this.buildResult(kept, dropped, finalSummary, keptTokens, budget, tokensFreed);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Select messages from newest (end) backwards until budget is exhausted.
   * Preserves tool_call/tool_result pairs: if an assistant message with toolCalls
   * is kept, the corresponding tool result(s) must also be kept.
   */
  private selectNewestMessages(
    messages: any[],
    budget: number
  ): { kept: any[]; dropped: any[] } {
    // Build a map: tool_call_id → index of the tool result message
    const toolResultIndex = new Map<string, number>();
    messages.forEach((msg, idx) => {
      if (msg.role === 'tool' && msg.tool_call_id) {
        toolResultIndex.set(msg.tool_call_id, idx);
      }
    });

    // Work backwards, tracking what to keep
    const keptIndices = new Set<number>();
    let tokensSoFar = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.tokenCounter.countMessage(msg);

      // If this message has tool calls, check if its paired tool results fit too
      const pairedResultIndices: number[] = [];
      const toolCalls = msg.toolCalls || msg.tool_calls || [];
      for (const call of toolCalls) {
        const callId = call.id || call.tool_call_id;
        if (callId && toolResultIndex.has(callId)) {
          pairedResultIndices.push(toolResultIndex.get(callId)!);
        }
      }

      // Calculate cost including required pairs
      let pairTokens = msgTokens;
      for (const pairIdx of pairedResultIndices) {
        if (!keptIndices.has(pairIdx)) {
          pairTokens += this.tokenCounter.countMessage(messages[pairIdx]);
        }
      }

      if (tokensSoFar + pairTokens <= budget) {
        keptIndices.add(i);
        tokensSoFar += msgTokens;
        // Also keep paired tool results
        for (const pairIdx of pairedResultIndices) {
          if (!keptIndices.has(pairIdx)) {
            keptIndices.add(pairIdx);
            tokensSoFar += this.tokenCounter.countMessage(messages[pairIdx]);
          }
        }
      }
      // If it doesn't fit, stop adding (oldest messages are dropped)
      // Note: we continue scanning to try adding pairs, but fundamentally
      // once we can't fit the current message we stop adding older ones.
      else {
        // Stop at the first message that doesn't fit when going backwards
        break;
      }
    }

    // Reconstruct in original order
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

    // Merge arrays, deduplicate
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
    // Prepend summary as a system message if present
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
