/**
 * ConnectionDot — quiet WS connection indicator.
 *
 * Source-of-truth: `useCodeModeStore.connectionState`, populated by
 * `useCodeModeWebSocket.ts` on every transport state change.
 *
 *   ● connected     — WS open, traffic flowing
 *   ● connecting    — initial dial in progress
 *   ● reconnecting  — backoff retry after a 1006/proxy-timeout
 *   ● offline       — disconnected or error
 *
 * 2026-04-29 Fix #117: drop the redundant `●` glyph (we already render
 * an animated dot), shrink padding/border/font, and lowercase the
 * label — user feedback was "the 'connected' thing is a bit over
 * much". Visual state semantics unchanged.
 */

import React from 'react';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

type Visual = 'connected' | 'connecting' | 'reconnecting' | 'offline';

const LABEL: Record<Visual, string> = {
  connected: 'connected',
  connecting: 'connecting',
  reconnecting: 'reconnecting',
  offline: 'offline',
};

const COLOR: Record<Visual, string> = {
  connected: 'var(--accent-success, #30d158)',
  connecting: 'var(--accent-info, #0a84ff)',
  reconnecting: 'var(--accent-warning, #ff9f0a)',
  offline: 'var(--accent-error, #ff453a)',
};

function visualFromState(
  s: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error',
): Visual {
  if (s === 'connected') return 'connected';
  if (s === 'connecting') return 'connecting';
  if (s === 'reconnecting') return 'reconnecting';
  return 'offline';
}

export const ConnectionDot: React.FC = () => {
  const connectionState = useCodeModeStore((st) => st.connectionState);
  const reconnectAttempts = useCodeModeStore((st) => st.reconnectAttempts);
  const visual = visualFromState(connectionState);
  const color = COLOR[visual];

  return (
    <span
      data-testid="cm-connection-dot"
      data-state={visual}
      title={`WebSocket ${visual}${
        visual === 'reconnecting' && reconnectAttempts ? ` (attempt ${reconnectAttempts})` : ''
      }`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--cm-mono-font, ui-monospace, Menlo, Monaco, monospace)',
        fontSize: 10,
        color: 'var(--cm-text-muted, #6e7681)',
        opacity: visual === 'connected' ? 0.7 : 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
          boxShadow: visual === 'connected' ? 'none' : `0 0 4px ${color}`,
          animation:
            visual === 'connecting' || visual === 'reconnecting'
              ? 'cm-dot-pulse 1.4s ease-in-out infinite'
              : undefined,
        }}
      />
      <span>
        {LABEL[visual]}
        {visual === 'reconnecting' && reconnectAttempts ? ` ${reconnectAttempts}` : null}
      </span>
      <style>{`
        @keyframes cm-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.55; transform: scale(0.85); }
        }
      `}</style>
    </span>
  );
};

export default ConnectionDot;
