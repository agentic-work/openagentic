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
 * WorkflowToolbar - Top bar with name, node toggle, execute, save buttons
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Play, Save, ArrowLeft, Grid3x3, Zap, Share2, Sparkles, RotateCw, AlertCircle, CheckCircle } from '@/shared/icons';

interface WorkflowToolbarProps {
  workflowName: string;
  onNameChange: (name: string) => void;
  nodeCount: number;
  edgeCount: number;
  showPalette: boolean;
  onTogglePalette: () => void;
  isSaving: boolean;
  isExecuting: boolean;
  isValidating?: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  canExecute: boolean;
  onSave: () => void;
  onExecute: () => void;
  onBack?: () => void;
  onShare?: () => void;
  onToggleAIBuilder?: () => void;
  showAIBuilder?: boolean;
  onAutoLayout?: () => void;
  onValidate?: () => void;
  validationResult?: { valid: boolean; summary: { errorCount: number; warningCount: number } } | null;
  executionProgress?: { total: number; completed: number; running: number; failed: number } | null;
}

export const WorkflowToolbar: React.FC<WorkflowToolbarProps> = ({
  workflowName,
  onNameChange,
  nodeCount,
  edgeCount,
  showPalette,
  onTogglePalette,
  isSaving,
  isExecuting,
  isValidating,
  saveStatus,
  canExecute,
  onSave,
  onExecute,
  onBack,
  onShare,
  onToggleAIBuilder,
  showAIBuilder,
  onAutoLayout,
  onValidate,
  validationResult,
  executionProgress,
}) => {
  return (
    <div
      className="h-14 flex items-center justify-between px-5 border-b z-10 flex-shrink-0"
      style={{
        background: 'var(--wf-node-bg)',
        borderColor: 'var(--wf-node-border)',
      }}
    >
      {/* Left: back + name */}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="p-2 rounded-lg transition-colors hover:opacity-80"
            style={{ color: 'var(--color-text-secondary, #666)' }}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div>
          <input
            type="text"
            value={workflowName}
            onChange={(e) => onNameChange(e.target.value)}
            className="text-base font-semibold bg-transparent border-none outline-none px-2 py-0.5 rounded"
            style={{ color: 'var(--color-text, #333)' }}
            placeholder="Workflow Name"
          />
          <div className="text-[11px] px-2" style={{ color: 'var(--color-text-tertiary, #999)' }}>
            {nodeCount} nodes &middot; {edgeCount} connections
            {executionProgress && isExecuting && (
              <span style={{ marginLeft: 8, color: '#ff9800', fontWeight: 600 }}>
                {executionProgress.completed}/{executionProgress.total} complete
                {executionProgress.running > 0 && <span style={{ color: '#d29922' }}> · {executionProgress.running} running</span>}
                {executionProgress.failed > 0 && <span style={{ color: '#f44336' }}> · {executionProgress.failed} failed</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* AI Builder */}
        {onToggleAIBuilder && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onToggleAIBuilder}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border"
            style={{
              background: showAIBuilder ? 'rgba(124,77,255,0.08)' : 'transparent',
              borderColor: showAIBuilder ? 'rgba(124,77,255,0.3)' : 'var(--wf-node-border)',
              color: showAIBuilder ? '#7c4dff' : 'var(--color-text-secondary, #666)',
            }}
          >
            <Sparkles className="w-4 h-4" />
            AI Builder
          </motion.button>
        )}

        {/* Auto-arrange */}
        {onAutoLayout && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onAutoLayout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border"
            style={{
              borderColor: 'var(--wf-node-border)',
              color: 'var(--color-text-secondary, #666)',
            }}
            title="Auto-arrange nodes"
          >
            <RotateCw className="w-4 h-4" />
            Arrange
          </motion.button>
        )}

        {/* Share */}
        {onShare && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onShare}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border"
            style={{
              borderColor: 'var(--wf-node-border)',
              color: 'var(--color-text-secondary, #666)',
            }}
          >
            <Share2 className="w-4 h-4" />
            Share
          </motion.button>
        )}

        {/* Validate */}
        {onValidate && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onValidate}
            disabled={!canExecute || isValidating}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border transition-all ${
              !canExecute || isValidating ? 'opacity-60 cursor-not-allowed' : ''
            }`}
            style={{
              background: isValidating ? 'rgba(33,150,243,0.08)'
                : validationResult?.valid === true ? 'rgba(34, 197, 94,0.08)'
                : validationResult?.valid === false ? 'rgba(245,158,11,0.08)'
                : 'transparent',
              borderColor: isValidating ? 'rgba(33,150,243,0.3)'
                : validationResult?.valid === true ? 'rgba(34, 197, 94,0.3)'
                : validationResult?.valid === false ? 'rgba(245,158,11,0.3)'
                : 'var(--wf-node-border)',
              color: isValidating ? '#2196f3'
                : validationResult?.valid === true ? '#22c55e'
                : validationResult?.valid === false ? '#f59e0b'
                : 'var(--color-text-secondary, #666)',
            }}
            title="Validate all nodes have required configuration"
          >
            {isValidating ? (
              <><AlertCircle className="w-4 h-4 animate-spin" /> Checking...</>
            ) : validationResult?.valid === true ? (
              <><CheckCircle className="w-4 h-4" /> Valid</>
            ) : validationResult?.valid === false ? (
              <><AlertCircle className="w-4 h-4" /> {validationResult.summary.errorCount} Error{validationResult.summary.errorCount !== 1 ? 's' : ''}</>
            ) : (
              <><AlertCircle className="w-4 h-4" /> Validate</>
            )}
          </motion.button>
        )}

        {/* Execute */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onExecute}
          disabled={isExecuting || isValidating || !canExecute}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg font-medium text-sm shadow-sm transition-all ${
            isExecuting || isValidating || !canExecute ? 'opacity-40 cursor-not-allowed' : ''
          }`}
          style={{
            background: isExecuting || isValidating || !canExecute ? 'var(--wf-node-border)' : '#22c55e',
            color: isExecuting || isValidating || !canExecute ? 'var(--color-text-tertiary, #999)' : '#fff',
          }}
        >
          {isExecuting ? (
            <><Zap className="w-4 h-4 animate-pulse" /> Running...</>
          ) : (
            <><Play className="w-4 h-4" /> Execute</>
          )}
        </motion.button>

        {/* Save */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onSave}
          disabled={isSaving}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg font-medium text-sm border transition-all ${
            isSaving ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          style={{
            background: saveStatus === 'saved' ? 'rgba(34, 197, 94,0.08)' : saveStatus === 'error' ? 'rgba(244,67,54,0.08)' : 'rgba(33,150,243,0.08)',
            color: saveStatus === 'saved' ? '#22c55e' : saveStatus === 'error' ? '#f44336' : '#2196f3',
            borderColor: saveStatus === 'saved' ? 'rgba(34, 197, 94,0.3)' : saveStatus === 'error' ? 'rgba(244,67,54,0.3)' : 'rgba(33,150,243,0.3)',
          }}
        >
          <Save className="w-4 h-4" />
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Error' : 'Save'}
        </motion.button>
      </div>
    </div>
  );
};
