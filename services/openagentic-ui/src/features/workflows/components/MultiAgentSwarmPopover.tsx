/**
 * MultiAgentSwarmPopover — live agent cards for multi_agent / agent_pool /
 * agent_supervisor nodes.
 *
 * Anchored to a running node, displays one card per agent slot showing:
 *   - Avatar (gradient from role color)
 *   - Display name + role + agent id preview
 *   - Status pill (queued / running / done / failed)
 *   - Output preview when complete
 *   - Error message when failed
 *   - Animated pulse while running
 *
 * Driven by `subagent.start` / `subagent.complete` events emitted by the
 * engine into the workflow execution stream. The parent component (canvas
 * container) listens to those events, builds the agents[] array, and passes
 * it to this component.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface SubagentCardData {
  slot: number;
  role: string;
  displayName: string;
  agentId?: string;
  status: SubagentStatus;
  outputPreview?: string;
  error?: string;
  tokensUsed?: number;
  toolCalls?: Array<{ tool: string; durationMs?: number }>;
}

export interface MultiAgentSwarmPopoverProps {
  isOpen: boolean;
  nodeId: string;
  agents: SubagentCardData[];
  pattern?: 'parallel' | 'sequential' | 'supervisor' | 'debate' | string;
  /** Optional anchor coordinates relative to the parent canvas. */
  anchor?: { x: number; y: number };
  onClose?: () => void;
}

const statusLabels: Record<SubagentStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
};

const statusColors: Record<SubagentStatus, { bg: string; fg: string; border: string }> = {
  queued:    { bg: 'var(--ctl-surf)',         fg: 'var(--color-fg-muted)', border: 'var(--color-rule)' },
  running:   { bg: 'color-mix(in srgb, var(--color-warning) 15%, transparent)',  fg: 'var(--color-warning)', border: 'var(--color-warning)' },
  completed: { bg: 'color-mix(in srgb, var(--color-success) 15%, transparent)',   fg: 'var(--color-success)', border: 'color-mix(in srgb, var(--color-success) 40%, transparent)' },
  failed:    { bg: 'color-mix(in srgb, var(--color-error) 15%, transparent)',   fg: 'var(--color-error)', border: 'color-mix(in srgb, var(--color-error) 50%, transparent)' },
};

function avatarGradient(role: string): string {
  // Stable hash → gradient pair so each role keeps the same color across renders.
  // theme-allow: per-agent-role categorical identity gradient swatches (illustration
  // palette giving each role a distinct avatar), not themeable surfaces.
  const palettes = [
    ['var(--color-info)', '#1f6feb'],
    ['var(--color-accent)', '#7c3aed'],
    ['#34d399', 'var(--color-success)'],
    ['var(--color-warning)', 'var(--color-warning)'],
    ['var(--color-info)', '#0891b2'],
    ['#f472b6', '#db2777'],
  ];
  let h = 0;
  for (let i = 0; i < role.length; i++) h = (h * 31 + (role.codePointAt(i) ?? 0)) | 0;
  const [a, b] = palettes[Math.abs(h) % palettes.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export const MultiAgentSwarmPopover: React.FC<MultiAgentSwarmPopoverProps> = ({
  isOpen,
  nodeId,
  agents,
  pattern,
  anchor,
  onClose,
}) => {
  if (!isOpen) return null;

  const positionStyle: React.CSSProperties = anchor
    ? { position: 'absolute', left: anchor.x, top: anchor.y }
    : { position: 'absolute', left: 380, top: 380 };

  return (
    <AnimatePresence>
      <motion.div
        // Terminal Glass: frosted popover floating over the canvas/aurora via
        // the .glass class. We keep the signal-orange accent border + glow inline
        // (the swarm's live identity) but the surface/blur/edge come from .glass.
        className="glass"
        data-testid={`swarm-popover-${nodeId}`}
        data-swarm-popover="multi-agent"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        style={{
          ...positionStyle,
          width: 380,
          border: '1px solid var(--user-accent-primary, #FF5722)',
          padding: 14,
          boxShadow: '0 8px 32px color-mix(in srgb, var(--user-accent-primary, #FF5722) 25%, transparent)',
          zIndex: 20,
          color: 'var(--color-fg)',
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontWeight: 600 }}>
          <span>Agent swarm — live</span>
          {pattern ? (
            <span
              style={{
                marginLeft: 'auto',
                padding: '2px 8px',
                borderRadius: 10,
                background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                color: 'var(--color-accent)',
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'lowercase',
              }}
            >
              {pattern}
            </span>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close swarm popover"
              style={{
                marginLeft: pattern ? 6 : 'auto',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-fg-muted)',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              ×
            </button>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-fg-muted)', marginBottom: 12 }}>
          {agents.length} agent{agents.length !== 1 ? 's' : ''} in this run.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agents.map((a) => {
            const colors = statusColors[a.status];
            const isRunning = a.status === 'running';
            return (
              <div
                key={a.slot}
                data-testid={`subagent-card-${a.slot}`}
                data-status={a.status}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--ctl-surf)',
                  border: `1px solid ${colors.border}`,
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: avatarGradient(a.role),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    color: 'white',
                    fontWeight: 700,
                    fontSize: 11,
                    animation: isRunning ? 'swarm-pulse 1.4s infinite' : undefined,
                  }}
                  aria-hidden
                >
                  {a.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{a.displayName}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-fg-muted)', fontFamily: 'ui-monospace, monospace' }}>
                    {a.role}{a.agentId ? ` · ${a.agentId.slice(0, 8)}` : ''}
                  </div>
                  {a.outputPreview ? (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: 'var(--color-fg)',
                        background: 'color-mix(in srgb, var(--glass-page-bg) 45%, transparent)',
                        padding: '4px 6px',
                        borderRadius: 4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as any,
                      }}
                    >
                      {a.outputPreview}
                    </div>
                  ) : null}
                  {a.error ? (
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-error)' }}>{a.error}</div>
                  ) : null}
                  {(a.tokensUsed || a.toolCalls?.length) ? (
                    <div style={{ marginTop: 4, display: 'flex', gap: 8, fontSize: 10, color: 'var(--color-fg-muted)' }}>
                      {a.tokensUsed ? <span>{a.tokensUsed.toLocaleString()} tok</span> : null}
                      {a.toolCalls?.length ? (
                        <span>
                          {a.toolCalls.length} tool call{a.toolCalls.length === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    flexShrink: 0,
                    background: colors.bg,
                    color: colors.fg,
                  }}
                >
                  {statusLabels[a.status]}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
      {/* Inline keyframes — keeps the component self-contained without a global CSS dep */}
      <style>{`
        @keyframes swarm-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </AnimatePresence>
  );
};
