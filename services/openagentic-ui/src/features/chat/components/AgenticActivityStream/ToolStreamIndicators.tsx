/**
 * AgenticActivityStream — live tool-execution indicators.
 *
 * Extracted verbatim from AgenticActivityStream.tsx (behavior-preserving):
 * the streaming input_json_delta preview and the tool-progress heartbeat tick.
 */
import React, { memo } from 'react';
import { formatToolInputDelta } from '../../utils/toolInputDelta';

// ============================================================================
// F.1 — Streaming tool-argument preview
// ============================================================================
//
// Shows `input_json_delta` deltas live under a running tool row so users see
// the arguments form as the LLM emits them (match claude.ai's tool-card
// feel). The formatter is extracted to utils/toolInputDelta.ts so it can be
// unit-tested without dragging the whole component tree into the test env.
export const ToolInputDeltaPreview: React.FC<{ partialJson: string; theme: 'light' | 'dark' }> = memo(
  ({ partialJson }) => {
    const { display, truncated, parsed } = formatToolInputDelta(partialJson);
    if (!display) return null;
    return (
      <div
        data-testid="tool-input-delta-preview"
        style={{
          marginLeft: 24,
          marginTop: 2,
          padding: '4px 10px',
          borderLeft: '2px solid var(--color-border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          lineHeight: 1.45,
          color: 'var(--color-text-muted)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          opacity: 0.85,
        }}
      >
        {display}
        {truncated && <span style={{ opacity: 0.55 }}> ({parsed ? 'truncated' : 'streaming...'})</span>}
      </div>
    );
  }
);

ToolInputDeltaPreview.displayName = 'ToolInputDeltaPreview';

// ============================================================================
// F.2 — Tool progress heartbeat tick
// ============================================================================
//
// Renders a faint "(15s) Executing azure_resource_graph_query..." line
// under a running tool row when the backend heartbeat fires. The message
// is shaped by the server (tool-execution.helper.ts emits every 5s), and
// we just display it verbatim with a subtle pulsing dot so users feel the
// tool is alive during long paginated cloud calls.

export const ToolProgressTick: React.FC<{ message: string; elapsed?: number }> = memo(
  ({ message, elapsed }) => {
    if (!message) return null;
    return (
      <div
        data-testid="tool-progress-tick"
        style={{
          marginLeft: 24,
          marginTop: 2,
          padding: '2px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderLeft: '2px solid var(--color-border)',
          fontSize: 11,
          lineHeight: 1.45,
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
          opacity: 0.8,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: 'var(--color-primary, var(--user-accent-primary))',
            animation: 'pulse 1.2s ease-in-out infinite',
            flexShrink: 0,
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {typeof elapsed === 'number' ? `(${elapsed}s) ` : ''}
          {message}
        </span>
      </div>
    );
  }
);

ToolProgressTick.displayName = 'ToolProgressTick';
