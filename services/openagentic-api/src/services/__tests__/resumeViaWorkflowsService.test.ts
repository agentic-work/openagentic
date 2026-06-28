/**
 * resumeViaWorkflowsService — TDD for the api→workflows-svc proxy that
 * replaces in-process WorkflowExecutionEngine.resumeExecution() in
 * routes/workflow-approvals.ts.
 *
 * Drop-in for `engine.resumeExecution(approval.node_id, approvalResult)`,
 * but instead of constructing a local engine, it POSTs to
 * /resume-execution on workflows-svc with internal-key auth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
vi.mock('../../utils/internalKeyReader.js', () => ({
  getInternalKey: vi.fn(() => 'test-internal-key'),
}));

import axios from 'axios';
import { resumeViaWorkflowsService } from '../resumeViaWorkflowsService.js';

const mockPost = axios.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKFLOW_SERVICE_URL = 'http://stub-workflows:3400';
});

describe('resumeViaWorkflowsService', () => {
  const baseInput = {
    workflowId: 'wf-1',
    executionId: 'exec-1',
    definition: { nodes: [{ id: 't', type: 'trigger', data: {} }], edges: [] },
    fromNodeId: 'approval-1',
    resumeInput: { approved: true, approvedBy: 'alice' },
    state: {
      input: { foo: 1 },
      variables: { tmp: 2 },
      nodeResults: { trigger: { ok: true } },
      startTimeMs: 1700000000000,
    },
    userId: 'u-1',
    // Task 1.3 (V3 Enterprise Chatmode S5): tenantId is now required for the
    // wire format. Tests use a fixed tenant; production callers pass
    // request.tenantId or the workflow row's tenant_id.
    tenantId: 'tnt-test',
  };

  it('POSTs to /resume-execution with the full payload + internal-key header', async () => {
    // /resume-execution returns SSE; the proxy reads it as JSON in
    // tests by switching to axios-stream parser. For unit-testing the
    // wiring, we mock a JSON response that mimics the buffered shape.
    mockPost.mockResolvedValueOnce({
      data: { success: true, output: { done: true }, events: [] },
      status: 200,
    });

    await resumeViaWorkflowsService(baseInput);

    expect(mockPost).toHaveBeenCalledOnce();
    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toBe('http://stub-workflows:3400/resume-execution');
    expect(body).toMatchObject({
      workflowId: 'wf-1',
      executionId: 'exec-1',
      fromNodeId: 'approval-1',
      resumeInput: { approved: true, approvedBy: 'alice' },
      state: baseInput.state,
      userId: 'u-1',
    });
    expect(body.definition.nodes).toHaveLength(1);
    expect(config.headers.Authorization).toBe('Bearer test-internal-key');
  });

  it('returns the engine result shape unchanged', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: true, output: { value: 42 }, events: [] },
      status: 200,
    });
    const r = await resumeViaWorkflowsService(baseInput);
    expect(r).toEqual({ success: true, output: { value: 42 } });
  });

  it('propagates failure with the engine error', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: false, output: null, error: 'gate node failed', events: [] },
      status: 200,
    });
    const r = await resumeViaWorkflowsService(baseInput);
    expect(r.success).toBe(false);
    expect(r.error).toBe('gate node failed');
  });

  it('throws clean error when WORKFLOW_SERVICE_URL is unset', async () => {
    delete process.env.WORKFLOW_SERVICE_URL;
    await expect(resumeViaWorkflowsService(baseInput)).rejects.toThrow(/WORKFLOW_SERVICE_URL/);
  });

  it('replays events[] through optional onEvent callback', async () => {
    const events = [
      { type: 'execution_resumed', executionId: 'exec-1', timestamp: '2026-05-04T00:00:00Z' },
      { type: 'node_complete', executionId: 'exec-1', nodeId: 'next', timestamp: '2026-05-04T00:00:01Z' },
      { type: 'execution_complete', executionId: 'exec-1', timestamp: '2026-05-04T00:00:02Z' },
    ];
    mockPost.mockResolvedValueOnce({ data: { success: true, output: 'ok', events }, status: 200 });

    const seen: string[] = [];
    await resumeViaWorkflowsService(baseInput, (ev) => seen.push(ev.type));
    expect(seen).toEqual(['execution_resumed', 'node_complete', 'execution_complete']);
  });

  it('surfaces 401 from workflows-svc as a clean error', async () => {
    mockPost.mockRejectedValueOnce({
      response: { status: 401, data: { error: 'Unauthorized: invalid bearer token' } },
      message: 'Request failed with status code 401',
    });
    await expect(resumeViaWorkflowsService(baseInput)).rejects.toThrow(/401|Unauthorized/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 1.3 (V3 Enterprise Chatmode S5): tenantId fail-CLOSED contract.
  // Same rationale as executeViaWorkflowsService — the api caller is the
  // JWT-trusted boundary; missing/empty tenantId here would let the
  // workflows-side Prisma extension fail-open downstream.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Task 1.3 — tenantId fail-CLOSED contract', () => {
    it('throws when tenantId is missing', async () => {
      const { tenantId, ...inputNoTenant } = baseInput;
      void tenantId;
      await expect(
        resumeViaWorkflowsService(inputNoTenant as any),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('throws when tenantId is null', async () => {
      await expect(
        resumeViaWorkflowsService({ ...baseInput, tenantId: null as any }),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('throws when tenantId is empty string', async () => {
      await expect(
        resumeViaWorkflowsService({ ...baseInput, tenantId: '' }),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('throws when tenantId is whitespace-only', async () => {
      await expect(
        resumeViaWorkflowsService({ ...baseInput, tenantId: '   ' }),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('sends tenantId on the wire when present', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, output: {}, events: [] }, status: 200 });
      await resumeViaWorkflowsService({ ...baseInput, tenantId: 'tenant-A' });
      const [, body] = mockPost.mock.calls[0];
      expect(body.tenantId).toBe('tenant-A');
      expect(typeof body.tenantId).toBe('string');
    });
  });
});
