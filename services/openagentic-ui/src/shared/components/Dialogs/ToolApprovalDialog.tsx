/**
 * Tool Approval Dialog
 * Shows tools that AI wants to execute and requires human approval
 * Displays tool names and exact arguments for approval
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Check, X, Wrench, AlertTriangle } from '@/shared/icons';

interface Tool {
  id: string;
  name: string;
  arguments: string; // JSON string
}

interface ToolApprovalDialogProps {
  tools: Tool[];
  toolCallRound: number;
  onApprove: () => void;
  onReject: () => void;
}

const ToolApprovalDialog: React.FC<ToolApprovalDialogProps> = ({
  tools,
  toolCallRound,
  onApprove,
  onReject
}) => {
  if (!tools || tools.length === 0) return null;

  // Parse arguments safely
  const parseArguments = (argsString: string) => {
    try {
      return JSON.parse(argsString);
    } catch {
      return argsString;
    }
  };

  // Check if any tool is dangerous
  const hasDangerousTools = tools.some(tool => {
    const name = tool.name.toLowerCase();
    return name.includes('delete') ||
           name.includes('remove') ||
           name.includes('destroy') ||
           name.includes('set') ||
           name.includes('update') ||
           name.includes('modify') ||
           name.includes('lock');
  });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-shadow) 75%, transparent)',
          backdropFilter: 'blur(4px)'
        }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          className="rounded-panel p-6 max-w-3xl w-full shadow-soft-lg max-h-[80vh] overflow-hidden flex flex-col"
          style={{
            backgroundColor: 'var(--surface-2)',
          }}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-lg" style={{
              backgroundColor: hasDangerousTools ? 'var(--callout-error-bg)' : 'var(--callout-warning-bg)'
            }}>
              {hasDangerousTools ? (
                <AlertTriangle className="w-6 h-6" style={{ color: 'var(--color-error)' }} />
              ) : (
                <Shield className="w-6 h-6" style={{ color: 'var(--color-warning)' }} />
              )}
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
                Tool Execution Approval Required
              </h3>
              <p className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                Round {toolCallRound} • {tools.length} tool{tools.length > 1 ? 's' : ''} to execute
              </p>
            </div>
          </div>

          {/* Warning for dangerous tools */}
          {hasDangerousTools && (
            <div className="mb-4 p-3 rounded-lg" style={{
              backgroundColor: 'var(--callout-error-bg)',
              border: '1px solid var(--callout-error-border)'
            }}>
              <p className="text-sm font-medium" style={{ color: 'var(--color-error)' }}>
                ⚠️ Warning: Some of these tools perform WRITE, DELETE, or MODIFY operations!
              </p>
            </div>
          )}

          {/* Tool List */}
          <div className="flex-1 overflow-y-auto mb-4 space-y-3">
            {tools.map((tool, index) => {
              const args = parseArguments(tool.arguments);
              const isDangerous = tool.name.toLowerCase().includes('delete') ||
                                  tool.name.toLowerCase().includes('remove') ||
                                  tool.name.toLowerCase().includes('set') ||
                                  tool.name.toLowerCase().includes('update') ||
                                  tool.name.toLowerCase().includes('modify') ||
                                  tool.name.toLowerCase().includes('lock');

              return (
                <div
                  key={tool.id}
                  className="p-4 rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-surfaceSecondary)',
                    border: isDangerous ? '1px solid var(--color-error)' : '1px solid var(--color-border)'
                  }}
                >
                  {/* Tool Name */}
                  <div className="flex items-center gap-2 mb-2">
                    <Wrench className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
                    <span className="font-semibold font-mono text-sm" style={{ color: 'var(--color-text)' }}>
                      {tool.name}
                    </span>
                    {isDangerous && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={{
                        backgroundColor: 'var(--callout-error-bg)',
                        color: 'var(--color-error)'
                      }}>
                        DANGEROUS
                      </span>
                    )}
                  </div>

                  {/* Arguments */}
                  {args && (typeof args === 'object' ? Object.keys(args).length > 0 : true) && (
                    <div className="mt-3 p-3 rounded-lg" style={{
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)'
                    }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-textSecondary)' }}>
                        Arguments:
                      </p>
                      <pre className="text-xs overflow-x-auto font-mono" style={{
                        color: 'var(--color-text)',
                        maxHeight: '200px'
                      }}>
                        {typeof args === 'object' ? JSON.stringify(args, null, 2) : String(args)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Info */}
          <div className="mb-4 p-3 rounded-lg" style={{
            backgroundColor: 'var(--callout-info-bg)',
            border: '1px solid var(--callout-info-border)'
          }}>
            <p className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>
              💡 Review the exact operations above before approving. These tools will execute with the shown arguments.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onReject}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-pill font-medium transition-[background,color,opacity,transform] duration-200 ease-emphasized active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-surfaceSecondary)';
              }}
            >
              <X className="w-5 h-5" />
              Reject
            </button>
            <button
              onClick={onApprove}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-pill font-medium transition-[background,color,opacity,transform] duration-200 ease-emphasized active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--color-primary)',
                color: 'white'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '0.9';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              <Check className="w-5 h-5" />
              Approve & Execute
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ToolApprovalDialog;
