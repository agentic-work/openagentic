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
 * AgentPlayground - Main playground view for running/testing agents
 *
 * Layout:
 * - Top bar: Agent selector (dropdown)
 * - Left panel: Agent capability card
 * - Center: Task input + results
 * - Right/Bottom: Execution timeline
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Play, RotateCw, ChevronDown, Send, Brain } from '@/shared/icons';
import { useAgentPlayground } from '../hooks/useAgentPlayground';
import { AgentCapabilityCard } from './AgentCapabilityCard';
import { AgentExecutionTimeline } from './AgentExecutionTimeline';

export const AgentPlayground: React.FC = () => {
  const {
    agents,
    loading,
    selectedAgent,
    selectedAgentId,
    setSelectedAgentId,
    task,
    setTask,
    executing,
    steps,
    result,
    error,
    execute,
    reset,
  } = useAgentPlayground();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Brain className="w-8 h-8 mx-auto mb-3 animate-pulse" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading agents...</p>
        </div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-sm">
          <Brain className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--color-text-tertiary)', opacity: 0.3 }} />
          <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>No Agents Available</h3>
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Agents are configured by administrators in the Admin Portal. Once agents are created, you can run and test them here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Agent selector bar */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          Agent
        </label>
        <div className="relative flex-1 max-w-xs">
          <select
            value={selectedAgentId || ''}
            onChange={e => { setSelectedAgentId(e.target.value); reset(); }}
            className="w-full appearance-none px-3 py-1.5 pr-8 text-sm rounded-lg border focus:outline-none focus:ring-2 transition-colors cursor-pointer"
            style={{
              backgroundColor: 'var(--color-bg-primary)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
              outlineColor: 'var(--user-accent-primary, #2196f3)',
            }}
          >
            {agents.map(a => (
              <option key={a.id} value={a.id}>
                {a.display_name || a.name} — {a.role || a.agent_type}
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        </div>

        {(steps.length > 0 || result || error) && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            <RotateCw className="w-3 h-3" />
            Reset
          </motion.button>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Agent info */}
        <div
          className="w-72 flex-shrink-0 border-r overflow-y-auto p-4"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary, var(--color-bg-primary))' }}
        >
          {selectedAgent && <AgentCapabilityCard agent={selectedAgent} />}
        </div>

        {/* Center: Task input + results */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Task input */}
          <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex gap-2">
              <textarea
                value={task}
                onChange={e => setTask(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !executing) {
                    e.preventDefault();
                    execute();
                  }
                }}
                placeholder={`What would you like ${selectedAgent?.display_name || 'the agent'} to do?`}
                rows={2}
                className="flex-1 px-3 py-2 text-sm rounded-lg border resize-none focus:outline-none focus:ring-2 transition-colors"
                style={{
                  backgroundColor: 'var(--color-bg-primary)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)',
                }}
                disabled={executing}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={execute}
                disabled={executing || !task.trim()}
                className="self-end px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  backgroundColor: executing ? '#ff9800' : 'var(--user-accent-primary, #2196f3)',
                  color: '#fff',
                }}
              >
                {executing ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Running
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Play className="w-3.5 h-3.5" />
                    Run
                  </div>
                )}
              </motion.button>
            </div>
          </div>

          {/* Result display */}
          <div className="flex-1 overflow-y-auto p-4">
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border p-4 mb-4"
                style={{
                  borderColor: '#00ff00',
                  backgroundColor: 'rgba(0, 255, 0, 0.05)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: '#00ff00' }}>
                    <Play className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-sm font-semibold" style={{ color: '#00ff00' }}>Result</span>
                </div>
                <div
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: 'var(--color-text)' }}
                >
                  {result}
                </div>
              </motion.div>
            )}

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border p-4 mb-4"
                style={{
                  borderColor: '#f44336',
                  backgroundColor: 'rgba(244, 67, 54, 0.05)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold" style={{ color: '#f44336' }}>Error</span>
                </div>
                <div className="text-sm" style={{ color: '#f44336' }}>{error}</div>
              </motion.div>
            )}

            {!result && !error && !executing && steps.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Send className="w-10 h-10 mb-4" style={{ color: 'var(--color-text-tertiary)', opacity: 0.2 }} />
                <h3 className="text-base font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Ready to Run
                </h3>
                <p className="text-sm max-w-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  Type a task above and click Run to execute it with {selectedAgent?.display_name || 'the selected agent'}.
                  Watch the execution timeline on the right.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right panel: Execution timeline */}
        <div
          className="w-80 flex-shrink-0 border-l overflow-y-auto p-3"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary, var(--color-bg-primary))' }}
        >
          <AgentExecutionTimeline steps={steps} executing={executing} />
        </div>
      </div>
    </div>
  );
};
