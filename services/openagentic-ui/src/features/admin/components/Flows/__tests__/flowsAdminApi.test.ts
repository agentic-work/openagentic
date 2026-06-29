/**
 * TDD — flowsAdminApi
 *
 * Tests:
 *   A1  fetchKpis resolves with parsed JSON on 200
 *   A2  fetchKpis rejects with descriptive error on non-200
 *   A3  fetchAuditLogs builds correct query string + resolves
 *   A4  fetchAuditLogs rejects on non-200
 *   A5  exportAuditCsv returns correct URL and triggers anchor click
 *   A6  fetchFlowKpi resolves for specific flowId
 *   A7  fetchFlowKpi rejects when flowId is empty string
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/utils/api before importing module under test
// ---------------------------------------------------------------------------
vi.mock('@/utils/api', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '@/utils/api';
import {
  fetchKpis,
  fetchAuditLogs,
  exportAuditCsv,
  fetchFlowKpi,
} from '../../../services/flowsAdminApi';

const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const KPI_FIXTURE = {
  window: '24h',
  total_executions: 1234,
  success_rate: 97.5,
  latency_p50_ms: 120,
  latency_p95_ms: 450,
  latency_p99_ms: 1200,
  total_cost_usd: 8.42,
  avg_cost_per_execution_usd: 0.0068,
  top_failing_nodes: [{ nodeId: 'n1', nodeType: 'LLM', failureCount: 14 }],
  top_expensive_flows: [{ flowId: 'f1', flowName: 'Research Flow', totalCostUsd: 3.21 }],
};

const AUDIT_FIXTURE = {
  logs: [
    {
      id: 'log-1',
      timestamp: '2026-04-25T10:00:00Z',
      actor: 'alice@example.com',
      action: 'flow.create',
      target_type: 'flow',
      target_id: 'f-abc',
      outcome: 'success',
      metadata: { name: 'My Flow' },
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = 'Not Found'): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.reject(new Error('not json')),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('flowsAdminApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A1
  it('fetchKpis resolves with parsed JSON on 200', async () => {
    mockApiRequest.mockResolvedValueOnce(makeOkResponse(KPI_FIXTURE));

    const result = await fetchKpis('24h');

    expect(result.total_executions).toBe(1234);
    expect(result.success_rate).toBe(97.5);
    expect(mockApiRequest).toHaveBeenCalledWith('/admin/flows/kpis?window=24h');
  });

  // A2
  it('fetchKpis rejects with descriptive error on non-200', async () => {
    mockApiRequest.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));

    await expect(fetchKpis('7d')).rejects.toThrow('fetchKpis failed: 500');
  });

  // A3
  it('fetchAuditLogs builds correct query string and resolves', async () => {
    mockApiRequest.mockResolvedValueOnce(makeOkResponse(AUDIT_FIXTURE));

    const result = await fetchAuditLogs({
      actor: 'alice@example.com',
      action: 'flow.create',
      outcome: 'success',
      limit: 25,
    });

    expect(result.logs).toHaveLength(1);
    expect(result.total).toBe(1);

    const call = mockApiRequest.mock.calls[0][0] as string;
    expect(call).toContain('actor=alice%40example.com');
    expect(call).toContain('action=flow.create');
    expect(call).toContain('outcome=success');
    expect(call).toContain('limit=25');
  });

  // A4
  it('fetchAuditLogs rejects on non-200', async () => {
    mockApiRequest.mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'));

    await expect(fetchAuditLogs()).rejects.toThrow('fetchAuditLogs failed: 403');
  });

  // A5
  it('exportAuditCsv returns correct URL and triggers anchor click', () => {
    const mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValueOnce(mockAnchor);
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementationOnce((el) => el);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementationOnce((el) => el);

    const url = exportAuditCsv({ actor: 'bob@example.com', outcome: 'error' });

    expect(url).toContain('/api/admin/flows/audit-logs.csv');
    expect(url).toContain('actor=bob%40example.com');
    expect(url).toContain('outcome=error');
    expect(mockAnchor.click).toHaveBeenCalledTimes(1);

    createElementSpy.mockRestore();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
  });

  // A6
  it('fetchFlowKpi resolves for a specific flowId', async () => {
    mockApiRequest.mockResolvedValueOnce(makeOkResponse({ ...KPI_FIXTURE, total_executions: 99 }));

    const result = await fetchFlowKpi('flow-xyz', '7d');

    expect(result.total_executions).toBe(99);
    expect(mockApiRequest).toHaveBeenCalledWith(
      '/admin/flows/flow-xyz/kpis?window=7d',
    );
  });

  // A7
  it('fetchFlowKpi rejects when flowId is empty string', async () => {
    await expect(fetchFlowKpi('')).rejects.toThrow('fetchFlowKpi: flowId is required');
    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});
