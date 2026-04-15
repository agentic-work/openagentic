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
 * Human-in-the-Loop (HITL) Panel
 *
 * Slide-in panel showing:
 * - Current HITL enforcement mode (standard, plan, deployment)
 * - Approval history for the current session
 * - Quick mode switcher
 *
 * Triggered by the /hitl slash command.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HITLMode = 'standard' | 'plan' | 'deployment';

export interface HITLLogEntry {
  id: string;
  timestamp: Date;
  toolName: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  action: 'approved' | 'denied' | 'auto-approved' | 'expired';
  intent?: string;
  durationMs?: number;
}

export interface HITLPanelProps {
  visible: boolean;
  onClose: () => void;
  mode: HITLMode;
  onModeChange: (mode: HITLMode) => void;
  log: HITLLogEntry[];
}

// ---------------------------------------------------------------------------
// Mode config
// ---------------------------------------------------------------------------

const MODE_CONFIG: Record<HITLMode, {
  label: string;
  description: string;
  color: string;
  bg: string;
  border: string;
  rules: string[];
}> = {
  standard: {
    label: 'Standard',
    description: 'Default enforcement — approval required for HIGH and CRITICAL risk tools only.',
    color: 'var(--color-success)',
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.3)',
    rules: [
      'LOW risk tools: auto-approved',
      'MEDIUM risk tools: policy-configurable',
      'HIGH risk tools: always requires approval',
      'CRITICAL risk tools: always requires approval',
    ],
  },
  plan: {
    label: 'Plan Mode',
    description: 'Maximum oversight — ALL tool calls require human approval before execution.',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.3)',
    rules: [
      'ALL tools require approval regardless of risk',
      'No auto-approval for any risk level',
      'Ideal for reviewing new workflows',
      'Use during initial deployment validation',
    ],
  },
  deployment: {
    label: 'Deployment Mode',
    description: 'Infrastructure focus — approval required for anything that modifies production resources.',
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.3)',
    rules: [
      'Read-only operations: auto-approved',
      'ANY write/modify/delete operation: requires approval',
      'Infrastructure changes: always requires approval',
      'Credential & secret access: always requires approval',
    ],
  },
};

const RISK_COLORS: Record<string, string> = {
  low: 'var(--color-success)',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#a855f7',
};

