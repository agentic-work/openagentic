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
 * AgentExecutionTimeline - Live visualization of agent execution steps
 *
 * Renders a vertical timeline with animated step cards showing:
 * - Thinking (brain icon, blue)
 * - Tool calls (wrench icon, orange)
 * - Results (check icon, green)
 * - Errors (X icon, red)
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Wrench, CheckCircle, XCircle, Clock } from '@/shared/icons';
import type { ExecutionStep } from '../hooks/useAgentPlayground';

interface AgentExecutionTimelineProps {
  steps: ExecutionStep[];
  executing: boolean;
}

const stepConfig: Record<string, { icon: React.ComponentType<any>; color: string; bgColor: string; label: string }> = {
  agent_start: { icon: Brain, color: '#2196f3', bgColor: 'rgba(33, 150, 243, 0.1)', label: 'Agent Started' },
  tool_call: { icon: Wrench, color: '#ff9800', bgColor: 'rgba(255, 152, 0, 0.1)', label: 'Tool Call' },
  tool_result: { icon: CheckCircle, color: '#00ff00', bgColor: 'rgba(0, 255, 0, 0.1)', label: 'Tool Result' },
  llm_chunk: { icon: Brain, color: '#7c4dff', bgColor: 'rgba(124, 77, 255, 0.1)', label: 'Thinking' },
  agent_complete: { icon: CheckCircle, color: '#00ff00', bgColor: 'rgba(0, 255, 0, 0.1)', label: 'Completed' },
  agent_error: { icon: XCircle, color: '#f44336', bgColor: 'rgba(244, 67, 54, 0.1)', label: 'Error' },
};

export const AgentExecutionTimeline: React.FC<AgentExecutionTimelineProps> = ({ steps, executing }) => {
  if (steps.length === 0 && !executing) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Brain className="w-8 h-8 mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.3 }} />
        <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          Run an agent to see the execution timeline
        </p>
      </div>
    );
  }

  // Accumulate cost from steps
  const totalCost = steps.reduce((sum, s) => sum + (s.data?.cost || 0), 0);
  const totalTokens = steps.reduce((sum, s) => sum + (s.data?.tokensUsed || s.data?.tokens || 0), 0);

  return (
    <div className="space-y-1">
      {/* Timeline header */}
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          Execution Timeline
        </span>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {totalTokens > 0 && <span>{totalTokens.toLocaleString()} tokens</span>}
          {totalCost > 0 && <span>${totalCost.toFixed(4)}</span>}
        </div>
      </div>

      {/* Steps */}
      <div className="relative">
        {/* Vertical line */}
        <div
          className="absolute left-5 top-0 bottom-0 w-px"
          style={{ backgroundColor: 'var(--color-border)' }}
        />

        <AnimatePresence>
          {steps.map((step, i) => {
            const config = stepConfig[step.type] || stepConfig.llm_chunk;
            const Icon = config.icon;
            const isLast = i === steps.length - 1;

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                className="relative flex items-start gap-3 pl-2 pr-2 py-1.5"
              >
                {/* Icon circle */}
                <div
                  className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: config.bgColor,
                    border: `2px solid ${config.color}`,
                    ...(isLast && executing ? {
                      animation: 'pulse 2s ease-in-out infinite',
                      boxShadow: `0 0 8px ${config.color}40`,
                    } : {}),
                  }}
                >
                  <Icon style={{ width: 12, height: 12, color: config.color }} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium" style={{ color: config.color }}>
                      {step.toolName || config.label}
                    </span>
                    {step.agentRole && (
                      <span className="text-[10px] px-1 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
                        {step.agentRole}
                      </span>
                    )}
                    <span className="text-[10px] flex items-center gap-0.5 ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                      <Clock style={{ width: 9, height: 9 }} />
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Agent task summary for agent_start */}
                  {step.type === 'agent_start' && step.data?.task && (
                    <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {String(step.data.task).substring(0, 150)}
                    </div>
                  )}

                  {/* Image thumbnail for tool results containing image URLs */}
                  {step.type === 'tool_result' && step.data?.result && /\/api\/images\/[^\s]+\.png/.test(String(step.data.result)) && (() => {
                    const match = String(step.data.result).match(/\/api\/images\/[^\s"'<>]+\.png/);
                    if (!match) return null;
                    return (
                      <div className="mt-1.5">
                        <img
                          src={match[0]}
                          alt={step.toolName || 'Generated image'}
                          className="rounded-md cursor-pointer hover:opacity-90 transition-opacity"
                          style={{ maxWidth: 180, maxHeight: 120, objectFit: 'cover', border: '1px solid var(--color-border)' }}
                          onClick={(e) => {
                            const img = e.currentTarget;
                            if (img.style.maxWidth === '180px' || img.style.maxWidth === '') {
                              img.style.maxWidth = '100%';
                              img.style.maxHeight = '400px';
                            } else {
                              img.style.maxWidth = '180px';
                              img.style.maxHeight = '120px';
                            }
                          }}
                        />
                      </div>
                    );
                  })()}

                  {/* Details (expandable) — skip for image results already shown above */}
                  {step.data && step.type !== 'llm_chunk' && step.type !== 'agent_start' &&
                   !(step.type === 'tool_result' && step.data?.result && /\/api\/images\/[^\s]+\.png/.test(String(step.data.result))) && (
                    <div
                      className="mt-1 text-[11px] font-mono rounded-md p-2 max-h-24 overflow-y-auto"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {typeof step.data === 'string'
                        ? step.data.substring(0, 300)
                        : step.data.result
                        ? String(step.data.result).substring(0, 300)
                        : step.data.arguments
                        ? JSON.stringify(step.data.arguments, null, 2).substring(0, 300)
                        : JSON.stringify(step.data, null, 2).substring(0, 300)
                      }
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Running indicator */}
        {executing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative flex items-center gap-3 pl-2 py-2"
          >
            <div
              className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: 'rgba(255, 152, 0, 0.1)',
                border: '2px solid #ff9800',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ff9800', animation: 'pulse 1s ease-in-out infinite' }} />
            </div>
            <span className="text-[12px]" style={{ color: '#ff9800' }}>Processing...</span>
          </motion.div>
        )}
      </div>
    </div>
  );
};
