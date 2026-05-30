/**
 * useAgentOpsMetrics — fetches the fleet rollup and exposes
 * { agents, runs, loading, error }. Wraps the
 *   GET /admin/agents/metrics/fleet
 * endpoint, falls back to empty arrays + error string on failure
 * so AgentOpsView never crashes.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentOpsMetrics } from '../useAgentOpsMetrics';

const originalFetch = globalThis.fetch;

function mockFetchOnce(body: any, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response);
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('useAgentOpsMetrics', () => {
  it('starts in loading=true with empty arrays', () => {
    mockFetchOnce({ agents: [], runs: [] });
    const { result } = renderHook(() => useAgentOpsMetrics());
    expect(result.current.loading).toBe(true);
    expect(result.current.agents).toEqual([]);
    expect(result.current.runs).toEqual([]);
  });

  it('settles with the response payload on success', async () => {
    const payload = {
      agents: [
        { agentId: 'a1', agentName: 'Researcher', agentType: 'research', runCount24h: 12, successRate: 0.92, p50DurationMs: 2400, totalCostCents: 412.5 },
      ],
      runs: [
        { id: 'r1', agentId: 'a1', agentName: 'Researcher', status: 'success', durationMs: 2400, costCents: 8, startedAt: '2026-04-26T17:00:00Z' },
      ],
    };
    mockFetchOnce(payload);
    const { result } = renderHook(() => useAgentOpsMetrics());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('sets error string + empty arrays on a non-ok response', async () => {
    mockFetchOnce({ error: 'boom' }, false);
    const { result } = renderHook(() => useAgentOpsMetrics());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agents).toEqual([]);
    expect(result.current.runs).toEqual([]);
    expect(result.current.error).toMatch(/HTTP 500|fleet/i);
  });

  it('sets error string + empty arrays on a network throw', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('net down'));
    const { result } = renderHook(() => useAgentOpsMetrics());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/net down/i);
  });
});
