/**
 * S5 — ExecutionResultsPanel Output tab streaming pill tests
 *
 * S5. Output tab on a streaming node shows live text with a "Streaming…"
 *     pill at top right, replaced by "Completed" pill on completion.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

/* ── Mock dependencies ─────────────────────────────────────────────── */

vi.mock('@/shared/icons', () => ({
  CheckCircle: () => <span data-testid="check-circle">✓</span>,
  XCircle: () => <span data-testid="x-circle">✗</span>,
  Clock: () => <span>CK</span>,
  Zap: () => <span>ZP</span>,
  AlertCircle: () => <span data-testid="alert-circle">!</span>,
  ChevronDown: () => <span>↓</span>,
  ChevronRight: () => <span>→</span>,
  Activity: () => <span data-testid="activity-icon">~</span>,
  Play: () => <span>PL</span>,
  Brain: () => <span>BR</span>,
  RotateCcw: () => <span>RC</span>,
  Send: () => <span>SD</span>,
  Sparkles: () => <span>SP</span>,
  Trash2: () => <span>T2</span>,
  Loader2: () => <span>L2</span>,
  Eye: () => <span>EY</span>,
  X: () => <span>XX</span>,
  Copy: () => <span>CP</span>,
  Check: () => <span>CH</span>,
  Code: () => <span>CO</span>,
  Download: () => <span>DL</span>,
  Save: () => <span>SV</span>,
  ExternalLink: () => <span>EL</span>,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('../NodeOutputRenderer', () => ({
  NodeOutputRenderer: ({ output }: any) => <div data-testid="node-output-renderer">{JSON.stringify(output)}</div>,
}));

vi.mock('@/features/chat/components/MessageContent/SharedMarkdownRenderer', () => ({
  SharedMarkdownRenderer: ({ content }: any) => <div data-testid="markdown-renderer">{content}</div>,
}));

vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

vi.mock('../services/workflowApi', () => ({
  WorkflowApiService: vi.fn().mockImplementation(() => ({
    getExecutions: vi.fn().mockResolvedValue({ executions: [], total: 0 }),
  })),
  WorkflowExecution: {},
}));

vi.mock('../utils/nodeConfigs', () => ({
  nodeTypeConfigs: {
    llm_completion: { label: 'LLM', color: '#7c4dff', icon: '🤖', description: 'LLM node' },
    openagentic_llm: { label: 'AW LLM', color: '#7c4dff', icon: '🤖', description: 'LLM node' },
  },
}));

vi.mock('../hooks/useAIFlowChat', () => ({
  useAIFlowChat: () => ({
    messages: [],
    isGenerating: false,
    sendMessage: vi.fn(),
    clearMessages: vi.fn(),
    stopGeneration: vi.fn(),
    setCanvasContext: vi.fn(),
  }),
}));

import { ExecutionResultsPanel, type ExecutionData } from '../ExecutionResultsPanel';

/* ── Helpers ─────────────────────────────────────────────────────────── */

const STREAMING_NODE = {
  id: 'llm-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    label: 'LLM Node',
    type: 'llm_completion',
    executionState: 'running',
    streamingText: 'Hello from the streaming LLM...',
  },
};

const COMPLETED_NODE = {
  id: 'llm-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    label: 'LLM Node',
    type: 'llm_completion',
    executionState: 'completed',
    executionOutput: { content: 'Final answer here.' },
    streamingText: undefined,
  },
};

const RUNNING_EXEC: ExecutionData = {
  executionId: 'exec-001',
  status: 'running',
  startedAt: new Date().toISOString(),
  nodeExecutions: [
    {
      nodeId: 'llm-1',
      nodeLabel: 'LLM Node',
      nodeType: 'llm_completion',
      status: 'running',
    },
  ],
};

const COMPLETED_EXEC: ExecutionData = {
  executionId: 'exec-001',
  status: 'completed',
  startedAt: new Date().toISOString(),
  nodeExecutions: [
    {
      nodeId: 'llm-1',
      nodeLabel: 'LLM Node',
      nodeType: 'llm_completion',
      status: 'completed',
      output: { content: 'Final answer here.' },
    },
  ],
};

function renderPanel(
  nodes: any[],
  executionData: ExecutionData | null,
  selectedNodeId = 'llm-1',
) {
  return render(
    <ExecutionResultsPanel
      executionData={executionData}
      isExecuting={executionData?.status === 'running'}
      selectedNodeId={selectedNodeId}
      nodes={nodes}
      workflowId="wf-1"
      workflowName="Test Workflow"
      defaultTab="output"
    />,
  );
}

/* ══════════════════════════════════════════════════════════════════════
   S5 — Streaming pill in Output tab
   ══════════════════════════════════════════════════════════════════════ */

describe('S5 – ExecutionResultsPanel Output tab streaming pill', () => {
  afterEach(cleanup);

  it('S5.1: shows "Streaming…" pill when node is running with streamingText', () => {
    renderPanel([STREAMING_NODE], RUNNING_EXEC);
    const pill = screen.queryByTestId('streaming-pill');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toMatch(/streaming/i);
  });

  it('S5.2: shows live streaming text in output area when node is running', () => {
    const { container } = renderPanel([STREAMING_NODE], RUNNING_EXEC);
    // The streaming text preview area
    const streamingArea = container.querySelector('[data-testid="output-streaming-preview"]');
    expect(streamingArea).not.toBeNull();
    expect(streamingArea?.textContent).toContain('Hello from the streaming LLM');
  });

  it('S5.3: shows "Completed" status (not streaming pill) when node is done', () => {
    renderPanel([COMPLETED_NODE], COMPLETED_EXEC);
    // No streaming pill after completion
    expect(screen.queryByTestId('streaming-pill')).toBeNull();
    // Node header should show "completed" status pill
    const statusPill = screen.queryByText(/completed/i);
    expect(statusPill).not.toBeNull();
  });

  it('S5.4: no streaming pill when node is running but has no streamingText yet', () => {
    const nodeWithoutText = {
      ...STREAMING_NODE,
      data: { ...STREAMING_NODE.data, streamingText: undefined },
    };
    renderPanel([nodeWithoutText], RUNNING_EXEC);
    expect(screen.queryByTestId('streaming-pill')).toBeNull();
  });

  it('S5.5: streaming pill is not shown for completed nodes even if stale streamingText present', () => {
    // Simulate a race: streamingText still in data but state is completed
    const staleNode = {
      ...COMPLETED_NODE,
      data: { ...COMPLETED_NODE.data, streamingText: 'stale text', executionState: 'completed' },
    };
    renderPanel([staleNode], COMPLETED_EXEC);
    expect(screen.queryByTestId('streaming-pill')).toBeNull();
  });
});
