/**
 * Artifact Diff Renderer
 *
 * GitHub-style diff visualization for artifact updates
 * Shows additions in green (+) and deletions in red (-) with line numbers
 *
 * When an LLM updates an existing artifact, this component shows the changes
 * rather than re-rendering the entire artifact, saving tokens and providing
 * better visual feedback on what changed.
 */

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch,
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Eye,
  Code
} from '@/shared/icons';

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface ArtifactDiffRendererProps {
  originalCode: string;
  modifiedCode: string;
  language?: string;
  title?: string;
  theme?: 'light' | 'dark';
  onApply?: () => void;
  onReject?: () => void;
}

// Simple diff algorithm - computes line-level differences
const computeDiff = (original: string, modified: string): DiffHunk[] => {
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');

  // LCS-based diff for better results
  const lcs = computeLCS(oldLines, newLines);
  const hunks: DiffHunk[] = [];

  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;
  let currentHunk: DiffHunk | null = null;

  const startHunk = (oldStart: number, newStart: number): DiffHunk => ({
    oldStart,
    oldCount: 0,
    newStart,
    newCount: 0,
    lines: []
  });

  const flushHunk = () => {
    if (currentHunk && currentHunk.lines.length > 0) {
      hunks.push(currentHunk);
      currentHunk = null;
    }
  };

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && newIdx < newLines.length) {
      const [lcsOldIdx, lcsNewIdx] = lcs[lcsIdx];

      // Add deletions before LCS match
      while (oldIdx < lcsOldIdx) {
        if (!currentHunk) currentHunk = startHunk(oldIdx + 1, newIdx + 1);
        currentHunk.lines.push({
          type: 'remove',
          content: oldLines[oldIdx],
          oldLineNumber: oldIdx + 1
        });
        currentHunk.oldCount++;
        oldIdx++;
      }

      // Add additions before LCS match
      while (newIdx < lcsNewIdx) {
        if (!currentHunk) currentHunk = startHunk(oldIdx + 1, newIdx + 1);
        currentHunk.lines.push({
          type: 'add',
          content: newLines[newIdx],
          newLineNumber: newIdx + 1
        });
        currentHunk.newCount++;
        newIdx++;
      }

      // Add context line (matching line)
      if (currentHunk) {
        currentHunk.lines.push({
          type: 'context',
          content: oldLines[oldIdx],
          oldLineNumber: oldIdx + 1,
          newLineNumber: newIdx + 1
        });
        currentHunk.oldCount++;
        currentHunk.newCount++;
      }

      // If no current hunk, this is just context we skip (add 3 lines context around changes)
      oldIdx++;
      newIdx++;
      lcsIdx++;

      // End hunk after 3 consecutive context lines
      if (currentHunk) {
        const lastThree = currentHunk.lines.slice(-3);
        if (lastThree.every(l => l.type === 'context')) {
          flushHunk();
        }
      }
    } else {
      // Remaining lines after LCS
      while (oldIdx < oldLines.length) {
        if (!currentHunk) currentHunk = startHunk(oldIdx + 1, newIdx + 1);
        currentHunk.lines.push({
          type: 'remove',
          content: oldLines[oldIdx],
          oldLineNumber: oldIdx + 1
        });
        currentHunk.oldCount++;
        oldIdx++;
      }

      while (newIdx < newLines.length) {
        if (!currentHunk) currentHunk = startHunk(oldIdx + 1, newIdx + 1);
        currentHunk.lines.push({
          type: 'add',
          content: newLines[newIdx],
          newLineNumber: newIdx + 1
        });
        currentHunk.newCount++;
        newIdx++;
      }
    }
  }

  flushHunk();
  return hunks;
};

// Longest Common Subsequence for line matching
const computeLCS = (oldLines: string[], newLines: string[]): [number, number][] => {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS indices
  const result: [number, number][] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
};

