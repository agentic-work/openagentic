/**
 * S6 — ExecutionDetail timeline streaming indicator tests
 *
 * S6. Timeline row in ExecutionDetail shows an animated dot or "…" suffix
 *     on a streaming (running) node.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

/* ── Mock dependencies ─────────────────────────────────────────────── */

vi.mock('@/shared/icons', () => ({
  X: () => <span>XX</span>,
  Clock: () => <span>CK</span>,
  CheckCircle: () => <span data-testid="check-circle">✓</span>,
  XCircle: () => <span data-testid="x-circle">✗</span>,
  Activity: () => <span data-testid="activity-icon">~</span>,
  ChevronDown: () => <span>↓</span>,
  ChevronRight: () => <span>→</span>,
  Zap: () => <span>ZP</span>,
  AlertCircle: () => <span>!</span>,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const STABLE_AUTH = () => ({});

vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({ getAuthHeaders: STABLE_AUTH }),
}));

// Mock global fetch to prevent real network calls
const mockFetchResponse = {
  ok: true,
  json: () => Promise.resolve({
    execution: { status: 'running', execution_time_ms: null },
    logs: [],
    nodeSummary: {
      'llm-running': { status: 'running', input: null, output: null, duration: null, error: null, logs: [] },
      'llm-done': { status: 'completed', input: null, output: { content: 'done' }, duration: 500, error: null, logs: [] },
    },
  }),
};
vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse));

const mockGetExecutionDetail = vi.fn().mockResolvedValue({
  execution: { status: 'running', execution_time_ms: null },
  logs: [],
  nodeSummary: {
    'llm-running': { status: 'running', input: null, output: null, duration: null, error: null, logs: [] },
    'llm-done': { status: 'completed', input: null, output: { content: 'done' }, duration: 500, error: null, logs: [] },
  },
});

vi.mock('../services/workflowApi', () => ({
  WorkflowApiService: vi.fn().mockImplementation(() => ({
    getExecutionDetail: mockGetExecutionDetail,
  })),
}));

vi.mock('../NodeOutputRenderer', () => ({
  NodeOutputRenderer: ({ output }: any) => <div data-testid="node-output-renderer">{JSON.stringify(output)}</div>,
}));

vi.mock('@/utils/api', () => ({
  workflowEndpoint: (p: string) => `http://localhost:0${p}`,
  apiEndpoint: (p: string) => `http://localhost:0${p}`,
}));

import { ExecutionDetail } from '../ExecutionDetail';

/* ── Helper ─────────────────────────────────────────────────────────── */

function renderDetail() {
  return render(
    <ExecutionDetail
      workflowId="wf-1"
      executionId="exec-running-1"
      onClose={vi.fn()}
    />,
  );
}

/* ══════════════════════════════════════════════════════════════════════
   S6 — Streaming indicator in ExecutionDetail waterfall
   ══════════════════════════════════════════════════════════════════════ */

describe('S6 – ExecutionDetail streaming indicator', () => {
  afterEach(cleanup);

  it('S6.1: running node has streaming indicator in timeline row', async () => {
    const { container } = renderDetail();
    // Wait for data to load — the "Waterfall" header appears after load
    await waitFor(() => {
      expect(container.querySelector('[data-testid="streaming-indicator-llm-running"]')).not.toBeNull();
    }, { timeout: 3000 });
  });

  it('S6.2: completed node does NOT have streaming indicator', async () => {
    const { container } = renderDetail();
    // Wait for data to load — llm-running indicator appears, then check llm-done
    await waitFor(() => {
      expect(container.querySelector('[data-testid="streaming-indicator-llm-running"]')).not.toBeNull();
    }, { timeout: 3000 });
    const indicator = container.querySelector('[data-testid="streaming-indicator-llm-done"]');
    expect(indicator).toBeNull();
  });
});
