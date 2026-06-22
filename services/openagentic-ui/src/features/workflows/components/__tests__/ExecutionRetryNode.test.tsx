/**
 * P3 — Per-node Retry button in ExecutionDetail timeline
 *
 * P3. Only on FAILED nodes (node_error state), only when execution
 *     has completed (not running). Click → onRetryNode(nodeId).
 *
 * Implementation note: we stub both the WorkflowApiService mock AND the
 * global fetch (in case the real service implementation bypasses the mock
 * in some vitest module resolution paths).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

/* ── Mocks ─────────────────────────────────────────────────────────────── */

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/shared/icons', () => ({
  X: () => <span>XX</span>,
  Clock: () => <span>CK</span>,
  CheckCircle: () => <span data-testid="check-circle">V</span>,
  XCircle: () => <span data-testid="x-circle">X</span>,
  Activity: () => <span data-testid="activity-icon">~</span>,
  ChevronDown: () => <span>v</span>,
  ChevronRight: () => <span>&gt;</span>,
  Zap: () => <span>ZP</span>,
  AlertCircle: () => <span>!</span>,
  RefreshCw: () => <span data-testid="retry-icon">RW</span>,
}));

const STABLE_AUTH = () => ({});
vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({ getAuthHeaders: STABLE_AUTH }),
}));

vi.mock('@/utils/api', () => ({
  workflowEndpoint: (p: string) => `http://localhost:0${p}`,
  apiEndpoint: (p: string) => `http://localhost:0${p}`,
}));

vi.mock('../NodeOutputRenderer', () => ({
  NodeOutputRenderer: ({ output }: any) => <div data-testid="node-output">{JSON.stringify(output)}</div>,
}));

/* ── Execution detail data helpers ──────────────────────────────────────── */

function makeResponse(opts: { executionStatus: string; nodeStatuses: Record<string, string> }) {
  const nodeSummary: Record<string, any> = {};
  for (const [nodeId, status] of Object.entries(opts.nodeStatuses)) {
    nodeSummary[nodeId] = {
      status,
      input: { prompt: 'test' },
      output: status === 'completed' ? { result: 'ok' } : null,
      duration: status === 'completed' ? 200 : null,
      error: status === 'failed' ? 'execution failed' : null,
      logs: [],
    };
  }
  return {
    execution: {
      id: 'exec-test',
      status: opts.executionStatus,
      execution_time_ms: opts.executionStatus === 'running' ? null : 500,
      trigger_type: 'manual',
    },
    logs: [],
    nodeSummary,
  };
}

/* ── API service mock — stable reference on the vi.fn ──────────────────── */
// Declare the vi.fn() BEFORE vi.mock so the factory can capture it.
// The factory runs lazily (when the module is first imported) by which
// time this const is initialized.
const mockGetExecutionDetail = vi.fn().mockResolvedValue({
  execution: { id: 'default', status: 'completed', execution_time_ms: 100, trigger_type: 'manual' },
  logs: [],
  nodeSummary: {},
});

vi.mock('../services/workflowApi', () => ({
  WorkflowApiService: vi.fn().mockImplementation(() => ({
    getExecutionDetail: mockGetExecutionDetail,
  })),
}));

/* ── Global fetch stub — mirrors StreamingExecutionDetail.test.tsx pattern ── */
// Set up a ref so each test can control the fetch response independently.
// This covers the case where the real getExecutionDetail() calls fetch
// (e.g., if the module mock resolution falls back to the real service).
let currentFetchData: any = {};
vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve(currentFetchData),
  })
));

/* ── Component ────────────────────────────────────────────────────────── */
import { ExecutionDetail } from '../ExecutionDetail';

/* ═══════════════════════════════════════════════════════════════════════
   P3 — Per-node Retry button
   ═══════════════════════════════════════════════════════════════════════ */

describe('P3 – Per-node Retry button in timeline', () => {
  afterEach(cleanup);

  it('Retry button NOT shown on a completed node even when run is done', async () => {
    const response = makeResponse({ executionStatus: 'completed', nodeStatuses: { 'node-ok': 'completed' } });
    mockGetExecutionDetail.mockResolvedValue(response);
    currentFetchData = response;

    const onRetryNode = vi.fn();
    render(
      <ExecutionDetail
        workflowId="wf-1"
        executionId="exec-ok"
        onClose={vi.fn()}
        onRetryNode={onRetryNode}
      />
    );
    await waitFor(() => expect(screen.queryByText('Loading execution detail...')).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByTestId('retry-node-node-ok')).not.toBeInTheDocument();
  });

  it('Retry button NOT shown on a failed node when execution is still running', async () => {
    const response = makeResponse({ executionStatus: 'running', nodeStatuses: { 'node-bad': 'failed' } });
    mockGetExecutionDetail.mockResolvedValue(response);
    currentFetchData = response;

    const onRetryNode = vi.fn();
    render(
      <ExecutionDetail
        workflowId="wf-1"
        executionId="exec-running"
        onClose={vi.fn()}
        onRetryNode={onRetryNode}
      />
    );
    await waitFor(() => expect(screen.queryByText('Loading execution detail...')).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByTestId('retry-node-node-bad')).not.toBeInTheDocument();
  });

  it('Retry button IS shown on a failed node when execution has completed', async () => {
    const response = makeResponse({ executionStatus: 'completed', nodeStatuses: { 'node-bad': 'failed', 'node-ok': 'completed' } });
    mockGetExecutionDetail.mockResolvedValue(response);
    currentFetchData = response;

    const onRetryNode = vi.fn();
    render(
      <ExecutionDetail
        workflowId="wf-1"
        executionId="exec-done"
        onClose={vi.fn()}
        onRetryNode={onRetryNode}
      />
    );
    await waitFor(() => expect(screen.getByTestId('retry-node-node-bad')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByTestId('retry-node-node-ok')).not.toBeInTheDocument();
  });

  it('clicking Retry calls onRetryNode with the correct nodeId', async () => {
    const response = makeResponse({ executionStatus: 'failed', nodeStatuses: { 'llm-node': 'failed' } });
    mockGetExecutionDetail.mockResolvedValue(response);
    currentFetchData = response;

    const onRetryNode = vi.fn();
    render(
      <ExecutionDetail
        workflowId="wf-1"
        executionId="exec-fail"
        onClose={vi.fn()}
        onRetryNode={onRetryNode}
      />
    );
    await waitFor(() => expect(screen.getByTestId('retry-node-llm-node')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTestId('retry-node-llm-node'));
    expect(onRetryNode).toHaveBeenCalledWith('llm-node');
  });

  it('multiple failed nodes each show their own Retry button', async () => {
    const response = makeResponse({
      executionStatus: 'failed',
      nodeStatuses: { 'node-a': 'failed', 'node-b': 'failed', 'node-c': 'completed' },
    });
    mockGetExecutionDetail.mockResolvedValue(response);
    currentFetchData = response;

    const onRetryNode = vi.fn();
    render(
      <ExecutionDetail
        workflowId="wf-1"
        executionId="exec-multi"
        onClose={vi.fn()}
        onRetryNode={onRetryNode}
      />
    );
    await waitFor(() => expect(screen.getByTestId('retry-node-node-a')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId('retry-node-node-b')).toBeInTheDocument();
    expect(screen.queryByTestId('retry-node-node-c')).not.toBeInTheDocument();
  });
});
