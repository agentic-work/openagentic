/**
 * S2 — CustomNode streaming output rendering tests
 *
 * S2. CustomNode renders per-node streamingText if present and node is in
 *     `running` state, with a blinking cursor (▎) while streaming, settling
 *     into final text on node_complete.
 * S3. On node_complete the streaming buffer is cleared.
 * S4. On node_error the buffer is cleared (no partial text shown).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

/* ── Mock heavy deps ────────────────────────────────────────────────── */

vi.mock('reactflow', () => ({
  Handle: ({ type, position, id, style, className }: any) =>
    <div data-testid={`handle-${type}-${id || position}`} style={style} className={className} />,
  Position: { Left: 'Left', Right: 'Right', Top: 'Top', Bottom: 'Bottom' },
  useReactFlow: () => ({
    getNodes: () => [],
    addNodes: vi.fn(),
    deleteElements: vi.fn(),
    setNodes: vi.fn(),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/shared/icons', () => ({
  Trash2: () => <span>T2</span>,
  Copy: () => <span>CP</span>,
  Settings: () => <span>ST</span>,
  CheckCircle: (props: any) => <span data-testid="check-circle" data-color={props?.style?.color}>✓</span>,
  XCircle: (props: any) => <span data-testid="x-circle" data-color={props?.style?.color}>✗</span>,
  Clock: () => <span>CK</span>,
  AlertCircle: (props: any) => <span data-testid="alert-circle" data-color={props?.style?.color}>!</span>,
  Play: () => <span>PL</span>,
}));

vi.mock('../../utils/nodeConfigs', () => ({
  nodeTypeConfigs: {
    llm_completion: { label: 'LLM', color: '#7c4dff', icon: '🤖', description: 'LLM node', category: 'ai' },
    openagentic_llm: { label: 'AW LLM', color: '#7c4dff', icon: '🤖', description: 'LLM node', category: 'ai' },
  },
}));

vi.mock('../nodes/nodeIcons', () => ({
  getNodeIcon: () => <span>icon</span>,
}));

import { CustomNode } from '../nodes/CustomNode';

/* ── Helper ─────────────────────────────────────────────────────────── */

function renderNode(data: Record<string, any>, nodeType = 'llm_completion') {
  return render(
    <div style={{ position: 'relative', width: 260 }}>
      <CustomNode
        id="node-stream-1"
        data={{ label: 'LLM Node', ...data }}
        selected={false}
        type={nodeType}
        isConnectable={true}
        xPos={0}
        yPos={0}
        zIndex={0}
        dragging={false}
      />
    </div>,
  );
}

/* ══════════════════════════════════════════════════════════════════════
   S2 — streaming text + cursor during running state
   ══════════════════════════════════════════════════════════════════════ */

describe('S2 – CustomNode streaming text render', () => {
  afterEach(cleanup);

  it('S2.1: renders streamingText when node is running', () => {
    const { container } = renderNode({
      executionState: 'running',
      streamingText: 'Hello world',
    });
    expect(container.textContent).toContain('Hello world');
  });

  it('S2.2: shows blinking cursor (▎) while streaming and running', () => {
    const { container } = renderNode({
      executionState: 'running',
      streamingText: 'Some text',
    });
    // Cursor character or the streaming indicator element should be present
    const streamArea = container.querySelector('[data-testid="node-streaming-text"]');
    expect(streamArea).not.toBeNull();
    expect(streamArea?.textContent).toContain('Some text');
    // Cursor should be present in the streaming area
    expect(streamArea?.textContent).toContain('▎');
  });

  it('S2.3: does NOT render streaming text when node is completed (S3)', () => {
    const { container } = renderNode({
      executionState: 'completed',
      streamingText: 'Old streaming text',
      executionOutput: { content: 'Final output' },
    });
    // streamingText should not appear when node is completed
    const streamArea = container.querySelector('[data-testid="node-streaming-text"]');
    expect(streamArea).toBeNull();
  });

  it('S2.4: does NOT render streaming text when node has failed (S4)', () => {
    const { container } = renderNode({
      executionState: 'failed',
      streamingText: 'Partial text before error',
      executionError: 'Timeout',
    });
    const streamArea = container.querySelector('[data-testid="node-streaming-text"]');
    expect(streamArea).toBeNull();
  });

  it('S2.5: does NOT render streaming text when no streamingText on running node', () => {
    const { container } = renderNode({
      executionState: 'running',
    });
    const streamArea = container.querySelector('[data-testid="node-streaming-text"]');
    expect(streamArea).toBeNull();
  });

  it('S2.6: streaming text is truncated to prevent layout explosion (max chars shown)', () => {
    const longText = 'A'.repeat(300);
    const { container } = renderNode({
      executionState: 'running',
      streamingText: longText,
    });
    const streamArea = container.querySelector('[data-testid="node-streaming-text"]');
    // Should exist but not show all 300 chars raw (should be truncated)
    expect(streamArea).not.toBeNull();
    // The raw element text should be <= 205 chars + cursor (reasonable limit)
    expect((streamArea?.textContent ?? '').length).toBeLessThanOrEqual(210);
  });
});
