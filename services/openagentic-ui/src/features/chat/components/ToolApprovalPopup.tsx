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
 * Tool Approval Popup — Full-screen HITL Modal
 *
 * Centers in the viewport over a dark backdrop. Pulsing risk-colored border,
 * large approve/deny buttons, countdown timer, optional code preview.
 * Designed to be IMPOSSIBLE TO MISS — blocks all interaction until resolved.
 *
 * SSE events handled:
 *   - tool_approval_request  { toolCallRound, tools, messageId }
 *   - synth_approval_required { approvalId, intent, riskLevel, code, explanation, expiresAt }
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolApprovalPopupProps {
  visible: boolean;
  approvalId?: string;
  intent: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  tools?: Array<{ id: string; name: string; arguments: any }>;
  code?: string;
  expiresAt?: string;
  onApprove: () => void;
  onDeny: () => void;
}

// ---------------------------------------------------------------------------
// Risk config
// ---------------------------------------------------------------------------

const RISK_CONFIG: Record<
  ToolApprovalPopupProps['riskLevel'],
  {
    label: string;
    color: string;
    bg: string;
    border: string;
    glow: string;
    gradientFrom: string;
    gradientTo: string;
    pulseColor: string;
    icon: 'shield' | 'alert' | 'zap' | 'skull';
  }
> = {
  low: {
    label: 'Low Risk',
    color: '#00D26A',
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.4)',
    glow: 'rgba(34,197,94,0.20)',
    gradientFrom: '#00D26A',
    gradientTo: '#16a34a',
    pulseColor: 'rgba(34,197,94,0.15)',
    icon: 'shield',
  },
  medium: {
    label: 'Medium Risk',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.4)',
    glow: 'rgba(245,158,11,0.20)',
    gradientFrom: '#f59e0b',
    gradientTo: '#d97706',
    pulseColor: 'rgba(245,158,11,0.15)',
    icon: 'alert',
  },
  high: {
    label: 'High Risk',
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.5)',
    glow: 'rgba(239,68,68,0.30)',
    gradientFrom: '#ef4444',
    gradientTo: '#dc2626',
    pulseColor: 'rgba(239,68,68,0.20)',
    icon: 'zap',
  },
  critical: {
    label: 'CRITICAL',
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.12)',
    border: 'rgba(168,85,247,0.6)',
    glow: 'rgba(168,85,247,0.35)',
    gradientFrom: '#a855f7',
    gradientTo: '#7c3aed',
    pulseColor: 'rgba(168,85,247,0.25)',
    icon: 'skull',
  },
};

// ---------------------------------------------------------------------------
// SVG Icons — large, prominent
// ---------------------------------------------------------------------------

const ShieldIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

const AlertIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ZapIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const SkullIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="10" r="8" />
    <path d="M8 14v4h2l1 2h2l1-2h2v-4" />
    <circle cx="9" cy="10" r="1.5" fill={color} />
    <circle cx="15" cy="10" r="1.5" fill={color} />
  </svg>
);

const RiskIcon: React.FC<{ type: string; color: string }> = ({ type, color }) => {
  switch (type) {
    case 'alert': return <AlertIcon color={color} />;
    case 'zap': return <ZapIcon color={color} />;
    case 'skull': return <SkullIcon color={color} />;
    default: return <ShieldIcon color={color} />;
  }
};

const ChevronIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ---------------------------------------------------------------------------
// Audio alert — short beep via Web Audio API
// ---------------------------------------------------------------------------

function playAlertSound(riskLevel: string) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    // Frequency and pattern based on risk
    const freq = riskLevel === 'critical' ? 880 : riskLevel === 'high' ? 660 : riskLevel === 'medium' ? 520 : 440;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);

    // Double beep for high/critical
    if (riskLevel === 'high' || riskLevel === 'critical') {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.setValueAtTime(freq * 1.2, ctx.currentTime + 0.2);
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.15, ctx.currentTime + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc2.start(ctx.currentTime + 0.2);
      osc2.stop(ctx.currentTime + 0.6);
    }
  } catch {
    // Web Audio not available — silent fallback
  }
}

// ---------------------------------------------------------------------------
// CSS keyframes (injected once)
// ---------------------------------------------------------------------------

