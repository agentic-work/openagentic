/**
 * Chain of Thought (COT) Display Component
 *
 * Shows the LLM's thinking process inline in chat messages
 * - Collapsible step list with "Show/Hide steps" toggle
 * - Each step shows: status indicator, description, expandable Request/Response
 * - Supports streaming updates during generation
 * - Feature flagged via VITE_ENABLE_CHAIN_OF_THOUGHT
 *
 * Inspired by ISO 42001 architecture visualization
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, CheckCircle2, Circle, Loader2 } from '@/shared/icons';

// Check if COT feature is enabled - enabled by default for better UX
export const isCOTEnabled = (): boolean => {
  // Default to true if not explicitly set to 'false'
  const envValue = import.meta.env.VITE_ENABLE_CHAIN_OF_THOUGHT;
  return envValue !== 'false';
};

// Types for COT steps
export interface COTStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'rag_lookup' | 'fetch' | 'memory' | 'reasoning';
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  startTime?: number;
  endTime?: number;
  request?: any;
  response?: any;
  error?: string;
  content?: string; // Actual thinking text content (streaming)
}

interface ChainOfThoughtDisplayProps {
  steps: COTStep[];
  isStreaming?: boolean;
  theme?: 'light' | 'dark';
  defaultCollapsed?: boolean;
  thinkingContent?: string; // Current streaming thinking content
}

const StepTypeIcon: Record<COTStep['type'], string> = {
  thinking: 'brain',
  tool_call: 'wrench',
  rag_lookup: 'search',
  fetch: 'globe',
  memory: 'database',
  reasoning: 'lightbulb',
};

const StepTypeLabel: Record<COTStep['type'], string> = {
  thinking: 'Thinking',
  tool_call: 'Tool Call',
  rag_lookup: 'RAG Lookup',
  fetch: 'Fetch',
  memory: 'Memory',
  reasoning: 'Reasoning',
};

const ChainOfThoughtDisplay: React.FC<ChainOfThoughtDisplayProps> = ({
  steps,
  isStreaming = false,
  theme = 'dark',
  defaultCollapsed = false, // Show thinking by default for better UX
  thinkingContent,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const thinkingRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll thinking content as it streams
  React.useEffect(() => {
    if (thinkingRef.current && thinkingContent) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinkingContent]);

  // Don't render if feature is disabled or no steps
  if (!isCOTEnabled() || steps.length === 0) {
    return null;
  }

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const totalCount = steps.length;

  const renderStatusIcon = (status: COTStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 size={14} className="text-green-500" />;
      case 'in_progress':
        return <Loader2 size={14} className="text-blue-500 animate-spin" />;
      case 'error':
        return <Circle size={14} className="text-red-500" />;
      default:
        return <Circle size={14} className="text-gray-400" />;
    }
  };

  const formatDuration = (startTime?: number, endTime?: number): string => {
    if (!startTime) return '';
    const end = endTime || Date.now();
    const duration = end - startTime;
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(1)}s`;
  };

  return (
    <div
      className="rounded-lg border overflow-hidden mb-3"
      style={{
        background: 'var(--color-bg-tertiary, rgba(0, 0, 0, 0.05))',
        borderColor: 'var(--color-border-primary, rgba(0, 0, 0, 0.1))',
      }}
    >
      {/* Header - Toggle */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-black/5 transition-colors"
        style={{ cursor: 'pointer' }}
      >
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-blue-500"
          >
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {isCollapsed ? 'Show steps' : 'Hide steps'}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{
              background: 'color-mix(in srgb, var(--color-info) 10%, transparent)',
              color: 'var(--color-info)',
            }}
          >
            {completedCount}/{totalCount}
          </span>
          {isStreaming && (
            <Loader2 size={12} className="text-blue-500 animate-spin" />
          )}
        </div>
        {isCollapsed ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
        ) : (
          <ChevronUp size={14} style={{ color: 'var(--color-text-tertiary)' }} />
        )}
      </button>

      {/* Collapsible Content */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            {/* Streaming Thinking Content */}
            {thinkingContent && (
              <div className="px-3 pb-3">
                <div
                  ref={thinkingRef}
                  className="rounded-md p-3 text-sm font-mono leading-relaxed overflow-y-auto thinking-box-gradient"
                  style={{
                    maxHeight: '300px',
                    color: 'var(--color-text)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {thinkingContent}
                  {isStreaming && (
                    <span
                      className="inline-block ml-1 animate-pulse"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      ▊
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Steps List */}
            <div className="px-3 pb-3 space-y-2">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className="rounded-md border"
                  style={{
                    background: 'var(--color-bg-secondary, rgba(255, 255, 255, 0.05))',
                    borderColor: 'var(--color-border-secondary, rgba(0, 0, 0, 0.05))',
                  }}
                >
                  {/* Step Header */}
                  <button
                    onClick={() => toggleStep(step.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-black/5 transition-colors"
                    style={{ cursor: step.request || step.response ? 'pointer' : 'default' }}
                  >
                    {/* Status */}
                    {renderStatusIcon(step.status)}

                    {/* Type Badge */}
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{
                        background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)',
                        color: 'var(--color-primary)',
                      }}
                    >
                      {StepTypeLabel[step.type] || step.type}
                    </span>

                    {/* Description */}
                    <span
                      className="flex-1 text-left text-xs truncate"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {step.description}
                    </span>

                    {/* Duration */}
                    {step.startTime && (
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--color-text-tertiary)' }}
                      >
                        {formatDuration(step.startTime, step.endTime)}
                      </span>
                    )}

                    {/* Expand Arrow (if has details) */}
                    {(step.request || step.response) && (
                      <ChevronDown
                        size={12}
                        style={{
                          color: 'var(--color-text-tertiary)',
                          transform: expandedSteps.has(step.id) ? 'rotate(180deg)' : 'rotate(0)',
                          transition: 'transform 0.2s ease',
                        }}
                      />
                    )}
                  </button>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {expandedSteps.has(step.id) && (step.request || step.response || step.error) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div
                          className="px-2.5 pb-2.5 space-y-2"
                          style={{ borderTop: '1px solid var(--color-border-secondary)' }}
                        >
                          {/* Request */}
                          {step.request && (
                            <details className="text-xs" open>
                              <summary
                                className="cursor-pointer font-medium py-1"
                                style={{ color: 'var(--color-text-secondary)' }}
                              >
                                Request
                              </summary>
                              <pre
                                className="mt-1 p-2 rounded overflow-x-auto"
                                style={{
                                  background: 'var(--color-bg-tertiary)',
                                  fontSize: '10px',
                                  fontFamily: 'ui-monospace, monospace',
                                  maxHeight: '150px',
                                  overflowY: 'auto',
                                  color: 'var(--color-text-primary)',
                                }}
                              >
                                {typeof step.request === 'string'
                                  ? step.request
                                  : JSON.stringify(step.request, null, 2)}
                              </pre>
                            </details>
                          )}

                          {/* Response */}
                          {step.response && (
                            <details className="text-xs">
                              <summary
                                className="cursor-pointer font-medium py-1"
                                style={{ color: 'var(--color-text-secondary)' }}
                              >
                                Response
                              </summary>
                              <pre
                                className="mt-1 p-2 rounded overflow-x-auto"
                                style={{
                                  background: 'var(--color-bg-tertiary)',
                                  fontSize: '10px',
                                  fontFamily: 'ui-monospace, monospace',
                                  maxHeight: '200px',
                                  overflowY: 'auto',
                                  color: 'var(--color-text-primary)',
                                }}
                              >
                                {typeof step.response === 'string'
                                  ? step.response
                                  : JSON.stringify(step.response, null, 2)}
                              </pre>
                            </details>
                          )}

                          {/* Error */}
                          {step.error && (
                            <div
                              className="p-2 rounded text-xs"
                              style={{
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: 'rgb(239, 68, 68)',
                                fontFamily: 'ui-monospace, monospace',
                              }}
                            >
                              {step.error}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChainOfThoughtDisplay;
