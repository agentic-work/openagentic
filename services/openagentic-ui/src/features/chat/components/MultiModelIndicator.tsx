import React, { useState, useEffect } from 'react';
import { onKeyActivate } from '@/utils/a11y';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Wrench, FileOutput, AlertTriangle, Zap, ArrowRight, Check, Loader2 } from '@/shared/icons';

export interface MultiModelRole {
  role: 'reasoning' | 'tool_execution' | 'synthesis' | 'fallback';
  model: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  duration?: number;
  cost?: number;
}

export interface MultiModelState {
  orchestrationId: string;
  active: boolean;
  currentRole?: string;
  roles: MultiModelRole[];
  handoffCount: number;
  totalCost?: number;
  totalDuration?: number;
}

interface MultiModelIndicatorProps {
  state: MultiModelState;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const ROLE_CONFIG = {
  reasoning: {
    icon: Brain,
    color: 'purple',
    label: 'Reasoning',
    description: 'Analyzing & Planning'
  },
  tool_execution: {
    icon: Wrench,
    color: 'blue',
    label: 'Tools',
    description: 'Executing Functions'
  },
  synthesis: {
    icon: FileOutput,
    color: 'green',
    label: 'Synthesis',
    description: 'Generating Response'
  },
  fallback: {
    icon: AlertTriangle,
    color: 'orange',
    label: 'Fallback',
    description: 'Recovery Mode'
  }
};

const RoleIndicator: React.FC<{ role: MultiModelRole; isActive: boolean }> = ({ role, isActive }) => {
  const config = ROLE_CONFIG[role.role];
  const Icon = config.icon;
  
  const statusColors = {
    pending: 'text-gray-400 bg-gray-500/10',
    active: `text-${config.color}-400 bg-${config.color}-500/20`,
    complete: `text-${config.color}-500 bg-${config.color}-500/10`,
    error: 'text-red-400 bg-red-500/10'
  };

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${statusColors[role.status]} ${
        isActive ? 'ring-2 ring-offset-2 ring-offset-gray-900' : ''
      }`}
      style={isActive ? { ringColor: `var(--${config.color}-500)` } as any : {}}
    >
      {role.status === 'active' ? (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 size={14} />
        </motion.div>
      ) : role.status === 'complete' ? (
        <Check size={14} className="text-green-500" />
      ) : (
        <Icon size={14} />
      )}
      <span className="text-xs font-medium">{config.label}</span>
      {role.duration ? (
        <span className="text-[10px] opacity-60">{(role.duration / 1000).toFixed(1)}s</span>
      ) : null}
    </motion.div>
  );
};

export const MultiModelIndicator: React.FC<MultiModelIndicatorProps> = ({
  state,
  expanded = false,
  onToggleExpand
}) => {
  const [isExpanded, setIsExpanded] = useState(expanded);

  useEffect(() => {
    setIsExpanded(expanded);
  }, [expanded]);

  if (!state.active && state.roles.length === 0) {
    return null;
  }

  const activeRole = state.roles.find(r => r.status === 'active');
  const completedRoles = state.roles.filter(r => r.status === 'complete');
  
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="mb-3"
    >
      {/* Compact View */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className="flex items-center gap-3 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500/10 via-cyan-500/10 to-green-500/10 border border-white/10 cursor-pointer hover:border-white/20 transition-colors"
        onClick={() => {
          setIsExpanded(!isExpanded);
          onToggleExpand?.();
        }}
        onKeyDown={onKeyActivate(() => {
          setIsExpanded(!isExpanded);
          onToggleExpand?.();
        })}
      >
        <div className="flex items-center gap-1.5">
          <Zap size={14} className="text-yellow-500" />
          <span className="text-xs font-medium text-text-primary">Multi-Model</span>
        </div>

        {/* Role Pipeline Visualization */}
        <div className="flex-1 flex items-center gap-1">
          {state.roles.map((role, idx) => (
            <React.Fragment key={role.role}>
              <RoleIndicator 
                role={role} 
                isActive={role.status === 'active'} 
              />
              {idx < state.roles.length - 1 && (
                <ArrowRight size={12} className="text-gray-500" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-[10px] text-text-secondary">
          {state.handoffCount > 0 && (
            <span>{state.handoffCount} handoff{state.handoffCount > 1 ? 's' : ''}</span>
          )}
          {state.totalCost !== undefined && (
            <span>${state.totalCost.toFixed(4)}</span>
          )}
        </div>
      </div>

      {/* Expanded View */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 p-4 rounded-lg bg-gray-900/50 border border-white/10"
          >
            <div className="space-y-3">
              {state.roles.map((role) => {
                const config = ROLE_CONFIG[role.role];
                const Icon = config.icon;
                
                return (
                  <div 
                    key={role.role}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                      role.status === 'active' 
                        ? `bg-${config.color}-500/10 border-${config.color}-500/30`
                        : 'bg-[var(--color-surface-2)] border-[var(--color-border)]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-${config.color}-500/20`}>
                        <Icon size={16} className={`text-${config.color}-400`} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-text-primary">
                          {config.label}
                        </div>
                        <div className="text-xs text-text-secondary">
                          {role.model}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      {role.status === 'active' && (
                        <motion.span
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className="text-xs text-text-secondary"
                        >
                          {config.description}...
                        </motion.span>
                      )}
                      
                      {role.duration ? (
                        <span className="text-xs text-text-secondary">
                          {(role.duration / 1000).toFixed(2)}s
                        </span>
                      ) : null}
                      
                      {role.cost !== undefined && (
                        <span className="text-xs text-text-secondary">
                          ${role.cost.toFixed(4)}
                        </span>
                      )}
                      
                      <div className={`w-2 h-2 rounded-full ${
                        role.status === 'active' ? 'bg-yellow-500 animate-pulse' :
                        role.status === 'complete' ? 'bg-green-500' :
                        role.status === 'error' ? 'bg-red-500' :
                        'bg-gray-500'
                      }`} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            {state.totalDuration !== undefined && (
              <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs text-text-secondary">
                <span>
                  Total: {(state.totalDuration / 1000).toFixed(2)}s | {state.handoffCount} handoff{state.handoffCount !== 1 ? 's' : ''}
                </span>
                {state.totalCost !== undefined && (
                  <span className="font-medium">
                    Total Cost: ${state.totalCost.toFixed(4)}
                  </span>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/**
 * Compact badge to show in message header when multi-model was used
 */
export const MultiModelBadge: React.FC<{ 
  rolesUsed: string[]; 
  totalCost?: number;
  onClick?: () => void;
}> = ({ rolesUsed, totalCost, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-300 hover:from-blue-500/30 hover:to-cyan-500/30 transition-colors"
    >
      <Zap size={10} />
      <span>Multi-Model</span>
      <span className="opacity-60">({rolesUsed.length} roles)</span>
      {totalCost !== undefined && (
        <span className="opacity-60">${totalCost.toFixed(3)}</span>
      )}
    </button>
  );
};

export default MultiModelIndicator;