const STYLE_ID = 'hitl-approval-keyframes';
function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes hitl-pulse-border {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
    @keyframes hitl-glow-pulse {
      0%, 100% { box-shadow: 0 0 30px var(--hitl-glow), 0 0 60px var(--hitl-glow); }
      50% { box-shadow: 0 0 50px var(--hitl-glow), 0 0 100px var(--hitl-glow); }
    }
    @keyframes hitl-shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-3px); }
      20%, 40%, 60%, 80% { transform: translateX(3px); }
    }
    @keyframes hitl-icon-pulse {
      0%, 100% { transform: scale(1); opacity: 0.9; }
      50% { transform: scale(1.15); opacity: 1; }
    }
    @keyframes hitl-backdrop-fade {
      from { backdrop-filter: blur(0px); }
      to { backdrop-filter: blur(8px); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ToolApprovalPopup: React.FC<ToolApprovalPopupProps> = ({
  visible,
  approvalId,
  intent,
  riskLevel,
  tools,
  code,
  expiresAt,
  onApprove,
  onDeny,
}) => {
  const [codeExpanded, setCodeExpanded] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [hasPlayedSound, setHasPlayedSound] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialExpireSeconds = useRef<number>(60);

  useEffect(() => { ensureKeyframes(); }, []);

  // Play alert sound when popup appears
  useEffect(() => {
    if (visible && !hasPlayedSound) {
      playAlertSound(riskLevel);
      setHasPlayedSound(true);
    }
    if (!visible) {
      setHasPlayedSound(false);
    }
  }, [visible, hasPlayedSound, riskLevel]);

  // Countdown timer
  const computeSecondsLeft = useCallback(() => {
    if (!expiresAt) return null;
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  }, [expiresAt]);

  useEffect(() => {
    if (!visible || !expiresAt) {
      setSecondsLeft(null);
      return;
    }
    const initial = computeSecondsLeft();
    setSecondsLeft(initial);
    initialExpireSeconds.current = initial || 60;

    timerRef.current = setInterval(() => {
      const remaining = computeSecondsLeft();
      setSecondsLeft(remaining);
      if (remaining !== null && remaining <= 0) {
        onDeny();
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [visible, expiresAt, computeSecondsLeft, onDeny]);

  // Reset code expanded on new approval
  useEffect(() => {
    if (visible) setCodeExpanded(false);
  }, [visible, approvalId]);

  // Block body scroll when visible
  useEffect(() => {
    if (visible) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [visible]);

  const risk = RISK_CONFIG[riskLevel];
  const isUrgent = riskLevel === 'high' || riskLevel === 'critical';
  const countdownFraction = secondsLeft !== null ? secondsLeft / initialExpireSeconds.current : 1;

  const modal = (
    <AnimatePresence>
      {visible && (
        <>
          {/* Full-screen backdrop */}
          <motion.div
            key="hitl-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[9999]"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.70)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={(e) => { e.stopPropagation(); /* don't dismiss on backdrop click */ }}
          />

          {/* Centered modal card */}
          <motion.div
            key={approvalId || 'hitl-modal'}
            initial={{ opacity: 0, scale: 0.85, y: 30 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              // Urgent shake on entry
              ...(isUrgent ? { x: [0, -4, 4, -3, 3, -2, 2, 0] } : {}),
            }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{
              type: 'spring',
              damping: 22,
              stiffness: 300,
              ...(isUrgent ? { x: { duration: 0.5, ease: 'easeInOut' } } : {}),
            }}
            className="fixed z-[10000] flex items-center justify-center"
            style={{
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: 'none',
            }}
            role="alertdialog"
            aria-modal="true"
            aria-label="Human-in-the-Loop approval required"
          >
            <div
              className="relative w-full max-w-xl mx-4 rounded-2xl overflow-hidden"
              style={{
                pointerEvents: 'auto',
                backgroundColor: 'color-mix(in srgb, var(--color-surface) 92%, transparent)',
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                border: `2px solid ${risk.border}`,
                '--hitl-glow': risk.glow,
                animation: `hitl-glow-pulse 2s ease-in-out infinite`,
                boxShadow: `
                  0 25px 80px rgba(0,0,0,0.5),
                  0 0 0 1px rgba(255,255,255,0.05),
                  inset 0 1px 0 rgba(255,255,255,0.08),
                  0 0 60px ${risk.glow}
                `,
              } as React.CSSProperties}
            >
              {/* Animated top accent bar */}
              <div
                className="h-1"
                style={{
                  background: `linear-gradient(90deg, transparent 5%, ${risk.color}, transparent 95%)`,
                  animation: 'hitl-pulse-border 1.5s ease-in-out infinite',
                }}
              />

              {/* Header section */}
              <div className="px-6 pt-5 pb-3 flex items-start justify-between">
                <div className="flex items-center gap-4">
                  {/* Large pulsing icon */}
                  <div
                    className="p-3 rounded-xl flex-shrink-0"
                    style={{
                      backgroundColor: risk.bg,
                      border: `1px solid ${risk.border}`,
                      animation: 'hitl-icon-pulse 2s ease-in-out infinite',
                    }}
                  >
                    <RiskIcon type={risk.icon} color={risk.color} />
                  </div>

                  <div>
                    <h2
                      className="text-lg font-bold tracking-tight"
                      style={{ color: 'var(--color-text)' }}
                    >
                      Approval Required
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-[11px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: risk.bg,
                          color: risk.color,
                          border: `1px solid ${risk.border}`,
                        }}
                      >
                        {risk.label}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: 'var(--color-textMuted)' }}
                      >
                        Human-in-the-Loop
                      </span>
                    </div>
                  </div>
                </div>

                {/* Countdown circle — large and visible */}
                {/* GAP-#285: format the countdown so users see "59:22" or "1h" instead
                    of a raw 4-digit second count that they assume is milliseconds. */}
                {secondsLeft !== null && secondsLeft > 0 && (() => {
                  const formatted =
                    secondsLeft >= 3600
                      ? `${Math.floor(secondsLeft / 3600)}h${Math.floor((secondsLeft % 3600) / 60).toString().padStart(2, '0')}`
                      : secondsLeft >= 60
                        ? `${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, '0')}`
                        : `${secondsLeft}s`;
                  return (
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div className="relative w-12 h-12" title={`Auto-deny in ${formatted}`}>
                      <svg width={48} height={48} viewBox="0 0 48 48" className="transform -rotate-90">
                        <circle cx={24} cy={24} r={20} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
                        <circle
                          cx={24} cy={24} r={20}
                          fill="none"
                          stroke={secondsLeft <= 10 ? '#ef4444' : risk.color}
                          strokeWidth={3}
                          strokeDasharray={125.66}
                          strokeDashoffset={125.66 * (1 - countdownFraction)}
                          strokeLinecap="round"
                          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
                        />
                      </svg>
                      <span
                        className="absolute inset-0 flex items-center justify-center text-[10px] font-bold font-mono tabular-nums"
                        style={{ color: secondsLeft <= 10 ? '#ef4444' : risk.color }}
                      >
                        {formatted}
                      </span>
                    </div>
                    <span
                      className="text-[10px] uppercase tracking-wider"
                      style={{ color: 'var(--color-textMuted)' }}
                    >
                      Auto-deny
                    </span>
                  </div>
                  );
                })()}
              </div>

              {/* Intent description */}
              <div className="px-6 pb-3">
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: 'var(--color-textSecondary)' }}
                >
                  {intent}
                </p>
              </div>

              {/* Tool list */}
              {tools && tools.length > 0 && (
                <div className="px-6 pb-3">
                  <div className="flex flex-wrap gap-2">
                    {tools.map((tool) => (
                      <span
                        key={tool.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono"
                        style={{
                          backgroundColor: 'var(--color-surfaceSecondary)',
                          color: 'var(--color-textSecondary)',
                          border: '1px solid var(--color-border)',
                        }}
                        title={tool.arguments ? JSON.stringify(tool.arguments, null, 2) : undefined}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: risk.color }} />
                        {tool.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Collapsible code preview */}
              {code && (
                <div className="px-6 pb-3">
                  <button
                    onClick={() => setCodeExpanded(!codeExpanded)}
                    className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                    style={{ color: 'var(--color-textMuted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-textMuted)'; }}
                    aria-expanded={codeExpanded}
                    aria-controls="hitl-code-preview"
                  >
                    <ChevronIcon expanded={codeExpanded} />
                    <span>View synthesized code</span>
                    <span
                      className="text-[10px] px-1.5 py-px rounded"
                      style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-textMuted)' }}
                    >
                      {code.split('\n').length} lines
                    </span>
                  </button>
                  <AnimatePresence>
                    {codeExpanded && (
                      <motion.div
                        id="hitl-code-preview"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <pre
                          className="mt-2 p-3 rounded-lg text-xs font-mono leading-relaxed overflow-x-auto max-h-48 overflow-y-auto"
                          style={{
                            backgroundColor: 'rgba(0,0,0,0.3)',
                            border: '1px solid var(--color-border)',
                            color: 'var(--color-textSecondary)',
                          }}
                        >
                          <code>{code}</code>
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Separator */}
              <div className="mx-6 my-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />

              {/* Action buttons — LARGE and prominent */}
              <div className="flex items-center justify-between gap-3 px-6 py-4">
                {/* Deny */}
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={onDeny}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    color: 'var(--color-textSecondary)',
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--color-border)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.12)';
                    e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)';
                    e.currentTarget.style.color = '#ef4444';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                    e.currentTarget.style.color = 'var(--color-textSecondary)';
                  }}
                >
                  Deny
                </motion.button>

                {/* Approve */}
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={onApprove}
                  className="flex-1 px-6 py-3 rounded-xl text-base font-bold transition-all"
                  style={{
                    color: '#fff',
                    background: `linear-gradient(135deg, ${risk.gradientFrom}, ${risk.gradientTo})`,
                    boxShadow: `0 4px 20px ${risk.glow}, inset 0 1px 0 rgba(255,255,255,0.15)`,
                    border: `1px solid ${risk.border}`,
                  }}
                >
                  {isUrgent ? 'Approve Anyway' : 'Approve'}
                </motion.button>
              </div>

              {/* Bottom accent bar */}
              <div
                className="h-0.5"
                style={{
                  background: `linear-gradient(90deg, transparent 5%, ${risk.color}40, transparent 95%)`,
                }}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Render as portal so it overlays EVERYTHING
  return createPortal(modal, document.body);
};

export default ToolApprovalPopup;
