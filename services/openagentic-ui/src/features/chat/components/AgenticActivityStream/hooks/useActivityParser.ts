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
 * useActivityParser - Parse Streaming Content into Activity Sections
 *
 * Transforms raw streaming events into structured activity data:
 * - Parses thinking content into sections
 * - Tracks tool calls and their states
 * - Manages task/todo list updates
 * - Generates response summary
 */

import { useMemo, useCallback } from 'react';
import type {
  ContentBlock,
  ParsedActivity,
  ActivitySection,
  AgenticTask,
  ToolCall,
  ResponseSummary,
  SuggestedAction,
} from '../types/activity.types';

// Section header patterns
const SECTION_PATTERNS = [
  { pattern: /^(?:Step\s+\d+[\.:]\s*)(.+)/i, type: 'planning' as const },
  { pattern: /^(?:First|Second|Third|Next|Finally|Now)[\s,](.+)/i, type: 'planning' as const },
  { pattern: /^(?:Analyzing|Understanding|Reviewing|Checking|Examining)\s+(.+)/i, type: 'analysis' as const },
  { pattern: /^(?:Let me|I'll|I need to|I should|I will)\s+(.+)/i, type: 'thinking' as const },
  { pattern: /^(?:Looking at|Considering|Thinking about)\s+(.+)/i, type: 'thinking' as const },
  { pattern: /^##?\s+(.+)/, type: 'thinking' as const },
];

// Filler/repetitive content patterns
const FILLER_PATTERNS = [
  /^(?:Finalizing|Wrapping up|Finishing|Completing)/i,
  /^(?:Preparing|Getting ready|Almost done)/i,
  /^(?:Just a moment|One moment|Please wait)/i,
];

interface UseActivityParserOptions {
  autoCollapseRepetitive?: boolean;
  maxVisibleSections?: number;
}

interface UseActivityParserReturn {
  parsedActivity: ParsedActivity;
  parseThinkingContent: (content: string) => ActivitySection[];
  generateSummary: (content: string, tasks: AgenticTask[]) => ResponseSummary;
  detectRepetition: (sections: ActivitySection[]) => ActivitySection[];
}

/**
 * Parse thinking content into structured sections
 */
function parseThinkingContent(content: string): ActivitySection[] {
  const lines = content.split('\n').filter(line => line.trim());
  const sections: ActivitySection[] = [];
  let currentSection: ActivitySection | null = null;
  const seenContent = new Map<string, number>();

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check for section header
    let isHeader = false;
    let sectionType: 'thinking' | 'analysis' | 'planning' | 'executing' = 'thinking';

    for (const { pattern, type } of SECTION_PATTERNS) {
      if (pattern.test(trimmedLine)) {
        isHeader = true;
        sectionType = type;
        break;
      }
    }

    // Check for filler content
    const isFiller = FILLER_PATTERNS.some(pattern => pattern.test(trimmedLine));

    // Track repetition
    const normalizedLine = trimmedLine.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const existingCount = seenContent.get(normalizedLine) || 0;
    seenContent.set(normalizedLine, existingCount + 1);

    if (isHeader) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        id: `section-${sections.length}`,
        title: trimmedLine,
        content: '',
        type: sectionType,
        isCollapsed: false,
        isRepetitive: isFiller || existingCount > 0,
        repetitionCount: existingCount + 1,
        timestamp: Date.now(),
      };
    } else if (currentSection) {
      currentSection.content += (currentSection.content ? '\n' : '') + trimmedLine;
      if (existingCount > 0) {
        currentSection.isRepetitive = true;
        currentSection.repetitionCount = Math.max(
          currentSection.repetitionCount || 1,
          existingCount + 1
        );
      }
    } else {
      // Create generic section
      currentSection = {
        id: `section-${sections.length}`,
        title: 'Thinking',
        content: trimmedLine,
        type: 'thinking',
        isCollapsed: false,
        isRepetitive: isFiller || existingCount > 0,
        repetitionCount: existingCount + 1,
        timestamp: Date.now(),
      };
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Detect and mark repetitive sections
 */
function detectRepetition(sections: ActivitySection[]): ActivitySection[] {
  const titleCounts = new Map<string, number>();

  // Count occurrences of similar titles
  for (const section of sections) {
    const normalizedTitle = section.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    titleCounts.set(normalizedTitle, (titleCounts.get(normalizedTitle) || 0) + 1);
  }

  // Mark repetitive sections
  return sections.map(section => {
    const normalizedTitle = section.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const count = titleCounts.get(normalizedTitle) || 1;

    return {
      ...section,
      isRepetitive: section.isRepetitive || count > 1,
      repetitionCount: Math.max(section.repetitionCount || 1, count),
    };
  });
}

/**
 * Generate suggested actions based on content
 */
function generateSuggestedActions(content: string, tasks: AgenticTask[]): SuggestedAction[] {
  const actions: SuggestedAction[] = [];

  // Check for common patterns and suggest actions
  const contentLower = content.toLowerCase();

  // Cost analysis suggestions
  if (contentLower.includes('cost') || contentLower.includes('spending')) {
    actions.push({
      id: 'drill-costs',
      label: 'Drill into details',
      icon: 'search',
      prompt: 'Show me more details about the costs',
      variant: 'secondary',
    });
    actions.push({
      id: 'compare-costs',
      label: 'Compare to previous',
      icon: 'chart',
      prompt: 'Compare these costs to the previous period',
      variant: 'outline',
    });
  }

  // Code/file suggestions
  if (contentLower.includes('file') || contentLower.includes('code') || contentLower.includes('function')) {
    actions.push({
      id: 'explain-more',
      label: 'Explain in detail',
      icon: 'info',
      prompt: 'Explain this in more detail',
      variant: 'secondary',
    });
    actions.push({
      id: 'add-tests',
      label: 'Add tests',
      icon: 'test',
      prompt: 'Add tests for this code',
      variant: 'outline',
    });
  }

  // Default suggestions if none matched
  if (actions.length === 0) {
    actions.push({
      id: 'continue',
      label: 'Continue',
      icon: 'arrow-right',
      prompt: 'Continue with the next step',
      variant: 'primary',
    });
    actions.push({
      id: 'clarify',
      label: 'Clarify',
      icon: 'help',
      prompt: 'Can you clarify that?',
      variant: 'outline',
    });
  }

  return actions;
}

/**
 * Generate summary from completed response
 */
function generateSummary(content: string, tasks: AgenticTask[]): ResponseSummary {
  const accomplishments: string[] = [];

  // Extract accomplishments from completed tasks
  for (const task of tasks) {
    if (task.status === 'completed') {
      accomplishments.push(task.title);
    }
  }

  // If no tasks, try to extract from content
  if (accomplishments.length === 0 && content) {
    // Look for action verbs at start of sentences
    const sentences = content.split(/[.!?]+/).filter(s => s.trim());
    for (const sentence of sentences.slice(0, 5)) {
      const trimmed = sentence.trim();
      if (/^(?:Created|Updated|Fixed|Added|Removed|Analyzed|Generated|Implemented)/i.test(trimmed)) {
        accomplishments.push(trimmed.slice(0, 100));
      }
    }
  }

  const suggestedActions = generateSuggestedActions(content, tasks);

  return {
    accomplishments,
    keyFindings: [],
    caveats: [],
    suggestedActions,
  };
}

export function useActivityParser(
  contentBlocks: ContentBlock[],
  tasks: AgenticTask[] = [],
  toolCalls: ToolCall[] = [],
  options: UseActivityParserOptions = {}
): UseActivityParserReturn {
  const { autoCollapseRepetitive = true, maxVisibleSections = 10 } = options;

  // Parse content blocks into sections
  const sections = useMemo(() => {
    const thinkingBlocks = contentBlocks.filter(b => b.type === 'thinking');
    const thinkingContent = thinkingBlocks.map(b => b.content).join('\n');
    let parsedSections = parseThinkingContent(thinkingContent);

    if (autoCollapseRepetitive) {
      parsedSections = detectRepetition(parsedSections);
    }

    return parsedSections;
  }, [contentBlocks, autoCollapseRepetitive]);

  // Build parsed activity
  const parsedActivity = useMemo<ParsedActivity>(() => {
    // Generate summary from text blocks
    const textBlocks = contentBlocks.filter(b => b.type === 'text');
    const textContent = textBlocks.map(b => b.content).join('\n');
    const summary = textContent ? generateSummary(textContent, tasks) : null;

    return {
      sections,
      tasks,
      toolCalls,
      summary,
    };
  }, [sections, tasks, toolCalls, contentBlocks]);

  // Callbacks for manual parsing
  const parseThinkingContentCallback = useCallback(
    (content: string) => {
      let parsed = parseThinkingContent(content);
      if (autoCollapseRepetitive) {
        parsed = detectRepetition(parsed);
      }
      return parsed;
    },
    [autoCollapseRepetitive]
  );

  const generateSummaryCallback = useCallback(
    (content: string, taskList: AgenticTask[]) => generateSummary(content, taskList),
    []
  );

  const detectRepetitionCallback = useCallback(
    (sectionList: ActivitySection[]) => detectRepetition(sectionList),
    []
  );

  return {
    parsedActivity,
    parseThinkingContent: parseThinkingContentCallback,
    generateSummary: generateSummaryCallback,
    detectRepetition: detectRepetitionCallback,
  };
}

export default useActivityParser;
