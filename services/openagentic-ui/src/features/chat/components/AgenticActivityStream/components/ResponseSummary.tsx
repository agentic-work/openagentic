/**
 * ResponseSummary - End-of-Response Summary Card
 *
 * Displays after AI response completion:
 * - List of accomplishments
 * - Key findings/data points
 * - Caveats or warnings
 * - Suggested next actions
 */

import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Lightbulb,
  AlertTriangle,
  ArrowRight,
  ListTodo,
} from '@/shared/icons';

import type {
  ResponseSummaryProps,
  SuggestedAction,
  KeyFinding,
} from '../types/activity.types';

// Suggested action button component
const ActionButton: React.FC<{
  action: SuggestedAction;
  onClick?: () => void;
}> = ({ action, onClick }) => {
  const variantClasses = {
    primary: 'bg-[var(--color-primary)] text-white hover:opacity-90',
    secondary: 'bg-[var(--color-surfaceSecondary)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]',
    outline: 'border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]',
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
        transition-all duration-200
        ${variantClasses[action.variant || 'secondary']}
      `}
    >
      {action.icon && <span>{action.icon}</span>}
      <span>{action.label}</span>
      <ArrowRight size={14} className="opacity-60" />
    </motion.button>
  );
};

// Key finding pill
const KeyFindingPill: React.FC<{ finding: KeyFinding }> = ({ finding }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-surfaceSecondary)] text-sm">
    {finding.icon && <span>{finding.icon}</span>}
    <span className="text-[var(--color-textMuted)]">{finding.label}:</span>
    <span className="font-medium text-[var(--color-text)]">{finding.value}</span>
  </div>
);

export const ResponseSummaryComponent: React.FC<ResponseSummaryProps> = ({
  accomplishments,
  keyFindings,
  caveats,
  suggestedActions,
  onActionClick,
  className = '',
}) => {
  const handleActionClick = useCallback((action: SuggestedAction) => {
    onActionClick?.(action);
  }, [onActionClick]);

  if (
    accomplishments.length === 0 &&
    (!keyFindings || keyFindings.length === 0) &&
    (!caveats || caveats.length === 0) &&
    suggestedActions.length === 0
  ) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className={`
        response-summary
        bg-[var(--color-surfaceSecondary)]/50
        backdrop-blur-sm
        border border-[var(--color-border)]/30
        rounded-lg
        overflow-hidden
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]/20">
        <ListTodo className="w-4 h-4 text-[var(--color-primary)]" />
        <span className="text-sm font-medium text-[var(--color-text)]">
          Summary
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Accomplishments */}
        {accomplishments.length > 0 && (
          <div className="space-y-2">
            {accomplishments.map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-start gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] flex-shrink-0 mt-0.5" />
                <span className="text-sm text-[var(--color-text)]">{item}</span>
              </motion.div>
            ))}
          </div>
        )}

        {/* Key findings */}
        {keyFindings && keyFindings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {keyFindings.map((finding, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 + index * 0.05 }}
              >
                <KeyFindingPill finding={finding} />
              </motion.div>
            ))}
          </div>
        )}

        {/* Caveats */}
        {caveats && caveats.length > 0 && (
          <div className="space-y-2 p-3 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30">
            {caveats.map((caveat, index) => (
              <div key={index} className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
                <span className="text-sm text-[var(--color-text)]">{caveat}</span>
              </div>
            ))}
          </div>
        )}

        {/* Suggested actions */}
        {suggestedActions.length > 0 && (
          <div className="pt-2">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="w-4 h-4 text-[var(--color-textMuted)]" />
              <span className="text-xs font-medium text-[var(--color-textMuted)] uppercase">
                What would you like to do next?
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {suggestedActions.map((action, index) => (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                >
                  <ActionButton
                    action={action}
                    onClick={() => handleActionClick(action)}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default ResponseSummaryComponent;
