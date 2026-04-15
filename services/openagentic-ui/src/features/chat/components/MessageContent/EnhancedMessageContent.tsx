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

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { nanoid } from 'nanoid';

// Use SharedMarkdownRenderer for ALL markdown - SINGLE SOURCE OF TRUTH
import { SharedMarkdownRenderer } from './SharedMarkdownRenderer';

// Specialized components for non-markdown content
import ShikiCodeBlock from './ShikiCodeBlock';
// StreamingArtifactRenderer + artifact detection moved to AgenticActivityStream (sole renderer during streaming)
import AnimatedTokenCost from '../AnimatedTokenCost';
import InlineModelBadge from '../InlineModelBadge';
import DataVisualization from './DataVisualization';
import MetricCard from './MetricCard';
import { ChatMessage } from '@/types/index';

interface MCPCall {
  id: string;
  toolName: string;
  serverName?: string;
  status: 'running' | 'completed' | 'error' | 'pending';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  metadata?: any;
}

interface EnhancedMessageContentProps {
  message?: ChatMessage;
  content?: string; // Allow content to be passed directly
  theme: 'light' | 'dark';
  onExpandToCanvas?: (content: any, type: string, title: string, language?: string) => void;
  onExecuteCode?: (code: string, language: string) => void;
  showTokenCost?: boolean;
  tokenCostDelay?: number;
  showModelBadges?: boolean;  // Control model badge visibility
  isStreaming?: boolean;  // When true, code blocks auto-scroll to follow content
}

interface ParsedContent {
  type: 'text' | 'code' | 'visualization' | 'metric' | 'callout' | 'summary' | 'mcp-calls' | 'chart' | 'tool-calls';
  content: any;
  language?: string;
}