const ACTION_STYLES: Record<string, { color: string; label: string }> = {
  'approved': { color: '#00D26A', label: 'Approved' },
  'denied': { color: '#ef4444', label: 'Denied' },
  'auto-approved': { color: '#6b7280', label: 'Auto' },
  'expired': { color: '#f59e0b', label: 'Expired' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const HITLPanel: React.FC<HITLPanelProps> = ({
  visible,
  onClose,
  mode,
  onModeChange,
  log,
}) => {
  const modeConfig = MODE_CONFIG[mode];

  // Stats
  const stats = {
    total: log.length,
    approved: log.filter(e => e.action === 'approved' || e.action === 'auto-approved').length,
    denied: log.filter(e => e.action === 'denied').length,
    expired: log.filter(e => e.action === 'expired').length,
    avgResponseMs: log.filter(e => e.durationMs).reduce((sum, e) => sum + (e.durationMs || 0), 0) / Math.max(1, log.filter(e => e.durationMs).length),
  };

  const panel = (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            key="hitl-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[9990]"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={onClose}
          />

          {/* Slide-in panel */}
          <motion.div
            key="hitl-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-[9991] w-full max-w-md overflow-y-auto"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderLeft: '1px solid var(--color-border)',
              boxShadow: '-8px 0 40px rgba(0,0,0,0.3)',
            }}
          >
            {/* Header */}
            <div
              className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-surface) 95%, transparent)',
                backdropFilter: 'blur(12px)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="p-2 rounded-lg"
                  style={{ backgroundColor: modeConfig.bg, border: `1px solid ${modeConfig.border}` }}
                >
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={modeConfig.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>
                    Human-in-the-Loop
                  </h2>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--color-textMuted)' }}
                  >
                    Approval enforcement & audit trail
                  </span>
                </div>
              </div>

              <button
                onClick={onClose}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--color-textMuted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surfaceSecondary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-5">
              {/* Mode Switcher */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-textMuted)' }}>
                  Enforcement Mode
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(MODE_CONFIG) as HITLMode[]).map((m) => {
                    const cfg = MODE_CONFIG[m];
                    const isActive = mode === m;
                    return (
                      <button
                        key={m}
                        onClick={() => onModeChange(m)}
                        className="px-3 py-2.5 rounded-lg text-center transition-all text-xs font-semibold"
                        style={{
                          backgroundColor: isActive ? cfg.bg : 'transparent',
                          border: `1px solid ${isActive ? cfg.border : 'var(--color-border)'}`,
                          color: isActive ? cfg.color : 'var(--color-textSecondary)',
                          boxShadow: isActive ? `0 0 12px ${cfg.bg}` : 'none',
                        }}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: modeConfig.bg, border: `1px solid ${modeConfig.border}` }}>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                    {modeConfig.description}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {modeConfig.rules.map((rule, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--color-textMuted)' }}>
                        <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: modeConfig.color }} />
                        {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              {/* Session Stats */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-textMuted)' }}>
                  Session Statistics
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Total Requests" value={stats.total} color="var(--color-text)" />
                  <StatCard label="Approved" value={stats.approved} color="var(--color-success)" />
                  <StatCard label="Denied" value={stats.denied} color="#ef4444" />
                  <StatCard label="Avg Response" value={stats.avgResponseMs > 0 ? `${Math.round(stats.avgResponseMs / 1000)}s` : '—'} color="var(--color-textMuted)" />
                </div>
              </section>

              {/* Approval Log */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-textMuted)' }}>
                  Approval Log ({log.length})
                </h3>
                {log.length === 0 ? (
                  <div className="text-center py-8">
                    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="var(--color-textMuted)" strokeWidth={1.5} className="mx-auto mb-2 opacity-40">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <p className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
                      No approval requests yet this session.
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-textMuted)', opacity: 0.6 }}>
                      Requests appear here when tools require human approval.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...log].reverse().map((entry) => {
                      const actionStyle = ACTION_STYLES[entry.action] || ACTION_STYLES['approved'];
                      return (
                        <div
                          key={entry.id}
                          className="p-3 rounded-lg"
                          style={{
                            backgroundColor: 'var(--color-surfaceSecondary)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RISK_COLORS[entry.riskLevel] || '#6b7280' }} />
                              <span className="text-xs font-mono font-semibold" style={{ color: 'var(--color-text)' }}>
                                {entry.toolName}
                              </span>
                            </div>
                            <span
                              className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                              style={{ color: actionStyle.color, backgroundColor: `${actionStyle.color}15` }}
                            >
                              {actionStyle.label}
                            </span>
                          </div>
                          {entry.intent && (
                            <p className="text-xs truncate" style={{ color: 'var(--color-textMuted)' }}>
                              {entry.intent}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px]" style={{ color: 'var(--color-textMuted)', opacity: 0.6 }}>
                              {entry.timestamp.toLocaleTimeString()}
                            </span>
                            {entry.durationMs !== undefined && (
                              <span className="text-[10px]" style={{ color: 'var(--color-textMuted)', opacity: 0.6 }}>
                                {(entry.durationMs / 1000).toFixed(1)}s
                              </span>
                            )}
                            <span
                              className="text-[10px] uppercase"
                              style={{ color: RISK_COLORS[entry.riskLevel] || '#6b7280', opacity: 0.7 }}
                            >
                              {entry.riskLevel}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(panel, document.body);
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatCard: React.FC<{ label: string; value: string | number; color: string }> = ({ label, value, color }) => (
  <div
    className="p-3 rounded-lg text-center"
    style={{
      backgroundColor: 'var(--color-surfaceSecondary)',
      border: '1px solid var(--color-border)',
    }}
  >
    <div className="text-lg font-bold font-mono tabular-nums" style={{ color }}>
      {value}
    </div>
    <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
      {label}
    </div>
  </div>
);

export default HITLPanel;