export const ArtifactDiffRenderer: React.FC<ArtifactDiffRendererProps> = ({
  originalCode,
  modifiedCode,
  language = 'text',
  title,
  theme = 'dark',
  onApply,
  onReject
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Compute diff
  const hunks = useMemo(() => computeDiff(originalCode, modifiedCode), [originalCode, modifiedCode]);

  // Count additions and deletions
  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    hunks.forEach(hunk => {
      hunk.lines.forEach(line => {
        if (line.type === 'add') additions++;
        if (line.type === 'remove') deletions++;
      });
    });
    return { additions, deletions };
  }, [hunks]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(modifiedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const isDark = theme === 'dark';

  return (
    <div
      className="artifact-diff-renderer"
      style={{
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid',
        borderColor: 'var(--cm-border)',
        background: 'var(--cm-bg)',
        marginBottom: '16px'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'var(--cm-bg-secondary)',
          borderBottom: '1px solid',
          borderColor: 'var(--cm-border)',
          cursor: 'pointer'
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <GitBranch size={16} style={{ color: 'var(--cm-text-muted)' }} />
          <span style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--cm-text)'
          }}>
            {title || 'Artifact Update'}
          </span>
          <span style={{
            fontSize: '11px',
            color: 'var(--cm-text-muted)'
          }}>
            {language}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Stats */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--cm-success)' }}>
              <Plus size={12} />
              {stats.additions}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: 'var(--cm-error)' }}>
              <Minus size={12} />
              {stats.deletions}
            </span>
          </div>

          {/* Toggle Preview */}
          <button
            onClick={(e) => { e.stopPropagation(); setShowPreview(!showPreview); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid',
              borderColor: 'var(--cm-border)',
              borderRadius: '6px',
              cursor: 'pointer',
              color: 'var(--cm-text-muted)',
              fontSize: '11px'
            }}
          >
            {showPreview ? <Code size={12} /> : <Eye size={12} />}
            {showPreview ? 'Diff' : 'Preview'}
          </button>

          {/* Copy */}
          <button
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            style={{
              padding: '4px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--cm-text-muted)'
            }}
          >
            {copied ? <Check size={14} style={{ color: 'var(--cm-success)' }} /> : <Copy size={14} />}
          </button>

          {/* Expand */}
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            {showPreview ? (
              // Preview mode - show modified code
              <pre
                style={{
                  margin: 0,
                  padding: '16px',
                  overflow: 'auto',
                  maxHeight: '400px',
                  fontSize: '13px',
                  lineHeight: '1.5',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                  color: 'var(--cm-text)',
                  background: 'var(--cm-bg)'
                }}
              >
                {modifiedCode}
              </pre>
            ) : (
              // Diff mode - show hunks
              <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                {hunks.length === 0 ? (
                  <div style={{
                    padding: '20px',
                    textAlign: 'center',
                    color: 'var(--cm-text-muted)',
                    fontSize: '13px'
                  }}>
                    No changes detected
                  </div>
                ) : (
                  hunks.map((hunk, hunkIdx) => (
                    <div key={hunkIdx}>
                      {/* Hunk header */}
                      <div style={{
                        padding: '8px 16px',
                        background: 'color-mix(in srgb, var(--cm-info) 10%, transparent)',
                        color: 'var(--cm-info)',
                        fontSize: '12px',
                        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
                      }}>
                        @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                      </div>

                      {/* Diff lines */}
                      {hunk.lines.map((line, lineIdx) => (
                        <div
                          key={lineIdx}
                          style={{
                            display: 'flex',
                            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                            fontSize: '13px',
                            lineHeight: '1.5',
                            background: line.type === 'add'
                              ? 'color-mix(in srgb, var(--cm-success) 15%, transparent)'
                              : line.type === 'remove'
                                ? 'color-mix(in srgb, var(--cm-error) 15%, transparent)'
                                : 'transparent'
                          }}
                        >
                          {/* Line numbers */}
                          <div style={{
                            display: 'flex',
                            minWidth: '80px',
                            borderRight: '1px solid',
                            borderColor: 'var(--cm-border)',
                            color: 'var(--cm-text-muted)',
                            fontSize: '12px',
                            userSelect: 'none'
                          }}>
                            <span style={{
                              width: '40px',
                              textAlign: 'right',
                              padding: '0 8px',
                              background: line.type === 'remove'
                                ? 'color-mix(in srgb, var(--cm-error) 20%, transparent)'
                                : 'transparent'
                            }}>
                              {line.oldLineNumber || ''}
                            </span>
                            <span style={{
                              width: '40px',
                              textAlign: 'right',
                              padding: '0 8px',
                              background: line.type === 'add'
                                ? 'color-mix(in srgb, var(--cm-success) 20%, transparent)'
                                : 'transparent'
                            }}>
                              {line.newLineNumber || ''}
                            </span>
                          </div>

                          {/* Line indicator */}
                          <div style={{
                            width: '24px',
                            textAlign: 'center',
                            color: line.type === 'add' ? 'var(--cm-success)' : line.type === 'remove' ? 'var(--cm-error)' : 'transparent',
                            fontWeight: 600
                          }}>
                            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                          </div>

                          {/* Line content */}
                          <pre style={{
                            margin: 0,
                            padding: '0 8px',
                            flex: 1,
                            whiteSpace: 'pre',
                            overflow: 'visible',
                            color: 'var(--cm-text)'
                          }}>
                            {line.content || ' '}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      {(onApply || onReject) && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '8px',
          padding: '10px 14px',
          borderTop: '1px solid',
          borderColor: 'var(--cm-border)',
          background: 'var(--cm-bg-secondary)'
        }}>
          {onReject && (
            <button
              onClick={onReject}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid',
                borderColor: 'color-mix(in srgb, var(--cm-error) 50%, transparent)',
                borderRadius: '6px',
                cursor: 'pointer',
                color: 'var(--cm-error)',
                fontSize: '12px',
                fontWeight: 500
              }}
            >
              Reject
            </button>
          )}
          {onApply && (
            <button
              onClick={onApply}
              style={{
                padding: '6px 12px',
                background: 'var(--cm-success)',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                color: 'var(--cm-bg)',
                fontSize: '12px',
                fontWeight: 500
              }}
            >
              Apply Changes
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ArtifactDiffRenderer;
