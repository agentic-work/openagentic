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
 * Tests for ChatContextStrategy
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

import { ChatContextStrategy } from '../../services/context/strategies/ChatContextStrategy.js';
import type { ContextBudget } from '../../services/context/types.js';

// Helper to build a simple budget
function makeBudget(history: number, tools = 1000, total = 50000): ContextBudget {
  return {
    totalTokens: total,
    systemPrompt: 2000,
    tools,
    history,
    response: 4000,
    mode: 'chat',
  };
}

// Helper to build messages
function makeUserMsg(content: string) {
  return { role: 'user', content };
}
function makeAssistantMsg(content: string) {
  return { role: 'assistant', content };
}
function makeAssistantWithTools(content: string, toolCallId: string, toolName: string) {
  return {
    role: 'assistant',
    content,
    tool_calls: [
      {
        id: toolCallId,
        type: 'function',
        function: { name: toolName, arguments: '{}' },
      },
    ],
  };
}
function makeToolResult(toolCallId: string, result: string) {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: result,
    name: 'some_tool',
  };
}

describe('ChatContextStrategy', () => {
  let strategy: ChatContextStrategy;

  beforeEach(() => {
    strategy = new ChatContextStrategy();
  });

  describe('compact - all messages fit', () => {
    it('returns all messages unchanged when within budget', () => {
      const messages = [
        makeUserMsg('Hello'),
        makeAssistantMsg('Hi there'),
        makeUserMsg('How are you?'),
        makeAssistantMsg('I am fine'),
      ];

      // Very large budget — all messages fit
      const budget = makeBudget(100000);
      const result = strategy.compact(messages, budget, 0, null);

      expect(result.droppedCount).toBe(0);
      expect(result.tokensFreed).toBe(0);
      // No system messages in input, and no summary, so output equals input
      expect(result.messages).toHaveLength(4);
    });

    it('filters out system messages from input', () => {
      const messages = [
        { role: 'system', content: 'You are helpful.' },
        makeUserMsg('Hello'),
        makeAssistantMsg('Hi'),
      ];

      const budget = makeBudget(100000);
      const result = strategy.compact(messages, budget, 0, null);

      // System message should be filtered out
      expect(result.messages.every((m: any) => m.role !== 'system')).toBe(true);
      expect(result.messages).toHaveLength(2);
    });

    it('prepends existing summary as system message when all fit', () => {
      const messages = [
        makeUserMsg('Hello'),
        makeAssistantMsg('Hi'),
      ];

      const existingSummary = {
        text: 'Previous session covered deployment.',
        topics: ['deployment'],
        toolsUsed: [],
        keyDecisions: [],
        cloudProviders: [],
        artifacts: [],
        errorsSeen: [],
        tokenCount: 20,
      };

      const budget = makeBudget(100000);
      const result = strategy.compact(messages, budget, 0, existingSummary);

      // First message should be the summary
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toContain('Previous session covered deployment.');
      expect(result.messages).toHaveLength(3); // summary + 2 original
    });
  });

  describe('compact - over budget, oldest dropped', () => {
    it('drops oldest messages when over budget', () => {
      // Create many messages that won't fit in a small budget
      const messages: any[] = [];
      for (let i = 0; i < 20; i++) {
        messages.push(makeUserMsg(`User message number ${i} with some content to use tokens`));
        messages.push(makeAssistantMsg(`Assistant reply ${i} with detailed explanation`));
      }

      // Small budget — only fit last few messages.
      // Pass toolTokenCount = budget.tools to eliminate tool slack.
      const budget = makeBudget(200);
      const result = strategy.compact(messages, budget, budget.tools, null);

      expect(result.droppedCount).toBeGreaterThan(0);
      expect(result.tokensFreed).toBeGreaterThan(0);

      // Newest messages should be kept (last ones in original array)
      const lastOriginalMsg = messages[messages.length - 1];
      const keptContents = result.messages.map((m: any) => m.content);
      expect(keptContents).toContain(lastOriginalMsg.content);
    });

    it('generates a summary when messages are dropped', () => {
      const messages: any[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push(makeUserMsg(`Message ${i} check AWS costs`));
        messages.push(makeAssistantMsg(`Reply ${i}`));
      }

      const budget = makeBudget(150);
      const result = strategy.compact(messages, budget, budget.tools, null);

      expect(result.droppedCount).toBeGreaterThan(0);
      // Summary should be generated
      expect(result.summary).not.toBeNull();
      expect(result.summary?.text.length).toBeGreaterThan(0);
      // Summary injected as first system message
      expect(result.messages[0].role).toBe('system');
    });

    it('merges new dropped summary with existing summary', () => {
      const messages: any[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push(makeUserMsg(`Deploy k8s cluster ${i}`));
        messages.push(makeAssistantMsg(`Done ${i}`));
      }

      const existingSummary = {
        text: 'Earlier: checked AWS billing.',
        topics: ['cost-management'],
        toolsUsed: ['aws_get_costs'],
        keyDecisions: [],
        cloudProviders: ['AWS'],
        artifacts: [],
        errorsSeen: [],
        tokenCount: 20,
      };

      const budget = makeBudget(150);
      const result = strategy.compact(messages, budget, budget.tools, existingSummary);

      expect(result.summary).not.toBeNull();
      // Merged summary should contain both old and new text
      expect(result.summary?.text).toContain('Earlier: checked AWS billing.');
    });
  });

  describe('compact - tool pair preservation', () => {
    it('keeps tool_result when its corresponding assistant tool_call is kept', () => {
      // Build messages where only the last tool call pair fits
      const oldMessages = [
        makeUserMsg('Old question 1'),
        makeAssistantMsg('Old reply 1'),
        makeUserMsg('Old question 2'),
        makeAssistantMsg('Old reply 2'),
      ];

      const newPair = [
        makeUserMsg('Deploy now'),
        makeAssistantWithTools('Running tool', 'call-123', 'k8s_apply'),
        makeToolResult('call-123', 'Applied successfully'),
      ];

      const messages = [...oldMessages, ...newPair];

      // Budget sized to only fit the last 3 messages (roughly)
      // Each message is ~10-20 tokens; set budget to ~100
      const budget = makeBudget(100);
      const result = strategy.compact(messages, budget, 0, null);

      // The tool result for call-123 should be present if its call is present
      const contents = result.messages.map((m: any) => m.content);
      const hasToolCall = result.messages.some(
        (m: any) => (m.tool_calls || []).some((tc: any) => tc.id === 'call-123')
      );
      const hasToolResult = result.messages.some(
        (m: any) => m.role === 'tool' && m.tool_call_id === 'call-123'
      );

      // If tool call is present, tool result must also be present
      if (hasToolCall) {
        expect(hasToolResult).toBe(true);
      }
    });
  });

  describe('compact - budgetUsed and budgetTotal', () => {
    it('reports correct budget metrics', () => {
      const messages = [
        makeUserMsg('Hello'),
        makeAssistantMsg('Hi'),
      ];
      const budget = makeBudget(100000);
      const result = strategy.compact(messages, budget, 0, null);

      expect(result.budgetTotal).toBe(budget.history);
      expect(result.budgetUsed).toBeGreaterThan(0);
      expect(result.budgetUsed).toBeLessThanOrEqual(result.budgetTotal);
    });
  });
});
