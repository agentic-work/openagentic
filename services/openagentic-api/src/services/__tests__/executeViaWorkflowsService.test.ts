/**
 * executeViaWorkflowsService — TDD for the api→workflows-svc proxy
 * wrapper that will REPLACE the in-process executeWorkflow() in
 * Phase B's engine rip.
 *
 * Contract: same signature as the legacy executeWorkflow so the 5
 * call-sites (WorkflowScheduler, WorkflowTestRunner, routes/workflows,
 * routes/v1/webhooks, routes/workflow-approvals) can swap one import
 * line and stop pulling in the 4000-LOC engine class.
 *
 * Behavior:
 *   • POSTs to ${WORKFLOW_SERVICE_URL}/execute-sync with internal-key
 *     auth (same header workflowServiceHeaders() ships).
 *   • Replays the workflows-svc events[] array through onEvent so
 *     consumers that subscribe to streaming events still see them.
 *   • Returns { success, output, error? } — same shape the legacy
 *     wrapper returned.
 *   • Surfaces 401/503 as a clean Error with workflows-svc message.
 *   • When WORKFLOW_SERVICE_URL is unset, fails fast with a clear
 *     message (no silent fallback — that's what Phase A surfaces).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');
vi.mock('../../utils/internalKeyReader.js', () => ({
  getInternalKey: vi.fn(() => 'test-internal-key'),
}));

import axios from 'axios';
import { executeViaWorkflowsService } from '../executeViaWorkflowsService.js';

const mockPost = axios.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKFLOW_SERVICE_URL = 'http://stub-workflows:3400';
});

describe('executeViaWorkflowsService', () => {
  it('POSTs to /execute-sync with the workflowId, executionId, definition, input, userId', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: true, output: { hello: 'world' }, events: [] },
      status: 200,
    });

    await executeViaWorkflowsService(
      'wf-1', 'exec-1',
      { nodes: [{ id: 't', type: 'trigger', data: {} }], edges: [] },
      { foo: 1 },
      'user-42',
      undefined, undefined,
      { tenantId: 'tnt-test' },
    );

    expect(mockPost).toHaveBeenCalledOnce();
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe('http://stub-workflows:3400/execute-sync');
    expect(body).toMatchObject({
      workflowId: 'wf-1',
      executionId: 'exec-1',
      input: { foo: 1 },
      userId: 'user-42',
    });
    expect(body.definition.nodes).toHaveLength(1);
  });

  it('sends Authorization: Bearer <internalKey> header', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true, output: {}, events: [] }, status: 200 });
    await executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined, { tenantId: 'tnt-test' });
    const [, , config] = mockPost.mock.calls[0];
    expect(config.headers.Authorization).toBe('Bearer test-internal-key');
  });

  it('returns { success, output } from the workflows-svc response', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: true, output: { result: 42 }, events: [] },
      status: 200,
    });
    const r = await executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined, { tenantId: 'tnt-test' });
    expect(r).toEqual({ success: true, output: { result: 42 } });
  });

  it('replays events[] through onEvent in order', async () => {
    const events = [
      { type: 'execution_start', executionId: 'e', timestamp: '2026-05-03T00:00:00Z' },
      { type: 'node_complete', executionId: 'e', nodeId: 'n1', timestamp: '2026-05-03T00:00:01Z' },
      { type: 'execution_complete', executionId: 'e', timestamp: '2026-05-03T00:00:02Z' },
    ];
    mockPost.mockResolvedValueOnce({ data: { success: true, output: {}, events }, status: 200 });

    const seen: string[] = [];
    await executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined,
      (ev) => seen.push(ev.type), { tenantId: 'tnt-test' });

    expect(seen).toEqual(['execution_start', 'node_complete', 'execution_complete']);
  });

  it('threads opts through (userEmail, idToken, triggerType, userPermissions, tenantId)', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true, output: {}, events: [] }, status: 200 });
    await executeViaWorkflowsService(
      'w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined,
      { userEmail: 'a@b.com', idToken: 'idt', triggerType: 'webhook', userPermissions: ['admin'], tenantId: 'tnt-1' },
    );
    const [, body] = mockPost.mock.calls[0];
    expect(body).toMatchObject({
      userEmail: 'a@b.com', idToken: 'idt', triggerType: 'webhook',
      userPermissions: ['admin'], tenantId: 'tnt-1',
    });
  });

  it('threads authToken into the body so the user-context propagates', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true, output: {}, events: [] }, status: 200 });
    await executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', 'Bearer user-token', undefined, { tenantId: 'tnt-test' });
    const [, body] = mockPost.mock.calls[0];
    expect(body.authToken).toBe('Bearer user-token');
  });

  it('throws a clean error when WORKFLOW_SERVICE_URL is unset', async () => {
    delete process.env.WORKFLOW_SERVICE_URL;
    await expect(
      executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined, { tenantId: 'tnt-test' }),
    ).rejects.toThrow(/WORKFLOW_SERVICE_URL/);
  });

  it('surfaces axios errors with a useful message (e.g. 401)', async () => {
    mockPost.mockRejectedValueOnce({
      response: { status: 401, data: { error: 'Unauthorized: invalid bearer token' } },
      message: 'Request failed with status code 401',
    });
    await expect(
      executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined, { tenantId: 'tnt-test' }),
    ).rejects.toThrow(/401|Unauthorized/);
  });

  it('surfaces non-2xx success=false response as the failure path', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success: false, output: null, error: 'node X failed', events: [] },
      status: 200,
    });
    const r = await executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined, { tenantId: 'tnt-test' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('node X failed');
  });

  it('forwards opts.mocks as body.mocks (Phase B #17)', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true, output: {}, events: [] }, status: 200 });
    const mocks = {
      mcpTools: [{ toolName: 'k8s_list_pods', response: { pods: [] } }],
    };
    await executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined, { mocks, tenantId: 'tnt-1' });
    const [, body] = mockPost.mock.calls[0];
    expect(body.mocks).toEqual(mocks);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 1.3 (V3 Enterprise Chatmode): tenantId must be on the wire.
  // Substrate fix S5 — the api caller is the JWT-trusted boundary; if it
  // can't derive a tenantId from the request context, it MUST fail-CLOSED
  // here rather than silently shipping null and letting the Prisma extension
  // fail-open downstream.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Task 1.3 — tenantId fail-CLOSED contract', () => {
    it('throws when opts.tenantId is missing (no opts at all)', async () => {
      await expect(
        executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u'),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('throws when opts is supplied but tenantId is undefined', async () => {
      await expect(
        executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined,
          { userEmail: 'a@b.com' }),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('throws when tenantId is null', async () => {
      await expect(
        executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined,
          { tenantId: null as any }),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('throws when tenantId is empty string', async () => {
      await expect(
        executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined,
          { tenantId: '' }),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('throws when tenantId is whitespace-only', async () => {
      await expect(
        executeViaWorkflowsService('w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined,
          { tenantId: '   ' }),
      ).rejects.toThrow(/tenantId/i);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('sends tenantId as a non-null string on the wire when present', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, output: {}, events: [] }, status: 200 });
      await executeViaWorkflowsService(
        'w', 'e', { nodes: [], edges: [] }, {}, 'u', undefined, undefined,
        { tenantId: 'tenant-A' },
      );
      const [, body] = mockPost.mock.calls[0];
      expect(body.tenantId).toBe('tenant-A');
      // Fail-CLOSED contract: never null on the wire.
      expect(body.tenantId).not.toBeNull();
      expect(typeof body.tenantId).toBe('string');
    });
  });
});
