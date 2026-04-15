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
 * ThinkingSection - Parsed Thinking Display
 *
 * Two display variants:
 * - "natural": Clean inline display without box (default)
 * - "boxed": Traditional boxed container with collapsible sections
 *
 * Intelligently parses and displays thinking content:
 * - Detects section headers ("Analyzing...", "Step 1:", etc.)
 * - Collapses repetitive content automatically
 * - Shows streaming cursor when active
 * - Expandable/collapsible sections
 */

import React, { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from '@/shared/icons';

// Mini animated thinking indicator using think.svg
// Note: Reduced default size from 16 to 14 for more compact display
const MiniThinkingIndicator: React.FC<{ isAnimating?: boolean; size?: number }> = ({ isAnimating, size = 14 }) => (
  <motion.div
    animate={isAnimating ? { scale: [1, 1.1, 1] } : {}}
    transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
    style={{ width: size, height: size, flexShrink: 0 }}
  >
    <img
      src="/think.svg"
      alt=""
      style={{
        width: '100%',
        height: '100%',
        filter: isAnimating ? 'drop-shadow(0 0 3px rgba(139, 92, 246, 0.5))' : 'none',
      }}
    />
  </motion.div>
);

import type { ThinkingSectionProps } from '../types/activity.types';

// Patterns that indicate section headers
const SECTION_PATTERNS = [
  /^(?:Step\s+\d+[\.:]\s*)/i,
  /^(?:First|Second|Third|Next|Finally|Now)[\s,]/i,
  /^(?:Analyzing|Understanding|Reviewing|Checking|Examining)/i,
  /^(?:Let me|I'll|I need to|I should|I will)/i,
  /^(?:Looking at|Considering|Thinking about)/i,
  /^(?:The\s+(?:user|request|issue|problem))/i,
  /^##?\s+/,  // Markdown headers
];

// Patterns that indicate repetitive filler content
const FILLER_PATTERNS = [
  /^(?:Finalizing|Wrapping up|Finishing|Completing)/i,
  /^(?:Preparing|Getting ready|Almost done)/i,
  /^(?:Just a moment|One moment|Please wait)/i,
  /^(?:Let me think|Hmm|Okay|Alright|So)/i,
];

interface ParsedSection {
  id: string;
  title: string;
  content: string;
  isRepetitive: boolean;
  repetitionCount: number;
}

/**
 * Parse thinking content into sections
 */
function parseThinkingSections(content: string): ParsedSection[] {
  const lines = content.split('\n').filter(line => line.trim());
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;
  const seenContent = new Map<string, number>();

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check if this is a section header
    const isHeader = SECTION_PATTERNS.some(pattern => pattern.test(trimmedLine));
    const isFiller = FILLER_PATTERNS.some(pattern => pattern.test(trimmedLine));

    // Track repetition
    const normalizedLine = trimmedLine.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const existingCount = seenContent.get(normalizedLine) || 0;
    seenContent.set(normalizedLine, existingCount + 1);

    if (isHeader) {
      // Start a new section
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        id: `section-${sections.length}`,
        title: trimmedLine,
        content: '',
        isRepetitive: isFiller || existingCount > 0,
        repetitionCount: existingCount + 1,
      };
    } else if (currentSection) {
      // Add to current section
      currentSection.content += (currentSection.content ? '\n' : '') + trimmedLine;
      if (existingCount > 0) {
        currentSection.isRepetitive = true;
        currentSection.repetitionCount = Math.max(currentSection.repetitionCount, existingCount + 1);
      }
    } else {
      // No current section, create a generic one
      currentSection = {
        id: `section-${sections.length}`,
        title: 'Thinking',
        content: trimmedLine,
        isRepetitive: isFiller || existingCount > 0,
        repetitionCount: existingCount + 1,
      };
    }
  }

  // Add final section
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Count total repetitions in content
 */
function countRepetitions(content: string): { count: number; phrases: Map<string, number> } {
  const phrases = new Map<string, number>();
  const lines = content.split('\n');

  for (const line of lines) {
    const normalized = line.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (normalized.length > 10) { // Only count meaningful lines
      phrases.set(normalized, (phrases.get(normalized) || 0) + 1);
    }
  }

  let count = 0;
  for (const [, occurrences] of phrases) {
    if (occurrences > 1) {
      count += occurrences - 1; // Count excess repetitions
    }
  }

  return { count, phrases };
}

export const ThinkingSection: React.FC<ThinkingSectionProps> = ({
  content,
  isStreaming,
  autoCollapse = true,
  maxVisibleLines = 10,
  isCollapsed = false,
  onToggle,
  className = '',
  variant = 'natural', // Default to natural (non-boxed) display
}) => {
  const [showRepetitive, setShowRepetitive] = useState(false);

  // Parse sections
  const sections = useMemo(() => parseThinkingSections(content), [content]);

  // Count repetitions
  const { count: repetitionCount, phrases } = useMemo(
    () => countRepetitions(content),
    [content]
  );

  // Get most repeated phrases for collapse summary
  const topRepetitions = useMemo(() => {
    const sorted = Array.from(phrases.entries())
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return sorted;
  }, [phrases]);

  // Visible sections based on collapse state
  const visibleSections = useMemo(() => {
    if (!autoCollapse || showRepetitive) return sections;
    return sections.filter(s => !s.isRepetitive || s.repetitionCount <= 2);
  }, [sections, autoCollapse, showRepetitive]);

  // Line count for visible content
  const visibleLines = useMemo(() => {
    return visibleSections.reduce(
      (acc, s) => acc + s.content.split('\n').length + 1,
      0
    );
  }, [visibleSections]);

  const hasRepetitions = repetitionCount > 0;
  const collapsedCount = sections.length - visibleSections.length;

  const handleToggle = useCallback(() => {
    onToggle?.();
  }, [onToggle]);

  if (!content.trim()) return null;

  // Natural (non-boxed) variant - clean, inline display
  if (variant === 'natural') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`thinking-section-natural ${className}`}
        style={{
          marginBottom: '8px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Header - minimal, clickable */}
        <button
          onClick={handleToggle}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 0',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            color: 'var(--color-textMuted)',
          }}
        >
          <MiniThinkingIndicator isAnimating={isStreaming} size={16} />
          <span style={{
            fontSize: '12px',
            fontWeight: 500,
            color: 'var(--color-textSecondary)',
          }}>
            {isStreaming ? 'Reasoning...' : 'Thought process'}
          </span>
          <motion.span
            animate={{ rotate: isCollapsed ? 0 : 180 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <ChevronDown size={14} />
          </motion.span>
        </button>

        {/* Collapsible content - flows naturally */}
        <AnimatePresence>
          {!isCollapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{
                paddingLeft: '22px',
                paddingTop: '4px',
                paddingBottom: '8px',
                fontSize: '13px',
                color: 'var(--color-textSecondary)',
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.5',
                borderLeft: '2px solid var(--color-border)',
                marginLeft: '8px',
              }}>
                {/* Visible sections */}
                {visibleSections.map((section, idx) => (
                  <div
                    key={section.id}
                    className={section.isRepetitive ? 'opacity-75' : ''}
                  >
                    {section.title !== 'Thinking' && (
                      <div style={{ fontWeight: 500, fontStyle: 'normal', marginBottom: '4px' }}>
                        {section.title}
                      </div>
                    )}
                    {section.content && (
                      <div style={{ marginBottom: idx < visibleSections.length - 1 ? '8px' : 0 }}>
                        {section.content}
                      </div>
                    )}
                  </div>
                ))}

                {/* Collapsed sections indicator */}
                {collapsedCount > 0 && !showRepetitive && (
                  <button
                    onClick={() => setShowRepetitive(true)}
                    style={{
                      fontSize: '11px',
                      color: 'var(--color-textMuted)',
                      background: 'transparent',
                      border: 'none',
                      padding: '4px 0',
                      cursor: 'pointer',
                      fontStyle: 'normal',
                    }}
                  >
                    + {collapsedCount} more...
                  </button>
                )}

                {/* Streaming cursor */}
                {isStreaming && (
                  <motion.span
                    className="inline-block w-1.5 h-3.5 bg-[var(--color-primary)] rounded-sm ml-1"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    style={{ verticalAlign: 'text-bottom' }}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  // Boxed variant - traditional container style
  return (
    <div
      className={`
        thinking-section
        bg-[var(--color-surfaceSecondary)]/50
        backdrop-blur-sm
        border border-[var(--color-border)]/30
        rounded-lg
        overflow-hidden
        ${className}
      `}
    >
      {/* Header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-[var(--color-surfaceHover)]/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <MiniThinkingIndicator isAnimating={isStreaming} />
          <span className="text-sm font-medium text-[var(--color-text)]">
            {isStreaming ? 'Reasoning...' : 'Thought process'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Repetition indicator */}
          {hasRepetitions && autoCollapse && (
            <span className="text-xs text-[var(--color-textMuted)] flex items-center gap-1">
              <AlertCircle size={12} />
              {collapsedCount > 0 && `${collapsedCount} collapsed`}
            </span>
          )}

          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-[var(--color-textMuted)]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[var(--color-textMuted)]" />
          )}
        </div>
      </button>

      {/* Content */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--color-border)]/20 p-3 space-y-2">
              {/* Visible sections */}
              {visibleSections.map((section, idx) => (
                <div
                  key={section.id}
                  className={`text-sm leading-relaxed ${
                    section.isRepetitive
                      ? 'text-[var(--color-textMuted)] opacity-75'
                      : 'text-[var(--color-textSecondary)]'
                  }`}
                >
                  {section.title !== 'Thinking' && (
                    <div className="font-medium text-[var(--color-text)] mb-1">
                      {section.title}
                    </div>
                  )}
                  {section.content && (
                    <div className="whitespace-pre-wrap">{section.content}</div>
                  )}
                </div>
              ))}

              {/* Collapsed repetitive content summary */}
              {collapsedCount > 0 && !showRepetitive && (
                <div className="mt-2 pt-2 border-t border-[var(--color-border)]/20">
                  <button
                    onClick={() => setShowRepetitive(true)}
                    className="text-xs text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span>
                        {collapsedCount} similar update{collapsedCount > 1 ? 's' : ''} collapsed
                      </span>
                      <ChevronDown size={12} />
                    </span>
                    {topRepetitions.length > 0 && (
                      <div className="mt-1 ml-4 space-y-0.5">
                        {topRepetitions.map(([phrase, count]) => (
                          <div key={phrase} className="truncate max-w-[300px]">
                            &quot;{phrase.slice(0, 40)}{phrase.length > 40 ? '...' : ''}&quot; (×{count})
                          </div>
                        ))}
                      </div>
                    )}
                  </button>
                </div>
              )}

              {/* Show all button */}
              {showRepetitive && collapsedCount > 0 && (
                <button
                  onClick={() => setShowRepetitive(false)}
                  className="text-xs text-[var(--color-primary)] hover:underline"
                >
                  Hide repetitive content
                </button>
              )}

              {/* Streaming cursor */}
              {isStreaming && (
                <motion.span
                  className="inline-block w-2 h-4 bg-[var(--color-primary)] rounded-sm ml-1"
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ThinkingSection;
