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



import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { X, Coins, Maximize2 } from '@/shared/icons';
// Pure frontend - charts rendered by API

interface TokenStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  chartData: Array<{
    timestamp: string;
    promptTokens: number;
    completionTokens: number;
    tokens: number;
  }>;
}

interface MetricsPanelProps {
  tokenStats: TokenStats;
  onClose: () => void;
  onShowMovableGraph?: () => void;
}

const MetricsPanel: React.FC<MetricsPanelProps> = memo(({ tokenStats, onClose, onShowMovableGraph }) => {
  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 400, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      className="bg-gray-100 dark:bg-gray-800 border-l border-gray-300 dark:border-gray-700 flex flex-col"
    >
      <div className="p-4 border-b border-gray-300 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Token Usage Metrics
        </h3>
        <div className="flex items-center gap-2">
          {onShowMovableGraph && (
            <button
              onClick={onShowMovableGraph}
              className="p-1 rounded-lg transition-all duration-150 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
              title="Show movable graph"
            >
              <Maximize2 size={20} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-all duration-150 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg p-4 bg-white dark:bg-gray-700 shadow">
            <div className="flex items-center gap-2 mb-2">
              <Coins size={16} className="text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Prompt Tokens
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {tokenStats.totalPromptTokens.toLocaleString()}
            </div>
          </div>

          <div className="rounded-lg p-4 bg-white dark:bg-gray-700 shadow">
            <div className="flex items-center gap-2 mb-2">
              <Coins size={16} className="text-green-600 dark:text-green-400" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Completion Tokens
              </span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {tokenStats.totalCompletionTokens.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Total */}
        <div className="rounded-lg p-4 mb-6 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Total Tokens Used
            </span>
            <span className="text-2xl font-bold text-blue-700 dark:text-blue-300">
              {tokenStats.totalTokens.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Chart - Pure Frontend: Display API-rendered chart */}
        {tokenStats.chartData.length > 0 && (
          <div className="rounded-lg p-4 bg-white dark:bg-gray-700 shadow">
            <h4 className="text-sm font-medium mb-4 text-gray-700 dark:text-gray-300">
              Token Usage Over Time
            </h4>
            <div
              className="h-48 flex items-center justify-center"
              style={{ color: 'var(--color-textSecondary)' }}
            >
              <p>Chart rendering moved to API - integration pending</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
});

MetricsPanel.displayName = 'MetricsPanel';

export default MetricsPanel;
