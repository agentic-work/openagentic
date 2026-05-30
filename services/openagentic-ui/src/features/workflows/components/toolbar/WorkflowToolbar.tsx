/**
 * WorkflowToolbar - Top bar with name, node toggle, execute, save buttons
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Save, ArrowLeft, Grid3x3, Zap, Share2, Sparkles, RotateCw, AlertCircle, CheckCircle, Clock, Pause, Square, RefreshCw } from '@/shared/icons';
import { CostEstimateBadge } from '../CostEstimateBadge';
import type { FlowCostEstimate } from '../../hooks/useFlowCostEstimate';
import { FlowExportImportButton } from '../FlowExportImportButton';

export type ExecutionState = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

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
  /** Open the version history panel */
  onShowHistory?: () => void;
  /** Save with an optional changelog message (creates a new version) */
  onSaveWithChangelog?: (changelog: string) => void;
  /** Current execution lifecycle state */
  executionState?: ExecutionState;
  /** Called when user clicks Pause during a running execution */
  onPause?: () => void;
  /** Called when user clicks Resume during a paused execution */
  onResume?: () => void;
  /** Called when user confirms Cancel in the confirmation dialog */
  onCancel?: () => void;
  /** Pre-run cost estimate for the current flow. When provided and
   *  ratesLoaded && totalUsd > 0, a "$X.XX" badge renders next to Run. */
  costEstimate?: FlowCostEstimate | null;
  /** Returns the current flow as a JSON string for the Export button.
   *  When omitted, the export/import controls don't render. */
  getFlowJson?: () => string | null;
  /** Called with the raw text of an imported JSON file (or null if
   *  it failed to parse). The parent applies the new definition. */
  onImportFlowJson?: (text: string | null) => void;
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
  onShowHistory,
  onSaveWithChangelog,
  executionState = 'idle',
  onPause,
  onResume,
  onCancel,
  costEstimate,
  getFlowJson,
  onImportFlowJson,
}) => {
  const [showChangelogPrompt, setShowChangelogPrompt] = useState(false);
  const [changelogMessage, setChangelogMessage] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const isActiveExecution = executionState === 'running' || executionState === 'paused';

  const handleCancelClick = () => setShowCancelConfirm(true);
  const handleCancelConfirm = () => {
    setShowCancelConfirm(false);
    onCancel?.();
  };
  const handleCancelDismiss = () => setShowCancelConfirm(false);

  // QA-2026-05-05 (#9): a one-click Save runs without prompting. Holding
  // Shift opens the changelog dialog for an explicit version note. This
  // removes the friction of "every save = modal" while keeping the
  // changelog path discoverable.
  const handleSaveClick = (e?: React.MouseEvent) => {
    if (onSaveWithChangelog && e?.shiftKey) {
      setChangelogMessage('');
      setShowChangelogPrompt(true);
    } else {
      onSave();
    }
  };

  const handleChangelogSubmit = () => {
    setShowChangelogPrompt(false);
    onSaveWithChangelog?.(changelogMessage);
  };

  const handleChangelogCancel = () => {
    setShowChangelogPrompt(false);
    setChangelogMessage('');
  };

  return (
    <>
    {/* Cancel execution confirmation dialog */}
    <AnimatePresence>
      {showCancelConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          data-testid="cancel-confirm-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div style={{
            background: 'var(--wf-node-bg, #161b22)',
            border: '1px solid var(--wf-node-border, #30363d)',
            borderRadius: 10,
            padding: 20,
            minWidth: 320,
            maxWidth: 400,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--color-text, #e4e4e7)' }}>
              Cancel Execution?
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #71717a)', marginBottom: 16 }}>
              This will stop the running workflow and mark it as cancelled. This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                data-testid="cancel-confirm-dismiss"
                onClick={handleCancelDismiss}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12,
                  border: '1px solid var(--wf-node-border, #30363d)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary, #71717a)',
                  cursor: 'pointer',
                }}
              >
                Keep Running
              </button>
              <button
                data-testid="cancel-confirm-ok"
                onClick={handleCancelConfirm}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12,
                  background: 'rgba(244,67,54,0.15)',
                  border: '1px solid rgba(244,67,54,0.3)',
                  color: '#f44336',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Cancel Execution
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Changelog prompt dialog */}
    <AnimatePresence>
      {showChangelogPrompt && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          data-testid="changelog-prompt"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div style={{
            background: 'var(--wf-node-bg, #161b22)',
            border: '1px solid var(--wf-node-border, #30363d)',
            borderRadius: 10,
            padding: 20,
            minWidth: 340,
            maxWidth: 420,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: 'var(--color-text, #e4e4e7)' }}>
              Save Version
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #71717a)', marginBottom: 12 }}>
              Optional: describe what changed in this version
            </div>
            <input
              data-testid="changelog-input"
              type="text"
              value={changelogMessage}
              onChange={(e) => setChangelogMessage(e.target.value)}
              placeholder="e.g. Fixed prompt template, added HTTP node..."
              autoFocus
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--wf-node-border, #30363d)',
                background: 'var(--color-bg-secondary, #0d1117)',
                color: 'var(--color-text, #e4e4e7)',
                fontSize: 12,
                marginBottom: 16,
                boxSizing: 'border-box',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleChangelogSubmit();
                if (e.key === 'Escape') handleChangelogCancel();
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleChangelogCancel}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12,
                  border: '1px solid var(--wf-node-border, #30363d)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary, #71717a)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                data-testid="changelog-submit"
                onClick={handleChangelogSubmit}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12,
                  background: 'rgba(33,150,243,0.15)',
                  border: '1px solid rgba(33,150,243,0.3)',
                  color: '#2196f3',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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

        {/* Export / Import flow JSON — sits next to History so it's in
            the user's "save / version" mental cluster, not the Run path. */}
        {(getFlowJson || onImportFlowJson) && (
          <FlowExportImportButton
            flowName={workflowName}
            getFlowJson={getFlowJson || (() => null)}
            onImport={(text) => onImportFlowJson?.(text)}
          />
        )}

        {/* History */}
        {onShowHistory && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onShowHistory}
            data-testid="workflow-history-button"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border"
            style={{
              borderColor: 'var(--wf-node-border)',
              color: 'var(--color-text-secondary, #666)',
            }}
            title="Version history"
          >
            <Clock className="w-4 h-4" />
            History
          </motion.button>
        )}

        {/* Pause / Resume — visible only when an execution is active */}
        {isActiveExecution && executionState === 'running' && onPause && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onPause}
            data-testid="workflow-pause-button"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border"
            style={{
              background: 'rgba(255,152,0,0.08)',
              borderColor: 'rgba(255,152,0,0.3)',
              color: '#ff9800',
            }}
            title="Pause execution"
          >
            <Pause className="w-4 h-4" />
            Pause
          </motion.button>
        )}

        {isActiveExecution && executionState === 'paused' && onResume && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onResume}
            data-testid="workflow-resume-button"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border"
            style={{
              background: 'rgba(34,197,94,0.08)',
              borderColor: 'rgba(34,197,94,0.3)',
              color: '#22c55e',
            }}
            title="Resume execution"
          >
            <RefreshCw className="w-4 h-4" />
            Resume
          </motion.button>
        )}

        {/* Cancel — visible when running or paused */}
        {isActiveExecution && onCancel && (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleCancelClick}
            data-testid="workflow-cancel-button"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm border"
            style={{
              background: 'rgba(244,67,54,0.08)',
              borderColor: 'rgba(244,67,54,0.3)',
              color: '#f44336',
            }}
            title="Cancel execution"
          >
            <Square className="w-4 h-4" />
            Cancel
          </motion.button>
        )}

        {/* Cost preview — renders inside CostEstimateBadge only when
         * ratesLoaded && totalUsd > 0. Otherwise null. */}
        {costEstimate && <CostEstimateBadge estimate={costEstimate} />}

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
          onClick={handleSaveClick}
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
    </>
  );
};
