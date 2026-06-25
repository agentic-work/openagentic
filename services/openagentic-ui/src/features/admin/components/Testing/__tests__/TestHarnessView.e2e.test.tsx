/**
 * TestHarnessView — REAL E2E integration sweep section.
 *
 * Pins:
 *   - "Run Full E2E" button mounts inside the harness view
 *   - "Run Smoke" button mounts
 *   - filter chips for each kind render
 *   - clicking Run Full E2E triggers a POST to /admin/test-harness/run-e2e
 *   - rows from the NDJSON response render
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../useTestHarness', () => ({
  useTestHarness: () => ({
    results: [],
    logEntries: [],
    running: false,
    summary: null,
    startTests: vi.fn(),
    stopTests: vi.fn(),
    clearResults: vi.fn(),
  }),
}));

vi.mock('../TestPanel', () => ({
  default: () => <div data-testid="stub-test-panel" />,
}));

vi.mock('../TestLogStream', () => ({
  default: () => <div data-testid="stub-test-log-stream" />,
}));

// Stub the underlying NDJSON streamer + hook so we can assert the wire
// without spinning up MSW.
const startMock = vi.fn();
const stopMock = vi.fn();
const downloadMock = vi.fn();

vi.mock('../useE2eHarness', () => ({
  useE2eHarness: () => ({
    rows: [
      {
        testId: 'p-1',
        kind: 'provider',
        target: 'anthropic',
        status: 'pass',
        durationMs: 120,
        ttftMs: 80,
        tokensOut: 3,
        startedAt: '2026-05-20T00:00:00.000Z',
      },
      {
        testId: 'm-1',
        kind: 'chat_model',
        target: 'anthropic/claude',
        status: 'pass',
        durationMs: 380,
        ttftMs: 200,
        tokensOut: 12,
        startedAt: '2026-05-20T00:00:00.001Z',
      },
      {
        testId: 'e-1',
        kind: 'embedding_model',
        target: 'cohere/embed-v3',
        status: 'pass',
        durationMs: 90,
        embeddingDim: 1024,
        startedAt: '2026-05-20T00:00:00.002Z',
      },
    ],
    summary: {
      total: 3,
      passed: 3,
      failed: 0,
      durations: { p50: 120, p95: 380, totalMs: 590 },
      models: [
        { id: 'anthropic/claude', provider: 'anthropic', role: 'chat', ttftMs: 200, ok: true },
      ],
      mode: 'full',
    },
    running: false,
    error: null,
    start: startMock,
    stop: stopMock,
    downloadJson: downloadMock,
  }),
}));

import TestHarnessView from '../TestHarnessView';

describe('TestHarnessView — E2E section', () => {
  beforeEach(() => {
    startMock.mockClear();
    stopMock.mockClear();
    downloadMock.mockClear();
  });

  it('mounts the E2E harness section', () => {
    render(<TestHarnessView />);
    expect(screen.getByTestId('e2e-harness-section')).toBeDefined();
  });

  it('renders Run Full E2E + Run Smoke + Download JSON buttons', () => {
    render(<TestHarnessView />);
    expect(screen.getByTestId('e2e-run-full')).toBeDefined();
    expect(screen.getByTestId('e2e-run-smoke')).toBeDefined();
    expect(screen.getByTestId('e2e-download-json')).toBeDefined();
  });

  it('clicking Run Full E2E triggers start({mode:full})', async () => {
    render(<TestHarnessView />);
    fireEvent.click(screen.getByTestId('e2e-run-full'));
    await waitFor(() => {
      expect(startMock).toHaveBeenCalledTimes(1);
    });
    expect(startMock.mock.calls[0][0]).toMatchObject({ mode: 'full' });
  });

  it('clicking Run Smoke triggers start({mode:smoke})', async () => {
    render(<TestHarnessView />);
    fireEvent.click(screen.getByTestId('e2e-run-smoke'));
    await waitFor(() => {
      expect(startMock).toHaveBeenCalledTimes(1);
    });
    expect(startMock.mock.calls[0][0]).toMatchObject({ mode: 'smoke' });
  });

  it('renders one row per test_done event including ttft and embedding dim', () => {
    render(<TestHarnessView />);
    const table = screen.getByTestId('e2e-rows-table');
    expect(table).toBeDefined();
    expect(table.textContent).toContain('anthropic');
    expect(table.textContent).toContain('claude');
    expect(table.textContent).toContain('1024'); // embedding dim
    expect(table.textContent).toContain('200ms'); // ttft
  });

  it('renders filter chips for each test kind', () => {
    render(<TestHarnessView />);
    expect(screen.getByTestId('e2e-filter-all')).toBeDefined();
    expect(screen.getByTestId('e2e-filter-provider')).toBeDefined();
    expect(screen.getByTestId('e2e-filter-chat_model')).toBeDefined();
    expect(screen.getByTestId('e2e-filter-embedding_model')).toBeDefined();
    expect(screen.getByTestId('e2e-filter-t1_tool')).toBeDefined();
    expect(screen.getByTestId('e2e-filter-t2_mcp')).toBeDefined();
    expect(screen.getByTestId('e2e-filter-t3_artifact')).toBeDefined();
    expect(screen.getByTestId('e2e-filter-flow_e2e')).toBeDefined();
    expect(screen.getByTestId('e2e-filter-cache_verify')).toBeDefined();
  });

  it('summary line shows pass count and p50/p95 latencies', () => {
    render(<TestHarnessView />);
    const section = screen.getByTestId('e2e-harness-section');
    expect(section.textContent).toContain('3/3 passed');
    expect(section.textContent).toContain('p50 120ms');
    expect(section.textContent).toContain('p95 380ms');
  });
});