const EnhancedMessageContent: React.FC<EnhancedMessageContentProps> = ({
  message,
  content: directContent,
  theme,
  onExpandToCanvas,
  onExecuteCode,
  showTokenCost = true,
  tokenCostDelay = 0,
  showModelBadges = true,
  isStreaming = false
}) => {
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());

  // Parse message content - simplified to let AI render markdown freely
  const parseContent = (content: string | any): ParsedContent[] => {
    const parsed: ParsedContent[] = [];

    // Handle Ollama/JSON responses that might come as objects
    if (content && typeof content === 'object') {
      // Handle Anthropic content block arrays: [{type:"text",text:"..."}, {type:"tool_use",...}]
      if (Array.isArray(content)) {
        const textParts: string[] = [];
        for (const block of content) {
          if (block && typeof block === 'object') {
            if (block.type === 'text' && typeof block.text === 'string') {
              textParts.push(block.text);
            } else if (block.type === 'tool_use' || block.type === 'tool_result') {
              // Skip tool blocks — they're rendered separately via mcpCalls/toolCalls
              continue;
            } else if (typeof block.text === 'string') {
              textParts.push(block.text);
            } else if (typeof block.content === 'string') {
              textParts.push(block.content);
            }
          } else if (typeof block === 'string') {
            textParts.push(block);
          }
        }
        content = textParts.join('\n\n') || '';
      }
      // If it's an object with a message or text field, extract it
      else if (content.message) {
        content = content.message;
      } else if (content.text) {
        content = content.text;
      } else if (content.content) {
        content = content.content;
      } else if (content.response) {
        content = content.response;
      } else if (content.result) {
        // Background job result
        content = content.result;
      } else {
        // Last resort: extract any string values from the object
        const stringValues = Object.values(content).filter((v): v is string => typeof v === 'string');
        if (stringValues.length > 0) {
          content = stringValues.join('\n\n');
        } else {
          // Only JSON.stringify as absolute last resort
          try {
            content = JSON.stringify(content, null, 2);
          } catch {
            content = String(content);
          }
        }
      }
    }

    // Ensure content is a string
    if (!content || typeof content !== 'string') {
      // If there's no content but there are MCP calls, don't add empty text
      const mcpCalls = message?.mcpCalls || message?.metadata?.mcpCalls;
      if (mcpCalls && mcpCalls.length > 0) {
        return [];
      }
      return [{ type: 'text', content: content || '' }];
    }

    // Strip thinking/reasoning/tool_code tags so they don't render as raw text
    // (AgenticActivityStream handles thinking display via message.reasoningTrace)
    content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    content = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');
    content = content.replace(/<tool_code>[\s\S]*?<\/tool_code>/g, '');
    content = content.trim();

    // Check if message contains backend visualization data (structured data, not markdown)
    if (message?.visualizations && Array.isArray(message.visualizations)) {
      message.visualizations.forEach(viz => {
        if (viz && typeof viz === 'object') {
          parsed.push({ type: 'visualization', content: viz });
        }
      });
    }

    // Check if message contains backend Prometheus metrics (structured data, not markdown)
    if (message?.prometheusData && Array.isArray(message.prometheusData)) {
      message.prometheusData.forEach(metric => {
        if (metric && typeof metric === 'object') {
          parsed.push({ type: 'metric', content: metric });
        }
      });
    }

    // Add remaining content as text - let ReactMarkdown handle all markdown rendering
    // No hardcoded pattern matching for callouts, summaries, D2, charts, etc.
    // AI can write markdown freely and it will render naturally
    if (content && content.length > 0) {
      parsed.push({ type: 'text', content: content });
    }

    return parsed;
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      const id = nanoid();
      setCopiedItems(prev => new Set([...prev, id]));
      setTimeout(() => {
        setCopiedItems(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleExpandToCanvas = (code: string, language: string, filename?: string) => {
    if (onExpandToCanvas) {
      onExpandToCanvas(
        code,
        'code',
        filename || `${language} code`,
        language
      );
    }
  };

  const handleMCPExpandToCanvas = (call: any) => {
    if (onExpandToCanvas) {
      onExpandToCanvas(
        call,
        'mcp-result',
        `${call.toolName} result`,
      );
    }
  };

  const parsedContent = parseContent(directContent || message?.content || '');

  return (
    <div className="message-content space-y-4">
      {/* Token cost display */}
      {showTokenCost && message?.tokenUsage && message?.role === 'assistant' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: tokenCostDelay / 1000 }}
          className="flex justify-end"
        >
          <AnimatedTokenCost
            usage={message.tokenUsage}
            theme={theme}
            isVisible={true}
            delay={tokenCostDelay}
            compact={false}
          />
        </motion.div>
      )}

      {/* Model badge display - shows which model generated this response */}
      {showModelBadges && message?.model && message?.role === 'assistant' && (
        <div className="flex items-center gap-2 mb-2">
          <InlineModelBadge model={message.model} theme={theme} />
          {/* Show tool execution count if any */}
          {(message?.mcpCalls?.length || 0) > 0 && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{
                background: 'rgba(34, 197, 94, 0.1)',
                color: 'rgb(34, 197, 94)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                fontSize: '11px'
              }}
            >
              <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" style={{ opacity: 0.8 }}>
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
              <span>{message.mcpCalls?.length} tool{(message.mcpCalls?.length || 0) > 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
      )}

      {/* Render parsed content */}
      {parsedContent.map((section, index) => {
        const sectionId = `section-${index}`;
        
        switch (section.type) {
          case 'tool-calls':
            // CRITICAL FIX: Never display synthetic tool calls in UI
            // Tool calls should only be processed server-side and results shown as text
            // console.warn('TOOL CALL DEBUG: Synthetic tool call section detected and blocked', {
            //   toolCallCount: section.content.toolCalls?.length || 0,
            //   sectionId
            // });
            return null;

          // thinking-block case removed — AgenticActivityStream handles thinking display
          // MCP calls case removed - now handled separately in ChatMessages.tsx
          // This prevents duplicate rendering and ensures correct chronological order

          case 'code':
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="code-block-wrapper"
              >
                <ShikiCodeBlock
                  code={section.content.code}
                  language={section.content.language}
                  theme={theme}
                  onCopy={handleCopy}
                  isStreaming={isStreaming}
                />
              </motion.div>
            );

          case 'visualization':
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <DataVisualization
                  data={section.content}
                  theme={theme}
                />
              </motion.div>
            );

          case 'metric':
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <MetricCard
                  metric={section.content}
                  theme={theme}
                />
              </motion.div>
            );

          case 'text':
          default:
            // Streaming artifact detection removed — AgenticActivityStream handles artifacts during streaming.
            // EnhancedMessageContent only renders for completed (non-streaming) messages.
            // Use SharedMarkdownRenderer for ALL text content - SINGLE SOURCE OF TRUTH
            return (
              <motion.div
                key={sectionId}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <SharedMarkdownRenderer
                  content={section.content}
                  theme={theme}
                  isStreaming={isStreaming}
                  onExecute={onExecuteCode}
                  executable={Boolean(onExecuteCode)}
                  onExpandToCanvas={onExpandToCanvas}
                />
              </motion.div>
            );
        }
      })}
    </div>
  );
};

// Memoize the entire component to prevent re-renders when parent re-renders (e.g., during typing)
// Only re-render if the actual content, theme, or streaming state changes
export default React.memo(EnhancedMessageContent, (prevProps, nextProps) => {
  // Return true if props are equal (no re-render needed)
  const contentEqual = prevProps.content === nextProps.content;
  const messageContentEqual = prevProps.message?.content === nextProps.message?.content;
  const themeEqual = prevProps.theme === nextProps.theme;
  const streamingEqual = prevProps.isStreaming === nextProps.isStreaming;

  // If content hasn't changed and theme/streaming state haven't changed, skip re-render
  return contentEqual && messageContentEqual && themeEqual && streamingEqual;
});